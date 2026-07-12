"use client";

import { useRef, useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import { filmstripUrl, mediaUrl } from "@/lib/video/client";
import { formatTime } from "@/lib/video/timeline";
import { assetKind } from "@/lib/timeline/tracks";
import { Film, Image as ImageIcon, Music, Plus, Upload } from "lucide-react";

/** Left panel: upload zone + media library (video, audio, images) with
 *  real thumbnails, status badges and add-to-track actions. */
export default function MediaPanel() {
  const media = useEditorStore((s) => s.media);
  const { uploading, handleFiles } = useMediaUpload();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const videos = media.filter((m) => assetKind(m) === "video");
  const audios = media.filter((m) => assetKind(m) === "audio");
  const images = media.filter((m) => assetKind(m) === "image");

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
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
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition ${
          dragOver
            ? "border-fuchsia-400 bg-fuchsia-500/10"
            : "border-white/15 hover:border-violet-400/60 hover:bg-white/5"
        }`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20">
          <Upload size={16} />
        </div>
        {uploading ? (
          <div className="w-full">
            <p className="truncate text-[11px] text-zinc-400">
              {uploading.total > 1 && (
                <span className="mr-1 font-mono text-[10px] text-zinc-500">
                  {uploading.index}/{uploading.total}
                </span>
              )}
              {uploading.name}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                style={{ width: `${Math.round(uploading.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-zinc-200">Upload media</p>
            <p className="text-[10px] leading-snug text-zinc-500">
              video · music · images — drop or click
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
        {media.length === 0 && (
          <p className="mt-4 px-2 text-center text-[10px] leading-relaxed text-zinc-600">
            Your uploaded clips will appear here with thumbnails, ready to drop on the timeline.
          </p>
        )}
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
        <span className="font-mono text-zinc-700">{items.length}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {items.map((m) => (
          <MediaCard key={m.id} asset={m}>
            {children(m)}
          </MediaCard>
        ))}
      </div>
    </div>
  );
}

function MediaCard({ asset, children }: { asset: MediaAsset; children: React.ReactNode }) {
  const analysis = useEditorStore((s) => s.analyses[asset.id]);
  const kind = assetKind(asset);
  const analyzing = kind !== "image" && analysis === undefined;
  const vertical = asset.height > asset.width;

  return (
    <div className="group rounded-lg bg-white/5 p-1.5 ring-1 ring-white/8 transition hover:bg-white/8 hover:ring-white/15">
      <div className="flex items-center gap-2">
        <Thumb asset={asset} kind={kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-zinc-200">{asset.originalName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {kind !== "image" && (
              <Badge>{formatTime(asset.duration)}</Badge>
            )}
            {kind !== "audio" && asset.width > 0 && (
              <Badge>
                {vertical ? "▯" : "▭"} {asset.height >= 1080 || asset.width >= 1080 ? "HD" : `${asset.width}×${asset.height}`}
              </Badge>
            )}
            {kind === "video" && !asset.hasAudio && <Badge tone="warn">muted</Badge>}
            {analyzing && (
              <Badge tone="busy">
                <span className="mr-0.5 inline-block h-1 w-1 animate-pulse rounded-full bg-sky-300 align-middle" />
                analyzing
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-0.5 pt-0.5 opacity-0 transition group-hover:opacity-100">
        {children}
      </div>
    </div>
  );
}

/** Thumbnail: first filmstrip frame for videos, the file itself for images. */
function Thumb({ asset, kind }: { asset: MediaAsset; kind: "video" | "audio" | "image" }) {
  const aspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9;
  const height = 40;
  const width = Math.max(24, Math.min(64, Math.round(height * aspect)));

  if (kind === "audio") {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-white/10"
        style={{ width: 40, height }}
      >
        <Music size={14} />
      </div>
    );
  }
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl(asset.id)}
        alt=""
        className="shrink-0 rounded-md object-cover ring-1 ring-white/10"
        style={{ width, height }}
        loading="lazy"
        draggable={false}
      />
    );
  }
  // Middle frame of the 20-frame sprite reads as the clip's content.
  return (
    <div
      className="shrink-0 rounded-md bg-black/60 bg-no-repeat ring-1 ring-white/10"
      style={{
        width,
        height,
        backgroundImage: `url(${filmstripUrl(asset.id)})`,
        backgroundSize: "2000% 100%",
        backgroundPosition: `${(100 * 10) / 19}% 0%`,
      }}
    />
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "warn" | "busy" }) {
  const cls =
    tone === "warn"
      ? "bg-amber-500/15 text-amber-300"
      : tone === "busy"
        ? "bg-sky-500/15 text-sky-300"
        : "bg-white/8 text-zinc-500";
  return (
    <span className={`rounded px-1 py-px font-mono text-[9px] leading-tight ${cls}`}>{children}</span>
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
