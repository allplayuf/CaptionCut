import type { Clip, Track } from "@/types";
import { clipSpeed } from "@/lib/video/timeline";

/**
 * Transitions between main-track clips.
 *
 * A transition here is a coloured veil that peaks exactly on the cut: the
 * outgoing clip sinks into it, the incoming clip rises out of it. That shape is
 * deliberate, because it is the only one the exporter can render without
 * breaking its own rules.
 *
 * The exporter partitions the main track into flat pieces and joins them with a
 * single linear concat — it never runs two pieces at once, because split/concat
 * fan-out deadlocks ffmpeg's filter scheduler. A cross dissolve fundamentally
 * needs both clips decoding simultaneously, so it cannot be expressed here. A
 * veil can: it is one overlay applied AFTER the concat, which is exactly how
 * the existing flash effect already works, and the preview mirrors it with a
 * single positioned div.
 */

export type TransitionKind = "none" | "dip" | "flash";

/** Total length of the veil, centred on the cut. */
export const TRANSITION_DURATION = 0.4;

export const TRANSITIONS: Array<{
  id: TransitionKind;
  name: string;
  hint: string;
  color: string;
  /** Veil opacity at the cut itself. */
  peak: number;
}> = [
  { id: "none", name: "Cut", hint: "A straight cut.", color: "#000000", peak: 0 },
  { id: "dip", name: "Dip", hint: "Falls through black. Good for section breaks.", color: "#000000", peak: 1 },
  { id: "flash", name: "Flash", hint: "Punches through white. Good on big moments.", color: "#FFFFFF", peak: 0.85 },
];

export function transitionSpec(kind: TransitionKind) {
  return TRANSITIONS.find((t) => t.id === kind) ?? TRANSITIONS[0];
}

export interface TransitionCut {
  /** Timeline instant of the cut — the veil's peak. */
  time: number;
  kind: Exclude<TransitionKind, "none">;
  color: string;
  peak: number;
  duration: number;
}

/**
 * Every transition on the main track, as timeline cuts.
 *
 * Clip start times are recomputed from durations rather than read off
 * `startTime` so this agrees with the exporter, which lays pieces out the same
 * way. The first clip is skipped: there is no cut to transition across.
 */
export function transitionCuts(clips: Clip[]): TransitionCut[] {
  const cuts: TransitionCut[] = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    const duration = Math.max(0, clip.sourceEnd - clip.sourceStart) / clipSpeed(clip);
    if (index > 0) {
      const kind = clip.transition ?? "none";
      if (kind !== "none") {
        const spec = transitionSpec(kind);
        cuts.push({
          time: cursor,
          kind,
          color: spec.color,
          peak: spec.peak,
          duration: TRANSITION_DURATION,
        });
      }
    }
    cursor += duration;
  });
  return cuts;
}

/**
 * Veil colour and opacity at a timeline instant, or null between transitions.
 * The ramp is linear to the cut and linear away from it — the same triangle the
 * exporter builds out of a fade-in/fade-out pair.
 */
export function transitionVeilAt(
  clips: Clip[],
  time: number
): { color: string; opacity: number } | null {
  for (const cut of transitionCuts(clips)) {
    const half = cut.duration / 2;
    const distance = Math.abs(time - cut.time);
    if (distance >= half) continue;
    return { color: cut.color, opacity: cut.peak * (1 - distance / half) };
  }
  return null;
}

/** Convenience for the preview, which holds tracks rather than legacy clips. */
export function mainTransitionVeilAt(
  tracks: Track[],
  time: number,
  toClips: (tracks: Track[]) => Clip[]
): { color: string; opacity: number } | null {
  return transitionVeilAt(toClips(tracks), time);
}
