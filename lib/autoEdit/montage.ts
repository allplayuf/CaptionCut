import { nanoid } from "nanoid";
import type {
  Caption,
  Clip,
  EditRecipe,
  HighlightMoment,
  MediaAnalysis,
  MontageModifiers,
  MontageStyle,
  OverlayInstruction,
  TimeRange,
  TimelineSignals,
  ZoomInstruction,
} from "@/types";
import { round3 } from "@/lib/timeline/tracks";
import { clipDuration, clipSpeed } from "@/lib/video/timeline";
import type { Transcript } from "./analyzeTranscript";
import { detectHooks } from "./detectHooks";

/**
 * The football-montage engine. Unlike generateEditRecipe (which trims one
 * long take), this treats every main-track clip as a RAW CLIP from a match,
 * ranks the moments inside each one (goals, shots, celebrations, fast
 * movement, crowd reactions), drops dead time and repeated-looking clips, and
 * assembles the best 8–20 moments into a tight 12–30s vertical edit:
 *
 *   hook (biggest moment, cut tight) → action → reaction → action → ender.
 *
 * Everything is local math over the FFmpeg analysis signals — no API.
 */

export interface MontageConfig {
  name: string;
  description: string;
  /** Segment length bounds, seconds (on the final timeline). */
  minSeg: number;
  maxSeg: number;
  /** Max length of the opening segment — the first second must hit. */
  hookSeg: number;
  zoomScale: number;
  /** Fraction of selected moments that get a punch-in zoom. */
  zoomShare: number;
  /** Keep the original clip order (recap) instead of building a rhythm. */
  chronological: boolean;
  /** Allow a slow-mo ramp on the single biggest moment. */
  speedRamps: boolean;
  /** Subtle drift zoom on static segments so nothing feels frozen. */
  driftZooms: boolean;
  /** White flash pop on the cut into the biggest action moments (goals). */
  flashOnPeaks: boolean;
  /** Interleave the strongest spoken lines between action (needs transcript). */
  useSpeech: boolean;
  cta: string | null;
  /** Text-overlay phrase bank used when there is no transcript. */
  hookLines: string[];
  midLines: string[];
  /** Selection bias injected by regenerate modifiers (not set on presets). */
  favorKind?: "action" | "reaction";
}

export const MONTAGE_PRESETS: Record<MontageStyle, MontageConfig> = {
  hype: {
    name: "Hype",
    description: "Fast cuts, big zooms, opens on the biggest moment.",
    minSeg: 0.9, maxSeg: 2.4, hookSeg: 1.8,
    zoomScale: 1.22, zoomShare: 0.55,
    chronological: false, speedRamps: true, driftZooms: true, flashOnPeaks: true, useSpeech: false,
    cta: "Follow for more ⚽🔥",
    hookLines: ["You weren't ready for this one.", "Sound on for this one 🔊", "No brakes. No mercy. ⚽"],
    midLines: ["It got worse.", "And then this happened."],
  },
  "clean-recap": {
    name: "Clean Recap",
    description: "Chronological highlights, calm pacing, minimal effects.",
    minSeg: 1.6, maxSeg: 3.6, hookSeg: 2.6,
    zoomScale: 1.1, zoomShare: 0.25,
    chronological: true, speedRamps: false, driftZooms: false, flashOnPeaks: false, useSpeech: false,
    cta: null,
    hookLines: ["Matchday."],
    midLines: [],
  },
  street: {
    name: "Street Football",
    description: "Gritty, tight cuts, concrete-pitch energy.",
    minSeg: 0.8, maxSeg: 2.2, hookSeg: 1.6,
    zoomScale: 1.25, zoomShare: 0.5,
    chronological: false, speedRamps: true, driftZooms: true, flashOnPeaks: true, useSpeech: false,
    cta: "Pull up next time ⚽",
    hookLines: ["Pull up. Play. Repeat.", "Concrete pitch. Real football.", "No refs. No excuses."],
    midLines: ["Winner stays on.", "First to five."],
  },
  goals: {
    name: "Goals & Reactions",
    description: "Every goal, shot and save — with the celebration after it.",
    minSeg: 1.0, maxSeg: 2.6, hookSeg: 1.8,
    zoomScale: 1.24, zoomShare: 0.6,
    chronological: false, speedRamps: true, driftZooms: false, flashOnPeaks: true, useSpeech: false,
    cta: "Which one was the best? 👇",
    hookLines: ["Wait for the last one 🥶", "Goals only. No filler.", "Every finish from today ⚽"],
    midLines: ["It got better.", "Keeper had no chance."],
  },
  community: {
    name: "Community",
    description: "Friendly, people-first — faces, laughs, group energy.",
    minSeg: 1.4, maxSeg: 3.0, hookSeg: 2.2,
    zoomScale: 1.12, zoomShare: 0.35,
    chronological: false, speedRamps: false, driftZooms: true, flashOnPeaks: false, useSpeech: false,
    cta: "Come play with us ⚽",
    hookLines: ["Real game. Real people.", "Sunday league energy 💯", "Everyone plays. Everyone counts."],
    midLines: ["No group chat needed.", "This is why we show up."],
  },
  interview: {
    name: "Interview + Match",
    description: "The best spoken lines cut between the action.",
    minSeg: 1.2, maxSeg: 2.6, hookSeg: 2.0,
    zoomScale: 1.14, zoomShare: 0.35,
    chronological: false, speedRamps: false, driftZooms: true, flashOnPeaks: false, useSpeech: true,
    cta: "Follow for the full story",
    hookLines: [],
    midLines: [],
  },
  sponsor: {
    name: "Sponsor Recap",
    description: "Clean, professional recap that keeps partners visible without feeling like an ad.",
    minSeg: 1.8, maxSeg: 3.8, hookSeg: 2.8,
    zoomScale: 1.08, zoomShare: 0.15,
    chronological: true, speedRamps: false, driftZooms: true, flashOnPeaks: false, useSpeech: false,
    cta: "See you at the next one 🤝",
    hookLines: ["What a day of football.", "Another matchday in the books."],
    midLines: [],
  },
};

export interface GenerateMontageInput {
  projectId: string;
  preset: MontageStyle;
  /** Target output length, seconds (12–30 is the sweet spot). */
  targetDuration: number;
  /** Stitched timeline signals (null-tolerant: falls back to even sampling). */
  signals: TimelineSignals | null;
  transcript: Transcript;
  captions: Caption[];
  /** Main-track clips (legacy shape) — clip boundaries = raw-clip boundaries. */
  clips: Clip[];
  /** Per-asset analyses, for zoom anchors that follow the action. */
  analyses: Record<string, MediaAnalysis | null>;
  duration: number;
  /** Add the CTA end card. */
  endCard: boolean;
  /** Bump to cut a meaningfully different take. */
  seed?: number;
  /** One-tap adjustments ("faster", "more reactions", "less effects"). */
  modifiers?: MontageModifiers;
  /**
   * The song section the soundtrack will play (chosen up front so the beat
   * grid in `signals` already has this section's phase). Passed through to
   * the recipe for the applier to realize.
   */
  musicCut?: { sourceStart: number; sourceEnd: number };
}

/** One candidate moment inside a raw clip window. */
interface Moment {
  /** Peak instant, current-timeline seconds. */
  peak: number;
  start: number;
  end: number;
  score: number;
  /** Which raw-clip window it came from (dedupe / adjacency rules). */
  window: number;
  /** Loud-dominant = reaction (cheer/laugh), motion-dominant = action. */
  kind: "action" | "reaction";
  /** Similarity fingerprint (mean motion, mean energy, motion std). */
  print: [number, number, number];
  meanMotion: number;
}

export function generateMontageRecipe(input: GenerateMontageInput): EditRecipe {
  const config = applyModifiers(MONTAGE_PRESETS[input.preset], input.modifiers);
  const rand = mulberry32((input.seed ?? 0) + 7);
  const { signals, duration } = input;
  const target = Math.max(8, Math.min(60, input.targetDuration));

  /* 1 — raw-clip windows (single long clip → split on scene changes) */
  const windows = buildWindows(input.clips, signals, duration);

  /* 2 — candidate moments per window */
  const moments: Moment[] = [];
  const curves = signals ? { energy: signals.energy, motion: signals.motion, rate: signals.rate } : null;
  const eStats = curves ? zstats(curves.energy) : null;
  const mStats = curves ? zstats(curves.motion) : null;
  windows.forEach((w, wi) => {
    moments.push(...findMoments(w, wi, curves, eStats, mStats, config, rand));
  });

  /* 3 — speech moments (interview preset): strongest spoken lines */
  const speechSegs: TimeRange[] = [];
  if (config.useSpeech && input.transcript.words.length >= 3) {
    for (const hook of detectHooks(input.transcript, 4)) {
      if (hook.score < 3) continue;
      const start = Math.max(0, hook.startTime - 0.12);
      const end = Math.min(duration, Math.min(hook.endTime + 0.15, start + 4.5));
      if (end - start >= 1.0) speechSegs.push({ start: round3(start), end: round3(end) });
      if (speechSegs.length >= 3) break;
    }
  }

  /* 4 — select: score + seeded jitter, per-window cap, similarity dedupe.
        Moments overlapping a chosen speech segment would repeat footage. */
  const speechBudget = speechSegs.reduce((s, r) => s + (r.end - r.start), 0);
  const candidates = moments.filter(
    (m) => !speechSegs.some((sp) => m.start < sp.end && m.end > sp.start)
  );
  const selected = selectMoments(candidates, target - speechBudget, config, rand);

  /* 5 — order for rhythm: hook → action/reaction alternation → ender */
  const ordered = orderMoments(selected, config, rand);

  /* 6 — beat-quantize segment LENGTHS for non-music grids (energy/footage).
        With a real music track, cut points are phase-locked to its beats in
        step 9 instead — the song keeps playing across cuts, so boundaries
        must land on actual beat instants, not just beat-length multiples. */
  let beatSnapped = 0;
  const musicSync = signals?.beatSource === "music" && signals.beats.length > 4;
  if (signals?.bpm && signals.beats.length > 4 && !musicSync) {
    const interval = 60 / signals.bpm;
    for (const m of ordered) {
      const dur = m.end - m.start;
      const snapped = Math.max(1, Math.round(dur / interval)) * interval;
      if (Math.abs(snapped - dur) > 0.04 && snapped >= config.minSeg && snapped <= config.maxSeg + interval) {
        const winEnd = windows[m.window].end;
        const next = Math.min(winEnd, m.start + snapped);
        if (next - m.start >= config.minSeg) {
          m.end = round3(next);
          beatSnapped++;
        }
      }
    }
  }

  /* 7 — interleave speech (interview): speech line, then 2 action moments, … */
  const finalSegs: Array<{ range: TimeRange; moment: Moment | null }> = [];
  if (speechSegs.length > 0) {
    const actions = [...ordered];
    let ai = 0;
    speechSegs.forEach((sp, si) => {
      finalSegs.push({ range: sp, moment: null });
      const take = si === speechSegs.length - 1 ? actions.length - ai : Math.ceil((actions.length / speechSegs.length));
      for (let k = 0; k < take && ai < actions.length; k++, ai++) {
        finalSegs.push({ range: { start: actions[ai].start, end: actions[ai].end }, moment: actions[ai] });
      }
    });
  } else {
    for (const m of ordered) finalSegs.push({ range: { start: m.start, end: m.end }, moment: m });
  }

  /* 8 — speed ramp: slow-mo the single biggest moment (drama), if allowed */
  const rangeSpeeds: (number | undefined)[] = finalSegs.map(() => undefined);
  let ramped = false;
  if (config.speedRamps) {
    let bestIdx = -1;
    let bestScore = -1;
    finalSegs.forEach((seg, i) => {
      const m = seg.moment;
      if (m && m.score > bestScore && m.end - m.start >= 1.6) {
        bestScore = m.score;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      rangeSpeeds[bestIdx] = 0.85;
      ramped = true;
    }
  }

  // keptRanges holds the SAME range objects as finalSegs — step 9's
  // music-sync adjustments below flow into the recipe automatically.
  const keptRanges = finalSegs.map((s) => s.range);

  /* 9 — final-timeline layout (durations grow through slow-mo ramps).
        Music sync: the song plays over the final cut from t=0, so every cut
        boundary is nudged onto the nearest actual beat instant of the music
        (phase-locked, not just beat-length multiples). */
  const beatTolerance = musicSync
    ? Math.min(0.6, (signals!.bpm ? 60 / signals!.bpm : medianGap(signals!.beats)) * 0.55)
    : 0;
  const finalStarts: number[] = [];
  let cursor = 0;
  finalSegs.forEach((seg, i) => {
    finalStarts.push(round3(cursor));
    const speed = rangeSpeeds[i] ?? 1;
    let outDur = (seg.range.end - seg.range.start) / speed;
    if (musicSync && i < finalSegs.length) {
      const beat = nearestBeat(cursor + outDur, signals!.beats, beatTolerance);
      if (beat !== null) {
        const newOut = beat - cursor;
        const winEnd = seg.moment ? windows[seg.moment.window].end : seg.range.end;
        const maxOut = (winEnd - seg.range.start) / speed;
        const minOut = Math.max(0.5, config.minSeg * 0.6);
        if (
          Math.abs(newOut - outDur) > 0.03 &&
          newOut >= minOut &&
          newOut <= Math.min(maxOut, config.maxSeg * 1.5)
        ) {
          seg.range.end = round3(seg.range.start + newOut * speed);
          if (seg.moment) seg.moment.end = seg.range.end;
          outDur = newOut;
          beatSnapped++;
        }
      }
    }
    cursor += outDur;
  });
  const newDuration = round3(cursor);

  /* 10 — zooms: punch-ins on the strongest moments (anchored on the action),
          plus subtle drift on static segments so nothing reads as frozen. */
  const zooms: ZoomInstruction[] = [];
  const zoomable = finalSegs
    .map((seg, i) => ({ seg, i }))
    .filter((x) => x.seg.moment !== null)
    .sort((a, b) => (b.seg.moment!.score - a.seg.moment!.score));
  const zoomCount = Math.max(1, Math.round(zoomable.length * config.zoomShare));
  for (const { seg, i } of zoomable.slice(0, zoomCount)) {
    const m = seg.moment!;
    const speed = rangeSpeeds[i] ?? 1;
    const peakFinal = finalStarts[i] + (m.peak - m.start) / speed;
    const start = Math.max(finalStarts[i], peakFinal - 0.12);
    const segEnd = finalStarts[i] + (m.end - m.start) / speed;
    const end = Math.min(segEnd, start + 1.6);
    if (end - start < 0.45) continue;
    zooms.push({
      start: round3(start),
      end: round3(end),
      scale: round3(Math.min(1.35, config.zoomScale + (rand() - 0.5) * 0.05)),
      reason: m.kind === "reaction" ? "reaction" : "action",
      anchorX: anchorXAt(m.peak, input.clips, input.analyses),
      anchorY: m.kind === "reaction" ? 0.38 : 0.45,
    });
  }
  if (config.driftZooms) {
    finalSegs.forEach((seg, i) => {
      const m = seg.moment;
      if (!m || m.meanMotion > 0.12) return;
      const start = finalStarts[i];
      const end = start + (seg.range.end - seg.range.start) / (rangeSpeeds[i] ?? 1);
      if (zooms.some((z) => z.start < end && z.end > start)) return;
      zooms.push({
        start: round3(start),
        end: round3(end),
        scale: 1.06,
        reason: "pattern-interrupt",
        anchorX: anchorXAt(m.peak, input.clips, input.analyses),
        anchorY: 0.45,
      });
    });
  }
  zooms.sort((a, b) => a.start - b.start);

  /* 10b — flash pops: at most two, only on genuinely big action moments,
        short and soft (the renderer caps peak opacity at 0.75). */
  const flashes: TimeRange[] = [];
  if (config.flashOnPeaks) {
    for (const { seg, i } of zoomable.slice(0, zoomCount)) {
      if (flashes.length >= 2) break;
      const m = seg.moment!;
      if (m.kind !== "action" || m.score < 4.5) continue;
      const start = finalStarts[i];
      flashes.push({ start: round3(start), end: round3(start + 0.18) });
    }
  }

  /* 11 — text overlays: hook line + CTA end card (phrase bank when no speech) */
  const overlays: OverlayInstruction[] = [];
  const hasCaptions = input.captions.length > 0;
  const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(rand() * arr.length)];
  if (!hasCaptions && config.hookLines.length > 0 && newDuration > 6) {
    overlays.push({
      kind: "text",
      text: pick(config.hookLines)!,
      start: 0,
      end: round3(Math.min(2.4, newDuration / 6)),
      y: -520,
      role: "hook",
    });
  }
  if (!hasCaptions && config.midLines.length > 0 && newDuration > 14 && rand() > 0.35) {
    const at = round3(newDuration * (0.55 + rand() * 0.1));
    overlays.push({
      kind: "text",
      text: pick(config.midLines)!,
      start: at,
      end: round3(Math.min(newDuration - 1, at + 1.8)),
      y: -520,
      role: "context",
    });
  }
  if (input.endCard && config.cta && newDuration > 10) {
    overlays.push({
      kind: "text",
      text: config.cta,
      start: round3(Math.max(0, newDuration - 2.2)),
      end: round3(newDuration),
      y: 480,
      role: "cta",
    });
  }

  /* 12 — highlights list for the panel (final-timeline times) */
  const highlights: HighlightMoment[] = finalSegs
    .map((seg, i) => {
      const m = seg.moment;
      const start = finalStarts[i];
      const end = round3(start + (seg.range.end - seg.range.start) / (rangeSpeeds[i] ?? 1));
      if (!m) {
        return {
          time: start, start, end, score: 5,
          kind: "speech" as const, label: "Spoken line",
        };
      }
      const label =
        i === 0
          ? "Opening moment"
          : m.kind === "reaction"
            ? "Reaction / celebration"
            : "Action";
      return { time: round3(start + 0.1), start, end, score: Math.round(m.score * 10) / 10, kind: m.kind, label };
    })
    .filter((h, i) => i === 0 || h.score >= 3.5)
    .slice(0, 12);

  /* summary */
  const usedWindows = new Set(finalSegs.map((s) => s.moment?.window).filter((w) => w !== undefined));
  const parts: string[] = [];
  parts.push(`Picked ${finalSegs.length} moments from ${usedWindows.size || windows.length} of ${windows.length} clips`);
  parts.push(`${Math.round(newDuration)}s ${config.name} montage`);
  if (!config.chronological) parts.push("opened on the biggest moment");
  if (beatSnapped > 0) {
    parts.push(
      musicSync
        ? `${beatSnapped} cuts locked to the music`
        : input.signals?.beatSource === "energy"
          ? `${beatSnapped} cuts on energy peaks`
          : `${beatSnapped} cuts on the beat`
    );
  }
  if (ramped) parts.push("slow-mo on the top moment");
  if (zooms.length > 0) parts.push(`${zooms.length} punch-zooms`);
  if (flashes.length > 0) parts.push(`${flashes.length} flash pops`);
  if (input.musicCut && input.musicCut.sourceStart > 1) {
    parts.push(`music cut to its best section (${Math.round(input.musicCut.sourceStart)}s in)`);
  }

  return {
    id: nanoid(10),
    projectId: input.projectId,
    style: input.preset,
    keptRanges,
    rangeSpeeds,
    cuts: [],
    captions: [],
    zooms,
    flashes,
    musicCut: input.musicCut,
    overlays,
    brollSuggestions: [],
    audioInstructions: [
      {
        kind: "add-music",
        value: 0.85,
        note: musicSync
          ? "Cuts are locked to your music's beats. Swapped the song? Regenerate to re-sync."
          : "Add music (AI Edit panel or Media bin) — the next montage locks its cuts to the song's beat.",
      },
    ],
    hooks: [],
    highlights,
    exportPreset: "tiktok",
    reasoningSummary: parts.join(" · ") + ".",
  };
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

/** Raw-clip windows on the current timeline; a lone long clip is split on scene changes. */
function buildWindows(clips: Clip[], signals: TimelineSignals | null, duration: number): TimeRange[] {
  const windows: TimeRange[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const dur = clipDuration(clip);
    if (dur > 0.25) windows.push({ start: round3(cursor), end: round3(cursor + dur) });
    cursor += dur;
  }
  if (windows.length === 0) return [{ start: 0, end: duration }];

  if (windows.length >= 3 || !signals) return windows;

  // 1–2 clips: subdivide on scene changes so distinct plays rank separately.
  const cuts = signals.sceneChanges.filter((t) => t > 1 && t < duration - 1);
  const out: TimeRange[] = [];
  for (const w of windows) {
    let start = w.start;
    for (const c of cuts) {
      if (c > start + 2.0 && c < w.end - 2.0) {
        out.push({ start: round3(start), end: round3(c) });
        start = c;
      }
    }
    out.push({ start: round3(start), end: w.end });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Moment detection & selection                                        */
/* ------------------------------------------------------------------ */

interface Curves {
  energy: number[];
  motion: number[];
  rate: number;
}
interface ZStats {
  mean: number;
  std: number;
}

function zstats(curve: number[]): ZStats {
  if (curve.length === 0) return { mean: 0, std: 0 };
  const mean = curve.reduce((s, v) => s + v, 0) / curve.length;
  const std = Math.sqrt(curve.reduce((s, v) => s + (v - mean) ** 2, 0) / curve.length) || 0.001;
  return { mean, std };
}

/** Up to 2 peak moments inside one raw-clip window. */
function findMoments(
  w: TimeRange,
  wi: number,
  curves: Curves | null,
  eStats: ZStats | null,
  mStats: ZStats | null,
  config: MontageConfig,
  rand: () => number
): Moment[] {
  const winDur = w.end - w.start;
  if (winDur < 0.5) return [];

  // No signals → neutral moment in the middle of the clip (still montage-able).
  if (!curves || !eStats || !mStats) {
    const segDur = Math.min(winDur, (config.minSeg + config.maxSeg) / 2);
    const start = w.start + Math.max(0, (winDur - segDur) * (0.35 + rand() * 0.3));
    return [{
      peak: round3(start + segDur * 0.6),
      start: round3(start),
      end: round3(start + segDur),
      score: 3 + rand(),
      window: wi,
      kind: "action",
      print: [0.5, 0.5, 0.2],
      meanMotion: 0.5,
    }];
  }

  const { energy, motion, rate } = curves;
  const from = Math.max(0, Math.floor(w.start * rate));
  const to = Math.min(Math.max(energy.length, motion.length), Math.ceil(w.end * rate));
  if (to - from < 2) return [];

  const combined: number[] = [];
  for (let i = from; i < to; i++) {
    const eZ = Math.max(0, ((energy[i] ?? 0) - eStats.mean) / eStats.std);
    const mZ = Math.max(0, ((motion[i] ?? 0) - mStats.mean) / mStats.std);
    combined.push(2 * eZ + 2 * mZ);
  }

  // Local maxima with ≥3s separation, best two per window.
  const half = Math.max(1, Math.round(rate * 0.4));
  const peaks: Array<{ idx: number; v: number }> = [];
  for (let i = 0; i < combined.length; i++) {
    let isPeak = true;
    for (let j = Math.max(0, i - half); j <= Math.min(combined.length - 1, i + half); j++) {
      if (combined[j] > combined[i]) { isPeak = false; break; }
    }
    if (isPeak && combined[i] > 0.3) peaks.push({ idx: i, v: combined[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  const kept: Array<{ idx: number; v: number }> = [];
  for (const p of peaks) {
    if (kept.some((k) => Math.abs(k.idx - p.idx) < rate * 3)) continue;
    kept.push(p);
    if (kept.length >= (winDur > 8 ? 2 : 1)) break;
  }
  if (kept.length === 0) {
    // Flat clip — take its busiest stretch anyway (may be dropped in selection).
    let bestI = 0;
    for (let i = 1; i < combined.length; i++) if (combined[i] > combined[bestI]) bestI = i;
    kept.push({ idx: bestI, v: combined[bestI] * 0.5 });
  }

  return kept.map((p) => {
    const t = w.start + p.idx / rate;
    // Lead-in keeps the play that caused the moment; tail keeps the follow-
    // through. Seeded jitter varies the in/out points so every regenerate is
    // a genuinely different cut, even in chronological (recap) order.
    const lead = Math.min(config.maxSeg * 0.55, 1.3) * (0.8 + rand() * 0.4);
    const tail = Math.min(config.maxSeg * 0.45, 1.2) * (0.8 + rand() * 0.4);
    let start = Math.max(w.start, t - lead);
    let end = Math.min(w.end, t + tail);
    if (end - start < config.minSeg) {
      end = Math.min(w.end, start + config.minSeg);
      start = Math.max(w.start, end - config.minSeg);
    }

    // Stats over the segment for kind/fingerprint.
    const sFrom = Math.max(0, Math.floor(start * rate));
    const sTo = Math.max(sFrom + 1, Math.ceil(end * rate));
    let me = 0, mm = 0, mv = 0;
    for (let i = sFrom; i < sTo; i++) { me += energy[i] ?? 0; mm += motion[i] ?? 0; }
    me /= sTo - sFrom; mm /= sTo - sFrom;
    for (let i = sFrom; i < sTo; i++) mv += ((motion[i] ?? 0) - mm) ** 2;
    mv = Math.sqrt(mv / (sTo - sFrom));

    const eZ = (me - eStats.mean) / eStats.std;
    const mZ = (mm - mStats.mean) / mStats.std;
    // Late-in-clip peaks are usually the payoff (goal → celebration).
    const endBonus = (t - w.start) / Math.max(1, winDur) > 0.55 ? 0.6 : 0;

    return {
      peak: round3(t),
      start: round3(start),
      end: round3(end),
      score: Math.round((p.v + endBonus + 1) * 10) / 10,
      window: wi,
      kind: (eZ > mZ * 1.2 ? "reaction" : "action") as Moment["kind"],
      print: [mm, me, mv] as [number, number, number],
      meanMotion: mm,
    };
  });
}

/** Greedy pick: strongest first with seeded jitter, capped per window, deduped by similarity. */
function selectMoments(
  moments: Moment[],
  target: number,
  config: MontageConfig,
  rand: () => number
): Moment[] {
  const avgSeg = (config.minSeg + config.maxSeg) / 2;
  const maxCount = Math.max(4, Math.min(20, Math.round(target / config.minSeg)));
  const jittered = moments
    .map((m) => ({
      m,
      key:
        m.score +
        (rand() - 0.5) * 1.2 +
        (config.favorKind && m.kind === config.favorKind ? 1.5 : 0),
    }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.m);

  const perWindow = new Map<number, number>();
  const selected: Moment[] = [];
  let total = 0;

  const trySelect = (m: Moment, allowSimilar: boolean): boolean => {
    if ((perWindow.get(m.window) ?? 0) >= 2) return false;
    if (!allowSimilar && selected.some((s) => s.window !== m.window && printDistance(s.print, m.print) < 0.045)) {
      return false; // looks like a clip we already have
    }
    if (total + (m.end - m.start) > target + avgSeg * 0.6) return false;
    selected.push(m);
    perWindow.set(m.window, (perWindow.get(m.window) ?? 0) + 1);
    total += m.end - m.start;
    return true;
  };

  for (const m of jittered) {
    if (selected.length >= maxCount || total >= target) break;
    trySelect(m, false);
  }
  // Underfilled (short footage / heavy dedupe): relax the similarity rule.
  if (total < target * 0.7) {
    for (const m of jittered) {
      if (selected.length >= maxCount || total >= target) break;
      if (!selected.includes(m)) trySelect(m, true);
    }
  }
  return selected;
}

function printDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Hook first (cut tight), build through alternating action/reaction, end big. */
function orderMoments(selected: Moment[], config: MontageConfig, rand: () => number): Moment[] {
  if (selected.length === 0) return [];

  if (config.chronological) {
    const chrono = [...selected].sort((a, b) => a.start - b.start);
    tightenHook(chrono[0], config);
    return chrono;
  }

  const byScore = [...selected].sort((a, b) => b.score - a.score);
  // Variation: an alternate take may open on the runner-up moment.
  const hookIdx = byScore.length > 2 && rand() > 0.6 ? 1 : 0;
  const hook = byScore[hookIdx];
  const ender = byScore.find((m) => m !== hook) ?? hook;
  const middle = byScore.filter((m) => m !== hook && m !== ender);

  tightenHook(hook, config);

  // Alternate action/reaction through the middle, never two segments from the
  // same raw clip back to back when avoidable.
  const actions = middle.filter((m) => m.kind === "action").sort((a, b) => a.score - b.score);
  const reactions = middle.filter((m) => m.kind === "reaction").sort((a, b) => a.score - b.score);
  const orderedMiddle: Moment[] = [];
  let wantReaction = false;
  while (actions.length > 0 || reactions.length > 0) {
    const pools = wantReaction ? [reactions, actions] : [actions, reactions];
    const pool = pools[0].length > 0 ? pools[0] : pools[1];
    const prev = orderedMiddle[orderedMiddle.length - 1] ?? hook;
    let idx = pool.length - 1;
    if (pool.length > 1 && pool[idx].window === prev.window) idx -= 1;
    orderedMiddle.push(pool.splice(idx, 1)[0]);
    wantReaction = !wantReaction;
  }

  return hook === ender ? [hook, ...orderedMiddle] : [hook, ...orderedMiddle, ender];
}

/** The first frame must land on the action: open close to the peak. */
function tightenHook(hook: Moment, config: MontageConfig): void {
  hook.start = round3(Math.max(hook.start, hook.peak - Math.min(0.5, config.hookSeg * 0.3)));
  hook.end = round3(Math.min(hook.end, hook.start + config.hookSeg));
}

/* ------------------------------------------------------------------ */
/* Zoom anchoring                                                      */
/* ------------------------------------------------------------------ */

/** Horizontal zoom anchor at a timeline instant, from the motion-center analysis. */
function anchorXAt(
  time: number,
  clips: Clip[],
  analyses: Record<string, MediaAnalysis | null>
): number {
  let cursor = 0;
  for (const clip of clips) {
    const dur = clipDuration(clip);
    if (time < cursor + dur) {
      const video = analyses[clip.mediaId]?.video;
      const centers = video?.motionCenterX;
      const rate = video?.motionCenterRate;
      if (!centers || !rate) return 0.5;
      const srcT = clip.sourceStart + (time - cursor) * clipSpeed(clip);
      const i = Math.max(0, Math.min(centers.length - 1, Math.floor(srcT * rate)));
      // Blend toward center — the zoom should lean at the action, not chase it.
      return round3(0.5 + (centers[i] - 0.5) * 0.6);
    }
    cursor += dur;
  }
  return 0.5;
}

/** Overlay one-tap regenerate adjustments onto a preset (returns a copy). */
function applyModifiers(config: MontageConfig, mods?: MontageModifiers): MontageConfig {
  if (!mods) return config;
  const pace = Math.max(0.5, Math.min(2, mods.pace ?? 1));
  const fx = Math.max(0, Math.min(1.5, mods.effectsLevel ?? 1));
  return {
    ...config,
    minSeg: Math.max(0.4, config.minSeg * pace),
    maxSeg: Math.max(0.8, config.maxSeg * pace),
    hookSeg: Math.max(0.7, config.hookSeg * Math.min(1, pace)),
    zoomShare: config.zoomShare * fx,
    speedRamps: config.speedRamps && fx > 0.5,
    driftZooms: config.driftZooms && fx > 0.3,
    flashOnPeaks: config.flashOnPeaks && fx > 0.5,
    favorKind: mods.favorKind,
  };
}

/** Nearest beat instant within `tolerance` seconds of `t`, or null. */
function nearestBeat(t: number, beats: number[], tolerance: number): number | null {
  let best: number | null = null;
  let bestDist = tolerance;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
    if (b > t + tolerance) break;
  }
  return best;
}

/** Median gap between consecutive beats (fallback interval when bpm is null). */
function medianGap(beats: number[]): number {
  if (beats.length < 2) return 0.5;
  const gaps = beats
    .slice(1)
    .map((t, i) => t - beats[i])
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
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
