"use client";

import { useRef, useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { uploadVideo } from "@/lib/video/client";
import { formatTime } from "@/lib/video/timeline";
import { Plus, Upload } from "lucide-react";

/** Left panel: upload zone + uploaded media library. */
export default function MediaPanel() {
  const media = useEditorStore((s) => s.media);
  const addMedia = useEditorStore((s) => s.addMedia);
  const addClipFromMedia = useEditorStore((s) => s.addClipFromMedia);
  const addToast = useEditorStore((s) => s.addToast);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name)) {
        addToast("error", `"${file.name}" is not a supported video file.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        const asset = await uploadVideo(file, (p) =>
          setUploading({ name: file.name, progress: p })
        );
        addMedia(asset);
        if (asset.duration > 180) {
          addToast(
            "info",
            "Heads up: videos over 3 minutes work, but captions and export take noticeably longer."
          );
        }
        if (!asset.hasAudio) {
          addToast("info", `"${file.name}" has no audio track — auto captions won't find speech in it.`);
        }
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(null);
      }
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.m4v,.mkv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading !== null}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          dragOver
            ? "border-fuchsia-400 bg-fuchsia-500/10"
            : "border-white/15 hover:border-violet-400/60 hover:bg-white/5"
        }`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20">
          <Upload size={18} />
        </div>
        {uploading ? (
          <div className="w-full">
            <p className="truncate text-xs text-zinc-400">{uploading.name}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                style={{ width: `${Math.round(uploading.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-zinc-200">Upload video</p>
            <p className="text-[11px] leading-snug text-zinc-500">
              Drop files or click · MP4, MOV, WebM
              <br />
              vertical or horizontal
            </p>
          </>
        )}
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {media.length > 0 && (
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Media
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {media.map((m) => (
            <div
              key={m.id}
              className="group rounded-lg bg-white/5 p-2 ring-1 ring-white/8 transition hover:bg-white/8"
            >
              <p className="truncate text-xs font-medium text-zinc-200">{m.originalName}</p>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="font-mono text-[10px] text-zinc-500">
                  {formatTime(m.duration)} · {m.width}×{m.height}
                  {!m.hasAudio && " · no audio"}
                </span>
                <button
                  onClick={() => addClipFromMedia(m.id)}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 opacity-0 transition hover:bg-violet-500/20 group-hover:opacity-100"
                  title="Add another copy to the timeline"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
