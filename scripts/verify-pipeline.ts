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
import type { MediaAnalysis, Project } from "@/types";
import { migrateTracks, tracksDuration, mainClips } from "@/lib/timeline/tracks";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { generateEditRecipe } from "@/lib/autoEdit/generateEditRecipe";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import { detectHooks } from "@/lib/autoEdit/detectHooks";
import { detectHighlights, detectDeadSpace } from "@/lib/autoEdit/detectHighlights";
import { findBestWindow } from "@/lib/autoEdit/scoreMoments";
import { buildTimelineSignals } from "@/lib/autoEdit/signals";
import { analyzeAsset } from "@/lib/server/analyze";
import { buildExportRequest } from "@/lib/export/request";
import { startExportJob, readJobState, exportOutputPath } from "@/lib/export/exporter";

const PROJECT_FILE = path.join(process.cwd(), "data", "projects", "8TumD2bjHd.json");

async function main() {
  const project = JSON.parse(fs.readFileSync(PROJECT_FILE, "utf8")) as Project;
  const tracks = migrateTracks(project);
  const duration = tracksDuration(tracks);
  console.log(`Loaded project "${project.name}": ${duration.toFixed(1)}s, ${project.captions.length} captions`);

  // 0. local media analysis (motion, energy, beats) — the editor's eyes & ears
  const analyses: Record<string, MediaAnalysis | null> = {};
  for (const asset of project.media) {
    const t0 = Date.now();
    analyses[asset.id] = await analyzeAsset(asset.id, asset.filename, {
      hasAudio: asset.hasAudio,
      hasVideo: true,
      duration: asset.duration,
    });
    const a = analyses[asset.id];
    console.log(
      `Analysis ${asset.originalName}: ` +
        (a
          ? `energy=${a.audio?.energy.length ?? 0} motion=${a.video?.motion.length ?? 0} ` +
            `scenes=${a.video?.sceneChanges.length ?? 0} bpm=${a.audio?.bpm ?? "-"} (${Date.now() - t0}ms)`
          : "FAILED")
    );
  }
  const signals = buildTimelineSignals(tracks, project.media, analyses);
  if (!signals) throw new Error("no timeline signals");
  console.log(
    `Signals: ${signals.energy.length} energy bins, ${signals.motion.length} motion bins, ` +
      `${signals.sceneChanges.length} scene changes, ${signals.beats.length} beats, bpm=${signals.bpm ?? "-"}`
  );

  // 0b. highlights + dead space from signals
  const transcriptForHl = analyzeTranscript(project.captions);
  const highlights = detectHighlights({ signals, transcript: transcriptForHl, duration });
  console.log(`Highlights (${highlights.length}):`);
  highlights.forEach((h) => console.log(`  [${h.score}] ${h.time}s ${h.kind}: ${h.label}`));
  const dead = detectDeadSpace(signals);
  console.log(`Dead space: ${dead.length} ranges, ${dead.reduce((s, r) => s + r.end - r.start, 0).toFixed(1)}s total`);

  // 1. transcript analysis
  const transcript = analyzeTranscript(project.captions);
  console.log(`Transcript: ${transcript.words.length} words, ${transcript.sentences.length} sentences, pace ${transcript.averagePace}/s`);
  if (transcript.words.length === 0) throw new Error("transcript empty");

  // 2. hooks
  const hooks = detectHooks(transcript, 5);
  console.log(`Top hooks:`);
  hooks.forEach((h) => console.log(`  [${h.score}] ${h.startTime}-${h.endTime}s "${h.text}" (${h.reasons.join(", ")})`));

  // 3. best window
  const best = findBestWindow({ transcript, signals, duration }, 30);
  console.log(`Best 30s window: ${best?.start}–${best?.end} (score ${best?.score})`);

  // 3b. footage-only mode: recipe with NO transcript must still produce an edit
  const noSpeech = generateEditRecipe({
    projectId: project.id,
    transcript: analyzeTranscript([]),
    captions: [],
    signals,
    duration,
    style: "sports",
  });
  const noSpeechKept = noSpeech.keptRanges.reduce((s, r) => s + r.end - r.start, 0);
  console.log(
    `Footage-only recipe: ${noSpeech.cuts.length} cuts, ${noSpeech.zooms.length} zooms, ` +
      `${noSpeech.highlights?.length ?? 0} highlights, kept ${noSpeechKept.toFixed(1)}s/${duration.toFixed(1)}s`
  );
  console.log(`  Summary: ${noSpeech.reasoningSummary}`);
  if (noSpeech.keptRanges.length === 0 || noSpeechKept < 1) throw new Error("footage-only recipe empty");
  const noSpeechApplied = applyEditRecipeToTimeline(tracks, [], noSpeech);
  if (!noSpeechApplied) throw new Error("footage-only apply failed");

  // 3c. regenerate variation must differ deterministically, not explode
  const take2 = generateEditRecipe({
    projectId: project.id,
    transcript,
    captions: project.captions,
    signals,
    duration,
    style: "viral",
    seed: 1,
  });
  console.log(`Variation (seed=1): ${take2.zooms.length} zooms, ${take2.cuts.length} cuts`);

  // 4. recipe (signal-aware, main path)
  const recipe = generateEditRecipe({
    projectId: project.id,
    transcript,
    captions: project.captions,
    signals,
    duration,
    style: "viral",
  });
  console.log(`Recipe: ${recipe.cuts.length} cuts, ${recipe.zooms.length} zooms, ${recipe.overlays.length} overlays, ${recipe.highlights?.length ?? 0} highlights, kept ${recipe.keptRanges.length} ranges`);
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
