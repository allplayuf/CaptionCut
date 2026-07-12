import type { HighlightMoment, TimeRange, TimelineSignals } from "@/types";
import { mergeRanges, round3 } from "@/lib/timeline/tracks";
import type { Transcript } from "./analyzeTranscript";
import { detectHooks } from "./detectHooks";

/**
 * Highlight detection from real signals — the footage-first counterpart to
 * transcript hooks. A goal, a celebration, a burst of laughter or a tackle
 * shows up as an audio-energy spike (crowd/voices), a motion spike (fast
 * movement), or both. These moments drive the hook cold-open, punch-in zooms
 * and best-window selection, and they work with ZERO speech in the footage.
 */

export interface DetectHighlightsInput {
  signals: TimelineSignals | null;
  transcript?: Transcript | null;
  duration: number;
}

export function detectHighlights(input: DetectHighlightsInput, limit = 12): HighlightMoment[] {
  const { signals, transcript, duration } = input;
  const moments: HighlightMoment[] = [];

  if (signals) {
    moments.push(...signalHighlights(signals));
  }

  // Speech hooks become highlights too, so both worlds rank on one list.
  if (transcript && transcript.words.length > 0) {
    for (const hook of detectHooks(transcript, 6)) {
      if (hook.score < 3) continue;
      moments.push({
        time: round3(hook.startTime),
        start: round3(Math.max(0, hook.startTime - 0.15)),
        end: round3(Math.min(duration, hook.endTime + 0.2)),
        score: hook.score,
        kind: "speech",
        label: `“${hook.text.length > 60 ? hook.text.slice(0, 57) + "…" : hook.text}”`,
      });
    }
  }

  // De-duplicate near-coincident moments (keep the strongest).
  const sorted = moments.sort((a, b) => b.score - a.score);
  const kept: HighlightMoment[] = [];
  for (const m of sorted) {
    if (kept.some((k) => Math.abs(k.time - m.time) < 1.5)) continue;
    kept.push(m);
    if (kept.length >= limit) break;
  }
  return kept.sort((a, b) => a.time - b.time);
}

/** Audio-burst + motion-spike moments from the stitched timeline curves. */
function signalHighlights(signals: TimelineSignals): HighlightMoment[] {
  const { energy, motion, rate, duration } = signals;
  const out: HighlightMoment[] = [];

  const eStats = stats(energy);
  const mStats = stats(motion);

  // A "burst" is a local max well above the running norm. Window of ~0.8s
  // keeps us on peaks, not plateaus.
  const half = Math.max(1, Math.round(rate * 0.4));
  const n = Math.min(energy.length, motion.length) || Math.max(energy.length, motion.length);

  for (let i = half; i < n - half; i++) {
    const e = energy[i] ?? 0;
    const m = motion[i] ?? 0;
    const eZ = eStats.std > 0.01 ? (e - eStats.mean) / eStats.std : 0;
    const mZ = mStats.std > 0.01 ? (m - mStats.mean) / mStats.std : 0;

    // Local-max check on the combined curve.
    const combined = (j: number) => (energy[j] ?? 0) + (motion[j] ?? 0);
    let isPeak = true;
    for (let j = i - half; j <= i + half; j++) {
      if (combined(j) > combined(i)) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;

    const t = i / rate;
    // Classify: loud + moving = the good stuff; loud alone = reaction
    // (laughing, cheering, shouting); movement alone = action.
    if (eZ > 1.6 && mZ > 1.0) {
      out.push(moment(t, duration, 4 + eZ + mZ, "action", "Big moment — loud + fast movement"));
    } else if (eZ > 2.0) {
      out.push(moment(t, duration, 3 + eZ, "reaction", "Crowd / reaction — audio spike"));
    } else if (mZ > 2.2) {
      out.push(moment(t, duration, 2.5 + mZ, "action", "Fast movement"));
    }
  }
  return out;
}

function moment(
  t: number,
  duration: number,
  score: number,
  kind: HighlightMoment["kind"],
  label: string
): HighlightMoment {
  // Keep a lead-in (the play that caused it) and the follow-through.
  return {
    time: round3(t),
    start: round3(Math.max(0, t - 2.2)),
    end: round3(Math.min(duration, t + 2.6)),
    score: Math.round(score * 10) / 10,
    kind,
    label,
  };
}

/**
 * Dead space: stretches where nothing happens — low audio energy AND low
 * motion (or just low motion when the footage has no audio). This is the
 * signal-based analogue of transcript silence cutting, and it's what trims
 * the boring walk-to-the-spot seconds out of raw phone clips.
 */
export function detectDeadSpace(
  signals: TimelineSignals,
  opts?: { minDuration?: number; padding?: number }
): TimeRange[] {
  const { energy, motion, rate, duration, hasAudio } = signals;
  const minDuration = opts?.minDuration ?? 1.1;
  const padding = opts?.padding ?? 0.25;

  const n = Math.max(energy.length, motion.length);
  if (n === 0) return [];

  const eThresh = threshold(energy, 0.12);
  const mThresh = threshold(motion, 0.1);

  const ranges: TimeRange[] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const e = energy[i] ?? 0;
    const m = motion[i] ?? 0;
    const dead =
      i < n && (hasAudio ? e < eThresh && m < mThresh : m < mThresh * 0.8);
    if (dead && runStart < 0) runStart = i;
    if (!dead && runStart >= 0) {
      const start = runStart / rate;
      const end = i / rate;
      if (end - start >= minDuration + 2 * padding) {
        ranges.push({
          start: round3(Math.max(0, start + padding)),
          end: round3(Math.min(duration, end - padding)),
        });
      }
      runStart = -1;
    }
  }
  return mergeRanges(ranges);
}

/** Adaptive threshold: fraction of the curve's robust ceiling, floored. */
function threshold(curve: number[], base: number): number {
  if (curve.length === 0) return base;
  const sorted = [...curve].sort((a, b) => a - b);
  const p85 = sorted[Math.floor(sorted.length * 0.85)] ?? 1;
  return Math.max(base * 0.6, Math.min(base * 2, p85 * 0.22));
}

function stats(curve: number[]): { mean: number; std: number } {
  if (curve.length === 0) return { mean: 0, std: 0 };
  const mean = curve.reduce((s, v) => s + v, 0) / curve.length;
  const std = Math.sqrt(curve.reduce((s, v) => s + (v - mean) ** 2, 0) / curve.length);
  return { mean, std };
}
