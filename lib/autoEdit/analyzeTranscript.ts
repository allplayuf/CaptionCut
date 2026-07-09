import type { Caption, WordTiming } from "@/types";
import { captionsToWords, round3 } from "@/lib/timeline/tracks";

/**
 * Turns the caption list produced by transcription into an analysis-friendly
 * transcript: a flat, timed word stream plus sentence groupings with speech
 * statistics. Every downstream auto-edit module consumes this.
 */

export interface TranscriptWord extends WordTiming {
  /** Lowercased, punctuation-stripped form used for matching. */
  norm: string;
  index: number;
}

export interface Sentence {
  text: string;
  startTime: number;
  endTime: number;
  words: TranscriptWord[];
  /** Words per second inside the sentence — a proxy for energy. */
  pace: number;
}

export interface Transcript {
  words: TranscriptWord[];
  sentences: Sentence[];
  duration: number;
  /** Average speaking pace across all speech (words/sec). */
  averagePace: number;
}

const SENTENCE_END = /[.!?]["')\]]?$/;
/** A silence this long also terminates a sentence. */
const SENTENCE_GAP = 1.0;

export function analyzeTranscript(captions: Caption[]): Transcript {
  const raw = captionsToWords(captions);
  const words: TranscriptWord[] = raw.map((w, index) => ({
    ...w,
    norm: normalizeWord(w.word),
    index,
  }));

  const sentences: Sentence[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const startTime = current[0].startTime;
    const endTime = current[current.length - 1].endTime;
    const dur = Math.max(0.2, endTime - startTime);
    sentences.push({
      text: current.map((w) => w.word).join(" "),
      startTime,
      endTime,
      words: current,
      pace: round3(current.length / dur),
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    const gap = next ? next.startTime - words[i].endTime : 0;
    if (SENTENCE_END.test(words[i].word) || gap > SENTENCE_GAP || current.length >= 30) {
      flush();
    }
  }
  flush();

  const duration = words.length ? words[words.length - 1].endTime : 0;
  const speechTime = sentences.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  const averagePace = speechTime > 0 ? round3(words.length / speechTime) : 0;

  return { words, sentences, duration, averagePace };
}

export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .trim();
}
