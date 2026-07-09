import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { Caption, CaptionStyle, Clip, ExportJobState, MediaAsset } from "@/types";
import { EXPORTS_DIR, MEDIA_DIR, TMP_DIR, ensureDataDirs, safeId } from "@/lib/server/paths";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { totalDuration } from "@/lib/video/timeline";
import { buildAss } from "./ass";

/**
 * Export pipeline: trims each clip, scales/crops everything to 1080x1920
 * (cover-crop, matching the preview's object-fit: cover), concatenates the
 * clips, burns the captions in with libass, and encodes H.264 at a
 * TikTok-friendly bitrate.
 *
 * Job state is persisted to data/exports/<id>.json (not kept in module memory)
 * so status polling works reliably across Next.js dev-server module instances.
 */

export interface ExportRequest {
  media: MediaAsset[];
  clips: Clip[];
  captions: Caption[];
  style: CaptionStyle;
}

const OUTPUT_FPS = 30;

export function startExportJob(req: ExportRequest): ExportJobState {
  ensureDataDirs();
  const jobId = nanoid(10);
  const state: ExportJobState = { id: jobId, status: "processing", progress: 0 };
  writeJobState(state);

  // Fire and forget; the client polls /api/export/[jobId] for progress.
  runExport(jobId, req).catch((err) => {
    writeJobState({
      id: jobId,
      status: "error",
      progress: 0,
      error: friendlyExportError(err),
    });
  });

  return state;
}

export function readJobState(jobId: string): ExportJobState | null {
  const file = path.join(EXPORTS_DIR, `${safeId(jobId)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExportJobState;
  } catch {
    return null;
  }
}

export function exportOutputPath(jobId: string): string {
  return path.join(EXPORTS_DIR, `${safeId(jobId)}.mp4`);
}

async function runExport(jobId: string, req: ExportRequest): Promise<void> {
  const { media, clips, captions, style } = req;
  if (clips.length === 0) throw new Error("NO_CLIPS");

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const outDuration = totalDuration(clips);
  if (outDuration <= 0) throw new Error("NO_CLIPS");

  const jobDir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    // Unique input files, in first-use order.
    const inputIds = [...new Set(clips.map((c) => c.mediaId))];
    const inputIndex = new Map(inputIds.map((id, i) => [id, i]));
    const inputArgs = inputIds.flatMap((id) => {
      const asset = mediaById.get(id);
      if (!asset) throw new Error("MEDIA_MISSING");
      const file = path.join(MEDIA_DIR, asset.filename);
      if (!fs.existsSync(file)) throw new Error("MEDIA_MISSING");
      return ["-i", file];
    });

    const filters: string[] = [];
    clips.forEach((clip, i) => {
      const asset = mediaById.get(clip.mediaId)!;
      const idx = inputIndex.get(clip.mediaId)!;
      const start = clip.sourceStart.toFixed(3);
      const end = clip.sourceEnd.toFixed(3);
      const dur = (clip.sourceEnd - clip.sourceStart).toFixed(3);

      filters.push(
        `[${idx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,` +
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
          `setsar=1,fps=${OUTPUT_FPS}[v${i}]`
      );
      if (asset.hasAudio) {
        filters.push(
          `[${idx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,` +
            `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`
        );
      } else {
        // Silent clips still need an audio stream so concat timing stays aligned.
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=start=0:end=${dur},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
    });

    const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join("");
    filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[vcat][aout]`);

    if (captions.length > 0) {
      // subs.ass is referenced relative to the job dir (ffmpeg cwd) to dodge
      // Windows drive-letter escaping issues in the subtitles filter.
      fs.writeFileSync(path.join(jobDir, "subs.ass"), buildAss(captions, style), "utf8");
      filters.push(`[vcat]subtitles=filename=subs.ass[vout]`);
    } else {
      filters.push(`[vcat]null[vout]`);
    }

    const outPath = exportOutputPath(jobId);
    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-profile:v", "high",
      "-level", "4.2",
      "-crf", "19",
      "-maxrate", "10M",
      "-bufsize", "16M",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ];

    let lastWrite = 0;
    await runFfmpeg(args, {
      cwd: jobDir,
      totalDuration: outDuration,
      timeoutMs: 30 * 60 * 1000,
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastWrite > 400) {
          lastWrite = now;
          writeJobState({ id: jobId, status: "processing", progress: fraction });
        }
      },
    });

    writeJobState({ id: jobId, status: "done", progress: 1 });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

function writeJobState(state: ExportJobState): void {
  const file = path.join(EXPORTS_DIR, `${state.id}.json`);
  fs.writeFileSync(file, JSON.stringify(state), "utf8");
}

function friendlyExportError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("NO_CLIPS")) return "There is nothing on the timeline to export.";
  if (message.includes("MEDIA_MISSING"))
    return "A source video file is missing. Re-upload it and try again.";
  if (message.includes("timed out")) return "Export took too long and was stopped. Try a shorter video.";
  return "Export failed while rendering the video. Try again, or try a shorter/smaller video.";
}
