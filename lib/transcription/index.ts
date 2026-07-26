import type { Caption, TranscriptionQuality } from "@/types";
import type { TranscriptionOptions, TranscriptionProvider } from "./types";
import { localWhisperProvider } from "./providers/localWhisper";
import { mockProvider } from "./providers/mock";

export { TranscriptionError } from "./types";
export type { TranscriptionOptions, TranscriptionProvider } from "./types";

/**
 * Transcription entry point.
 *
 * Legacy server/CLI transcription entry point. The web editor now always uses
 * browser-local Whisper so footage never needs to be sent to a caption API.
 *
 * Env:
 *   TRANSCRIPTION_PROVIDER = "local-whisper" | "mock"
 *   WHISPER_MODEL          = optional override for the Fast/Accurate model mapping
 *   WHISPER_CPP_PATH       = existing whisper-cli executable (optional)
 *
 * To add a provider: implement TranscriptionProvider (lib/transcription/types.ts)
 * and register it in PROVIDERS below. Everything downstream consumes Caption[].
 */

const PROVIDERS: Record<string, TranscriptionProvider> = {
  "local-whisper": localWhisperProvider,
  local: localWhisperProvider, // alias
  mock: mockProvider,
};

export function resolveProvider(): TranscriptionProvider {
  const configured = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
  if (configured && PROVIDERS[configured]) return PROVIDERS[configured];
  return localWhisperProvider;
}

/** Main entry point: audio file in, TikTok-ready caption chunks out. */
export async function transcribeAudio(
  audioPath: string,
  durationSeconds: number,
  options: TranscriptionOptions
): Promise<{ captions: Caption[]; provider: string; model: string }> {
  const provider = resolveProvider();
  const captions = await provider.transcribe(audioPath, durationSeconds, options);
  return {
    captions,
    provider: provider.name,
    model: provider.modelName(options.quality),
  };
}

/** Status for the UI: which provider is active and whether it can run now. */
export async function transcriptionStatus(
  quality: TranscriptionQuality = "accurate"
): Promise<{
  provider: string;
  ready: boolean;
  quality: TranscriptionQuality;
  model: string;
}> {
  const provider = resolveProvider();
  return {
    provider: provider.name,
    ready: await provider.isReady(quality),
    quality,
    model: provider.modelName(quality),
  };
}
