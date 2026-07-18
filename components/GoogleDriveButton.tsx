"use client";

import Script from "next/script";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MediaAsset } from "@/types";
import { registerImportedMedia } from "@/hooks/useMediaUpload";
import { useEditorStore } from "@/hooks/useEditorStore";
import { LoaderCircle } from "lucide-react";

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
          if (response.status === 401) accessExpired = true;
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

  const chooseFromDrive = () => {
    const store = useEditorStore.getState();
    if (config === null) {
      store.addToast("info", "Google Drive setup is still loading. Try again in a moment.");
      return;
    }
    if (!config?.configured || !config.clientId || !config.apiKey || !config.appId) {
      store.addToast(
        "error",
        "Google Drive needs GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_API_KEY and GOOGLE_DRIVE_APP_ID."
      );
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

  const busy = importing !== null;
  return (
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
      <button
        type="button"
        onClick={chooseFromDrive}
        disabled={disabled || busy}
        aria-busy={busy}
        className={className}
        title={
          config?.configured === false
            ? "Google Drive setup is required"
            : "Choose video or audio from Google Drive"
        }
      >
        {busy ? (
          <>
            <LoaderCircle size={14} className="shrink-0 animate-spin" />
            <span className="truncate">
              {importing.index}/{importing.total} {importing.name}
            </span>
          </>
        ) : (
          children
        )}
      </button>
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
