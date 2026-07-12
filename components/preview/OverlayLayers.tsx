"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaAsset, TimelineClip } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { clipsAt, findTrack } from "@/lib/timeline/tracks";

/**
 * Composites the non-main tracks over the preview:
 *   b-roll video and image overlays (visual layers, inside the zoom wrapper),
 *   text graphics and stickers (above zoom, like captions),
 *   music/sfx/voice playback (invisible <audio> elements kept in sync).
 * Overlay coordinates live in the 1080x1920 reference system and are scaled
 * onto the format canvas (x by canvasW/1080, y by canvasH/1920) exactly like
 * the exporter, so every format previews what gets rendered.
 * Text, sticker and image overlays are draggable directly in the preview.
 */

/** Reference canvas overlay transforms are authored on. */
const REF_W = 1080;
const REF_H = 1920;

interface LayerProps {
  scale: number;
  canvasW: number;
  canvasH: number;
}

export function VisualOverlays({ scale, canvasW, canvasH }: LayerProps) {
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
          <ImageOverlay
            key={clip.id}
            clip={clip}
            asset={asset}
            scale={scale}
            canvasW={canvasW}
            canvasH={canvasH}
          />
        )
      );
    }
  }
  return <>{layers}</>;
}

export function TextOverlays({ scale, canvasW, canvasH }: LayerProps) {
  const tracks = useEditorStore((s) => s.tracks);
  const currentTime = useEditorStore((s) => s.currentTime);

  const layers: React.ReactNode[] = [];
  for (const type of ["text", "sticker"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.hidden) continue;
    for (const clip of clipsAt(track, currentTime)) {
      layers.push(
        <TextSticker
          key={clip.id}
          clip={clip}
          scale={scale}
          canvasW={canvasW}
          canvasH={canvasH}
          sticker={type === "sticker"}
        />
      );
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

/**
 * Drag an overlay around the preview; the transform commits once on release
 * (a single undo step). Pixel deltas convert back to reference coordinates
 * through the same x/y scales used to place the element.
 */
function useOverlayDrag(clip: TimelineClip, xScalePx: number, yScalePx: number, defaultScale: number) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const store = useEditorStore.getState();
    store.selectClip(clip.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => setDrag({ dx: ev.clientX - sx, dy: ev.clientY - sy });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      const t = clip.transform ?? {};
      useEditorStore.getState().updateTimelineClip(clip.id, {
        transform: {
          x: Math.round((t.x ?? 0) + dx / xScalePx),
          y: Math.round((t.y ?? 0) + dy / yScalePx),
          scale: t.scale ?? defaultScale,
          rotation: t.rotation ?? 0,
          opacity: t.opacity ?? 1,
        },
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { drag, onPointerDown };
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

function ImageOverlay({
  clip,
  asset,
  scale,
  canvasW,
  canvasH,
}: {
  clip: TimelineClip;
  asset: MediaAsset;
} & LayerProps) {
  const selected = useEditorStore((s) => s.selectedClipId === clip.id);
  const t = clip.transform ?? {};
  const xScalePx = (canvasW / REF_W) * scale;
  const yScalePx = (canvasH / REF_H) * scale;
  const { drag, onPointerDown } = useOverlayDrag(clip, xScalePx, yScalePx, 0.8);
  const width = canvasW * (t.scale ?? 0.8) * scale;
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${(t.x ?? 0) * xScalePx + (drag?.dx ?? 0)}px)`,
    top: `calc(50% + ${(t.y ?? 0) * yScalePx + (drag?.dy ?? 0)}px)`,
    width,
    transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    opacity: t.opacity ?? 1,
    borderRadius: 8 * scale,
    cursor: drag ? "grabbing" : "grab",
    outline: selected ? "1.5px dashed rgba(255,255,255,0.75)" : undefined,
    outlineOffset: 2,
  };
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaUrl(asset.id)} alt="" style={style} draggable={false} onPointerDown={onPointerDown} />;
}

function TextSticker({
  clip,
  scale,
  canvasW,
  canvasH,
  sticker,
}: { clip: TimelineClip; sticker: boolean } & LayerProps) {
  const selected = useEditorStore((s) => s.selectedClipId === clip.id);
  const t = clip.transform ?? {};
  const s = clip.style ?? {};
  const xScalePx = (canvasW / REF_W) * scale;
  const yScalePx = (canvasH / REF_H) * scale;
  const { drag, onPointerDown } = useOverlayDrag(clip, xScalePx, yScalePx, 1);
  // Font size scales with canvas height, matching the ASS export.
  const fontSize = (s.fontSize ?? (sticker ? 160 : 64)) * (t.scale ?? 1) * (canvasH / REF_H) * scale;
  const hasBox = !sticker && s.backgroundColor != null;

  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${(t.x ?? 0) * xScalePx + (drag?.dx ?? 0)}px)`,
    top: `calc(50% + ${(t.y ?? 0) * yScalePx + (drag?.dy ?? 0)}px)`,
    transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    opacity: t.opacity ?? 1,
    fontSize,
    lineHeight: 1.2,
    textAlign: "center",
    maxWidth: `${86}%`,
    whiteSpace: "pre-wrap",
    cursor: drag ? "grabbing" : "grab",
    outline: selected ? "1.5px dashed rgba(255,255,255,0.75)" : undefined,
    outlineOffset: 4,
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
  return (
    <div style={style} onPointerDown={onPointerDown} title="Drag to reposition">
      {clip.text}
    </div>
  );
}

function AudioClipPlayer({ clip, asset, muted }: { clip: TimelineClip; asset: MediaAsset; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useMediaSync(ref, clip, { volume: clip.volume ?? 1, muted });
  return <audio ref={ref} src={mediaUrl(asset.id)} preload="auto" />;
}
