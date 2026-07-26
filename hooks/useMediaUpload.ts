"use client";

import { useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { uploadVideo } from "@/lib/video/client";
import { assetKind } from "@/lib/timeline/tracks";
import { fetchAnalyses } from "@/lib/autoEdit/signals";

export const UPLOAD_ACCEPT =
  "video/*,audio/*,image/*,.mp4,.mov,.webm,.m4v,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif";

const SUPPORTED_NAME =
  /\.(mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp|avif)$/i;

export interface UploadProgress {
  name: string;
  /** 0..1 for the current file. */
  progress: number;
  /** 1-based index of the current file in this batch. */
  index: number;
  total: number;
}

/** Register an already-imported asset and run the same post-import work as a
 * device upload (timeline placement, analysis warmup and useful notices). */
export function registerImportedMedia(
  asset: MediaAsset,
  opts?: { silentAudioTip?: boolean; deferAnalysis?: boolean }
): void {
  const store = useEditorStore.getState();
  store.addMedia(asset);
  const kind = assetKind(asset);
  if (kind !== "image" && !opts?.deferAnalysis) {
    void fetchAnalyses([asset])
      .then((fresh) => useEditorStore.getState().mergeAnalyses(fresh))
      .catch(() => {});
  }
  if (kind === "video" && asset.duration > 180) {
    store.addToast(
      "info",
      "Heads up: videos over 3 minutes work, but captions and export take noticeably longer."
    );
  }
  if (kind === "video" && !asset.hasAudio) {
    store.addToast(
      "info",
      `"${asset.originalName}" has no camera audio — pair a separate audio file for captions.`
    );
  }
  if (kind === "audio" && !opts?.silentAudioTip) {
    store.addToast(
      "success",
      `"${asset.originalName}" added — pair it to a video or place it on an audio track.`
    );
  }
}

/**
 * Shared multi-file upload flow (start screen + media panel): validates,
 * uploads with progress, registers assets in the store, warms the local
 * FFmpeg analysis cache and surfaces the usual advisory toasts.
 */
export function useMediaUpload() {
  const [uploading, setUploading] = useState<UploadProgress | null>(null);

  /** Uploads every supported file; resolves with the registered assets.
      `opts.silentAudioTip` suppresses the "drop it on Music" hint when the
      caller places the audio itself (e.g. the Add-music button). */
  const handleFiles = async (
    files: FileList | File[],
    opts?: { silentAudioTip?: boolean }
  ): Promise<MediaAsset[]> => {
    const list = Array.from(files);
    const addToast = useEditorStore.getState().addToast;
    const uploaded: MediaAsset[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const typeOk =
        file.type.startsWith("video/") || file.type.startsWith("audio/") || file.type.startsWith("image/");
      if (!typeOk && !SUPPORTED_NAME.test(file.name)) {
        addToast("error", `"${file.name}" is not a supported video, audio or image file.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0, index: i + 1, total: list.length });
      const provisional: { asset?: MediaAsset } = {};
      try {
        const asset = await uploadVideo(
          file,
          (p) => {
            setUploading({ name: file.name, progress: p, index: i + 1, total: list.length });
            if (provisional.asset) {
              useEditorStore
                .getState()
                .updateMediaAsset(provisional.asset.id, { uploadProgress: p }, { persist: false });
            }
          },
          (localAsset) => {
            provisional.asset = localAsset;
            registerImportedMedia(localAsset, { ...opts, deferAnalysis: true });
          }
        );
        if (provisional.asset) {
          useEditorStore.getState().updateMediaAsset(
            asset.id,
            {
              storageUrl: asset.storageUrl,
              uploadState: "ready",
              uploadProgress: 1,
              uploadError: undefined,
            },
            { persist: true }
          );
          if (assetKind(asset) !== "image") {
            void fetchAnalyses([asset])
              .then((fresh) => useEditorStore.getState().mergeAnalyses(fresh))
              .catch(() => {});
          }
        } else {
          registerImportedMedia(asset, opts);
        }
        uploaded.push(asset);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        if (provisional.asset) {
          useEditorStore.getState().updateMediaAsset(
            provisional.asset.id,
            {
              uploadState: "error",
              uploadError: message,
            },
            { persist: false }
          );
          uploaded.push(provisional.asset);
          addToast(
            "error",
            `"${file.name}" works in this tab, but cloud sync failed. Retry the import before reloading.`
          );
        } else {
          addToast("error", message);
        }
      } finally {
        setUploading(null);
      }
    }
    return uploaded;
  };

  return { uploading, handleFiles };
}
