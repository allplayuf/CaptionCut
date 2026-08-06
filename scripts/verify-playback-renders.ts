/**
 * Playback render-cost guard (dev tool).
 * Run: npx tsx scripts/verify-playback-renders.ts
 *
 * The playback loop writes `currentTime` into the store on every animation
 * frame. That is fine on its own — what made the editor feel laggy was ten
 * components subscribing to that raw value and re-rendering sixty times a
 * second each.
 *
 * The fix was to make every playback subscriber select a DERIVED value (a
 * caption index, a clip index, an active-clip list) so zustand's equality
 * check absorbs the frames where nothing visibly changed. This script measures
 * exactly that: sweep a playhead across a realistic timeline at 60fps and count
 * how often each selector's OUTPUT changes, which is precisely how many times
 * React would re-render the component using it.
 *
 * A regression here — someone reselecting `s.currentTime` directly — shows up
 * as a change count equal to the frame count.
 */
import type { Caption, Track } from "@/types";
import { activeCaptionIndex, activeWordIndex } from "@/lib/captions/active";
import { clipsAt, createDefaultTracks, findTrack } from "@/lib/timeline/tracks";

const FPS = 60;
const DURATION = 30;
const FRAMES = FPS * DURATION;

/** ~3 words a second, 5 words a caption — a normal talking-head transcript. */
function buildCaptions(): Caption[] {
  const captions: Caption[] = [];
  let t = 0;
  let index = 0;
  while (t < DURATION) {
    const words = [];
    const start = t;
    for (let w = 0; w < 5; w++) {
      words.push({
        word: `word${index++}`,
        startTime: t,
        endTime: t + 0.33,
      });
      t += 0.33;
    }
    captions.push({
      id: `cap${captions.length}`,
      startTime: start,
      endTime: t,
      text: words.map((w) => w.word).join(" "),
      words,
    });
  }
  return captions;
}

/** A text overlay every 4s and a sticker every 7s, as a montage would place. */
function buildTracks(): Track[] {
  const tracks = createDefaultTracks();
  const text = findTrack(tracks, "text");
  if (text) {
    for (let start = 0; start < DURATION; start += 4) {
      text.clips.push({
        id: `text${start}`,
        startTime: start,
        endTime: start + 1.8,
        text: `Overlay ${start}`,
      } as Track["clips"][number]);
    }
  }
  return tracks;
}

/** Count how many times `select` returns a different value across the sweep. */
function countChanges<T>(select: (time: number) => T, equal?: (a: T, b: T) => boolean): number {
  const same = equal ?? ((a: T, b: T) => Object.is(a, b));
  let changes = 0;
  let previous = select(0);
  for (let frame = 1; frame <= FRAMES; frame++) {
    const value = select((frame / FPS) * 1.0);
    if (!same(previous, value)) {
      changes++;
      previous = value;
    }
  }
  return changes;
}

const shallowEqual = <T,>(a: T[], b: T[]) =>
  a.length === b.length && a.every((item, i) => Object.is(item, b[i]));

function main() {
  const captions = buildCaptions();
  const tracks = buildTracks();
  const textTrack = findTrack(tracks, "text");
  if (!textTrack) throw new Error("expected a text track");

  console.log(
    `Sweeping ${FRAMES} frames (${DURATION}s @ ${FPS}fps) over ` +
      `${captions.length} captions and ${textTrack.clips.length} text overlays\n`
  );

  const checks: Array<{ name: string; changes: number; budget: number }> = [];

  // CaptionOverlay / CaptionsPanel / CutPanel: which caption is on screen.
  checks.push({
    name: "active caption index",
    changes: countChanges((t) => activeCaptionIndex(captions, t)),
    // Once per caption boundary, at most.
    budget: captions.length * 2 + 4,
  });

  // CaptionOverlay's karaoke highlight — the fastest-changing subscriber, and
  // still an order of magnitude below the frame rate.
  checks.push({
    name: "active word index",
    changes: countChanges((t) => {
      const index = activeCaptionIndex(captions, t);
      return index === -1 ? -1 : activeWordIndex(captions[index], t);
    }),
    budget: captions.length * 5 + 10,
  });

  // OverlayLayers: the visible clip list, compared shallowly.
  checks.push({
    name: "visible text overlay clips",
    changes: countChanges(
      (t) => clipsAt(textTrack, t),
      shallowEqual
    ),
    budget: textTrack.clips.length * 2 + 4,
  });

  // The control: subscribing to the raw playhead, which is what the components
  // used to do. This one SHOULD equal the frame count — it is here so the
  // numbers above have something to be compared against.
  const raw = countChanges((t) => t);

  let failed = false;
  for (const { name, changes, budget } of checks) {
    const perSecond = (changes / DURATION).toFixed(1);
    const saving = (100 * (1 - changes / raw)).toFixed(1);
    const ok = changes <= budget;
    if (!ok) failed = true;
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${name.padEnd(28)} ${String(changes).padStart(4)} renders ` +
        `(${perSecond}/s, ${saving}% fewer than raw currentTime, budget ${budget})`
    );
  }
  console.log(`\n  raw currentTime subscription would be ${raw} renders (${FPS}/s)`);

  if (failed) throw new Error("a playback selector re-renders more often than its budget");
  console.log("\nPLAYBACK RENDER CHECKS PASSED ✅");
}

main();
