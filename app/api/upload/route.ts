import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { AssetKind, MediaAsset } from "@/types";
import { MEDIA_DIR, ensureDataDirs } from "@/lib/server/paths";
import { probeMedia } from "@/lib/server/ffmpeg";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_LABEL } from "@/lib/video/uploadLimits";
import { workspaceId } from "@/lib/server/workspace";

export const runtime = "nodejs";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function expectedKind(ext: string, mimeType: string): AssetKind | null {
  if (VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith("video/")) return "video";
  if (AUDIO_EXTENSIONS.has(ext) || mimeType.startsWith("audio/")) return "audio";
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) return "image";
  return null;
}

/** Lets the browser choose durable direct uploads on Vercel, local disk in dev. */
export async function GET() {
  const storage = process.env.BLOB_READ_WRITE_TOKEN
    ? "blob"
    : process.env.VERCEL
      ? "unconfigured"
      : "local";
  return NextResponse.json(
    {
      storage,
      uploadPrefix: storage === "blob" ? `media/${await workspaceId()}` : null,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error: process.env.BLOB_READ_WRITE_TOKEN
          ? "Use the direct cloud upload endpoint."
          : "Uploads need a Vercel Blob store. Connect one to this project and redeploy.",
      },
      { status: 503 }
    );
  }
  ensureDataDirs();

  const originalName = request.nextUrl.searchParams.get("name")?.trim();
  if (!originalName || !request.body) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max ${MAX_UPLOAD_SIZE_LABEL}). Trim or compress it first.` },
      { status: 413 }
    );
  }

  const mimeType = request.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  const ext = path.extname(originalName).toLowerCase() || ".mp4";
  const kind = expectedKind(ext, mimeType);
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a video (MP4/MOV/WebM), audio (MP3/WAV/M4A) or image (PNG/JPG/WebP)." },
      { status: 415 }
    );
  }

  const id = nanoid(10);
  const filename = `${id}${ext}`;
  const filePath = path.join(MEDIA_DIR, filename);
  let size = 0;

  try {
    size = await streamToFile(request.body, filePath);
  } catch (error) {
    await fs.promises.rm(filePath, { force: true });
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json(
        { error: `That file is too large (max ${MAX_UPLOAD_SIZE_LABEL}). Trim or compress it first.` },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { error: "Could not save the upload. Check free disk space and try again." },
      { status: 500 }
    );
  }

  if (size === 0) {
    await fs.promises.rm(filePath, { force: true });
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  try {
    const probe = await probeMedia(filePath);
    if (kind === "video" && (!probe.hasVideo || probe.duration <= 0)) throw new Error("no video stream");
    if (kind === "audio" && (!probe.hasAudio || probe.duration <= 0)) throw new Error("no audio stream");
    if (kind === "image" && !probe.hasVideo) throw new Error("no image stream");

    const asset: MediaAsset = {
      id,
      filename,
      originalName,
      mimeType: mimeType || fallbackMime(kind, ext),
      size,
      duration: kind === "image" ? 0 : probe.duration,
      width: probe.width,
      height: probe.height,
      fps: kind === "video" ? probe.fps : 0,
      hasAudio: kind === "audio" ? true : probe.hasAudio,
      kind,
    };
    return NextResponse.json(asset);
  } catch {
    await fs.promises.rm(filePath, { force: true });
    return NextResponse.json(
      { error: "That file doesn't look playable. Try MP4 (H.264), MP3/WAV audio, or PNG/JPG images." },
      { status: 415 }
    );
  }
}

class UploadTooLargeError extends Error {}

/** Writes with backpressure so multi-GB uploads never need to live in memory. */
async function streamToFile(body: ReadableStream<Uint8Array>, filePath: string): Promise<number> {
  const file = await fs.promises.open(filePath, "wx");
  const reader = body.getReader();
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > MAX_UPLOAD_SIZE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new UploadTooLargeError();
      }

      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) throw new Error("Upload write stalled.");
        offset += bytesWritten;
      }
    }
  } finally {
    reader.releaseLock();
    await file.close();
  }

  return size;
}

function fallbackMime(kind: AssetKind, ext: string): string {
  if (kind === "audio") return `audio/${ext.slice(1)}`;
  if (kind === "image") return `image/${ext.slice(1) === "jpg" ? "jpeg" : ext.slice(1)}`;
  return "video/mp4";
}
