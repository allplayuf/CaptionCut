/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";

type CaptionQuality = "fast" | "accurate";

interface WorkerRequest {
  id: string;
  type: "transcribe" | "load";
  audio?: ArrayBuffer;
  quality: CaptionQuality;
  language: "auto" | "en" | "sv";
}

interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

interface WhisperResult {
  text: string;
  chunks?: WhisperChunk[];
}

interface AsrPipeline {
  (
    audio: Float32Array,
    options: {
      return_timestamps: true | "word";
      chunk_length_s: number;
      stride_length_s: number;
      force_full_sequences: boolean;
      language?: string;
      task: "transcribe";
    }
  ): Promise<WhisperResult | WhisperResult[]>;
  dispose?: () => Promise<void> | void;
}

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODELS: Record<CaptionQuality, string> = {
  fast: "onnx-community/whisper-tiny",
  accurate: "onnx-community/whisper-base",
};

let activePipeline: AsrPipeline | null = null;
let activeQuality: CaptionQuality | null = null;
let activeDevice: "webgpu" | "wasm" = "wasm";
let pipelineLoading: Promise<AsrPipeline> | null = null;

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  if (event.data?.type === "load") {
    void preload(event.data);
  } else if (event.data?.type === "transcribe" && event.data.audio) {
    void transcribe(event.data as WorkerRequest & { audio: ArrayBuffer });
  }
});

async function preload(request: WorkerRequest) {
  try {
    await getPipeline(request);
    ctx.postMessage({
      id: request.id,
      type: "loaded",
      model: MODELS[request.quality],
      device: activeDevice,
    });
  } catch (error) {
    ctx.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : "The local caption model could not load.",
    });
  }
}

async function transcribe(request: WorkerRequest & { audio: ArrayBuffer }) {
  try {
    const transcriber = await getPipeline(request);
    ctx.postMessage({
      id: request.id,
      type: "progress",
      stage: "transcribing",
      progress: 0,
      detail: activeDevice === "webgpu" ? "Using your GPU" : "Using your browser",
      device: activeDevice,
    });

    const language =
      request.language === "sv"
        ? "swedish"
        : request.language === "en"
          ? "english"
          : undefined;
    const output = await transcriber(new Float32Array(request.audio), {
      // Native word timestamps keep karaoke highlighting and cut remapping
      // locked to the voice. Segment timestamps forced us to guess timing by
      // character length, which visibly drifted on short and Swedish words.
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      force_full_sequences: false,
      task: "transcribe",
      ...(language ? { language } : {}),
    });
    const result = Array.isArray(output) ? output[0] : output;
    ctx.postMessage({
      id: request.id,
      type: "complete",
      result,
      model: MODELS[request.quality],
      device: activeDevice,
    });
  } catch (error) {
    ctx.postMessage({
      id: request.id,
      type: "error",
      error:
        error instanceof Error
          ? error.message
          : "The local caption engine could not finish transcription.",
    });
  }
}

async function getPipeline(request: WorkerRequest): Promise<AsrPipeline> {
  if (activePipeline && activeQuality === request.quality) return activePipeline;
  if (pipelineLoading) {
    await pipelineLoading.catch(() => undefined);
    if (activePipeline && activeQuality === request.quality) return activePipeline;
  }

  pipelineLoading = preparePipeline(request);
  try {
    return await pipelineLoading;
  } finally {
    pipelineLoading = null;
  }
}

async function preparePipeline(request: WorkerRequest): Promise<AsrPipeline> {
  if (activePipeline?.dispose) await activePipeline.dispose();
  activePipeline = null;
  activeQuality = null;

  const supportsWebGpu = "gpu" in navigator;
  if (supportsWebGpu) {
    try {
      activeDevice = "webgpu";
      activePipeline = await loadPipeline(request, "webgpu");
      activeQuality = request.quality;
      return activePipeline;
    } catch {
      ctx.postMessage({
        id: request.id,
        type: "progress",
        stage: "model",
        progress: 0,
        detail: "GPU unavailable — switching to universal mode",
        device: "wasm",
      });
      activePipeline = null;
    }
  }

  activeDevice = "wasm";
  activePipeline = await loadPipeline(request, "wasm");
  activeQuality = request.quality;
  return activePipeline;
}

async function loadPipeline(
  request: WorkerRequest,
  device: "webgpu" | "wasm"
): Promise<AsrPipeline> {
  const model = MODELS[request.quality];
  const loaded = await pipeline("automatic-speech-recognition", model, {
    device,
    dtype:
      device === "webgpu"
        ? {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
          }
        : "q8",
    progress_callback: (event: {
      status?: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      const normalized =
        typeof event.progress === "number"
          ? Math.max(0, Math.min(1, event.progress > 1 ? event.progress / 100 : event.progress))
          : event.total && event.loaded
            ? Math.max(0, Math.min(1, event.loaded / event.total))
            : 0;
      ctx.postMessage({
        id: request.id,
        type: "progress",
        stage: "model",
        progress: normalized,
        detail:
          event.status === "ready"
            ? "Caption engine ready"
            : event.file
              ? `Downloading ${shortFileName(event.file)}`
              : "Preparing local caption engine",
        device,
      });
    },
  });
  return loaded as unknown as AsrPipeline;
}

function shortFileName(file: string): string {
  const name = file.split("/").pop() ?? file;
  return name.length > 34 ? `${name.slice(0, 31)}…` : name;
}

export {};
