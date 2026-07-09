import type { Caption, TranscriptionLanguage } from "@/types";
import type { TranscriptionProvider } from "./types";
import { localWhisperProvider } from "./providers/localWhisper";
import { openAiProvider } from "./providers/openai";
import { mockProvider } from "./providers/mock";

export { TranscriptionError } from "./types";
export type { TranscriptionProvider } from "./types";

/**
 * Transcription entry point.
 *
 * The default provider is **local-whisper** (whisper.cpp): completely free,
 * runs on-device, and needs no API key. The binary (~8 MB) and the ggml model
 * (~150 MB for "base") are downloaded automatically on first use, or ahead of
 * time with `npm run setup-whisper`.
 *
 * Env:
 *   TRANSCRIPTION_PROVIDER = "local-whisper" (default) | "openai" | "mock"
 *   WHISPER_MODEL          = ggml model for local-whisper (default "base")
 *   WHISPER_CPP_PATH       = existing whisper-cli executable (optional)
 *   OPENAI_API_KEY         = only if you opt into the openai provider
 *
 * To add a provider: implement TranscriptionProvider (lib/transcription/types.ts)
 * and register it in PROVIDERS below. Everything downstream consumes Caption[].
 */

const PROVIDERS: Record<string, TranscriptionProvider> = {
  "local-whisper": localWhisperProvider,
  local: localWhisperProvider, // alias
  openai: openAiProvider,
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
  language: TranscriptionLanguage = "auto"
): Promise<{ captions: Caption[]; provider: string }> {
  const provider = resolveProvider();
  const captions = await provider.transcribe(audioPath, durationSeconds, language);
  return { captions, provider: provider.name };
}

/** Status for the UI: which provider is active and whether it can run now. */
export async function transcriptionStatus(): Promise<{ provider: string; ready: boolean }> {
  const provider = resolveProvider();
  return { provider: provider.name, ready: await provider.isReady() };
}
