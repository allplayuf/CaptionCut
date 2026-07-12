import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { Clip, MediaAsset, TranscriptionLanguage } from "@/types";
import { MEDIA_DIR, TMP_DIR, ensureDataDirs } from "@/lib/server/paths";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { totalDuration } from "@/lib/video/timeline";
import { TranscriptionError, transcribeAudio, transcriptionStatus } from "@/lib/transcription";

export const runtime = "nodejs";
export const maxDuration = 300;

interface TranscribeBody {
  media: MediaAsset[];
  clips: Clip[];
  language?: TranscriptionLanguage;
}

/**
 * Status probe for the UI: which provider is active and whether its
 * assets/keys are already in place (for local-whisper, false means the first
 * run will download the model).
 */
export async function GET() {
  try {
    return NextResponse.json(await transcriptionStatus());
  } catch (err) {
    const message =
      err instanceof TranscriptionError ? err.userMessage : "Transcription is misconfigured.";
    return NextResponse.json({ provider: "unknown", ready: false, error: message });
  }
}

/**
 * Extracts the audio of the *edited timeline* (all clips, trimmed and
 * concatenated) as 16 kHz mono WAV, runs it through the configured
 * transcription provider, and returns TikTok-style caption chunks whose
 * timestamps are already in timeline time.
 */
export async function POST(request: NextRequest) {
  ensureDataDirs();

  let body: TranscribeBody;
  try {
    body = (await request.json()) as TranscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { media, clips } = body;
  const language: TranscriptionLanguage = body.language ?? "auto";

  if (!clips?.length || !media?.length) {
    return NextResponse.json(
      { error: "Add a video to the timeline before generating captions." },
      { status: 400 }
    );
  }

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const usedMedia = clips.map((c) => mediaById.get(c.mediaId)).filter(Boolean) as MediaAsset[];
  if (usedMedia.length !== clips.length) {
    return NextResponse.json({ error: "A clip references a missing video." }, { status: 400 });
  }
  if (!usedMedia.some((m) => m.hasAudio)) {
    return NextResponse.json(
      { error: "No audio found in this video, so there is nothing to transcribe." },
      { status: 422 }
    );
  }

  const duration = totalDuration(clips);
  if (duration <= 0.2) {
    return NextResponse.json({ error: "The timeline is too short to transcribe." }, { status: 400 });
  }

  const wavPath = path.join(TMP_DIR, `transcribe-${nanoid(8)}.wav`);
  try {
    await extractTimelineAudio(clips, mediaById, wavPath);
  } catch (err) {
    console.error("audio extraction failed:", err);
    return NextResponse.json(
      { error: "Could not extract audio from the video. The file may be corrupted." },
      { status: 500 }
    );
  }

  try {
    const { captions, provider } = await transcribeAudio(wavPath, duration, language);
    if (captions.length === 0) {
      return NextResponse.json(
        { error: "No speech was detected in the audio." },
        { status: 422 }
      );
    }
    return NextResponse.json({ captions, provider });
  } catch (err) {
    console.error("transcription failed:", err);
    const message =
      err instanceof TranscriptionError
        ? err.userMessage
        : "Transcription failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    await fs.promises.rm(wavPath, { force: true });
  }
}

async function extractTimelineAudio(
  clips: Clip[],
  mediaById: Map<string, MediaAsset>,
  outPath: string
): Promise<void> {
  const inputIds = [...new Set(clips.map((c) => c.mediaId))];
  const inputIndex = new Map(inputIds.map((id, i) => [id, i]));
  const inputArgs = inputIds.flatMap((id) => [
    "-i",
    path.join(MEDIA_DIR, mediaById.get(id)!.filename),
  ]);

  const filters: string[] = [];
  clips.forEach((clip, i) => {
    const asset = mediaById.get(clip.mediaId)!;
    const speed = Math.min(2, Math.max(0.5, clip.speed && clip.speed > 0 ? clip.speed : 1));
    if (asset.hasAudio) {
      const idx = inputIndex.get(clip.mediaId)!;
      const tempo = speed !== 1 ? `,atempo=${speed.toFixed(4)}` : "";
      filters.push(
        `[${idx}:a]atrim=start=${clip.sourceStart.toFixed(3)}:end=${clip.sourceEnd.toFixed(3)},` +
          `asetpts=PTS-STARTPTS${tempo},aformat=sample_rates=16000:channel_layouts=mono[a${i}]`
      );
    } else {
      // Keep silent clips in the mix so caption timestamps line up with the timeline.
      const dur = ((clip.sourceEnd - clip.sourceStart) / speed).toFixed(3);
      filters.push(`anullsrc=r=16000:cl=mono,atrim=start=0:end=${dur},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  filters.push(
    `${clips.map((_, i) => `[a${i}]`).join("")}concat=n=${clips.length}:v=0:a=1[aout]`
  );

  await runFfmpeg(
    [
      "-y",
      ...inputArgs,
      "-filter_complex", filters.join(";"),
      "-map", "[aout]",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      outPath,
    ],
    { timeoutMs: 10 * 60 * 1000 }
  );
}
