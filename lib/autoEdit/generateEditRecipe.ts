import { nanoid } from "nanoid";
import type {
  AudioInstruction,
  BrollSuggestion,
  Caption,
  CaptionInstruction,
  CutInstruction,
  EditRecipe,
  EditStyle,
  HighlightMoment,
  OverlayInstruction,
  TimeRange,
  TimelineSignals,
  ZoomInstruction,
} from "@/types";
import { buildTimeRemap, invertRanges, mergeRanges, round3 } from "@/lib/timeline/tracks";
import { cleanCaptionText, findEmphasisWordIndexes } from "@/lib/captions/clean";
import type { Transcript } from "./analyzeTranscript";
import { detectSilence, type SilenceAggressiveness } from "./detectSilence";
import { fillerCutRanges, detectRepeatedPhrases } from "./detectFillerWords";
import { detectHooks } from "./detectHooks";
import { detectDeadSpace, detectHighlights } from "./detectHighlights";
import { findBestWindow } from "./scoreMoments";
import { snapToBeat } from "./signals";

/**
 * The auto-edit brain: analyses → one EditRecipe describing a complete edit
 * (cuts, hook, zooms, overlays, suggestions). Two families of evidence feed
 * it — the transcript (speech) and the analysis signals (motion, audio
 * energy, scene changes, beats). Either alone is enough: talky videos get a
 * speech-driven edit, sports/no-speech footage gets a signal-driven one, and
 * most real phone footage gets both. Applying the recipe produces real
 * timeline edits (see applyEditRecipeToTimeline.ts).
 */

export interface EditStyleConfig {
  silence: SilenceAggressiveness | null;
  cutFillers: boolean;
  cutRepeats: boolean;
  /** Min seconds of "nothing happening" (low energy+motion) to cut; null = off. */
  deadSpaceMin: number | null;
  /** Seconds between forced pattern interrupts (0 = off). */
  interruptEvery: number;
  zoomScale: number;
  /** Zoom sentences scoring at least this hook score. */
  emphasisZoomThreshold: number;
  /** Zoom signal-highlights scoring at least this (lower = more zooms). */
  highlightZoomThreshold: number;
  moveHookToFront: boolean;
  hookTextOverlay: boolean;
  ctaText: string | null;
}

export const EDIT_STYLE_CONFIGS: Record<EditStyle, EditStyleConfig> = {
  viral:       { silence: "aggressive", cutFillers: true,  cutRepeats: true,  deadSpaceMin: 1.0, interruptEvery: 4,  zoomScale: 1.18, emphasisZoomThreshold: 4,   highlightZoomThreshold: 5,   moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Follow for more 🔥" },
  clean:       { silence: "medium",     cutFillers: true,  cutRepeats: true,  deadSpaceMin: 1.6, interruptEvery: 0,  zoomScale: 1.10, emphasisZoomThreshold: 6,   highlightZoomThreshold: 6.5, moveHookToFront: false, hookTextOverlay: false, ctaText: null },
  podcast:     { silence: "light",      cutFillers: false, cutRepeats: true,  deadSpaceMin: null, interruptEvery: 7, zoomScale: 1.08, emphasisZoomThreshold: 5,   highlightZoomThreshold: 7,   moveHookToFront: false, hookTextOverlay: false, ctaText: null },
  sports:      { silence: "aggressive", cutFillers: true,  cutRepeats: true,  deadSpaceMin: 0.9, interruptEvery: 5,  zoomScale: 1.22, emphasisZoomThreshold: 3.5, highlightZoomThreshold: 4,   moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Follow for more ⚽" },
  storytime:   { silence: "medium",     cutFillers: true,  cutRepeats: true,  deadSpaceMin: 1.4, interruptEvery: 5,  zoomScale: 1.14, emphasisZoomThreshold: 4.5, highlightZoomThreshold: 5.5, moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Part 2? 👀" },
  educational: { silence: "medium",     cutFillers: true,  cutRepeats: true,  deadSpaceMin: 1.6, interruptEvery: 6,  zoomScale: 1.10, emphasisZoomThreshold: 5,   highlightZoomThreshold: 6,   moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Save this 📌" },
  meme:        { silence: "aggressive", cutFillers: true,  cutRepeats: false, deadSpaceMin: 0.9, interruptEvery: 3,  zoomScale: 1.25, emphasisZoomThreshold: 3,   highlightZoomThreshold: 4.5, moveHookToFront: false, hookTextOverlay: false, ctaText: null },
};

export interface GenerateRecipeInput {
  projectId: string;
  transcript: Transcript;
  captions: Caption[];
  /** Normalized timeline amplitude peaks (legacy fallback when no signals). */
  peaks?: number[] | null;
  /** Stitched motion/energy/beat signals from local media analysis. */
  signals?: TimelineSignals | null;
  duration: number;
  style: EditStyle;
  /** Optional "best N seconds" target. */
  targetDuration?: number;
  /** Variation seed — bump it to "regenerate" a different take of the edit. */
  seed?: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "i", "you",
  "he", "she", "it", "we", "they", "to", "of", "in", "on", "at", "for", "with",
  "that", "this", "these", "those", "my", "your", "his", "her", "its", "our",
  "just", "so", "very", "really", "not", "no", "yes", "do", "does", "did",
  "have", "has", "had", "be", "been", "being", "get", "got", "go", "going",
  "en", "ett", "och", "eller", "men", "är", "var", "jag", "du", "han", "hon",
  "det", "vi", "de", "att", "på", "i", "för", "med", "som", "har", "hade", "min", "din",
]);

/** Kept fragments shorter than this read as glitches — merged into the cut. */
const MIN_KEPT_FRAGMENT = 0.6;

export function generateEditRecipe(input: GenerateRecipeInput): EditRecipe {
  const { transcript, captions, peaks, signals, duration, style } = input;
  const config = EDIT_STYLE_CONFIGS[style];
  const rand = mulberry32((input.seed ?? 0) + 1);
  const hasSpeech = transcript.words.length >= 3;

  /* 1 — highlights from real signals (goals, celebrations, laughs, key lines) */
  const highlights = detectHighlights({ signals: signals ?? null, transcript, duration });

  /* 2 — cut list: silence + fillers + repeats (speech) and dead space (signals) */
  const cuts: CutInstruction[] = [];
  if (config.silence && hasSpeech) {
    for (const r of detectSilence({ transcript, peaks, duration }, config.silence)) {
      cuts.push({ ...r, reason: "silence" });
    }
  }
  if (config.cutFillers && hasSpeech) {
    for (const r of fillerCutRanges(transcript)) cuts.push({ ...r, reason: "filler" });
  }
  if (config.cutRepeats && hasSpeech) {
    for (const r of detectRepeatedPhrases(transcript)) {
      cuts.push({ start: r.start, end: r.end, reason: "repetition" });
    }
  }
  let deadCutCount = 0;
  if (config.deadSpaceMin !== null && signals) {
    for (const r of detectDeadSpace(signals, { minDuration: config.deadSpaceMin })) {
      // Never cut a highlight's window, and when there's speech, silence
      // detection already owns the quiet-audio case — only add dead ranges
      // that overlap no speech at all.
      if (highlights.some((h) => r.start < h.end && r.end > h.start)) continue;
      if (hasSpeech && transcript.words.some((w) => w.startTime < r.end && w.endTime > r.start)) continue;
      cuts.push({ ...r, reason: "pacing" });
      deadCutCount++;
    }
  }

  /* 3 — hooks (speech) */
  const hooks = hasSpeech ? detectHooks(transcript, 5) : [];
  // Variation: an alternate take may open with the runner-up hook.
  const hookPick = input.seed && hooks.length > 1 && rand() > 0.5 ? 1 : 0;
  const topHook = hooks[hookPick] ?? hooks[0];

  /* 4 — best-moment window (when a target duration is requested) */
  let window: TimeRange = { start: 0, end: duration };
  if (input.targetDuration && input.targetDuration < duration - 2) {
    const best = findBestWindow({ transcript, peaks, signals, duration }, input.targetDuration);
    if (best) window = best;
  }

  /* 5 — assemble kept ranges: window minus cuts, with sanity guards */
  let keptRanges = assembleKeptRanges(window, cuts, duration, () => {
    // Over-cutting guard fallback: drop pacing cuts, keep speech-driven ones.
    return cuts.filter((c) => c.reason !== "pacing");
  });

  /* 6 — cold open: move the strongest hook (speech) or highlight (signal)
          to the front so the first 1–2 seconds stop the scroll. */
  let hookMoved = false;
  let openedWithHighlight: HighlightMoment | null = null;
  if (config.moveHookToFront) {
    if (topHook && topHook.startTime > window.start + 5) {
      const hookRange: TimeRange = {
        start: Math.max(window.start, topHook.startTime - 0.12),
        end: Math.min(window.end, topHook.endTime + 0.15),
      };
      const rearranged = moveRangeToFront(keptRanges, hookRange);
      if (rearranged) {
        keptRanges = rearranged;
        hookMoved = true;
      }
    } else if (!topHook) {
      // No speech hook — open on the best signal highlight instead.
      const best = [...highlights]
        .filter((h) => h.kind !== "speech" && h.time > window.start + 5 && h.time < window.end)
        .sort((a, b) => b.score - a.score)[0];
      if (best) {
        const range: TimeRange = {
          start: Math.max(window.start, best.start),
          end: Math.min(window.end, best.end),
        };
        const rearranged = moveRangeToFront(keptRanges, range);
        if (rearranged) {
          keptRanges = rearranged;
          openedWithHighlight = best;
        }
      }
    }
  }

  /* 7 — beat-aware cutting: nudge cut seams onto the beat grid */
  let beatSnapped = 0;
  if (signals && signals.beats.length > 4) {
    const snapped = snapRangesToBeats(keptRanges, signals.beats);
    beatSnapped = snapped.count;
    keptRanges = snapped.ranges;
  }

  const remap = buildTimeRemap(keptRanges);
  const newDuration = remap.totalDuration;
  /** Beat grid carried into the FINAL (post-cut) timeline. */
  const finalBeats =
    signals && signals.beats.length > 4
      ? dedupe(signals.beats.map((b) => remap.collapse(b)))
      : [];

  /* 8 — zooms: highlights first (intentional), then sentence emphasis,
          then pattern interrupts only where nothing else is happening. */
  const zooms: ZoomInstruction[] = [];

  for (const h of highlights) {
    if (h.kind === "speech" || h.score < config.highlightZoomThreshold) continue;
    const start = remap.point(h.time - 0.15) ?? remap.point(h.time);
    if (start === null) continue;
    const jitter = (rand() - 0.5) * 0.04;
    zooms.push({
      start: round3(Math.max(0, start)),
      end: round3(Math.min(newDuration, start + 2.0)),
      scale: clampScale(config.zoomScale + 0.04 + jitter),
      reason: h.kind === "reaction" ? "reaction" : "action",
      // Reactions are faces — anchor a touch higher than raw action.
      anchorY: h.kind === "reaction" ? 0.38 : 0.45,
    });
  }

  if (hasSpeech) {
    const strongSentences = detectHooks(transcript, transcript.sentences.length).filter(
      (h) => h.score >= config.emphasisZoomThreshold
    );
    for (const s of strongSentences) {
      const start = remap.point(s.startTime + 0.05);
      if (start === null) continue;
      zooms.push({
        start,
        end: round3(Math.min(newDuration, start + Math.min(2.2, s.endTime - s.startTime))),
        scale: config.zoomScale,
        reason: "emphasis",
        anchorY: 0.4, // speaking = face framing
      });
    }
  }

  if (config.interruptEvery > 0) {
    let lastChange = 0;
    let zoomIn = true;
    const phase = input.seed ? rand() * config.interruptEvery * 0.5 : 0;
    for (let t = config.interruptEvery + phase; t < newDuration - 1.5; t += config.interruptEvery) {
      const nearby = zooms.some((z) => t >= z.start - 1.5 && t <= z.end + 1.5);
      if (nearby || t - lastChange < config.interruptEvery) continue;
      // Land the punch on a beat when there's music.
      const at = finalBeats.length > 0 ? snapToBeat(t, finalBeats, 0.3) : t;
      zooms.push({
        start: round3(Math.max(0, Math.min(newDuration - 0.5, at))),
        end: round3(Math.min(newDuration, at + 1.8)),
        scale: zoomIn ? clampScale(1 + (config.zoomScale - 1) * 0.7) : config.zoomScale,
        reason: "pattern-interrupt",
      });
      zoomIn = !zoomIn;
      lastChange = t;
    }
  }
  // Keep zooms intentional, not constant: real moments (action/reaction/
  // emphasis) always beat filler interrupts, consecutive zooms need breathing
  // room, and total density is capped so the edit never feels like a strobe.
  const isFiller = (z: ZoomInstruction) => z.reason === "pattern-interrupt";
  zooms.sort((a, b) => a.start - b.start || Number(isFiller(a)) - Number(isFiller(b)));
  const maxZooms = Math.max(2, Math.floor(newDuration / 4.5));
  const finalZooms: ZoomInstruction[] = [];
  for (const z of zooms) {
    const prev = finalZooms[finalZooms.length - 1];
    if (prev && z.start < prev.end + (isFiller(z) || isFiller(prev) ? 2.0 : 0.9)) continue;
    finalZooms.push(z);
  }
  if (finalZooms.length > maxZooms) {
    // Shed filler zooms first, then the weakest tail.
    const keep = finalZooms.filter((z) => !isFiller(z)).slice(0, maxZooms);
    const fillers = finalZooms.filter(isFiller).slice(0, Math.max(0, maxZooms - keep.length));
    finalZooms.length = 0;
    finalZooms.push(...[...keep, ...fillers].sort((a, b) => a.start - b.start));
  }

  /* 9 — hook overlay + CTA */
  const overlays: OverlayInstruction[] = [];
  if (config.hookTextOverlay && topHook && newDuration > 6) {
    overlays.push({
      kind: "text",
      text: shorten(topHook.text, 9),
      start: 0,
      end: round3(Math.min(3, newDuration / 4)),
      y: -520,
      role: "hook",
    });
  }
  if (config.ctaText && newDuration > 12) {
    overlays.push({
      kind: "text",
      text: config.ctaText,
      start: round3(newDuration - 2.4),
      end: round3(newDuration),
      y: 480,
      role: "cta",
    });
  }

  /* 10 — b-roll suggestions at concrete, spaced-out moments */
  const brollSuggestions: BrollSuggestion[] = [];
  let lastSuggestion = -10;
  for (const s of transcript.sentences) {
    const mapped = remap.point(s.startTime);
    if (mapped === null || mapped - lastSuggestion < 9) continue;
    const keyword = s.words
      .map((w) => w.norm)
      .filter((n) => n.length >= 4 && !STOPWORDS.has(n))
      .sort((a, b) => b.length - a.length)[0];
    if (!keyword) continue;
    brollSuggestions.push({
      time: mapped,
      keyword,
      reason: `Speaker mentions "${keyword}" — cover it with matching footage.`,
    });
    lastSuggestion = mapped;
  }

  /* 11 — caption cleanup + emphasis instructions */
  const captionInstructions: CaptionInstruction[] = captions.map((c) => ({
    captionId: c.id,
    cleanText: cleanCaptionText(c.text),
    emphasisWordIndexes: findEmphasisWordIndexes(c),
  }));

  const audioInstructions: AudioInstruction[] = [
    {
      kind: "add-music",
      value: 0.12,
      note: "Add a music track at ~12% volume — trending or lo-fi keeps retention up.",
    },
    { kind: "duck-under-voice", note: "Keep music under speech; raise it only in silent gaps." },
  ];

  /* 12 — remap highlights into final time for the UI */
  const finalHighlights: HighlightMoment[] = [];
  for (const h of highlights) {
    const t = remap.point(h.time);
    if (t === null) continue;
    finalHighlights.push({
      ...h,
      time: t,
      start: round3(Math.max(0, remap.collapse(h.start))),
      end: round3(Math.min(newDuration, remap.collapse(h.end))),
    });
  }

  /* summary */
  const cutSeconds = Math.max(0, (window.end - window.start) - newDuration);
  const summaryParts: string[] = [];
  if (cuts.length > 0) {
    const what = hasSpeech
      ? deadCutCount > 0 ? "dead air, fillers & dead space" : "dead air & fillers"
      : "dead space";
    summaryParts.push(`Removed ${cutSeconds.toFixed(1)}s of ${what} (${cuts.length} cuts)`);
  }
  if (finalHighlights.length > 0) {
    summaryParts.push(`${finalHighlights.length} highlights detected`);
  }
  summaryParts.push(`${finalZooms.length} punch-zooms for pacing`);
  if (hookMoved && topHook) summaryParts.push(`opened with the hook “${shorten(topHook.text, 8)}”`);
  if (openedWithHighlight) summaryParts.push(`opened on the biggest moment (${openedWithHighlight.time.toFixed(0)}s)`);
  if (beatSnapped > 0) summaryParts.push(`${beatSnapped} cuts snapped to the beat`);
  if (input.targetDuration) summaryParts.push(`kept the best ${Math.round(newDuration)}s`);

  return {
    id: nanoid(10),
    projectId: input.projectId,
    style,
    keptRanges,
    cuts,
    captions: captionInstructions,
    zooms: finalZooms,
    overlays,
    brollSuggestions,
    audioInstructions,
    hooks,
    highlights: finalHighlights,
    exportPreset: "tiktok",
    reasoningSummary: summaryParts.join(" · ") + ".",
  };
}

/**
 * Window minus cuts → kept ranges, with two guards: kept fragments shorter
 * than MIN_KEPT_FRAGMENT are absorbed into the cut (no single-frame stutter
 * clips), and if the cuts would erase most of the video, retry with the
 * fallback cut list before giving up and keeping the whole window.
 */
function assembleKeptRanges(
  window: TimeRange,
  cuts: CutInstruction[],
  duration: number,
  fallbackCuts: () => CutInstruction[]
): TimeRange[] {
  const build = (list: CutInstruction[]): TimeRange[] => {
    const removed = mergeRanges([
      { start: 0, end: window.start },
      { start: window.end, end: duration },
      ...list,
    ]);
    return invertRanges(removed, duration).filter((r) => r.end - r.start >= MIN_KEPT_FRAGMENT);
  };

  const windowDur = Math.max(0.1, window.end - window.start);
  let kept = build(cuts);
  let keptDur = kept.reduce((s, r) => s + (r.end - r.start), 0);
  if (keptDur < windowDur * 0.3) {
    kept = build(fallbackCuts());
    keptDur = kept.reduce((s, r) => s + (r.end - r.start), 0);
  }
  if (kept.length === 0 || keptDur < 1) {
    kept = [{ start: window.start, end: window.end }];
  }
  return kept;
}

/** Nudge kept-range seams onto beats (original-time grid), preserving order. */
function snapRangesToBeats(
  ranges: TimeRange[],
  beats: number[]
): { ranges: TimeRange[]; count: number } {
  let count = 0;
  const out = ranges.map((r) => {
    const start = snapToBeat(r.start, beats, 0.18);
    const end = snapToBeat(r.end, beats, 0.18);
    if (start !== r.start) count++;
    if (end !== r.end) count++;
    return end - start > MIN_KEPT_FRAGMENT ? { start, end } : r;
  });
  return { ranges: out, count };
}

/** Reorder kept ranges so the pieces inside `front` come first. */
function moveRangeToFront(kept: TimeRange[], front: TimeRange): TimeRange[] | null {
  const inFront: TimeRange[] = [];
  const rest: TimeRange[] = [];
  for (const r of kept) {
    const iStart = Math.max(r.start, front.start);
    const iEnd = Math.min(r.end, front.end);
    if (iEnd - iStart > 0.05) {
      inFront.push({ start: iStart, end: iEnd });
      if (r.start < iStart - 0.01) rest.push({ start: r.start, end: iStart });
      if (r.end > iEnd + 0.01) rest.push({ start: iEnd, end: r.end });
    } else {
      rest.push(r);
    }
  }
  if (inFront.length === 0) return null;
  return [...inFront, ...rest];
}

function clampScale(scale: number): number {
  return Math.round(Math.min(1.35, Math.max(1.05, scale)) * 1000) / 1000;
}

function dedupe(times: number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] > 0.08) out.push(t);
  }
  return out;
}

function shorten(text: string, maxWords: number): string {
  const words = text.replace(/[.!?]+$/, "").split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}

/** Tiny deterministic PRNG so "regenerate" gives stable, reproducible takes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
