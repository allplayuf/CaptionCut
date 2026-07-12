import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { AudioAnalysis, MediaAnalysis, VideoAnalysis } from "@/types";
import { FFMPEG } from "./ffmpeg";
import { ANALYSIS_DIR, MEDIA_DIR, ensureDataDirs, safeId } from "./paths";

/**
 * Local media analysis — the auto editor's "eyes and ears". Two fast FFmpeg
 * passes per asset (no API, nothing leaves the machine):
 *
 *  AUDIO  decode to 8 kHz mono PCM → RMS energy envelope (20 Hz), overall
 *         loudness, and a beat grid (onset autocorrelation → BPM + phase).
 *         Loud bursts = cheering, laughter, a ball being struck; beats let
 *         cuts land on music.
 *
 *  VIDEO  6 fps thumbnail pass through signalstats → per-frame luma
 *         difference (YDIF) = motion curve; spikes = hard cuts/scene changes.
 *         Fast movement = tackles, sprints, celebrations.
 *
 * Results are cached in data/analysis/<assetId>.json (invalidated by VERSION).
 */

const VERSION = 4;
/** Samples/sec of the stored energy curve. */
const AUDIO_RATE = 20;
/** Internal envelope rate used for beat detection (finer phase accuracy). */
const ONSET_RATE = 50;
const PCM_RATE = 8000;
/** Video sampling fps for the motion curve. */
const VIDEO_RATE = 6;
/** Sampling fps + tiny frame size for the motion-center (smart crop) pass. */
const CENTER_RATE = 3;
const CENTER_W = 48;
const CENTER_H = 27;

const ANALYZE_TIMEOUT_MS = 4 * 60 * 1000;

export async function analyzeAsset(
  assetId: string,
  filename: string,
  opts: { hasAudio: boolean; hasVideo: boolean; duration: number }
): Promise<MediaAnalysis | null> {
  ensureDataDirs();
  const cacheFile = path.join(ANALYSIS_DIR, `${safeId(assetId)}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as MediaAnalysis;
    if (cached.version === VERSION) return cached;
  } catch {
    // no cache / stale — analyze fresh
  }

  const file = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(file)) return null;

  // Each pass is independent; a failure in one shouldn't kill the other.
  const [audio, video] = await Promise.all([
    opts.hasAudio ? analyzeAudio(file).catch(() => null) : Promise.resolve(null),
    opts.hasVideo ? analyzeVideo(file).catch(() => null) : Promise.resolve(null),
  ]);
  if (!audio && !video) return null;

  const analysis: MediaAnalysis = {
    version: VERSION,
    assetId,
    duration: opts.duration,
    audio,
    video,
  };
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(analysis), "utf8");
  } catch {
    // cache write is best-effort
  }
  return analysis;
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

async function analyzeAudio(file: string): Promise<AudioAnalysis | null> {
  const pcm = await runFfmpegCapture([
    "-i", file,
    "-vn",
    "-ac", "1",
    "-ar", String(PCM_RATE),
    "-f", "s16le",
    "-",
  ]);
  const samples = pcm.length >> 1;
  if (samples < PCM_RATE / 2) return null; // < 0.5s of audio

  // Fine-grained RMS envelope for beats, coarser one for storage.
  const fine = rmsEnvelope(pcm, samples, ONSET_RATE);
  const energyRaw = rmsEnvelope(pcm, samples, AUDIO_RATE);

  // Overall loudness in dBFS from mean square (before normalization).
  const meanSq = energyRaw.reduce((s, v) => s + v * v, 0) / Math.max(1, energyRaw.length);
  const loudness = 10 * Math.log10(Math.max(1e-10, meanSq));

  const peak = Math.max(1e-6, ...energyRaw);
  const energy = energyRaw.map((v) => round3(v / peak));

  const beat = detectBeats(fine, ONSET_RATE);

  return {
    rate: AUDIO_RATE,
    energy,
    loudness: Math.round(loudness * 10) / 10,
    bpm: beat?.bpm ?? null,
    beatConfidence: beat ? Math.round(beat.confidence * 100) / 100 : 0,
    beats: beat?.beats ?? [],
  };
}

/** RMS per window of s16le PCM, as linear 0..1 values. */
function rmsEnvelope(pcm: Buffer, samples: number, rate: number): number[] {
  const win = Math.max(1, Math.floor(PCM_RATE / rate));
  const bins = Math.floor(samples / win);
  const out = new Array<number>(bins);
  for (let b = 0; b < bins; b++) {
    let sum = 0;
    const from = b * win;
    for (let i = 0; i < win; i++) {
      const v = pcm.readInt16LE((from + i) * 2) / 32768;
      sum += v * v;
    }
    out[b] = Math.sqrt(sum / win);
  }
  return out;
}

interface BeatResult {
  bpm: number;
  confidence: number;
  beats: number[];
}

/**
 * Beat detection: onset strength (positive energy flux) → autocorrelation
 * over the 60–200 BPM lag range → phase fit. Cheap, dependency-free, and
 * good enough to snap cuts to; when the audio isn't musical the confidence
 * gate keeps bpm null so nothing downstream pretends there's a beat.
 */
function detectBeats(env: number[], rate: number): BeatResult | null {
  if (env.length < rate * 8) return null; // need ~8s to trust a tempo

  const onset = new Array<number>(env.length).fill(0);
  for (let i = 1; i < env.length; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  const onsetMean = onset.reduce((s, v) => s + v, 0) / onset.length;
  if (onsetMean < 1e-5) return null;

  const minLag = Math.max(2, Math.round((rate * 60) / 200)); // 200 BPM
  const maxLag = Math.min(env.length >> 1, Math.round((rate * 60) / 60)); // 60 BPM
  if (maxLag <= minLag) return null;

  let bestLag = 0;
  let bestScore = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < onset.length; i++) s += onset[i] * onset[i + lag];
    s /= onset.length - lag;
    // Reward lags whose double also correlates (true tempo vs. half/double).
    scoreSum += s;
    scoreCount++;
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  const meanScore = scoreSum / Math.max(1, scoreCount);
  const confidence = meanScore > 0 ? bestScore / meanScore : 0;
  // Non-musical audio (speech, crowd) autocorrelates weakly and flatly.
  if (confidence < 2.0 || bestLag === 0) return null;

  // Phase: offset with the strongest onsets on the grid.
  let bestOffset = 0;
  let bestPhaseScore = -1;
  for (let off = 0; off < bestLag; off++) {
    let s = 0;
    let n = 0;
    for (let i = off; i < onset.length; i += bestLag) {
      s += onset[i];
      n++;
    }
    if (n > 0 && s / n > bestPhaseScore) {
      bestPhaseScore = s / n;
      bestOffset = off;
    }
  }

  // Walk the grid, re-anchoring each beat on the strongest nearby onset so
  // the integer-lag quantization error can't accumulate into drift (the true
  // period is rarely a whole number of envelope samples).
  const beatIdx: number[] = [];
  const search = Math.max(1, Math.round(bestLag * 0.15));
  let pos = bestOffset;
  while (pos < onset.length) {
    const center = Math.round(pos);
    let anchor = center;
    let anchorV = -1;
    for (let j = Math.max(0, center - search); j <= Math.min(onset.length - 1, center + search); j++) {
      if (onset[j] > anchorV) {
        anchorV = onset[j];
        anchor = j;
      }
    }
    beatIdx.push(anchor);
    pos = anchor + bestLag;
  }

  // Half-tempo guard: autocorrelation peaks on tempo MULTIPLES, so a 128 BPM
  // track often wins at the 64 BPM lag. If the midpoints between beats carry
  // onsets nearly as strong as the beats themselves, the tempo is double.
  let bpm = Math.round((rate * 60) / bestLag);
  if (beatIdx.length > 5 && bpm * 2 <= 200) {
    let onSum = 0;
    let midSum = 0;
    const halves: number[] = [];
    for (let k = 0; k + 1 < beatIdx.length; k++) {
      const mid = Math.round((beatIdx[k] + beatIdx[k + 1]) / 2);
      let mv = -1;
      let mi = mid;
      for (let j = Math.max(0, mid - 2); j <= Math.min(onset.length - 1, mid + 2); j++) {
        if (onset[j] > mv) {
          mv = onset[j];
          mi = j;
        }
      }
      onSum += onset[beatIdx[k]];
      midSum += mv;
      halves.push(mi);
    }
    if (midSum >= 0.55 * onSum) {
      const merged = [...new Set([...beatIdx, ...halves])].sort((a, b) => a - b);
      beatIdx.length = 0;
      beatIdx.push(...merged);
      bpm *= 2;
    }
  }

  return {
    bpm,
    confidence,
    beats: beatIdx.map((i) => round3(i / rate)),
  };
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

async function analyzeVideo(file: string): Promise<VideoAnalysis | null> {
  // Tiny grayscale frames → signalstats YDIF (mean |luma delta| per frame).
  // The motion-center pass runs in parallel; it's optional (null on failure).
  const [out, center] = await Promise.all([
    runFfmpegCapture([
      "-i", file,
      "-an",
      "-vf", `fps=${VIDEO_RATE},scale=96:-2,signalstats,metadata=mode=print:file=-`,
      "-f", "null",
      "-",
    ]),
    analyzeMotionCenter(file).catch(() => null),
  ]);

  const times: number[] = [];
  const ydif: number[] = [];
  let lastTime = -1;
  for (const line of out.toString("utf8").split(/\r?\n/)) {
    const frame = /pts_time:([\d.]+)/.exec(line);
    if (frame) {
      lastTime = parseFloat(frame[1]);
      continue;
    }
    const dif = /lavfi\.signalstats\.YDIF=([\d.]+)/.exec(line);
    if (dif && lastTime >= 0) {
      times.push(lastTime);
      ydif.push(parseFloat(dif[1]));
    }
  }
  if (ydif.length < 4) return null;

  // Scene changes: YDIF spikes well above the local norm.
  const mean = ydif.reduce((s, v) => s + v, 0) / ydif.length;
  const std = Math.sqrt(ydif.reduce((s, v) => s + (v - mean) ** 2, 0) / ydif.length);
  const cutThreshold = Math.max(mean + 3 * std, 12);
  const sceneChanges: number[] = [];
  for (let i = 1; i < ydif.length; i++) {
    if (ydif[i] >= cutThreshold && (sceneChanges.length === 0 || times[i] - sceneChanges[sceneChanges.length - 1] > 0.5)) {
      sceneChanges.push(round3(times[i]));
    }
  }

  // Motion curve: normalize with scene-cut spikes clamped out so a single
  // hard cut doesn't flatten the rest of the curve.
  const clamped = ydif.map((v) => Math.min(v, cutThreshold));
  const peak = Math.max(1e-6, ...clamped);
  const motion = clamped.map((v) => round3(v / peak));

  return {
    rate: VIDEO_RATE,
    motion,
    sceneChanges,
    motionCenterX: center ?? undefined,
    motionCenterRate: center ? CENTER_RATE : undefined,
  };
}

/**
 * Motion-center pass for smart cropping: decode tiny grayscale frames, diff
 * consecutive frames per column, and take the horizontal centroid of the
 * change. On football footage this tracks the players/ball cluster, so a
 * horizontal clip can be cropped to 9:16 around the action instead of dead
 * center. Values are 0..1 (left..right), smoothed over ~1s.
 */
async function analyzeMotionCenter(file: string): Promise<number[] | null> {
  const raw = await runFfmpegCapture([
    "-i", file,
    "-an",
    "-vf", `fps=${CENTER_RATE},scale=${CENTER_W}:${CENTER_H}`,
    "-pix_fmt", "gray",
    "-f", "rawvideo",
    "-",
  ]);
  const frameSize = CENTER_W * CENTER_H;
  const frames = Math.floor(raw.length / frameSize);
  if (frames < 3) return null;

  const centers = new Array<number>(frames).fill(0.5);
  const colDiff = new Array<number>(CENTER_W);
  for (let f = 1; f < frames; f++) {
    colDiff.fill(0);
    const prev = (f - 1) * frameSize;
    const curr = f * frameSize;
    for (let y = 0; y < CENTER_H; y++) {
      const row = y * CENTER_W;
      for (let x = 0; x < CENTER_W; x++) {
        colDiff[x] += Math.abs(raw[curr + row + x] - raw[prev + row + x]);
      }
    }
    let mass = 0;
    let weighted = 0;
    for (let x = 0; x < CENTER_W; x++) {
      mass += colDiff[x];
      weighted += colDiff[x] * (x + 0.5);
    }
    // Too little change (static shot / global pan noise floor) → stay centered.
    centers[f] = mass > CENTER_H * 8 ? weighted / (mass * CENTER_W) : 0.5;
  }
  centers[0] = centers[1];

  // ~1s moving average keeps the crop from twitching frame to frame.
  const half = Math.max(1, Math.round(CENTER_RATE / 2));
  const smoothed = centers.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(frames - 1, i + half); j++) {
      sum += centers[j];
      n++;
    }
    return round3(sum / n);
  });
  return smoothed;
}

/* ------------------------------------------------------------------ */

/** Run ffmpeg capturing stdout as a Buffer (stderr only kept for errors). */
function runFfmpegCapture(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], {
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let stderrTail = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("analysis timed out"));
    }, ANALYZE_TIMEOUT_MS);

    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-2000);
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg analysis exited ${code}: ${stderrTail}`));
    });
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
