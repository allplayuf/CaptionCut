"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { MediaAsset, TimelineClip } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { clipsAt, findTrack } from "@/lib/timeline/tracks";

/**
 * Composites the non-main tracks over the 9:16 preview:
 *   b-roll video and image overlays (visual layers, inside the zoom wrapper),
 *   text graphics and stickers (above zoom, like captions),
 *   music/sfx/voice playback (invisible <audio> elements kept in sync).
 * All geometry matches the 1080x1920 export canvas via `scale`.
 */

export function VisualOverlays({ scale }: { scale: number }) {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const currentTime = useEditorStore((s) => s.currentTime);

  const layers: React.ReactNode[] = [];
  for (const type of ["broll", "image"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.hidden) continue;
    for (const clip of clipsAt(track, currentTime)) {
      const asset = media.find((m) => m.id === clip.assetId);
      if (!asset) continue;
      layers.push(
        type === "broll" ? (
          <BrollVideo key={clip.id} clip={clip} asset={asset} muted={track.muted} />
        ) : (
          <ImageOverlay key={clip.id} clip={clip} asset={asset} scale={scale} />
        )
      );
    }
  }
  return <>{layers}</>;
}

export function TextOverlays({ scale }: { scale: number }) {
  const tracks = useEditorStore((s) => s.tracks);
  const currentTime = useEditorStore((s) => s.currentTime);

  const layers: React.ReactNode[] = [];
  for (const type of ["text", "sticker"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.hidden) continue;
    for (const clip of clipsAt(track, currentTime)) {
      layers.push(<TextSticker key={clip.id} clip={clip} scale={scale} sticker={type === "sticker"} />);
    }
  }
  return <>{layers}</>;
}

export function AudioTracks() {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const currentTime = useEditorStore((s) => s.currentTime);

  const players: React.ReactNode[] = [];
  for (const type of ["music", "sfx", "voice"] as const) {
    const track = findTrack(tracks, type);
    if (!track) continue;
    for (const clip of clipsAt(track, currentTime)) {
      const asset = media.find((m) => m.id === clip.assetId);
      if (!asset) continue;
      players.push(<AudioClipPlayer key={clip.id} clip={clip} asset={asset} muted={track.muted} />);
    }
  }
  return <>{players}</>;
}

/* ---------------------------------------------------------------- */

/** Keep a media element's clock glued to the timeline while mounted. */
function useMediaSync(
  ref: React.RefObject<HTMLMediaElement | null>,
  clip: TimelineClip,
  opts: { volume: number; muted: boolean }
) {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentTime = useEditorStore((s) => s.currentTime);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, opts.volume));
    el.muted = opts.muted || opts.volume <= 0.001;
  }, [ref, opts.volume, opts.muted]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = (clip.sourceStart ?? 0) + (currentTime - clip.startTime);
    // Reseek only on real drift so smooth playback isn't interrupted.
    if (Math.abs(el.currentTime - want) > 0.25) {
      el.currentTime = Math.max(0, want);
    }
  }, [ref, currentTime, clip.sourceStart, clip.startTime]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isPlaying) void el.play().catch(() => {});
    else el.pause();
  }, [ref, isPlaying]);
}

function BrollVideo({ clip, asset, muted }: { clip: TimelineClip; asset: MediaAsset; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useMediaSync(ref, clip, { volume: clip.volume ?? 0, muted });
  const opacity = clip.transform?.opacity ?? 1;
  return (
    <video
      ref={ref}
      src={mediaUrl(asset.id)}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ opacity }}
      playsInline
      preload="auto"
    />
  );
}

function ImageOverlay({ clip, asset, scale }: { clip: TimelineClip; asset: MediaAsset; scale: number }) {
  const t = clip.transform ?? {};
  const width = 1080 * (t.scale ?? 0.8) * scale;
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${(t.x ?? 0) * scale}px)`,
    top: `calc(50% + ${(t.y ?? 0) * scale}px)`,
    width,
    transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    opacity: t.opacity ?? 1,
    borderRadius: 8 * scale,
  };
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaUrl(asset.id)} alt="" style={style} draggable={false} />;
}

function TextSticker({ clip, scale, sticker }: { clip: TimelineClip; scale: number; sticker: boolean }) {
  const t = clip.transform ?? {};
  const s = clip.style ?? {};
  const fontSize = (s.fontSize ?? (sticker ? 160 : 64)) * (t.scale ?? 1) * scale;
  const hasBox = !sticker && s.backgroundColor != null;

  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${(t.x ?? 0) * scale}px)`,
    top: `calc(50% + ${(t.y ?? 0) * scale}px)`,
    transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    opacity: t.opacity ?? 1,
    fontSize,
    lineHeight: 1.2,
    textAlign: "center",
    maxWidth: `${86}%`,
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
    ...(sticker
      ? {}
      : {
          fontFamily: `'${s.fontFamily ?? "Arial"}', sans-serif`,
          fontWeight: s.fontWeight ?? 900,
          color: s.color ?? "#FFFFFF",
          ...(hasBox
            ? {
                backgroundColor: s.backgroundColor as string,
                padding: `${8 * scale}px ${16 * scale}px`,
                borderRadius: 10 * scale,
              }
            : (s.strokeWidth ?? 0) > 0
              ? {
                  WebkitTextStroke: `${(s.strokeWidth ?? 0) * 2 * scale}px ${s.strokeColor ?? "#000"}`,
                  paintOrder: "stroke fill",
                }
              : {}),
        }),
  };
  return <div style={style}>{clip.text}</div>;
}

function AudioClipPlayer({ clip, asset, muted }: { clip: TimelineClip; asset: MediaAsset; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useMediaSync(ref, clip, { volume: clip.volume ?? 1, muted });
  return <audio ref={ref} src={mediaUrl(asset.id)} preload="auto" />;
}
