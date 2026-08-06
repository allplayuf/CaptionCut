/**
 * Caption animation preview/export parity (dev tool).
 * Run: npx tsx scripts/verify-caption-animation.ts
 *
 * The preview drives the entrance by evaluating `captionAnimationAt` against
 * the playhead; the exporter turns the same keyframes into libass `\t`
 * transforms. Those are two different renderers, so this parses the generated
 * ASS back, replays libass's linear interpolation over each dialogue event, and
 * checks the resulting scale/alpha curve against what the preview would draw at
 * the same instant.
 *
 * A drift here means captions animate one way in the editor and another way in
 * the exported file — the single contract this app cannot break.
 */
import type { Caption, CaptionStyle } from "@/types";
import { buildAss } from "@/lib/export/ass";
import { DEFAULT_STYLE } from "@/lib/captions/presets";
import {
  CAPTION_ANIMATIONS,
  captionAnimationAt,
  captionWordScale,
  type CaptionAnimation,
} from "@/lib/captions/animation";

/** Tolerance in scale percent / alpha steps — rounding in the tag text only. */
const SCALE_TOLERANCE = 0.6;
const ALPHA_TOLERANCE = 2;

interface Event {
  start: number;
  end: number;
  text: string;
}

function parseEvents(ass: string): Event[] {
  return ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue: 0,"))
    .map((line) => {
      const parts = line.slice("Dialogue: ".length).split(",");
      return {
        start: parseAssTime(parts[1]),
        end: parseAssTime(parts[2]),
        text: parts.slice(9).join(","),
      };
    });
}

function parseAssTime(value: string): number {
  const [h, m, s] = value.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Replay libass on one event's leading override block: take the initial tag
 * value, then apply each `\t(from,to,...)` as a linear ramp, and read the value
 * at `ms` into the event.
 */
function replayTag(text: string, tag: "fscx" | "alpha", ms: number): number | null {
  const block = text.match(/^\{([^}]*)\}/);
  if (!block) return null;
  const body = block[1];

  const readValue = (source: string): number | null => {
    if (tag === "fscx") {
      const m = source.match(/\\fscx([\d.]+)/);
      return m ? Number(m[1]) : null;
    }
    const m = source.match(/\\alpha&H([0-9A-F]{2})&/);
    return m ? parseInt(m[1], 16) : null;
  };

  // Initial value = the tag before the first \t.
  const head = body.split("\\t(")[0];
  let current = readValue(head);
  if (current === null) return null;

  const transforms = [...body.matchAll(/\\t\((\d+),(\d+),([^)]*)\)/g)];
  for (const [, fromRaw, toRaw, tags] of transforms) {
    const from = Number(fromRaw);
    const to = Number(toRaw);
    const target = readValue(tags);
    if (target === null) continue;
    if (ms >= to) {
      current = target;
    } else if (ms > from) {
      const k = (ms - from) / Math.max(1, to - from);
      current = current + (target - current) * k;
      return current;
    } else {
      return current;
    }
  }
  return current;
}

function main() {
  const caption: Caption = {
    id: "c1",
    startTime: 2,
    endTime: 4,
    text: "goal of the season",
    words: [
      { word: "goal", startTime: 2.0, endTime: 2.4 },
      { word: "of", startTime: 2.4, endTime: 2.7 },
      { word: "the", startTime: 2.7, endTime: 3.1 },
      { word: "season", startTime: 3.1, endTime: 4.0 },
    ],
  };

  let checked = 0;
  let failures = 0;

  for (const { id } of CAPTION_ANIMATIONS) {
    const animation = id as CaptionAnimation;
    // Exercise both caption-level entrance and the per-word beat.
    for (const highlight of [null, "#FFD400"] as Array<string | null>) {
      const style: CaptionStyle = {
        ...DEFAULT_STYLE,
        animation,
        highlightColor: highlight,
      };
      const ass = buildAss([caption], style);
      const events = parseEvents(ass);
      if (events.length === 0) throw new Error(`${animation}: no dialogue events emitted`);

      for (const event of events) {
        // Sample across the event, including its very start.
        for (let frac = 0; frac <= 1.0001; frac += 0.1) {
          const time = event.start + (event.end - event.start) * frac;
          if (time >= event.end && frac > 0) continue;
          const ms = (time - event.start) * 1000;

          const expected = captionAnimationAt(animation, time - caption.startTime);

          const scale = replayTag(event.text, "fscx", ms);
          if (scale !== null) {
            checked++;
            const want = expected.scale * 100;
            if (Math.abs(scale - want) > SCALE_TOLERANCE) {
              failures++;
              console.log(
                `  FAIL ${animation}/hl:${highlight ? "y" : "n"} scale at ${time.toFixed(2)}s — ` +
                  `ass ${scale.toFixed(2)} vs preview ${want.toFixed(2)}`
              );
            }
          }

          const alpha = replayTag(event.text, "alpha", ms);
          if (alpha !== null) {
            checked++;
            const want = (1 - expected.opacity) * 255;
            if (Math.abs(alpha - want) > ALPHA_TOLERANCE) {
              failures++;
              console.log(
                `  FAIL ${animation}/hl:${highlight ? "y" : "n"} alpha at ${time.toFixed(2)}s — ` +
                  `ass ${alpha.toFixed(1)} vs preview ${want.toFixed(1)}`
              );
            }
          }
        }
      }

      // The per-word beat must actually reach the animation's word scale. Once
      // the entrance has settled the active word sits at exactly wordScale.
      const wordScale = captionWordScale(animation);
      if (wordScale > 1) {
        const settled = events[events.length - 1].text;
        const peak = wordScale * 100;
        const scales = [...settled.matchAll(/\\fscx([\d.]+)/g)].map((m) => Number(m[1]));
        const reached = scales.some((value) => Math.abs(value - peak) <= SCALE_TOLERANCE);
        if (!reached) {
          failures++;
          console.log(
            `  FAIL ${animation}: no word reaches the ${peak.toFixed(1)}% beat ` +
              `(saw ${scales.join(", ") || "none"})`
          );
        }
      }

      console.log(
        `  OK   ${animation.padEnd(5)} highlight:${highlight ? "on " : "off"} — ` +
          `${events.length} events`
      );
    }
  }

  console.log(`\n${checked} sampled values compared`);
  if (failures > 0) throw new Error(`${failures} preview/export mismatches`);
  console.log("CAPTION ANIMATION PARITY PASSED ✅");
}

main();
