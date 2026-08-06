"use client";

import { useCallback, useRef, useState } from "react";
import type {
  EditRecipe,
  MontageModifiers,
  MontageStyle,
  TimelineSignals,
  Track,
} from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { generateMontageRecipe } from "@/lib/autoEdit/montage";
import {
  buildTimelineSignals,
  fetchAnalyses,
  findBestMusicStart,
} from "@/lib/autoEdit/signals";
import {
  assetKind,
  findTrack,
  mainClips,
  mainVideoTrack,
  tracksDuration,
} from "@/lib/timeline/tracks";

/**
 * The whole "clips in, montage out" pipeline in one call.
 *
 * The montage engine itself (lib/autoEdit/montage.ts) was only ever reachable
 * through the multi-step First cut panel. This hook is the headless version of
 * that flow — warm the analysis cache, choose the song section, build the beat
 * grid, rank the moments, apply the recipe — so a single button can run it and
 * the panel can share the exact same code path.
 */

export interface MontageOptions {
  preset: MontageStyle;
  /** Target output length in seconds; 12–30 is the sweet spot. */
  targetDuration: number;
  endCard: boolean;
  /** Bump to cut a genuinely different take from the same footage. */
  seed: number;
  modifiers: MontageModifiers;
  /** Restrict to these main-track clip ids; omit to use every clip. */
  includedClipIds?: string[];
}

export const DEFAULT_MONTAGE_OPTIONS: MontageOptions = {
  preset: "hype",
  targetDuration: 20,
  endCard: true,
  seed: 0,
  modifiers: {},
};

/**
 * Warm the local FFmpeg analysis cache for every asset the montage will read
 * (main video, music, and any linked recorder audio). Analysis is an
 * enhancement — a failure downgrades the montage, it never blocks it.
 */
async function ensureAnalyses(
  signalTracks: Track[],
  onStage: (message: string) => void
): Promise<void> {
  const s = useEditorStore.getState();
  const relevant = new Set(
    signalTracks
      .filter((track) => track.type === "video" || track.type === "music")
      .flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean))
  );
  for (const asset of s.media) {
    if (relevant.has(asset.id) && asset.linkedAudio?.audioAssetId) {
      relevant.add(asset.linkedAudio.audioAssetId);
    }
  }
  const missing = s.media.filter(
    (asset) =>
      relevant.has(asset.id) &&
      assetKind(asset) !== "image" &&
      !(asset.id in s.analyses)
  );
  if (missing.length === 0) return;

  onStage(`Watching your footage (0/${missing.length})…`);
  try {
    const fresh = await fetchAnalyses(missing, ({ completed, total }) => {
      onStage(`Watching your footage (${completed}/${total})…`);
    });
    s.mergeAnalyses(fresh);
  } catch {
    s.mergeAnalyses(Object.fromEntries(missing.map((m) => [m.id, null])));
    useEditorStore
      .getState()
      .addToast("info", "Footage analysis unavailable — cutting on clip order instead.");
  }
}

function buildSignals(signalTracks: Track[]): TimelineSignals | null {
  try {
    const s = useEditorStore.getState();
    return buildTimelineSignals(signalTracks, s.media, s.analyses, s.beat);
  } catch {
    return null;
  }
}

/**
 * Pick the section of the song the montage should ride (drop/chorus) and a
 * tracks view with the music retrimmed to it, so the beat grid the engine
 * snaps to already carries that section's phase. Must run after analyses.
 */
function planMusicCut(targetLength: number): {
  musicCut?: { sourceStart: number; sourceEnd: number };
  signalTracks?: Track[];
} {
  const s = useEditorStore.getState();
  const musicTrack = findTrack(s.tracks, "music");
  const clip = musicTrack?.clips[0];
  const asset = clip?.assetId ? s.media.find((m) => m.id === clip.assetId) : undefined;
  const audio = clip?.assetId ? s.analyses[clip.assetId]?.audio : undefined;
  if (!musicTrack || !clip || !asset || !audio) return {};

  const srcStart = findBestMusicStart(audio, asset.duration, targetLength);
  // Give the engine headroom past the target so it can snap to a late beat.
  const span = Math.min(asset.duration - srcStart, targetLength * 1.5 + 4);
  if (span < 4) return {};

  const musicCut = {
    sourceStart: srcStart,
    sourceEnd: Math.round((srcStart + span) * 1000) / 1000,
  };
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
}

/** Build a montage recipe from the current timeline. Returns null if nothing landed. */
export async function buildMontageRecipe(
  options: MontageOptions,
  onStage: (message: string) => void
): Promise<EditRecipe | null> {
  const start = useEditorStore.getState();
  if (mainVideoTrack(start.tracks).clips.length === 0) {
    start.addToast("info", "Add some clips before building a montage.");
    return null;
  }

  // Analyses first: the song-section choice below reads the music's energy.
  await ensureAnalyses(useEditorStore.getState().tracks, onStage);
  const { musicCut, signalTracks } = planMusicCut(options.targetDuration);
  const tracksForSignals = signalTracks ?? useEditorStore.getState().tracks;
  await ensureAnalyses(tracksForSignals, onStage);
  const signals = buildSignals(tracksForSignals);

  onStage("Ranking the best moments…");
  const s = useEditorStore.getState();
  const recipe = generateMontageRecipe({
    projectId: s.projectId,
    preset: options.preset,
    targetDuration: options.targetDuration,
    signals,
    transcript: analyzeTranscript(s.captions),
    captions: s.captions,
    clips: mainClips(s.tracks),
    includedClipIds: options.includedClipIds,
    analyses: s.analyses,
    duration: tracksDuration(s.tracks),
    endCard: options.endCard,
    seed: options.seed,
    modifiers: options.modifiers,
    musicCut,
  });

  if (recipe.keptRanges.length === 0) {
    s.addToast("info", "No strong moments were found in that footage. Try adding another clip.");
    return null;
  }
  return recipe;
}

export interface MontageBuilder {
  building: boolean;
  /** Human-readable progress line, or null when idle. */
  stage: string | null;
  /** Build and apply in one go. Resolves true when the timeline changed. */
  buildAndApply: (options?: Partial<MontageOptions>) => Promise<boolean>;
}

export function useMontageBuilder(): MontageBuilder {
  const [building, setBuilding] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  /** Guards against a second run being kicked off mid-build. */
  const runningRef = useRef(false);

  const buildAndApply = useCallback(async (options?: Partial<MontageOptions>) => {
    if (runningRef.current) return false;
    runningRef.current = true;
    setBuilding(true);
    try {
      const recipe = await buildMontageRecipe(
        { ...DEFAULT_MONTAGE_OPTIONS, ...options },
        setStage
      );
      if (!recipe) return false;
      setStage("Assembling the cut…");
      const store = useEditorStore.getState();
      store.applyEditRecipe(recipe);
      // Land the user on the result, ready to watch it back.
      store.setCurrentTime(0);
      store.addToast("success", recipe.reasoningSummary);
      return true;
    } finally {
      runningRef.current = false;
      setBuilding(false);
      setStage(null);
    }
  }, []);

  return { building, stage, buildAndApply };
}
