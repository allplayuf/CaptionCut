import fs from "fs";
import { NextResponse } from "next/server";
import { FFMPEG, FFPROBE } from "@/lib/server/ffmpeg";

export const runtime = "nodejs";

/** Deployment smoke-test without exposing credentials or user data. */
export async function GET() {
  const deployed = Boolean(process.env.VERCEL);
  const storage = process.env.BLOB_READ_WRITE_TOKEN
    ? "blob"
    : deployed
      ? "unconfigured"
      : "local";
  const ffmpegReady = Boolean(FFMPEG && fs.existsSync(FFMPEG));
  const ffprobeReady = Boolean(FFPROBE && fs.existsSync(FFPROBE));
  const healthy = storage !== "unconfigured" && ffmpegReady && ffprobeReady;

  return NextResponse.json(
    {
      ok: healthy,
      environment: deployed ? "production" : "local",
      storage,
      transcription: {
        provider: "browser-whisper",
        ready: true,
        model: "downloaded and cached per device",
        localOnly: true,
      },
      mediaTools: {
        ffmpeg: ffmpegReady,
        ffprobe: ffprobeReady,
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
