"use client";

import type { MediaAsset } from "@/types";
import type { AssetKind } from "@/types";
import { nanoid } from "nanoid";

/** Direct Blob URL in production; local streaming route in development. */
export function mediaUrl(media: string | Pick<MediaAsset, "id" | "storageUrl">): string {
  return typeof media === "string"
    ? `/api/media/${media}`
    : media.storageUrl ?? `/api/media/${media.id}`;
}

/** Frames per filmstrip sprite (matches app/api/media/[id]/filmstrip). */
export const FILMSTRIP_FRAMES = 20;

/** URL of the timeline filmstrip sprite for a video asset. */
export function filmstripUrl(media: string | Pick<MediaAsset, "id" | "storageUrl">): string {
  const id = typeof media === "string" ? media : media.id;
  const storageUrl = typeof media === "string" ? undefined : media.storageUrl;
  const query = storageUrl ? `?src=${encodeURIComponent(storageUrl)}` : "";
  return `/api/media/${id}/filmstrip${query}`;
}

let uploadStoragePromise: Promise<"blob" | "local" | "unconfigured"> | null = null;

function uploadStorage() {
  uploadStoragePromise ??= fetch("/api/upload", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return "local" as const;
      const body = (await response.json()) as { storage?: "blob" | "local" | "unconfigured" };
      return body.storage ?? "local";
    })
    .catch(() => "local" as const);
  return uploadStoragePromise;
}

/**
 * Upload a video with progress (XHR because fetch has no upload progress).
 * Resolves with the probed MediaAsset or rejects with a user-friendly Error.
 */
export function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void
): Promise<MediaAsset> {
  return uploadStorage().then((storage) => {
    if (storage === "blob") return uploadToBlob(file, onProgress);
    if (storage === "unconfigured") {
      throw new Error("Uploads need a Vercel Blob store. Connect one to this project and redeploy.");
    }
    return uploadToLocalServer(file, onProgress);
  });
}

function uploadToLocalServer(
  file: File,
  onProgress: (fraction: number) => void
): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as MediaAsset);
        else reject(new Error(body.error ?? "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

async function uploadToBlob(
  file: File,
  onProgress: (fraction: number) => void
): Promise<MediaAsset> {
  const kind = assetKindForFile(file);
  if (!kind) throw new Error("Unsupported file type.");

  // Probe before spending bandwidth. This also supplies dimensions/duration
  // without routing a potentially huge file through a Vercel Function.
  const metadata = await probeInBrowser(file, kind);
  const id = nanoid(10);
  const ext = extensionFor(file, kind);
  const filename = `${id}${ext}`;
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(`media/${filename}`, file, {
    access: "public",
    handleUploadUrl: "/api/upload/blob",
    multipart: file.size > 5 * 1024 * 1024,
    contentType: file.type || undefined,
    onUploadProgress: ({ percentage }) => onProgress(percentage / 100),
  });

  onProgress(1);
  return {
    id,
    filename,
    storageUrl: blob.url,
    originalName: file.name,
    mimeType: file.type || fallbackMime(kind, ext),
    size: file.size,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    // Browser media APIs do not expose audio-stream presence. Optimistic true
    // avoids falsely labelling phone videos as muted; FFmpeg verifies it later.
    hasAudio: kind === "audio" || kind === "video",
    kind,
  };
}

function assetKindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  const ext = file.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
  if (/^\.(mp4|mov|webm|m4v|mkv|avi)$/.test(ext)) return "video";
  if (/^\.(mp3|wav|m4a|aac|ogg|flac)$/.test(ext)) return "audio";
  if (/^\.(png|jpe?g|webp|gif|bmp|avif)$/.test(ext)) return "image";
  return null;
}

function extensionFor(file: File, kind: AssetKind): string {
  const ext = file.name.match(/\.[a-zA-Z0-9]+$/)?.[0].toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (kind === "image") return ".jpg";
  if (kind === "audio") return ".mp3";
  return ".mp4";
}

function fallbackMime(kind: AssetKind, ext: string): string {
  if (kind === "image") return `image/${ext === ".jpg" ? "jpeg" : ext.slice(1)}`;
  if (kind === "audio") return `audio/${ext.slice(1)}`;
  return "video/mp4";
}

async function probeInBrowser(
  file: File,
  kind: AssetKind
): Promise<{ duration: number; width: number; height: number; fps: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const image = new Image();
      image.src = url;
      await waitForMedia(image, "load", "That image cannot be decoded by this browser.");
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("That image has no readable dimensions.");
      return { duration: 0, width: image.naturalWidth, height: image.naturalHeight, fps: 0 };
    }

    const element = document.createElement(kind === "video" ? "video" : "audio");
    element.preload = "metadata";
    element.src = url;
    await waitForMedia(element, "loadedmetadata", "That media file cannot be decoded by this browser.");
    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    if (duration <= 0) throw new Error("That media file has no readable duration.");
    const video = element instanceof HTMLVideoElement ? element : null;
    return {
      duration,
      width: video?.videoWidth ?? 0,
      height: video?.videoHeight ?? 0,
      fps: kind === "video" ? 30 : 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitForMedia(
  target: EventTarget,
  event: string,
  errorMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error(errorMessage))), 15000);
    const onReady = () => finish(resolve);
    const onError = () => finish(() => reject(new Error(errorMessage)));
    const finish = (done: () => void) => {
      window.clearTimeout(timeout);
      target.removeEventListener(event, onReady);
      target.removeEventListener("error", onError);
      done();
    };
    target.addEventListener(event, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}
