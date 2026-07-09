import fs from "fs";
import path from "path";
import type { WordTiming } from "@/types";
import { chunkSegmentsToCaptions, chunkWordsToCaptions } from "@/lib/captions/chunk";
import { TranscriptionError, type TranscriptionProvider } from "../types";

/**
 * Optional cloud provider: OpenAI Whisper API.
 * Only used when TRANSCRIPTION_PROVIDER=openai is set explicitly — the app's
 * default is the free local-whisper provider and never requires an API key.
 *
 * Env: OPENAI_API_KEY (required), OPENAI_WHISPER_MODEL (default "whisper-1").
 */

interface WhisperVerboseResponse {
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export const openAiProvider: TranscriptionProvider = {
  name: "openai",

  async isReady() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async transcribe(audioPath, _durationSeconds, language) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new TranscriptionError(
        "OPENAI_API_KEY not set",
        "TRANSCRIPTION_PROVIDER=openai requires OPENAI_API_KEY in .env.local — or remove the setting to use the free local engine."
      );
    }

    const buffer = await fs.promises.readFile(audioPath);
    if (buffer.byteLength > 25 * 1024 * 1024) {
      throw new TranscriptionError(
        "audio exceeds 25MB Whisper API limit",
        "The audio track is too long for the OpenAI API (25MB limit). Trim the video and try again."
      );
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "audio/wav" }),
      path.basename(audioPath)
    );
    form.append("model", process.env.OPENAI_WHISPER_MODEL || "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (language !== "auto") form.append("language", language);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (err) {
      throw new TranscriptionError(
        `network error: ${String(err)}`,
        "Could not reach the OpenAI API. Check your internet connection and try again."
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TranscriptionError(
        `OpenAI API ${response.status}: ${body.slice(0, 500)}`,
        response.status === 401
          ? "Transcription failed: the OpenAI API key is invalid."
          : "The OpenAI transcription service returned an error. Please try again."
      );
    }

    const data = (await response.json()) as WhisperVerboseResponse;

    if (data.words && data.words.length > 0) {
      const words: WordTiming[] = data.words.map((w) => ({
        word: w.word,
        startTime: w.start,
        endTime: w.end,
      }));
      return chunkWordsToCaptions(words);
    }
    if (data.segments && data.segments.length > 0) {
      return chunkSegmentsToCaptions(data.segments);
    }
    return [];
  },
};
