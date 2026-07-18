import { after, NextRequest, NextResponse } from "next/server";
import { startExportJob, type ExportRequest } from "@/lib/export/exporter";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Starts an export job and returns its id; the client polls for progress. */
export async function POST(request: NextRequest) {
  let body: ExportRequest;
  try {
    body = (await request.json()) as ExportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!body.clips?.length) {
    return NextResponse.json(
      { error: "There is nothing on the timeline to export." },
      { status: 400 }
    );
  }
  if (!body.style) {
    return NextResponse.json({ error: "Missing caption style." }, { status: 400 });
  }

  const { state, task } = await startExportJob({
    media: body.media ?? [],
    clips: body.clips,
    captions: body.captions ?? [],
    style: body.style,
    overlays: body.overlays ?? [],
    audioClips: body.audioClips ?? [],
    textOverlays: body.textOverlays ?? [],
    zooms: body.zooms ?? [],
    presetId: body.presetId,
    mainAudioMuted: body.mainAudioMuted ?? false,
  });
  // Keeps the Vercel invocation alive after the quick 202-style response.
  after(() => task);
  return NextResponse.json(state);
}
