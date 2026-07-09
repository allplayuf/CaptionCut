import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { MediaAsset } from "@/types";
import { MEDIA_DIR, ensureDataDirs } from "@/lib/server/paths";
import { probeMedia } from "@/lib/server/ffmpeg";

export const runtime = "nodejs";

const MAX_SIZE = 512 * 1024 * 1024; // 512 MB
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"]);

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
      { error: "That video is too large (max 512 MB). Trim or compress it first." },
      { status: 413 }
    );
  }

  const ext = path.extname(file.name).toLowerCase() || ".mp4";
  if (!ALLOWED_EXTENSIONS.has(ext) && !file.type.startsWith("video/")) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload an MP4, MOV, WebM or MKV video." },
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
    if (!probe.hasVideo || probe.duration <= 0) {
      throw new Error("no video stream");
    }
    const asset: MediaAsset = {
      id,
      filename,
      originalName: file.name,
      mimeType: file.type || "video/mp4",
      size: file.size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudio: probe.hasAudio,
    };
    return NextResponse.json(asset);
  } catch {
    await fs.promises.rm(filePath, { force: true });
    return NextResponse.json(
      { error: "That file doesn't look like a playable video. Try MP4 (H.264) or MOV." },
      { status: 415 }
    );
  }
}
