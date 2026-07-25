import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { ExportJobState, MediaAnalysis, MediaAsset } from "@/types";
import { ANALYSIS_DIR, EXPORTS_DIR, MEDIA_DIR, TMP_DIR, ensureDataDirs, safeId } from "@/lib/server/paths";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { materializeMedia } from "@/lib/server/media";
import { clipSpeed, totalDuration } from "@/lib/video/timeline";
import { buildAss } from "./ass";
import { getExportPreset } from "./presets";
import type { ExportRequest, FreezePayload, ShakePayload, VignettePayload, ZoomPayload } from "./request";

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

/** Reference canvas the editor lays overlays out on (preview geometry). */
const REF_W = 1080;
const REF_H = 1920;
const MAX_ZOOM_SEGMENTS = 80;

/**
 * One-pass loudness normalization to the -14 LUFS short-form standard
 * (TikTok/Reels/Shorts). Evens out phone clips shot at different distances
 * and keeps the platform's own normalization from crushing the mix.
 */
const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000";

export async function startExportJob(
  req: ExportRequest
): Promise<{ state: ExportJobState; task: Promise<void> }> {
  ensureDataDirs();
  const jobId = nanoid(10);
  const state: ExportJobState = { id: jobId, status: "processing", progress: 0 };
  await writeJobState(state);

  const task = runExport(jobId, req).catch(async (err) => {
    console.error(`export ${jobId} failed:`, err);
    await writeJobState({
      id: jobId,
      status: "error",
      progress: 0,
      error: friendlyExportError(err),
    });
  });

  return { state, task };
}

export async function readJobState(jobId: string): Promise<ExportJobState | null> {
  const id = safeId(jobId);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { get } = await import("@vercel/blob");
    const result = await get(`exports/${id}.json`, { access: "public", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as ExportJobState;
  }
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
  // Composition canvas: crops, overlays and subtitles are laid out at this
  // size, then (for the draft preset) scaled down to the output dimensions.
  const CW = preset.canvasWidth;
  const CH = preset.canvasHeight;
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const outDuration = totalDuration(clips);
  if (outDuration <= 0) throw new Error("NO_CLIPS");

  const jobDir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const usedIds = new Set([
      ...clips.map((clip) => clip.mediaId),
      ...clips.flatMap((clip) => {
        const linkedId = mediaById.get(clip.mediaId)?.linkedAudio?.audioAssetId;
        return linkedId ? [linkedId] : [];
      }),
      ...(req.overlays ?? []).map((overlay) => overlay.assetId),
      ...(req.audioClips ?? []).map((audio) => audio.assetId),
    ]);
    const localFiles = new Map<string, string>();
    await Promise.all(
      [...usedIds].map(async (id) => {
        const asset = mediaById.get(id);
        if (!asset) throw new Error("MEDIA_MISSING");
        localFiles.set(id, await materializeMedia(asset));
      })
    );

    const assetFile = (id: string): { asset: MediaAsset; file: string } => {
      const asset = mediaById.get(id);
      if (!asset) throw new Error("MEDIA_MISSING");
      const file = localFiles.get(id) ?? path.join(MEDIA_DIR, asset.filename);
      if (!fs.existsSync(file)) throw new Error("MEDIA_MISSING");
      return { asset, file };
    };

    /* ---------------- inputs ---------------- */
    // Main-track media first (unique), then one input per overlay/audio clip.
    const inputArgs: string[] = [];
    let inputCount = 0;

    const mainIds = [
      ...new Set(
        clips.flatMap((clip) => {
          const linkedId = mediaById.get(clip.mediaId)?.linkedAudio?.audioAssetId;
          return linkedId ? [clip.mediaId, linkedId] : [clip.mediaId];
        })
      ),
    ];
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

    /* ---------------- main track: (clip × effect) pieces + one concat ----------------
       The timeline is partitioned so every piece is either fully inside or
       fully outside each zoom/shake/vignette/freeze window, and each piece
       trims straight from its source input with its effects applied inline.
       One flat concat — no split/trim/concat fan-out, which deadlocks
       ffmpeg's filter scheduler on longer graphs. */
    const pieces = buildPieces(
      clips,
      req.zooms ?? [],
      req.freezes ?? [],
      req.shakes ?? [],
      req.vignettes ?? [],
      outDuration
    );
    const filters: string[] = [];
    pieces.forEach((piece, i) => {
      const asset = mediaById.get(piece.clip.mediaId)!;
      const idx = mainInputIndex.get(piece.clip.mediaId)!;
      const start = piece.srcStart.toFixed(3);
      const end = piece.srcEnd.toFixed(3);
      const speed = clipSpeed(piece.clip);
      const speedV = speed !== 1 ? `/${speed.toFixed(4)}` : "";
      const fitMode = piece.clip.fit === "fit";
      // Shake reduction: deshake the raw segment, then a slight over-zoom
      // after the canvas crop hides the mirrored border compensation.
      // (Skipped on freeze pieces — a single cloned frame has no shake.)
      const stab = Boolean(piece.clip.stabilize) && piece.freezeSrc === null;
      const deshake = stab ? `,deshake=rx=32:ry=32:edge=mirror` : "";

      /**
       * Canvas framing from a trimmed piece-local stream:
       *  fill — cover-scale + smart crop (the classic path);
       *  fit  — blurred cover copy behind the letterboxed full frame.
       * Returns the filter-chain suffix; fit mode pushes its side chains.
       */
      const frameToCanvas = (streamIn: string, srcA: number, srcB: number): string => {
        const smart = smartCropOffset(
          asset,
          { mediaId: piece.clip.mediaId, sourceStart: srcA, sourceEnd: srcB },
          CW,
          CH
        );
        if (!fitMode) {
          return (
            `${streamIn}` +
            `scale=${CW}:${CH}:force_original_aspect_ratio=increase,` +
            `crop=${CW}:${CH}${smart}` +
            (stab ? `,scale=trunc(iw*1.03/2)*2:trunc(ih*1.03/2)*2,crop=${CW}:${CH}` : "") +
            `,setsar=1`
          );
        }
        // fit: split into blurred background fill + letterboxed foreground.
        filters.push(`${streamIn}split=2[pa${i}][pb${i}]`);
        filters.push(
          `[pb${i}]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},` +
            `boxblur=luma_radius=24:luma_power=2:chroma_radius=12:chroma_power=2,setsar=1[pbg${i}]`
        );
        filters.push(
          `[pa${i}]scale=${CW}:${CH}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[pfg${i}]`
        );
        return `[pbg${i}][pfg${i}]overlay=x=(W-w)/2:y=(H-h)/2:format=yuv420` + (stab ? `,scale=trunc(iw*1.03/2)*2:trunc(ih*1.03/2)*2,crop=${CW}:${CH},setsar=1` : "");
      };

      // fps is normalized BEFORE any split so the blur-fit overlay's two
      // branches stay frame-aligned (a post-overlay fps drops a frame).
      let chain: string;
      if (piece.freezeSrc !== null) {
        // Freeze-frame piece: clone one frame for the piece's whole duration.
        const f0 = piece.freezeSrc.toFixed(3);
        const f1 = (piece.freezeSrc + 0.12).toFixed(3);
        const dur = piece.outDur.toFixed(3);
        chain =
          frameToCanvas(
            `[${idx}:v]trim=start=${f0}:end=${f1},setpts=PTS-STARTPTS,fps=${preset.fps},`,
            piece.freezeSrc,
            piece.freezeSrc + 0.12
          ) + `,tpad=stop_mode=clone:stop_duration=${dur},trim=start=0:end=${dur},setpts=PTS-STARTPTS`;
      } else {
        chain = frameToCanvas(
          `[${idx}:v]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)${speedV}${deshake},fps=${preset.fps},`,
          piece.srcStart,
          piece.srcEnd
        );
      }

      /* effect stages — each expression uses window-relative time (t + off)
         so ramps and jitter stay continuous across clip boundaries */
      if (piece.zoom) {
        const z = piece.zoom;
        const ax = z.anchorX.toFixed(3);
        const ay = z.anchorY.toFixed(3);
        const k0 = Math.max(1, z.scale);
        const k1 = z.endScale !== undefined ? Math.max(1, z.endScale) : k0;
        if (Math.abs(k1 - k0) < 0.005) {
          // Constant punch: plain over-scale + anchored crop.
          chain +=
            `,scale=trunc(iw*${k0.toFixed(4)}/2)*2:trunc(ih*${k0.toFixed(4)}/2)*2,` +
            `crop=${CW}:${CH}:trunc((iw-${CW})*${ax}):trunc((ih-${CH})*${ay}),` +
            `setsar=1`;
        } else {
          // Animated ramp: 2x over-sample + zoompan for sub-pixel smoothness.
          const off = Math.max(0, piece.tlStart - z.start).toFixed(4);
          const dur = Math.max(0.05, z.end - z.start).toFixed(4);
          const rawP = `min(max((it+${off})/${dur},0),1)`;
          const easedP =
            z.easing === "linear"
              ? rawP
              : z.easing === "snappy"
                ? `(1-pow(1-(${rawP}),3))`
                : `((${rawP})*(${rawP})*(3-2*(${rawP})))`;
          const zExpr = `max(1,${k0.toFixed(4)}+(${k1.toFixed(4)}-${k0.toFixed(4)})*${easedP})`;
          chain +=
            `,scale=${CW * 2}:${CH * 2},` +
            `zoompan=z='${zExpr}':x='(iw-iw/zoom)*${ax}':y='(ih-ih/zoom)*${ay}':d=1:s=${CW}x${CH}:fps=${preset.fps},` +
            `setsar=1`;
        }
      }
      if (piece.shake) {
        // Mirrors shakeOffset() in lib/timeline/tracks.ts exactly (amplitudes
        // scaled from the 1080x1920 reference to this canvas). The crop window
        // moves opposite to the content shift, hence the minus.
        const s = piece.shake;
        const axp = ((18 * s.intensity * CW) / REF_W).toFixed(3);
        const ayp = ((18 * s.intensity * CH) / REF_H).toFixed(3);
        const off = Math.max(0, piece.tlStart - s.start).toFixed(4);
        const T = `(t+${off})`;
        const dur = Math.max(0.05, s.end - s.start).toFixed(4);
        const envelope = `min(1,min(max(0,${T}/0.06),max(0,(${dur}-${T})/0.12)))`;
        const jx = `${axp}*${envelope}*(0.62*sin(2*PI*8.3*${T})+0.38*sin(2*PI*3.4*${T}+1.7))`;
        const jy = `${ayp}*${envelope}*(0.55*sin(2*PI*7.1*${T}+0.9)+0.45*sin(2*PI*2.8*${T}+2.3))`;
        chain +=
          `,scale=trunc(iw*1.06/2)*2:trunc(ih*1.06/2)*2,` +
          `crop=${CW}:${CH}:x='max(0,min(iw-${CW},(iw-${CW})/2-(${jx})))':y='max(0,min(ih-${CH},(ih-${CH})/2-(${jy})))',` +
          `setsar=1`;
      }
      if (piece.vign) {
        // Vignette + slight punch — the preview mirrors this with a radial
        // gradient and a matching CSS contrast/saturation filter.
        const angle = (Math.PI / 6 + piece.vign.strength * (Math.PI / 3 - Math.PI / 6)).toFixed(4);
        chain += `,vignette=angle=${angle},eq=contrast=1.05:saturation=1.12`;
      }
      filters.push(`${chain}[v${i}]`);

      const outDur = piece.outDur.toFixed(3);
      const silenceFor = (duration: string, label: string) =>
        `anullsrc=r=48000:cl=stereo,atrim=start=0:end=${duration},asetpts=PTS-STARTPTS[${label}]`;
      const silence = (label: string) => silenceFor(outDur, label);

      if (piece.freezeSrc !== null) {
        // Freeze pieces silence every source-level main audio stream.
        filters.push(silence(`a${i}`));
      } else {
        const tempo = speed !== 1 ? `,atempo=${speed.toFixed(4)}` : "";
        const pair = asset.linkedAudio;
        const pairAsset = pair ? mediaById.get(pair.audioAssetId) : undefined;
        const pairIdx = pair ? mainInputIndex.get(pair.audioAssetId) : undefined;
        const hasPair = Boolean(pair && pairAsset && pairIdx !== undefined && pairAsset.hasAudio);

        if (hasPair && pair && pairAsset && pairIdx !== undefined) {
          // externalTime = videoSourceTime - offsetSeconds. Trim the overlap,
          // add any leading silence caused by a positive delay, then pad to the
          // exact piece duration so concat remains sample-aligned.
          const pairStart = piece.srcStart - pair.offsetSeconds;
          const pairEnd = piece.srcEnd - pair.offsetSeconds;
          const overlapStart = Math.max(0, pairStart);
          const overlapEnd = Math.min(pairAsset.duration, pairEnd);
          if (overlapEnd - overlapStart > 0.005) {
            const leadMs = Math.max(0, Math.round((Math.max(0, -pairStart) / speed) * 1000));
            filters.push(
              `[${pairIdx}:a]atrim=start=${overlapStart.toFixed(3)}:end=${overlapEnd.toFixed(3)},` +
                `asetpts=PTS-STARTPTS${tempo},` +
                `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
                `asetpts=N/SR/TB[apairbody${i}]`
            );
            const pairParts: string[] = [];
            if (leadMs > 0) {
              filters.push(silenceFor((leadMs / 1000).toFixed(3), `apairlead${i}`));
              pairParts.push(`[apairlead${i}]`);
            }
            pairParts.push(`[apairbody${i}]`);
            // Appending a known silent tail before trimming makes the piece
            // sample-exact even when atempo flushes a short final window.
            filters.push(silence(`apairtail${i}`));
            pairParts.push(`[apairtail${i}]`);
            filters.push(
              `${pairParts.join("")}concat=n=${pairParts.length}:v=0:a=1,` +
                `atrim=duration=${outDur},asetpts=N/SR/TB[apair${i}]`
            );
          } else {
            filters.push(silence(`apair${i}`));
          }

          if (!pair.muteCameraAudio && asset.hasAudio) {
            filters.push(
              `[${idx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${tempo},` +
                `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
                `asetpts=N/SR/TB[acambody${i}]`
            );
            filters.push(silence(`acamtail${i}`));
            filters.push(
              `[acambody${i}][acamtail${i}]concat=n=2:v=0:a=1,` +
                `atrim=duration=${outDur},asetpts=N/SR/TB[acam${i}]`
            );
            filters.push(
              `[acam${i}][apair${i}]amix=inputs=2:duration=longest:normalize=0,` +
                `atrim=start=0:end=${outDur}[a${i}]`
            );
          } else {
            filters.push(`[apair${i}]anull[a${i}]`);
          }
        } else if (asset.hasAudio) {
          filters.push(
            `[${idx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${tempo},` +
              `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
              `asetpts=N/SR/TB[acambody${i}]`
          );
          filters.push(silence(`acamtail${i}`));
          filters.push(
            `[acambody${i}][acamtail${i}]concat=n=2:v=0:a=1,` +
              `atrim=duration=${outDur},asetpts=N/SR/TB[a${i}]`
          );
        } else {
          // Silent pieces still need an audio stream so concat timing stays aligned.
          filters.push(silence(`a${i}`));
        }
      }
    });

    const concatInputs = pieces.map((_, i) => `[v${i}][a${i}]`).join("");
    filters.push(`${concatInputs}concat=n=${pieces.length}:v=1:a=1[vcat][acat]`);
    let videoLabel = "vcat";

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
            `scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},` +
            `setsar=1,fps=${preset.fps}${alpha}[ov${i}]`
        );
      } else {
        const w = Math.max(2, Math.round((CW * ov.widthFrac) / 2) * 2);
        filters.push(
          `[${idx}:v]scale=${w}:-2,setsar=1${alpha},setpts=PTS-STARTPTS+${ov.start.toFixed(3)}/TB[ov${i}]`
        );
        // Editor overlay offsets are in 1080x1920 reference coordinates.
        x = `(W-w)/2+(${Math.round((ov.x * CW) / REF_W)})`;
        y = `(H-h)/2+(${Math.round((ov.y * CH) / REF_H)})`;
      }
      filters.push(
        `[${videoLabel}][ov${i}]overlay=x='${x}':y='${y}':enable='between(t,${ov.start.toFixed(3)},${ov.end.toFixed(3)})':eof_action=pass[base${i}]`
      );
      videoLabel = `base${i}`;
    });

    /* ---------------- flash pops (soft white overlay: 40ms attack, decay) ----------------
       Peak alpha 0.75 — an accent, not a white-out. Mirrors flashOpacityAt()
       in lib/timeline/tracks.ts so the preview shows the exported look. */
    const FLASH_PEAK = 0.75;
    const FLASH_ATTACK = 0.04;
    const flashes = (req.flashes ?? [])
      .filter((f) => f.end - f.start > 0.04 && f.start < outDuration)
      .slice(0, 24);
    flashes.forEach((f, i) => {
      const dur = Math.min(1.5, f.end - f.start);
      const st = Math.max(0, f.start);
      const decay = Math.max(0.01, dur - FLASH_ATTACK);
      filters.push(
        `color=c=white:s=${CW}x${CH}:r=${preset.fps}:d=${dur.toFixed(3)},format=yuva420p,` +
          `colorchannelmixer=aa=${FLASH_PEAK},` +
          `fade=t=in:st=0:d=${FLASH_ATTACK}:alpha=1,` +
          `fade=t=out:st=${FLASH_ATTACK}:d=${decay.toFixed(3)}:alpha=1,` +
          `setpts=PTS+${st.toFixed(3)}/TB[fl${i}]`
      );
      filters.push(
        `[${videoLabel}][fl${i}]overlay=enable='between(t,${st.toFixed(3)},${(st + dur).toFixed(3)})':eof_action=pass[flb${i}]`
      );
      videoLabel = `flb${i}`;
    });

    /* ---------------- captions + text graphics (libass) ---------------- */
    const textOverlays = req.textOverlays ?? [];
    if (captions.length > 0 || textOverlays.length > 0) {
      // subs.ass is referenced relative to the job dir (ffmpeg cwd) to dodge
      // Windows drive-letter escaping issues in the subtitles filter.
      fs.writeFileSync(
        path.join(jobDir, "subs.ass"),
        buildAss(captions, style, textOverlays, { width: CW, height: CH }),
        "utf8"
      );
      filters.push(`[${videoLabel}]subtitles=filename=subs.ass[vsub]`);
      videoLabel = "vsub";
    }

    /* ---------------- final scale for non-native presets ---------------- */
    if (preset.width !== CW || preset.height !== CH) {
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
        }:duration=first:normalize=0[amix]`
      );
      filters.push(`[amix]${LOUDNORM}[aout]`);
    } else {
      filters.push(`[${mainAudio}]${LOUDNORM}[aout]`);
    }

    /* ---------------- encode ---------------- */
    const outPath = exportOutputPath(jobId);
    let lastSavedProgress = 0;
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
          if (fraction - lastSavedProgress >= 0.025) {
            lastSavedProgress = fraction;
            void writeJobState({ id: jobId, status: "processing", progress: fraction });
          }
        }
      },
    });

    const downloadUrl = await persistExport(jobId, outPath);
    await writeJobState({ id: jobId, status: "done", progress: 1, downloadUrl });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/** Lazily loaded analysis cache (written by /api/analyze) for smart cropping. */
const analysisCache = new Map<string, MediaAnalysis | null>();
function readAnalysis(assetId: string): MediaAnalysis | null {
  if (analysisCache.has(assetId)) return analysisCache.get(assetId)!;
  let analysis: MediaAnalysis | null = null;
  try {
    analysis = JSON.parse(
      fs.readFileSync(path.join(ANALYSIS_DIR, `${safeId(assetId)}.json`), "utf8")
    ) as MediaAnalysis;
  } catch {
    // no analysis yet — center crop
  }
  analysisCache.set(assetId, analysis);
  return analysis;
}

/**
 * Crop offset for the cover-crop to the canvas aspect: footage wider than the
 * canvas follows the motion center (players/ball) instead of cropping dead
 * center. Returns ":x:y" for the crop filter, or "" for the centered crop.
 */
function smartCropOffset(
  asset: MediaAsset,
  clip: { mediaId: string; sourceStart: number; sourceEnd: number },
  canvasW: number,
  canvasH: number
): string {
  if (!asset.width || !asset.height) return "";
  // Only footage with meaningful horizontal overflow can pan the crop window.
  const scaleFactor = Math.max(canvasW / asset.width, canvasH / asset.height);
  const scaledW = Math.round(asset.width * scaleFactor);
  if (scaledW - canvasW < 40) return "";

  const video = readAnalysis(clip.mediaId)?.video;
  const centers = video?.motionCenterX;
  const rate = video?.motionCenterRate;
  if (!centers || !rate || centers.length === 0) return "";

  const from = Math.max(0, Math.floor(clip.sourceStart * rate));
  const to = Math.min(centers.length, Math.ceil(clip.sourceEnd * rate));
  if (to <= from) return "";
  let sum = 0;
  for (let i = from; i < to; i++) sum += centers[i];
  const cx = sum / (to - from);

  // Round to even for chroma-subsampled safety.
  const x = Math.max(0, Math.min(scaledW - canvasW, Math.round((scaledW * cx - canvasW / 2) / 2) * 2));
  const centered = Math.round((scaledW - canvasW) / 2);
  if (Math.abs(x - centered) < 8) return ""; // effectively centered anyway
  return `:${x}:(ih-${canvasH})/2`;
}

/** One render piece of the main track: a source slice with optional effects. */
interface Piece {
  clip: {
    mediaId: string;
    sourceStart: number;
    sourceEnd: number;
    speed?: number;
    fit?: "fill" | "fit";
    stabilize?: boolean;
  };
  /** Source in/out for this piece, seconds in the source file. */
  srcStart: number;
  srcEnd: number;
  /** Piece start on the output timeline (for window-relative effect time). */
  tlStart: number;
  zoom: ZoomPayload | null;
  shake: ShakePayload | null;
  vign: VignettePayload | null;
  /** Freeze-frame: source instant whose frame is cloned for the whole piece. */
  freezeSrc: number | null;
  /** Output duration (source span / speed; = timeline span for freezes). */
  outDur: number;
}

/** Validated, non-overlapping zoom windows in output-timeline time. */
function normalizeZooms(zooms: ZoomPayload[], duration: number): ZoomPayload[] {
  const valid = zooms
    .map((z) => ({
      ...z,
      start: Math.max(0, Math.min(duration, z.start)),
      end: Math.max(0, Math.min(duration, z.end)),
    }))
    .filter((z) => z.end - z.start > 0.05 && Math.max(z.scale, z.endScale ?? 1) > 1.001)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ZOOM_SEGMENTS / 2);
  const out: ZoomPayload[] = [];
  for (const z of valid) {
    const last = out[out.length - 1];
    if (last && z.start < last.end) continue; // overlapping zoom — earlier one wins
    out.push(z);
  }
  return out;
}

/** Validated, non-overlapping windows in output-timeline time (generic). */
function normalizeWindows<T extends { start: number; end: number }>(
  windows: T[],
  duration: number
): T[] {
  const valid = windows
    .map((w) => ({
      ...w,
      start: Math.max(0, Math.min(duration, w.start)),
      end: Math.max(0, Math.min(duration, w.end)),
    }))
    .filter((w) => w.end - w.start > 0.05)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ZOOM_SEGMENTS / 2);
  const out: T[] = [];
  for (const w of valid) {
    const last = out[out.length - 1];
    if (last && w.start < last.end) continue; // overlap within one type — earlier wins
    out.push(w);
  }
  return out;
}

/**
 * Partition the main track into pieces cut at every clip boundary AND every
 * zoom/freeze/shake/vignette edge, so each piece maps to one source slice
 * with at most one window of each effect type applied.
 */
function buildPieces(
  clips: Array<Piece["clip"]>,
  zooms: ZoomPayload[],
  freezes: FreezePayload[],
  shakes: ShakePayload[],
  vignettes: VignettePayload[],
  duration: number
): Piece[] {
  const windows = normalizeZooms(zooms, duration);
  const freezeWins = normalizeWindows(freezes, duration);
  const shakeWins = normalizeWindows(shakes, duration);
  const vignWins = normalizeWindows(vignettes, duration);
  const pieces: Piece[] = [];
  let cursor = 0;

  for (const clip of clips) {
    const speed = clipSpeed(clip);
    const dur = (clip.sourceEnd - clip.sourceStart) / speed;
    const t0 = cursor;
    const t1 = cursor + dur;

    // Cut points inside this clip: its own edges + effect edges that fall
    // meaningfully inside it (edges within 50ms of a clip edge snap).
    const cuts = new Set<number>([t0, t1]);
    for (const z of [...windows, ...freezeWins, ...shakeWins, ...vignWins]) {
      if (z.start > t0 + 0.05 && z.start < t1 - 0.05) cuts.add(z.start);
      if (z.end > t0 + 0.05 && z.end < t1 - 0.05) cuts.add(z.end);
    }
    const points = [...cuts].sort((a, b) => a - b);

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (b - a < 0.02) continue;
      const mid = (a + b) / 2;
      const zoom = windows.find((z) => mid >= z.start && mid < z.end) ?? null;
      const freeze = freezeWins.find((f) => mid >= f.start && mid < f.end) ?? null;
      const shake = shakeWins.find((s) => mid >= s.start && mid < s.end) ?? null;
      const vign = vignWins.find((v) => mid >= v.start && mid < v.end) ?? null;
      // The frozen frame is the one at the freeze window's start, clamped
      // into this clip's source range (cross-clip windows hold each clip's
      // first frame instead).
      const freezeSrc = freeze
        ? Math.min(
            Math.max(clip.sourceStart + (freeze.start - t0) * speed, clip.sourceStart),
            Math.max(clip.sourceStart, clip.sourceEnd - 0.15)
          )
        : null;
      pieces.push({
        clip,
        srcStart: clip.sourceStart + (a - t0) * speed,
        srcEnd: clip.sourceStart + (b - t0) * speed,
        tlStart: a,
        zoom,
        shake,
        vign,
        freezeSrc,
        outDur: b - a,
      });
    }
    cursor = t1;
  }
  return pieces;
}

const stateWriteQueues = new Map<string, Promise<void>>();

async function writeJobState(state: ExportJobState): Promise<void> {
  const previous = stateWriteQueues.get(state.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeJobStateRaw(state));
  stateWriteQueues.set(state.id, next);
  try {
    await next;
  } finally {
    if (stateWriteQueues.get(state.id) === next) stateWriteQueues.delete(state.id);
  }
}

async function writeJobStateRaw(state: ExportJobState): Promise<void> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    await put(`exports/${safeId(state.id)}.json`, JSON.stringify(state), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return;
  }
  const file = path.join(EXPORTS_DIR, `${state.id}.json`);
  await fs.promises.writeFile(file, JSON.stringify(state), "utf8");
}

async function persistExport(jobId: string, file: string): Promise<string | undefined> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
  const { put } = await import("@vercel/blob");
  const blob = await put(`exports/${safeId(jobId)}.mp4`, fs.createReadStream(file), {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  });
  return blob.downloadUrl;
}

function friendlyExportError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("NO_CLIPS")) return "There is nothing on the timeline to export.";
  if (message.includes("MEDIA_MISSING"))
    return "A source media file is missing. Re-upload it and try again.";
  if (message.includes("timed out")) return "Export took too long and was stopped. Try a shorter video.";
  return "Export failed while rendering the video. Try again, or try a shorter/smaller video.";
}
