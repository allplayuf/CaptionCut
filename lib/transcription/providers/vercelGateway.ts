import fs from "fs";
import { gateway } from "@ai-sdk/gateway";
import { transcribe } from "ai";
import type { WordTiming } from "@/types";
import { chunkWordsToCaptions } from "@/lib/captions/chunk";
import { TranscriptionError, type TranscriptionProvider } from "../types";

const DEFAULT_MODEL = "openai/whisper-1";

/**
 * Production transcription through Vercel AI Gateway. Vercel Functions
 * authenticate with their short-lived OIDC identity, so no long-lived API
 * secret needs to be stored in the project.
 */
export const vercelGatewayProvider: TranscriptionProvider = {
  name: "vercel-ai-gateway",

  async isReady() {
    return Boolean(
      process.env.AI_GATEWAY_API_KEY ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL
    );
  },

  modelName() {
    return process.env.AI_GATEWAY_TRANSCRIPTION_MODEL || DEFAULT_MODEL;
  },

  async transcribe(audioPath, _durationSeconds, options) {
    const modelId = process.env.AI_GATEWAY_TRANSCRIPTION_MODEL || DEFAULT_MODEL;
    const openAiOptions: Record<string, string | string[]> = {
      timestampGranularities: ["word"],
    };
    if (options.language !== "auto") openAiOptions.language = options.language;
    const prompt = options.prompt?.trim().slice(0, 500);
    if (prompt) openAiOptions.prompt = prompt;

    try {
      const result = await transcribe({
        model: gateway.transcriptionModel(modelId),
        audio: await fs.promises.readFile(audioPath),
        providerOptions: { openai: openAiOptions },
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(4 * 60_000),
      });

      return chunkWordsToCaptions(segmentsToWords(result.segments));
    } catch (error) {
      const detail = safeError(error);
      throw new TranscriptionError(
        `AI Gateway transcription failed: ${detail}`,
        /valid credit card|add-credit-card/i.test(detail)
          ? "Cloud captions are not activated yet. The app owner needs to enable AI Gateway billing in Vercel."
          : "Cloud transcription failed. Try again in a moment or use a shorter video."
      );
    }
  },
};

/**
 * Whisper normally returns one timed segment per word. If an upstream model
 * returns sentence segments, distribute their timing so transcript cutting
 * and spoken-word highlighting still remain usable.
 */
function segmentsToWords(
  segments: Array<{ text: string; startSecond: number; endSecond: number }>
): WordTiming[] {
  return segments.flatMap((segment) => {
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const duration = Math.max(0.02, segment.endSecond - segment.startSecond);
    const weights = tokens.map((token) => Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, "").length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = segment.startSecond;

    return tokens.map((word, index) => {
      const endTime =
        index === tokens.length - 1
          ? segment.endSecond
          : cursor + duration * (weights[index] / totalWeight);
      const timing = { word, startTime: cursor, endTime };
      cursor = endTime;
      return timing;
    });
  });
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return `${error.name}: ${error.message}`.slice(0, 600);
}
