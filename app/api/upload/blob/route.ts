import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/video/uploadLimits";
import { workspaceId } from "@/lib/server/workspace";

export const runtime = "nodejs";

const MEDIA_FILE = /^[a-zA-Z0-9_-]{6,32}\.(mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp|avif)$/i;
const TOKEN_WINDOW_MS = 60 * 60 * 1000;
const TOKENS_PER_WINDOW = 20;
const tokenWindows = new Map<string, { count: number; startedAt: number }>();

class UploadRateLimitError extends Error {}

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
        const activeWorkspace = await workspaceId();
        const expectedPrefix = `media/${activeWorkspace}/`;
        if (!pathname.startsWith(expectedPrefix) || !MEDIA_FILE.test(pathname.slice(expectedPrefix.length))) {
          throw new Error("Unsupported media pathname.");
        }
        if (!takeUploadToken(`${requestIp(request)}:${activeWorkspace}`)) {
          throw new UploadRateLimitError("Upload limit reached. Try again in an hour.");
        }
        return {
          allowedContentTypes: ["video/*", "audio/*", "image/*", "application/octet-stream"],
          maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorize the upload.";
    return NextResponse.json(
      { error: message },
      {
        status: error instanceof UploadRateLimitError ? 429 : 400,
        headers: error instanceof UploadRateLimitError ? { "Retry-After": "3600" } : undefined,
      }
    );
  }
}

function requestIp(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0] ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
    .trim()
    .slice(0, 80);
}

/** Best-effort burst protection; durable quotas can be added when accounts exist. */
function takeUploadToken(key: string): boolean {
  const now = Date.now();
  const current = tokenWindows.get(key);
  if (!current || now - current.startedAt >= TOKEN_WINDOW_MS) {
    tokenWindows.set(key, { count: 1, startedAt: now });
    return true;
  }
  if (current.count >= TOKENS_PER_WINDOW) return false;
  current.count += 1;
  if (tokenWindows.size > 2_000) {
    for (const [candidate, window] of tokenWindows) {
      if (now - window.startedAt >= TOKEN_WINDOW_MS) tokenWindows.delete(candidate);
    }
  }
  return true;
}
