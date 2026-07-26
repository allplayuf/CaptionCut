import type { MediaAsset, Project } from "@/types";
import type { ExportRequest } from "@/lib/export/request";

export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
export const MAX_ANALYZE_BYTES = 512 * 1024;

const SAFE_ID = /^[a-zA-Z0-9_-]{4,64}$/;
const SAFE_FILENAME = /^[a-zA-Z0-9_-]{4,64}\.[a-zA-Z0-9]{1,8}$/;
const SAFE_FONT = /^[\p{L}\p{N} ._-]{1,80}$/u;
const EXPORT_PRESETS = new Set(["tiktok", "tiktok-60", "square", "landscape", "draft"]);

export function requestTooLarge(request: Request, limit: number): boolean {
  const size = Number(request.headers.get("content-length"));
  return Number.isFinite(size) && size > limit;
}

export function jsonTooLarge(value: unknown, limit: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") > limit;
  } catch {
    return true;
  }
}

export function validateProjectPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid project payload.";
  const project = value as Partial<Project>;
  if (!isSafeId(project.id)) return "Invalid project id.";
  if (
    typeof project.name !== "string" ||
    project.name.length > 80
  ) {
    return "Project names can contain at most 80 characters.";
  }
  if (!finite(project.createdAt) || !finite(project.updatedAt)) {
    return "Invalid project timestamps.";
  }
  if (!Array.isArray(project.media) || project.media.length > 200) {
    return "A project can contain at most 200 media files.";
  }
  if (project.media.some((asset) => validateMediaAsset(asset) !== null)) {
    return "The project contains invalid media.";
  }
  if (!Array.isArray(project.captions) || project.captions.length > 10_000) {
    return "A project can contain at most 10,000 captions.";
  }
  if (
    project.captions.some(
      (caption) =>
        !caption ||
        !isSafeId(caption.id) ||
        typeof caption.text !== "string" ||
        caption.text.length > 2_000 ||
        !validRange(caption.startTime, caption.endTime, 21_600)
    )
  ) {
    return "The project contains invalid captions.";
  }
  if (!project.style || typeof project.style !== "object") {
    return "Missing caption style.";
  }
  if (project.tracks !== undefined) {
    if (!Array.isArray(project.tracks) || project.tracks.length > 20) {
      return "A project can contain at most 20 tracks.";
    }
    const clipCount = project.tracks.reduce(
      (sum, track) => sum + (Array.isArray(track?.clips) ? track.clips.length : 5_001),
      0
    );
    if (clipCount > 5_000) return "A project can contain at most 5,000 timeline clips.";
    for (const track of project.tracks) {
      if (
        !track ||
        !isSafeId(track.id) ||
        typeof track.name !== "string" ||
        track.name.length > 120 ||
        !Array.isArray(track.clips)
      ) {
        return "The project contains an invalid track.";
      }
      for (const clip of track.clips) {
        if (
          !clip ||
          !isSafeId(clip.id) ||
          !validRange(clip.startTime, clip.endTime, 21_600) ||
          (clip.assetId !== undefined && !isSafeId(clip.assetId)) ||
          (clip.text !== undefined &&
            (typeof clip.text !== "string" || clip.text.length > 2_000))
        ) {
          return "The project contains an invalid timeline clip.";
        }
      }
    }
  }
  if (project.versions !== undefined && (!Array.isArray(project.versions) || project.versions.length > 20)) {
    return "A project can contain at most 20 saved versions.";
  }
  return null;
}

export function validateMediaAsset(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid media asset.";
  const asset = value as Partial<MediaAsset>;
  if (!isSafeId(asset.id) || typeof asset.filename !== "string" || !SAFE_FILENAME.test(asset.filename)) {
    return "Invalid media identity.";
  }
  if (
    typeof asset.originalName !== "string" ||
    asset.originalName.length === 0 ||
    asset.originalName.length > 300 ||
    typeof asset.mimeType !== "string" ||
    asset.mimeType.length > 120
  ) {
    return "Invalid media metadata.";
  }
  if (
    !finite(asset.size) ||
    asset.size! < 0 ||
    !finite(asset.duration) ||
    asset.duration! < 0 ||
    asset.duration! > 21_600 ||
    !finite(asset.width) ||
    !finite(asset.height) ||
    !finite(asset.fps)
  ) {
    return "Invalid media dimensions or duration.";
  }
  if (asset.storageUrl !== undefined && !trustedBlobUrl(asset.storageUrl)) {
    return "Untrusted media URL.";
  }
  return null;
}

export function validateExportPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid export payload.";
  const body = value as Partial<ExportRequest>;
  if (!Array.isArray(body.media) || body.media.length === 0 || body.media.length > 200) {
    return "An export requires 1–200 media files.";
  }
  if (body.media.some((asset) => validateMediaAsset(asset) !== null)) {
    return "The export contains invalid media.";
  }
  if (!Array.isArray(body.clips) || body.clips.length === 0 || body.clips.length > 1_000) {
    return "An export requires 1–1,000 video clips.";
  }
  let duration = 0;
  for (const clip of body.clips) {
    if (
      !clip ||
      !isSafeId(clip.id) ||
      !isSafeId(clip.mediaId) ||
      !validRange(clip.sourceStart, clip.sourceEnd, 21_600) ||
      (clip.speed !== undefined && (!finite(clip.speed) || clip.speed < 0.05 || clip.speed > 8))
    ) {
      return "The export contains an invalid video clip.";
    }
    duration += (clip.sourceEnd - clip.sourceStart) / (clip.speed ?? 1);
  }
  if (!finite(duration) || duration > 1_800) {
    return "Exports are limited to 30 minutes.";
  }
  if (!Array.isArray(body.captions) || body.captions.length > 10_000) {
    return "An export can contain at most 10,000 captions.";
  }
  if (
    body.captions.some(
      (caption) =>
        !caption ||
        typeof caption.text !== "string" ||
        caption.text.length > 2_000 ||
        !validRange(caption.startTime, caption.endTime, 1_800)
    )
  ) {
    return "The export contains invalid captions.";
  }
  if (!body.style || typeof body.style !== "object" || !SAFE_FONT.test(body.style.fontFamily ?? "")) {
    return "The export contains an invalid caption style.";
  }
  if (body.presetId !== undefined && !EXPORT_PRESETS.has(body.presetId)) {
    return "Unknown export preset.";
  }

  const collections: Array<[unknown, number, string]> = [
    [body.overlays, 500, "overlays"],
    [body.audioClips, 500, "audio clips"],
    [body.textOverlays, 1_000, "text overlays"],
    [body.zooms, 500, "zoom effects"],
    [body.freezes, 500, "freeze effects"],
    [body.flashes, 500, "flash effects"],
    [body.shakes, 500, "shake effects"],
    [body.vignettes, 500, "vignette effects"],
  ];
  for (const [collection, max, label] of collections) {
    if (collection !== undefined && (!Array.isArray(collection) || collection.length > max)) {
      return `The export contains too many ${label}.`;
    }
  }

  const ranges = [
    ...(body.overlays ?? []),
    ...(body.audioClips ?? []),
    ...(body.textOverlays ?? []),
    ...(body.zooms ?? []),
    ...(body.freezes ?? []),
    ...(body.flashes ?? []),
    ...(body.shakes ?? []),
    ...(body.vignettes ?? []),
  ];
  if (
    ranges.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        !validRange(
          (item as { start?: number }).start,
          (item as { end?: number }).end,
          1_800
        )
    )
  ) {
    return "The export contains an invalid timed layer.";
  }
  if (
    (body.overlays ?? []).some((item) => !isSafeId(item.assetId)) ||
    (body.audioClips ?? []).some((item) => !isSafeId(item.assetId)) ||
    (body.textOverlays ?? []).some(
      (item) =>
        typeof item.text !== "string" ||
        item.text.length > 2_000 ||
        !SAFE_FONT.test(item.fontFamily)
    )
  ) {
    return "The export contains invalid layer content.";
  }
  return null;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validRange(start: unknown, end: unknown, max: number): boolean {
  return (
    finite(start) &&
    finite(end) &&
    start >= 0 &&
    end > start &&
    end <= max
  );
}

function trustedBlobUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
