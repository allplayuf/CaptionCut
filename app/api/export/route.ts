import { after, NextRequest, NextResponse } from "next/server";
import { startExportJob, type ExportRequest } from "@/lib/export/exporter";
import {
  jsonTooLarge,
  MAX_EXPORT_BYTES,
  requestTooLarge,
  validateExportPayload,
} from "@/lib/server/requestValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Starts an export job and returns its id; the client polls for progress. */
export async function POST(request: NextRequest) {
  if (requestTooLarge(request, MAX_EXPORT_BYTES)) {
    return NextResponse.json({ error: "Export request is too large." }, { status: 413 });
  }
  let body: ExportRequest;
  try {
    body = (await request.json()) as ExportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (jsonTooLarge(body, MAX_EXPORT_BYTES)) {
    return NextResponse.json({ error: "Export request is too large." }, { status: 413 });
  }
  const validationError = validateExportPayload(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const { state, task } = await startExportJob({
    media: body.media ?? [],
    clips: body.clips,
    captions: body.captions ?? [],
    style: body.style,
    overlays: body.overlays ?? [],
    audioClips: body.audioClips ?? [],
    textOverlays: body.textOverlays ?? [],
    zooms: body.zooms ?? [],
    freezes: body.freezes ?? [],
    flashes: body.flashes ?? [],
    shakes: body.shakes ?? [],
    vignettes: body.vignettes ?? [],
    presetId: body.presetId,
    mainAudioMuted: body.mainAudioMuted ?? false,
  });
  // Keeps the Vercel invocation alive after the quick 202-style response.
  after(() => task);
  return NextResponse.json(state);
}
