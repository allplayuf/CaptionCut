import type { Caption, TranscriptionLanguage } from "@/types";

/** Contract every transcription backend implements. */
export interface TranscriptionProvider {
  name: string;
  /** true when the provider can run right now (binaries/models/keys present). */
  isReady(): Promise<boolean>;
  /**
   * @param audioPath  absolute path to a 16 kHz mono WAV file
   * @param durationSeconds  audio duration
   * @param language  "auto" lets the model detect; otherwise ISO 639-1 (en, sv, …)
   * @returns TikTok-ready caption chunks (use lib/captions/chunk.ts helpers)
   */
  transcribe(
    audioPath: string,
    durationSeconds: number,
    language: TranscriptionLanguage
  ): Promise<Caption[]>;
}

/** Error carrying a safe, human-readable message for the UI. */
export class TranscriptionError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
  }
}
