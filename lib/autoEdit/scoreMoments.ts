import type { TimeRange } from "@/types";
import { round3 } from "@/lib/timeline/tracks";
import type { Transcript } from "./analyzeTranscript";
import { detectHooks } from "./detectHooks";

/**
 * Moment scoring: a per-second interest curve over the timeline, built from
 * speech density, speaking pace and hook-quality of the sentences playing at
 * each second, plus audio energy when peaks are available. Powers
 * "find the best 30/45/60 seconds".
 */

export interface MomentScoreInput {
  transcript: Transcript;
  /** Normalized timeline amplitude peaks (optional). */
  peaks?: number[] | null;
  duration: number;
}

export function scoreMoments(input: MomentScoreInput): number[] {
  const { transcript, peaks, duration } = input;
  const seconds = Math.max(1, Math.ceil(duration));
  const scores = new Array<number>(seconds).fill(0);

  // Speech density: words landing in each second.
  for (const w of transcript.words) {
    const sec = Math.floor(w.startTime);
    if (sec >= 0 && sec < seconds) scores[sec] += 0.35;
  }

  // Sentence quality spread across the sentence's span.
  const hookScores = detectHooks(transcript, transcript.sentences.length);
  for (const hook of hookScores) {
    const from = Math.max(0, Math.floor(hook.startTime));
    const to = Math.min(seconds - 1, Math.ceil(hook.endTime));
    for (let sec = from; sec <= to; sec++) scores[sec] += hook.score * 0.25;
  }

  // Audio energy (loud moments = laughs, exclamations, action).
  if (peaks && peaks.length > 0) {
    for (let sec = 0; sec < seconds; sec++) {
      const from = Math.floor((sec / duration) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((sec + 1) / duration) * peaks.length));
      let sum = 0;
      for (let i = from; i < to && i < peaks.length; i++) sum += peaks[i];
      scores[sec] += (sum / (to - from)) * 1.2;
    }
  }

  return scores;
}

export interface BestWindow extends TimeRange {
  score: number;
}

/**
 * Best contiguous window of ~targetSeconds, edges snapped to sentence
 * boundaries so the clip never starts or ends mid-word.
 */
export function findBestWindow(
  input: MomentScoreInput,
  targetSeconds: number
): BestWindow | null {
  const { transcript, duration } = input;
  if (duration <= targetSeconds + 1) {
    return duration > 1 ? { start: 0, end: round3(duration), score: 1 } : null;
  }

  const scores = scoreMoments(input);
  const window = Math.min(Math.floor(targetSeconds), scores.length);

  let sum = 0;
  for (let i = 0; i < window; i++) sum += scores[i];
  let best = sum;
  let bestStart = 0;
  for (let start = 1; start + window <= scores.length; start++) {
    sum += scores[start + window - 1] - scores[start - 1];
    if (sum > best) {
      best = sum;
      bestStart = start;
    }
  }

  // Snap to sentence boundaries near the raw window edges.
  const rawStart = bestStart;
  const rawEnd = bestStart + window;
  const start = snapToSentenceStart(transcript, rawStart, 3) ?? rawStart;
  let end = snapToSentenceEnd(transcript, rawEnd, 3) ?? rawEnd;
  end = Math.min(duration, Math.max(end, start + Math.min(targetSeconds * 0.7, duration)));

  return { start: round3(Math.max(0, start)), end: round3(end), score: Math.round(best * 10) / 10 };
}

function snapToSentenceStart(transcript: Transcript, t: number, tolerance: number): number | null {
  let best: number | null = null;
  for (const s of transcript.sentences) {
    const lead = Math.max(0, s.startTime - 0.15);
    if (Math.abs(lead - t) <= tolerance && (best === null || Math.abs(lead - t) < Math.abs(best - t))) {
      best = lead;
    }
  }
  return best;
}

function snapToSentenceEnd(transcript: Transcript, t: number, tolerance: number): number | null {
  let best: number | null = null;
  for (const s of transcript.sentences) {
    const tail = s.endTime + 0.15;
    if (Math.abs(tail - t) <= tolerance && (best === null || Math.abs(tail - t) < Math.abs(best - t))) {
      best = tail;
    }
  }
  return best;
}
