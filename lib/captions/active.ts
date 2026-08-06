import type { Caption } from "@/types";

/**
 * Which caption (and which word inside it) is on screen at a given instant.
 *
 * These mirror the export's layering and word-frame rules (lib/export/ass.ts)
 * so the preview highlights exactly the word libass burns in. They run on every
 * playback frame for each subscriber, so they stay allocation-free and return
 * plain indices — callers select those primitives from the store, which keeps
 * React out of the frames where nothing actually changed.
 */

/** Index of the caption at `time`, or -1. Later captions win on overlap. */
export function activeCaptionIndex(captions: Caption[], time: number): number {
  let found = -1;
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    if (time >= cap.startTime && time < cap.endTime) found = i;
  }
  return found;
}

/** The caption at `time`, or null. */
export function activeCaption(captions: Caption[], time: number): Caption | null {
  const index = activeCaptionIndex(captions, time);
  return index === -1 ? null : captions[index];
}

/**
 * Index of the spoken word inside `caption` at `time`, or -1 when the caption
 * has no word timings. Frame k runs from word[k-1].end to word[k].end, so
 * exactly one word is active at a time — the same partition buildAss() uses.
 */
export function activeWordIndex(caption: Caption, time: number): number {
  const words = caption.words;
  if (!words || words.length === 0) return -1;
  for (let k = 0; k < words.length; k++) {
    const start = k === 0 ? caption.startTime : words[k - 1].endTime;
    const end = k === words.length - 1 ? caption.endTime : words[k].endTime;
    if (time >= start && time < end) return k;
  }
  return words.length - 1;
}
