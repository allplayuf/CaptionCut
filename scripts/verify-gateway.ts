import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.TRANSCRIPTION_PROVIDER = "gateway";

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    throw new Error("Usage: npx tsx scripts/verify-gateway.ts <audio-file>");
  }
  const resolved = path.resolve(audioPath);
  if (!fs.existsSync(resolved)) throw new Error(`Audio file not found: ${resolved}`);

  const { resolveProvider } = await import("../lib/transcription");
  const provider = resolveProvider();
  if (!(await provider.isReady("fast"))) {
    throw new Error("AI Gateway authentication is not available.");
  }

  const captions = await provider.transcribe(resolved, 6, {
    language: "en",
    quality: "fast",
  });
  const wordTimings = captions.reduce((sum, caption) => sum + (caption.words?.length ?? 0), 0);
  if (captions.length === 0 || wordTimings === 0) {
    throw new Error("Gateway returned no timed transcript.");
  }

  console.log(
    JSON.stringify({
      ok: true,
      provider: provider.name,
      model: provider.modelName("fast"),
      captionCount: captions.length,
      wordTimings,
      firstText: captions[0].text,
    })
  );
}

void main();
