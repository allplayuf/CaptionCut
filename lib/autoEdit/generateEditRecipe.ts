import { nanoid } from "nanoid";
import type {
  AudioInstruction,
  BrollSuggestion,
  Caption,
  CaptionInstruction,
  CutInstruction,
  EditRecipe,
  EditStyle,
  OverlayInstruction,
  TimeRange,
  ZoomInstruction,
} from "@/types";
import { buildTimeRemap, invertRanges, mergeRanges, round3 } from "@/lib/timeline/tracks";
import { cleanCaptionText, findEmphasisWordIndexes } from "@/lib/captions/clean";
import type { Transcript } from "./analyzeTranscript";
import { detectSilence, type SilenceAggressiveness } from "./detectSilence";
import { fillerCutRanges, detectRepeatedPhrases } from "./detectFillerWords";
import { detectHooks } from "./detectHooks";
import { findBestWindow } from "./scoreMoments";

/**
 * The auto-edit brain: analyses → one EditRecipe describing a complete edit
 * (cuts, hook, zooms, overlays, suggestions). Everything is derived from real
 * transcript timings and audio amplitude; applying the recipe produces real
 * timeline edits (see applyEditRecipeToTimeline.ts).
 */

export interface EditStyleConfig {
  silence: SilenceAggressiveness | null;
  cutFillers: boolean;
  cutRepeats: boolean;
  /** Seconds between forced pattern interrupts (0 = off). */
  interruptEvery: number;
  zoomScale: number;
  /** Zoom sentences scoring at least this hook score. */
  emphasisZoomThreshold: number;
  moveHookToFront: boolean;
  hookTextOverlay: boolean;
  ctaText: string | null;
}

export const EDIT_STYLE_CONFIGS: Record<EditStyle, EditStyleConfig> = {
  viral:       { silence: "aggressive", cutFillers: true,  cutRepeats: true,  interruptEvery: 4,  zoomScale: 1.18, emphasisZoomThreshold: 4,  moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Follow for more 🔥" },
  clean:       { silence: "medium",     cutFillers: true,  cutRepeats: true,  interruptEvery: 0,  zoomScale: 1.10, emphasisZoomThreshold: 6,  moveHookToFront: false, hookTextOverlay: false, ctaText: null },
  podcast:     { silence: "light",      cutFillers: false, cutRepeats: true,  interruptEvery: 7,  zoomScale: 1.08, emphasisZoomThreshold: 5,  moveHookToFront: true,  hookTextOverlay: true,  ctaText: null },
  sports:      { silence: "aggressive", cutFillers: true,  cutRepeats: true,  interruptEvery: 3,  zoomScale: 1.22, emphasisZoomThreshold: 3.5, moveHookToFront: false, hookTextOverlay: true,  ctaText: "Follow for more ⚽" },
  storytime:   { silence: "medium",     cutFillers: true,  cutRepeats: true,  interruptEvery: 5,  zoomScale: 1.14, emphasisZoomThreshold: 4.5, moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Part 2? 👀" },
  educational: { silence: "medium",     cutFillers: true,  cutRepeats: true,  interruptEvery: 6,  zoomScale: 1.10, emphasisZoomThreshold: 5,  moveHookToFront: true,  hookTextOverlay: true,  ctaText: "Save this 📌" },
  meme:        { silence: "aggressive", cutFillers: true,  cutRepeats: false, interruptEvery: 3,  zoomScale: 1.25, emphasisZoomThreshold: 3,  moveHookToFront: false, hookTextOverlay: false, ctaText: null },
};

export interface GenerateRecipeInput {
  projectId: string;
  transcript: Transcript;
  captions: Caption[];
  /** Normalized timeline amplitude peaks, if the audio could be decoded. */
  peaks?: number[] | null;
  duration: number;
  style: EditStyle;
  /** Optional "best N seconds" target. */
  targetDuration?: number;
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

export function generateEditRecipe(input: GenerateRecipeInput): EditRecipe {
  const { transcript, captions, peaks, duration, style } = input;
  const config = EDIT_STYLE_CONFIGS[style];

  /* 1 + 2 + 3 — analyze transcript, silence, fillers → cut list */
  const cuts: CutInstruction[] = [];
  if (config.silence) {
    for (const r of detectSilence({ transcript, peaks, duration }, config.silence)) {
      cuts.push({ ...r, reason: "silence" });
    }
  }
  if (config.cutFillers) {
    for (const r of fillerCutRanges(transcript)) cuts.push({ ...r, reason: "filler" });
  }
  if (config.cutRepeats) {
    for (const r of detectRepeatedPhrases(transcript)) {
      cuts.push({ start: r.start, end: r.end, reason: "repetition" });
    }
  }

  /* 4 — hooks */
  const hooks = detectHooks(transcript, 5);
  const topHook = hooks[0];

  /* 5/6 — best-moment window (when a target duration is requested) */
  let window: TimeRange = { start: 0, end: duration };
  if (input.targetDuration && input.targetDuration < duration - 2) {
    const best = findBestWindow({ transcript, peaks, duration }, input.targetDuration);
    if (best) window = best;
  }

  /* Assemble kept ranges: window minus cuts, hook moved to the front. */
  const removed = mergeRanges([
    { start: 0, end: window.start },
    { start: window.end, end: duration },
    ...cuts,
  ]);
  let keptRanges = invertRanges(removed, duration);

  let hookMoved = false;
  if (config.moveHookToFront && topHook && topHook.startTime > window.start + 5) {
    const hookRange: TimeRange = {
      start: Math.max(window.start, topHook.startTime - 0.12),
      end: Math.min(window.end, topHook.endTime + 0.15),
    };
    const rearranged = moveRangeToFront(keptRanges, hookRange);
    if (rearranged) {
      keptRanges = rearranged;
      hookMoved = true;
    }
  }

  const remap = buildTimeRemap(keptRanges);
  const newDuration = remap.totalDuration;

  /* 9 + 10 — zooms: emphasis + pattern interrupts (in FINAL time) */
  const zooms: ZoomInstruction[] = [];
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
    });
  }
  if (config.interruptEvery > 0) {
    let lastChange = 0;
    let zoomIn = true;
    for (let t = config.interruptEvery; t < newDuration - 1.5; t += config.interruptEvery) {
      const nearby = zooms.some((z) => t >= z.start - 1.5 && t <= z.end + 1.5);
      if (nearby || t - lastChange < config.interruptEvery) continue;
      zooms.push({
        start: round3(t),
        end: round3(Math.min(newDuration, t + 1.8)),
        scale: zoomIn ? 1 + (config.zoomScale - 1) * 0.7 : config.zoomScale,
        reason: "pattern-interrupt",
      });
      zoomIn = !zoomIn;
      lastChange = t;
    }
  }
  zooms.sort((a, b) => a.start - b.start);
  // Drop overlaps (earlier zoom wins).
  const finalZooms: ZoomInstruction[] = [];
  for (const z of zooms) {
    const prev = finalZooms[finalZooms.length - 1];
    if (prev && z.start < prev.end + 0.4) continue;
    finalZooms.push(z);
  }

  /* 12 + 13 + 14 — hook overlay + CTA */
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

  /* 11 — b-roll suggestions at concrete, spaced-out moments */
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

  /* 8 — caption cleanup + emphasis instructions */
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

  const cutSeconds = duration - (window.end - window.start) === 0
    ? round3(duration - newDuration)
    : round3(window.end - window.start - newDuration);
  const summaryParts = [
    `Removed ${Math.max(0, cutSeconds).toFixed(1)}s of dead air/fillers (${cuts.length} cuts)`,
    `${finalZooms.length} punch-zooms for pacing`,
  ];
  if (hookMoved && topHook) summaryParts.push(`opened with the hook “${shorten(topHook.text, 8)}”`);
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
    exportPreset: "tiktok",
    reasoningSummary: summaryParts.join(" · ") + ".",
  };
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

function shorten(text: string, maxWords: number): string {
  const words = text.replace(/[.!?]+$/, "").split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}
