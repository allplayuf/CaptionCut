/**
 * Clip transition render + parity check (dev tool).
 * Run: npx tsx scripts/verify-transitions.ts
 *
 * Transitions are overlaid after the main concat, so the risk is twofold: that
 * the added filter graph breaks the exporter's one-flat-chain rule and stalls
 * ffmpeg, and that the veil the preview draws doesn't match the one burned in.
 *
 * This renders a real multi-clip timeline with a dip and a flash on it, then
 * samples exported frames at the cut and compares their measured brightness
 * against what `transitionVeilAt` — the function the preview draws from —
 * predicts at the same instants.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { MediaAsset } from "@/types";
import { FFMPEG, probeMedia } from "@/lib/server/ffmpeg";
import {
  createDefaultTracks,
  mainClips,
  mainVideoTrack,
  makeMainClip,
  rippleMainTrack,
  tracksDuration,
} from "@/lib/timeline/tracks";
import { TRANSITION_DURATION, transitionCuts, transitionVeilAt } from "@/lib/timeline/transitions";
import { buildExportRequest } from "@/lib/export/request";
import { exportOutputPath, readJobState, startExportJob } from "@/lib/export/exporter";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const CLIP_SECONDS = 4;

/**
 * Mean luma of one frame of `file` at `time`, 0..255, via ffmpeg's signalstats.
 * Spawned directly because the shared runner discards stderr, which is exactly
 * where the metadata filter prints its measurement.
 */
function frameLuma(file: string, time: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-ss", time.toFixed(3),
        "-i", file,
        "-frames:v", "1",
        "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
        "-f", "null", "-",
      ],
      { windowsHide: true }
    );
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", () => {
      const match = stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
      if (!match) reject(new Error(`could not read luma at ${time}s`));
      else resolve(Number(match[1]));
    });
  });
}

async function main() {
  const files = fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => /\.(mp4|mov|webm|m4v|mkv)$/i.test(f))
    .map((f) => ({ f, size: fs.statSync(path.join(MEDIA_DIR, f)).size }))
    .sort((a, b) => a.size - b.size)
    .slice(0, 3)
    .map((x) => x.f);
  if (files.length < 3) throw new Error("need at least 3 videos in data/media");

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

  const tracks = createDefaultTracks();
  const video = mainVideoTrack(tracks);
  video.clips = media.map((m) => makeMainClip(m, 0, Math.min(m.duration, CLIP_SECONDS)));
  // Clip 2 dips through black, clip 3 punches through white. Clip 1 is first,
  // so it must be ignored even if a transition is set on it.
  video.clips[0].transition = "dip";
  video.clips[1].transition = "dip";
  video.clips[2].transition = "flash";
  tracks[tracks.indexOf(video)] = rippleMainTrack(video);

  const clips = mainClips(tracks);
  const cuts = transitionCuts(clips);
  console.log(`Timeline: ${clips.length} clips, ${tracksDuration(tracks).toFixed(1)}s`);
  console.log(`Transitions: ${cuts.map((c) => `${c.kind}@${c.time.toFixed(2)}s`).join(", ")}`);
  if (cuts.length !== 2) {
    throw new Error(`expected 2 transitions (first clip skipped), got ${cuts.length}`);
  }

  const req = buildExportRequest({
    media,
    tracks,
    captions: [],
    style: {
      fontFamily: "Arial", fontSize: 64, fontWeight: 900, textColor: "#fff",
      backgroundColor: null, backgroundOpacity: 0.8, strokeColor: "#000",
      strokeWidth: 5, shadow: true, position: "lower", allCaps: true, highlightColor: null,
    },
    presetId: "draft",
  });

  console.log("\nRendering…");
  const { state: job } = await startExportJob(req);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = await readJobState(job.id);
    if (!state) throw new Error("job state lost");
    if (state.status === "done") break;
    if (state.status === "error") throw new Error(`export failed: ${state.error}`);
    // A fan-out deadlock shows up as a job that never progresses.
    if (Date.now() - t0 > 5 * 60 * 1000) throw new Error("export stalled — possible filter deadlock");
  }
  const out = exportOutputPath(job.id);
  console.log(`Render OK in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  /* Sample the veil: at the cut it should be near-black / near-white, and well
     away from the cut it should be ordinary footage. */
  let failures = 0;
  for (const cut of cuts) {
    const atCut = await frameLuma(out, cut.time);
    const away = await frameLuma(out, cut.time + TRANSITION_DURATION);
    const predictedAtCut = transitionVeilAt(clips, cut.time);
    const predictedAway = transitionVeilAt(clips, cut.time + TRANSITION_DURATION);

    console.log(
      `\n  ${cut.kind} @ ${cut.time.toFixed(2)}s — luma ${atCut.toFixed(1)} at the cut, ` +
        `${away.toFixed(1)} clear of it`
    );
    console.log(
      `    preview predicts opacity ${predictedAtCut?.opacity.toFixed(2) ?? "0"} at the cut, ` +
        `${predictedAway?.opacity.toFixed(2) ?? "0"} clear of it`
    );

    // Each kind has its own peak — a dip blacks out fully, a flash is an
    // accent at 0.85 rather than a white-out.
    if (!predictedAtCut || Math.abs(predictedAtCut.opacity - cut.peak) > 0.01) {
      failures++;
      console.log(
        `    FAIL preview veil is ${predictedAtCut?.opacity.toFixed(2) ?? "0"} on the cut, ` +
          `expected this transition's peak of ${cut.peak}`
      );
    }
    if (predictedAway !== null) {
      failures++;
      console.log("    FAIL preview veil still showing a full transition away");
    }
    if (cut.kind === "dip" && atCut > 24) {
      failures++;
      console.log(`    FAIL dip did not reach black in the export (luma ${atCut.toFixed(1)})`);
    }
    if (cut.kind === "flash" && atCut < 170) {
      failures++;
      console.log(`    FAIL flash did not reach white in the export (luma ${atCut.toFixed(1)})`);
    }
    if (Math.abs(away - atCut) < 20) {
      failures++;
      console.log("    FAIL no measurable difference between the cut and clear footage");
    }
  }

  if (failures > 0) throw new Error(`${failures} transition checks failed`);
  console.log("\nTRANSITION CHECKS PASSED ✅");
}

main().catch((err) => {
  console.error("\nVERIFY FAILED ❌", err);
  process.exit(1);
});
