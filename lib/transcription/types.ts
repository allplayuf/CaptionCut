import type {
  Caption,
  TranscriptionLanguage,
  TranscriptionQuality,
} from "@/types";

export interface TranscriptionOptions {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  /** Optional vocabulary/context supplied to the speech model. */
  prompt?: string;
}

/** Contract every transcription backend implements. */
export interface TranscriptionProvider {
  name: string;
  /** true when the provider can run right now (binaries/models/keys present). */
  isReady(quality: TranscriptionQuality): Promise<boolean>;
  /** Concrete model that will serve the selected quality. */
  modelName(quality: TranscriptionQuality): string;
  /**
   * @param audioPath  absolute path to a 16 kHz mono WAV file
   * @param durationSeconds  audio duration
   * @param options  spoken language, local quality and optional vocabulary prompt
   * @returns TikTok-ready caption chunks (use lib/captions/chunk.ts helpers)
   */
  transcribe(
    audioPath: string,
    durationSeconds: number,
    options: TranscriptionOptions
  ): Promise<Caption[]>;
}

/** Error carrying a safe, human-readable message for the UI. */
export class TranscriptionError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
  }
}
