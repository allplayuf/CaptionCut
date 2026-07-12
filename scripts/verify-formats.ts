/**
 * Verification of the non-9:16 export formats (dev tool).
 * Run: npx tsx scripts/verify-formats.ts
 *
 * Renders a short two-clip timeline with captions, a text overlay and a
 * punch-zoom through the real exporter for every export preset, and checks
 * the output dimensions and duration.
 */
import fs from "fs";
import path from "path";
import type { Caption, MediaAsset } from "@/types";
import { probeMedia } from "@/lib/server/ffmpeg";
import { EXPORT_PRESETS } from "@/lib/export/presets";
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

  const clips = media.map((m, i) => ({
    id: `c${i}`,
    mediaId: m.id,
    sourceStart: 0,
    sourceEnd: Math.min(3, m.duration),
  }));
  const captions: Caption[] = [
    { id: "cap1", startTime: 0.3, endTime: 2.2, text: "WHAT A GOAL" },
    { id: "cap2", startTime: 2.4, endTime: 4.5, text: "Scenes at the park" },
  ];

  for (const preset of EXPORT_PRESETS) {
    const req: ExportRequest = {
      media,
      clips,
      captions,
      style: {
        fontFamily: "Arial", fontSize: 64, fontWeight: 900, textColor: "#fff",
        backgroundColor: null, backgroundOpacity: 0.8, strokeColor: "#000",
        strokeWidth: 5, shadow: true, position: "bottom", allCaps: true, highlightColor: null,
      },
      textOverlays: [
        {
          text: "Pull up. Play.", start: 0.2, end: 2.0, x: 0, y: -520,
          fontFamily: "Arial", fontSize: 64, fontWeight: 900, color: "#FFFFFF",
          strokeColor: "#000000", strokeWidth: 5, backgroundColor: null,
        },
      ],
      zooms: [{ start: 1.0, end: 2.2, scale: 1.2, anchorX: 0.5, anchorY: 0.45 }],
      presetId: preset.id,
    };

    const job = startExportJob(req);
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const state = readJobState(job.id);
      if (!state) throw new Error(`${preset.id}: job state lost`);
      if (state.status === "done") break;
      if (state.status === "error") throw new Error(`${preset.id}: export failed: ${state.error}`);
      if (Date.now() - t0 > 3 * 60 * 1000) throw new Error(`${preset.id}: export timed out`);
    }
    const out = exportOutputPath(job.id);
    const probe = await probeMedia(out);
    if (probe.width !== preset.width || probe.height !== preset.height) {
      throw new Error(
        `${preset.id}: expected ${preset.width}x${preset.height}, got ${probe.width}x${probe.height}`
      );
    }
    console.log(
      `  [${preset.id}] OK in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
        `${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s`
    );
    fs.rmSync(out, { force: true });
    fs.rmSync(path.join(path.dirname(out), `${job.id}.json`), { force: true });
  }

  console.log("\nALL FORMATS PASSED ✅");
}

main().catch((err) => {
  console.error("\nVERIFY FAILED ❌", err);
  process.exit(1);
});
