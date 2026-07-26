"use client";

/**
 * Decodes a video's audio track in the browser (WebAudio) and reduces it to
 * peak values for waveform drawing. Throws when the browser can't decode the
 * container/codec — callers fall back to a placeholder pattern.
 */
const MAX_DECODE_BYTES = 120 * 1024 * 1024;
let waveformTail: Promise<unknown> = Promise.resolve();
const waveformJobs = new Map<string, Promise<number[]>>();

/**
 * Queue waveform decoding one file at a time. Importing 30 videos otherwise
 * starts 30 full-file fetch + WebAudio decodes simultaneously and can exhaust
 * a browser tab before the editor has even been used.
 */
export function queueWaveformPeaks(
  key: string,
  url: string,
  sourceSize?: number,
  numPeaks = 1600
): Promise<number[]> {
  const existing = waveformJobs.get(key);
  if (existing) return existing;
  const job = waveformTail
    .catch(() => undefined)
    .then(() => computePeaks(url, numPeaks, sourceSize));
  waveformTail = job;
  waveformJobs.set(key, job);
  const release = () => {
    if (waveformJobs.get(key) === job) waveformJobs.delete(key);
  };
  void job.then(release, release);
  return job;
}

export async function computePeaks(
  url: string,
  numPeaks = 1600,
  sourceSize?: number
): Promise<number[]> {
  if (sourceSize && sourceSize > MAX_DECODE_BYTES) {
    throw new Error("file too large to decode");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("could not fetch media");
  const buffer = await response.arrayBuffer();
  // Decoding very large files can freeze the tab; placeholder is fine there.
  if (buffer.byteLength > MAX_DECODE_BYTES) throw new Error("file too large to decode");

  type AudioContextCtor = typeof AudioContext;
  const Ctor: AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const audio = await ctx.decodeAudioData(buffer);
    const channel = audio.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channel.length / numPeaks));
    const peaks: number[] = new Array(numPeaks).fill(0);

    for (let i = 0; i < numPeaks; i++) {
      const start = i * bucketSize;
      const end = Math.min(channel.length, start + bucketSize);
      let max = 0;
      // sample sparsely inside the bucket; exact peaks aren't needed for a 2px bar
      const step = Math.max(1, Math.floor((end - start) / 50));
      for (let j = start; j < end; j += step) {
        const value = Math.abs(channel[j]);
        if (value > max) max = value;
      }
      peaks[i] = max;
    }

    // Normalize so quiet recordings still show shape.
    const overallMax = Math.max(0.01, ...peaks);
    return peaks.map((p) => p / overallMax);
  } finally {
    void ctx.close();
  }
}

/** Deterministic pseudo-waveform for media whose audio can't be decoded. */
export function placeholderPeaks(seed: string, numPeaks = 1600): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  const peaks: number[] = [];
  let value = 0.5;
  for (let i = 0; i < numPeaks; i++) {
    hash = Math.imul(hash ^ (hash >>> 13), 0x5bd1e995);
    const rand = ((hash >>> 16) & 0xffff) / 0xffff;
    value = value * 0.85 + rand * 0.15; // smooth wander
    peaks.push(0.2 + value * 0.6 * (0.6 + 0.4 * Math.sin(i / 23)));
  }
  return peaks;
}
