import { NextRequest, NextResponse } from "next/server";
import { startExportJob, type ExportRequest } from "@/lib/export/exporter";

export const runtime = "nodejs";

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

  const state = startExportJob({
    media: body.media ?? [],
    clips: body.clips,
    captions: body.captions ?? [],
    style: body.style,
  });
  return NextResponse.json(state);
}
