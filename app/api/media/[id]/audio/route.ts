import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { blobLocationFromUrl, resolveMediaInput } from "@/lib/server/media";
import { MEDIA_DIR, TMP_DIR, ensureDataDirs } from "@/lib/server/paths";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_SLICE_SECONDS = 8 * 60;

/**
 * Convert a bounded source slice to the one format every supported browser can
 * decode consistently. Whisper still runs on the visitor's device; this route
 * only replaces browser-specific MP4/MOV audio decoding with FFmpeg.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid media id." }, { status: 400 });
  }

  const start = finiteNumber(request.nextUrl.searchParams.get("start"), 0);
  const duration = finiteNumber(request.nextUrl.searchParams.get("duration"), 0);
  if (start < 0 || duration <= 0 || duration > MAX_AUDIO_SLICE_SECONDS) {
    return NextResponse.json({ error: "Invalid audio range." }, { status: 400 });
  }

  ensureDataDirs();
  let input: string | undefined;
  const storageUrl = request.nextUrl.searchParams.get("src");
  if (storageUrl) {
    try {
      input = resolveMediaInput(blobLocationFromUrl(id, storageUrl));
    } catch {
      input = undefined;
    }
  } else {
    try {
      const filename = (await fs.promises.readdir(MEDIA_DIR)).find((candidate) =>
        candidate.startsWith(`${id}.`)
      );
      if (filename) input = resolveMediaInput({ id, filename });
    } catch {
      input = undefined;
    }
  }

  if (!input) {
    return NextResponse.json({ error: "Media is not ready for captions." }, { status: 404 });
  }

  const output = path.join(TMP_DIR, `${id}-${nanoid(8)}.caption.wav`);
  try {
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start.toFixed(3),
        "-i",
        input,
        "-t",
        duration.toFixed(3),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { timeoutMs: 90_000 }
    );
    const audio = await fs.promises.readFile(output);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.length),
        "Cache-Control": "private, max-age=3600",
        "X-Caption-Audio": "normalized",
      },
    });
  } catch (error) {
    console.error(`caption audio for ${id} failed:`, error);
    return NextResponse.json(
      { error: "This file has no readable audio track." },
      { status: 422 }
    );
  } finally {
    await fs.promises.rm(output, { force: true }).catch(() => undefined);
  }
}

function finiteNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
