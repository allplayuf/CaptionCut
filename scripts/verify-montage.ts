/**
 * End-to-end verification of the football-montage pipeline (dev tool).
 * Run: npx tsx scripts/verify-montage.ts
 *
 * Builds a multi-clip project from real files in data/media, runs the local
 * analysis (motion, energy, beats, motion-center), generates a montage
 * recipe for every preset (checking invariants + regenerate variation),
 * applies it to the timeline, and renders one result through the real
 * ffmpeg exporter (exercising speed ramps + smart crop).
 */
import fs from "fs";
import path from "path";
import type { MediaAnalysis, MediaAsset, MontageStyle } from "@/types";
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
import { buildTimelineSignals } from "@/lib/autoEdit/signals";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { MONTAGE_PRESETS, generateMontageRecipe } from "@/lib/autoEdit/montage";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import { buildExportRequest } from "@/lib/export/request";
import { exportOutputPath, readJobState, startExportJob } from "@/lib/export/exporter";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const MAX_FILES = 4;

async function main() {
  const files = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => /\.(mp4|mov|webm|m4v|mkv)$/i.test(f))
    .slice(0, MAX_FILES);
  if (files.length === 0) throw new Error("no media files in data/media to test with");

  /* 1 — probe + build a multi-clip project */
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
  // Cap each raw clip at 20s so the test stays quick.
  video.clips = media.map((m) => makeMainClip(m, 0, Math.min(m.duration, 20)));
  tracks[tracks.indexOf(video)] = rippleMainTrack(video);
  const duration = tracksDuration(tracks);
  console.log(`Project: ${media.length} clips, ${duration.toFixed(1)}s total`);

  /* 2 — local analysis (v3: motion, energy, beats, motion-center) */
  const analyses: Record<string, MediaAnalysis | null> = {};
  for (const m of media) {
    const t0 = Date.now();
    analyses[m.id] = await analyzeAsset(m.id, m.filename, {
      hasAudio: m.hasAudio,
      hasVideo: true,
      duration: m.duration,
    });
    const a = analyses[m.id];
    console.log(
      `  analyzed ${m.filename} in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
        `audio:${a?.audio ? "y" : "n"} video:${a?.video ? "y" : "n"} ` +
        `centerX:${a?.video?.motionCenterX ? a.video.motionCenterX.length + " samples" : "n/a"} ` +
        `bpm:${a?.audio?.bpm ?? "-"}`
    );
  }

  const signals = buildTimelineSignals(tracks, media, analyses);
  if (!signals) throw new Error("buildTimelineSignals returned null");
  console.log(`Signals: ${signals.energy.length} energy bins, ${signals.beats.length} beats`);

  /* 3 — every preset: generate, sanity-check, apply */
  const transcript = analyzeTranscript([]);
  for (const preset of Object.keys(MONTAGE_PRESETS) as MontageStyle[]) {
    const recipe = generateMontageRecipe({
      projectId: "verify",
      preset,
      targetDuration: 20,
      signals,
      transcript,
      captions: [],
      clips: mainClips(tracks),
      analyses,
      duration,
      endCard: true,
      seed: 0,
    });
    if (recipe.keptRanges.length === 0) throw new Error(`${preset}: empty keptRanges`);
    const total = recipe.keptRanges.reduce((s, r) => s + (r.end - r.start), 0);
    if (total < 6 || total > 40) throw new Error(`${preset}: montage length ${total.toFixed(1)}s out of range`);
    for (const r of recipe.keptRanges) {
      if (r.start < -0.01 || r.end > duration + 0.01 || r.end <= r.start) {
        throw new Error(`${preset}: bad range ${r.start}–${r.end}`);
      }
    }
    const applied = applyEditRecipeToTimeline(tracks, [], recipe);
    if (!applied) throw new Error(`${preset}: apply failed`);
    const outDur = tracksDuration(applied.tracks);

    // Regenerate must produce a different cut.
    const take2 = generateMontageRecipe({
      projectId: "verify", preset, targetDuration: 20, signals, transcript,
      captions: [], clips: mainClips(tracks), analyses, duration, endCard: true, seed: 1,
    });
    const differs =
      JSON.stringify(take2.keptRanges) !== JSON.stringify(recipe.keptRanges);
    console.log(
      `  [${preset}] ${recipe.keptRanges.length} segments → ${outDur.toFixed(1)}s, ` +
        `${recipe.zooms.length} zooms, ${recipe.overlays.length} overlays, ` +
        `ramps:${recipe.rangeSpeeds?.filter((s) => s !== undefined).length ?? 0}, ` +
        `regen-differs:${differs ? "yes" : "NO"}`
    );
    console.log(`    "${recipe.reasoningSummary}"`);
    if (!differs) throw new Error(`${preset}: regenerate produced an identical cut`);
  }

  /* 4 — render the Hype montage through the real exporter (draft preset) */
  const recipe = generateMontageRecipe({
    projectId: "verify", preset: "hype", targetDuration: 18, signals, transcript,
    captions: [], clips: mainClips(tracks), analyses, duration, endCard: true, seed: 0,
  });
  const applied = applyEditRecipeToTimeline(tracks, [], recipe)!;
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
  const speedClips = req.clips.filter((c) => c.speed && Math.abs(c.speed - 1) > 0.01).length;
  console.log(`Exporting: ${req.clips.length} clips (${speedClips} speed-ramped), ${req.zooms?.length} zooms, ${req.textOverlays?.length} text overlays`);

  const job = startExportJob(req);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = readJobState(job.id);
    if (!state) throw new Error("job state lost");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("export timed out");
  }
  const out = exportOutputPath(job.id);
  const probe = await probeMedia(out);
  const expected = tracksDuration(applied.tracks);
  console.log(
    `Export OK in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${out}\n` +
      `  ${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s (timeline ${expected.toFixed(2)}s)`
  );
  if (Math.abs(probe.duration - expected) > 1.0) {
    throw new Error(`duration mismatch: got ${probe.duration}, expected ${expected}`);
  }
  console.log("\nALL CHECKS PASSED ✅");
}

main().catch((err) => {
  console.error("\nVERIFY FAILED ❌", err);
  process.exit(1);
});
