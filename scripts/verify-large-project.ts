/**
 * Stress verification for the 30+ source workflow.
 *
 * Exercises caption batch planning across a long timeline, then renders a
 * real 36-source draft with burned captions and intentional punch zooms.
 */
import fs from "fs";
import path from "path";
import type { Caption, Clip, MediaAsset } from "@/types";
import { probeMedia } from "@/lib/server/ffmpeg";
import { exportOutputPath, readJobState, startExportJob } from "@/lib/export/exporter";
import type { ExportRequest } from "@/lib/export/request";
import { planCaptionAudioBatches } from "@/lib/transcription/browserWhisper";

const SOURCE_COUNT = 36;
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

function verifyCaptionBatchPlanning(): void {
  const clips: Clip[] = Array.from({ length: SOURCE_COUNT }, (_, index) => ({
    id: `captionclip${String(index).padStart(2, "0")}`,
    mediaId: `captionmedia${String(index).padStart(2, "0")}`,
    sourceStart: 0,
    sourceEnd: 20,
  }));
  const batches = planCaptionAudioBatches(clips, undefined, 180);
  if (batches.length !== 4) throw new Error(`expected 4 caption batches, got ${batches.length}`);
  let cursor = 0;
  let slices = 0;
  for (const batch of batches) {
    if (Math.abs(batch.start - cursor) > 0.002) throw new Error("caption batches contain a gap");
    if (batch.end - batch.start > 210.002) throw new Error("caption batch exceeds memory ceiling");
    cursor = batch.end;
    slices += batch.slices.length;
  }
  if (Math.abs(cursor - 720) > 0.002 || slices < SOURCE_COUNT) {
    throw new Error("caption batch planning lost timeline coverage");
  }
}

async function main(): Promise<void> {
  verifyCaptionBatchPlanning();

  const filename = fs
    .readdirSync(MEDIA_DIR)
    .find((file) => /\.(mp4|mov|webm|m4v|mkv)$/i.test(file));
  if (!filename) throw new Error("no local video in data/media for large-project verification");
  const source = await probeMedia(path.join(MEDIA_DIR, filename));
  if (source.duration < 0.3) throw new Error("test source is too short");

  const media: MediaAsset[] = Array.from({ length: SOURCE_COUNT }, (_, index) => ({
    id: `bulkmedia${String(index).padStart(2, "0")}`,
    filename,
    originalName: `Camera ${index + 1}.mp4`,
    mimeType: "video/mp4",
    size: 0,
    duration: source.duration,
    width: source.width,
    height: source.height,
    fps: source.fps,
    hasAudio: source.hasAudio,
    kind: "video",
  }));
  const clipLength = 0.25;
  const sourceWindow = Math.max(0.001, source.duration - clipLength);
  const clips: Clip[] = media.map((asset, index) => {
    const sourceStart = (index * 0.11) % sourceWindow;
    return {
      id: `bulkclip${String(index).padStart(2, "0")}`,
      mediaId: asset.id,
      sourceStart,
      sourceEnd: sourceStart + clipLength,
    };
  });
  const duration = SOURCE_COUNT * clipLength;
  const captions: Caption[] = Array.from({ length: 9 }, (_, index) => ({
    id: `bulkcaption${index}`,
    startTime: index,
    endTime: Math.min(duration, index + 0.82),
    text: `SOURCE ${index * 4 + 1} TO ${Math.min(SOURCE_COUNT, index * 4 + 4)}`,
  }));

  const request: ExportRequest = {
    media,
    clips,
    captions,
    style: {
      fontFamily: "Arial",
      fontSize: 64,
      fontWeight: 900,
      textColor: "#FFFFFF",
      backgroundColor: null,
      backgroundOpacity: 0.8,
      strokeColor: "#000000",
      strokeWidth: 5,
      shadow: true,
      position: "bottom",
      allCaps: true,
      highlightColor: "#7CE7D4",
    },
    zooms: Array.from({ length: 9 }, (_, index) => ({
      start: index + 0.08,
      end: index + 0.55,
      scale: index % 2 === 0 ? 1.12 : 1,
      endScale: index % 2 === 0 ? undefined : 1.1,
      easing: "smooth" as const,
      anchorX: 0.5,
      anchorY: 0.44,
    })),
    presetId: "draft",
  };

  const { state: job } = await startExportJob(request);
  const startedAt = Date.now();
  let lastProgress = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await readJobState(job.id);
    if (!state) throw new Error("large-project export job state disappeared");
    if (state.progress + 0.0001 < lastProgress) throw new Error("export progress moved backwards");
    lastProgress = state.progress;
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`large-project export failed: ${state.error}`);
    if (Date.now() - startedAt > 10 * 60 * 1000) throw new Error("large-project export timed out");
  }

  const output = exportOutputPath(job.id);
  const result = await probeMedia(output);
  if (result.width !== 720 || result.height !== 1280) {
    throw new Error(`expected 720x1280 output, got ${result.width}x${result.height}`);
  }
  if (Math.abs(result.duration - duration) > 0.3) {
    throw new Error(`expected ${duration.toFixed(2)}s, got ${result.duration.toFixed(2)}s`);
  }
  if (fs.statSync(output).size < 100_000) throw new Error("large-project output is unexpectedly small");

  fs.rmSync(output, { force: true });
  fs.rmSync(path.join(path.dirname(output), `${job.id}.json`), { force: true });
  console.log(
    `Large-project checks passed: ${SOURCE_COUNT} sources, ${clips.length} clips, ` +
      `${captions.length} caption blocks, ${request.zooms?.length ?? 0} zooms, ` +
      `${result.width}x${result.height} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
