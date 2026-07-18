import type { Caption, WordTiming } from "@/types";
import type { TranscriptionProvider } from "../types";

/**
 * Demo provider (TRANSCRIPTION_PROVIDER=mock): instant placeholder captions
 * with word timings. Useful for UI development and tests — no model download,
 * no waiting.
 */

const DEMO_LINES = [
  "This is a demo caption",
  "generated in mock mode",
  "captions are fully editable",
  "click any line to change it",
  "style them on the right",
  "then export your video",
];

export const mockProvider: TranscriptionProvider = {
  name: "mock",

  async isReady() {
    return true;
  },

  modelName() {
    return "mock";
  },

  async transcribe(_audioPath, durationSeconds) {
    // Spread demo lines evenly across the video so timing/highlighting can be tested.
    const captions: Caption[] = [];
    const count = Math.max(3, Math.min(DEMO_LINES.length, Math.floor(durationSeconds / 1.6)));
    const slot = durationSeconds / count;

    for (let i = 0; i < count; i++) {
      const start = i * slot + 0.1;
      const end = Math.min(durationSeconds, (i + 1) * slot - 0.1);
      const text = DEMO_LINES[i % DEMO_LINES.length];
      const wordsRaw = text.split(" ");
      const wordDur = (end - start) / wordsRaw.length;
      const words: WordTiming[] = wordsRaw.map((w, j) => ({
        word: w,
        startTime: start + j * wordDur,
        endTime: start + (j + 1) * wordDur,
        confidence: 1,
      }));
      captions.push({
        id: `demo-${i}`,
        startTime: Math.round(start * 1000) / 1000,
        endTime: Math.round(end * 1000) / 1000,
        text,
        words,
        confidence: 1,
      });
    }
    return captions;
  },
};
