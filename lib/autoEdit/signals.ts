import type {
  Clip,
  MediaAnalysis,
  MediaAsset,
  TimelineSignals,
  Track,
} from "@/types";
import { findTrack, mainClips, round3, tracksDuration } from "@/lib/timeline/tracks";

/**
 * Timeline signals: per-asset analysis curves (motion, energy, beats, scene
 * changes) stitched into the CURRENT timeline's time domain, so the auto-edit
 * brain reasons about "what the viewer will actually see", across any number
 * of trimmed/reordered source clips.
 */

/** Samples/sec of the stitched curves. */
export const SIGNAL_RATE = 10;

/** Fetch (and lazily compute) analyses for the given assets. */
export async function fetchAnalyses(
  media: MediaAsset[]
): Promise<Record<string, MediaAnalysis | null>> {
  if (media.length === 0) return {};
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Media analysis failed.");
  }
  const body = (await res.json()) as { analyses: Record<string, MediaAnalysis | null> };
  return body.analyses ?? {};
}

/**
 * Stitch per-asset analyses into timeline-domain curves. Missing analyses
 * leave zeros in their stretch (the editor treats unknown as "nothing
 * special"), and clip joins are always registered as scene changes.
 */
export function buildTimelineSignals(
  tracks: Track[],
  media: MediaAsset[],
  analyses: Record<string, MediaAnalysis | null>
): TimelineSignals | null {
  const clips = mainClips(tracks);
  const duration = tracksDuration(tracks);
  if (clips.length === 0 || duration <= 0.2) return null;

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const bins = Math.max(1, Math.ceil(duration * SIGNAL_RATE));
  const energy = new Array<number>(bins).fill(0);
  const motion = new Array<number>(bins).fill(0);
  const sceneChanges: number[] = [];
  const footageBeats: number[] = [];
  let hasAudio = false;
  let anySignal = false;

  let cursor = 0;
  for (const clip of clips) {
    const speed = Math.min(2, Math.max(0.5, clip.speed && clip.speed > 0 ? clip.speed : 1));
    const clipDur = Math.max(0, clip.sourceEnd - clip.sourceStart) / speed;
    const analysis = analyses[clip.mediaId];
    const asset = mediaById.get(clip.mediaId);
    if (asset?.hasAudio) hasAudio = true;

    // Clip joins are hard cuts by construction (skip t=0).
    if (cursor > 0.05) sceneChanges.push(round3(cursor));

    if (analysis) {
      const { audio, video } = analysis;
      if (audio || video) anySignal = true;
      const from = Math.floor(cursor * SIGNAL_RATE);
      const to = Math.min(bins, Math.ceil((cursor + clipDur) * SIGNAL_RATE));
      for (let b = from; b < to; b++) {
        const srcT = clip.sourceStart + (b / SIGNAL_RATE - cursor) * speed;
        if (audio) {
          const i = Math.min(audio.energy.length - 1, Math.floor(srcT * audio.rate));
          if (i >= 0) energy[b] = audio.energy[i];
        }
        if (video) {
          const i = Math.min(video.motion.length - 1, Math.floor(srcT * video.rate));
          if (i >= 0) motion[b] = video.motion[i];
        }
      }
      if (video) {
        for (const sc of video.sceneChanges) {
          if (sc >= clip.sourceStart && sc <= clip.sourceEnd) {
            sceneChanges.push(round3(cursor + (sc - clip.sourceStart) / speed));
          }
        }
      }
      if (audio && audio.bpm) {
        for (const beat of audio.beats) {
          if (beat >= clip.sourceStart && beat <= clip.sourceEnd) {
            footageBeats.push(round3(cursor + (beat - clip.sourceStart) / speed));
          }
        }
      }
    }
    cursor += clipDur;
  }
  if (!anySignal) return null;

  // Beat grid: an added music track wins over beats in the footage itself —
  // it plays over the final cut, so cuts should land on ITS beats.
  const music = musicBeats(tracks, analyses);
  let beats = music?.beats.length ? music.beats : dedupeSorted(footageBeats);
  let bpm = music?.beats.length ? music.bpm : footageBeatsBpm(clips, analyses);
  let beatSource: "music" | "footage" | "energy" = music?.beats.length ? "music" : "footage";

  // Fallback grid: footage without a confident musical beat (crowd noise,
  // speech, match audio) still gets beat-synced cuts — they land on energy
  // onsets (ball strikes, cheers) instead of a tempo.
  if (beats.length <= 4) {
    const fallback = energyOnsetGrid(energy, SIGNAL_RATE);
    if (fallback.beats.length > 4) {
      beats = fallback.beats;
      bpm = fallback.bpm;
      beatSource = "energy";
    }
  }

  return {
    rate: SIGNAL_RATE,
    energy,
    motion,
    sceneChanges: dedupeSorted(sceneChanges),
    beats,
    bpm,
    duration,
    hasAudio,
    beatSource,
  };
}

/**
 * Synthetic beat grid from audio-energy onsets: local rises well above the
 * curve's norm, at least 0.35s apart. The pseudo-BPM is the median onset
 * interval, so beat-quantized segment lengths stay meaningful.
 */
function energyOnsetGrid(energy: number[], rate: number): { beats: number[]; bpm: number | null } {
  if (energy.length < rate * 4) return { beats: [], bpm: null };
  const onset: number[] = new Array(energy.length).fill(0);
  for (let i = 1; i < energy.length; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const mean = onset.reduce((s, v) => s + v, 0) / onset.length;
  const std =
    Math.sqrt(onset.reduce((s, v) => s + (v - mean) ** 2, 0) / onset.length) || 0.001;
  const threshold = mean + 0.9 * std;

  const beats: number[] = [];
  const minGap = 0.35;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] < threshold) continue;
    if (onset[i] < onset[i - 1] || onset[i] < onset[i + 1]) continue; // not a local peak
    const t = round3(i / rate);
    if (beats.length === 0 || t - beats[beats.length - 1] >= minGap) beats.push(t);
  }
  if (beats.length < 5) return { beats: [], bpm: null };

  const gaps = beats.slice(1).map((t, i) => t - beats[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const bpm = median > 0.2 ? Math.round(60 / median) : null;
  return { beats, bpm };
}

function musicBeats(
  tracks: Track[],
  analyses: Record<string, MediaAnalysis | null>
): { beats: number[]; bpm: number | null } | null {
  const track = findTrack(tracks, "music");
  if (!track || track.muted) return null;
  const beats: number[] = [];
  let bpm: number | null = null;
  for (const clip of track.clips) {
    const audio = clip.assetId ? analyses[clip.assetId]?.audio : null;
    if (!audio?.bpm) continue;
    bpm = bpm ?? audio.bpm;
    const srcStart = clip.sourceStart ?? 0;
    const dur = clip.endTime - clip.startTime;
    for (const beat of audio.beats) {
      if (beat >= srcStart && beat <= srcStart + dur) {
        beats.push(round3(clip.startTime + (beat - srcStart)));
      }
    }
  }
  if (beats.length > 0) return { beats: dedupeSorted(beats), bpm };

  // Music without a confident tempo (ambient, lo-fi, heavy vocals): use the
  // track's own energy onsets so cuts still lock to the song.
  for (const clip of track.clips) {
    const audio = clip.assetId ? analyses[clip.assetId]?.audio : null;
    if (!audio) continue;
    const grid = energyOnsetGrid(audio.energy, audio.rate);
    const srcStart = clip.sourceStart ?? 0;
    const dur = clip.endTime - clip.startTime;
    for (const b of grid.beats) {
      if (b >= srcStart && b <= srcStart + dur) {
        beats.push(round3(clip.startTime + (b - srcStart)));
      }
    }
    bpm = bpm ?? grid.bpm;
  }
  return beats.length > 0 ? { beats: dedupeSorted(beats), bpm } : null;
}

/** Dominant footage BPM (first confident one wins — good enough for snapping). */
function footageBeatsBpm(
  clips: Clip[],
  analyses: Record<string, MediaAnalysis | null>
): number | null {
  for (const clip of clips) {
    const audio = analyses[clip.mediaId]?.audio;
    if (audio?.bpm) return audio.bpm;
  }
  return null;
}

function dedupeSorted(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] > 0.08) out.push(t);
  }
  return out;
}

/** Snap a time to the nearest beat within `tolerance` seconds (or keep it). */
export function snapToBeat(time: number, beats: number[], tolerance = 0.18): number {
  let best = time;
  let bestDist = tolerance;
  for (const b of beats) {
    const d = Math.abs(b - time);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
    if (b > time + tolerance) break;
  }
  return round3(best);
}
