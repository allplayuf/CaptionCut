import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import type { TranscriptionQuality } from "@/types";
import { TranscriptionError } from "./types";

/**
 * Manages the whisper.cpp binary + ggml model that power free local
 * transcription. Everything is stored under data/whisper/ and downloaded
 * automatically on first use (or ahead of time via `npm run setup-whisper`).
 *
 * Env overrides:
 *   WHISPER_CPP_PATH — path to an existing whisper-cli executable (skips the
 *                      bundled download; required on non-Windows platforms
 *                      unless whisper-cli is on PATH)
 *   WHISPER_MODEL    — ggml model name (overrides the Fast/Accurate mapping)
 */

const WHISPER_DIR = path.join(process.cwd(), "data", "whisper");
const BIN_DIR = path.join(WHISPER_DIR, "bin");
const MODELS_DIR = path.join(WHISPER_DIR, "models");

/** Pinned whisper.cpp release for reproducible downloads. */
const WHISPER_RELEASE = "v1.9.1";
const WINDOWS_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip`;
/** Location of whisper-cli.exe inside the extracted release zip. */
const BUNDLED_CLI = path.join(BIN_DIR, "Release", "whisper-cli.exe");

const MODEL_ALLOWLIST = [
  "tiny", "tiny.en",
  "base", "base.en",
  "small", "small.en",
  "medium", "medium.en",
  "large-v3", "large-v3-turbo",
];
const QUALITY_MODELS: Record<TranscriptionQuality, string> = {
  fast: "tiny",
  accurate: "base",
};

export function whisperModelName(quality: TranscriptionQuality = "accurate"): string {
  const name = process.env.WHISPER_MODEL || QUALITY_MODELS[quality];
  if (!MODEL_ALLOWLIST.includes(name)) {
    throw new TranscriptionError(
      `unknown WHISPER_MODEL "${name}"`,
      `Unknown WHISPER_MODEL "${name}". Valid options: ${MODEL_ALLOWLIST.join(", ")}.`
    );
  }
  return name;
}

export function whisperModelPath(quality: TranscriptionQuality = "accurate"): string {
  return modelPath(whisperModelName(quality));
}

function modelPath(model: string): string {
  return path.join(MODELS_DIR, `ggml-${model}.bin`);
}

export function whisperBinaryPath(): string | null {
  if (process.env.WHISPER_CPP_PATH) return process.env.WHISPER_CPP_PATH;
  if (fs.existsSync(BUNDLED_CLI)) return BUNDLED_CLI;
  return null;
}

/** True when transcription can run immediately (no downloads needed). */
export function whisperIsReady(quality: TranscriptionQuality = "accurate"): boolean {
  try {
    return whisperBinaryPath() !== null && fs.existsSync(modelPath(whisperModelName(quality)));
  } catch {
    return false;
  }
}

/** Serialize downloads so two quality requests cannot race on the shared binary. */
let ensureQueue: Promise<void> = Promise.resolve();

/**
 * Makes sure both the whisper-cli binary and the configured model exist,
 * downloading them if needed. Safe to call concurrently.
 */
export function ensureWhisperAssets(
  quality: TranscriptionQuality = "accurate"
): Promise<void> {
  const model = whisperModelName(quality);
  const task = ensureQueue.catch(() => undefined).then(() => doEnsure(model));
  ensureQueue = task.catch(() => undefined);
  return task;
}

async function doEnsure(model: string): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  if (!whisperBinaryPath()) {
    if (process.platform !== "win32") {
      throw new TranscriptionError(
        "whisper-cli not found",
        "whisper.cpp is not installed. Install it (e.g. `brew install whisper-cpp` on macOS, " +
          "or build from https://github.com/ggml-org/whisper.cpp) and set WHISPER_CPP_PATH " +
          "in .env.local to the whisper-cli executable."
      );
    }
    console.log(`[whisper] downloading whisper.cpp ${WHISPER_RELEASE} (~8 MB)…`);
    const zipPath = path.join(WHISPER_DIR, "whisper-bin-x64.zip");
    await downloadFile(WINDOWS_ZIP_URL, zipPath, "whisper.cpp binary");
    await extractZip(zipPath, BIN_DIR);
    await fs.promises.rm(zipPath, { force: true });
    if (!fs.existsSync(BUNDLED_CLI)) {
      throw new TranscriptionError(
        "whisper-cli.exe missing after extraction",
        "The whisper.cpp download looked corrupted. Delete the data/whisper/bin folder and try again."
      );
    }
    console.log("[whisper] binary ready:", BUNDLED_CLI);
  }

  const targetModelPath = modelPath(model);
  if (!fs.existsSync(targetModelPath)) {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
    console.log(`[whisper] downloading ggml-${model} model (first run only)…`);
    await downloadFile(url, targetModelPath, `ggml-${model} model`);
    console.log("[whisper] model ready:", targetModelPath);
  }
}

async function downloadFile(url: string, dest: string, label: string): Promise<void> {
  const tmp = `${dest}.download`;
  let lastError: unknown;

  // Large model downloads occasionally lose a connection. Preserve the
  // partial file and resume it instead of throwing away hundreds of MB.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const offset = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      // A server may ignore Range and return the complete file. In that case
      // restart this attempt rather than appending a duplicate payload.
      const resumed = offset > 0 && response.status === 206;
      const receivedBefore = resumed ? offset : 0;
      const responseBytes = parseInt(response.headers.get("content-length") ?? "0", 10);
      const total = responseBytes > 0 ? receivedBefore + responseBytes : 0;
      let received = receivedBefore;
      let lastLogged = receivedBefore;
      const progress = new Transform({
        transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, data?: Buffer) => void) {
          received += chunk.length;
          if (total > 0 && received - lastLogged > 10 * 1024 * 1024) {
            lastLogged = received;
            console.log(`[whisper] ${label}: ${Math.round((received / total) * 100)}%`);
          }
          cb(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(response.body as import("stream/web").ReadableStream),
        progress,
        fs.createWriteStream(tmp, { flags: resumed ? "a" : "w" })
      );
      await fs.promises.rename(tmp, dest);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 4) {
        console.warn(`[whisper] ${label} interrupted; resuming (attempt ${attempt + 1}/4)…`);
      }
    }
  }

  throw new TranscriptionError(
    `download failed after retries: ${String(lastError)}`,
    `The ${label} download was interrupted repeatedly. Check your connection and try again; progress has been saved.`
  );
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Windows ships PowerShell with Expand-Archive; avoids a zip npm dependency.
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ],
      { windowsHide: true }
    );
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive failed (${code}): ${stderr.slice(0, 400)}`));
    });
  });
}
