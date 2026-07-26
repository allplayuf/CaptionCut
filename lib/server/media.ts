import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { MediaAsset } from "@/types";
import { MEDIA_DIR, ensureDataDirs } from "./paths";

type MediaLocation = Pick<MediaAsset, "id" | "filename" | "storageUrl">;

function validateLocation(asset: MediaLocation): { localPath: string; storageUrl?: string } {
  if (!/^[a-zA-Z0-9_-]+$/.test(asset.id)) throw new Error("Invalid media id");
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(asset.filename)) {
    throw new Error("Invalid media filename");
  }
  const localPath = path.join(MEDIA_DIR, asset.filename);
  if (!asset.storageUrl) return { localPath };
  const url = new URL(asset.storageUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".blob.vercel-storage.com")) {
    throw new Error("Untrusted media URL");
  }
  return { localPath, storageUrl: url.toString() };
}

/**
 * Return an FFmpeg-readable input without copying a cloud source into /tmp.
 * FFmpeg can range-read public Vercel Blob URLs directly, which keeps a large
 * 30+ source project from exhausting serverless scratch disk before rendering.
 */
export function resolveMediaInput(asset: MediaLocation): string {
  ensureDataDirs();
  const { localPath, storageUrl } = validateLocation(asset);
  if (fs.existsSync(localPath)) return localPath;
  if (storageUrl) return storageUrl;
  throw new Error("Media is missing");
}

/** Returns a local FFmpeg-readable path, downloading a Blob asset to /tmp once. */
export async function materializeMedia(asset: MediaLocation): Promise<string> {
  ensureDataDirs();
  const { localPath, storageUrl } = validateLocation(asset);
  if (fs.existsSync(localPath)) return localPath;
  if (!storageUrl) throw new Error("Media is missing");
  const response = await fetch(storageUrl, { cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Could not download media");

  const partial = `${localPath}.${process.pid}.partial`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as import("stream/web").ReadableStream),
      fs.createWriteStream(partial)
    );
    await fs.promises.rename(partial, localPath);
  } catch (error) {
    await fs.promises.rm(partial, { force: true });
    // A parallel request may have won the race to materialize this asset.
    if (fs.existsSync(localPath)) return localPath;
    throw error;
  }
  return localPath;
}

export function blobLocationFromUrl(id: string, storageUrl: string): MediaLocation {
  const url = new URL(storageUrl);
  const filename = path.posix.basename(url.pathname);
  // Blob pathnames may be percent encoded, while our generated filenames are not.
  return { id, filename: decodeURIComponent(filename), storageUrl };
}
