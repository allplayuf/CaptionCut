import { nanoid } from "nanoid";
import type {
  AssetKind,
  Caption,
  Clip,
  MediaAsset,
  Project,
  TimeRange,
  TimelineClip,
  Track,
  TrackType,
  WordTiming,
} from "@/types";

/**
 * Multi-track timeline model.
 *
 * The MAIN VIDEO track is ripple-sequential (like CapCut's primary track):
 * its clips are always contiguous from t=0 and define the project duration.
 * Every other track holds freely positioned clips with absolute start/end
 * times. Captions live in project.captions (their own dedicated lane).
 */

/** Render/stacking order of tracks in the timeline UI (top row first). */
export const TRACK_ORDER: TrackType[] = [
  "text",
  "sticker",
  "image",
  "broll",
  "effects",
  "video",
  "voice",
  "music",
  "sfx",
];

const TRACK_NAMES: Record<TrackType, string> = {
  video: "Video",
  broll: "B-roll",
  image: "Images",
  caption: "Captions",
  text: "Text",
  sticker: "Stickers",
  music: "Music",
  sfx: "Sound FX",
  voice: "Voiceover",
  effects: "Effects",
};

export function createDefaultTracks(): Track[] {
  return TRACK_ORDER.map((type) => createTrack(type));
}

export function createTrack(type: TrackType): Track {
  return {
    id: nanoid(8),
    type,
    name: TRACK_NAMES[type],
    locked: false,
    muted: false,
    hidden: false,
    clips: [],
  };
}

/** Infer the asset kind for legacy assets saved before `kind` existed. */
export function assetKind(asset: MediaAsset): AssetKind {
  if (asset.kind) return asset.kind;
  if (asset.mimeType.startsWith("audio/")) return "audio";
  if (asset.mimeType.startsWith("image/")) return "image";
  return "video";
}

/** The single main video track (created if a caller ever hits a bad state). */
export function mainVideoTrack(tracks: Track[]): Track {
  return tracks.find((t) => t.type === "video") ?? createTrack("video");
}

export function findTrack(tracks: Track[], type: TrackType): Track | undefined {
  return tracks.find((t) => t.type === type);
}

/** Main-track clips in the legacy sequential shape used by preview/export/transcribe. */
export function mainClips(tracks: Track[]): Clip[] {
  return mainVideoTrack(tracks).clips.map((c) => ({
    id: c.id,
    mediaId: c.assetId ?? "",
    sourceStart: c.sourceStart ?? 0,
    sourceEnd: c.sourceEnd ?? 0,
    speed: c.speed,
  }));
}

/** Playback rate of a clip, clamped to the range the exporter supports. */
export function clipSpeedOf(clip: { speed?: number }): number {
  const s = clip.speed ?? 1;
  return Math.min(2, Math.max(0.5, s > 0 ? s : 1));
}

/** Project duration = main video track length. */
export function tracksDuration(tracks: Track[]): number {
  const clips = mainVideoTrack(tracks).clips;
  return clips.length ? clips[clips.length - 1].endTime : 0;
}

/** Re-layout the main track so clips are contiguous from 0 (ripple). */
export function rippleMainTrack(track: Track): Track {
  let cursor = 0;
  const clips = track.clips.map((c) => {
    const dur = Math.max(0, (c.sourceEnd ?? 0) - (c.sourceStart ?? 0)) / clipSpeedOf(c);
    const laid = { ...c, startTime: round3(cursor), endTime: round3(cursor + dur) };
    cursor += dur;
    return laid;
  });
  return { ...track, clips };
}

export function makeMainClip(asset: MediaAsset, sourceStart = 0, sourceEnd?: number): TimelineClip {
  const end = sourceEnd ?? asset.duration;
  return {
    id: nanoid(8),
    type: "video",
    assetId: asset.id,
    startTime: 0, // ripple layout fixes these
    endTime: end - sourceStart,
    sourceStart,
    sourceEnd: end,
  };
}

/* ------------------------------------------------------------------ */
/* Legacy migration                                                    */
/* ------------------------------------------------------------------ */

/** Build v2 tracks from any project shape (legacy clips[] or existing tracks). */
export function migrateTracks(project: Project): Track[] {
  if (project.tracks && project.tracks.length > 0) {
    // Ensure every standard track exists (older v2 saves may miss some).
    const tracks = [...project.tracks];
    for (const type of TRACK_ORDER) {
      if (!tracks.some((t) => t.type === type)) tracks.push(createTrack(type));
    }
    return sortTracks(tracks).map((t) => (t.type === "video" ? rippleMainTrack(t) : t));
  }

  const tracks = createDefaultTracks();
  const video = mainVideoTrack(tracks);
  const legacy = project.clips ?? [];
  video.clips = legacy.map((c) => ({
    id: c.id,
    type: "video" as const,
    assetId: c.mediaId,
    startTime: 0,
    endTime: c.sourceEnd - c.sourceStart,
    sourceStart: c.sourceStart,
    sourceEnd: c.sourceEnd,
  }));
  return sortTracks(tracks).map((t) => (t.type === "video" ? rippleMainTrack(t) : t));
}

export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => TRACK_ORDER.indexOf(a.type) - TRACK_ORDER.indexOf(b.type));
}

/* ------------------------------------------------------------------ */
/* Placement / snapping                                                */
/* ------------------------------------------------------------------ */

/** Clamp a free-track clip into the first gap at-or-after its start time. */
export function placeWithoutOverlap(track: Track, clip: TimelineClip): TimelineClip {
  const dur = clip.endTime - clip.startTime;
  const others = track.clips
    .filter((c) => c.id !== clip.id)
    .sort((a, b) => a.startTime - b.startTime);
  let start = Math.max(0, clip.startTime);
  for (const other of others) {
    if (start + dur <= other.startTime + 0.001) break;
    if (start < other.endTime) start = other.endTime;
  }
  return { ...clip, startTime: round3(start), endTime: round3(start + dur) };
}

/** Snap a time to the nearest target within threshold (returns input if none). */
export function snapTime(time: number, targets: number[], threshold: number): number {
  let best = time;
  let bestDist = threshold;
  for (const t of targets) {
    const d = Math.abs(t - time);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** All snap targets: playhead + clip edges on every track + captions. */
export function snapTargets(tracks: Track[], captions: Caption[], playhead: number): number[] {
  const targets = [0, playhead];
  for (const track of tracks) {
    for (const c of track.clips) targets.push(c.startTime, c.endTime);
  }
  for (const c of captions) targets.push(c.startTime, c.endTime);
  return targets;
}

/* ------------------------------------------------------------------ */
/* Time remapping (cuts / reorder) — the heart of auto-editing         */
/* ------------------------------------------------------------------ */

export interface TimeRemap {
  /** Map an original-timeline time to the new timeline; null if removed. */
  point(t: number): number | null;
  /** Like point() but collapses removed times onto the cut seam. */
  collapse(t: number): number;
  totalDuration: number;
}

/**
 * Build a remap for a rearrangement of the original timeline into
 * `keptRanges` (in output order). Handles plain cuts (monotonic ranges)
 * and reorders (e.g. moving a hook moment to the front).
 */
export function buildTimeRemap(keptRanges: TimeRange[]): TimeRemap {
  const ranges = keptRanges
    .map((r) => ({ start: r.start, end: r.end }))
    .filter((r) => r.end - r.start > 0.0005);
  const offsets: number[] = [];
  let cursor = 0;
  for (const r of ranges) {
    offsets.push(cursor);
    cursor += r.end - r.start;
  }
  const totalDuration = cursor;

  const point = (t: number): number | null => {
    for (let i = 0; i < ranges.length; i++) {
      if (t >= ranges[i].start - 0.0005 && t <= ranges[i].end + 0.0005) {
        return round3(offsets[i] + Math.min(Math.max(0, t - ranges[i].start), ranges[i].end - ranges[i].start));
      }
    }
    return null;
  };

  const collapse = (t: number): number => {
    const exact = point(t);
    if (exact !== null) return exact;
    // Sum kept durations that (in original order) precede t.
    let acc = 0;
    for (const r of ranges) {
      acc += Math.max(0, Math.min(t, r.end) - r.start);
    }
    return round3(Math.min(acc, totalDuration));
  };

  return { point, collapse, totalDuration };
}

/**
 * Slice the main video track to the kept ranges (in output order).
 * `rangeSpeeds` (parallel to keptRanges) applies a playback-rate ramp to
 * every clip sliced out of that range (composed with any existing speed).
 */
export function rearrangeMainTrack(
  track: Track,
  keptRanges: TimeRange[],
  rangeSpeeds?: (number | undefined)[]
): Track {
  const source = track.clips;
  const outClips: TimelineClip[] = [];

  keptRanges.forEach((range, ri) => {
    const rampSpeed = rangeSpeeds?.[ri];
    for (const clip of source) {
      const overlapStart = Math.max(range.start, clip.startTime);
      const overlapEnd = Math.min(range.end, clip.endTime);
      if (overlapEnd - overlapStart < 0.02) continue;
      // Timeline seconds → source seconds through the clip's own speed.
      const speed = clipSpeedOf(clip);
      const srcStart = (clip.sourceStart ?? 0) + (overlapStart - clip.startTime) * speed;
      const srcEnd = (clip.sourceStart ?? 0) + (overlapEnd - clip.startTime) * speed;
      const outSpeed = rampSpeed !== undefined ? clipSpeedOf({ speed: speed * rampSpeed }) : clip.speed;
      outClips.push({
        ...clip,
        id: nanoid(8),
        sourceStart: round3(srcStart),
        sourceEnd: round3(srcEnd),
        speed: outSpeed,
        startTime: 0,
        endTime: srcEnd - srcStart,
      });
    }
  });

  return rippleMainTrack({ ...track, clips: outClips });
}

/** Remap captions through a rearrangement, slicing across cut seams. */
export function remapCaptions(captions: Caption[], keptRanges: TimeRange[]): Caption[] {
  const ranges = keptRanges.filter((r) => r.end - r.start > 0.0005);
  const offsets: number[] = [];
  let cursor = 0;
  for (const r of ranges) {
    offsets.push(cursor);
    cursor += r.end - r.start;
  }

  const out: Caption[] = [];
  for (const cap of captions) {
    const pieces: Caption[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const s = Math.max(cap.startTime, r.start);
      const e = Math.min(cap.endTime, r.end);
      if (e - s < 0.08) continue;
      const shift = offsets[i] - r.start;
      const words = cap.words
        ?.filter((w) => w.endTime > s + 0.01 && w.startTime < e - 0.01)
        .map((w) => ({
          ...w,
          startTime: round3(Math.max(s, w.startTime) + shift),
          endTime: round3(Math.min(e, w.endTime) + shift),
        }));
      pieces.push({
        ...cap,
        id: pieces.length === 0 ? cap.id : nanoid(8),
        startTime: round3(s + shift),
        endTime: round3(e + shift),
        text: words && words.length > 0 ? words.map((w) => w.word).join(" ") : cap.text,
        words: words && words.length > 0 ? words : undefined,
      });
    }
    out.push(...pieces);
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Remap all non-main tracks through a rearrangement.
 * Content-locked tracks (effects, text, stickers, overlays) get both edges
 * remapped and are dropped when they collapse; free audio tracks (music/sfx)
 * keep their duration and just shift.
 */
export function remapOverlayTracks(tracks: Track[], keptRanges: TimeRange[]): Track[] {
  const remap = buildTimeRemap(keptRanges);

  return tracks.map((track) => {
    if (track.type === "video") return track;

    const keepDuration = track.type === "music" || track.type === "sfx";
    const clips: TimelineClip[] = [];

    for (const clip of track.clips) {
      if (keepDuration) {
        const start = remap.collapse(clip.startTime);
        if (start >= remap.totalDuration - 0.05) continue;
        const dur = clip.endTime - clip.startTime;
        clips.push({ ...clip, startTime: start, endTime: round3(start + dur) });
      } else {
        const start = remap.collapse(clip.startTime);
        const end = remap.collapse(clip.endTime);
        if (end - start < 0.15) continue;
        clips.push({ ...clip, startTime: start, endTime: end });
      }
    }
    return { ...track, clips };
  });
}

/* ------------------------------------------------------------------ */
/* Preview queries                                                     */
/* ------------------------------------------------------------------ */

/** Active punch-in zoom factor at a timeline time (1 = none). */
export function zoomAt(tracks: Track[], time: number): { scale: number; anchorX: number; anchorY: number } {
  const effects = findTrack(tracks, "effects");
  if (!effects || effects.hidden) return { scale: 1, anchorX: 0.5, anchorY: 0.5 };
  for (const clip of effects.clips) {
    if (time >= clip.startTime && time < clip.endTime && clip.effect?.kind === "zoom") {
      return {
        scale: clip.effect.zoomScale ?? 1.15,
        anchorX: clip.effect.anchorX ?? 0.5,
        anchorY: clip.effect.anchorY ?? 0.45,
      };
    }
  }
  return { scale: 1, anchorX: 0.5, anchorY: 0.5 };
}

/** Active freeze-frame effect clip at a timeline time (null = none). */
export function freezeAt(tracks: Track[], time: number): TimelineClip | null {
  const effects = findTrack(tracks, "effects");
  if (!effects || effects.hidden) return null;
  for (const clip of effects.clips) {
    if (time >= clip.startTime && time < clip.endTime && clip.effect?.kind === "freeze") {
      return clip;
    }
  }
  return null;
}

/** White-flash opacity at a timeline time (1 at the flash start, decaying to 0). */
export function flashOpacityAt(tracks: Track[], time: number): number {
  const effects = findTrack(tracks, "effects");
  if (!effects || effects.hidden) return 0;
  let opacity = 0;
  for (const clip of effects.clips) {
    if (time >= clip.startTime && time < clip.endTime && clip.effect?.kind === "flash") {
      const dur = Math.max(0.05, clip.endTime - clip.startTime);
      // Linear decay matches the export's fade=t=out over the clip length.
      opacity = Math.max(opacity, 1 - (time - clip.startTime) / dur);
    }
  }
  return opacity;
}

export function clipsAt(track: Track, time: number): TimelineClip[] {
  return track.clips.filter((c) => time >= c.startTime && time < c.endTime);
}

/* ------------------------------------------------------------------ */
/* Source-anchored caption remapping                                   */
/* ------------------------------------------------------------------ */

const SRC_EPS = 0.002;

/** Map a timeline time on a laid-out main track to its source position. */
function mainSourcePointAt(
  clips: TimelineClip[],
  t: number
): { assetId: string; src: number } | null {
  for (const c of clips) {
    if (t < c.startTime - SRC_EPS || t > c.endTime + SRC_EPS) continue;
    if (!c.assetId || c.sourceStart === undefined) return null;
    const local = Math.min(Math.max(0, t - c.startTime), c.endTime - c.startTime);
    return { assetId: c.assetId, src: (c.sourceStart ?? 0) + local * clipSpeedOf(c) };
  }
  return null;
}

/** Map a source position back to the (first) main-track clip that contains it. */
function mainTimelinePointFor(
  clips: TimelineClip[],
  point: { assetId: string; src: number }
): number | null {
  for (const c of clips) {
    if (c.assetId !== point.assetId || c.sourceStart === undefined) continue;
    const s0 = c.sourceStart ?? 0;
    const s1 = c.sourceEnd ?? 0;
    if (point.src < s0 - SRC_EPS || point.src > s1 + SRC_EPS) continue;
    const local = Math.min(Math.max(0, point.src - s0), s1 - s0);
    return round3(c.startTime + local / clipSpeedOf(c));
  }
  return null;
}

/**
 * Re-time captions through ANY main-track change (trim, split, delete,
 * reorder, speed, replay-insert) by anchoring them to source positions:
 * each caption/word is mapped timeline → source on the old track, then
 * source → timeline on the new one. Words whose source footage was cut are
 * dropped; captions split when their words land in discontiguous places.
 * This is what keeps captions in sync when re-trimming after captioning.
 */
export function remapCaptionsToMainTrack(
  oldClips: TimelineClip[],
  newClips: TimelineClip[],
  captions: Caption[]
): Caption[] {
  if (captions.length === 0) return captions;

  const out: Caption[] = [];
  for (const cap of captions) {
    const words = cap.words && cap.words.length > 0 ? cap.words : null;

    if (words) {
      type Mapped = { word: WordTiming; start: number; end: number };
      const mapped: Mapped[] = [];
      for (const w of words) {
        const mid = mainSourcePointAt(oldClips, (w.startTime + w.endTime) / 2);
        if (!mid) continue;
        const nm = mainTimelinePointFor(newClips, mid);
        if (nm === null) continue; // this word's footage was cut
        const sp = mainSourcePointAt(oldClips, w.startTime) ?? mid;
        const ep = mainSourcePointAt(oldClips, w.endTime) ?? mid;
        const ns = mainTimelinePointFor(newClips, sp) ?? nm;
        const ne = mainTimelinePointFor(newClips, ep) ?? nm;
        if (ne - ns >= 0.02) mapped.push({ word: w, start: ns, end: ne });
        else mapped.push({ word: w, start: round3(Math.max(0, nm - 0.05)), end: round3(nm + 0.05) });
      }
      if (mapped.length === 0) continue;

      // Words that now sit far apart (cut seam / reorder) become separate captions.
      const runs: Mapped[][] = [[mapped[0]]];
      for (let i = 1; i < mapped.length; i++) {
        const prev = mapped[i - 1];
        const cur = mapped[i];
        if (cur.start < prev.end - 0.5 || cur.start - prev.end > 0.75) runs.push([cur]);
        else runs[runs.length - 1].push(cur);
      }
      // A caption that survived whole keeps its (possibly cleaned) text.
      const intact = runs.length === 1 && runs[0].length === words.length;
      runs.forEach((run, ri) => {
        out.push({
          ...cap,
          id: ri === 0 ? cap.id : nanoid(8),
          startTime: run[0].start,
          endTime: round3(Math.max(run[run.length - 1].end, run[0].start + 0.1)),
          text: intact ? cap.text : run.map((m) => m.word.word).join(" "),
          words: run.map((m) => ({ ...m.word, startTime: m.start, endTime: m.end })),
        });
      });
    } else {
      const sp = mainSourcePointAt(oldClips, cap.startTime + SRC_EPS);
      const ep = mainSourcePointAt(oldClips, cap.endTime - SRC_EPS);
      const ns = sp ? mainTimelinePointFor(newClips, sp) : null;
      const ne = ep ? mainTimelinePointFor(newClips, ep) : null;
      if (ns === null && ne === null) continue;
      const dur = cap.endTime - cap.startTime;
      const start = ns ?? Math.max(0, (ne ?? 0) - dur);
      const end = ne ?? start + dur;
      if (end - start >= 0.08) {
        out.push({ ...cap, startTime: round3(start), endTime: round3(end) });
      }
    }
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

/* ------------------------------------------------------------------ */

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Merge overlapping/adjacent ranges and sort them. */
export function mergeRanges(ranges: TimeRange[], joinGap = 0.01): TimeRange[] {
  const sorted = [...ranges]
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + joinGap) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Complement of `removed` within [0, duration] → kept ranges in order. */
export function invertRanges(removed: TimeRange[], duration: number): TimeRange[] {
  const merged = mergeRanges(removed);
  const kept: TimeRange[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor + 0.01) kept.push({ start: cursor, end: Math.min(r.start, duration) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < duration - 0.01) kept.push({ start: cursor, end: duration });
  return kept;
}

/** Words flattened out of captions with absolute times (transcript view). */
export function captionsToWords(captions: Caption[]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const cap of [...captions].sort((a, b) => a.startTime - b.startTime)) {
    if (cap.words && cap.words.length > 0) {
      words.push(...cap.words);
    } else {
      // Distribute evenly when word timings are missing.
      const parts = cap.text.trim().split(/\s+/).filter(Boolean);
      const dur = (cap.endTime - cap.startTime) / Math.max(1, parts.length);
      parts.forEach((word, i) =>
        words.push({
          word,
          startTime: round3(cap.startTime + i * dur),
          endTime: round3(cap.startTime + (i + 1) * dur),
        })
      );
    }
  }
  return words;
}
