import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { AssetKind, MediaAsset } from "@/types";
import { MEDIA_DIR, ensureDataDirs } from "@/lib/server/paths";
import { probeMedia } from "@/lib/server/ffmpeg";

export const runtime = "nodejs";

const MAX_SIZE = 512 * 1024 * 1024; // 512 MB

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function expectedKind(ext: string, mimeType: string): AssetKind | null {
  if (VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith("video/")) return "video";
  if (AUDIO_EXTENSIONS.has(ext) || mimeType.startsWith("audio/")) return "audio";
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) return "image";
  return null;
}

export async function POST(request: NextRequest) {
  ensureDataDirs();

  let file: File | null = null;
  try {
    const form = await request.formData();
    file = form.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "That file is too large (max 512 MB). Trim or compress it first." },
      { status: 413 }
    );
  }

  const ext = path.extname(file.name).toLowerCase() || ".mp4";
  const kind = expectedKind(ext, file.type);
  if (!kind) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a video (MP4/MOV/WebM), audio (MP3/WAV/M4A) or image (PNG/JPG/WebP)." },
      { status: 415 }
    );
  }

  const id = nanoid(10);
  const filename = `${id}${ext}`;
  const filePath = path.join(MEDIA_DIR, filename);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(filePath, buffer);
  } catch {
    return NextResponse.json(
      { error: "Could not save the upload. Check free disk space and try again." },
      { status: 500 }
    );
  }

  try {
    const probe = await probeMedia(filePath);
    if (kind === "video" && (!probe.hasVideo || probe.duration <= 0)) throw new Error("no video stream");
    if (kind === "audio" && (!probe.hasAudio || probe.duration <= 0)) throw new Error("no audio stream");
    if (kind === "image" && !probe.hasVideo) throw new Error("no image stream");

    const asset: MediaAsset = {
      id,
      filename,
      originalName: file.name,
      mimeType: file.type || fallbackMime(kind, ext),
      size: file.size,
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

function fallbackMime(kind: AssetKind, ext: string): string {
  if (kind === "audio") return `audio/${ext.slice(1)}`;
  if (kind === "image") return `image/${ext.slice(1) === "jpg" ? "jpeg" : ext.slice(1)}`;
  return "video/mp4";
}
