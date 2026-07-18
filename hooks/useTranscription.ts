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

export type TranscriptionScope = "timeline" | "selected";

interface TranscriptionPreferences {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  scope: TranscriptionScope;
  prompt: string;
  setLanguage: (language: TranscriptionLanguage) => void;
  setQuality: (quality: TranscriptionQuality) => void;
  setScope: (scope: TranscriptionScope) => void;
  setPrompt: (prompt: string) => void;
}

/** Shared between Captions and AI Edit so the chosen language/glossary is
    respected when Interview mode needs to transcribe its selected A-roll. */
const useTranscriptionPreferences = create<TranscriptionPreferences>((set) => ({
  language: "auto",
  quality: "accurate",
  scope: "timeline",
  prompt: "",
  setLanguage: (language) => set({ language }),
  setQuality: (quality) => set({ quality }),
  setScope: (scope) => set({ scope }),
  setPrompt: (prompt) => set({ prompt }),
}));

interface RunTranscriptionOptions {
  /** Programmatic scope used by Interview mode, independent of timeline selection. */
  clipIds?: string[];
  /** Explicit callers can bypass the Captions panel's currently selected scope. */
  scope?: TranscriptionScope;
}

/**
 * Shared transcription flow. A selected-clip run sends the complete edited
 * timeline but asks the server to replace every unselected clip with silence,
 * so returned word timings still land at their real timeline positions.
 */
export function useTranscription() {
  const language = useTranscriptionPreferences((state) => state.language);
  const quality = useTranscriptionPreferences((state) => state.quality);
  const scope = useTranscriptionPreferences((state) => state.scope);
  const prompt = useTranscriptionPreferences((state) => state.prompt);
  const setLanguage = useTranscriptionPreferences((state) => state.setLanguage);
  const setQuality = useTranscriptionPreferences((state) => state.setQuality);
  const setScope = useTranscriptionPreferences((state) => state.setScope);
  const setPrompt = useTranscriptionPreferences((state) => state.setPrompt);

  const runTranscription = async (
    options: RunTranscriptionOptions = {}
  ): Promise<Caption[] | null> => {
    const store = useEditorStore.getState();
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
    try {
      // Best-effort probe lets the UI explain a one-time local model download.
      try {
        const status = await (
          await fetch(`/api/transcribe?quality=${encodeURIComponent(quality)}`)
        ).json();
        if (status?.provider === "local-whisper" && status.ready === false) {
          const model = typeof status.model === "string" ? status.model : quality;
          store.addToast(
            "info",
            `First run: downloading Whisper ${model}${modelDownloadSize(model)}. Captions start when it is ready.`
          );
        }
      } catch {
        // The status probe is advisory; the POST reports actionable failures.
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media: store.media,
          clips,
          language,
          quality,
          prompt,
          ...(scoped ? { selectedClipIds } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Transcription failed.");

      const captions = body.captions as Caption[];
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

      if (body.provider === "mock") {
        latestStore.addToast(
          "info",
          "Demo captions generated (mock mode). Unset TRANSCRIPTION_PROVIDER for real local transcription."
        );
      } else {
        const model = typeof body.model === "string" ? ` with ${body.model}` : "";
        const target = scoped ? " in selected clips" : "";
        latestStore.addToast(
          "success",
          `Generated ${captions.length} caption${captions.length === 1 ? "" : "s"}${target}${model}.`
        );
      }
      return captions;
    } catch (err) {
      useEditorStore
        .getState()
        .addToast("error", err instanceof Error ? err.message : "Transcription failed.");
      return null;
    } finally {
      useEditorStore.getState().setTranscribing(false);
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
    prompt,
    setPrompt,
    coverageStatus,
  };
}

function modelDownloadSize(model: string): string {
  const family = model.replace(/\.en$/, "");
  const sizes: Record<string, string> = {
    tiny: " (~75 MB)",
    base: " (~150 MB)",
    small: " (~500 MB)",
    medium: " (~1.5 GB)",
    "large-v3": " (~3 GB)",
    "large-v3-turbo": " (~1.6 GB)",
  };
  return sizes[family] ?? "";
}
