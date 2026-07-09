import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/**
 * FFmpeg/FFprobe binaries are bundled via ffmpeg-static / ffprobe-static, so
 * users don't need a system install. To use a system FFmpeg instead, set
 * FFMPEG_PATH / FFPROBE_PATH environment variables.
 */
export const FFMPEG = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string);
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

export interface RunFfmpegOptions {
  cwd?: string;
  /** Total output duration in seconds; enables progress callbacks parsed from stderr. */
  totalDuration?: number;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
}

/** Run ffmpeg and resolve when done. Rejects with the tail of stderr on failure. */
export function runFfmpeg(args: string[], opts: RunFfmpegOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", ...args], {
      cwd: opts.cwd,
      windowsHide: true,
    });

    let stderrTail = "";
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill();
          reject(new Error("FFmpeg timed out"));
        }, opts.timeoutMs)
      : null;

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      if (opts.onProgress && opts.totalDuration && opts.totalDuration > 0) {
        const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (match) {
          const seconds =
            parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
          opts.onProgress(Math.min(0.99, seconds / opts.totalDuration));
        }
      }
    });

    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}:\n${stderrTail}`));
    });
  });
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Probe a media file for duration, dimensions, fps and audio presence. */
export function probeMedia(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFPROBE,
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr.slice(-500)}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const streams: Array<Record<string, unknown>> = data.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        const duration = parseFloat((data.format?.duration as string) ?? "0") || 0;

        let fps = 30;
        if (video?.avg_frame_rate && typeof video.avg_frame_rate === "string") {
          const [num, den] = video.avg_frame_rate.split("/").map(Number);
          if (num && den) fps = num / den;
        }
        // Respect rotation metadata: a rotated portrait phone video reports landscape dimensions.
        let width = (video?.width as number) ?? 0;
        let height = (video?.height as number) ?? 0;
        const sideData = (video?.side_data_list as Array<Record<string, unknown>>) ?? [];
        const rotation = sideData.find((d) => typeof d.rotation === "number")?.rotation as
          | number
          | undefined;
        if (rotation !== undefined && Math.abs(rotation) % 180 === 90) {
          [width, height] = [height, width];
        }

        resolve({
          duration,
          width,
          height,
          fps: Math.round(fps * 100) / 100,
          hasAudio: Boolean(audio),
          hasVideo: Boolean(video),
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
