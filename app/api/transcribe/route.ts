import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type {
  Caption,
  Clip,
  MediaAsset,
  TranscriptionLanguage,
  TranscriptionQuality,
  WordTiming,
} from "@/types";
import { TMP_DIR, ensureDataDirs } from "@/lib/server/paths";
import { materializeMedia } from "@/lib/server/media";
import { runFfmpeg } from "@/lib/server/ffmpeg";
import { clipDuration, totalDuration } from "@/lib/video/timeline";
import { TranscriptionError, transcribeAudio, transcriptionStatus } from "@/lib/transcription";

export const runtime = "nodejs";
export const maxDuration = 300;

interface TranscribeBody {
  media: MediaAsset[];
  clips: Clip[];
  language?: TranscriptionLanguage;
  quality?: TranscriptionQuality;
  /** Names, jargon or context that the speech model should expect. */
  prompt?: string;
  /** When present, only these main-track clips contribute audio. */
  selectedClipIds?: string[];
}

const LANGUAGES: TranscriptionLanguage[] = ["auto", "en", "sv"];
const QUALITIES: TranscriptionQuality[] = ["fast", "accurate"];

/**
 * Status probe for the UI: which provider is active and whether its
 * assets/keys are already in place (for local-whisper, false means the first
 * run will download the model).
 */
export async function GET(request: NextRequest) {
  const requestedQuality = request.nextUrl.searchParams.get("quality");
  const quality: TranscriptionQuality = requestedQuality === "fast" ? "fast" : "accurate";
  try {
    return NextResponse.json(await transcriptionStatus(quality));
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

  if (!body || !Array.isArray(body.media) || !Array.isArray(body.clips)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { media, clips } = body;
  const language = body.language ?? "auto";
  const quality = body.quality ?? "accurate";

  if (!LANGUAGES.includes(language) || !QUALITIES.includes(quality)) {
    return NextResponse.json({ error: "Invalid transcription settings." }, { status: 400 });
  }
  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    return NextResponse.json({ error: "The transcription glossary must be text." }, { status: 400 });
  }
  const prompt = body.prompt?.replace(/\0/g, "").trim().slice(0, 500);

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
  let selectedClipIds: Set<string> | undefined;
  if (body.selectedClipIds !== undefined) {
    if (
      !Array.isArray(body.selectedClipIds) ||
      body.selectedClipIds.length > clips.length ||
      body.selectedClipIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json({ error: "Invalid clip selection." }, { status: 400 });
    }
    const clipIds = new Set(clips.map((clip) => clip.id));
    selectedClipIds = new Set(body.selectedClipIds.filter((id) => clipIds.has(id)));
    if (selectedClipIds.size === 0) {
      return NextResponse.json(
        { error: "Select at least one main-track video clip to transcribe." },
        { status: 400 }
      );
    }
  }

  const clipsInScope = selectedClipIds
    ? clips.filter((clip) => selectedClipIds.has(clip.id))
    : clips;
  const missingLinkedAudio = clipsInScope.some((clip) => {
    const linkedId = mediaById.get(clip.mediaId)?.linkedAudio?.audioAssetId;
    return Boolean(linkedId && !mediaById.has(linkedId));
  });
  if (missingLinkedAudio) {
    return NextResponse.json({ error: "A video references missing linked audio." }, { status: 400 });
  }
  if (
    !clipsInScope.some((clip) => {
      const video = mediaById.get(clip.mediaId);
      const linked = video?.linkedAudio
        ? mediaById.get(video.linkedAudio.audioAssetId)
        : undefined;
      return linked?.hasAudio || video?.hasAudio;
    })
  ) {
    return NextResponse.json(
      {
        error: selectedClipIds
          ? "No audio found in the selected video clips, so there is nothing to transcribe."
          : "No audio found in the timeline, so there is nothing to transcribe.",
      },
      { status: 422 }
    );
  }

  const duration = totalDuration(clips);
  if (duration <= 0.2) {
    return NextResponse.json({ error: "The timeline is too short to transcribe." }, { status: 400 });
  }

  const wavPath = path.join(TMP_DIR, `transcribe-${nanoid(8)}.wav`);
  try {
    await extractTimelineAudio(clips, mediaById, wavPath, selectedClipIds);
  } catch (err) {
    console.error("audio extraction failed:", err);
    return NextResponse.json(
      { error: "Could not extract audio from the video. The file may be corrupted." },
      { status: 500 }
    );
  }

  try {
    const result = await transcribeAudio(wavPath, duration, { language, quality, prompt });
    const ranges = selectedClipIds ? selectedTimelineRanges(clips, selectedClipIds) : undefined;
    const captions = ranges ? captionsInsideRanges(result.captions, ranges) : result.captions;
    if (captions.length === 0) {
      return NextResponse.json(
        { error: "No speech was detected in the audio." },
        { status: 422 }
      );
    }
    return NextResponse.json({ captions, provider: result.provider, model: result.model });
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
  outPath: string,
  selectedClipIds?: Set<string>
): Promise<void> {
  const inputIds = [
    ...new Set(
      clips
        .filter((clip) => !selectedClipIds || selectedClipIds.has(clip.id))
        .map((clip) => audioSourceForClip(clip, mediaById)?.asset.id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const inputIndex = new Map(inputIds.map((id, i) => [id, i]));
  const localFiles = new Map<string, string>();
  await Promise.all(
    inputIds.map(async (id) => {
      localFiles.set(id, await materializeMedia(mediaById.get(id)!));
    })
  );
  const inputArgs = inputIds.flatMap((id) => ["-i", localFiles.get(id)!]);

  const filters: string[] = [];
  clips.forEach((clip, i) => {
    const speed = Math.min(2, Math.max(0.5, clip.speed && clip.speed > 0 ? clip.speed : 1));
    const clipDur = (clip.sourceEnd - clip.sourceStart) / speed;
    const source = audioSourceForClip(clip, mediaById);
    const includeAudio = Boolean(source && (!selectedClipIds || selectedClipIds.has(clip.id)));
    if (!includeAudio || !source) {
      // Keep silent clips in the mix so caption timestamps line up with the timeline.
      filters.push(
        `anullsrc=r=16000:cl=mono,atrim=start=0:end=${clipDur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
      );
      return;
    }

    const idx = inputIndex.get(source.asset.id)!;
    const tempo = speed !== 1 ? `,atempo=${speed.toFixed(4)}` : "";
    const sourceStart = clip.sourceStart - source.offsetSeconds;
    const sourceEnd = clip.sourceEnd - source.offsetSeconds;
    const overlapStart = Math.max(0, sourceStart);
    const overlapEnd = Math.min(source.asset.duration, sourceEnd);
    if (overlapEnd - overlapStart <= 0.005) {
      filters.push(
        `anullsrc=r=16000:cl=mono,atrim=start=0:end=${clipDur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
      );
      return;
    }

    const leadMs = Math.max(0, Math.round((Math.max(0, -sourceStart) / speed) * 1000));
    filters.push(
      `[${idx}:a]atrim=start=${overlapStart.toFixed(3)}:end=${overlapEnd.toFixed(3)},` +
        `asetpts=PTS-STARTPTS${tempo},aformat=sample_rates=16000:channel_layouts=mono,` +
        `${leadMs > 0 ? `adelay=${leadMs},` : ""}` +
        `apad,atrim=start=0:end=${clipDur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
    );
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

function audioSourceForClip(
  clip: Clip,
  mediaById: Map<string, MediaAsset>
): { asset: MediaAsset; offsetSeconds: number } | null {
  const video = mediaById.get(clip.mediaId);
  if (!video) return null;
  const link = video.linkedAudio;
  const linked = link ? mediaById.get(link.audioAssetId) : undefined;
  if (linked?.hasAudio) {
    return { asset: linked, offsetSeconds: link?.offsetSeconds ?? 0 };
  }
  return video.hasAudio ? { asset: video, offsetSeconds: 0 } : null;
}

/** Absolute timeline ranges occupied by selected sequential main-track clips. */
function selectedTimelineRanges(clips: Clip[], selectedClipIds: Set<string>) {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const clip of clips) {
    const end = cursor + clipDuration(clip);
    if (selectedClipIds.has(clip.id)) {
      const previous = ranges[ranges.length - 1];
      if (previous && cursor <= previous.end + 0.002) previous.end = end;
      else ranges.push({ start: cursor, end });
    }
    cursor = end;
  }
  return ranges;
}

/**
 * Silence can occasionally be hallucinated as speech. Keep only words whose
 * midpoint belongs to a selected range, and trim any boundary-crossing lines.
 */
function captionsInsideRanges(
  captions: Caption[],
  ranges: Array<{ start: number; end: number }>
): Caption[] {
  const scoped: Caption[] = [];

  for (const caption of captions) {
    if (caption.words?.length) {
      for (const range of ranges) {
        const words = caption.words.filter((word) => pointInsideRange(wordMidpoint(word), range));
        if (words.length === 0) continue;
        scoped.push({
          ...caption,
          id: scoped.some((item) => item.id === caption.id) ? nanoid(8) : caption.id,
          startTime: Math.max(range.start, words[0].startTime),
          endTime: Math.min(range.end, words[words.length - 1].endTime),
          text: words.map((word) => word.word).join(" "),
          words,
          confidence: meanConfidence(words),
        });
      }
      continue;
    }

    const midpoint = (caption.startTime + caption.endTime) / 2;
    const range = ranges.find((candidate) => pointInsideRange(midpoint, candidate));
    if (!range) continue;
    scoped.push({
      ...caption,
      startTime: Math.max(range.start, caption.startTime),
      endTime: Math.min(range.end, caption.endTime),
    });
  }

  return scoped
    .filter((caption) => caption.endTime - caption.startTime >= 0.02)
    .sort((a, b) => a.startTime - b.startTime);
}

function wordMidpoint(word: WordTiming): number {
  return (word.startTime + word.endTime) / 2;
}

function pointInsideRange(point: number, range: { start: number; end: number }): boolean {
  return point >= range.start - 0.002 && point <= range.end + 0.002;
}

function meanConfidence(words: WordTiming[]): number | undefined {
  const values = words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}
