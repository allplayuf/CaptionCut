import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { ANALYSIS_DIR, MEDIA_DIR, ensureDataDirs } from "@/lib/server/paths";
import { FFPROBE, runFfmpeg } from "@/lib/server/ffmpeg";
import { spawn } from "child_process";
import { blobLocationFromUrl, resolveMediaInput } from "@/lib/server/media";
import { TaskQueue } from "@/lib/server/taskQueue";

export const runtime = "nodejs";

/** Frames per filmstrip sprite (fixed → the client maps time linearly).
    Keep in sync with FILMSTRIP_FRAMES in lib/video/client.ts. */
const FRAMES = 20;
const FRAME_H = 108; // 2x the 54px video-lane height for crisp rendering
const filmstripQueue = new TaskQueue(2);
const filmstripJobs = new Map<string, Promise<void>>();

/**
 * Returns a horizontal filmstrip sprite (FRAMES thumbnails tiled in one JPEG)
 * spanning the whole source file — the timeline draws real video frames on
 * clips, Premiere-style. Generated once per asset and cached on disk.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid media id" }, { status: 400 });
  }
  ensureDataDirs();

  const cacheFile = path.join(ANALYSIS_DIR, `${id}.strip.jpg`);
  if (!fs.existsSync(cacheFile)) {
    let file: string | undefined;
    const storageUrl = request.nextUrl.searchParams.get("src");
    if (storageUrl) {
      try {
        file = resolveMediaInput(blobLocationFromUrl(id, storageUrl));
      } catch {
        file = undefined;
      }
    } else {
      try {
        const filename = (await fs.promises.readdir(MEDIA_DIR)).find((f) => f.startsWith(`${id}.`));
        if (filename) file = path.join(MEDIA_DIR, filename);
      } catch {
        file = undefined;
      }
    }
    if (!file) return NextResponse.json({ error: "Media not found" }, { status: 404 });

    try {
      await ensureFilmstrip(id, file, cacheFile);
    } catch (err) {
      console.error(`filmstrip for ${id} failed:`, err);
      return NextResponse.json({ error: "Could not generate thumbnails." }, { status: 500 });
    }
  }

  const buf = await fs.promises.readFile(cacheFile);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

async function ensureFilmstrip(id: string, file: string, cacheFile: string): Promise<void> {
  if (fs.existsSync(cacheFile)) return;
  const existing = filmstripJobs.get(id);
  if (existing) return existing;
  const job = filmstripQueue.run(async () => {
    if (fs.existsSync(cacheFile)) return;
    const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp.jpg`;
    try {
      const duration = await probeDuration(file);
      const fps = Math.max(0.01, FRAMES / Math.max(0.5, duration));
      await runFfmpeg(
        [
          "-y",
          "-i", file,
          "-an",
          "-vf", `fps=${fps.toFixed(5)},scale=-2:${FRAME_H},tile=${FRAMES}x1`,
          "-frames:v", "1",
          "-q:v", "5",
          temporary,
        ],
        { timeoutMs: 2 * 60 * 1000 }
      );
      await fs.promises.rename(temporary, cacheFile);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    }
  });
  filmstripJobs.set(id, job);
  try {
    await job;
  } finally {
    if (filmstripJobs.get(id) === job) filmstripJobs.delete(id);
  }
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { windowsHide: true }
    );
    let out = "";
    proc.stdout.on("data", (c: Buffer) => (out += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(parseFloat(out.trim()) || 0);
      else reject(new Error("ffprobe failed"));
    });
  });
}
