import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_SIZE = 512 * 1024 * 1024;
const MEDIA_PATH = /^media\/[a-zA-Z0-9_-]{6,32}\.(mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp|avif)$/i;

/** Issues short-lived tokens so large media goes browser -> Blob directly. */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Cloud uploads are not configured. Connect a Vercel Blob store and redeploy." },
      { status: 503 }
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!MEDIA_PATH.test(pathname)) throw new Error("Unsupported media pathname.");
        return {
          allowedContentTypes: ["video/*", "audio/*", "image/*", "application/octet-stream"],
          maximumSizeInBytes: MAX_SIZE,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorize the upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
