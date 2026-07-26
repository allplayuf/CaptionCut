"use client";

import { create } from "zustand";
import type {
  Caption,
  TimeRange,
  TranscriptionLanguage,
  TranscriptionQuality,
} from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mainClips, mainVideoTrack } from "@/lib/timeline/tracks";
import {
  captionCoverageStatus,
  captionSourceSignature,
  mergeCaptionCoverage,
  type CaptionCoverageStatus,
} from "@/lib/transcription/coverage";
import {
  transcribeTimelineInBrowser,
  type LocalCaptionProgress,
} from "@/lib/transcription/browserWhisper";

export type TranscriptionScope = "timeline" | "selected";

interface TranscriptionPreferences {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  scope: TranscriptionScope;
  progress: LocalCaptionProgress | null;
  setLanguage: (language: TranscriptionLanguage) => void;
  setQuality: (quality: TranscriptionQuality) => void;
  setScope: (scope: TranscriptionScope) => void;
  setProgress: (progress: LocalCaptionProgress | null) => void;
}

/** Shared between Captions and AutoEdit so every entry point uses the same
    local model and language when it needs to transcribe selected footage. */
const useTranscriptionPreferences = create<TranscriptionPreferences>((set) => ({
  language: "auto",
  // Match the model that EditorPage preloads after import. New visitors should
  // never have to download both Whisper Tiny and Whisper Base before their
  // first caption appears.
  quality: "fast",
  scope: "timeline",
  progress: null,
  setLanguage: (language) => set({ language }),
  setQuality: (quality) => set({ quality }),
  setScope: (scope) => set({ scope }),
  setProgress: (progress) => set({ progress }),
}));

interface RunTranscriptionOptions {
  /** Programmatic scope used by Interview mode, independent of timeline selection. */
  clipIds?: string[];
  /** Explicit callers can bypass the Captions panel's currently selected scope. */
  scope?: TranscriptionScope;
}

/**
 * Shared browser-local transcription flow. Selected clips are placed into a
 * silent copy of the complete edited timeline, so the returned word timings
 * still land at their real timeline positions without uploading the audio.
 */
export function useTranscription() {
  const language = useTranscriptionPreferences((state) => state.language);
  const quality = useTranscriptionPreferences((state) => state.quality);
  const scope = useTranscriptionPreferences((state) => state.scope);
  const progress = useTranscriptionPreferences((state) => state.progress);
  const setLanguage = useTranscriptionPreferences((state) => state.setLanguage);
  const setQuality = useTranscriptionPreferences((state) => state.setQuality);
  const setScope = useTranscriptionPreferences((state) => state.setScope);
  const setProgress = useTranscriptionPreferences((state) => state.setProgress);

  const runTranscription = async (
    options: RunTranscriptionOptions = {}
  ): Promise<Caption[] | null> => {
    const store = useEditorStore.getState();
    if (store.isTranscribing) {
      store.addToast("info", "Captions are already running. Wait for the current pass to finish.");
      return null;
    }
    const clips = mainClips(store.tracks);
    if (clips.length === 0) {
      store.addToast("info", "Upload a video first.");
      return null;
    }

    const mainTrack = mainVideoTrack(store.tracks);
    const requestProjectId = store.projectId;
    const requestTimelineSignature = captionSourceSignature(clips, store.media);
    const selectedIds = new Set(store.selectedClipIds);
    const requestedScope = options.clipIds !== undefined ? "selected" : options.scope ?? scope;
    const requestedIds = options.clipIds ? new Set(options.clipIds) : selectedIds;
    const scoped = requestedScope === "selected";
    const selectedMainClips = mainTrack.clips.filter((clip) => requestedIds.has(clip.id));
    if (scoped && selectedMainClips.length === 0) {
      store.addToast("info", "Select at least one clip on the main video track first.");
      return null;
    }

    const selectedClipIds = selectedMainClips.map((clip) => clip.id);
    const selectedRanges: TimeRange[] = selectedMainClips.map((clip) => ({
      start: clip.startTime,
      end: clip.endTime,
    }));

    store.setTranscribing(true);
    setProgress({
      stage: "audio",
      progress: 0,
      detail: "Preparing audio locally",
    });
    try {
      const result = await transcribeTimelineInBrowser({
        media: store.media,
        clips,
        language,
        quality,
        ...(scoped ? { selectedClipIds } : {}),
        onProgress: setProgress,
      });
      const captions = result.captions;
      const latestStore = useEditorStore.getState();
      if (
        latestStore.projectId !== requestProjectId ||
        captionSourceSignature(mainClips(latestStore.tracks), latestStore.media) !== requestTimelineSignature
      ) {
        latestStore.addToast(
          "info",
          "The timeline changed while captions were running. Start captions again for the current edit."
        );
        return null;
      }
      const nextCoverage = mergeCaptionCoverage(
        latestStore.captionCoverage,
        {
          sourceSignature: requestTimelineSignature,
          coveredClipIds: scoped ? selectedClipIds : clips.map((clip) => clip.id),
        },
        scoped
      );
      if (scoped) {
        latestStore.replaceCaptionsInRanges(selectedRanges, captions, nextCoverage);
      } else {
        latestStore.setCaptions(captions, nextCoverage);
      }

      const target = scoped ? " in selected clips" : "";
      latestStore.addToast(
        "success",
        `Generated ${captions.length} caption${captions.length === 1 ? "" : "s"}${target} locally with ${result.model}.`
      );
      return captions;
    } catch (err) {
      useEditorStore
        .getState()
        .addToast("error", err instanceof Error ? err.message : "Transcription failed.");
      return null;
    } finally {
      useEditorStore.getState().setTranscribing(false);
      setProgress(null);
    }
  };

  const coverageStatus = (clipIds?: string[]): CaptionCoverageStatus => {
    const current = useEditorStore.getState();
    const clips = mainClips(current.tracks);
    return captionCoverageStatus(current.captionCoverage, clips, current.media, clipIds);
  };

  return {
    runTranscription,
    language,
    setLanguage,
    quality,
    setQuality,
    scope,
    setScope,
    progress,
    coverageStatus,
  };
}
