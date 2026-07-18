import type { AudioAnalysis, MediaAnalysis } from "@/types";

export interface AudioSyncSuggestion {
  /** Delay of the separate audio relative to video source time, in seconds. */
  offsetSeconds: number;
  /** Heuristic 0..1 confidence derived from correlation and runner-up margin. */
  confidence: number;
}

const MATCH_RATE = 10;
const MAX_LAG_SECONDS = 60;
const MIN_OVERLAP_SECONDS = 2.5;

/**
 * Coarse waveform sync for scratch-camera audio and a separate recorder.
 * It correlates their RMS-energy envelopes, which is intentionally much
 * cheaper than decoding full waveforms in the browser. Positive offsets mean
 * the separate recording starts later than the video.
 */
export function suggestAudioSync(
  video: MediaAnalysis | null | undefined,
  separateAudio: MediaAnalysis | null | undefined
): AudioSyncSuggestion | null {
  const camera = video?.audio;
  const external = separateAudio?.audio;
  if (!camera || !external) return null;

  const videoCurve = normalize(resample(camera, MATCH_RATE));
  const audioCurve = normalize(resample(external, MATCH_RATE));
  const minOverlap = Math.ceil(MIN_OVERLAP_SECONDS * MATCH_RATE);
  if (videoCurve.length < minOverlap || audioCurve.length < minOverlap) return null;

  const maxLag = Math.min(
    Math.round(MAX_LAG_SECONDS * MATCH_RATE),
    Math.max(videoCurve.length, audioCurve.length) - minOverlap
  );
  const maxOverlap = Math.min(videoCurve.length, audioCurve.length);
  let bestLag = 0;
  let bestScore = -Infinity;
  const scores: Array<{ lag: number; score: number }> = [];

  // Mapping is audioTime = videoTime - offset, so a positive lag samples an
  // earlier point in the separate recording for each video point.
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const videoStart = Math.max(0, lag);
    const audioStart = Math.max(0, -lag);
    const overlap = Math.min(
      videoCurve.length - videoStart,
      audioCurve.length - audioStart
    );
    if (overlap < minOverlap) continue;

    let dot = 0;
    let videoPower = 0;
    let audioPower = 0;
    for (let i = 0; i < overlap; i++) {
      const v = videoCurve[videoStart + i];
      const a = audioCurve[audioStart + i];
      dot += v * a;
      videoPower += v * v;
      audioPower += a * a;
    }
    if (videoPower < 0.001 || audioPower < 0.001) continue;
    const correlation = dot / Math.sqrt(videoPower * audioPower);
    // A tiny overlap can correlate by chance, so prefer evidence covering a
    // useful share of the shorter recording.
    const coverage = Math.sqrt(overlap / maxOverlap);
    const score = correlation * (0.65 + 0.35 * coverage);
    scores.push({ lag, score });
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!Number.isFinite(bestScore)) return null;
  const runnerUp = scores
    .filter(({ lag }) => Math.abs(lag - bestLag) > MATCH_RATE * 0.75)
    .reduce((best, item) => Math.max(best, item.score), -1);
  const margin = Math.max(0, bestScore - runnerUp);
  const confidence = clamp01((bestScore - 0.18) * 1.05 + margin * 1.8);

  return {
    offsetSeconds: Math.round((bestLag / MATCH_RATE) * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function resample(analysis: AudioAnalysis, rate: number): number[] {
  const duration = analysis.energy.length / Math.max(0.001, analysis.rate);
  const length = Math.max(0, Math.floor(duration * rate));
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const sourceIndex = Math.min(
      analysis.energy.length - 1,
      Math.max(0, Math.floor((i / rate) * analysis.rate))
    );
    out[i] = analysis.energy[sourceIndex] ?? 0;
  }
  return out;
}

function normalize(values: number[]): number[] {
  if (values.length === 0) return values;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const scale = Math.sqrt(variance) || 1;
  return values.map((value) => (value - mean) / scale);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
