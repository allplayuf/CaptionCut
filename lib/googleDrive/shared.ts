const DRIVE_FILE_ID = /^[a-zA-Z0-9_-]{10,200}$/;
const DRIVE_RESOURCE_KEY = /^[a-zA-Z0-9_-]{1,200}$/;
const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com",
]);

export interface SharedDriveFile {
  fileId: string;
  resourceKey?: string;
}

/** Accepts the common Drive share/download URL shapes without trusting a
 * caller-provided host. A bare file id is also accepted for easy copy/paste. */
export function parseSharedDriveFile(value: string): SharedDriveFile | null {
  const input = value.trim();
  if (DRIVE_FILE_ID.test(input)) return { fileId: input };
  if (!input || input.length > 2_048) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || !DRIVE_HOSTS.has(host)) return null;

  const pathMatch =
    url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ??
    url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const fileId = pathMatch?.[1] ?? url.searchParams.get("id") ?? "";
  if (!DRIVE_FILE_ID.test(fileId)) return null;

  const resourceKey =
    url.searchParams.get("resourcekey") ?? url.searchParams.get("resourceKey") ?? undefined;
  if (resourceKey && !DRIVE_RESOURCE_KEY.test(resourceKey)) return null;
  return resourceKey ? { fileId, resourceKey } : { fileId };
}

/** Google serves publicly shared binary files from this host without an API
 * key. The id/resource key come only from parseSharedDriveFile. */
export function sharedDriveDownloadUrl(file: SharedDriveFile): URL {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", file.fileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  return url;
}

/** RFC 5987 (`filename*`) plus the older quoted filename form Google uses. */
export function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1];
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value);
  let filename = encoded ?? plain?.[1] ?? plain?.[2] ?? "";
  filename = filename.trim();
  if (encoded) {
    try {
      filename = decodeURIComponent(filename);
    } catch {
      // Keep the undecoded filename instead of rejecting a valid download.
    }
  }
  filename = filename
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!filename || filename === "." || filename === "..") return null;
  return filename.slice(0, 180);
}
