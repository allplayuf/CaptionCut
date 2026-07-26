import type {
  AudioAnalysis,
  BeatSettings,
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

const ANALYSIS_BATCH_SIZE = 4;
const ANALYSIS_BATCH_DELAY_MS = 60;

export interface AnalysisProgress {
  completed: number;
  total: number;
  current?: string;
}

interface QueuedAnalysis {
  asset: MediaAsset;
  promise: Promise<MediaAnalysis | null>;
  resolve: (analysis: MediaAnalysis | null) => void;
  reject: (error: Error) => void;
}

const analysisJobs = new Map<string, QueuedAnalysis>();
const analysisQueue: string[] = [];
let drainingAnalyses = false;

/** Fetch (and lazily compute) analyses for the given assets. */
export async function fetchAnalyses(
  media: MediaAsset[],
  onProgress?: (progress: AnalysisProgress) => void
): Promise<Record<string, MediaAnalysis | null>> {
  if (media.length === 0) return {};
  const unique = [...new Map(media.map((asset) => [asset.id, asset])).values()];
  let completed = 0;
  const settled = await Promise.all(
    unique.map(async (asset) => {
      try {
        const analysis = await enqueueAnalysis(asset);
        return { asset, analysis, failed: false };
      } catch {
        return { asset, analysis: null, failed: true };
      } finally {
        completed += 1;
        onProgress?.({ completed, total: unique.length, current: asset.originalName });
      }
    })
  );
  if (settled.every((item) => item.failed)) {
    throw new Error("Media analysis failed.");
  }
  return Object.fromEntries(settled.map(({ asset, analysis }) => [asset.id, analysis]));
}

function enqueueAnalysis(asset: MediaAsset): Promise<MediaAnalysis | null> {
  const existing = analysisJobs.get(asset.id);
  if (existing) return existing.promise;
  let resolve!: (analysis: MediaAnalysis | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MediaAnalysis | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  analysisJobs.set(asset.id, { asset, promise, resolve, reject });
  analysisQueue.push(asset.id);
  void drainAnalysisQueue();
  return promise;
}

async function drainAnalysisQueue(): Promise<void> {
  if (drainingAnalyses) return;
  drainingAnalyses = true;
  await new Promise((resolve) => setTimeout(resolve, ANALYSIS_BATCH_DELAY_MS));
  try {
    while (analysisQueue.length > 0) {
      const ids = analysisQueue.splice(0, ANALYSIS_BATCH_SIZE);
      const jobs = ids
        .map((id) => analysisJobs.get(id))
        .filter((job): job is QueuedAnalysis => Boolean(job));
      if (jobs.length === 0) continue;
      try {
        const analyses = await requestAnalysisBatch(jobs.map((job) => job.asset));
        for (const job of jobs) job.resolve(analyses[job.asset.id] ?? null);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Media analysis failed.");
        for (const job of jobs) job.reject(failure);
      } finally {
        for (const job of jobs) analysisJobs.delete(job.asset.id);
      }
    }
  } finally {
    drainingAnalyses = false;
    if (analysisQueue.length > 0) void drainAnalysisQueue();
  }
}

async function requestAnalysisBatch(
  media: MediaAsset[]
): Promise<Record<string, MediaAnalysis | null>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const result = await postAnalysisBatch(media);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Media analysis failed.");
    }
  }
  throw lastError ?? new Error("Media analysis failed.");
}

async function postAnalysisBatch(
  media: MediaAsset[]
): Promise<Record<string, MediaAnalysis | null>> {
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
  analyses: Record<string, MediaAnalysis | null>,
  beatSettings?: BeatSettings
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
    const asset = mediaById.get(clip.mediaId);
    const analysis = analyses[clip.mediaId];
    const linked = asset?.linkedAudio;
    const linkedAsset = linked ? mediaById.get(linked.audioAssetId) : undefined;
    const linkedAnalysis = linked ? analyses[linked.audioAssetId] : undefined;
    const audio = linkedAnalysis?.audio ?? analysis?.audio ?? null;
    const audioOffset = linkedAnalysis?.audio ? linked?.offsetSeconds ?? 0 : 0;
    const video = analysis?.video ?? null;
    if (linkedAsset?.hasAudio || asset?.hasAudio) hasAudio = true;

    // Clip joins are hard cuts by construction (skip t=0).
    if (cursor > 0.05) sceneChanges.push(round3(cursor));

    if (analysis || audio) {
      if (audio || video) anySignal = true;
      // Stored envelopes are normalized inside each source asset. Put audio
      // back onto a shared scale before comparing clips, otherwise a tiny
      // noise peak in a quiet file ranks like a genuinely loud celebration.
      const audioWeight = audio ? loudnessWeight(audio.loudness) : 1;
      const motionWeight = video?.motionIntensity ?? 0.65;
      const from = Math.floor(cursor * SIGNAL_RATE);
      const to = Math.min(bins, Math.ceil((cursor + clipDur) * SIGNAL_RATE));
      for (let b = from; b < to; b++) {
        const srcT = clip.sourceStart + (b / SIGNAL_RATE - cursor) * speed;
        if (audio) {
          const audioT = srcT - audioOffset;
          const i = Math.floor(audioT * audio.rate);
          if (i >= 0 && i < audio.energy.length) {
            energy[b] = round3(audio.energy[i] * audioWeight);
          }
        }
        if (video) {
          const i = Math.min(video.motion.length - 1, Math.floor(srcT * video.rate));
          if (i >= 0) motion[b] = round3(video.motion[i] * motionWeight);
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
          const videoSourceBeat = beat + audioOffset;
          if (videoSourceBeat >= clip.sourceStart && videoSourceBeat <= clip.sourceEnd) {
            footageBeats.push(round3(cursor + (videoSourceBeat - clip.sourceStart) / speed));
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
  let bpm = music?.beats.length ? music.bpm : footageBeatsBpm(clips, mediaById, analyses);
  let beatSource: NonNullable<TimelineSignals["beatSource"]> = music?.beats.length
    ? "music"
    : "footage";

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

  // User beat controls win over everything detected.
  if (beatSettings?.beatSyncEnabled === false) {
    beats = [];
    bpm = null;
  } else if (beatSettings?.bpmOverride && beatSettings.bpmOverride > 0) {
    const grid = manualBeatGrid(beatSettings.bpmOverride, beats, duration);
    beats = grid;
    bpm = beatSettings.bpmOverride;
    beatSource = "manual";
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
 * Convert overall dBFS loudness into a conservative cross-source ranking
 * weight. -18 dBFS and louder keep full weight; very quiet recordings are
 * reduced but never discarded because phone microphones vary considerably.
 */
function loudnessWeight(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0.5;
  const linear = 10 ** ((dbfs + 18) / 20);
  return Math.max(0.12, Math.min(1.15, linear));
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
  mediaById: Map<string, MediaAsset>,
  analyses: Record<string, MediaAnalysis | null>
): number | null {
  for (const clip of clips) {
    const linkedId = mediaById.get(clip.mediaId)?.linkedAudio?.audioAssetId;
    const audio = (linkedId ? analyses[linkedId]?.audio : null) ?? analyses[clip.mediaId]?.audio;
    if (audio?.bpm) return audio.bpm;
  }
  return null;
}

/**
 * Evenly spaced grid at a manual BPM, phase-aligned to the first detected
 * beat (or 0 when nothing was detected) so it still lines up with the music.
 */
function manualBeatGrid(bpm: number, detected: number[], duration: number): number[] {
  const spacing = 60 / Math.min(300, Math.max(30, bpm));
  const phase = detected.length > 0 ? detected[0] % spacing : 0;
  const out: number[] = [];
  for (let t = phase; t <= duration + 0.001; t += spacing) out.push(round3(t));
  return out;
}

/**
 * Beat instants for the timeline ruler: the soundtrack's detected (or
 * manual-BPM) grid in timeline seconds, plus its confidence and origin.
 * Returns null when beat sync is off or there is nothing to show.
 */
export function timelineBeatMarkers(
  tracks: Track[],
  analyses: Record<string, MediaAnalysis | null>,
  beatSettings: BeatSettings | undefined,
  duration: number
): { beats: number[]; bpm: number | null; source: "music" | "manual"; confidence: number } | null {
  if (duration <= 0.2 || beatSettings?.beatSyncEnabled === false) return null;
  const music = musicBeats(tracks, analyses);
  const confidence = musicBeatConfidence(tracks, analyses);
  if (beatSettings?.bpmOverride && beatSettings.bpmOverride > 0) {
    const beats = manualBeatGrid(beatSettings.bpmOverride, music?.beats ?? [], duration).filter(
      (t) => t <= duration
    );
    return { beats, bpm: beatSettings.bpmOverride, source: "manual", confidence: 1 };
  }
  if (!music || music.beats.length === 0) return null;
  return {
    beats: music.beats.filter((t) => t <= duration),
    bpm: music.bpm,
    source: "music",
    confidence,
  };
}

/** Detection confidence (0..1) of the soundtrack's beat grid. */
export function musicBeatConfidence(
  tracks: Track[],
  analyses: Record<string, MediaAnalysis | null>
): number {
  const track = findTrack(tracks, "music");
  if (!track) return 0;
  for (const clip of track.clips) {
    const audio = clip.assetId ? analyses[clip.assetId]?.audio : null;
    if (audio) return Math.max(0, Math.min(1, audio.beatConfidence));
  }
  return 0;
}

function dedupeSorted(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] > 0.08) out.push(t);
  }
  return out;
}

/**
 * Best starting point (source seconds) for playing `targetLen` seconds of a
 * song: the window with the highest sustained energy, with a bonus for a
 * strong energy RISE at the window start (a drop/chorus entry beats the
 * middle of one). The start is snapped onto a beat so bar one lands on the
 * first frame.
 */
export function findBestMusicStart(
  audio: Pick<AudioAnalysis, "rate" | "energy" | "beats">,
  songDuration: number,
  targetLen: number
): number {
  const { rate, energy } = audio;
  const n = energy.length;
  const winLen = Math.min(targetLen, songDuration);
  const win = Math.max(1, Math.round(winLen * rate));
  if (n <= win + rate) return 0; // song barely longer than what we need

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + energy[i];
  const mean = (a: number, b: number) => (prefix[b] - prefix[a]) / Math.max(1, b - a);

  const ctx = Math.round(3 * rate); // 3s context for the "section entry" bonus
  const step = Math.max(1, Math.round(rate / 4));
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i + win <= n; i += step) {
    const inside = mean(i, i + win);
    const before = i > 0 ? mean(Math.max(0, i - ctx), i) : 0;
    const entry = mean(i, Math.min(n, i + ctx));
    const score = inside + 0.6 * Math.max(0, entry - before);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  let t = bestIdx / rate;
  // Land on a beat so the montage starts on the bar, not just near it.
  if (audio.beats.length > 0) {
    let nearest = audio.beats[0];
    let dist = Infinity;
    for (const b of audio.beats) {
      const d = Math.abs(b - t);
      if (d < dist) {
        dist = d;
        nearest = b;
      }
    }
    if (dist < 1.2) t = nearest;
  }
  return round3(Math.max(0, Math.min(t, Math.max(0, songDuration - winLen))));
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
