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
const TARGET_WORDS = 4;
const MAX_WORDS = 6;
const MAX_CHARS = 30;
const MAX_DURATION = 2.7;
const GAP_BREAK = 0.48;
const SOFT_GAP_BREAK = 0.22;
const MIN_WORDS_FOR_SOFT_BREAK = 3;

const SOFT_BREAK_WORDS = new Set([
  "and", "but", "because", "so", "then", "or",
  "och", "men", "för", "så", "sedan", "eller",
]);

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
    const endsClause = /[,;:]["')\]]?$/.test(word.word);
    const nextStartsClause = Boolean(
      next && SOFT_BREAK_WORDS.has(next.word.toLocaleLowerCase().replace(/[^\p{L}]/gu, ""))
    );
    const chunkDuration = word.endTime - current[0].startTime;

    if (
      endsSentence ||
      current.length >= MAX_WORDS ||
      charCount >= MAX_CHARS ||
      chunkDuration >= MAX_DURATION ||
      gapToNext > GAP_BREAK ||
      (current.length >= MIN_WORDS_FOR_SOFT_BREAK &&
        (endsClause || nextStartsClause ||
          (current.length >= TARGET_WORDS && gapToNext > SOFT_GAP_BREAK)))
    ) {
      flush();
    }
  }
  flush();

  return postProcess(mergeOrphans(captions));
}

/**
 * A chunk that ends up as a single short word (an artifact of hitting a cap
 * one word early) reads as a flicker. Fold it into the previous chunk when
 * they're contiguous speech and the merge still fits on one line.
 */
function mergeOrphans(captions: Caption[]): Caption[] {
  const out: Caption[] = [];
  for (const cap of captions) {
    const prev = out[out.length - 1];
    const words = cap.words ?? [];
    const isOrphan = words.length === 1 && cap.text.length <= 12;
    const contiguous = prev && cap.startTime - prev.endTime < 0.35;
    const fits =
      prev &&
      (prev.words?.length ?? 0) + words.length <= MAX_WORDS &&
      prev.text.length + cap.text.length + 1 <= MAX_CHARS + 4;
    const prevEndsSentence = prev && /[.!?]["')\]]?$/.test(prev.text);
    if (isOrphan && contiguous && fits && !prevEndsSentence) {
      prev.endTime = cap.endTime;
      prev.text = `${prev.text} ${cap.text}`;
      prev.words = prev.words ? [...prev.words, ...words] : undefined;
    } else {
      out.push({ ...cap });
    }
  }
  return out;
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
  const MIN_DURATION = 0.42;
  const MAX_GAP_TO_BRIDGE = 0.18;

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
