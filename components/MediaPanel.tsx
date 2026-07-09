"use client";

import { useRef, useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { uploadVideo } from "@/lib/video/client";
import { formatTime } from "@/lib/video/timeline";
import { assetKind } from "@/lib/timeline/tracks";
import { Film, Image as ImageIcon, Music, Plus, Upload } from "lucide-react";

const ACCEPT =
  "video/*,audio/*,image/*,.mp4,.mov,.webm,.m4v,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif";

const SUPPORTED_NAME =
  /\.(mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp)$/i;

/** Left panel: upload zone + media library (video, audio, images) with add-to-track actions. */
export default function MediaPanel() {
  const media = useEditorStore((s) => s.media);
  const addMedia = useEditorStore((s) => s.addMedia);
  const addToast = useEditorStore((s) => s.addToast);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const typeOk =
        file.type.startsWith("video/") || file.type.startsWith("audio/") || file.type.startsWith("image/");
      if (!typeOk && !SUPPORTED_NAME.test(file.name)) {
        addToast("error", `"${file.name}" is not a supported video, audio or image file.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        const asset = await uploadVideo(file, (p) =>
          setUploading({ name: file.name, progress: p })
        );
        addMedia(asset);
        const kind = assetKind(asset);
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

  const videos = media.filter((m) => assetKind(m) === "video");
  const audios = media.filter((m) => assetKind(m) === "audio");
  const images = media.filter((m) => assetKind(m) === "image");

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
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
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
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
            <p className="text-sm font-semibold text-zinc-200">Upload media</p>
            <p className="text-[11px] leading-snug text-zinc-500">
              Video · music · sound FX · images
              <br />
              drop files or click
            </p>
          </>
        )}
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MediaGroup icon={<Film size={11} />} label="Video" items={videos}>
          {(m) => <VideoActions asset={m} />}
        </MediaGroup>
        <MediaGroup icon={<Music size={11} />} label="Audio" items={audios}>
          {(m) => <AudioActions asset={m} />}
        </MediaGroup>
        <MediaGroup icon={<ImageIcon size={11} />} label="Images" items={images}>
          {(m) => <ImageActions asset={m} />}
        </MediaGroup>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function MediaGroup({
  icon,
  label,
  items,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  items: MediaAsset[];
  children: (m: MediaAsset) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {icon} {label}
      </p>
      <div className="flex flex-col gap-1.5">
        {items.map((m) => (
          <div
            key={m.id}
            className="group rounded-lg bg-white/5 p-2 ring-1 ring-white/8 transition hover:bg-white/8"
          >
            <p className="truncate text-xs font-medium text-zinc-200">{m.originalName}</p>
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500">
                {assetKind(m) === "image"
                  ? `${m.width}×${m.height}`
                  : `${formatTime(m.duration)}${assetKind(m) === "video" ? ` · ${m.width}×${m.height}` : ""}`}
                {assetKind(m) === "video" && !m.hasAudio && " · no audio"}
              </span>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                {children(m)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-300 transition hover:bg-violet-500/20"
      title={title}
    >
      <Plus size={10} /> {label}
    </button>
  );
}

function VideoActions({ asset }: { asset: MediaAsset }) {
  const addClipFromMedia = useEditorStore((s) => s.addClipFromMedia);
  const addMediaToTrack = useEditorStore((s) => s.addMediaToTrack);
  return (
    <>
      <AddButton label="Main" title="Add to the main video track" onClick={() => addClipFromMedia(asset.id)} />
      <AddButton
        label="B-roll"
        title="Add as b-roll overlay at the playhead"
        onClick={() => addMediaToTrack(asset.id, "broll")}
      />
    </>
  );
}

function AudioActions({ asset }: { asset: MediaAsset }) {
  const addMediaToTrack = useEditorStore((s) => s.addMediaToTrack);
  return (
    <>
      <AddButton label="Music" title="Add to the music track at the playhead" onClick={() => addMediaToTrack(asset.id, "music")} />
      <AddButton label="SFX" title="Add to the sound-FX track at the playhead" onClick={() => addMediaToTrack(asset.id, "sfx")} />
      <AddButton label="Voice" title="Add to the voiceover track at the playhead" onClick={() => addMediaToTrack(asset.id, "voice")} />
    </>
  );
}

function ImageActions({ asset }: { asset: MediaAsset }) {
  const addMediaToTrack = useEditorStore((s) => s.addMediaToTrack);
  return (
    <AddButton
      label="Add"
      title="Add as image overlay at the playhead"
      onClick={() => addMediaToTrack(asset.id, "image")}
    />
  );
}
