import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { probeMedia } from "@/lib/server/ffmpeg";
import { ensureDataDirs, MEDIA_DIR } from "@/lib/server/paths";
import { workspaceId } from "@/lib/server/workspace";
import type { AssetKind, MediaAsset } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Functions expose 500 MB of writable /tmp. Leave headroom for probe
// and runtime scratch while retaining the existing 512 MB local limit.
const MAX_SIZE_MB = process.env.VERCEL ? 400 : 512;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const DRIVE_FILE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const DRIVE_RESOURCE_KEY = /^[a-zA-Z0-9_-]{1,200}$/;
const BEARER_TOKEN = /^[a-zA-Z0-9._~+/=-]{20,8192}$/;

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
};

interface DriveFileMetadata {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  capabilities?: {
    canDownload?: unknown;
  };
}

class ImportError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** Public browser credentials used by Google Identity Services and Drive Picker. */
export async function GET() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || null;
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim() || null;
  const appId = process.env.GOOGLE_DRIVE_APP_ID?.trim() || null;

  return NextResponse.json(
    {
      configured: Boolean(clientId && apiKey && appId),
      clientId,
      apiKey,
      appId,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse(
      "Google Drive imports need a Vercel Blob store. Connect one and redeploy.",
      503
    );
  }

  let filePath: string | null = null;
  let partialPath: string | null = null;

  try {
    const token = readBearerToken(request.headers.get("authorization"));
    const { fileId, resourceKey } = await readImportRequest(request);
    const metadata = await fetchMetadata(fileId, resourceKey, token, request.signal);

    const originalName = readMetadataString(metadata.name, "The Drive file has no name.");
    const mimeType = readMetadataString(metadata.mimeType, "The Drive file has no media type.").toLowerCase();
    if (mimeType.startsWith("application/vnd.google-apps.")) {
      throw new ImportError(
        415,
        "Google Docs, Sheets, Slides, and other Google-native files cannot be imported as media."
      );
    }
    if (metadata.capabilities?.canDownload === false) {
      throw new ImportError(403, "The owner of that Drive file has disabled downloads.");
    }

    const declaredSize = readDeclaredSize(metadata.size);
    if (declaredSize > MAX_SIZE) {
      throw fileTooLarge();
    }

    const originalExtension = path.extname(originalName).toLowerCase();
    const kind = expectedKind(mimeType, originalExtension);
    if (!kind) {
      throw new ImportError(415, "Choose a video or audio file from Google Drive.");
    }

    const extension = safeExtension(kind, mimeType, originalExtension);
    const id = nanoid(10);
    const filename = `${id}${extension}`;
    ensureDataDirs();
    filePath = path.join(MEDIA_DIR, filename);
    partialPath = `${filePath}.partial`;

    const downloadedSize = await downloadFile(
      fileId,
      resourceKey,
      token,
      partialPath,
      request.signal
    );
    await fs.promises.rename(partialPath, filePath);
    partialPath = null;

    let probe;
    try {
      probe = await probeMedia(filePath);
    } catch {
      throw new ImportError(
        415,
        "That Drive file does not look playable. Try MP4/MOV/WebM video or MP3/WAV/M4A audio."
      );
    }

    if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
      throw new ImportError(415, "That Drive file has no readable media duration.");
    }
    if (kind === "video" && !probe.hasVideo) {
      throw new ImportError(415, "The selected Drive file does not contain a video stream.");
    }
    if (kind === "audio" && !probe.hasAudio) {
      throw new ImportError(415, "The selected Drive file does not contain an audio stream.");
    }

    const asset: MediaAsset = {
      id,
      filename,
      originalName,
      mimeType: mimeType.startsWith(`${kind}/`) ? mimeType : fallbackMime(kind, extension),
      size: downloadedSize,
      duration: probe.duration,
      width: kind === "video" ? probe.width : 0,
      height: kind === "video" ? probe.height : 0,
      fps: kind === "video" ? probe.fps : 0,
      hasAudio: probe.hasAudio,
      kind,
    };

    if (process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const blob = await put(`media/${await workspaceId()}/${filename}`, fs.createReadStream(filePath), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: asset.mimeType,
        maximumSizeInBytes: MAX_SIZE,
        multipart: downloadedSize > MULTIPART_THRESHOLD,
      });
      asset.storageUrl = blob.url;

      // Vercel's filesystem is ephemeral. Local development intentionally keeps
      // the imported file so /api/media can stream it without another download.
      if (process.env.VERCEL) {
        await fs.promises.rm(filePath, { force: true });
        filePath = null;
      }
    }

    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    if (partialPath) await fs.promises.rm(partialPath, { force: true }).catch(() => {});
    if (filePath) await fs.promises.rm(filePath, { force: true }).catch(() => {});

    if (error instanceof ImportError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Could not import that file from Google Drive. Try again.", 500);
  }
}

function readBearerToken(header: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  const token = match?.[1].trim() ?? "";
  if (!BEARER_TOKEN.test(token)) {
    throw new ImportError(401, "Reconnect Google Drive and try again.");
  }
  return token;
}

async function readImportRequest(
  request: Request
): Promise<{ fileId: string; resourceKey?: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ImportError(400, "Invalid Google Drive import request.");
  }

  const fileId =
    body && typeof body === "object" && "fileId" in body
      ? (body as { fileId?: unknown }).fileId
      : null;
  if (typeof fileId !== "string" || !DRIVE_FILE_ID.test(fileId)) {
    throw new ImportError(400, "A valid Google Drive file id is required.");
  }

  const resourceKey =
    body && typeof body === "object" && "resourceKey" in body
      ? (body as { resourceKey?: unknown }).resourceKey
      : undefined;
  if (
    resourceKey !== undefined &&
    (typeof resourceKey !== "string" || !DRIVE_RESOURCE_KEY.test(resourceKey))
  ) {
    throw new ImportError(400, "The Google Drive resource key is invalid.");
  }
  return resourceKey ? { fileId, resourceKey } : { fileId };
}

async function fetchMetadata(
  fileId: string,
  resourceKey: string | undefined,
  token: string,
  signal: AbortSignal
): Promise<DriveFileMetadata> {
  const url = driveFileUrl(fileId);
  url.searchParams.set("fields", "id,name,mimeType,size,capabilities(canDownload)");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: driveHeaders(fileId, resourceKey, token),
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ImportError(502, "Could not reach Google Drive. Try again.");
  }
  if (!response.ok) throw driveResponseError(response.status);

  let metadata: DriveFileMetadata;
  try {
    metadata = (await response.json()) as DriveFileMetadata;
  } catch {
    throw new ImportError(502, "Google Drive returned invalid file information.");
  }
  if (metadata.id !== fileId) {
    throw new ImportError(502, "Google Drive returned invalid file information.");
  }
  return metadata;
}

async function downloadFile(
  fileId: string,
  resourceKey: string | undefined,
  token: string,
  partialPath: string,
  signal: AbortSignal
): Promise<number> {
  const url = driveFileUrl(fileId);
  url.searchParams.set("alt", "media");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: driveHeaders(fileId, resourceKey, token),
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ImportError(502, "Could not download that file from Google Drive.");
  }
  if (!response.ok) throw driveResponseError(response.status);
  if (!response.body) {
    throw new ImportError(502, "Google Drive returned an empty download.");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_SIZE) {
    throw fileTooLarge();
  }

  let downloadedSize = 0;
  const sizeGuard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedSize += chunk.length;
      if (downloadedSize > MAX_SIZE) {
        callback(fileTooLarge());
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as import("stream/web").ReadableStream),
      sizeGuard,
      fs.createWriteStream(partialPath, { flags: "wx" }),
      { signal }
    );
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(502, "Could not download that file from Google Drive.");
  }
  if (downloadedSize === 0) {
    throw new ImportError(415, "The selected Drive file is empty.");
  }
  return downloadedSize;
}

function driveFileUrl(fileId: string): URL {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("supportsAllDrives", "true");
  return url;
}

function driveHeaders(
  fileId: string,
  resourceKey: string | undefined,
  token: string
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (resourceKey) {
    headers["X-Goog-Drive-Resource-Keys"] = `${fileId}/${resourceKey}`;
  }
  return headers;
}

function driveResponseError(status: number): ImportError {
  if (status === 401) return new ImportError(401, "Google Drive access expired. Reconnect and try again.");
  if (status === 403) return new ImportError(403, "Google Drive did not allow access to that file.");
  if (status === 404) return new ImportError(404, "That Google Drive file was not found.");
  if (status === 429) return new ImportError(429, "Google Drive is busy. Wait a moment and try again.");
  return new ImportError(502, "Google Drive could not provide that file. Try again.");
}

function readMetadataString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ImportError(422, message);
  return value;
}

function readDeclaredSize(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ImportError(422, "Google Drive did not provide a valid file size.");
  }
  const size = Number(value);
  if (!Number.isFinite(size)) throw fileTooLarge();
  return size;
}

function fileTooLarge(): ImportError {
  return new ImportError(413, `That Drive file is too large (max ${MAX_SIZE_MB} MB).`);
}

function expectedKind(mimeType: string, extension: string): AssetKind | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function safeExtension(kind: AssetKind, mimeType: string, extension: string): string {
  const allowed = kind === "video" ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
  if (allowed.has(extension)) return extension;
  return MIME_EXTENSIONS[mimeType] ?? (kind === "audio" ? ".mp3" : ".mp4");
}

function fallbackMime(kind: AssetKind, extension: string): string {
  if (kind === "audio") {
    if (extension === ".m4a") return "audio/mp4";
    if (extension === ".mp3") return "audio/mpeg";
    return `audio/${extension.slice(1)}`;
  }
  if (extension === ".mov") return "video/quicktime";
  return extension === ".mp4" ? "video/mp4" : `video/${extension.slice(1)}`;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
