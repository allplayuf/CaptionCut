import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { ExportJobState, MediaAsset } from "@/types";
import { EXPORTS_DIR, MEDIA_DIR, TMP_DIR, ensureDataDirs, safeId } from "@/lib/server/paths";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { totalDuration } from "@/lib/video/timeline";
import { buildAss } from "./ass";
import { getExportPreset } from "./presets";
import type { ExportRequest, ZoomPayload } from "./request";

export type { ExportRequest } from "./request";

/**
 * Export pipeline: trims each main-track clip, scales/crops to 9:16
 * (cover-crop, matching the preview), concatenates, then layers on the rest
 * of the project — punch-in zooms (segment-wise scale+crop), b-roll/image
 * overlays, music/sfx/voice mix-down with volume+fades, and finally burns
 * captions + text graphics in with libass. Encoded per export preset.
 *
 * Job state is persisted to data/exports/<id>.json (not kept in module memory)
 * so status polling works reliably across Next.js dev-server module instances.
 */

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const MAX_ZOOM_SEGMENTS = 80;

export function startExportJob(req: ExportRequest): ExportJobState {
  ensureDataDirs();
  const jobId = nanoid(10);
  const state: ExportJobState = { id: jobId, status: "processing", progress: 0 };
  writeJobState(state);

  // Fire and forget; the client polls /api/export/[jobId] for progress.
  runExport(jobId, req).catch((err) => {
    console.error(`export ${jobId} failed:`, err);
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

  const preset = getExportPreset(req.presetId);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const outDuration = totalDuration(clips);
  if (outDuration <= 0) throw new Error("NO_CLIPS");

  const jobDir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const assetFile = (id: string): { asset: MediaAsset; file: string } => {
      const asset = mediaById.get(id);
      if (!asset) throw new Error("MEDIA_MISSING");
      const file = path.join(MEDIA_DIR, asset.filename);
      if (!fs.existsSync(file)) throw new Error("MEDIA_MISSING");
      return { asset, file };
    };

    /* ---------------- inputs ---------------- */
    // Main-track media first (unique), then one input per overlay/audio clip.
    const inputArgs: string[] = [];
    let inputCount = 0;

    const mainIds = [...new Set(clips.map((c) => c.mediaId))];
    const mainInputIndex = new Map<string, number>();
    for (const id of mainIds) {
      const { file } = assetFile(id);
      inputArgs.push("-i", file);
      mainInputIndex.set(id, inputCount++);
    }

    const overlays = (req.overlays ?? []).filter((o) => o.end > o.start);
    const overlayInputIndex: number[] = [];
    for (const ov of overlays) {
      const { file } = assetFile(ov.assetId);
      if (ov.kind === "image") {
        inputArgs.push("-loop", "1", "-t", (ov.end - ov.start + 0.5).toFixed(3), "-i", file);
      } else {
        inputArgs.push("-i", file);
      }
      overlayInputIndex.push(inputCount++);
    }

    const audioClips = (req.audioClips ?? []).filter((a) => a.end > a.start);
    const audioInputIndex: number[] = [];
    for (const a of audioClips) {
      const { file } = assetFile(a.assetId);
      inputArgs.push("-i", file);
      audioInputIndex.push(inputCount++);
    }

    /* ---------------- main track: trim + concat ---------------- */
    const filters: string[] = [];
    clips.forEach((clip, i) => {
      const asset = mediaById.get(clip.mediaId)!;
      const idx = mainInputIndex.get(clip.mediaId)!;
      const start = clip.sourceStart.toFixed(3);
      const end = clip.sourceEnd.toFixed(3);
      const dur = (clip.sourceEnd - clip.sourceStart).toFixed(3);

      filters.push(
        `[${idx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,` +
          `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H},` +
          `setsar=1,fps=${preset.fps}[v${i}]`
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
    filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[vcat][acat]`);

    /* ---------------- punch-in zooms (segment-wise) ---------------- */
    let videoLabel = "vcat";
    const zoomSegments = buildZoomSegments(req.zooms ?? [], outDuration);
    if (zoomSegments.length > 1 || (zoomSegments.length === 1 && zoomSegments[0].zoom)) {
      const n = zoomSegments.length;
      filters.push(`[${videoLabel}]split=${n}${zoomSegments.map((_, i) => `[zs${i}]`).join("")}`);
      zoomSegments.forEach((seg, i) => {
        let chain = `trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS`;
        if (seg.zoom) {
          const k = seg.zoom.scale;
          const ax = seg.zoom.anchorX.toFixed(3);
          const ay = seg.zoom.anchorY.toFixed(3);
          chain +=
            `,scale=trunc(iw*${k.toFixed(4)}/2)*2:trunc(ih*${k.toFixed(4)}/2)*2,` +
            `crop=${CANVAS_W}:${CANVAS_H}:trunc((iw-${CANVAS_W})*${ax}):trunc((ih-${CANVAS_H})*${ay}),` +
            `setsar=1`;
        }
        filters.push(`[zs${i}]${chain}[zseg${i}]`);
      });
      filters.push(
        `${zoomSegments.map((_, i) => `[zseg${i}]`).join("")}concat=n=${n}:v=1:a=0[vzoom]`
      );
      videoLabel = "vzoom";
    }

    /* ---------------- b-roll / image overlays ---------------- */
    overlays.forEach((ov, i) => {
      const idx = overlayInputIndex[i];
      const dur = ov.end - ov.start;
      const alpha =
        ov.opacity < 0.999 ? `,format=rgba,colorchannelmixer=aa=${ov.opacity.toFixed(3)}` : "";

      let x = "0";
      let y = "0";
      if (ov.kind === "broll") {
        const ss = (ov.sourceStart ?? 0).toFixed(3);
        const se = ((ov.sourceStart ?? 0) + dur).toFixed(3);
        filters.push(
          `[${idx}:v]trim=start=${ss}:end=${se},setpts=PTS-STARTPTS+${ov.start.toFixed(3)}/TB,` +
            `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H},` +
            `setsar=1,fps=${preset.fps}${alpha}[ov${i}]`
        );
      } else {
        const w = Math.max(2, Math.round((CANVAS_W * ov.widthFrac) / 2) * 2);
        filters.push(
          `[${idx}:v]scale=${w}:-2,setsar=1${alpha},setpts=PTS-STARTPTS+${ov.start.toFixed(3)}/TB[ov${i}]`
        );
        x = `(W-w)/2+(${Math.round(ov.x)})`;
        y = `(H-h)/2+(${Math.round(ov.y)})`;
      }
      filters.push(
        `[${videoLabel}][ov${i}]overlay=x='${x}':y='${y}':enable='between(t,${ov.start.toFixed(3)},${ov.end.toFixed(3)})':eof_action=pass[base${i}]`
      );
      videoLabel = `base${i}`;
    });

    /* ---------------- captions + text graphics (libass) ---------------- */
    const textOverlays = req.textOverlays ?? [];
    if (captions.length > 0 || textOverlays.length > 0) {
      // subs.ass is referenced relative to the job dir (ffmpeg cwd) to dodge
      // Windows drive-letter escaping issues in the subtitles filter.
      fs.writeFileSync(path.join(jobDir, "subs.ass"), buildAss(captions, style, textOverlays), "utf8");
      filters.push(`[${videoLabel}]subtitles=filename=subs.ass[vsub]`);
      videoLabel = "vsub";
    }

    /* ---------------- final scale for non-native presets ---------------- */
    if (preset.width !== CANVAS_W || preset.height !== CANVAS_H) {
      filters.push(`[${videoLabel}]scale=${preset.width}:${preset.height}[vout]`);
    } else {
      filters.push(`[${videoLabel}]null[vout]`);
    }

    /* ---------------- audio mix ---------------- */
    let mainAudio = "acat";
    if (req.mainAudioMuted) {
      filters.push(`[acat]volume=0[acatm]`);
      mainAudio = "acatm";
    }
    if (audioClips.length > 0) {
      audioClips.forEach((a, i) => {
        const idx = audioInputIndex[i];
        const dur = a.end - a.start;
        const ss = a.sourceStart.toFixed(3);
        const se = (a.sourceStart + dur).toFixed(3);
        let chain =
          `[${idx}:a]atrim=start=${ss}:end=${se},asetpts=PTS-STARTPTS,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `volume=${Math.max(0, Math.min(2, a.volume)).toFixed(3)}`;
        if (a.fadeIn && a.fadeIn > 0.01) chain += `,afade=t=in:st=0:d=${a.fadeIn.toFixed(2)}`;
        if (a.fadeOut && a.fadeOut > 0.01) {
          chain += `,afade=t=out:st=${Math.max(0, dur - a.fadeOut).toFixed(3)}:d=${a.fadeOut.toFixed(2)}`;
        }
        const delayMs = Math.max(0, Math.round(a.start * 1000));
        chain += `,adelay=${delayMs}|${delayMs}[aud${i}]`;
        filters.push(chain);
      });
      filters.push(
        `[${mainAudio}]${audioClips.map((_, i) => `[aud${i}]`).join("")}amix=inputs=${
          audioClips.length + 1
        }:duration=first:normalize=0[aout]`
      );
    } else {
      filters.push(`[${mainAudio}]anull[aout]`);
    }

    /* ---------------- encode ---------------- */
    const outPath = exportOutputPath(jobId);
    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-t", outDuration.toFixed(3),
      "-c:v", "libx264",
      "-preset", preset.x264Preset,
      "-profile:v", "high",
      "-level", "4.2",
      "-crf", String(preset.crf),
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

interface ZoomSegment {
  start: number;
  end: number;
  zoom: ZoomPayload | null;
}

/** Partition [0, duration] into plain/zoomed segments (zooms are hard punch-ins). */
function buildZoomSegments(zooms: ZoomPayload[], duration: number): ZoomSegment[] {
  const valid = zooms
    .map((z) => ({
      ...z,
      start: Math.max(0, Math.min(duration, z.start)),
      end: Math.max(0, Math.min(duration, z.end)),
    }))
    .filter((z) => z.end - z.start > 0.05 && z.scale > 1.001)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ZOOM_SEGMENTS / 2);

  const segments: ZoomSegment[] = [];
  let cursor = 0;
  for (const z of valid) {
    if (z.start < cursor) continue; // overlapping zoom — earlier one wins
    if (z.start > cursor + 0.01) segments.push({ start: cursor, end: z.start, zoom: null });
    segments.push({ start: z.start, end: z.end, zoom: z });
    cursor = z.end;
  }
  if (cursor < duration - 0.01) segments.push({ start: cursor, end: duration, zoom: null });
  return segments.length > 0 ? segments : [{ start: 0, end: duration, zoom: null }];
}

function writeJobState(state: ExportJobState): void {
  const file = path.join(EXPORTS_DIR, `${state.id}.json`);
  fs.writeFileSync(file, JSON.stringify(state), "utf8");
}

function friendlyExportError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("NO_CLIPS")) return "There is nothing on the timeline to export.";
  if (message.includes("MEDIA_MISSING"))
    return "A source media file is missing. Re-upload it and try again.";
  if (message.includes("timed out")) return "Export took too long and was stopped. Try a shorter video.";
  return "Export failed while rendering the video. Try again, or try a shorter/smaller video.";
}
