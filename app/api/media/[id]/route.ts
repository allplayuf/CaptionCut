import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { MEDIA_DIR } from "@/lib/server/paths";

export const runtime = "nodejs";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

/**
 * Streams an uploaded video with HTTP Range support — required for smooth
 * <video> scrubbing in the browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid media id" }, { status: 400 });
  }

  // The stored filename is id + original extension; find it.
  let filename: string | undefined;
  try {
    const files = await fs.promises.readdir(MEDIA_DIR);
    filename = files.find((f) => f.startsWith(`${id}.`));
  } catch {
    filename = undefined;
  }
  if (!filename) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const filePath = path.join(MEDIA_DIR, filename);
  const stat = await fs.promises.stat(filePath);
  const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "video/mp4";

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
