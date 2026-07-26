import type {
  Caption,
  CaptionStyle,
  Clip,
  ExportPresetId,
  MediaAsset,
  Track,
} from "@/types";
import { findTrack, mainClips, tracksDuration } from "@/lib/timeline/tracks";
import type { AssOverlayEvent } from "./ass";

/**
 * The export wire format and its builder. Pure module (no fs/ffmpeg) so the
 * client can assemble the exact payload the server-side exporter consumes.
 * `clips` keeps the legacy v1 shape for the main track, everything else is
 * additive — old captions-only exports still work untouched.
 */

export interface OverlayPayload {
  kind: "broll" | "image";
  assetId: string;
  /** Timeline placement, seconds. */
  start: number;
  end: number;
  /** Source trim for video b-roll. */
  sourceStart?: number;
  /** Canvas-center offsets + fraction of canvas width (images only). */
  x: number;
  y: number;
  widthFrac: number;
  /** Clockwise rotation in degrees, matching the preview transform. */
  rotation: number;
  opacity: number;
}

export interface AudioClipPayload {
  assetId: string;
  start: number;
  end: number;
  sourceStart: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface ZoomPayload {
  start: number;
  end: number;
  scale: number;
  anchorX: number;
  anchorY: number;
  /** When set, the zoom ramps scale → endScale across the window (slow zoom). */
  endScale?: number;
  easing?: "smooth" | "linear" | "snappy";
}

/** Handheld-shake window: deterministic jitter, mirrors shakeOffset(). */
export interface ShakePayload {
  start: number;
  end: number;
  /** 0..1 */
  intensity: number;
  easing?: "smooth" | "linear" | "snappy";
}

/** Vignette + slight contrast-boost window. */
export interface VignettePayload {
  start: number;
  end: number;
  /** 0..1 */
  strength: number;
}

/** Freeze-frame window: video holds the frame at `start`, main audio silent. */
export interface FreezePayload {
  start: number;
  end: number;
}

/** White flash pop: full opacity at `start`, decays to 0 by `end`. */
export interface FlashPayload {
  start: number;
  end: number;
}

export interface ExportRequest {
  media: MediaAsset[];
  clips: Clip[];
  captions: Caption[];
  style: CaptionStyle;
  // v2 (all optional — absent on legacy payloads)
  overlays?: OverlayPayload[];
  audioClips?: AudioClipPayload[];
  textOverlays?: AssOverlayEvent[];
  zooms?: ZoomPayload[];
  freezes?: FreezePayload[];
  flashes?: FlashPayload[];
  shakes?: ShakePayload[];
  vignettes?: VignettePayload[];
  presetId?: ExportPresetId;
  mainAudioMuted?: boolean;
}

/** Flatten the project's tracks into the export payload. */
export function buildExportRequest(input: {
  media: MediaAsset[];
  tracks: Track[];
  captions: Caption[];
  style: CaptionStyle;
  presetId: ExportPresetId;
}): ExportRequest {
  const { media, tracks, captions, style, presetId } = input;
  const duration = tracksDuration(tracks);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));

  const overlays: OverlayPayload[] = [];
  for (const type of ["broll", "image"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.hidden) continue;
    for (const clip of track.clips) {
      if (!clip.assetId || !mediaById.has(clip.assetId)) continue;
      const start = clamp(clip.startTime);
      const end = clamp(clip.endTime);
      if (end - start < 0.05) continue;
      const t = clip.transform ?? {};
      overlays.push({
        kind: type,
        assetId: clip.assetId,
        start,
        end,
        sourceStart: clip.sourceStart,
        x: t.x ?? 0,
        y: t.y ?? 0,
        widthFrac: type === "image" ? (t.scale ?? 0.8) : 1,
        rotation: t.rotation ?? 0,
        opacity: t.opacity ?? 1,
      });
    }
  }

  const audioClips: AudioClipPayload[] = [];
  for (const type of ["music", "sfx", "voice"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.assetId || !mediaById.has(clip.assetId)) continue;
      const start = clamp(clip.startTime);
      const end = clamp(clip.endTime);
      if (end - start < 0.05 || (clip.volume ?? 1) <= 0.001) continue;
      audioClips.push({
        assetId: clip.assetId,
        start,
        end,
        sourceStart: clip.sourceStart ?? 0,
        volume: clip.volume ?? 1,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
      });
    }
  }
  // B-roll clips with audible volume contribute audio too.
  const broll = findTrack(tracks, "broll");
  if (broll && !broll.hidden && !broll.muted) {
    for (const clip of broll.clips) {
      const asset = clip.assetId ? mediaById.get(clip.assetId) : undefined;
      if (!asset || !asset.hasAudio || (clip.volume ?? 0) <= 0.001) continue;
      const start = clamp(clip.startTime);
      const end = clamp(clip.endTime);
      if (end - start < 0.05) continue;
      audioClips.push({
        assetId: clip.assetId!,
        start,
        end,
        sourceStart: clip.sourceStart ?? 0,
        volume: clip.volume ?? 1,
      });
    }
  }

  const textOverlays: AssOverlayEvent[] = [];
  for (const type of ["text", "sticker"] as const) {
    const track = findTrack(tracks, type);
    if (!track || track.hidden) continue;
    for (const clip of track.clips) {
      if (!clip.text) continue;
      const start = clamp(clip.startTime);
      const end = clamp(clip.endTime);
      if (end - start < 0.05) continue;
      const t = clip.transform ?? {};
      const s = clip.style ?? {};
      const scale = t.scale ?? 1;
      textOverlays.push({
        text: clip.text,
        start,
        end,
        x: t.x ?? 0,
        y: t.y ?? 0,
        fontFamily: s.fontFamily ?? "Arial",
        fontSize: Math.round((s.fontSize ?? (type === "sticker" ? 160 : 64)) * scale),
        fontWeight: s.fontWeight ?? 900,
        color: s.color ?? "#FFFFFF",
        strokeColor: s.strokeColor ?? "#000000",
        strokeWidth: s.strokeWidth ?? (type === "sticker" ? 0 : 5),
        backgroundColor: s.backgroundColor ?? null,
        rotation: t.rotation ?? 0,
        opacity: t.opacity ?? 1,
        sticker: type === "sticker",
      });
    }
  }

  const zooms: ZoomPayload[] = [];
  const freezes: FreezePayload[] = [];
  const flashes: FlashPayload[] = [];
  const shakes: ShakePayload[] = [];
  const vignettes: VignettePayload[] = [];
  const effects = findTrack(tracks, "effects");
  if (effects && !effects.hidden) {
    const IMPACT_FLASH = 0.35; // mirrors IMPACT_FLASH_DUR in lib/timeline/tracks
    for (const clip of effects.clips) {
      const start = clamp(clip.startTime);
      const end = clamp(clip.endTime);
      if (end - start < 0.05) continue;
      const fx = clip.effect;
      if (!fx) continue;
      if (fx.kind === "zoom") {
        const scale = fx.zoomScale ?? 1;
        if (scale <= 1.001) continue;
        zooms.push({
          start,
          end,
          scale: Math.min(2.5, scale),
          anchorX: fx.anchorX ?? 0.5,
          anchorY: fx.anchorY ?? 0.45,
        });
      } else if (fx.kind === "slow-zoom") {
        const endScale = Math.min(2.5, Math.max(1.01, fx.zoomScale ?? 1.25));
        zooms.push({
          start,
          end,
          scale: 1,
          endScale,
          easing: fx.easing ?? "smooth",
          anchorX: fx.anchorX ?? 0.5,
          anchorY: fx.anchorY ?? 0.45,
        });
      } else if (fx.kind === "impact") {
        // One clip explodes into its zoom + shake + flash components.
        zooms.push({
          start,
          end,
          scale: Math.min(2.5, fx.zoomScale ?? 1.2),
          endScale: 1.02,
          easing: fx.easing ?? "snappy",
          anchorX: fx.anchorX ?? 0.5,
          anchorY: fx.anchorY ?? 0.45,
        });
        shakes.push({
          start,
          end,
          intensity: Math.min(1, Math.max(0.1, fx.intensity ?? 0.6)),
          easing: fx.easing ?? "smooth",
        });
        flashes.push({ start, end: Math.min(end, start + IMPACT_FLASH) });
      } else if (fx.kind === "shake") {
        shakes.push({
          start,
          end,
          intensity: Math.min(1, Math.max(0.1, fx.intensity ?? 0.6)),
          easing: fx.easing ?? "smooth",
        });
      } else if (fx.kind === "vignette") {
        vignettes.push({ start, end, strength: Math.min(1, Math.max(0.05, fx.strength ?? 0.5)) });
      } else if (fx.kind === "freeze") {
        freezes.push({ start, end });
      } else if (fx.kind === "flash") {
        flashes.push({ start, end });
      }
    }
    zooms.sort((a, b) => a.start - b.start);
    freezes.sort((a, b) => a.start - b.start);
    flashes.sort((a, b) => a.start - b.start);
    shakes.sort((a, b) => a.start - b.start);
    vignettes.sort((a, b) => a.start - b.start);
  }

  return {
    media,
    clips: mainClips(tracks),
    captions,
    style,
    overlays,
    audioClips,
    textOverlays,
    zooms,
    freezes,
    flashes,
    shakes,
    vignettes,
    presetId,
    mainAudioMuted: findTrack(tracks, "video")?.muted ?? false,
  };
}
