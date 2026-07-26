"use client";

import Script from "next/script";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MediaAsset } from "@/types";
import { registerImportedMedia, useMediaUpload } from "@/hooks/useMediaUpload";
import { useEditorStore } from "@/hooks/useEditorStore";
import { ExternalLink, FileUp, Link2, LoaderCircle, X } from "lucide-react";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PICKER_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/x-matroska",
  "video/x-msvideo",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
].join(",");
const AUDIO_PICKER_MIME_TYPES = PICKER_MIME_TYPES.split(",")
  .filter((mimeType) => mimeType.startsWith("audio/"))
  .join(",");
const VIDEO_PICKER_MIME_TYPES = PICKER_MIME_TYPES.split(",")
  .filter((mimeType) => mimeType.startsWith("video/"))
  .join(",");
const DRIVE_FILE_ACCEPT = {
  all: "video/*,audio/*,.mp4,.mov,.webm,.m4v,.mkv,.avi,.mp3,.wav,.m4a,.aac,.ogg,.flac",
  audio: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac",
  video: "video/*,.mp4,.mov,.webm,.m4v,.mkv,.avi",
} as const;

type DriveImportProgress = { index: number; total: number; name: string } | null;

let sharedImportProgress: DriveImportProgress = null;
const importProgressListeners = new Set<() => void>();

function setSharedImportProgress(progress: DriveImportProgress) {
  sharedImportProgress = progress;
  importProgressListeners.forEach((listener) => listener());
}

function subscribeToImportProgress(listener: () => void) {
  importProgressListeners.add(listener);
  return () => {
    importProgressListeners.delete(listener);
  };
}

function getImportProgressSnapshot() {
  return sharedImportProgress;
}

interface DriveConfig {
  configured: boolean;
  clientId: string | null;
  apiKey: string | null;
  appId: string | null;
}

interface PickerDocument {
  id?: string;
  name?: string;
  resourceKey?: string;
}

interface PickerResponse {
  action?: string;
  docs?: PickerDocument[];
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface DocsViewLike {
  setMimeTypes(types: string): DocsViewLike;
  setMode(mode: string): DocsViewLike;
  setIncludeFolders(include: boolean): DocsViewLike;
}

interface PickerBuilderLike {
  addView(view: DocsViewLike): PickerBuilderLike;
  enableFeature(feature: string): PickerBuilderLike;
  setDeveloperKey(key: string): PickerBuilderLike;
  setAppId(id: string): PickerBuilderLike;
  setOAuthToken(token: string): PickerBuilderLike;
  setOrigin(origin: string): PickerBuilderLike;
  setMaxItems(count: number): PickerBuilderLike;
  setTitle(title: string): PickerBuilderLike;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilderLike;
  build(): { setVisible(visible: boolean): void };
}

interface GoogleApis {
  accounts?: {
    oauth2?: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: () => void;
      }): { requestAccessToken(config?: { prompt?: string }): void };
    };
  };
  picker?: {
    Action: { PICKED: string };
    Feature: { MULTISELECT_ENABLED: string };
    DocsViewMode: { LIST: string };
    DocsView: new () => DocsViewLike;
    PickerBuilder: new () => PickerBuilderLike;
  };
}

declare global {
  interface Window {
    google?: GoogleApis;
    gapi?: { load(name: string, callback: () => void): void };
  }
}

export default function GoogleDriveButton({
  className,
  children,
  disabled = false,
  kind = "all",
}: {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  kind?: "all" | "audio" | "video";
}) {
  const [gisReady, setGisReady] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const shareInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploading: fileUploading, handleFiles } = useMediaUpload();
  const importing = useSyncExternalStore(
    subscribeToImportProgress,
    getImportProgressSnapshot,
    getImportProgressSnapshot
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import/google-drive", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as DriveConfig;
      })
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({ configured: false, clientId: null, apiKey: null, appId: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!linkDialogOpen) return;
    const focusTimer = window.setTimeout(() => shareInputRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !getImportProgressSnapshot() && !fileUploading) {
        setLinkDialogOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fileUploading, linkDialogOpen]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setGisReady(Boolean(window.google?.accounts?.oauth2));
      if (window.google?.picker) {
        setPickerReady(true);
      } else {
        window.gapi?.load("picker", () => {
          if (!cancelled) setPickerReady(Boolean(window.google?.picker));
        });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const importDocuments = useCallback(async (documents: PickerDocument[], token: string) => {
    if (getImportProgressSnapshot()) {
      useEditorStore.getState().addToast("info", "Another Google Drive import is still running.");
      return;
    }
    let imported = 0;
    let accessExpired = false;
    for (let index = 0; index < documents.length; index++) {
      const document = documents[index];
      if (!document.id) continue;
      setSharedImportProgress({
        index: index + 1,
        total: documents.length,
        name: document.name ?? "Drive media",
      });
      try {
        const response = await fetch("/api/import/google-drive", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileId: document.id,
            ...(document.resourceKey ? { resourceKey: document.resourceKey } : {}),
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            accessExpired = true;
            try {
              window.sessionStorage.removeItem("captioncut:drive-consent");
            } catch {
              // The next click can still request a fresh token explicitly.
            }
          }
          throw new Error(readErrorMessage(body) ?? "Google Drive import failed.");
        }
        if (!isMediaAsset(body)) {
          throw new Error("Google Drive returned invalid media information.");
        }
        registerImportedMedia(body, { silentAudioTip: true });
        imported += 1;
      } catch (error) {
        useEditorStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Google Drive import failed."
          );
        if (accessExpired) break;
      }
    }
    setSharedImportProgress(null);
    if (imported > 0) {
      useEditorStore.getState().addToast(
        "success",
        `Imported ${imported} file${imported === 1 ? "" : "s"} from Google Drive.`
      );
    }
  }, []);

  const openPicker = useCallback(
    (token: string) => {
      if (!config?.apiKey || !config.appId) return;
      const pickerApi = window.google?.picker;
      if (!pickerApi) {
        useEditorStore.getState().addToast("error", "Google Drive Picker did not load. Try again.");
        return;
      }
      const view = new pickerApi.DocsView()
        .setMimeTypes(
          kind === "audio"
            ? AUDIO_PICKER_MIME_TYPES
            : kind === "video"
              ? VIDEO_PICKER_MIME_TYPES
              : PICKER_MIME_TYPES
        )
        .setMode(pickerApi.DocsViewMode.LIST)
        .setIncludeFolders(true);

      const picker = new pickerApi.PickerBuilder()
        .addView(view)
        .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(token)
        .setOrigin(window.location.origin)
        .setMaxItems(20)
        .setTitle(
          kind === "audio"
            ? "Add audio from Google Drive"
            : kind === "video"
              ? "Add video from Google Drive"
              : "Add video or audio from Google Drive"
        )
        .setCallback((data) => {
          if (data.action !== pickerApi.Action.PICKED || !data.docs?.length) return;
          void importDocuments(data.docs, token);
        })
        .build();
      picker.setVisible(true);
    },
    [config, importDocuments, kind]
  );

  const importSharedLink = useCallback(async () => {
    const url = shareUrl.trim();
    if (!url) {
      useEditorStore.getState().addToast("info", "Paste a Google Drive file link first.");
      shareInputRef.current?.focus();
      return;
    }
    if (getImportProgressSnapshot()) {
      useEditorStore.getState().addToast("info", "Another Google Drive import is still running.");
      return;
    }

    setSharedImportProgress({ index: 1, total: 1, name: "Shared Drive file" });
    try {
      const response = await fetch("/api/import/google-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, kind }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(body) ?? "Google Drive import failed.");
      }
      if (!isMediaAsset(body)) {
        throw new Error("Google Drive returned invalid media information.");
      }
      const importedKind = body.kind ?? (body.mimeType.startsWith("audio/") ? "audio" : "video");
      if (kind !== "all" && importedKind !== kind) {
        throw new Error(`Choose ${kind === "audio" ? "an audio" : "a video"} file from Google Drive.`);
      }
      registerImportedMedia(body, { silentAudioTip: true });
      setShareUrl("");
      setLinkDialogOpen(false);
      useEditorStore.getState().addToast("success", `Imported "${body.originalName}" from Google Drive.`);
    } catch (error) {
      useEditorStore
        .getState()
        .addToast(
          "error",
          error instanceof Error ? error.message : "Google Drive import failed."
        );
    } finally {
      setSharedImportProgress(null);
    }
  }, [kind, shareUrl]);

  const chooseFromDrive = () => {
    const store = useEditorStore.getState();
    if (config === null) {
      store.addToast("info", "Google Drive setup is still loading. Try again in a moment.");
      return;
    }
    if (!config?.configured || !config.clientId || !config.apiKey || !config.appId) {
      setLinkDialogOpen(true);
      return;
    }
    const oauth = window.google?.accounts?.oauth2;
    if (!gisReady || !pickerReady || !oauth) {
      store.addToast("info", "Google Drive is still loading. Try again in a moment.");
      return;
    }

    const client = oauth.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          try {
            window.sessionStorage.removeItem("captioncut:drive-consent");
          } catch {
            // Storage can be disabled without blocking the reconnect flow.
          }
          store.addToast(
            "error",
            response.error_description ?? "Google Drive access was not granted."
          );
          return;
        }
        try {
          window.sessionStorage.setItem("captioncut:drive-consent", "granted");
        } catch {
          // Storage can be disabled; this marker only avoids repeated consent prompts.
        }
        openPicker(response.access_token);
      },
      error_callback: () => store.addToast("error", "Google Drive sign-in was closed or blocked."),
    });
    let consentGranted = false;
    try {
      consentGranted = window.sessionStorage.getItem("captioncut:drive-consent") === "granted";
    } catch {
      // Fall back to the explicit first-use consent flow.
    }
    client.requestAccessToken({ prompt: consentGranted ? "" : "consent" });
  };

  const busy = importing !== null || fileUploading !== null;
  const busyLabel = importing
    ? `${importing.index}/${importing.total} ${importing.name}`
    : fileUploading
      ? `${fileUploading.index}/${fileUploading.total} ${fileUploading.name}`
      : "";
  const linkDialog =
    linkDialogOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) setLinkDialogOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="drive-import-title"
              className="w-full max-w-[470px] overflow-hidden rounded-[22px] bg-[#0e151d] shadow-2xl shadow-black/60 ring-1 ring-white/12"
            >
              <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
                <div>
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#7db8ff]">
                    No API keys needed
                  </p>
                  <h2
                    id="drive-import-title"
                    className="mt-1 text-base font-bold tracking-[-0.025em] text-[#edf3f8]"
                  >
                    Import from your Google Drive
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setLinkDialogOpen(false)}
                  disabled={busy}
                  aria-label="Close Google Drive import"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#708090] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="space-y-3 p-4">
                <div className="rounded-2xl bg-[#7db8ff]/[0.055] p-4 ring-1 ring-[#7db8ff]/15">
                  <div className="flex gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#7db8ff]/10 text-[#8ac4ff]">
                      <FileUp size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#dce8f2]">Choose a private file</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#748596]">
                        On a phone, choose Drive in the file browser. On a computer, choose
                        your Google Drive folder. No Drive sharing change is needed.
                      </p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="mt-3 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#7db8ff] px-3 text-[10px] font-extrabold text-[#07121c] transition hover:bg-[#9bd0ff] disabled:opacity-40"
                      >
                        {fileUploading ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <FileUp size={12} />
                        )}
                        Browse files
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
                  <div className="flex gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-[#9ba9b6]">
                      <Link2 size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#dce3e9]">Or paste a share link</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#74808c]">
                        In Drive, set General access to “Anyone with the link,” then copy the
                        file link here.
                      </p>
                    </div>
                  </div>
                  <label className="mt-3 block">
                    <span className="sr-only">Google Drive share link</span>
                    <input
                      ref={shareInputRef}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      value={shareUrl}
                      onChange={(event) => setShareUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void importSharedLink();
                      }}
                      placeholder="https://drive.google.com/file/d/…/view"
                      disabled={busy}
                      className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#080d12] px-3 text-[11px] text-[#dce5ed] placeholder:text-[#46525e] focus:border-[#7db8ff]/50 disabled:opacity-40"
                    />
                  </label>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <a
                      href="https://drive.google.com/drive/my-drive"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#718395] transition hover:text-[#9db5ca]"
                    >
                      Open Google Drive <ExternalLink size={10} />
                    </a>
                    <button
                      type="button"
                      onClick={() => void importSharedLink()}
                      disabled={busy || !shareUrl.trim()}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-[10px] font-bold text-[#dce5ed] ring-1 ring-white/[0.1] transition hover:bg-white/[0.12] disabled:opacity-35"
                    >
                      {importing ? <LoaderCircle size={12} className="animate-spin" /> : <Link2 size={12} />}
                      Import link
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {config?.configured && (
        <>
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => setGisReady(Boolean(window.google?.accounts?.oauth2))}
            onReady={() => setGisReady(Boolean(window.google?.accounts?.oauth2))}
            onError={() => setGisReady(false)}
          />
          <Script
            src="https://apis.google.com/js/api.js"
            strategy="afterInteractive"
            onLoad={() => {
              window.gapi?.load("picker", () => setPickerReady(Boolean(window.google?.picker)));
            }}
            onReady={() => {
              window.gapi?.load("picker", () => setPickerReady(Boolean(window.google?.picker)));
            }}
            onError={() => setPickerReady(false)}
          />
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={DRIVE_FILE_ACCEPT[kind]}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) {
            void handleFiles(files, { silentAudioTip: kind === "audio" }).then((assets) => {
              if (assets.length > 0) setLinkDialogOpen(false);
            });
          }
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={chooseFromDrive}
        disabled={disabled || busy}
        aria-busy={busy}
        className={className}
        title={
          config?.configured === false
            ? "Import from Google Drive without API keys"
            : "Choose video or audio from Google Drive"
        }
      >
        {busy ? (
          <>
            <LoaderCircle size={14} className="shrink-0 animate-spin" />
            <span className="truncate">{busyLabel}</span>
          </>
        ) : (
          children
        )}
      </button>
      {linkDialog}
    </>
  );
}

function readErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" && value.error.trim() ? value.error : null;
}

function isMediaAsset(value: unknown): value is MediaAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<Record<keyof MediaAsset, unknown>>;
  return (
    typeof asset.id === "string" &&
    typeof asset.filename === "string" &&
    typeof asset.originalName === "string" &&
    typeof asset.mimeType === "string" &&
    typeof asset.size === "number" &&
    typeof asset.duration === "number" &&
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    typeof asset.fps === "number" &&
    typeof asset.hasAudio === "boolean"
  );
}
