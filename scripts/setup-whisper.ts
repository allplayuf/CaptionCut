/**
 * Pre-downloads the whisper.cpp binary and the configured ggml model so the
 * first "Auto Captions" click doesn't have to wait for downloads.
 *
 *   npm run setup-whisper
 *
 * Respects WHISPER_MODEL / WHISPER_CPP_PATH from the environment.
 * (Everything also downloads automatically on first use — this is optional.)
 */
import {
  ensureWhisperAssets,
  whisperBinaryPath,
  whisperModelName,
  whisperModelPath,
} from "../lib/transcription/whisperAssets";

async function main() {
  console.log(`Setting up local Whisper (model: ${whisperModelName()})…`);
  await ensureWhisperAssets();
  console.log("");
  console.log("✔ whisper-cli :", whisperBinaryPath());
  console.log("✔ model       :", whisperModelPath());
  console.log("");
  console.log("Local transcription is ready — Auto Captions now works offline and for free.");
}

main().catch((err) => {
  console.error("Setup failed:", err?.userMessage ?? err?.message ?? err);
  process.exit(1);
});
