import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import type { WordTiming } from "@/types";
import { chunkWordsToCaptions } from "@/lib/captions/chunk";
import { TranscriptionError, type TranscriptionProvider } from "../types";
import {
  ensureWhisperAssets,
  whisperBinaryPath,
  whisperIsReady,
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
  }>;
  result?: { language?: string };
}

/** Bracketed noise annotations whisper emits for non-speech: [MUSIC], (wind) … */
const NOISE_TOKEN = /^[[(].*[\])]$/;

export const localWhisperProvider: TranscriptionProvider = {
  name: "local-whisper",

  async isReady() {
    return whisperIsReady();
  },

  async transcribe(audioPath, durationSeconds, language) {
    // Downloads whisper.cpp (~8 MB) and the model (~150 MB for "base") on
    // first use; no-op afterwards.
    await ensureWhisperAssets();

    const binary = whisperBinaryPath();
    if (!binary) {
      throw new TranscriptionError(
        "whisper binary unavailable after ensure",
        "Local Whisper is not set up. Run `npm run setup-whisper` and try again."
      );
    }

    const outBase = `${audioPath}.whisper`;
    const args = [
      "-m", whisperModelPath(),
      "-f", audioPath,
      "-l", language === "auto" ? "auto" : language,
      "-oj",
      "-of", outBase,
      "-ml", "1",
      "-sow",
      "-t", String(Math.min(8, Math.max(1, os.cpus().length - 1))),
      "--no-prints",
    ];

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
        words.push({
          word: text,
          startTime: seg.offsets.from / 1000,
          endTime: seg.offsets.to / 1000,
        });
      }
      return chunkWordsToCaptions(words);
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
