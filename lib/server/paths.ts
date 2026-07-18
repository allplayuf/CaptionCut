import path from "path";
import fs from "fs";
import os from "os";

/**
 * All user data (uploads, projects, exports) lives under <repo>/data.
 * This keeps the MVP dependency-free; swap for S3/DB later if needed.
 */
// Vercel Functions can only write to their ephemeral temp directory. Durable
// media/projects use Blob there; these folders remain useful as FFmpeg scratch
// space and caches during a single invocation.
const DATA_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), "captioncut")
  : path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

export const MEDIA_DIR = path.join(DATA_ROOT, "media");
export const PROJECTS_DIR = path.join(DATA_ROOT, "projects");
export const EXPORTS_DIR = path.join(DATA_ROOT, "exports");
export const TMP_DIR = path.join(DATA_ROOT, "tmp");
export const ANALYSIS_DIR = path.join(DATA_ROOT, "analysis");

export function ensureDataDirs(): void {
  for (const dir of [MEDIA_DIR, PROJECTS_DIR, EXPORTS_DIR, TMP_DIR, ANALYSIS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Prevent path traversal from user-supplied ids. */
export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid id");
  }
  return id;
}
