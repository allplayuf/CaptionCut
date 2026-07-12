"use client";

import { useRef, useState } from "react";
import type {
  Caption,
  EditStyle,
  HighlightMoment,
  MontageModifiers,
  MontageStyle,
  TimeRange,
  TimelineSignals,
} from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useTranscription } from "@/hooks/useTranscription";
import { assetKind, findTrack, invertRanges, mainClips, tracksDuration } from "@/lib/timeline/tracks";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { detectSilence, type SilenceAggressiveness } from "@/lib/autoEdit/detectSilence";
import { fillerCutRanges } from "@/lib/autoEdit/detectFillerWords";
import { detectHooks } from "@/lib/autoEdit/detectHooks";
import { detectDeadSpace } from "@/lib/autoEdit/detectHighlights";
import { findBestWindow } from "@/lib/autoEdit/scoreMoments";
import { generateEditRecipe } from "@/lib/autoEdit/generateEditRecipe";
import { MONTAGE_PRESETS, generateMontageRecipe } from "@/lib/autoEdit/montage";
import { buildTimelineSignals, fetchAnalyses } from "@/lib/autoEdit/signals";
import {
  Activity,
  Clapperboard,
  Crosshair,
  Film,
  Flame,
  MessageSquareText,
  Music,
  RefreshCw,
  Scissors,
  Sparkles,
  Trophy,
  Wand2,
  Zap,
} from "lucide-react";

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
  // Regenerate = undo + re-run; only safe while the auto edit is the latest change.
  const canRegenerate = useEditorStore(
    (s) => s.editRecipe !== null && s.past.length > 0 && s.revision === s.editRecipeRevision
  );

  const { runTranscription } = useTranscription();
  const { uploading: musicUploading, handleFiles: uploadFiles } = useMediaUpload();
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<EditStyle>("viral");
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

  const duration = tracksDuration(tracks);
  const hasContent = duration > 0.5;
  const disabled = !hasContent || isTranscribing || busy !== null;

  /* ---------------- shared input gathering ---------------- */

  /** Fetch (cached) local media analysis and stitch timeline signals.
      The cache lives in the store so the preview's smart crop shares it. */
  const getSignals = async (): Promise<TimelineSignals | null> => {
    const s = useEditorStore.getState();
    const missing = s.media.filter((m) => !(m.id in s.analyses));
    if (missing.length > 0) {
      setStage(`Watching your footage — motion, energy & beats (${missing.length} clip${missing.length > 1 ? "s" : ""})…`);
      try {
        const fresh = await fetchAnalyses(missing);
        s.mergeAnalyses(fresh);
      } catch {
        // Analysis is an enhancement, never a blocker.
        s.mergeAnalyses(Object.fromEntries(missing.map((m) => [m.id, null])));
        useEditorStore.getState().addToast("info", "Footage analysis unavailable — using transcript only.");
      }
    }
    try {
      const latest = useEditorStore.getState();
      return buildTimelineSignals(latest.tracks, latest.media, latest.analyses);
    } catch {
      return null;
    }
  };

  /**
   * Captions are the transcript. `mode`:
   *  - "try": transcribe when missing but tolerate failure (footage-only edit)
   *  - "require": no captions = stop
   */
  const getCaptions = async (mode: "try" | "require"): Promise<Caption[]> => {
    const s = useEditorStore.getState();
    if (s.captions.length > 0) return s.captions;
    const anyAudio = s.media.some((m) => m.hasAudio);
    if (!anyAudio) {
      if (mode === "require") s.addToast("info", "This footage has no audio to transcribe.");
      return [];
    }
    setStage("Transcribing speech (free, local)…");
    const fresh = await runTranscription();
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
        .addToast("error", err instanceof Error ? err.message : "Something went wrong.");
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

  /** The football-montage engine: rank raw clips, keep the best moments,
      assemble hook → action → reaction → ender. */
  const runMontage = (nextSeed = 0, mods: MontageModifiers = modifiers) =>
    withBusy("montage", async () => {
      const signals = await getSignals();
      // Interview preset needs speech; the others use captions only if present.
      const caps =
        montageStyle === "interview" ? await getCaptions("try") : useEditorStore.getState().captions;
      if (montageStyle === "interview" && caps.length === 0) {
        useEditorStore
          .getState()
          .addToast("info", "No speech found — building a pure action montage instead.");
      }
      setStage("Ranking moments & building the montage…");
      const s = useEditorStore.getState();
      const recipe = generateMontageRecipe({
        projectId: s.projectId,
        preset: montageStyle,
        targetDuration: targetLength,
        signals,
        transcript: analyzeTranscript(caps),
        captions: caps,
        clips: mainClips(s.tracks),
        analyses: s.analyses,
        duration: tracksDuration(s.tracks),
        endCard,
        seed: nextSeed,
        modifiers: mods,
      });
      s.applyEditRecipe(recipe);
      setSeed(nextSeed);
      setLastEngine("montage");
    });

  const runAutoEdit = (nextSeed = 0) =>
    withBusy("auto", async () => {
      const signals = await getSignals();
      const caps = await getCaptions("try");
      if (caps.length === 0 && !signals) {
        useEditorStore
          .getState()
          .addToast("error", "Nothing to work with — no transcript and footage analysis failed.");
        return;
      }
      if (caps.length === 0 && signals) {
        useEditorStore
          .getState()
          .addToast("info", "No speech found — editing from motion, energy & scene analysis.");
      }
      setStage("Building the edit — cuts, hook, zooms…");
      const s = useEditorStore.getState();
      const recipe = generateEditRecipe({
        projectId: s.projectId,
        transcript: analyzeTranscript(caps),
        captions: caps,
        peaks: signals ? null : timelinePeaks(),
        signals,
        duration: tracksDuration(s.tracks),
        style,
        seed: nextSeed,
      });
      s.applyEditRecipe(recipe);
      setSeed(nextSeed);
      setLastEngine("auto");
    });

  /** Undo the last auto edit and cut a meaningfully different take of it. */
  const regenerate = (mods: MontageModifiers = modifiers) => {
    if (!canRegenerate) return;
    useEditorStore.getState().undo();
    if (lastEngine === "montage") void runMontage(seed + 1, mods);
    else void runAutoEdit(seed + 1);
  };

  /** Toggle a one-tap adjustment and immediately recut with it. */
  const toggleModifier = (patch: MontageModifiers, active: boolean) => {
    const next: MontageModifiers = { ...modifiers };
    if (active) {
      for (const key of Object.keys(patch) as (keyof MontageModifiers)[]) delete next[key];
    } else {
      Object.assign(next, patch);
    }
    setModifiers(next);
    regenerate(next);
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
        { transcript: analyzeTranscript(caps), peaks: signals ? null : timelinePeaks(), signals, duration: dur },
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
      const caps = await getCaptions("require");
      if (caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const silences = detectSilence(
        { transcript: analyzeTranscript(caps), peaks: timelinePeaks(), duration: dur },
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
        s.addToast("info", "No dead space found — the footage stays busy. 🎬");
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
        s.addToast("info", "No filler words found — clean take! 👌");
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
    s.applyRearrange(kept, "Hook moved to the front 🎣");
  };

  const jumpTo = (time: number) => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().setCurrentTime(time);
  };

  /** Upload an audio file and set it straight as the soundtrack. */
  const onMusicPicked = async (files: FileList) => {
    const uploaded = await uploadFiles(files, { silentAudioTip: true });
    const audio = uploaded.find((a) => assetKind(a) === "audio");
    if (audio) setMusicFromAsset(audio.id);
    else if (uploaded.length > 0) {
      useEditorStore.getState().addToast("error", "That file has no audio — pick an mp3/wav/m4a.");
    }
  };

  const musicClip = findTrack(tracks, "music")?.clips[0];
  const musicAsset = musicClip ? media.find((m) => m.id === musicClip.assetId) : undefined;

  const hooks = captions.length > 0 ? detectHooks(analyzeTranscript(captions), 5) : [];
  const highlights = editRecipe?.highlights ?? [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* football montage */}
      <section>
        <SectionLabel>
          <Trophy size={11} /> Football Montage
        </SectionLabel>
        <div className="mb-2 grid grid-cols-3 gap-1">
          {(Object.keys(MONTAGE_PRESETS) as MontageStyle[]).map((id) => (
            <button
              key={id}
              onClick={() => setMontageStyle(id)}
              title={MONTAGE_PRESETS[id].description}
              className={`rounded-lg px-1 py-1.5 text-[10px] font-semibold transition ${
                montageStyle === id
                  ? "bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400"
                  : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              {MONTAGE_PRESETS[id].name}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-1">
          {[10, 15, 20, 30].map((sec) => (
            <button
              key={sec}
              onClick={() => {
                setMontageLength(sec);
                setCustomLength("");
              }}
              className={`flex-1 rounded-lg px-1 py-1 text-[10px] font-semibold transition ${
                targetLength === sec && customLength === ""
                  ? "bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400"
                  : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              ~{sec}s
            </button>
          ))}
          <input
            type="number"
            min={8}
            max={60}
            value={customLength}
            onChange={(e) => setCustomLength(e.target.value)}
            placeholder="s"
            title="Custom length (8–60s)"
            className={`w-11 rounded-lg border-0 bg-white/5 px-1.5 py-1 text-center text-[10px] font-semibold text-zinc-200 outline-none ring-1 transition [appearance:textfield] placeholder:text-zinc-600 focus:ring-emerald-400 [&::-webkit-inner-spin-button]:appearance-none ${
              customLength !== "" ? "ring-emerald-400 bg-emerald-500/15" : "ring-white/10"
            }`}
          />
          <label className="ml-1 flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={endCard}
              onChange={(e) => setEndCard(e.target.checked)}
              className="h-3 w-3 accent-emerald-400"
            />
            End card
          </label>
        </div>
        {/* soundtrack: one click from file picker to beat-locked cuts */}
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
              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30 hover:bg-emerald-500/20"
              : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 hover:text-white"
          }`}
          title={
            musicAsset
              ? "Swap the soundtrack (replaces the music track)"
              : "Upload a song — it lands on the Music track and montage cuts lock to its beat"
          }
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
              <span className="text-emerald-500/80">· swap</span>
            </>
          ) : (
            <>
              <Music size={12} /> Add music — cuts sync to the beat
            </>
          )}
        </button>
        <button
          onClick={() => void runMontage(0)}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {busy === "montage" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Working…
            </>
          ) : (
            <>
              <Trophy size={16} />
              Create montage
            </>
          )}
        </button>
        {busy === "montage" && stage ? (
          <p className="mt-1.5 text-center text-[10px] leading-snug text-emerald-300/90">{stage}</p>
        ) : (
          <p className="mt-1.5 text-center text-[10px] leading-snug text-zinc-600">
            Ranks every clip, keeps goals · celebrations · reactions, cuts the
            rest into a tight {targetLength}s edit. All local, no API.
          </p>
        )}
      </section>

      {/* result + regenerate (shared by both engines) */}
      {editRecipe && busy === null && (
        <section>
          <div className="rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-snug text-emerald-300 ring-1 ring-emerald-400/20">
            {editRecipe.reasoningSummary}
            <span className="mt-0.5 block text-emerald-500/70">Not happy? Ctrl+Z undoes the whole edit.</span>
          </div>
          {canRegenerate && (
            <>
              <button
                onClick={() => regenerate()}
                disabled={disabled}
                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <RefreshCw size={12} /> Regenerate — cut a different take
              </button>
              {lastEngine === "montage" && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <ModChip
                    label="⚡ Faster"
                    active={modifiers.pace !== undefined && modifiers.pace < 1}
                    disabled={disabled}
                    onToggle={(a) => toggleModifier({ pace: 0.7 }, a)}
                  />
                  <ModChip
                    label="⚽ More goals"
                    active={modifiers.favorKind === "action"}
                    disabled={disabled}
                    onToggle={(a) => toggleModifier({ favorKind: "action" }, a)}
                  />
                  <ModChip
                    label="🎉 More reactions"
                    active={modifiers.favorKind === "reaction"}
                    disabled={disabled}
                    onToggle={(a) => toggleModifier({ favorKind: "reaction" }, a)}
                  />
                  <ModChip
                    label="✨ Less effects"
                    active={modifiers.effectsLevel !== undefined && modifiers.effectsLevel < 1}
                    disabled={disabled}
                    onToggle={(a) => toggleModifier({ effectsLevel: 0.35 }, a)}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* auto edit */}
      <section>
        <SectionLabel>Auto Edit (talky videos)</SectionLabel>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {EDIT_STYLES.map((es) => (
            <button
              key={es.id}
              onClick={() => setStyle(es.id)}
              className={`rounded-lg px-1 py-1.5 text-[10px] font-semibold transition ${
                style === es.id
                  ? "bg-violet-500/30 text-violet-200 ring-1 ring-violet-400"
                  : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              {es.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => void runAutoEdit(0)}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {busy === "auto" || isTranscribing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Working…
            </>
          ) : (
            <>
              <Wand2 size={16} />
              Auto Edit
            </>
          )}
        </button>
        {busy === "auto" && stage ? (
          <p className="mt-1.5 text-center text-[10px] leading-snug text-fuchsia-300/90">{stage}</p>
        ) : (
          <p className="mt-1.5 text-center text-[10px] leading-snug text-zinc-600">
            Finds highlights, cuts dead space & fillers, adds hook + punch-zooms.
            Works even without speech — all local, no API.
          </p>
        )}
      </section>

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
            Run Auto Captions first — hook detection reads the transcript.
            (No speech? Auto Edit opens on the biggest detected moment instead.)
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
          <Scissors size={11} /> Smart cuts
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
            <Zap size={12} /> Remove filler words (um, uh, typ, asså…)
          </SmallAction>
        </div>
      </section>

      {/* best moments */}
      <section>
        <SectionLabel>
          <Sparkles size={11} /> Best moments
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

function HighlightIcon({ kind }: { kind: HighlightMoment["kind"] }) {
  if (kind === "action") return <Zap size={11} className="shrink-0 text-amber-300" />;
  if (kind === "reaction") return <Flame size={11} className="shrink-0 text-orange-300" />;
  if (kind === "speech") return <MessageSquareText size={11} className="shrink-0 text-sky-300" />;
  return <Film size={11} className="shrink-0 text-zinc-400" />;
}

/** Toggleable one-tap regenerate adjustment. */
function ModChip({
  label,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onToggle: (wasActive: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(active)}
      disabled={disabled}
      className={`rounded-full px-2 py-1 text-[10px] font-semibold ring-1 transition disabled:opacity-30 ${
        active
          ? "bg-emerald-500/25 text-emerald-200 ring-emerald-400"
          : "bg-white/5 text-zinc-400 ring-white/10 hover:bg-white/10 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
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
