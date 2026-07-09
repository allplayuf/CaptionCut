/**
 * End-to-end verification of the auto-edit + export pipeline (dev tool).
 * Run: npx tsx scripts/verify-pipeline.ts
 *
 * Loads a real saved project, generates + applies an EditRecipe (cuts,
 * zooms, hook, overlays), then renders the result through the real ffmpeg
 * exporter and reports the outcome.
 */
import fs from "fs";
import path from "path";
import type { Project } from "@/types";
import { migrateTracks, tracksDuration, mainClips } from "@/lib/timeline/tracks";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { generateEditRecipe } from "@/lib/autoEdit/generateEditRecipe";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import { detectHooks } from "@/lib/autoEdit/detectHooks";
import { findBestWindow } from "@/lib/autoEdit/scoreMoments";
import { buildExportRequest } from "@/lib/export/request";
import { startExportJob, readJobState, exportOutputPath } from "@/lib/export/exporter";

const PROJECT_FILE = path.join(process.cwd(), "data", "projects", "8TumD2bjHd.json");

async function main() {
  const project = JSON.parse(fs.readFileSync(PROJECT_FILE, "utf8")) as Project;
  const tracks = migrateTracks(project);
  const duration = tracksDuration(tracks);
  console.log(`Loaded project "${project.name}": ${duration.toFixed(1)}s, ${project.captions.length} captions`);

  // 1. transcript analysis
  const transcript = analyzeTranscript(project.captions);
  console.log(`Transcript: ${transcript.words.length} words, ${transcript.sentences.length} sentences, pace ${transcript.averagePace}/s`);
  if (transcript.words.length === 0) throw new Error("transcript empty");

  // 2. hooks
  const hooks = detectHooks(transcript, 5);
  console.log(`Top hooks:`);
  hooks.forEach((h) => console.log(`  [${h.score}] ${h.startTime}-${h.endTime}s "${h.text}" (${h.reasons.join(", ")})`));

  // 3. best window
  const best = findBestWindow({ transcript, duration }, 30);
  console.log(`Best 30s window: ${best?.start}–${best?.end} (score ${best?.score})`);

  // 4. recipe
  const recipe = generateEditRecipe({
    projectId: project.id,
    transcript,
    captions: project.captions,
    duration,
    style: "viral",
  });
  console.log(`Recipe: ${recipe.cuts.length} cuts, ${recipe.zooms.length} zooms, ${recipe.overlays.length} overlays, kept ${recipe.keptRanges.length} ranges`);
  console.log(`Summary: ${recipe.reasoningSummary}`);

  // 5. apply
  const applied = applyEditRecipeToTimeline(tracks, project.captions, recipe);
  if (!applied) throw new Error("apply produced empty timeline");
  const newDur = tracksDuration(applied.tracks);
  console.log(`Applied: ${mainClips(applied.tracks).length} main clips, new duration ${newDur.toFixed(1)}s, ${applied.captions.length} captions`);

  // sanity: captions inside timeline, monotonic
  for (const c of applied.captions) {
    if (c.startTime < -0.01 || c.endTime > newDur + 0.5) throw new Error(`caption out of range: ${c.startTime}-${c.endTime} "${c.text}"`);
    if (c.endTime <= c.startTime) throw new Error(`caption inverted: "${c.text}"`);
  }
  console.log("Caption remap sanity: OK");

  // 6. export through the real ffmpeg pipeline (draft preset for speed)
  const request = buildExportRequest({
    media: project.media,
    tracks: applied.tracks,
    captions: applied.captions,
    style: project.style,
    presetId: "draft",
  });
  console.log(`Export request: ${request.clips.length} clips, ${request.zooms?.length} zooms, ${request.textOverlays?.length} text overlays, ${request.audioClips?.length} audio clips`);

  const job = startExportJob(request);
  console.log(`Export job ${job.id} started…`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const state = readJobState(job.id);
    if (!state) throw new Error("job state missing");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    process.stdout.write(`\r  progress ${(state.progress * 100).toFixed(0)}%  `);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("export timeout");
  }
  const out = exportOutputPath(job.id);
  const size = fs.statSync(out).size;
  console.log(`\nExport DONE: ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
