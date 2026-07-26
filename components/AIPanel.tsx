"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Caption,
  EditRecipe,
  EditStyle,
  HighlightMoment,
  MediaAsset,
  MontageModifiers,
  MontageStyle,
  TimeRange,
  TimelineClip,
  TimelineSignals,
} from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTranscription } from "@/hooks/useTranscription";
import { assetKind, findTrack, invertRanges, mainClips, mainVideoTrack, tracksDuration } from "@/lib/timeline/tracks";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { detectSilence, type SilenceAggressiveness } from "@/lib/autoEdit/detectSilence";
import { fillerCutRanges } from "@/lib/autoEdit/detectFillerWords";
import { detectHooks } from "@/lib/autoEdit/detectHooks";
import { detectDeadSpace } from "@/lib/autoEdit/detectHighlights";
import { findBestWindow } from "@/lib/autoEdit/scoreMoments";
import { generateEditRecipe } from "@/lib/autoEdit/generateEditRecipe";
import { MONTAGE_PRESETS, generateMontageRecipe } from "@/lib/autoEdit/montage";
import { reviseEditRecipe } from "@/lib/autoEdit/reviseEditRecipe";
import { filmstripUrl } from "@/lib/video/client";
import {
  buildTimelineSignals,
  fetchAnalyses,
  findBestMusicStart,
  musicBeatConfidence,
} from "@/lib/autoEdit/signals";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  Crosshair,
  Film,
  Flame,
  Layers3,
  MessageSquareText,
  Mic2,
  Music,
  RefreshCw,
  Scissors,
  X,
  Zap,
} from "lucide-react";

type Workflow = "montage" | "interview";
type SourceRole = "include" | "a-roll" | "b-roll" | "exclude";

interface DraftContext {
  projectId: string;
  revision: number;
  generationSignature: string;
}

interface GenerationRequest {
  uiSignature: string;
  storeSignature: string;
  token: number;
}

const EDIT_STYLES: Array<{ id: EditStyle; name: string }> = [
  { id: "viral", name: "Viral" },
  { id: "clean", name: "Clean" },
  { id: "podcast", name: "Podcast" },
  { id: "sports", name: "Sports" },
  { id: "storytime", name: "Storytime" },
  { id: "educational", name: "Educational" },
  { id: "meme", name: "Meme" },
];

/**
 * Right panel, AI Edit tab: one-button Auto Edit plus the individual smart
 * tools (hooks, silence/filler/dead-space cuts, best-N-seconds). Everything
 * runs locally — transcript heuristics + FFmpeg motion/audio/beat analysis,
 * no API needed. Works on talky videos AND raw no-speech footage (sports!).
 */
export default function AIPanel() {
  const captions = useEditorStore((s) => s.captions);
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const setMusicFromAsset = useEditorStore((s) => s.setMusicFromAsset);
  const isTranscribing = useEditorStore((s) => s.isTranscribing);
  const editRecipe = useEditorStore((s) => s.editRecipe);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const projectId = useEditorStore((s) => s.projectId);
  const revision = useEditorStore((s) => s.revision);

  const { runTranscription, coverageStatus, progress: captionProgress } = useTranscription();
  const { uploading: musicUploading, handleFiles: uploadFiles } = useMediaUpload();
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [workflow, setWorkflow] = useState<Workflow>("montage");
  /** Explicit per-source intent. Missing values use the visible smart default. */
  const [sourceRoles, setSourceRoles] = useState<Record<string, SourceRole>>({});
  const [style, setStyle] = useState<EditStyle>("clean");
  const [montageStyle, setMontageStyle] = useState<MontageStyle>("hype");
  const [montageLength, setMontageLength] = useState(20);
  const [customLength, setCustomLength] = useState<string>("");
  const [endCard, setEndCard] = useState(true);
  /** Sticky one-tap adjustments applied to every (re)generate until toggled off. */
  const [modifiers, setModifiers] = useState<MontageModifiers>({});
  /** Which engine produced the current recipe — regenerate re-runs the same one. */
  const [lastEngine, setLastEngine] = useState<"montage" | "auto">("montage");
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);
  /** AI generation is a proposal until the user explicitly applies it. */
  const [draftRecipe, setDraftRecipe] = useState<EditRecipe | null>(null);
  /** Original kept-range indexes, in the order chosen by the user. */
  const [draftOrder, setDraftOrder] = useState<number[]>([]);
  /** Store snapshot that the draft's original-timeline coordinates belong to. */
  const [draftContext, setDraftContext] = useState<DraftContext | null>(null);

  const duration = tracksDuration(tracks);
  const hasContent = duration > 0.5;
  const disabled = !hasContent || isTranscribing || busy !== null;
  const mainTrack = mainVideoTrack(tracks);
  const selectedMainIds = new Set(
    selectedClipIds.filter((id) => mainTrack.clips.some((clip) => clip.id === id))
  );
  const captionsReady =
    hasContent && captions.length > 0 && coverageStatus() === "complete";

  const defaultRole = (clip: TimelineClip, index: number): SourceRole => {
    if (selectedMainIds.size > 0 && !selectedMainIds.has(clip.id)) return "exclude";
    if (workflow === "montage") return "include";
    const eligible = mainTrack.clips.filter(
      (item) => selectedMainIds.size === 0 || selectedMainIds.has(item.id)
    );
    const firstWithAudio = eligible.find((item) => {
      const asset = media.find((candidate) => candidate.id === item.assetId);
      return sourceHasAudio(asset, media);
    });
    return clip.id === (firstWithAudio?.id ?? eligible[0]?.id) && index >= 0 ? "a-roll" : "b-roll";
  };

  const roleOf = (clip: TimelineClip, index: number): SourceRole =>
    sourceRoles[clip.id] ?? defaultRole(clip, index);

  const includedSourceIds = mainTrack.clips
    .filter((clip, index) => {
      const role = roleOf(clip, index);
      return workflow === "montage" ? role !== "exclude" : role === "b-roll";
    })
    .map((clip) => clip.id);
  const speechSourceIds = mainTrack.clips
    .filter((clip, index) => workflow === "interview" && roleOf(clip, index) === "a-roll")
    .map((clip) => clip.id);
  const generationSignature = JSON.stringify({
    workflow,
    style,
    montageStyle,
    montageLength,
    customLength,
    endCard,
    modifiers,
    includedSourceIds,
    speechSourceIds,
    selectedClipIds,
    sourceRoles: Object.entries(sourceRoles).sort(([a], [b]) => a.localeCompare(b)),
    main: mainTrack.clips.map((clip) => [
      clip.id,
      clip.assetId,
      clip.startTime,
      clip.endTime,
      clip.sourceStart,
      clip.sourceEnd,
      clip.speed ?? 1,
    ]),
    music: findTrack(tracks, "music")?.clips.map((clip) => [
      clip.id,
      clip.assetId,
      clip.startTime,
      clip.endTime,
      clip.sourceStart,
      clip.sourceEnd,
    ]),
  });
  const generationSignatureRef = useRef(generationSignature);
  const generationTokenRef = useRef(0);
  useEffect(() => {
    generationSignatureRef.current = generationSignature;
  }, [generationSignature]);
  const draftIsStale = Boolean(
    draftContext &&
      (draftContext.projectId !== projectId ||
        draftContext.revision !== revision ||
        draftContext.generationSignature !== generationSignature)
  );

  /* ---------------- shared input gathering ---------------- */

  /** Fetch (cached) local media analysis and stitch timeline signals.
      The cache lives in the store so the preview's smart crop shares it.
      `tracksOverride` lets the montage flow build signals against a
      pre-retrimmed music clip (correct beat phase for the chosen section). */
  const getSignals = async (tracksOverride?: typeof tracks): Promise<TimelineSignals | null> => {
    const s = useEditorStore.getState();
    const signalTracks = tracksOverride ?? s.tracks;
    const relevantAssetIds = new Set(
      signalTracks
        .filter((track) => track.type === "video" || track.type === "music")
        .flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean))
    );
    for (const asset of s.media) {
      if (relevantAssetIds.has(asset.id) && asset.linkedAudio?.audioAssetId) {
        relevantAssetIds.add(asset.linkedAudio.audioAssetId);
      }
    }
    const missing = s.media.filter(
      (asset) =>
        relevantAssetIds.has(asset.id) &&
        assetKind(asset) !== "image" &&
        !(asset.id in s.analyses)
    );
    if (missing.length > 0) {
      setStage(`Analyzing motion, sound, and pacing (${missing.length} ${missing.length === 1 ? "file" : "files"})…`);
      try {
        const fresh = await fetchAnalyses(missing, ({ completed, total }) => {
          setStage(`Analyzing motion, sound, and pacing (${completed}/${total})…`);
        });
        s.mergeAnalyses(fresh);
      } catch {
        // Analysis is an enhancement, never a blocker.
        s.mergeAnalyses(Object.fromEntries(missing.map((m) => [m.id, null])));
        useEditorStore.getState().addToast("info", "Footage analysis unavailable — using transcript only.");
      }
    }
    try {
      const latest = useEditorStore.getState();
      return buildTimelineSignals(signalTracks, latest.media, latest.analyses, latest.beat);
    } catch {
      return null;
    }
  };

  /**
   * Pick the song section the montage should ride (drop/chorus) and a tracks
   * view with the music retrimmed to it, so the beat grid the engine snaps to
   * already has that section's phase. Must run AFTER analyses are fetched.
   */
  const planMusicCut = (): {
    musicCut?: { sourceStart: number; sourceEnd: number };
    signalTracks?: typeof tracks;
  } => {
    const s = useEditorStore.getState();
    const musicTrack = findTrack(s.tracks, "music");
    const clip = musicTrack?.clips[0];
    const asset = clip?.assetId ? s.media.find((m) => m.id === clip.assetId) : undefined;
    const audio = clip?.assetId ? s.analyses[clip.assetId]?.audio : undefined;
    if (!musicTrack || !clip || !asset || !audio) return {};
    const srcStart = findBestMusicStart(audio, asset.duration, targetLength);
    // Give the engine a little headroom past the target for beat snapping.
    const span = Math.min(asset.duration - srcStart, targetLength * 1.5 + 4);
    if (span < 4) return {};
    const musicCut = { sourceStart: srcStart, sourceEnd: Math.round((srcStart + span) * 1000) / 1000 };
    const signalTracks = s.tracks.map((t) =>
      t.type === "music"
        ? {
            ...t,
            clips: [
              {
                ...clip,
                startTime: 0,
                endTime: span,
                sourceStart: musicCut.sourceStart,
                sourceEnd: musicCut.sourceEnd,
              },
            ],
          }
        : t
    );
    return { musicCut, signalTracks };
  };

  /**
   * Captions are the transcript. `mode`:
   *  - "try": transcribe when missing but tolerate failure (footage-only edit)
   *  - "require": no captions = stop
   */
  const getCaptions = async (
    mode: "try" | "require",
    clipIds?: string[]
  ): Promise<Caption[]> => {
    const s = useEditorStore.getState();
    const currentMain = mainVideoTrack(s.tracks);
    const scopedCaptions = clipIds
      ? filterCaptionsForClips(s.captions, currentMain.clips, new Set(clipIds))
      : s.captions;
    const coverage = coverageStatus(clipIds);
    if (scopedCaptions.length > 0 && coverage === "complete") return scopedCaptions;

    const requestedIds = clipIds ? new Set(clipIds) : null;
    const requestedClips = requestedIds
      ? currentMain.clips.filter((clip) => requestedIds.has(clip.id))
      : currentMain.clips;
    const anyAudio = requestedClips.some((clip) => {
      const asset = s.media.find((candidate) => candidate.id === clip.assetId);
      return sourceHasAudio(asset, s.media);
    });
    if (!anyAudio) {
      // Legacy/manual captions are still useful when there is no audio source
      // from which a more complete transcript could be generated.
      if (scopedCaptions.length > 0) return scopedCaptions;
      if (mode === "require") s.addToast("info", "This footage has no audio to transcribe.");
      return [];
    }
    setStage("Transcribing speech (free, local)…");
    const fresh = await runTranscription(clipIds ? { clipIds } : { scope: "timeline" });
    return fresh ?? [];
  };

  /** Legacy amplitude fallback for when full analysis isn't available. */
  const timelinePeaks = (): number[] | null => {
    const s = useEditorStore.getState();
    const clips = mainClips(s.tracks);
    const out: number[] = [];
    for (const clip of clips) {
      const asset = s.media.find((m) => m.id === clip.mediaId);
      const peaks = s.waveforms[clip.mediaId];
      if (!asset || !peaks || asset.duration <= 0) return null;
      const from = Math.floor((clip.sourceStart / asset.duration) * peaks.length);
      const to = Math.max(from + 1, Math.ceil((clip.sourceEnd / asset.duration) * peaks.length));
      out.push(...peaks.slice(from, to));
    }
    return out.length > 0 ? out : null;
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      useEditorStore
        .getState()
        .addToast("error", err instanceof Error ? err.message : "The first cut could not be created.");
    } finally {
      setBusy(null);
      setStage(null);
    }
  };

  /* ---------------- actions ---------------- */

  /** Effective target length: custom field wins when it parses. */
  const targetLength = (() => {
    const custom = parseInt(customLength, 10);
    return Number.isFinite(custom) && custom >= 8 ? Math.min(60, custom) : montageLength;
  })();

  const beginGeneration = (): GenerationRequest => ({
    uiSignature: generationSignatureRef.current,
    storeSignature: storeGenerationSignature(),
    token: generationTokenRef.current,
  });

  const invalidateGeneration = () => {
    generationTokenRef.current += 1;
  };

  const publishDraft = (
    recipe: EditRecipe,
    nextSeed: number,
    engine: "montage" | "auto",
    request: GenerationRequest
  ): boolean => {
    if (
      generationTokenRef.current !== request.token ||
      generationSignatureRef.current !== request.uiSignature ||
      storeGenerationSignature() !== request.storeSignature
    ) {
      useEditorStore
        .getState()
        .addToast("info", "The sources or settings changed. Build a fresh draft.");
      return false;
    }
    const current = useEditorStore.getState();
    setDraftRecipe(recipe);
    setDraftOrder(recipe.keptRanges.map((_, index) => index));
    setDraftContext({
      projectId: current.projectId,
      revision: current.revision,
      generationSignature: request.uiSignature,
    });
    setSeed(nextSeed);
    setLastEngine(engine);
    return true;
  };

  /** The football-montage engine: rank raw clips, keep the best moments,
      assemble hook → action → reaction → ender. */
  const runMontage = (nextSeed = 0, mods: MontageModifiers = modifiers) =>
    withBusy("montage", async () => {
      const request = beginGeneration();
      if (workflow === "montage" && includedSourceIds.length === 0) {
        useEditorStore.getState().addToast("info", "Choose at least one source clip for this montage.");
        return;
      }
      if (workflow === "interview" && speechSourceIds.length === 0) {
        useEditorStore.getState().addToast("info", "Mark at least one clip as Interview audio.");
        return;
      }
      // Warm analyses first (getSignals fetches), then plan the song section
      // so the beat grid below carries the chosen section's phase.
      await getSignals();
      const { musicCut, signalTracks } = planMusicCut();
      const signals = await getSignals(signalTracks);
      const allCaps =
        workflow === "interview"
          ? await getCaptions("require", speechSourceIds)
          : useEditorStore.getState().captions;
      const latestTracks = useEditorStore.getState().tracks;
      const caps = workflow === "interview"
        ? filterCaptionsForClips(allCaps, mainVideoTrack(latestTracks).clips, new Set(speechSourceIds))
        : allCaps;
      if (workflow === "interview" && caps.length === 0) {
        useEditorStore.getState().addToast(
          "info",
          "No speech was found in the clips marked Interview audio. Check the source roles or captions."
        );
        return;
      }
      setStage(
        workflow === "interview"
          ? "Finding strong answers and matching B-roll…"
          : "Ranking moments and sketching the montage…"
      );
      const s = useEditorStore.getState();
      const recipe = generateMontageRecipe({
        projectId: s.projectId,
        preset: workflow === "interview" ? "interview" : montageStyle,
        targetDuration: targetLength,
        signals,
        transcript: analyzeTranscript(caps),
        captions: caps,
        clips: mainClips(s.tracks),
        includedClipIds: includedSourceIds,
        analyses: s.analyses,
        duration: tracksDuration(s.tracks),
        endCard,
        seed: nextSeed,
        modifiers: mods,
        musicCut,
      });
      if (recipe.keptRanges.length === 0) {
        s.addToast("info", "No strong moments were found in that source selection. Try adding another clip.");
        return;
      }
      publishDraft(recipe, nextSeed, "montage", request);
    });

  const buildAutoEditRecipe = async (
    nextSeed: number,
    mode: "quick" | "draft" = "draft"
  ): Promise<EditRecipe | null> => {
    const signals = await getSignals();
    const caps = await getCaptions("try");
    if (caps.length === 0 && !signals) {
      useEditorStore
        .getState()
        .addToast("error", "First cut needs audible speech or footage with enough visual detail.");
      return null;
    }
    if (caps.length === 0 && signals) {
      useEditorStore
        .getState()
        .addToast("info", "No speech found. First cut will use motion, sound, and scene changes.");
    }
    setStage("Removing pauses and tightening the pacing…");
    const s = useEditorStore.getState();
    const recipe = generateEditRecipe({
      projectId: s.projectId,
      transcript: analyzeTranscript(caps),
      captions: caps,
      peaks: signals?.energy ?? timelinePeaks(),
      signals,
      duration: tracksDuration(s.tracks),
      style,
      seed: nextSeed,
    });
    // One-tap cleanup should improve the supplied edit, never inject a generic
    // social CTA the creator did not ask for. Draft mode keeps the full style.
    return mode === "quick"
      ? { ...recipe, overlays: recipe.overlays.filter((overlay) => overlay.role !== "cta") }
      : recipe;
  };

  /** One tap performs the complete cleanup and applies it immediately. The
      store creates both an undo entry and named before/after restore points. */
  const runQuickAutoEdit = (nextSeed = 0) =>
    withBusy("quick-auto", async () => {
      const request = beginGeneration();
      const recipe = await buildAutoEditRecipe(nextSeed, "quick");
      if (!recipe) return;
      if (
        generationTokenRef.current !== request.token ||
        generationSignatureRef.current !== request.uiSignature ||
        storeGenerationSignature() !== request.storeSignature
      ) {
        useEditorStore
          .getState()
          .addToast("info", "The timeline changed while the draft was being built. Run it again.");
        return;
      }
      useEditorStore.getState().applyEditRecipe(recipe);
      setSeed(nextSeed);
      setLastEngine("auto");
      setDraftRecipe(null);
      setDraftOrder([]);
      setDraftContext(null);
    });

  const runAutoEdit = (nextSeed = 0) =>
    withBusy("auto", async () => {
      const request = beginGeneration();
      const recipe = await buildAutoEditRecipe(nextSeed);
      if (recipe) publishDraft(recipe, nextSeed, "auto", request);
    });

  /** Re-run the active engine without mutating the timeline. */
  const regenerate = (mods: MontageModifiers = modifiers) => {
    if (lastEngine === "montage") void runMontage(seed + 1, mods);
    else void runAutoEdit(seed + 1);
  };

  const applyDraft = () => {
    if (!draftRecipe || draftOrder.length === 0) {
      useEditorStore.getState().addToast("info", "Keep at least one suggested moment.");
      return;
    }
    const current = useEditorStore.getState();
    const contextChanged =
      !draftContext ||
      draftContext.projectId !== current.projectId ||
      draftContext.revision !== current.revision ||
      draftContext.generationSignature !== generationSignatureRef.current;
    if (contextChanged) {
      current
        .addToast("info", "The timeline or source plan changed. Generate a fresh draft before applying.");
      return;
    }
    current.applyEditRecipe(reviseEditRecipe(draftRecipe, draftOrder));
    setDraftRecipe(null);
    setDraftOrder([]);
    setDraftContext(null);
  };

  const runBestSeconds = (target: number) =>
    withBusy(`best-${target}`, async () => {
      const signals = await getSignals();
      const caps = await getCaptions(signals ? "try" : "require");
      if (caps.length === 0 && !signals) return;
      setStage("Scoring every second…");
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const window = findBestWindow(
        { transcript: analyzeTranscript(caps), peaks: signals?.energy ?? timelinePeaks(), signals, duration: dur },
        target
      );
      if (!window) {
        s.addToast("info", "The video is already shorter than that.");
        return;
      }
      s.applyRearrange([window], `Kept the best ${Math.round(window.end - window.start)}s ✂️`);
    });

  const runRemoveSilence = (level: SilenceAggressiveness) =>
    withBusy(`silence-${level}`, async () => {
      const signals = await getSignals();
      const caps = await getCaptions("require");
      if (caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const silences = detectSilence(
        {
          transcript: analyzeTranscript(caps),
          peaks: signals?.energy ?? timelinePeaks(),
          duration: dur,
        },
        level
      );
      if (silences.length === 0) {
        s.addToast("info", "No cuttable silence found at this level.");
        return;
      }
      const removedSec = silences.reduce((sum, r) => sum + (r.end - r.start), 0);
      s.applyRearrange(
        invertRanges(silences, dur),
        `Removed ${removedSec.toFixed(1)}s of silence (${silences.length} cuts) 🔇`
      );
    });

  const runTrimDeadSpace = () =>
    withBusy("dead-space", async () => {
      const signals = await getSignals();
      const s = useEditorStore.getState();
      if (!signals) {
        s.addToast("error", "Footage analysis is unavailable for this media.");
        return;
      }
      const dur = tracksDuration(s.tracks);
      const dead = detectDeadSpace(signals);
      if (dead.length === 0) {
        s.addToast("info", "No dead space found.");
        return;
      }
      const removedSec = dead.reduce((sum, r) => sum + (r.end - r.start), 0);
      s.applyRearrange(
        invertRanges(dead, dur),
        `Trimmed ${removedSec.toFixed(1)}s where nothing happened (${dead.length} cuts) 🎬`
      );
    });

  const runRemoveFillers = () =>
    withBusy("fillers", async () => {
      const caps = await getCaptions("require");
      if (caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const fillers = fillerCutRanges(analyzeTranscript(caps));
      if (fillers.length === 0) {
        s.addToast("info", "No filler words found.");
        return;
      }
      s.applyRearrange(invertRanges(fillers, dur), `Cut ${fillers.length} filler words 🧹`);
    });

  const applyHookAsOpener = (hook: { startTime: number; endTime: number; text: string }) => {
    const s = useEditorStore.getState();
    const dur = tracksDuration(s.tracks);
    const range: TimeRange = {
      start: Math.max(0, hook.startTime - 0.12),
      end: Math.min(dur, hook.endTime + 0.15),
    };
    if (range.start < 0.5) {
      s.addToast("info", "That line already opens the video.");
      return;
    }
    const kept: TimeRange[] = [range, { start: 0, end: range.start }, { start: range.end, end: dur }].filter(
      (r) => r.end - r.start > 0.05
    );
    s.applyRearrange(kept, "Opening moved to the front.");
  };

  const jumpTo = (time: number) => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setCurrentTime(time);
  };

  /** Upload an audio file and set it straight as the soundtrack. Waits
      briefly for the beat/energy analysis so the clip can start at the
      song's best section instead of its intro. */
  const onMusicPicked = async (files: FileList) => {
    const uploaded = await uploadFiles(files, { silentAudioTip: true });
    const audio = uploaded.find((a) => assetKind(a) === "audio");
    if (!audio) {
      if (uploaded.length > 0) {
        useEditorStore.getState().addToast("error", "That file has no audio — pick an mp3/wav/m4a.");
      }
      return;
    }
    // The upload flow warms the analysis in the background; give it a moment.
    for (let i = 0; i < 40; i++) {
      if (useEditorStore.getState().analyses[audio.id] !== undefined) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    setMusicFromAsset(audio.id);
  };

  const musicClip = findTrack(tracks, "music")?.clips[0];
  const musicAsset = musicClip ? media.find((m) => m.id === musicClip.assetId) : undefined;

  const hooks = captions.length > 0 ? detectHooks(analyzeTranscript(captions), 5) : [];
  const highlights = editRecipe?.highlights ?? [];

  const chooseWorkflow = (next: Workflow) => {
    invalidateGeneration();
    setWorkflow(next);
    setSourceRoles({});
    setDraftRecipe(null);
    setDraftOrder([]);
    setDraftContext(null);
  };

  const setSourceRole = (clipId: string, role: SourceRole) => {
    invalidateGeneration();
    setSourceRoles((current) => ({ ...current, [clipId]: role }));
    setDraftRecipe(null);
    setDraftOrder([]);
    setDraftContext(null);
  };

  const setModifierChoice = (patch: MontageModifiers) => {
    invalidateGeneration();
    setModifiers((current) => ({ ...current, ...patch }));
    setDraftRecipe(null);
    setDraftOrder([]);
    setDraftContext(null);
  };

  const toggleDraftMoment = (index: number) => {
    setDraftOrder((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  };

  const moveDraftMoment = (index: number, direction: -1 | 1) => {
    setDraftOrder((current) => {
      const position = current.indexOf(index);
      const target = position + direction;
      if (position < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[position], next[target]] = [next[target], next[position]];
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 [&>details]:shrink-0 [&>section]:shrink-0">
      <section className="autoedit-hero overflow-hidden rounded-lg bg-[var(--caption)]/[0.055] p-3.5 ring-1 ring-[var(--caption)]/20">
        <div className="flex items-center justify-between gap-3">
          <p className="panel-eyebrow text-[var(--caption)]">First cut</p>
          <span className="rounded-md bg-black/20 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#91a59f] ring-1 ring-white/[0.07]">
            reversible
          </span>
        </div>
        <h2 className="mt-2 text-[21px] font-semibold leading-tight tracking-[-0.04em] text-[#f1f6f4]">
          Build a tighter first pass.
        </h2>
        <p className="mt-1.5 text-[10px] leading-relaxed text-[#91a09f]">
          Tighten pauses, filler words, repetition, and sections with little action.
        </p>

        <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl bg-black/20 ring-1 ring-white/[0.07]">
          {["Caption", "Clean", "Structure"].map((step, index) => (
            <div
              key={step}
              className="flex min-w-0 items-center justify-center gap-1 border-r border-white/[0.06] px-1.5 py-2 text-[8px] font-semibold text-[#a8b7b3] last:border-r-0"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--caption)]/10 font-mono text-[8px] text-[var(--caption)] ring-1 ring-[var(--caption)]/20">
                {index === 0 && captionsReady ? <Check size={9} strokeWidth={3} /> : index + 1}
              </span>
              <span className="truncate">{step}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-center font-mono text-[8px] text-[#6f817c]">
          {!hasContent
            ? "Add a clip to the timeline to begin"
            : captionsReady
              ? `${captions.length} caption blocks ready`
              : "Captions are created on this device when needed"}
        </p>

        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-black/20 p-1 ring-1 ring-white/[0.07]">
          {([
            ["podcast", "Relaxed"],
            ["clean", "Balanced"],
            ["viral", "Tight"],
          ] as Array<[EditStyle, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                invalidateGeneration();
                setStyle(id);
              }}
              aria-pressed={style === id}
              className={`rounded-lg px-1.5 py-1.5 text-[9px] font-bold transition ${
                style === id
                  ? "bg-[var(--caption)] text-[#0b1714]"
                  : "text-[#788783] hover:bg-white/[0.06] hover:text-[#c8d4d0]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void runQuickAutoEdit(0)}
          disabled={disabled}
          data-testid="run-auto-edit"
          className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--caption)] px-4 text-[13px] font-extrabold text-[#0b1714] shadow-[0_12px_30px_rgba(120,217,197,.13)] transition hover:bg-[#a1eadb] active:translate-y-px disabled:opacity-35"
        >
          {busy === "quick-auto" || isTranscribing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0b1714]/20 border-t-[#0b1714]/80" />
              <span className="max-w-[240px] truncate">
                {captionProgress?.detail ?? stage ?? "Analyzing footage…"}
              </span>
            </>
          ) : (
            <>
              <Clapperboard size={17} /> Build first cut
            </>
          )}
        </button>
        <p className="mt-2 text-center text-[9px] leading-snug text-[#697975]">
          A restore point is saved first. Undo remains available.
        </p>
      </section>

      <div className="h-px shrink-0 bg-white/[0.07]" />

      <details className="group shrink-0 rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.08]">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-3 text-[11px] font-semibold text-zinc-300 marker:hidden">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-400/15">
            <Clapperboard size={14} />
          </span>
          <span>
            Advanced edit
            <span className="mt-0.5 block text-[9px] font-normal text-zinc-600">
              Montage, interviews, and beat-aware cuts
            </span>
          </span>
          <span className="ml-auto font-mono text-[9px] text-zinc-600 group-open:hidden">Open</span>
          <span className="ml-auto hidden font-mono text-[9px] text-zinc-600 group-open:inline">Close</span>
        </summary>
        <div className="space-y-4 border-t border-white/[0.07] p-3">
      <section>
        <SectionLabel>
          <Clapperboard size={11} /> Build an edit draft
        </SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <WorkflowButton
            active={workflow === "montage"}
            icon={<Layers3 size={14} />}
            title="Montage"
            description="Rank chosen action clips"
            tone="sky"
            onClick={() => chooseWorkflow("montage")}
          />
          <WorkflowButton
            active={workflow === "interview"}
            icon={<Mic2 size={14} />}
            title="Interview"
            description="Speaker + chosen B-roll"
            tone="amber"
            onClick={() => chooseWorkflow("interview")}
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          A draft is built first. Your timeline changes only after you review and apply it.
        </p>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <SectionLabel>
            <Film size={11} /> Source plan
          </SectionLabel>
          {selectedMainIds.size > 0 && (
            <span className="mb-1.5 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300 ring-1 ring-sky-400/20">
              {selectedMainIds.size} from timeline
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {mainTrack.clips.map((clip, index) => (
            <SourceRoleRow
              key={clip.id}
              clip={clip}
              index={index}
              asset={media.find((asset) => asset.id === clip.assetId)}
              workflow={workflow}
              role={roleOf(clip, index)}
              onRole={(role) => setSourceRole(clip.id, role)}
              onPreview={() => jumpTo(clip.startTime)}
            />
          ))}
        </div>
        {workflow === "interview" && (
          <p className="mt-1.5 rounded-lg bg-amber-500/8 px-2 py-1.5 text-[10px] leading-snug text-amber-200/75 ring-1 ring-amber-400/15">
            Interview audio carries the story. B-roll clips become visual cutaways over the selected answers.
          </p>
        )}
      </section>

      <section>
        <SectionLabel>{workflow === "montage" ? "Cut direction" : "Interview direction"}</SectionLabel>
        {workflow === "montage" ? (
          <div className="mb-2 grid grid-cols-2 gap-1">
            {(Object.keys(MONTAGE_PRESETS) as MontageStyle[])
              .filter((id) => id !== "interview")
              .map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    invalidateGeneration();
                    setMontageStyle(id);
                    setDraftRecipe(null);
                    setDraftContext(null);
                  }}
                  title={MONTAGE_PRESETS[id].description}
                  className={`rounded-lg px-2 py-1.5 text-left transition ${
                    montageStyle === id
                      ? "bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/60"
                      : "bg-white/5 text-zinc-400 ring-1 ring-white/8 hover:bg-white/8"
                  }`}
                >
                  <span className="block text-[10px] font-bold">{MONTAGE_PRESETS[id].name}</span>
                  <span className="mt-0.5 block line-clamp-1 text-[9px] text-zinc-500">
                    {MONTAGE_PRESETS[id].description}
                  </span>
                </button>
              ))}
          </div>
        ) : (
          <div className="mb-2 grid grid-cols-3 gap-1">
            <DirectionChoice label="Tight" active={modifiers.pace === 0.75} onClick={() => setModifierChoice({ pace: 0.75 })} />
            <DirectionChoice label="Balanced" active={modifiers.pace === 1 || modifiers.pace === undefined} onClick={() => setModifierChoice({ pace: 1 })} />
            <DirectionChoice label="Relaxed" active={modifiers.pace === 1.25} onClick={() => setModifierChoice({ pace: 1.25 })} />
          </div>
        )}

        <div className="mb-2 flex items-center gap-1">
          {[10, 15, 20, 30].map((sec) => (
            <button
              key={sec}
              onClick={() => {
                invalidateGeneration();
                setMontageLength(sec);
                setCustomLength("");
                setDraftRecipe(null);
                setDraftContext(null);
              }}
              className={`flex-1 rounded-lg px-1 py-1 text-[10px] font-semibold transition ${
                targetLength === sec && customLength === ""
                  ? "bg-white/12 text-white ring-1 ring-white/25"
                  : "bg-white/5 text-zinc-500 ring-1 ring-white/8 hover:bg-white/8"
              }`}
            >
              {sec}s
            </button>
          ))}
          <input
            type="number"
            min={8}
            max={60}
            value={customLength}
            onChange={(e) => {
              invalidateGeneration();
              setCustomLength(e.target.value);
              setDraftRecipe(null);
              setDraftContext(null);
            }}
            placeholder="s"
            title="Custom length (8–60s)"
            aria-label="Custom draft length"
            className={`w-11 rounded-lg border-0 bg-white/5 px-1.5 py-1 text-center text-[10px] font-semibold text-zinc-200 outline-none ring-1 transition [appearance:textfield] placeholder:text-zinc-600 focus:ring-sky-400 [&::-webkit-inner-spin-button]:appearance-none ${
              customLength !== "" ? "bg-sky-500/10 ring-sky-400" : "ring-white/8"
            }`}
          />
        </div>

        {workflow === "montage" && (
          <div className="mb-2 grid grid-cols-3 gap-1">
            <DirectionChoice label="Fast cuts" active={modifiers.pace === 0.7} onClick={() => setModifierChoice({ pace: 0.7 })} />
            <DirectionChoice label="Balanced" active={modifiers.pace === 1 || modifiers.pace === undefined} onClick={() => setModifierChoice({ pace: 1 })} />
            <DirectionChoice label="Calm" active={modifiers.pace === 1.25} onClick={() => setModifierChoice({ pace: 1.25 })} />
            <DirectionChoice label="Action" active={modifiers.favorKind === "action"} onClick={() => setModifierChoice({ favorKind: "action" })} />
            <DirectionChoice label="Mixed" active={modifiers.favorKind === undefined} onClick={() => setModifierChoice({ favorKind: undefined })} />
            <DirectionChoice label="Reactions" active={modifiers.favorKind === "reaction"} onClick={() => setModifierChoice({ favorKind: "reaction" })} />
          </div>
        )}

        <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.035] px-2 py-1.5 ring-1 ring-white/8">
          <span className="text-[10px] text-zinc-500">Effects</span>
          {[{ label: "Clean", value: 0.2 }, { label: "Natural", value: 0.6 }, { label: "Punchy", value: 1 }].map((choice) => (
            <button
              key={choice.label}
              onClick={() => setModifierChoice({ effectsLevel: choice.value })}
              className={`flex-1 rounded px-1 py-1 text-[9px] font-semibold transition ${
                (modifiers.effectsLevel ?? 1) === choice.value
                  ? "bg-fuchsia-500/20 text-fuchsia-200"
                  : "text-zinc-500 hover:bg-white/8 hover:text-zinc-300"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <label className="mb-2 flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.035] px-2 py-1.5 text-[10px] text-zinc-400 ring-1 ring-white/8">
          Add a closing call-to-action
          <input
            type="checkbox"
            checked={endCard}
            onChange={(e) => {
              invalidateGeneration();
              setEndCard(e.target.checked);
              setDraftRecipe(null);
              setDraftContext(null);
            }}
            className="h-3 w-3 accent-sky-400"
          />
        </label>

        <input
          ref={musicInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void onMusicPicked(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => musicInputRef.current?.click()}
          disabled={musicUploading !== null}
          className={`mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold ring-1 transition disabled:opacity-50 ${
            musicAsset
              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25 hover:bg-emerald-500/15"
              : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/8 hover:text-white"
          }`}
        >
          {musicUploading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Uploading {Math.round(musicUploading.progress * 100)}%…
            </>
          ) : musicAsset ? (
            <>
              <Music size={12} />
              <span className="max-w-[70%] truncate">{musicAsset.originalName}</span>
              <span className="text-emerald-500/70">· swap</span>
            </>
          ) : (
            <><Music size={12} /> Add music for beat-aware cuts</>
          )}
        </button>
        {musicAsset && <BeatControls musicAssetId={musicAsset.id} />}

        <button
          onClick={() => void runMontage(0)}
          disabled={disabled}
          data-testid="build-edit-draft"
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-[#071014] shadow-lg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40 ${
            workflow === "interview"
              ? "bg-gradient-to-r from-amber-300 to-orange-400 shadow-amber-500/15"
              : "bg-gradient-to-r from-sky-300 to-cyan-400 shadow-sky-500/15"
          }`}
        >
          {busy === "montage" ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" /> Building draft…</>
          ) : (
            <><Film size={16} /> Build draft from {workflow === "interview" ? speechSourceIds.length : includedSourceIds.length} selected clip{(workflow === "interview" ? speechSourceIds.length : includedSourceIds.length) === 1 ? "" : "s"}</>
          )}
        </button>
        {busy === "montage" && stage && (
          <p className="mt-1.5 text-center text-[10px] leading-snug text-sky-300/90">{stage}</p>
        )}
      </section>
        </div>
      </details>

      {draftRecipe && (
        <DraftReview
          recipe={draftRecipe}
          order={draftOrder}
          clips={mainTrack.clips}
          media={media}
          speechClipIds={new Set(speechSourceIds)}
          disabled={disabled}
          stale={draftIsStale}
          onPreview={jumpTo}
          onToggle={toggleDraftMoment}
          onMove={moveDraftMoment}
          onRegenerate={() => regenerate()}
          onApply={applyDraft}
        />
      )}

      {editRecipe && !draftRecipe && busy === null && (
        <div className="rounded-lg bg-emerald-500/8 px-2.5 py-2 text-[10px] leading-snug text-emerald-300/80 ring-1 ring-emerald-400/15">
          Applied: {editRecipe.reasoningSummary}
          <span className="mt-0.5 block text-emerald-500/60">Ctrl+Z restores the timeline before this edit.</span>
        </div>
      )}

      <details className="group rounded-xl bg-white/[0.025] ring-1 ring-white/8">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[11px] font-semibold text-zinc-300">
          <MessageSquareText size={13} className="text-fuchsia-300" />
          Talking-head draft
          <span className="ml-auto text-[9px] font-normal text-zinc-600 group-open:hidden">optional</span>
        </summary>
        <div className="border-t border-white/8 p-2.5">
          <div className="mb-2 grid grid-cols-4 gap-1">
            {EDIT_STYLES.map((es) => (
              <button
                key={es.id}
                onClick={() => {
                  invalidateGeneration();
                  setStyle(es.id);
                  setDraftRecipe(null);
                  setDraftContext(null);
                }}
                className={`rounded-lg px-1 py-1.5 text-[9px] font-semibold transition ${
                  style === es.id
                    ? "bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/60"
                    : "bg-white/5 text-zinc-500 ring-1 ring-white/8 hover:bg-white/8"
                }`}
              >
                {es.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => void runAutoEdit(0)}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-fuchsia-500/15 px-3 py-2 text-[11px] font-bold text-fuchsia-100 ring-1 ring-fuchsia-400/25 transition hover:bg-fuchsia-500/25 disabled:opacity-40"
          >
            {busy === "auto" || isTranscribing ? "Building draft…" : "Build talking-head draft"}
          </button>
          <p className="mt-1.5 text-[9px] leading-snug text-zinc-600">
            Proposes silence cuts, a hook and punch-zooms. You still review the moments before applying.
          </p>
        </div>
      </details>

      {/* detected highlights */}
      {highlights.length > 0 && (
        <section>
          <SectionLabel>
            <Flame size={11} /> Detected highlights
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {highlights.map((h, i) => (
              <button
                key={i}
                onClick={() => jumpTo(Math.max(0, h.time - 1))}
                className="flex items-center gap-1.5 rounded-lg bg-white/4 p-2 text-left ring-1 ring-white/8 transition hover:bg-white/7"
                title="Jump to this moment"
              >
                <HighlightIcon kind={h.kind} />
                <span className="font-mono text-[9px] text-amber-300">{h.time.toFixed(1)}s</span>
                <span className="min-w-0 flex-1 truncate text-[10px] leading-snug text-zinc-300">{h.label}</span>
                <span className="rounded bg-amber-500/15 px-1 font-mono text-[9px] text-amber-300">
                  {h.score.toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* hooks */}
      <section>
        <SectionLabel>
          <Crosshair size={11} /> Opening hooks
        </SectionLabel>
        {hooks.length === 0 ? (
          <p className="rounded-lg bg-white/3 px-2.5 py-2 text-[11px] leading-snug text-zinc-600 ring-1 ring-white/5">
            Create captions to rank spoken openings. Without speech, First cut uses the
            strongest visual moment.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {hooks.map((hook, i) => (
              <div key={i} className="group rounded-lg bg-white/4 p-2 ring-1 ring-white/8 transition hover:bg-white/7">
                <p className="text-[11px] font-medium leading-snug text-zinc-200">“{hook.text}”</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="rounded bg-fuchsia-500/15 px-1 font-mono text-[9px] text-fuchsia-300">
                    {hook.score.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">{hook.reasons.join(" · ")}</span>
                  <button
                    onClick={() => applyHookAsOpener(hook)}
                    disabled={disabled}
                    className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300 opacity-0 transition hover:bg-violet-500/40 group-hover:opacity-100 disabled:opacity-0"
                  >
                    Use as opening hook
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* smart cuts */}
      <section>
        <SectionLabel>
          <Scissors size={11} /> Suggested cuts
        </SectionLabel>
        <div className="mb-1.5 grid grid-cols-3 gap-1">
          {(["light", "medium", "aggressive"] as const).map((level) => (
            <SmallAction
              key={level}
              onClick={() => void runRemoveSilence(level)}
              disabled={disabled}
              busy={busy === `silence-${level}`}
            >
              {level === "light" ? "Silence −" : level === "medium" ? "Silence −−" : "Silence −−−"}
            </SmallAction>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <SmallAction onClick={() => void runTrimDeadSpace()} disabled={disabled} busy={busy === "dead-space"} wide>
            <Activity size={12} /> Trim dead space (no motion, no sound)
          </SmallAction>
          <SmallAction onClick={() => void runRemoveFillers()} disabled={disabled} busy={busy === "fillers"} wide>
            <Zap size={12} /> Remove filler words (um, uh, like…)
          </SmallAction>
        </div>
      </section>

      {/* best moments */}
      <section>
        <SectionLabel>
          <Crosshair size={11} /> Best moments
        </SectionLabel>
        <div className="grid grid-cols-3 gap-1">
          {[30, 45, 60].map((sec) => (
            <SmallAction
              key={sec}
              onClick={() => void runBestSeconds(sec)}
              disabled={disabled || duration <= sec}
              busy={busy === `best-${sec}`}
            >
              <Clapperboard size={12} /> {sec}s
            </SmallAction>
          ))}
        </div>
        <p className="mt-1 text-center text-[10px] text-zinc-600">
          Keeps the highest-scoring stretch (speech + action + energy).
        </p>
      </section>

      {/* b-roll suggestions */}
      {editRecipe && editRecipe.brollSuggestions.length > 0 && (
        <section>
          <SectionLabel>
            <Film size={11} /> B-roll suggestions
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {editRecipe.brollSuggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => jumpTo(s.time)}
                className="rounded-lg bg-white/4 p-2 text-left ring-1 ring-white/8 transition hover:bg-white/7"
                title="Jump to this moment, then add a b-roll clip from the media panel"
              >
                <span className="font-mono text-[9px] text-sky-300">{s.time.toFixed(1)}s</span>
                <span className="ml-1.5 text-[11px] font-medium text-zinc-200">“{s.keyword}”</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{s.reason}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function WorkflowButton({
  active,
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "sky" | "amber";
  onClick: () => void;
}) {
  const activeClass =
    tone === "sky"
      ? "bg-sky-500/15 text-sky-100 ring-sky-400/70"
      : "bg-amber-500/15 text-amber-100 ring-amber-400/70";
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-2.5 py-2 text-left ring-1 transition ${
        active ? activeClass : "bg-white/4 text-zinc-400 ring-white/8 hover:bg-white/8"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-bold">
        {icon} {title}
      </span>
      <span className="mt-0.5 block text-[9px] leading-snug text-zinc-500">{description}</span>
    </button>
  );
}

function SourceRoleRow({
  clip,
  index,
  asset,
  workflow,
  role,
  onRole,
  onPreview,
}: {
  clip: TimelineClip;
  index: number;
  asset?: MediaAsset;
  workflow: Workflow;
  role: SourceRole;
  onRole: (role: SourceRole) => void;
  onPreview: () => void;
}) {
  const excluded = role === "exclude";
  const roleChoices: Array<{ role: SourceRole; label: string; activeClass: string }> =
    workflow === "montage"
      ? [
          { role: "include", label: "Use", activeClass: "bg-sky-500/25 text-sky-100" },
          { role: "exclude", label: "Skip", activeClass: "bg-rose-500/20 text-rose-200" },
        ]
      : [
          { role: "a-roll", label: "Interview", activeClass: "bg-amber-500/25 text-amber-100" },
          { role: "b-roll", label: "B-roll", activeClass: "bg-sky-500/25 text-sky-100" },
          { role: "exclude", label: "Skip", activeClass: "bg-rose-500/20 text-rose-200" },
        ];

  return (
    <div
      className={`rounded-lg bg-white/[0.035] p-1.5 ring-1 transition ${
        excluded ? "opacity-55 ring-white/5" : "ring-white/9"
      }`}
      data-testid={`source-role-${clip.id}`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onPreview}
          className="h-9 w-12 shrink-0 overflow-hidden rounded-md bg-black/60 ring-1 ring-white/10"
          title={`Preview ${asset?.originalName ?? `clip ${index + 1}`}`}
        >
          {asset ? (
            <span
              className="block h-full w-full bg-cover bg-center"
              style={{
                backgroundImage: `url(${filmstripUrl(asset)})`,
                backgroundSize: "2000% 100%",
                backgroundPosition: `${(100 * 10) / 19}% 0%`,
              }}
            />
          ) : (
            <Film size={13} className="mx-auto text-zinc-600" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold text-zinc-200">
            <span className="mr-1 font-mono text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
            {asset?.originalName ?? "Missing source"}
          </p>
          <p className="mt-0.5 font-mono text-[8px] text-zinc-600">
            {formatDraftTime(clip.startTime)}–{formatDraftTime(clip.endTime)} · {(clip.endTime - clip.startTime).toFixed(1)}s
          </p>
        </div>
      </div>
      <div className={`mt-1 grid gap-1 ${workflow === "montage" ? "grid-cols-2" : "grid-cols-3"}`}>
        {roleChoices.map((choice) => (
          <button
            key={choice.role}
            onClick={() => onRole(choice.role)}
            aria-pressed={role === choice.role}
            className={`rounded px-1 py-1 text-[9px] font-semibold transition ${
              role === choice.role
                ? choice.activeClass
                : "bg-white/4 text-zinc-600 hover:bg-white/8 hover:text-zinc-300"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DirectionChoice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-1 py-1.5 text-[9px] font-semibold transition ${
        active
          ? "bg-white/12 text-white ring-1 ring-white/20"
          : "bg-white/4 text-zinc-600 ring-1 ring-white/7 hover:bg-white/8 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function DraftReview({
  recipe,
  order,
  clips,
  media,
  speechClipIds,
  disabled,
  stale,
  onPreview,
  onToggle,
  onMove,
  onRegenerate,
  onApply,
}: {
  recipe: EditRecipe;
  order: number[];
  clips: TimelineClip[];
  media: MediaAsset[];
  speechClipIds: Set<string>;
  disabled: boolean;
  stale: boolean;
  onPreview: (time: number) => void;
  onToggle: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRegenerate: () => void;
  onApply: () => void;
}) {
  const rejected = recipe.keptRanges
    .map((_, index) => index)
    .filter((index) => !order.includes(index));
  const displayOrder = [...order, ...rejected];
  const totalDuration = order.reduce((sum, index) => {
    const range = recipe.keptRanges[index];
    return sum + (range.end - range.start) / (recipe.rangeSpeeds?.[index] ?? 1);
  }, 0);

  const sourceFor = (range: TimeRange) => {
    const midpoint = (range.start + range.end) / 2;
    const clip = clips.find((item) => midpoint >= item.startTime && midpoint <= item.endTime);
    const asset = clip ? media.find((item) => item.id === clip.assetId) : undefined;
    return { clip, asset };
  };

  return (
    <section className="rounded-xl bg-sky-500/[0.055] p-2.5 ring-1 ring-sky-400/20" data-testid="edit-draft-review">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-sky-100">
            <Check size={12} /> Draft ready for review
          </p>
          <p className="mt-0.5 text-[9px] leading-snug text-sky-200/55">
            Keep, reject, preview or reorder each suggested moment.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sky-400/10 px-1.5 py-0.5 font-mono text-[9px] text-sky-200">
          {order.length} · {Math.round(totalDuration)}s
        </span>
      </div>

      <div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-black/30 p-px" aria-hidden>
        {order.map((index) => {
          const range = recipe.keptRanges[index];
          const duration = (range.end - range.start) / (recipe.rangeSpeeds?.[index] ?? 1);
          const { clip } = sourceFor(range);
          const speech = clip ? speechClipIds.has(clip.id) : false;
          return (
            <span
              key={index}
              className={speech ? "bg-amber-300" : "bg-sky-300"}
              style={{ flex: Math.max(0.2, duration) }}
            />
          );
        })}
      </div>

      <div className="mt-2 flex flex-col gap-1">
        {displayOrder.map((index) => {
          const range = recipe.keptRanges[index];
          const selected = order.includes(index);
          const position = order.indexOf(index);
          const { clip, asset } = sourceFor(range);
          const speech = clip ? speechClipIds.has(clip.id) : false;
          const duration = (range.end - range.start) / (recipe.rangeSpeeds?.[index] ?? 1);
          return (
            <div
              key={index}
              className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 ring-1 transition ${
                selected
                  ? "bg-black/20 text-zinc-200 ring-white/10"
                  : "bg-black/10 text-zinc-600 ring-white/5 opacity-60"
              }`}
            >
              <button
                onClick={() => onToggle(index)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                  selected ? "bg-sky-400 text-sky-950" : "bg-white/7 text-zinc-500"
                }`}
                title={selected ? "Reject this moment" : "Keep this moment"}
              >
                {selected ? <Check size={11} /> : <X size={11} />}
              </button>
              <button onClick={() => onPreview(range.start)} className="min-w-0 flex-1 text-left" title="Preview source moment">
                <span className="flex items-center gap-1 text-[9px] font-semibold">
                  <span className={speech ? "text-amber-300" : "text-sky-300"}>
                    {speech ? "INTERVIEW" : "MOMENT"}
                  </span>
                  <span className="truncate text-zinc-300">{asset?.originalName ?? "Source clip"}</span>
                </span>
                <span className="mt-0.5 block font-mono text-[8px] text-zinc-600">
                  {formatDraftTime(range.start)} · {duration.toFixed(1)}s
                  {recipe.rangeSpeeds?.[index] ? ` · ${recipe.rangeSpeeds[index]}×` : ""}
                </span>
              </button>
              {selected && (
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={() => onMove(index, -1)}
                    disabled={position <= 0}
                    className="rounded p-1 text-zinc-500 hover:bg-white/8 hover:text-white disabled:opacity-20"
                    title="Move earlier"
                  >
                    <ArrowUp size={10} />
                  </button>
                  <button
                    onClick={() => onMove(index, 1)}
                    disabled={position >= order.length - 1}
                    className="rounded p-1 text-zinc-500 hover:bg-white/8 hover:text-white disabled:opacity-20"
                    title="Move later"
                  >
                    <ArrowDown size={10} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[9px] leading-snug text-sky-100/50">{recipe.reasoningSummary}</p>
      {stale && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[9px] leading-snug text-amber-200 ring-1 ring-amber-400/20">
          The timeline or source plan changed after this draft was built. Generate a new take before applying it.
        </p>
      )}
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-1.5">
        <button
          onClick={onRegenerate}
          disabled={disabled}
          className="flex items-center justify-center gap-1 rounded-lg bg-white/5 px-2 py-2 text-[10px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/9 disabled:opacity-30"
          title="Generate a different draft from the same sources"
        >
          <RefreshCw size={11} /> New take
        </button>
        <button
          onClick={onApply}
          disabled={disabled || order.length === 0 || stale}
          data-testid="apply-edit-draft"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-300 px-3 py-2 text-[11px] font-black text-sky-950 transition hover:bg-sky-200 active:scale-[0.98] disabled:opacity-35"
        >
          <Check size={13} /> Apply {order.length} moment{order.length === 1 ? "" : "s"} to timeline
        </button>
      </div>
    </section>
  );
}

function storeGenerationSignature(): string {
  const state = useEditorStore.getState();
  const main = mainVideoTrack(state.tracks);
  const music = findTrack(state.tracks, "music");
  return JSON.stringify({
    projectId: state.projectId,
    selectedClipIds: state.selectedClipIds,
    main: main.clips.map((clip) => [
      clip.id,
      clip.assetId,
      clip.startTime,
      clip.endTime,
      clip.sourceStart,
      clip.sourceEnd,
      clip.speed ?? 1,
    ]),
    music: music?.clips.map((clip) => [
      clip.id,
      clip.assetId,
      clip.startTime,
      clip.endTime,
      clip.sourceStart,
      clip.sourceEnd,
    ]),
    beat: state.beat,
    sourceAudio: main.clips.map((clip) => {
      const asset = state.media.find((candidate) => candidate.id === clip.assetId);
      return [
        clip.assetId,
        asset?.hasAudio ?? false,
        asset?.linkedAudio?.audioAssetId ?? null,
        asset?.linkedAudio?.offsetSeconds ?? null,
        asset?.linkedAudio?.muteCameraAudio ?? null,
      ];
    }),
  });
}

function sourceHasAudio(asset: MediaAsset | undefined, media: MediaAsset[]): boolean {
  if (!asset) return false;
  if (asset.hasAudio) return true;
  const linkedId = asset.linkedAudio?.audioAssetId;
  return Boolean(linkedId && media.find((candidate) => candidate.id === linkedId)?.hasAudio);
}

function filterCaptionsForClips(
  captions: Caption[],
  clips: TimelineClip[],
  includedIds: Set<string>
): Caption[] {
  return captions.filter((caption) => {
    const midpoint = (caption.startTime + caption.endTime) / 2;
    return clips.some(
      (clip) =>
        includedIds.has(clip.id) && midpoint >= clip.startTime - 0.001 && midpoint <= clip.endTime + 0.001
    );
  });
}

function formatDraftTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const rest = Math.max(0, seconds) - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/* ---------------------------------------------------------------- */

/**
 * Beat sync status + controls for the current soundtrack: detected BPM with
 * confidence (never a silent failure), a manual BPM override, tap tempo, and
 * an on/off switch. Beat markers on the timeline ruler follow these settings.
 */
function BeatControls({ musicAssetId }: { musicAssetId: string }) {
  const tracks = useEditorStore((s) => s.tracks);
  const analyses = useEditorStore((s) => s.analyses);
  const beat = useEditorStore((s) => s.beat);
  const setBeatSettings = useEditorStore((s) => s.setBeatSettings);
  /** Timestamps of the last few taps for tap-tempo. */
  const tapsRef = useRef<number[]>([]);

  const audio = analyses[musicAssetId]?.audio;
  const analyzing = analyses[musicAssetId] === undefined;
  const confidence = musicBeatConfidence(tracks, analyses);
  const detectedBpm = audio?.bpm ?? null;
  const enabled = beat.beatSyncEnabled !== false;

  const status = analyzing
    ? { label: "Analyzing beat…", tone: "text-zinc-400" }
    : beat.bpmOverride
      ? { label: `Manual ${beat.bpmOverride} BPM`, tone: "text-sky-300" }
      : detectedBpm
        ? {
            label: `${detectedBpm} BPM · ${confidence >= 0.5 ? "solid" : "rough"} grid (${Math.round(confidence * 100)}%)`,
            tone: confidence >= 0.5 ? "text-emerald-300" : "text-amber-300",
          }
        : { label: "No clear tempo — cuts use the song's energy hits", tone: "text-amber-300" };

  const onTap = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 3000);
    taps.push(now);
    tapsRef.current = taps;
    if (taps.length >= 3) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 40 && bpm <= 220) setBeatSettings({ bpmOverride: bpm });
    }
  };

  return (
    <div className="mb-2 rounded-lg bg-white/4 p-2 ring-1 ring-white/8">
      <div className="flex items-center justify-between gap-2">
        <span className={`min-w-0 flex-1 truncate text-[10px] font-medium ${status.tone}`}>
          ♪ {status.label}
        </span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-zinc-400" title="Off = First cut ignores the beat grid">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setBeatSettings({ beatSyncEnabled: e.target.checked })}
            className="h-3 w-3 accent-emerald-400"
          />
          Beat sync
        </label>
      </div>
      {enabled && (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            type="number"
            min={40}
            max={220}
            value={beat.bpmOverride ?? ""}
            placeholder={detectedBpm ? `auto (${detectedBpm})` : "BPM"}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setBeatSettings({ bpmOverride: Number.isFinite(v) && v >= 40 && v <= 220 ? v : null });
            }}
            title="Manual BPM — overrides the detected tempo"
            className="w-20 rounded-lg border-0 bg-white/5 px-2 py-1 text-[10px] font-semibold text-zinc-200 outline-none ring-1 ring-white/10 transition [appearance:textfield] placeholder:text-zinc-600 focus:ring-emerald-400 [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={onTap}
            className="rounded-lg bg-white/5 px-2 py-1 text-[10px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 active:bg-emerald-500/25"
            title="Tap along with the song — 3+ taps set the BPM"
          >
            Tap tempo
          </button>
          {beat.bpmOverride && (
            <button
              onClick={() => setBeatSettings({ bpmOverride: null })}
              className="rounded-lg px-2 py-1 text-[10px] font-medium text-zinc-500 transition hover:bg-white/10 hover:text-zinc-300"
              title="Back to the detected tempo"
            >
              Use detected
            </button>
          )}
          <span className="ml-auto text-[9px] text-zinc-600" title="Beat ticks show under the timeline ruler; drags snap onto them">
            ticks on ruler
          </span>
        </div>
      )}
    </div>
  );
}

function HighlightIcon({ kind }: { kind: HighlightMoment["kind"] }) {
  if (kind === "action") return <Zap size={11} className="shrink-0 text-amber-300" />;
  if (kind === "reaction") return <Flame size={11} className="shrink-0 text-orange-300" />;
  if (kind === "speech") return <MessageSquareText size={11} className="shrink-0 text-sky-300" />;
  return <Film size={11} className="shrink-0 text-zinc-400" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  );
}

function SmallAction({
  children,
  onClick,
  disabled,
  busy,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-medium text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-30 ${
        wide ? "w-full" : ""
      }`}
    >
      {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : children}
    </button>
  );
}
