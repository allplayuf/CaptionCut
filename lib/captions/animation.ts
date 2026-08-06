/**
 * Caption entrance animations — the short-form "pop" that makes captions read
 * as designed rather than as subtitles.
 *
 * This module is the single source of truth for the motion. The preview reads
 * it to drive a CSS transform off the playhead, and the ASS exporter reads the
 * same keyframes to emit libass `\t` transforms, so what plays in the editor is
 * what gets burned in.
 *
 * Two deliberate restrictions keep that promise honest:
 *
 *  - **Scale and alpha only.** libass interpolates those per event. Animating
 *    position would need `\move` with absolute coordinates, which would fight
 *    the alignment + MarginV layout that lets libass handle wrapping and
 *    centering identically to the preview's flexbox.
 *  - **Piecewise linear.** `\t` only interpolates linearly, so the overshoot
 *    that gives "pop" its snap is expressed as two linear segments rather than
 *    an easing curve. The preview walks the exact same segments.
 */

export type CaptionAnimation = "none" | "pop" | "pump" | "fade";

export interface CaptionKeyframe {
  /** Seconds since the caption appeared. */
  t: number;
  /** 1 = natural size. */
  scale: number;
  /** 0..1. */
  opacity: number;
}

/** Keyframes per animation. First frame is always t=0; last is the resting state. */
const KEYFRAMES: Record<CaptionAnimation, CaptionKeyframe[]> = {
  none: [{ t: 0, scale: 1, opacity: 1 }],
  // Snap up from small, overshoot a touch, settle. The classic TikTok caption.
  pop: [
    { t: 0, scale: 0.62, opacity: 0 },
    { t: 0.09, scale: 1.06, opacity: 1 },
    { t: 0.16, scale: 1, opacity: 1 },
  ],
  // Barely an entrance — the energy lives in the per-word beat instead.
  pump: [
    { t: 0, scale: 0.9, opacity: 1 },
    { t: 0.07, scale: 1.05, opacity: 1 },
    { t: 0.13, scale: 1, opacity: 1 },
  ],
  fade: [
    { t: 0, scale: 1, opacity: 0 },
    { t: 0.18, scale: 1, opacity: 1 },
  ],
};

/** How much the word currently being spoken grows. 1 = no per-word motion. */
const WORD_SCALE: Record<CaptionAnimation, number> = {
  none: 1,
  pop: 1.1,
  pump: 1.22,
  fade: 1,
};

export const CAPTION_ANIMATIONS: Array<{ id: CaptionAnimation; name: string; hint: string }> = [
  { id: "none", name: "None", hint: "Captions cut straight in." },
  { id: "pop", name: "Pop", hint: "Snaps up with a bounce, and each word pops." },
  { id: "pump", name: "Pump", hint: "Subtle entrance, heavy beat on every word." },
  { id: "fade", name: "Fade", hint: "Soft fade in. Calm and clean." },
];

export function captionKeyframes(animation: CaptionAnimation): CaptionKeyframe[] {
  return KEYFRAMES[animation] ?? KEYFRAMES.none;
}

export function captionWordScale(animation: CaptionAnimation): number {
  return WORD_SCALE[animation] ?? 1;
}

/** Total entrance length in seconds (0 when the animation is a no-op). */
export function captionAnimationDuration(animation: CaptionAnimation): number {
  const frames = captionKeyframes(animation);
  return frames[frames.length - 1].t;
}

/**
 * Animation state `elapsed` seconds after the caption appeared. Before the
 * first keyframe it clamps to the first; after the last it clamps to rest.
 */
export function captionAnimationAt(
  animation: CaptionAnimation,
  elapsed: number
): CaptionKeyframe {
  const frames = captionKeyframes(animation);
  if (elapsed <= 0) return frames[0];
  const last = frames[frames.length - 1];
  if (elapsed >= last.t) return last;

  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (elapsed <= b.t) {
      const span = b.t - a.t;
      const k = span <= 0 ? 1 : (elapsed - a.t) / span;
      return {
        t: elapsed,
        scale: a.scale + (b.scale - a.scale) * k,
        opacity: a.opacity + (b.opacity - a.opacity) * k,
      };
    }
  }
  return last;
}

/**
 * The keyframes still ahead of `elapsed`, rebased so `t` counts from that
 * moment. The ASS exporter needs this because a caption with word-level
 * highlighting is emitted as several dialogue events: each one has to pick the
 * entrance up mid-flight rather than restart it.
 */
export function captionAnimationRemainder(
  animation: CaptionAnimation,
  elapsed: number
): CaptionKeyframe[] {
  const frames = captionKeyframes(animation);
  const end = frames[frames.length - 1].t;
  if (elapsed >= end) return [];
  return frames
    .filter((frame) => frame.t > elapsed)
    .map((frame) => ({ ...frame, t: frame.t - Math.max(0, elapsed) }));
}
