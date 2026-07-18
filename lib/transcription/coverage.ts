import type { CaptionCoverage, Clip, MediaAsset } from "@/types";

export type CaptionCoverageStatus = "unknown" | "complete" | "incomplete";

/** A transcript becomes stale when trims, speed, or its paired audio changes. */
export function captionSourceSignature(clips: Clip[], media: MediaAsset[]): string {
  return clips
    .map((clip) => {
      const asset = media.find((candidate) => candidate.id === clip.mediaId);
      const linked = asset?.linkedAudio;
      const linkedAsset = linked
        ? media.find((candidate) => candidate.id === linked.audioAssetId)
        : undefined;
      const offset = Number.isFinite(linked?.offsetSeconds) ? linked?.offsetSeconds ?? 0 : 0;
      return [
        clip.id,
        clip.mediaId,
        clip.sourceStart.toFixed(3),
        clip.sourceEnd.toFixed(3),
        (clip.speed ?? 1).toFixed(3),
        asset?.hasAudio ? "camera-audio" : "silent-camera",
        linked?.audioAssetId ?? "no-linked-audio",
        offset.toFixed(3),
        linkedAsset?.hasAudio ? "linked-audio" : "missing-linked-audio",
      ].join(":");
    })
    .join("|");
}

export function mergeCaptionCoverage(
  previous: CaptionCoverage | null,
  next: CaptionCoverage,
  merge: boolean
): CaptionCoverage {
  const canMerge = merge && previous?.sourceSignature === next.sourceSignature;
  return {
    sourceSignature: next.sourceSignature,
    coveredClipIds: canMerge
      ? [...new Set([...previous.coveredClipIds, ...next.coveredClipIds])]
      : next.coveredClipIds,
  };
}

export function captionCoverageStatus(
  coverage: CaptionCoverage | null,
  clips: Clip[],
  media: MediaAsset[],
  requestedClipIds?: string[]
): CaptionCoverageStatus {
  if (!coverage) return "unknown";
  if (coverage.sourceSignature !== captionSourceSignature(clips, media)) return "incomplete";
  const covered = new Set(coverage.coveredClipIds);
  const requested = requestedClipIds ?? clips.map((clip) => clip.id);
  return requested.every((id) => covered.has(id)) ? "complete" : "incomplete";
}
