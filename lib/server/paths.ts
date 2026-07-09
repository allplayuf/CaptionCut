import path from "path";
import fs from "fs";

/**
 * All user data (uploads, projects, exports) lives under <repo>/data.
 * This keeps the MVP dependency-free; swap for S3/DB later if needed.
 */
const DATA_ROOT = path.join(process.cwd(), "data");

export const MEDIA_DIR = path.join(DATA_ROOT, "media");
export const PROJECTS_DIR = path.join(DATA_ROOT, "projects");
export const EXPORTS_DIR = path.join(DATA_ROOT, "exports");
export const TMP_DIR = path.join(DATA_ROOT, "tmp");

export function ensureDataDirs(): void {
  for (const dir of [MEDIA_DIR, PROJECTS_DIR, EXPORTS_DIR, TMP_DIR]) {
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
