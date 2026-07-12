"use client";

import { useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { uploadVideo } from "@/lib/video/client";
import { assetKind } from "@/lib/timeline/tracks";
import { fetchAnalyses } from "@/lib/autoEdit/signals";

export const UPLOAD_ACCEPT =
  "video/*,audio/*,image/*,.mp4,.mov,.webm,.m4v,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif";

const SUPPORTED_NAME =
  /\.(mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp)$/i;

export interface UploadProgress {
  name: string;
  /** 0..1 for the current file. */
  progress: number;
  /** 1-based index of the current file in this batch. */
  index: number;
  total: number;
}

/**
 * Shared multi-file upload flow (start screen + media panel): validates,
 * uploads with progress, registers assets in the store, warms the local
 * FFmpeg analysis cache and surfaces the usual advisory toasts.
 */
export function useMediaUpload() {
  const [uploading, setUploading] = useState<UploadProgress | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const addToast = useEditorStore.getState().addToast;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const typeOk =
        file.type.startsWith("video/") || file.type.startsWith("audio/") || file.type.startsWith("image/");
      if (!typeOk && !SUPPORTED_NAME.test(file.name)) {
        addToast("error", `"${file.name}" is not a supported video, audio or image file.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0, index: i + 1, total: list.length });
      try {
        const asset = await uploadVideo(file, (p) =>
          setUploading({ name: file.name, progress: p, index: i + 1, total: list.length })
        );
        useEditorStore.getState().addMedia(asset);
        const kind = assetKind(asset);
        if (kind !== "image") {
          // Warm the analysis cache in the background: smart crop, montage
          // ranking and beat detection are instant by the time they're needed.
          void fetchAnalyses([asset])
            .then((fresh) => useEditorStore.getState().mergeAnalyses(fresh))
            .catch(() => {});
        }
        if (kind === "video" && asset.duration > 180) {
          addToast(
            "info",
            "Heads up: videos over 3 minutes work, but captions and export take noticeably longer."
          );
        }
        if (kind === "video" && !asset.hasAudio) {
          addToast("info", `"${file.name}" has no audio track — auto captions won't find speech in it.`);
        }
        if (kind === "audio") {
          addToast("success", `"${file.name}" added — drop it on Music, SFX or Voiceover.`);
        }
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(null);
      }
    }
  };

  return { uploading, handleFiles };
}
