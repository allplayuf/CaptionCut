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
    pending.set(id, {
      resolve: () => resolve(),
      reject,
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

  options.onProgress?.({
    stage: "audio",
    progress: 0,
    detail: "Preparing timeline audio on this device",
  });
  const audio = await buildTimelineAudio(options.clips, options.media, selected, options.onProgress);
  if (!hasAudibleSignal(audio)) {
    throw new Error("No readable speech audio was found in the selected video clips.");
  }

  const result = await runWorker(audio, options);
  const timedWords = stabilizeWordTimings(wordsFromResult(result.result))
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
  return { captions, model: modelLabel(result.model), device: result.device };
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
    pending.set(id, {
      resolve: (result) => {
        if (result.type === "complete") resolve(result);
        else reject(new Error("The local caption engine returned no transcript."));
      },
      reject,
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
  captionWorker.addEventListener("error", () => {
    const error = new Error(
      "The browser could not start the local caption engine. Reload and try Chrome or Edge."
    );
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    captionWorker?.terminate();
    captionWorker = null;
  });
  return captionWorker;
}

async function buildTimelineAudio(
  clips: Clip[],
  media: MediaAsset[],
  selected: Set<string> | undefined,
  onProgress: BrowserTranscriptionOptions["onProgress"]
): Promise<Float32Array> {
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const sourceIds = [
    ...new Set(
      clips
        .filter((clip) => !selected || selected.has(clip.id))
        .map((clip) => audioSourceForClip(clip, mediaById)?.asset.id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (sourceIds.length === 0) {
    throw new Error("The selected clips do not contain an audio source.");
  }

  const decoded = new Map<string, Float32Array>();
  const context = new AudioContext();
  try {
    for (let index = 0; index < sourceIds.length; index++) {
      const id = sourceIds[index];
      const asset = mediaById.get(id);
      if (!asset) continue;
      onProgress?.({
        stage: "audio",
        progress: index / sourceIds.length,
        detail: `Reading ${asset.originalName}`,
      });
      const response = await fetch(mediaUrl(asset));
      if (!response.ok) {
        throw new Error(`Could not read "${asset.originalName}" for local captions.`);
      }
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      decoded.set(id, resampleToMono(buffer));
    }
  } catch (error) {
    if (error instanceof Error && /Could not read/.test(error.message)) throw error;
    throw new Error(
      "This browser could not decode the video's audio. MP4 with AAC audio works best."
    );
  } finally {
    await context.close().catch(() => {});
  }

  const totalSamples = clips.reduce(
    (sum, clip) => sum + Math.round(clipDuration(clip) * TARGET_SAMPLE_RATE),
    0
  );
  const timeline = new Float32Array(totalSamples);
  let writeOffset = 0;
  clips.forEach((clip, index) => {
    const clipSamples = Math.round(clipDuration(clip) * TARGET_SAMPLE_RATE);
    const source = audioSourceForClip(clip, mediaById);
    if (source && (!selected || selected.has(clip.id))) {
      const samples = decoded.get(source.asset.id);
      if (samples) {
        const speed = clipSpeed(clip);
        const sourceStart = clip.sourceStart - source.offsetSeconds;
        for (let outIndex = 0; outIndex < clipSamples; outIndex++) {
          const sourceTime = sourceStart + (outIndex / TARGET_SAMPLE_RATE) * speed;
          const sourceIndex = Math.round(sourceTime * TARGET_SAMPLE_RATE);
          if (sourceIndex >= 0 && sourceIndex < samples.length) {
            timeline[writeOffset + outIndex] = samples[sourceIndex];
          }
        }
      }
    }
    writeOffset += clipSamples;
    onProgress?.({
      stage: "audio",
      progress: (index + 1) / clips.length,
      detail: "Building the edited audio timeline",
    });
  });
  return timeline;
}

function resampleToMono(buffer: AudioBuffer): Float32Array {
  const length = Math.max(1, Math.round(buffer.duration * TARGET_SAMPLE_RATE));
  const output = new Float32Array(length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index)
  );
  const ratio = buffer.sampleRate / TARGET_SAMPLE_RATE;
  for (let index = 0; index < length; index++) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, buffer.length - 1);
    const mix = sourcePosition - left;
    let sample = 0;
    for (const channel of channels) {
      sample += channel[left] * (1 - mix) + channel[right] * mix;
    }
    output[index] = sample / channels.length;
  }
  // Lift quiet phone recordings without clipping. Whisper is far more stable
  // when speech arrives at a predictable level, especially in the WASM path.
  let peak = 0;
  let mean = 0;
  const stride = Math.max(1, Math.floor(output.length / 200_000));
  let measured = 0;
  for (let index = 0; index < output.length; index += stride) {
    mean += output[index];
    measured++;
  }
  mean /= Math.max(1, measured);
  for (let index = 0; index < output.length; index++) {
    output[index] -= mean;
    peak = Math.max(peak, Math.abs(output[index]));
  }
  if (peak > 0.0001) {
    const gain = Math.min(10, 0.92 / peak);
    for (let index = 0; index < output.length; index++) output[index] *= gain;
  }
  return output;
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
