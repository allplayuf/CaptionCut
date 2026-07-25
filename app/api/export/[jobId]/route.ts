import { NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { exportOutputPath, readJobState } from "@/lib/export/exporter";

export const runtime = "nodejs";

export async function GET(
  request: Request,
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
  if (new URL(request.url).searchParams.get("download") === "1") {
    if (state.status !== "done") {
      return NextResponse.json({ error: "Export is not ready yet" }, { status: 409 });
    }
    if (state.downloadUrl) return NextResponse.redirect(state.downloadUrl);

    const filePath = exportOutputPath(jobId);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Export file is missing" }, { status: 404 });
    }

    const stat = await fs.promises.stat(filePath);
    const stream = fs.createReadStream(filePath);
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="captioncut-${jobId}.mp4"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.json(state);
}
