import type { TimeRange } from "@/types";
import { mergeRanges, round3 } from "@/lib/timeline/tracks";
import type { Transcript } from "./analyzeTranscript";

/**
 * Silence detection with two real signals:
 *  1. audio amplitude — timeline waveform peaks (decoded in the browser via
 *     WebAudio, see lib/audio/waveform.ts) below a threshold for long enough;
 *  2. transcript gaps — stretches between word timestamps with no speech.
 *
 * When amplitude data exists, a region must satisfy BOTH (quiet AND no words)
 * so music/laughter isn't cut; without amplitude, transcript gaps alone rule.
 */

export type SilenceAggressiveness = "light" | "medium" | "aggressive";

export interface SilenceOptions {
  /** Peaks below this (0..1, normalized) count as quiet. */
  amplitudeThreshold: number;
  /** Minimum quiet stretch worth cutting, seconds. */
  minDuration: number;
  /** Breathing room left on each side of the cut, seconds. */
  padding: number;
}

export const SILENCE_LEVELS: Record<SilenceAggressiveness, SilenceOptions> = {
  light: { amplitudeThreshold: 0.06, minDuration: 0.9, padding: 0.18 },
  medium: { amplitudeThreshold: 0.09, minDuration: 0.55, padding: 0.12 },
  aggressive: { amplitudeThreshold: 0.12, minDuration: 0.35, padding: 0.07 },
};

export interface SilenceInput {
  transcript: Transcript;
  /** Normalized 0..1 amplitude peaks covering the WHOLE timeline, evenly spaced. */
  peaks?: number[] | null;
  duration: number;
}

export function detectSilence(
  input: SilenceInput,
  level: SilenceAggressiveness = "medium"
): TimeRange[] {
  const opts = SILENCE_LEVELS[level];
  const gaps = transcriptGaps(input.transcript, input.duration, opts);
  if (!input.peaks || input.peaks.length < 16) {
    return gaps;
  }
  const quiet = quietRanges(input.peaks, input.duration, opts);
  const both = intersectRanges(gaps, quiet);
  return both
    .filter((r) => r.end - r.start >= opts.minDuration)
    .map((r) => ({
      start: round3(Math.max(0, r.start + opts.padding)),
      end: round3(r.end - opts.padding),
    }))
    .filter((r) => r.end - r.start > 0.1);
}

/** Speech-free stretches from word timestamps (incl. lead-in and tail). */
function transcriptGaps(transcript: Transcript, duration: number, opts: SilenceOptions): TimeRange[] {
  const { words } = transcript;
  if (words.length === 0) return [];
  const ranges: TimeRange[] = [];

  if (words[0].startTime > opts.minDuration + opts.padding) {
    ranges.push({ start: 0, end: round3(words[0].startTime - opts.padding) });
  }
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].endTime;
    const gapEnd = words[i + 1].startTime;
    if (gapEnd - gapStart >= opts.minDuration + 2 * opts.padding) {
      ranges.push({
        start: round3(gapStart + opts.padding),
        end: round3(gapEnd - opts.padding),
      });
    }
  }
  const last = words[words.length - 1];
  if (duration - last.endTime > opts.minDuration + opts.padding) {
    ranges.push({ start: round3(last.endTime + opts.padding), end: round3(duration) });
  }
  return mergeRanges(ranges);
}

/** Contiguous low-amplitude stretches from waveform peaks. */
function quietRanges(peaks: number[], duration: number, opts: SilenceOptions): TimeRange[] {
  const secPerPeak = duration / peaks.length;
  const ranges: TimeRange[] = [];
  let runStart = -1;

  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length && peaks[i] < opts.amplitudeThreshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const start = runStart * secPerPeak;
      const end = i * secPerPeak;
      if (end - start >= opts.minDuration) ranges.push({ start: round3(start), end: round3(end) });
      runStart = -1;
    }
  }
  return ranges;
}

function intersectRanges(a: TimeRange[], b: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const ra of a) {
    for (const rb of b) {
      const start = Math.max(ra.start, rb.start);
      const end = Math.min(ra.end, rb.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeRanges(out);
}
