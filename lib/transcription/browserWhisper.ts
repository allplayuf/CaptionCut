"use client";

import { nanoid } from "nanoid";
import type {
  Caption,
  Clip,
  MediaAsset,
  TranscriptionLanguage,
  TranscriptionQuality,
  WordTiming,
} from "@/types";
import { chunkWordsToCaptions } from "@/lib/captions/chunk";
import { cleanCaptions } from "@/lib/captions/clean";
import { mediaUrl } from "@/lib/video/client";

const TARGET_SAMPLE_RATE = 16_000;
const MAX_TIMELINE_SECONDS = 60 * 60;
const CAPTION_BATCH_SECONDS = 3 * 60;
const NOISE_TOKEN = /^[[(].*[\])]$/;

export interface LocalCaptionProgress {
  stage: "audio" | "model" | "transcribing";
  progress: number;
  detail: string;
  device?: "webgpu" | "wasm";
}

interface BrowserTranscriptionOptions {
  clips: Clip[];
  media: MediaAsset[];
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  selectedClipIds?: string[];
  onProgress?: (progress: LocalCaptionProgress) => void;
}

interface WorkerComplete {
  id: string;
  type: "complete";
  result: {
    text: string;
    chunks?: Array<{ text: string; timestamp: [number, number | null] }>;
  };
  model: string;
  device: "webgpu" | "wasm";
}

interface WorkerLoaded {
  id: string;
  type: "loaded";
  model: string;
  device: "webgpu" | "wasm";
}

interface WorkerProgress {
  id: string;
  type: "progress";
  stage: "model" | "transcribing";
  progress: number;
  detail: string;
  device?: "webgpu" | "wasm";
}

interface WorkerError {
  id: string;
  type: "error";
  error: string;
}

type WorkerResponse = WorkerComplete | WorkerLoaded | WorkerProgress | WorkerError;

export interface CaptionAudioSlice {
  clip: Clip;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  selected: boolean;
}

export interface CaptionAudioBatch {
  start: number;
  end: number;
  slices: CaptionAudioSlice[];
}

interface PendingRequest {
  resolve: (result: WorkerComplete | WorkerLoaded) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: LocalCaptionProgress) => void;
}

let captionWorker: Worker | null = null;
const pending = new Map<string, PendingRequest>();
const preloadPromises = new Map<TranscriptionQuality, Promise<void>>();

/** Begin the one-time model download after the first media import. */
export function preloadLocalCaptionModel(
  quality: TranscriptionQuality = "fast"
): Promise<void> {
  const existing = preloadPromises.get(quality);
  if (existing) return existing;
  const task = new Promise<void>((resolve, reject) => {
    const id = nanoid(10);
    const worker = getCaptionWorker();
    const timeout = window.setTimeout(
      () => stopCaptionWorker(new Error("The local caption model took too long to load.")),
      10 * 60 * 1000
    );
    pending.set(id, {
      resolve: () => {
        window.clearTimeout(timeout);
        resolve();
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    });
    worker.postMessage({
      id,
      type: "load",
      quality,
      language: "auto",
    });
  }).catch((error) => {
    preloadPromises.delete(quality);
    throw error;
  });
  preloadPromises.set(quality, task);
  return task;
}

export async function transcribeTimelineInBrowser(
  options: BrowserTranscriptionOptions
): Promise<{ captions: Caption[]; model: string; device: "webgpu" | "wasm" }> {
  const selected = options.selectedClipIds ? new Set(options.selectedClipIds) : undefined;
  const duration = options.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  if (duration > MAX_TIMELINE_SECONDS) {
    throw new Error("Local captions currently support timelines up to 60 minutes.");
  }

  const planned = planCaptionAudioBatches(options.clips, selected, CAPTION_BATCH_SECONDS);
  const batches = planned.filter((batch) => batch.slices.some((slice) => slice.selected));
  const allWords: WordTiming[] = [];
  let model = "";
  let device: "webgpu" | "wasm" = "wasm";
  let audibleBatches = 0;

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    options.onProgress?.({
      stage: "audio",
      progress: index / Math.max(1, batches.length),
      detail: `Preparing caption batch ${index + 1} of ${batches.length}`,
    });
    const audio = await buildCaptionBatchAudio(
      batch,
      options.media,
      index,
      batches.length,
      options.onProgress
    );
    if (!hasAudibleSignal(audio)) continue;
    audibleBatches += 1;
    options.onProgress?.({
      stage: "transcribing",
      progress: index / Math.max(1, batches.length),
      detail: `Transcribing batch ${index + 1} of ${batches.length}`,
    });
    const result = await runWorker(audio, {
      ...options,
      onProgress: (progress) =>
        options.onProgress?.({
          ...progress,
          progress:
            progress.stage === "transcribing"
              ? index / Math.max(1, batches.length)
              : progress.progress,
          detail:
            progress.stage === "transcribing"
              ? `Transcribing batch ${index + 1} of ${batches.length}`
              : progress.detail,
        }),
    });
    model = result.model;
    device = result.device;
    allWords.push(
      ...wordsFromResult(result.result).map((word) => ({
        ...word,
        startTime: word.startTime + batch.start,
        endTime: word.endTime + batch.start,
      }))
    );
    options.onProgress?.({
      stage: "transcribing",
      progress: (index + 1) / batches.length,
      detail: `Captioned ${index + 1} of ${batches.length} batches`,
      device,
    });
  }

  if (audibleBatches === 0) {
    throw new Error("No readable speech audio was found in the selected video clips.");
  }

  const timedWords = stabilizeWordTimings(allWords)
    .filter((word) => word.startTime < duration)
    .map((word) => {
      const startTime = Math.max(0, Math.min(duration, word.startTime));
      return {
        ...word,
        startTime,
        endTime: Math.max(startTime, Math.min(duration, word.endTime)),
      };
    })
    .filter((word) => word.endTime - word.startTime >= 0.02);
  let captions = cleanCaptions(chunkWordsToCaptions(timedWords));
  if (selected) {
    captions = captionsInsideRanges(captions, selectedTimelineRanges(options.clips, selected));
  }
  if (captions.length === 0) {
    throw new Error("No speech was detected. Check the language and try the accurate model.");
  }
  return { captions, model: modelLabel(model), device };
}

async function runWorker(
  audio: Float32Array,
  options: BrowserTranscriptionOptions
): Promise<WorkerComplete> {
  const worker = getCaptionWorker();
  const id = nanoid(10);
  const transferable = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => stopCaptionWorker(new Error("This caption batch took too long and was stopped safely.")),
      20 * 60 * 1000
    );
    pending.set(id, {
      resolve: (result) => {
        window.clearTimeout(timeout);
        if (result.type === "complete") resolve(result);
        else reject(new Error("The local caption engine returned no transcript."));
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
      onProgress: options.onProgress,
    });
    worker.postMessage(
      {
        id,
        type: "transcribe",
        audio: transferable,
        quality: options.quality,
        language: options.language,
      },
      [transferable]
    );
  });
}

function getCaptionWorker(): Worker {
  if (captionWorker) return captionWorker;
  captionWorker = new Worker(new URL("./browserWhisper.worker.ts", import.meta.url), {
    type: "module",
    name: "captioncut-local-whisper",
  });
  captionWorker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    if (event.data.type === "progress") {
      request.onProgress?.({
        stage: event.data.stage,
        progress: event.data.progress,
        detail: event.data.detail,
        device: event.data.device,
      });
      return;
    }
    pending.delete(event.data.id);
    if (event.data.type === "error") {
      request.reject(
        new Error(
          `${event.data.error} Try Chrome or Edge for the fastest local caption support.`
        )
      );
    } else {
      request.resolve(event.data);
    }
  });
  captionWorker.addEventListener("error", () =>
    stopCaptionWorker(
      new Error("The browser could not start the local caption engine. Reload and try Chrome or Edge.")
    )
  );
  return captionWorker;
}

function stopCaptionWorker(error: Error): void {
  const worker = captionWorker;
  captionWorker = null;
  worker?.terminate();
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

/**
 * Split the edited timeline into bounded audio batches. Long source clips are
 * sliced as needed, while timeline positions remain exact across boundaries.
 */
export function planCaptionAudioBatches(
  clips: Clip[],
  selected: Set<string> | undefined,
  maxBatchSeconds = CAPTION_BATCH_SECONDS
): CaptionAudioBatch[] {
  const target = Math.max(30, maxBatchSeconds);
  const hardLimit = target + Math.min(30, target * 0.2);
  const batches: CaptionAudioBatch[] = [];
  let slices: CaptionAudioSlice[] = [];
  let batchStart = 0;
  let batchDuration = 0;
  let timelineCursor = 0;

  const finish = () => {
    if (slices.length === 0) return;
    batches.push({ start: batchStart, end: batchStart + batchDuration, slices });
    slices = [];
    batchDuration = 0;
  };

  for (const clip of clips) {
    const speed = clipSpeed(clip);
    const duration = clipDuration(clip);
    if (duration <= 0.0005) continue;
    // Prefer real clip joins over arbitrary audio cuts. A small amount of
    // headroom keeps a spoken word from being split just because the target
    // batch duration landed in the middle of a source clip.
    if (duration <= hardLimit) {
      if (slices.length > 0 && batchDuration + duration > hardLimit) finish();
      if (slices.length === 0) batchStart = timelineCursor;
      slices.push({
        clip,
        timelineStart: timelineCursor,
        timelineEnd: timelineCursor + duration,
        sourceStart: clip.sourceStart,
        selected: !selected || selected.has(clip.id),
      });
      batchDuration += duration;
      timelineCursor += duration;
      if (batchDuration >= target) finish();
      continue;
    }

    if (slices.length > 0) finish();
    let consumed = 0;
    while (consumed < duration - 0.0005) {
      if (slices.length === 0) batchStart = timelineCursor + consumed;
      const available = target - batchDuration;
      const take = Math.min(duration - consumed, available);
      const sliceStart = timelineCursor + consumed;
      slices.push({
        clip,
        timelineStart: sliceStart,
        timelineEnd: sliceStart + take,
        sourceStart: clip.sourceStart + consumed * speed,
        selected: !selected || selected.has(clip.id),
      });
      batchDuration += take;
      consumed += take;
      if (target - batchDuration < 0.0005) finish();
    }
    timelineCursor += duration;
  }
  finish();
  return batches;
}

async function buildCaptionBatchAudio(
  batch: CaptionAudioBatch,
  media: MediaAsset[],
  batchIndex: number,
  batchCount: number,
  onProgress: BrowserTranscriptionOptions["onProgress"]
): Promise<Float32Array> {
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const grouped = new Map<
    string,
    { source: { asset: MediaAsset; offsetSeconds: number }; slices: CaptionAudioSlice[] }
  >();
  for (const slice of batch.slices) {
    if (!slice.selected) continue;
    const source = audioSourceForClip(slice.clip, mediaById);
    if (!source) continue;
    const entry = grouped.get(source.asset.id) ?? { source, slices: [] };
    entry.slices.push(slice);
    grouped.set(source.asset.id, entry);
  }
  const sources = [...grouped.values()];
  const sourceIds = sources.map((entry) => entry.source.asset.id);
  if (sourceIds.length === 0) {
    return new Float32Array(Math.max(1, Math.round((batch.end - batch.start) * TARGET_SAMPLE_RATE)));
  }

  const totalSamples = Math.max(1, Math.round((batch.end - batch.start) * TARGET_SAMPLE_RATE));
  const timeline = new Float32Array(totalSamples);
  type AudioContextCtor = typeof AudioContext;
  const Ctor: AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  const context = new Ctor();
  try {
    for (let index = 0; index < sources.length; index++) {
      const { source, slices: sourceSlices } = sources[index];
      const asset = source.asset;
      onProgress?.({
        stage: "audio",
        progress: (batchIndex + index / Math.max(1, sources.length)) / Math.max(1, batchCount),
        detail: `Reading ${asset.originalName} (${batchIndex + 1}/${batchCount})`,
      });
      const response = await fetch(mediaUrl(asset));
      if (!response.ok) {
        throw new Error(`Could not read "${asset.originalName}" for local captions.`);
      }
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const level = measureAudioBuffer(buffer);
      for (const slice of sourceSlices) {
        writeAudioSlice(timeline, batch.start, slice, source.offsetSeconds, buffer, level);
      }
    }
  } catch (error) {
    if (error instanceof Error && /Could not read/.test(error.message)) throw error;
    throw new Error(
      "This browser could not decode the video's audio. MP4 with AAC audio works best."
    );
  } finally {
    await context.close().catch(() => {});
  }

  return timeline;
}

function measureAudioBuffer(buffer: AudioBuffer): { mean: number; gain: number } {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index)
  );
  let mean = 0;
  const stride = Math.max(1, Math.floor(buffer.length / 200_000));
  let measured = 0;
  for (let index = 0; index < buffer.length; index += stride) {
    for (const channel of channels) mean += channel[index];
    measured++;
  }
  mean /= Math.max(1, measured * channels.length);
  let peak = 0;
  for (let index = 0; index < buffer.length; index += stride) {
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[index] - mean));
  }
  return { mean, gain: peak > 0.0001 ? Math.min(10, 0.92 / peak) : 1 };
}

function writeAudioSlice(
  timeline: Float32Array,
  batchStart: number,
  slice: CaptionAudioSlice,
  sourceOffsetSeconds: number,
  buffer: AudioBuffer,
  level: { mean: number; gain: number }
): void {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index)
  );
  const speed = clipSpeed(slice.clip);
  const outputStart = Math.max(0, Math.round((slice.timelineStart - batchStart) * TARGET_SAMPLE_RATE));
  const outputLength = Math.max(0, Math.round((slice.timelineEnd - slice.timelineStart) * TARGET_SAMPLE_RATE));
  for (let index = 0; index < outputLength && outputStart + index < timeline.length; index++) {
    const sourceTime = slice.sourceStart - sourceOffsetSeconds + (index / TARGET_SAMPLE_RATE) * speed;
    const position = sourceTime * buffer.sampleRate;
    const left = Math.floor(position);
    if (left < 0 || left >= buffer.length) continue;
    const right = Math.min(left + 1, buffer.length - 1);
    const mix = position - left;
    let sample = 0;
    for (const channel of channels) {
      sample += channel[left] * (1 - mix) + channel[right] * mix;
    }
    timeline[outputStart + index] = ((sample / channels.length) - level.mean) * level.gain;
  }
}

function audioSourceForClip(
  clip: Clip,
  mediaById: Map<string, MediaAsset>
): { asset: MediaAsset; offsetSeconds: number } | null {
  const video = mediaById.get(clip.mediaId);
  if (!video) return null;
  const linked = video.linkedAudio
    ? mediaById.get(video.linkedAudio.audioAssetId)
    : undefined;
  if (linked?.hasAudio) {
    return { asset: linked, offsetSeconds: video.linkedAudio?.offsetSeconds ?? 0 };
  }
  return video.hasAudio ? { asset: video, offsetSeconds: 0 } : null;
}

function wordsFromResult(result: WorkerComplete["result"]): WordTiming[] {
  const chunks = result.chunks ?? [];
  return chunks
    .flatMap((chunk, index) => {
      const tokens = chunk.text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return [];
      const startTime = Math.max(0, Number(chunk.timestamp?.[0]) || 0);
      const nextStart = Number(chunks[index + 1]?.timestamp?.[0]);
      const rawEnd = Number(chunk.timestamp?.[1]);
      const endTime = Number.isFinite(rawEnd)
        ? rawEnd
        : Number.isFinite(nextStart)
          ? nextStart
          : startTime + Math.max(0.35, tokens.length * 0.28);
      const duration = Math.max(0.02, endTime - startTime);
      const weights = tokens.map((token) =>
        Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, "").length)
      );
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let cursor = startTime;
      return tokens.map((word, tokenIndex) => {
        const tokenEnd =
          tokenIndex === tokens.length - 1
            ? endTime
            : cursor + duration * (weights[tokenIndex] / totalWeight);
        const timing = {
          word,
          startTime: cursor,
          endTime: Math.max(cursor + 0.02, tokenEnd),
        };
        cursor = tokenEnd;
        return timing;
      });
    })
    .filter((word) => word.word && !NOISE_TOKEN.test(word.word));
}

/**
 * Removes rare overlap duplicates from chunked Whisper output and ensures a
 * monotonic word clock. The actual timestamps stay intact whenever possible.
 */
function stabilizeWordTimings(words: WordTiming[]): WordTiming[] {
  const stable: WordTiming[] = [];
  for (const candidate of words) {
    const word = candidate.word.trim();
    if (!word) continue;
    const previous = stable[stable.length - 1];
    const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const previousNormalized = previous?.word
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (
      previous &&
      normalized &&
      normalized === previousNormalized &&
      candidate.startTime < previous.endTime + 0.08
    ) {
      previous.endTime = Math.max(previous.endTime, candidate.endTime);
      continue;
    }
    const startTime = Math.max(0, previous ? Math.max(candidate.startTime, previous.endTime) : candidate.startTime);
    const endTime = Math.max(startTime + 0.02, candidate.endTime);
    stable.push({ ...candidate, word, startTime, endTime });
  }
  return stable;
}

function hasAudibleSignal(audio: Float32Array): boolean {
  if (audio.length === 0) return false;
  const stride = Math.max(1, Math.floor(audio.length / 200_000));
  let energy = 0;
  let count = 0;
  for (let index = 0; index < audio.length; index += stride) {
    energy += Math.abs(audio[index]);
    count++;
  }
  return energy / Math.max(1, count) > 0.00001;
}

function clipSpeed(clip: Clip): number {
  return Math.min(2, Math.max(0.5, clip.speed && clip.speed > 0 ? clip.speed : 1));
}

function clipDuration(clip: Clip): number {
  return Math.max(0, (clip.sourceEnd - clip.sourceStart) / clipSpeed(clip));
}

function selectedTimelineRanges(clips: Clip[], selected: Set<string>) {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const clip of clips) {
    const end = cursor + clipDuration(clip);
    if (selected.has(clip.id)) {
      const previous = ranges[ranges.length - 1];
      if (previous && cursor <= previous.end + 0.002) previous.end = end;
      else ranges.push({ start: cursor, end });
    }
    cursor = end;
  }
  return ranges;
}

function captionsInsideRanges(
  captions: Caption[],
  ranges: Array<{ start: number; end: number }>
): Caption[] {
  return captions.flatMap((caption) => {
    const words = (caption.words ?? []).filter((word) =>
      ranges.some((range) => {
        const midpoint = (word.startTime + word.endTime) / 2;
        return midpoint >= range.start - 0.002 && midpoint <= range.end + 0.002;
      })
    );
    if (words.length === 0) return [];
    return [
      {
        ...caption,
        startTime: words[0].startTime,
        endTime: words[words.length - 1].endTime,
        text: words.map((word) => word.word).join(" "),
        words,
      },
    ];
  });
}

function modelLabel(model: string): string {
  return model.endsWith("whisper-base") ? "Whisper Base" : "Whisper Tiny";
}
