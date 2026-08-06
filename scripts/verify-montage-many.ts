/**
 * The "I dropped in 20 clips" case (dev tool).
 * Run: npx tsx scripts/verify-montage-many.ts
 *
 * verify-montage.ts proves the engine works on a handful of clips. This one
 * proves the headline workflow: add a whole shoot's worth of raw clips as one
 * sequence, press build once, and get a tight montage that actually draws from
 * across the footage rather than parking on the first two clips.
 *
 * It mirrors what the app does — addMediaBatchToTimeline, then the montage
 * builder's defaults — and renders the result through the real exporter.
 */
import fs from "fs";
import path from "path";
import type { MediaAnalysis, MediaAsset } from "@/types";
import { probeMedia } from "@/lib/server/ffmpeg";
import { analyzeAsset } from "@/lib/server/analyze";
import {
  createDefaultTracks,
  mainClips,
  mainVideoTrack,
  makeMainClip,
  rippleMainTrack,
  tracksDuration,
} from "@/lib/timeline/tracks";
import { clipDuration } from "@/lib/video/timeline";
import { buildTimelineSignals } from "@/lib/autoEdit/signals";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { generateMontageRecipe } from "@/lib/autoEdit/montage";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import { buildExportRequest } from "@/lib/export/request";
import { exportOutputPath, readJobState, startExportJob } from "@/lib/export/exporter";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
/** The scenario under test. */
const CLIP_COUNT = 20;
/** Raw clips are trimmed to this so the timeline resembles real match footage. */
const CLIP_SECONDS = 12;
const TARGET_DURATION = 20;

async function main() {
  // Smallest files first: analysis reads the whole source, and this needs 20 of
  // them. The engine's behaviour doesn't depend on file size.
  const files = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => /\.(mp4|mov|webm|m4v|mkv)$/i.test(f))
    .map((f) => ({ f, size: fs.statSync(path.join(MEDIA_DIR, f)).size }))
    .sort((a, b) => a.size - b.size)
    .slice(0, CLIP_COUNT)
    .map((x) => x.f);
  if (files.length < 5) throw new Error(`need at least 5 videos in data/media, found ${files.length}`);
  console.log(`Using ${files.length} source files\n`);

  /* 1 — the library, then all of it dropped on the timeline at once */
  const media: MediaAsset[] = [];
  for (const f of files) {
    const p = await probeMedia(path.join(MEDIA_DIR, f));
    media.push({
      id: f.replace(/\..+$/, ""),
      filename: f,
      originalName: f,
      mimeType: "video/mp4",
      size: 0,
      duration: p.duration,
      width: p.width,
      height: p.height,
      fps: p.fps,
      hasAudio: p.hasAudio,
      kind: "video",
    });
  }
  const tracks = createDefaultTracks();
  const video = mainVideoTrack(tracks);
  video.clips = media.map((m) => makeMainClip(m, 0, Math.min(m.duration, CLIP_SECONDS)));
  tracks[tracks.indexOf(video)] = rippleMainTrack(video);
  const duration = tracksDuration(tracks);
  console.log(`Timeline: ${media.length} clips, ${duration.toFixed(1)}s of raw footage`);

  /* 2 — analysis, exactly what the builder warms before generating */
  const analyses: Record<string, MediaAnalysis | null> = {};
  const analysisStart = Date.now();
  for (const m of media) {
    analyses[m.id] = await analyzeAsset(m.id, m.filename, {
      hasAudio: m.hasAudio,
      hasVideo: true,
      duration: m.duration,
    });
  }
  console.log(`Analyzed ${media.length} files in ${((Date.now() - analysisStart) / 1000).toFixed(0)}s`);

  const signals = buildTimelineSignals(tracks, media, analyses);
  if (!signals) throw new Error("buildTimelineSignals returned null");

  /* 3 — one build, with the same defaults the Montage panel ships */
  const clips = mainClips(tracks);
  const recipe = generateMontageRecipe({
    projectId: "verify-many",
    preset: "hype",
    targetDuration: TARGET_DURATION,
    signals,
    transcript: analyzeTranscript([]),
    captions: [],
    clips,
    analyses,
    duration,
    endCard: true,
    seed: 0,
  });
  if (recipe.keptRanges.length === 0) throw new Error("montage produced no segments");

  /* 4 — the property that matters: it cut ACROSS the footage */
  const bounds: Array<{ id: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const clip of clips) {
    const d = clipDuration(clip);
    bounds.push({ id: clip.id, start: cursor, end: cursor + d });
    cursor += d;
  }
  const sourceClipFor = (t: number) =>
    bounds.find((b) => t >= b.start && t < b.end)?.id ?? bounds[bounds.length - 1].id;
  const used = new Set(recipe.keptRanges.map((r) => sourceClipFor((r.start + r.end) / 2)));

  const total = recipe.keptRanges.reduce((s, r) => s + (r.end - r.start), 0);
  console.log(
    `\nMontage: ${recipe.keptRanges.length} segments from ${used.size}/${media.length} clips, ` +
      `${total.toFixed(1)}s, ${recipe.zooms.length} zooms, ${recipe.flashes?.length ?? 0} flashes`
  );
  console.log(`  "${recipe.reasoningSummary}"`);

  // With 20 distinct sources a montage that only visits a couple of them has
  // failed at its job, however pretty the individual cuts are.
  const minSources = Math.min(6, Math.floor(media.length / 2));
  if (used.size < minSources) {
    throw new Error(`montage only used ${used.size} of ${media.length} clips (expected >= ${minSources})`);
  }
  if (total < TARGET_DURATION * 0.5 || total > TARGET_DURATION * 2) {
    throw new Error(`montage length ${total.toFixed(1)}s is far from the ${TARGET_DURATION}s target`);
  }
  for (const r of recipe.keptRanges) {
    if (r.start < -0.01 || r.end > duration + 0.01 || r.end <= r.start) {
      throw new Error(`bad range ${r.start}–${r.end}`);
    }
  }

  /* 5 — render it for real */
  const applied = applyEditRecipeToTimeline(tracks, [], recipe);
  if (!applied) throw new Error("apply failed");
  const expected = tracksDuration(applied.tracks);

  const req = buildExportRequest({
    media,
    tracks: applied.tracks,
    captions: applied.captions,
    style: {
      fontFamily: "Arial", fontSize: 64, fontWeight: 900, textColor: "#fff",
      backgroundColor: null, backgroundOpacity: 0.8, strokeColor: "#000",
      strokeWidth: 5, shadow: true, position: "lower", allCaps: true, highlightColor: "#FFE100",
    },
    presetId: "draft",
  });
  console.log(`\nExporting ${req.clips.length} pieces…`);

  const { state: job } = await startExportJob(req);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = await readJobState(job.id);
    if (!state) throw new Error("job state lost");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("export timed out");
  }
  const probe = await probeMedia(exportOutputPath(job.id));
  console.log(
    `Export OK in ${((Date.now() - t0) / 1000).toFixed(0)}s: ` +
      `${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s (timeline ${expected.toFixed(2)}s)`
  );
  if (Math.abs(probe.duration - expected) > 1.0) {
    throw new Error(`duration mismatch: got ${probe.duration}, expected ${expected}`);
  }

  console.log("\n20-CLIP MONTAGE CHECKS PASSED ✅");
}

main().catch((err) => {
  console.error("\nVERIFY FAILED ❌", err);
  process.exit(1);
});
