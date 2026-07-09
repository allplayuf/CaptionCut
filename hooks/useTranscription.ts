"use client";

import { useState } from "react";
import type { Caption, TranscriptionLanguage } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mainClips } from "@/lib/timeline/tracks";

/**
 * Shared transcription flow: extracts the edited timeline's audio server-side,
 * runs the local Whisper provider, and loads the resulting captions into the
 * store. Used by the Captions tab and by Auto Edit (which needs a transcript
 * before it can analyze anything).
 *
 * Returns the fresh captions so callers can chain analysis without waiting
 * for a store roundtrip.
 */
export function useTranscription() {
  const [language, setLanguage] = useState<TranscriptionLanguage>("auto");

  const runTranscription = async (): Promise<Caption[] | null> => {
    const store = useEditorStore.getState();
    const clips = mainClips(store.tracks);
    if (clips.length === 0) {
      store.addToast("info", "Upload a video first.");
      return null;
    }

    store.setTranscribing(true);
    try {
      // Heads-up when the free local model still needs its one-time download.
      try {
        const status = await (await fetch("/api/transcribe")).json();
        if (status?.provider === "local-whisper" && status.ready === false) {
          store.addToast(
            "info",
            "First run: downloading the free local speech model (~150 MB). This happens once — captions will start right after."
          );
        }
      } catch {
        // status probe is best-effort
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media: store.media, clips, language }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Transcription failed.");

      const captions = body.captions as Caption[];
      useEditorStore.getState().setCaptions(captions);
      if (body.provider === "mock") {
        store.addToast(
          "info",
          "Demo captions generated (mock mode). Unset TRANSCRIPTION_PROVIDER for real local transcription."
        );
      } else {
        store.addToast("success", `Generated ${captions.length} captions ✨`);
      }
      return captions;
    } catch (err) {
      store.addToast("error", err instanceof Error ? err.message : "Transcription failed.");
      return null;
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
  };

  return { runTranscription, language, setLanguage };
}
