import { NextResponse } from "next/server";
import { readJobState } from "@/lib/export/exporter";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  let state = null;
  try {
    state = await readJobState(jobId);
  } catch {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  if (!state) {
    return NextResponse.json({ error: "Export job not found" }, { status: 404 });
  }
  return NextResponse.json(state);
}
