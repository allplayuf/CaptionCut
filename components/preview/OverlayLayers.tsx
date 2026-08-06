"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MediaAsset, TimelineClip, TrackType } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { usePlayheadFrame } from "@/lib/ui/playhead";
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

/** Shared empty result so an inactive track keeps a stable selector identity. */
const NO_CLIPS: TimelineClip[] = [];

/**
 * The clips of `type` that are live at the playhead.
 *
 * The selector resolves all the way down to clip objects owned by the store,
 * so `useShallow` compares the same references on every playback frame where
 * the visible set hasn't changed — and the caller doesn't re-render. That is
 * the whole reason these layers no longer subscribe to `currentTime` directly.
 */
function useActiveClips(type: TrackType, respectHidden: boolean): TimelineClip[] {
  return useEditorStore(
    useShallow((s) => {
      const track = findTrack(s.tracks, type);
      if (!track || (respectHidden && track.hidden)) return NO_CLIPS;
      return clipsAt(track, s.currentTime);
    })
  );
}

function useTrackMuted(type: TrackType): boolean {
  return useEditorStore((s) => findTrack(s.tracks, type)?.muted ?? false);
}

export function VisualOverlays({ scale, canvasW, canvasH }: LayerProps) {
  const media = useEditorStore((s) => s.media);
  const brollMuted = useTrackMuted("broll");
  const broll = useActiveClips("broll", true);
  const images = useActiveClips("image", true);

  // B-roll first, images above it — the export composites them in this order.
  return (
    <>
      {broll.map((clip) => {
        const asset = media.find((m) => m.id === clip.assetId);
        return asset ? (
          <BrollVideo key={clip.id} clip={clip} asset={asset} muted={brollMuted} />
        ) : null;
      })}
      {images.map((clip) => {
        const asset = media.find((m) => m.id === clip.assetId);
        return asset ? (
          <ImageOverlay
            key={clip.id}
            clip={clip}
            asset={asset}
            scale={scale}
            canvasW={canvasW}
            canvasH={canvasH}
          />
        ) : null;
      })}
    </>
  );
}

export function TextOverlays({ scale, canvasW, canvasH }: LayerProps) {
  const text = useActiveClips("text", true);
  const stickers = useActiveClips("sticker", true);

  return (
    <>
      {text.map((clip) => (
        <TextSticker
          key={clip.id}
          clip={clip}
          scale={scale}
          canvasW={canvasW}
          canvasH={canvasH}
          sticker={false}
        />
      ))}
      {stickers.map((clip) => (
        <TextSticker
          key={clip.id}
          clip={clip}
          scale={scale}
          canvasW={canvasW}
          canvasH={canvasH}
          sticker
        />
      ))}
    </>
  );
}

export function AudioTracks() {
  const media = useEditorStore((s) => s.media);
  // Audio keeps playing under a hidden track — only `muted` silences it.
  const music = useActiveClips("music", false);
  const sfx = useActiveClips("sfx", false);
  const voice = useActiveClips("voice", false);
  const musicMuted = useTrackMuted("music");
  const sfxMuted = useTrackMuted("sfx");
  const voiceMuted = useTrackMuted("voice");

  const players = (clips: TimelineClip[], muted: boolean) =>
    clips.map((clip) => {
      const asset = media.find((m) => m.id === clip.assetId);
      return asset ? (
        <AudioClipPlayer key={clip.id} clip={clip} asset={asset} muted={muted} />
      ) : null;
    });

  return (
    <>
      {players(music, musicMuted)}
      {players(sfx, sfxMuted)}
      {players(voice, voiceMuted)}
    </>
  );
}

/* ---------------------------------------------------------------- */

/** Keep a media element's clock glued to the timeline while mounted. */
function useMediaSync(
  ref: React.RefObject<HTMLMediaElement | null>,
  clip: TimelineClip,
  opts: { volume: number; muted: boolean }
) {
  const isPlaying = useEditorStore((s) => s.isPlaying);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, opts.volume));
    el.muted = opts.muted || opts.volume <= 0.001;
  }, [ref, opts.volume, opts.muted]);

  // Drift correction watches every playback frame but never re-renders: the
  // element already advances on its own clock and only needs a nudge when it
  // has genuinely slipped away from the timeline.
  usePlayheadFrame((time) => {
    const el = ref.current;
    if (!el) return;
    const want = (clip.sourceStart ?? 0) + (time - clip.startTime);
    // Reseek only on real drift so smooth playback isn't interrupted.
    if (Math.abs(el.currentTime - want) > 0.25) {
      el.currentTime = Math.max(0, want);
    }
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isPlaying) void el.play().catch(() => {});
    else el.pause();
  }, [ref, isPlaying]);
}

/** Snap targets on the reference canvas: center, rule-of-thirds lines. */
const SNAP_X = [0, -REF_W / 6, REF_W / 6];
const SNAP_Y = [0, -REF_H / 6, REF_H / 6];
/** Snap radius in reference pixels. */
const SNAP_DIST = 26;
/** Overlays can't be dragged fully off the canvas. */
const CLAMP_X = REF_W * 0.55;
const CLAMP_Y = REF_H * 0.55;

export interface OverlayDragState {
  /** Live position in reference coordinates (already snapped + clamped). */
  refX: number;
  refY: number;
  /** Guide line the position snapped to (reference coords), if any. */
  snapX: number | null;
  snapY: number | null;
}

/**
 * Drag an overlay around the preview with center/thirds snapping and
 * canvas-bounds clamping; the transform commits once on release (a single
 * undo step). Pixel deltas convert back to reference coordinates through the
 * same x/y scales used to place the element.
 */
function useOverlayDrag(clip: TimelineClip, xScalePx: number, yScalePx: number, defaultScale: number) {
  const [drag, setDrag] = useState<OverlayDragState | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const store = useEditorStore.getState();
    store.selectClip(clip.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const t0 = clip.transform ?? {};
    const baseX = t0.x ?? 0;
    const baseY = t0.y ?? 0;

    const position = (ev: PointerEvent): OverlayDragState => {
      let refX = baseX + (ev.clientX - sx) / xScalePx;
      let refY = baseY + (ev.clientY - sy) / yScalePx;
      refX = Math.max(-CLAMP_X, Math.min(CLAMP_X, refX));
      refY = Math.max(-CLAMP_Y, Math.min(CLAMP_Y, refY));
      let snapX: number | null = null;
      let snapY: number | null = null;
      if (!ev.shiftKey) {
        for (const target of SNAP_X) {
          if (Math.abs(refX - target) < SNAP_DIST) {
            refX = target;
            snapX = target;
            break;
          }
        }
        for (const target of SNAP_Y) {
          if (Math.abs(refY - target) < SNAP_DIST) {
            refY = target;
            snapY = target;
            break;
          }
        }
      }
      return { refX: Math.round(refX), refY: Math.round(refY), snapX, snapY };
    };

    let last: OverlayDragState | null = null;
    const move = (ev: PointerEvent) => {
      if (!last && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      last = position(ev);
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!last) return; // plain click — selection only
      useEditorStore.getState().updateTimelineClip(clip.id, {
        transform: {
          x: last.refX,
          y: last.refY,
          scale: t0.scale ?? defaultScale,
          rotation: t0.rotation ?? 0,
          opacity: t0.opacity ?? 1,
        },
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { drag, onPointerDown };
}

/** Center/thirds guide lines + safe-margin frame shown while dragging. */
function DragGuides({
  drag,
  xScalePx,
  yScalePx,
}: {
  drag: OverlayDragState;
  xScalePx: number;
  yScalePx: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* safe margins (70px reference inset, like the caption box) */}
      <div
        className="absolute border border-dashed border-white/25"
        style={{ left: 70 * xScalePx, right: 70 * xScalePx, top: 70 * yScalePx, bottom: 70 * yScalePx }}
      />
      {drag.snapX !== null && (
        <div
          className="absolute inset-y-0 w-px bg-[var(--cut)]"
          style={{ left: `calc(50% + ${drag.snapX * xScalePx}px)` }}
        />
      )}
      {drag.snapY !== null && (
        <div
          className="absolute inset-x-0 h-px bg-[var(--cut)]"
          style={{ top: `calc(50% + ${drag.snapY * yScalePx}px)` }}
        />
      )}
    </div>
  );
}

function BrollVideo({ clip, asset, muted }: { clip: TimelineClip; asset: MediaAsset; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useMediaSync(ref, clip, { volume: clip.volume ?? 0, muted });
  const opacity = clip.transform?.opacity ?? 1;
  return (
    <video
      ref={ref}
      src={mediaUrl(asset)}
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
  const posX = drag ? drag.refX : t.x ?? 0;
  const posY = drag ? drag.refY : t.y ?? 0;
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${posX * xScalePx}px)`,
    top: `calc(50% + ${posY * yScalePx}px)`,
    width,
    transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
    opacity: t.opacity ?? 1,
    borderRadius: 8 * scale,
    cursor: drag ? "grabbing" : "grab",
    outline: selected ? "1.5px dashed rgba(255,255,255,0.75)" : undefined,
    outlineOffset: 2,
  };
  return (
    <>
      {drag && <DragGuides drag={drag} xScalePx={xScalePx} yScalePx={yScalePx} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(asset)} alt="" style={style} draggable={false} onPointerDown={onPointerDown} />
    </>
  );
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
  const posX = drag ? drag.refX : t.x ?? 0;
  const posY = drag ? drag.refY : t.y ?? 0;

  const style: CSSProperties = {
    position: "absolute",
    left: `calc(50% + ${posX * xScalePx}px)`,
    top: `calc(50% + ${posY * yScalePx}px)`,
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
    <>
      {drag && <DragGuides drag={drag} xScalePx={xScalePx} yScalePx={yScalePx} />}
      <div style={style} onPointerDown={onPointerDown} title="Drag to reposition (Shift = no snapping)">
        {clip.text}
      </div>
    </>
  );
}

function AudioClipPlayer({ clip, asset, muted }: { clip: TimelineClip; asset: MediaAsset; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useMediaSync(ref, clip, { volume: clip.volume ?? 1, muted });
  return <audio ref={ref} src={mediaUrl(asset)} preload="auto" />;
}
