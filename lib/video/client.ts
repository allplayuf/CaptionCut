"use client";

import type { MediaAsset } from "@/types";

/** URL for streaming an uploaded video back into the editor. */
export function mediaUrl(mediaId: string): string {
  return `/api/media/${mediaId}`;
}

/**
 * Upload a video with progress (XHR because fetch has no upload progress).
 * Resolves with the probed MediaAsset or rejects with a user-friendly Error.
 */
export function uploadVideo(
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
