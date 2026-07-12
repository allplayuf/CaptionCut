/**
 * Verification of the full effects pipeline (dev tool).
 * Run: npx tsx scripts/verify-effects.ts
 *
 * Renders a two-clip timeline exercising every effect stage through the real
 * exporter — animated slow zoom, constant punch zoom, handheld shake,
 * vignette, freeze frame, flash, per-clip blur-fit framing and deshake
 * stabilization — and checks the output dimensions and duration.
 */
import fs from "fs";
import path from "path";
import type { Caption, MediaAsset } from "@/types";
import { probeMedia } from "@/lib/server/ffmpeg";
import { exportOutputPath, readJobState, startExportJob } from "@/lib/export/exporter";
import type { ExportRequest } from "@/lib/export/request";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

async function main() {
  const files = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => /\.(mp4|mov|webm|m4v|mkv)$/i.test(f))
    .slice(0, 2);
  if (files.length === 0) throw new Error("no media files in data/media to test with");

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
  const m0 = media[0];
  const m1 = media[1] ?? media[0];

  // Clip 1 (0–3s): stabilized fill clip. Clip 2 (3–6s): blur-fit clip.
  const clips = [
    { id: "c0", mediaId: m0.id, sourceStart: 0, sourceEnd: Math.min(3, m0.duration), stabilize: true },
    { id: "c1", mediaId: m1.id, sourceStart: 0, sourceEnd: Math.min(3, m1.duration), fit: "fit" as const },
  ];
  const captions: Caption[] = [{ id: "cap1", startTime: 0.3, endTime: 2.2, text: "EFFECTS TEST" }];

  const req: ExportRequest = {
    media,
    clips,
    captions,
    style: {
      fontFamily: "Arial", fontSize: 64, fontWeight: 900, textColor: "#fff",
      backgroundColor: null, backgroundOpacity: 0.8, strokeColor: "#000",
      strokeWidth: 5, shadow: true, position: "bottom", allCaps: true, highlightColor: null,
    },
    zooms: [
      // Animated slow zoom crossing nothing; constant punch later.
      { start: 0.2, end: 1.4, scale: 1, endScale: 1.3, anchorX: 0.5, anchorY: 0.45 },
      { start: 3.4, end: 4.2, scale: 1.22, anchorX: 0.5, anchorY: 0.4 },
    ],
    shakes: [{ start: 1.6, end: 2.2, intensity: 0.7 }],
    vignettes: [{ start: 3.0, end: 5.6, strength: 0.6 }],
    freezes: [{ start: 4.6, end: 5.4 }],
    flashes: [{ start: 1.6, end: 1.95 }],
    presetId: "tiktok",
  };

  const job = startExportJob(req);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const state = readJobState(job.id);
    if (!state) throw new Error("job state lost");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    if (Date.now() - t0 > 5 * 60 * 1000) throw new Error("export timed out");
  }
  const out = exportOutputPath(job.id);
  const probe = await probeMedia(out);
  if (probe.width !== 1080 || probe.height !== 1920) {
    throw new Error(`expected 1080x1920, got ${probe.width}x${probe.height}`);
  }
  const expected = clips.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0);
  if (Math.abs(probe.duration - expected) > 0.25) {
    throw new Error(`expected ~${expected.toFixed(2)}s, got ${probe.duration.toFixed(2)}s`);
  }
  console.log(
    `  [effects] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
      `${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s ` +
      `(slow-zoom, punch, shake, vignette, freeze, flash, fit, stabilize)`
  );
  fs.rmSync(out, { force: true });
  fs.rmSync(path.join(path.dirname(out), `${job.id}.json`), { force: true });

  console.log("\nEFFECTS PIPELINE PASSED ✅");
}

main().catch((err) => {
  console.error("\nVERIFY FAILED ❌", err);
  process.exit(1);
});
