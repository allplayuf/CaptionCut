import type { Clip } from "@/types";

/** Pure timeline math shared by the preview player, the timeline UI and the server export. */

/** Playback rate of a clip, clamped to the range the exporter supports. */
export function clipSpeed(clip: { speed?: number }): number {
  const s = clip.speed ?? 1;
  return Math.min(2, Math.max(0.5, s > 0 ? s : 1));
}

export function clipDuration(clip: Clip): number {
  return Math.max(0, clip.sourceEnd - clip.sourceStart) / clipSpeed(clip);
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

export interface TimelinePosition {
  clip: Clip;
  clipIndex: number;
  /** Absolute timeline time where this clip starts. */
  clipTimelineStart: number;
  /** Position inside the source video, seconds. */
  sourceTime: number;
}

/** Map an absolute timeline time to the clip + source-time that should be shown. */
export function timelineToSource(clips: Clip[], time: number): TimelinePosition | null {
  let offset = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const dur = clipDuration(clip);
    if (time < offset + dur || i === clips.length - 1) {
      const local = Math.min(Math.max(0, time - offset), dur);
      return {
        clip,
        clipIndex: i,
        clipTimelineStart: offset,
        sourceTime: clip.sourceStart + local * clipSpeed(clip),
      };
    }
    offset += dur;
  }
  return null;
}

/** Timeline start time of the clip at the given index. */
export function clipStartTime(clips: Clip[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += clipDuration(clips[i]);
  return offset;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${tenth}`;
}
