import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import type { Caption, WordTiming } from "@/types";
import { chunkWordsToCaptions } from "@/lib/captions/chunk";
import { TranscriptionError, type TranscriptionProvider } from "../types";
import {
  ensureWhisperAssets,
  whisperBinaryPath,
  whisperIsReady,
  whisperModelName,
  whisperModelPath,
} from "../whisperAssets";

/**
 * Free, fully local transcription via whisper.cpp — the default provider.
 * No API key, no cloud: audio never leaves the machine.
 *
 * whisper-cli is run with `-ml 1 -sow` (max segment length 1, split on word)
 * so every JSON segment is a single word with start/end offsets — exactly the
 * WordTiming shape the TikTok chunker and word-highlighting need.
 */

/** Shape of whisper-cli's -oj JSON output. */
interface WhisperCliOutput {
  transcription?: Array<{
    offsets: { from: number; to: number };
    text: string;
    tokens?: Array<{
      text?: string;
      p?: number;
    }>;
  }>;
  result?: { language?: string };
}

/** Bracketed noise annotations whisper emits for non-speech: [MUSIC], (wind) … */
const NOISE_TOKEN = /^[[(].*[\])]$/;

export const localWhisperProvider: TranscriptionProvider = {
  name: "local-whisper",

  async isReady(quality) {
    return whisperIsReady(quality);
  },

  modelName(quality) {
    return whisperModelName(quality);
  },

  async transcribe(audioPath, durationSeconds, options) {
    const { language, quality } = options;
    // Downloads whisper.cpp and the selected model on first use; no-op afterwards.
    await ensureWhisperAssets(quality);

    const binary = whisperBinaryPath();
    if (!binary) {
      throw new TranscriptionError(
        "whisper binary unavailable after ensure",
        "Local Whisper is not set up. Run `npm run setup-whisper` and try again."
      );
    }

    const outBase = `${audioPath}.whisper`;
    const args: string[] = [
      "-m", whisperModelPath(quality),
      "-f", audioPath,
      "-l", language === "auto" ? "auto" : language,
      "-ojf",
      "-of", outBase,
      "-ml", "1",
      "-sow",
      "-t", String(Math.min(8, Math.max(1, os.cpus().length - 1))),
      "--no-prints",
    ];
    const prompt = options.prompt?.trim().slice(0, 500);
    if (prompt) args.push("--prompt", prompt, "--carry-initial-prompt");

    // base model runs roughly at realtime on a typical CPU; leave generous headroom.
    const timeoutMs = Math.min(20 * 60_000, Math.max(3 * 60_000, durationSeconds * 8000));
    await runWhisper(binary, args, timeoutMs);

    const jsonPath = `${outBase}.json`;
    try {
      const raw = await fs.promises.readFile(jsonPath, "utf8");
      const data = JSON.parse(raw) as WhisperCliOutput;
      const words: WordTiming[] = [];
      for (const seg of data.transcription ?? []) {
        const text = seg.text.trim();
        if (!text || NOISE_TOKEN.test(text)) continue;
        const confidence = segmentConfidence(seg.tokens);
        words.push({
          word: text,
          startTime: seg.offsets.from / 1000,
          endTime: seg.offsets.to / 1000,
          ...(confidence === undefined ? {} : { confidence }),
        });
      }
      return addCaptionConfidence(chunkWordsToCaptions(words));
    } catch (err) {
      if (err instanceof TranscriptionError) throw err;
      throw new TranscriptionError(
        `failed to read whisper output: ${String(err)}`,
        "Transcription finished but its output could not be read. Please try again."
      );
    } finally {
      await fs.promises.rm(jsonPath, { force: true });
    }
  },
};

/** Mean lexical-token probability for a one-word segment; control tokens are excluded. */
function segmentConfidence(
  tokens: Array<{ text?: string; p?: number }> | undefined
): number | undefined {
  const probabilities = (tokens ?? [])
    .filter((token) => {
      const text = token.text?.trim() ?? "";
      return (
        text.length > 0 &&
        !/^\[_.*\]$/.test(text) &&
        !/^<\|.*\|>$/.test(text) &&
        typeof token.p === "number" &&
        Number.isFinite(token.p)
      );
    })
    .map((token) => Math.max(0, Math.min(1, token.p as number)));
  if (probabilities.length === 0) return undefined;
  return roundConfidence(
    probabilities.reduce((sum, probability) => sum + probability, 0) /
      probabilities.length
  );
}

function addCaptionConfidence(captions: Caption[]): Caption[] {
  return captions.map((caption) => {
    const probabilities = (caption.words ?? [])
      .map((word) => word.confidence)
      .filter((value): value is number => typeof value === "number");
    if (probabilities.length === 0) return caption;
    return {
      ...caption,
      confidence: roundConfidence(
        probabilities.reduce((sum, probability) => sum + probability, 0) /
          probabilities.length
      ),
    };
  });
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function runWhisper(binary: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { windowsHide: true });
    let stderrTail = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    proc.stderr.on("data", (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-2000);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new TranscriptionError(
          `failed to launch whisper-cli: ${String(err)}`,
          "Could not start the local Whisper engine. Run `npm run setup-whisper` to reinstall it."
        )
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new TranscriptionError(
            "whisper-cli timed out",
            "Transcription took too long and was stopped. Try a shorter video or a smaller WHISPER_MODEL (e.g. tiny)."
          )
        );
      } else if (code === 0) {
        resolve();
      } else {
        reject(
          new TranscriptionError(
            `whisper-cli exited ${code}: ${stderrTail}`,
            "The local Whisper engine failed. Try again; if it keeps failing, delete the data/whisper folder and run `npm run setup-whisper`."
          )
        );
      }
    });
  });
}
