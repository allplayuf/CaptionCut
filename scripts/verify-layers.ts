/**
 * Verification of the layered export paths (dev tool):
 * b-roll video overlay, image overlay, sticker + text graphics, music with
 * fades, muted main audio — every filter-graph branch the auto-edit test
 * didn't hit. Run: npx tsx scripts/verify-layers.ts
 */
import fs from "fs";
import path from "path";
import type { MediaAsset, Project, Track } from "@/types";
import { migrateTracks, findTrack, tracksDuration } from "@/lib/timeline/tracks";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { buildExportRequest } from "@/lib/export/request";
import { startExportJob, readJobState, exportOutputPath } from "@/lib/export/exporter";

const PROJECTS_DIR = path.join(process.cwd(), "data", "projects");
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/** Newest saved project with clips and at least two video assets (b-roll source). */
function loadNewestProject(): Project {
  const projects = fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(PROJECTS_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Project);
  const match = projects.find(
    (p) =>
      p.media.filter((m) => (m.kind ?? "video") === "video").length >= 2 &&
      (p.tracks?.some((t) => t.clips.length > 0) || p.clips?.length)
  );
  if (!match) throw new Error("need a saved project with clips and 2+ videos in data/projects");
  return match;
}

/** Generate the synthetic overlay test assets if they're not on disk yet. */
async function ensureTestAssets(): Promise<void> {
  const img = path.join(MEDIA_DIR, "testimg01.png");
  if (!fs.existsSync(img)) {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=400x400:d=0.1", "-frames:v", "1", img], {});
  }
  const aud = path.join(MEDIA_DIR, "testaud01.mp3");
  if (!fs.existsSync(aud)) {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", "-q:a", "9", aud], {});
  }
}

async function main() {
  const project = loadNewestProject();
  await ensureTestAssets();
  const tracks: Track[] = migrateTracks(project);
  const duration = tracksDuration(tracks);
  console.log(`Base: ${duration.toFixed(1)}s, media: ${project.media.map((m) => m.filename).join(", ")}`);

  const testImage: MediaAsset = {
    id: "testimg01", filename: "testimg01.png", originalName: "test.png",
    mimeType: "image/png", size: 1000, duration: 0, width: 400, height: 400,
    fps: 0, hasAudio: false, kind: "image",
  };
  const testAudio: MediaAsset = {
    id: "testaud01", filename: "testaud01.mp3", originalName: "test.mp3",
    mimeType: "audio/mpeg", size: 80000, duration: 10, width: 0, height: 0,
    fps: 0, hasAudio: true, kind: "audio",
  };
  const media = [...project.media, testImage, testAudio];
  // Any second video works as b-roll (overlaying the main track with itself is fine too).
  const otherVideo = project.media.filter((m) => (m.kind ?? "video") === "video")[1];

  // b-roll overlay 2–5s with audible audio (exercises overlay + broll-audio mix)
  findTrack(tracks, "broll")!.clips.push({
    id: "vbroll", type: "broll", assetId: otherVideo.id,
    startTime: 2, endTime: 5, sourceStart: 1, sourceEnd: 4, volume: 0.5,
    transform: { opacity: 0.9 },
  });
  // image overlay 6–9s, off-center
  findTrack(tracks, "image")!.clips.push({
    id: "vimg", type: "image", assetId: testImage.id,
    startTime: 6, endTime: 9,
    transform: { x: 200, y: -300, scale: 0.4, rotation: 22, opacity: 0.55 },
  });
  // text + sticker
  findTrack(tracks, "text")!.clips.push({
    id: "vtext", type: "text", text: "LAYER TEST", startTime: 1, endTime: 4,
    transform: { x: 0, y: -500, scale: 1.1, rotation: -8, opacity: 0.65 },
    style: { fontFamily: "Arial", fontSize: 70, fontWeight: 900, color: "#FFFFFF", strokeColor: "#000000", strokeWidth: 6, backgroundColor: null },
  });
  findTrack(tracks, "sticker")!.clips.push({
    id: "vstick", type: "sticker", text: "🔥", startTime: 3, endTime: 6,
    transform: { x: -250, y: 300 }, style: { fontSize: 140 },
  });
  // music with fades
  findTrack(tracks, "music")!.clips.push({
    id: "vmusic", type: "music", assetId: testAudio.id,
    startTime: 0, endTime: 10, sourceStart: 0, sourceEnd: 10,
    volume: 0.3, fadeIn: 1, fadeOut: 1.5,
  });
  // zoom on top of all of it
  findTrack(tracks, "effects")!.clips.push({
    id: "vzoomfx", type: "effects", startTime: 7, endTime: 9.5,
    effect: { kind: "zoom", zoomScale: 1.2, anchorX: 0.5, anchorY: 0.45 },
  });
  // mute main audio to exercise that branch too
  findTrack(tracks, "video")!.muted = true;

  const request = buildExportRequest({
    media, tracks, captions: project.captions, style: project.style, presetId: "draft",
  });
  const imageOverlay = request.overlays?.find((overlay) => overlay.assetId === testImage.id);
  if (imageOverlay?.rotation !== 22 || imageOverlay.opacity !== 0.55) {
    throw new Error("image transform was lost while building the export request");
  }
  const textOverlay = request.textOverlays?.find((overlay) => overlay.text === "LAYER TEST");
  if (textOverlay?.rotation !== -8 || textOverlay.opacity !== 0.65) {
    throw new Error("text transform was lost while building the export request");
  }
  console.log(
    `Request: ${request.overlays?.length} overlays, ${request.audioClips?.length} audio clips, ` +
      `${request.textOverlays?.length} text/sticker, ${request.zooms?.length} zooms, mainMuted=${request.mainAudioMuted}`
  );

  const { state: job } = await startExportJob(request);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const state = await readJobState(job.id);
    if (!state) throw new Error("job state missing");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    process.stdout.write(`\r  progress ${(state.progress * 100).toFixed(0)}%  `);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("export timeout");
  }
  const out = exportOutputPath(job.id);
  console.log(`\nExport DONE: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
