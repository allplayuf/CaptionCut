import { NextRequest, NextResponse } from "next/server";
import type { MediaAnalysis, MediaAsset } from "@/types";
import { analyzeAsset } from "@/lib/server/analyze";
import { assetKind } from "@/lib/timeline/tracks";
import {
  jsonTooLarge,
  MAX_ANALYZE_BYTES,
  requestTooLarge,
  validateMediaAsset,
} from "@/lib/server/requestValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

interface AnalyzeBody {
  media: MediaAsset[];
}

/**
 * Local media analysis for the auto editor: motion, scene changes, audio
 * energy and beats per asset. Results are cached server-side, so repeat calls
 * are instant. Never fails the whole request — assets that can't be analyzed
 * come back as null and the auto editor falls back to transcript-only logic.
 */
export async function POST(request: NextRequest) {
  if (requestTooLarge(request, MAX_ANALYZE_BYTES)) {
    return NextResponse.json({ error: "Analysis request is too large." }, { status: 413 });
  }
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!Array.isArray(body.media) || body.media.length === 0) {
    return NextResponse.json({ error: "No media to analyze." }, { status: 400 });
  }
  if (body.media.length > 8) {
    return NextResponse.json({ error: "Too many assets in one request." }, { status: 400 });
  }
  if (jsonTooLarge(body, MAX_ANALYZE_BYTES)) {
    return NextResponse.json({ error: "Analysis request is too large." }, { status: 413 });
  }
  if (body.media.some((asset) => validateMediaAsset(asset) !== null)) {
    return NextResponse.json({ error: "Invalid media metadata." }, { status: 400 });
  }

  const analyses: Record<string, MediaAnalysis | null> = {};
  // Sequential keeps CPU sane while several ffmpeg passes run per asset.
  for (const asset of body.media) {
    // Filenames are always "<id>.<ext>" from the uploader; reject anything else
    // so a crafted payload can't reach outside data/media.
    const kind = assetKind(asset);
    try {
      analyses[asset.id] = await analyzeAsset(asset.id, asset.filename, {
        hasAudio: Boolean(asset.hasAudio),
        hasVideo: kind === "video",
        duration: asset.duration ?? 0,
      }, asset.storageUrl);
    } catch (err) {
      console.error(`analysis failed for ${asset.id}:`, err);
      analyses[asset.id] = null;
    }
  }

  return NextResponse.json({ analyses });
}
