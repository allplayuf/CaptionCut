import type { TimeRange } from "@/types";
import { mergeRanges, round3 } from "@/lib/timeline/tracks";
import type { Transcript, TranscriptWord } from "./analyzeTranscript";

/**
 * Filler-word detection over the timed word stream. English + Swedish, since
 * the app transcribes both. Single-word fillers match alone; phrase fillers
 * ("you know", "i mean") match as word sequences.
 *
 * "like" and "so" are only counted when they look parenthetical (surrounded
 * by a pause or repeated), to avoid butchering "I like football".
 */

/** Always safe to cut. */
const HARD_FILLERS = new Set([
  "um", "uh", "uhm", "umm", "uhh", "erm", "hmm", "mmm", "eh", "ehm",
  // Swedish
  "öh", "öhm", "eh", "ehh", "asså", "liksom", "ba", "typ",
]);

/** Cut only with pause context. */
const SOFT_FILLERS = new Set(["like", "so", "well", "right", "alltså", "ju"]);

const PHRASE_FILLERS = [
  ["you", "know"],
  ["i", "mean"],
  ["kind", "of"],
  ["sort", "of"],
];

export interface FillerMatch extends TimeRange {
  text: string;
}

export function detectFillerWords(transcript: Transcript): FillerMatch[] {
  const words = transcript.words;
  const matches: FillerMatch[] = [];
  const PAD = 0.04;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // Phrase fillers first (longest match wins).
    const phrase = PHRASE_FILLERS.find(
      (p) => p.every((part, j) => words[i + j]?.norm === part)
    );
    if (phrase) {
      const last = words[i + phrase.length - 1];
      matches.push({
        text: phrase.join(" "),
        start: round3(Math.max(0, w.startTime - PAD)),
        end: round3(last.endTime + PAD),
      });
      i += phrase.length - 1;
      continue;
    }

    if (HARD_FILLERS.has(w.norm)) {
      matches.push({
        text: w.norm,
        start: round3(Math.max(0, w.startTime - PAD)),
        end: round3(w.endTime + PAD),
      });
      continue;
    }

    if (SOFT_FILLERS.has(w.norm) && isParenthetical(words, i)) {
      matches.push({
        text: w.norm,
        start: round3(Math.max(0, w.startTime - PAD)),
        end: round3(w.endTime + PAD),
      });
    }
  }
  return matches;
}

/** Ranges only (for cutting), overlaps merged. */
export function fillerCutRanges(transcript: Transcript): TimeRange[] {
  return mergeRanges(detectFillerWords(transcript).map(({ start, end }) => ({ start, end })));
}

/** A soft filler is cuttable when it sits next to a pause or repeats itself. */
function isParenthetical(words: TranscriptWord[], i: number): boolean {
  const prev = words[i - 1];
  const next = words[i + 1];
  const gapBefore = prev ? words[i].startTime - prev.endTime : 1;
  const gapAfter = next ? next.startTime - words[i].endTime : 1;
  const repeated = next?.norm === words[i].norm || prev?.norm === words[i].norm;
  return gapBefore > 0.3 || gapAfter > 0.3 || repeated;
}

/**
 * Repeated-phrase detection: consecutive n-grams (2–5 words) that repeat
 * immediately — the classic "I was, I was going to" stutter. Returns the
 * range of the FIRST occurrence (cutting it keeps the final, clean take).
 */
export function detectRepeatedPhrases(transcript: Transcript): FillerMatch[] {
  const words = transcript.words;
  const matches: FillerMatch[] = [];

  for (let n = 5; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      let same = true;
      for (let j = 0; j < n; j++) {
        if (!words[i + j].norm || words[i + j].norm !== words[i + n + j].norm) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      // The repeat must be adjacent in time (a stutter, not a chorus).
      const gap = words[i + n].startTime - words[i + n - 1].endTime;
      if (gap > 0.6) continue;
      matches.push({
        text: words.slice(i, i + n).map((w) => w.word).join(" "),
        start: round3(words[i].startTime - 0.03),
        end: round3(words[i + n - 1].endTime + 0.03),
      });
      i += 2 * n - 1;
    }
  }
  // Deduplicate overlapping finds (longer n-grams were found first).
  const out: FillerMatch[] = [];
  for (const m of matches.sort((a, b) => a.start - b.start)) {
    if (!out.some((o) => m.start < o.end && m.end > o.start)) out.push(m);
  }
  return out;
}
