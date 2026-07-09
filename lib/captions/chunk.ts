import { nanoid } from "nanoid";
import type { Caption, WordTiming } from "@/types";

/**
 * Turns a flat word list (from transcription) into short, punchy TikTok-style
 * caption chunks (~3–7 words each) instead of long subtitle lines.
 *
 * Break rules, in priority order:
 *  - always break after sentence-ending punctuation (. ! ?)
 *  - break on a silence gap longer than GAP_BREAK seconds
 *  - break after a comma once the chunk has a few words
 *  - hard cap on word count and character length
 */
const MAX_WORDS = 6;
const MAX_CHARS = 32;
const GAP_BREAK = 0.6;
const MIN_WORDS_FOR_COMMA_BREAK = 3;

export function chunkWordsToCaptions(words: WordTiming[]): Caption[] {
  const cleaned = words
    .map((w) => ({ ...w, word: w.word.trim() }))
    .filter((w) => w.word.length > 0);
  if (cleaned.length === 0) return [];

  const captions: Caption[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    captions.push({
      id: nanoid(8),
      startTime: current[0].startTime,
      endTime: current[current.length - 1].endTime,
      text: current.map((w) => w.word).join(" "),
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < cleaned.length; i++) {
    const word = cleaned[i];
    current.push(word);

    const charCount = current.reduce((n, w) => n + w.word.length + 1, 0);
    const next = cleaned[i + 1];
    const gapToNext = next ? next.startTime - word.endTime : 0;

    const endsSentence = /[.!?]["')\]]?$/.test(word.word);
    const endsComma = /[,;:]["')\]]?$/.test(word.word);

    if (
      endsSentence ||
      current.length >= MAX_WORDS ||
      charCount >= MAX_CHARS ||
      gapToNext > GAP_BREAK ||
      (endsComma && current.length >= MIN_WORDS_FOR_COMMA_BREAK)
    ) {
      flush();
    }
  }
  flush();

  return postProcess(captions);
}

/**
 * Fallback for transcripts without word timestamps: split each segment's text
 * into small chunks and distribute the segment's time proportionally to
 * character length. No word timings are synthesized (highlighting stays off).
 */
export function chunkSegmentsToCaptions(
  segments: Array<{ start: number; end: number; text: string }>
): Caption[] {
  const captions: Caption[] = [];

  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const groups: string[][] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS) {
      groups.push(words.slice(i, i + MAX_WORDS));
    }

    const totalChars = words.join(" ").length;
    const segDuration = Math.max(0.2, seg.end - seg.start);
    let cursor = seg.start;

    for (const group of groups) {
      const chars = group.join(" ").length;
      const dur = totalChars > 0 ? (chars / totalChars) * segDuration : segDuration;
      captions.push({
        id: nanoid(8),
        startTime: cursor,
        endTime: cursor + dur,
        text: group.join(" "),
      });
      cursor += dur;
    }
  }

  return postProcess(captions);
}

/** Enforce minimum durations and close tiny gaps so captions don't flicker. */
function postProcess(captions: Caption[]): Caption[] {
  const MIN_DURATION = 0.3;
  const MAX_GAP_TO_BRIDGE = 0.25;

  const sorted = [...captions].sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < sorted.length; i++) {
    const cap = sorted[i];
    if (cap.endTime - cap.startTime < MIN_DURATION) {
      cap.endTime = cap.startTime + MIN_DURATION;
    }
    const next = sorted[i + 1];
    if (next) {
      if (cap.endTime > next.startTime) {
        // never overlap the next caption
        cap.endTime = Math.max(cap.startTime + 0.1, next.startTime);
      } else if (next.startTime - cap.endTime < MAX_GAP_TO_BRIDGE) {
        // bridge blink-and-you-miss-it gaps
        cap.endTime = next.startTime;
      }
    }
    // round for stable JSON / clean UI values
    cap.startTime = round3(cap.startTime);
    cap.endTime = round3(cap.endTime);
    cap.words = cap.words?.map((w) => ({
      ...w,
      startTime: round3(w.startTime),
      endTime: round3(w.endTime),
    }));
  }
  return sorted;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
