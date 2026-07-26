"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import { suggestAudioSync } from "@/lib/audio/sync";
import { filmstripUrl, mediaUrl } from "@/lib/video/client";
import { formatTime } from "@/lib/video/timeline";
import { assetKind } from "@/lib/timeline/tracks";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import {
  Check,
  Cloud,
  Film,
  Image as ImageIcon,
  Link2,
  Music,
  Plus,
  RefreshCw,
  Unlink2,
  Upload,
  X,
} from "lucide-react";

/** Left panel: upload zone + media library (video, audio, images) with
 *  real thumbnails, status badges and add-to-track actions. */
export default function MediaPanel() {
  const media = useEditorStore((s) => s.media);
  const { uploading, handleFiles } = useMediaUpload();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pairingVideo, setPairingVideo] = useState<MediaAsset | null>(null);

  const videos = media.filter((m) => assetKind(m) === "video");
  const audios = media.filter((m) => assetKind(m) === "audio");
  const images = media.filter((m) => assetKind(m) === "image");

  return (
    <div className="flex h-full flex-col gap-3 bg-[#101216] p-4">
      <div className="mb-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7db8ff]">
          Media
        </p>
        <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.025em] text-[#f0f3f6]">
          Source media
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[#778391]">
          Video goes to the main track. Audio and images use their own layers.
        </p>
      </div>
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

      <div
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
        className={`rounded-lg border border-dashed p-3 transition ${
          dragOver
            ? "border-[#ffb45b] bg-[#ffb45b]/10"
            : "border-white/[0.12] bg-[#0b0e13] hover:border-[#7db8ff]/45 hover:bg-[#0d1117]"
        }`}
      >
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
                className="h-full rounded-full bg-[#ffb45b] transition-all"
                style={{ width: `${Math.round(uploading.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#66717f]">
              Add media
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-[#ffb45b] px-2 py-2 text-[10px] font-bold text-[#191209] transition hover:bg-[#ffc477]"
              >
                <Upload size={12} /> Device
              </button>
              <GoogleDriveButton className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-white/8 px-2 py-2 text-[10px] font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/12 disabled:opacity-50">
                <Cloud size={12} className="text-[#7db8ff]" /> Drive
              </GoogleDriveButton>
            </div>
            <p className="mt-2 text-center text-[9px] leading-snug text-zinc-600">
              Drop video, audio, or images here
            </p>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MediaGroup icon={<Film size={11} />} label="Video" items={videos}>
          {(m) => <VideoActions asset={m} onPair={() => setPairingVideo(m)} />}
        </MediaGroup>
        <MediaGroup icon={<Music size={11} />} label="Audio" items={audios}>
          {(m) => <AudioActions asset={m} />}
        </MediaGroup>
        <MediaGroup icon={<ImageIcon size={11} />} label="Images" items={images}>
          {(m) => <ImageActions asset={m} />}
        </MediaGroup>
        {media.length === 0 && (
          <p className="mt-4 px-2 text-center text-[10px] leading-relaxed text-zinc-600">
            Imported media appears here, ready for the timeline.
          </p>
        )}
      </div>

      {pairingVideo && (
        <PairAudioModal
          key={pairingVideo.id}
          video={pairingVideo}
          audios={audios}
          onClose={() => setPairingVideo(null)}
        />
      )}
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
  const media = useEditorStore((s) => s.media);
  const kind = assetKind(asset);
  const analyzing = kind !== "image" && analysis === undefined;
  const vertical = asset.height > asset.width;
  const linkedVideos =
    kind === "audio"
      ? media.filter((candidate) => candidate.linkedAudio?.audioAssetId === asset.id)
      : [];

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
            {kind === "video" && asset.linkedAudio && (
              <Badge tone="linked">
                <Link2 size={8} className="mr-0.5 inline" /> paired
              </Badge>
            )}
            {kind === "audio" && linkedVideos.length > 0 && (
              <Badge tone="linked">
                <Link2 size={8} className="mr-0.5 inline" /> {linkedVideos.length} video
                {linkedVideos.length === 1 ? "" : "s"}
              </Badge>
            )}
            {analyzing && (
              <Badge tone="busy">
                <span className="mr-0.5 inline-block h-1 w-1 animate-pulse rounded-full bg-sky-300 align-middle" />
                analyzing
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-0.5 pt-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
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
        src={mediaUrl(asset)}
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
        backgroundImage: `url(${filmstripUrl(asset)})`,
        backgroundSize: "2000% 100%",
        backgroundPosition: `${(100 * 10) / 19}% 0%`,
      }}
    />
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn" | "busy" | "linked";
}) {
  const cls =
    tone === "warn"
      ? "bg-amber-500/15 text-amber-300"
      : tone === "busy"
        ? "bg-sky-500/15 text-sky-300"
        : tone === "linked"
          ? "bg-emerald-500/15 text-emerald-300"
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

function VideoActions({ asset, onPair }: { asset: MediaAsset; onPair: () => void }) {
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
      <button
        type="button"
        onClick={onPair}
        className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/15"
        title={asset.linkedAudio ? "Change the linked audio source" : "Pair a separately recorded audio file"}
      >
        <Link2 size={10} /> {asset.linkedAudio ? "Linked" : "Pair"}
      </button>
    </>
  );
}

function AudioActions({ asset }: { asset: MediaAsset }) {
  const addMediaToTrack = useEditorStore((s) => s.addMediaToTrack);
  const setMusicFromAsset = useEditorStore((s) => s.setMusicFromAsset);
  return (
    <>
      <AddButton
        label="Music"
        title="Set as the soundtrack (replaces the music track; montage cuts lock to its beat)"
        onClick={() => setMusicFromAsset(asset.id)}
      />
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

export function PairAudioModal({
  video,
  audios,
  onClose,
}: {
  video: MediaAsset;
  audios: MediaAsset[];
  onClose: () => void;
}) {
  const recommended = bestAudioMatch(video, audios);
  const initialAudioId = video.linkedAudio?.audioAssetId ?? recommended?.id ?? audios[0]?.id ?? "";
  const [audioId, setAudioId] = useState(initialAudioId);
  const [offsetSeconds, setOffsetSeconds] = useState(video.linkedAudio?.offsetSeconds ?? 0);
  const [muteCameraAudio, setMuteCameraAudio] = useState(
    video.linkedAudio?.muteCameraAudio ?? true
  );
  const [syncMethod, setSyncMethod] = useState<"starts" | "waveform" | "manual">(
    video.linkedAudio?.syncMethod ?? "starts"
  );
  const [confidence, setConfidence] = useState(video.linkedAudio?.confidence);
  const dialogRef = useRef<HTMLDivElement>(null);
  const analyses = useEditorStore((s) => s.analyses);
  const linkAudioToVideo = useEditorStore((s) => s.linkAudioToVideo);
  const unlinkAudioFromVideo = useEditorStore((s) => s.unlinkAudioFromVideo);
  // A Drive import can finish while this dialog is open. Resolve a fresh
  // fallback during render so the controlled select becomes usable without
  // a cascading state update in an effect.
  const resolvedAudioId = audios.some((candidate) => candidate.id === audioId)
    ? audioId
    : bestAudioMatch(video, audios)?.id ?? audios[0]?.id ?? "";
  const audio = audios.find((candidate) => candidate.id === resolvedAudioId);
  const canWaveformSync = Boolean(
    analyses[video.id]?.audio && analyses[resolvedAudioId]?.audio
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const nudge = (delta: number) => {
    setOffsetSeconds((value) => Math.round((value + delta) * 100) / 100);
    setSyncMethod("manual");
    setConfidence(undefined);
  };

  const autoSync = () => {
    const suggestion = suggestAudioSync(analyses[video.id], analyses[resolvedAudioId]);
    if (!suggestion) {
      useEditorStore
        .getState()
        .addToast("info", "Sound analysis is not ready for both files yet. Align their starts for now.");
      return;
    }
    setOffsetSeconds(suggestion.offsetSeconds);
    setConfidence(suggestion.confidence);
    setSyncMethod("waveform");
    useEditorStore.getState().addToast(
      suggestion.confidence >= 0.55 ? "success" : "info",
      suggestion.confidence >= 0.55
        ? `Sound matched at ${formatSignedSeconds(suggestion.offsetSeconds)}.`
        : "A possible sound match was found. Preview it and fine-tune the offset if needed."
    );
  };

  const confirm = () => {
    if (!audio) return;
    linkAudioToVideo(video.id, audio.id, {
      offsetSeconds,
      muteCameraAudio,
      syncMethod,
      confidence,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-audio-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-[#12121b] shadow-2xl shadow-black/70 ring-1 ring-white/12"
      >
        <div className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <Link2 size={11} /> Linked sources
            </p>
            <h2 id="pair-audio-title" className="text-base font-bold text-zinc-100">
              Pair video with separate audio
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              The audio follows every trim, split, reorder and speed change on this video.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
            aria-label="Close audio pairing"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SourceChip icon={<Film size={13} />} tone="video" name={video.originalName} />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 to-emerald-500/25 text-emerald-300 ring-1 ring-white/10">
              <Link2 size={13} />
            </div>
            <SourceChip
              icon={<Music size={13} />}
              tone="audio"
              name={audio?.originalName ?? "Choose audio"}
            />
          </div>

          {audios.length === 0 ? (
            <div className="rounded-xl border border-dashed border-emerald-400/25 bg-emerald-500/[0.05] p-4 text-center">
              <Music size={18} className="mx-auto text-emerald-300" />
              <p className="mt-2 text-xs font-semibold text-zinc-200">Add the separate audio first</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                Import a recorder, microphone or sound file, then choose it here.
              </p>
              <GoogleDriveButton
                kind="audio"
                className="mx-auto mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-[10px] font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/12"
              >
                <Cloud size={12} className="text-sky-300" /> Choose from Drive
              </GoogleDriveButton>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Audio file
                </span>
                <select
                  value={resolvedAudioId}
                  onChange={(event) => {
                    setAudioId(event.target.value);
                    setOffsetSeconds(0);
                    setSyncMethod("starts");
                    setConfidence(undefined);
                  }}
                  className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs text-zinc-200 outline-none ring-1 ring-white/10 transition focus:ring-emerald-400/50"
                >
                  {audios.map((candidate) => (
                    <option key={candidate.id} value={candidate.id} className="bg-zinc-900">
                      {candidate.originalName}
                      {candidate.id === recommended?.id ? " · best match" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-zinc-200">Sync timing</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      Match scratch audio automatically, or align the starts.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={autoSync}
                    disabled={!canWaveformSync}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500/12 px-2.5 py-2 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/20 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      canWaveformSync
                        ? "Match the two recordings by their sound energy"
                        : "Audio analysis is still preparing"
                    }
                  >
                    <RefreshCw size={11} /> Auto-sync sound
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => nudge(-0.1)}
                    className="h-8 rounded-lg bg-white/6 px-2.5 font-mono text-xs text-zinc-300 ring-1 ring-white/8 hover:bg-white/10"
                    title="Advance audio by 0.1 seconds"
                  >
                    −0.1
                  </button>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Audio delay in seconds</span>
                    <div className="relative">
                      <input
                        type="number"
                        min={-600}
                        max={600}
                        step={0.01}
                        value={offsetSeconds}
                        onChange={(event) => {
                          setOffsetSeconds(Number(event.target.value) || 0);
                          setSyncMethod("manual");
                          setConfidence(undefined);
                        }}
                        className="h-8 w-full rounded-lg bg-white/[0.06] px-2 pr-7 text-center font-mono text-xs tabular-nums text-zinc-100 outline-none ring-1 ring-white/10 focus:ring-emerald-400/50"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-zinc-600">
                        s
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => nudge(0.1)}
                    className="h-8 rounded-lg bg-white/6 px-2.5 font-mono text-xs text-zinc-300 ring-1 ring-white/8 hover:bg-white/10"
                    title="Delay audio by 0.1 seconds"
                  >
                    +0.1
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-zinc-600">
                  <span>Negative advances · positive delays audio</span>
                  <span className="font-mono text-emerald-400/80">
                    {syncMethod === "waveform"
                      ? `${Math.round((confidence ?? 0) * 100)}% match`
                      : syncMethod === "manual"
                        ? "manual"
                        : "starts aligned"}
                  </span>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/[0.035] p-3 ring-1 ring-white/8">
                <input
                  type="checkbox"
                  checked={muteCameraAudio}
                  onChange={(event) => setMuteCameraAudio(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                />
                <span>
                  <span className="block text-[11px] font-semibold text-zinc-200">
                    Use the separate audio instead of camera audio
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                    Turn this off to mix both recordings together.
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/8 bg-black/15 px-5 py-3.5">
          {video.linkedAudio ? (
            <button
              type="button"
              onClick={() => {
                unlinkAudioFromVideo(video.id);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold text-rose-300 transition hover:bg-rose-500/10"
            >
              <Unlink2 size={12} /> Unlink
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[10px] font-semibold text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!audio}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-emerald-500 px-3 py-2 text-[10px] font-bold text-white shadow-lg shadow-emerald-500/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={12} /> {video.linkedAudio ? "Update pair" : "Pair sources"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceChip({
  icon,
  name,
  tone,
}: {
  icon: React.ReactNode;
  name: string;
  tone: "video" | "audio";
}) {
  return (
    <div
      className={`min-w-0 rounded-xl p-2.5 ring-1 ${
        tone === "video"
          ? "bg-violet-500/8 text-violet-300 ring-violet-400/15"
          : "bg-emerald-500/8 text-emerald-300 ring-emerald-400/15"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="truncate text-[10px] font-semibold text-zinc-200" title={name}>
          {name}
        </span>
      </div>
    </div>
  );
}

function bestAudioMatch(video: MediaAsset, audios: MediaAsset[]): MediaAsset | undefined {
  const videoTokens = nameTokens(video.originalName);
  return [...audios]
    .map((audio) => {
      const audioTokens = nameTokens(audio.originalName);
      const shared = audioTokens.filter((token) => videoTokens.includes(token)).length;
      const durationDelta = Math.abs(video.duration - audio.duration);
      const durationScore = 1 - Math.min(1, durationDelta / Math.max(1, video.duration));
      return { audio, score: shared * 3 + durationScore };
    })
    .sort((a, b) => b.score - a.score)[0]?.audio;
}

function nameTokens(name: string): string[] {
  const ignored = new Set(["audio", "video", "track", "recording", "rec", "mic", "camera", "cam"]);
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function formatSignedSeconds(seconds: number): string {
  const value = Math.round(seconds * 100) / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}s`;
}
