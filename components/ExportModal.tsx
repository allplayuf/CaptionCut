"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportJobState, ExportPhase, ExportPresetId, MediaAsset, Track } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { formatTime } from "@/lib/video/timeline";
import { mainVideoTrack, tracksDuration } from "@/lib/timeline/tracks";
import { buildExportRequest } from "@/lib/export/request";
import { EXPORT_PRESETS } from "@/lib/export/presets";
import { FORMATS } from "@/lib/video/formats";
import { mapWithConcurrency } from "@/lib/shared/concurrency";
import {
  AlertTriangle,
  Captions,
  Check,
  CheckCircle2,
  Download,
  Film,
  Layers3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

interface Preflight {
  missingMedia: string[];
  notes: string[];
  checking: boolean;
}

async function runPreflight(
  tracks: Track[],
  media: Pick<MediaAsset, "id" | "originalName" | "storageUrl" | "linkedAudio">[]
): Promise<string[]> {
  const referenced = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.assetId) referenced.add(clip.assetId);
    }
  }
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  for (const id of [...referenced]) {
    const linkedAudioId = mediaById.get(id)?.linkedAudio?.audioAssetId;
    if (linkedAudioId) referenced.add(linkedAudioId);
  }

  const missing: string[] = [];
  await mapWithConcurrency([...referenced], 4, async (id) => {
      const asset = mediaById.get(id);
      if (!asset) {
        missing.push(id);
        return;
      }
      try {
        const response = await fetch(asset.storageUrl ?? `/api/media/${id}`, {
          headers: { Range: "bytes=0-0" },
          cache: "no-store",
        });
        if (!response.ok) missing.push(asset.originalName);
      } catch {
        missing.push(asset.originalName);
      }
    });
  return missing.sort();
}

type Phase =
  | { name: "idle" }
  | { name: "running"; jobId: string; progress: number; phase?: ExportPhase; detail?: string }
  | { name: "done"; jobId: string }
  | { name: "error"; message: string };

const ACTIVE_EXPORT_KEY = "captioncut-active-export-v1";

function rememberActiveExport(jobId: string, startedAt: number): void {
  try {
    window.localStorage.setItem(ACTIVE_EXPORT_KEY, JSON.stringify({ jobId, startedAt }));
  } catch {
    // Durable server-side job state still works when browser storage is unavailable.
  }
}

function recallActiveExport(): { jobId: string; startedAt: number } | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(ACTIVE_EXPORT_KEY) ?? "null") as {
      jobId?: unknown;
      startedAt?: unknown;
    } | null;
    if (
      value &&
      typeof value.jobId === "string" &&
      /^[a-zA-Z0-9_-]{6,32}$/.test(value.jobId) &&
      typeof value.startedAt === "number" &&
      Date.now() - value.startedAt < 24 * 60 * 60 * 1000
    ) {
      return { jobId: value.jobId, startedAt: value.startedAt };
    }
  } catch {
    // Ignore corrupt or unavailable browser storage.
  }
  forgetActiveExport();
  return null;
}

function forgetActiveExport(): void {
  try {
    window.localStorage.removeItem(ACTIVE_EXPORT_KEY);
  } catch {
    // Nothing else to clean up.
  }
}

function exportPhaseLabel(phase?: ExportPhase): string {
  if (phase === "queued") return "Återansluter till renderingen…";
  if (phase === "preparing") return "Kontrollerar och förbereder källmaterialet…";
  if (phase === "uploading") return "Slutför och sparar masterfilen…";
  return "Klipp, effekter, ljud och captions renderas i den färdiga videon.";
}

export default function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ExportDialog onClose={onClose} /> : null;
}

/** Mounted fresh for every open, so render state never leaks between exports. */
function ExportDialog({ onClose }: { onClose: () => void }) {
  const tracks = useEditorStore((state) => state.tracks);
  const captions = useEditorStore((state) => state.captions);
  const format = useEditorStore((state) => state.format);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [presetId, setPresetId] = useState<ExportPresetId>(() => FORMATS[format].presetId);
  const [preflight, setPreflight] = useState<Preflight>({
    missingMedia: [],
    notes: [],
    checking: true,
  });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [startedAt, setStartedAt] = useState(0);

  const pollExport = useCallback(
    async function pollExportJob(jobId: string, jobStartedAt: number, failures = 0) {
      try {
        const statusResponse = await fetch(`/api/export/${jobId}`, { cache: "no-store" });
        if (!statusResponse.ok) {
          if (statusResponse.status === 404) forgetActiveExport();
          throw new Error("Exportstatus saknas.");
        }
        const status = (await statusResponse.json()) as ExportJobState & { error?: string };
        if (status.status === "done") {
          setPhase({ name: "done", jobId });
          return;
        }
        if (status.status === "error") {
          forgetActiveExport();
          setPhase({ name: "error", message: status.error ?? "Renderingen misslyckades." });
          return;
        }
        setPhase({
          name: "running",
          jobId,
          progress: status.progress ?? 0,
          phase: status.phase,
          detail: status.detail,
        });
        failures = 0;
      } catch {
        failures += 1;
      }
      const elapsed = Date.now() - jobStartedAt;
      const delay = failures > 0 ? Math.min(8_000, 1_500 * 2 ** Math.min(2, failures)) : elapsed > 60_000 ? 2_500 : 1_200;
      pollRef.current = setTimeout(
        () => void pollExportJob(jobId, jobStartedAt, failures),
        delay
      );
    },
    []
  );

  const duration = tracksDuration(tracks);
  const preset = EXPORT_PRESETS.find((candidate) => candidate.id === presetId) ?? EXPORT_PRESETS[0];
  const aspect = aspectLabel(preset.width, preset.height);
  const mainClipCount = mainVideoTrack(tracks).clips.length;
  const layerCount = tracks
    .filter((track) => !["video", "caption"].includes(track.type) && !track.hidden)
    .reduce((sum, track) => sum + track.clips.length, 0);

  useEffect(() => {
    const state = useEditorStore.getState();
    const mainTrack = mainVideoTrack(state.tracks);
    const notes: string[] = [];
    const stabilized = mainTrack.clips.filter((clip) => clip.stabilize).length;
    if (stabilized > 0) {
      notes.push(`${stabilized} klipp stabiliseras och får den beskärning som visas i förhandsvisningen.`);
    }
    const fitClips = mainTrack.clips.filter((clip) => clip.fit === "fit").length;
    if (fitClips > 0) {
      notes.push(`${fitClips} klipp renderas med hela bilden över en mjuk, suddig bakgrund.`);
    }

    let cancelled = false;
    void runPreflight(state.tracks, state.media).then((missingMedia) => {
      if (!cancelled) setPreflight({ missingMedia, notes, checking: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const active = recallActiveExport();
    if (!active) return;
    setStartedAt(active.startedAt);
    setPhase({ name: "running", jobId: active.jobId, progress: 0, phase: "queued" });
    void pollExport(active.jobId, active.startedAt);
  }, [pollExport]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const startExport = async () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    const state = useEditorStore.getState();
    const payload = buildExportRequest({
      media: state.media,
      tracks: state.tracks,
      captions: state.captions,
      style: state.style,
      presetId,
    });

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ExportJobState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Renderingen kunde inte starta.");

      const jobId = body.id;
      const jobStartedAt = Date.now();
      setStartedAt(jobStartedAt);
      rememberActiveExport(jobId, jobStartedAt);
      setPhase({ name: "running", jobId, progress: 0, phase: body.phase, detail: body.detail });
      pollRef.current = setTimeout(() => void pollExport(jobId, jobStartedAt), 500);
    } catch (error) {
      setPhase({
        name: "error",
        message: error instanceof Error ? error.message : "Renderingen misslyckades.",
      });
    }
  };

  const canClose = true;
  const dialogRef = useDialogA11y<HTMLDivElement>({
    open: true,
    onClose,
    canClose,
    initialFocusRef: closeButtonRef,
  });

  return (
    <div
      className="render-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onMouseDown={(event) => {
        if (canClose && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        aria-describedby="export-description"
        tabIndex={-1}
        className="render-room relative max-h-[94dvh] w-full max-w-[680px] overflow-y-auto rounded-[28px] border border-white/[0.09] bg-[#0c1117] shadow-[0_34px_110px_rgba(0,0,0,.72)]"
      >
        <div className="render-room-glow pointer-events-none absolute inset-x-0 top-0 h-40" />

        <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="render-icon mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
              <Film size={19} />
            </span>
            <div className="min-w-0">
              <p className="panel-eyebrow text-[var(--cut)]">Render room</p>
              <h2 id="export-title" className="mt-1 text-[22px] font-semibold tracking-[-0.045em] text-[#f4f6f7]">
                Exportera masterfil
              </h2>
              <p id="export-description" className="mt-1 text-[11px] leading-relaxed text-[#73808c]">
                En ny MP4 byggs från tidslinjen. Captions, klipp, lager och effekter bränns in i filen.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="icon-button h-8 w-8 disabled:cursor-not-allowed disabled:opacity-25"
            aria-label="Stäng export"
            title="Stäng — exporten fortsätter"
          >
            <X size={16} />
          </button>
        </header>

        <div className="relative p-5 sm:p-7">
          {phase.name === "idle" && (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="panel-eyebrow text-[#7a8793]">Leveransformat</p>
                  <span className="font-mono text-[9px] text-[#56626e]">H.264 · AAC · MP4</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {EXPORT_PRESETS.map((candidate) => {
                    const selected = candidate.id === presetId;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setPresetId(candidate.id)}
                        aria-pressed={selected}
                        className={`render-preset group relative rounded-2xl px-3 py-3 text-left transition sm:px-4 ${
                          selected ? "render-preset-selected" : "hover:bg-white/[0.045]"
                        } ${candidate.id === "draft" ? "col-span-2 sm:col-span-1" : ""}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-bold text-[#e7ebef]">{candidate.name}</span>
                          {selected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cut)] text-[#171009]">
                              <Check size={11} strokeWidth={3} />
                            </span>
                          )}
                        </span>
                        <span className="render-preset-description mt-1 block text-[10px] leading-snug text-[#65727e]">
                          {candidate.description}
                        </span>
                        <span className="mt-2 block font-mono text-[9px] text-[#8c98a3]">
                          {candidate.width}×{candidate.height} · {candidate.fps} fps
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="panel-eyebrow text-[#7a8793]">Renderkvitto</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--caption)]/[0.08] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--caption)] ring-1 ring-[var(--caption)]/15">
                    <ShieldCheck size={10} /> Förkontrollerad
                  </span>
                </div>
                <div className="render-receipt grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.075] sm:grid-cols-4">
                  <Spec icon={<Film size={13} />} label="Klipp" value={String(mainClipCount)} />
                  <Spec icon={<Captions size={13} />} label="Captions" value={captions.length ? `${captions.length} inbrända` : "Inga"} />
                  <Spec icon={<Layers3 size={13} />} label="Lager" value={layerCount ? String(layerCount) : "Endast video"} />
                  <Spec icon={<Sparkles size={13} />} label="Master" value={`${aspect} · ${formatTime(duration)}`} />
                </div>
              </section>

              <div className="mt-4 space-y-2">
                {preflight.missingMedia.length > 0 && (
                  <Notice tone="danger" icon={<AlertTriangle size={13} />}>
                    <strong>Export blockerad.</strong> Lägg tillbaka eller radera: {preflight.missingMedia.join(", ")}.
                  </Notice>
                )}
                {aspect !== format && (
                  <Notice tone="info" icon={<Layers3 size={13} />}>
                    Projektet är {format}, men exporten är {aspect}. Bilden beskärs om och captions skalas till det nya formatet.
                  </Notice>
                )}
                {preflight.notes.map((note) => (
                  <Notice key={note} tone="neutral" icon={<Sparkles size={13} />}>
                    {note}
                  </Notice>
                ))}
                {duration > 180 && (
                  <Notice tone="warning" icon={<AlertTriangle size={13} />}>
                    Videon är över tre minuter. Molnrenderingen kan ta flera minuter.
                  </Notice>
                )}
              </div>

              <button
                type="button"
                data-testid="start-export"
                onClick={() => void startExport()}
                disabled={preflight.checking || preflight.missingMedia.length > 0}
                className="render-primary mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[12px] font-extrabold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
              >
                {preflight.checking ? (
                  <><LoaderCircle size={15} className="animate-spin" /> Kontrollerar material…</>
                ) : (
                  <><Sparkles size={15} /> Rendera med alla redigeringar</>
                )}
              </button>
            </>
          )}

          {phase.name === "running" && (
            <div className="py-5 sm:py-8" role="status" aria-live="polite">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-[var(--cut)]/[0.08] text-[var(--cut)] ring-1 ring-[var(--cut)]/15">
                <LoaderCircle size={34} className="animate-spin" strokeWidth={1.6} />
              </div>
              <div className="mx-auto mt-6 max-w-[460px] text-center">
                <p className="panel-eyebrow text-[var(--cut)]">Master render</p>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-[#eef2f5]">
                  Bygger din färdiga video
                </h3>
                <p className="mt-2 text-[11px] leading-relaxed text-[#71808c]">
                  {phase.detail ?? exportPhaseLabel(phase.phase)}
                </p>
              </div>
              <div className="mx-auto mt-7 max-w-[500px]">
                <div className="mb-2 flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-[#8f9aa5]">Renderar</span>
                  <span className="font-mono text-[var(--cut)]">{Math.round(phase.progress * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]">
                  <div
                    role="progressbar"
                    aria-label="Renderingsförlopp"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(phase.progress * 100)}
                    className="render-progress h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(2, Math.round(phase.progress * 100))}%` }}
                  />
                </div>
                <p className="mt-3 text-center font-mono text-[9px] text-[#5e6b76]">
                  Exporten fortsätter om du stänger rutan eller laddar om{remainingLabel(phase.progress, startedAt)}
                </p>
              </div>
            </div>
          )}

          {phase.name === "done" && (
            <div className="py-4 text-center sm:py-7" role="status" aria-live="polite">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-[var(--caption)]/[0.09] text-[var(--caption)] ring-1 ring-[var(--caption)]/20">
                <CheckCircle2 size={36} strokeWidth={1.7} />
              </div>
              <p className="panel-eyebrow mt-6 text-[var(--caption)]">Render complete</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.045em] text-[#f1f4f6]">
                Masterfilen är klar.
              </h3>
              <p className="mx-auto mt-2 max-w-[430px] text-[11px] leading-relaxed text-[#74818c]">
                Den nedladdade MP4-filen innehåller {captions.length} inbrända captions och {layerCount} redigeringslager.
              </p>
              <a
                data-testid="download-export"
                href={`/api/export/${phase.jobId}?download=1`}
                download
                className="render-primary mx-auto mt-6 flex h-12 w-full max-w-[440px] items-center justify-center gap-2 rounded-2xl px-5 text-[12px] font-extrabold transition hover:brightness-105 active:translate-y-px"
              >
                <Download size={16} /> Ladda ner färdig MP4
              </a>
              <button
                type="button"
                onClick={() => {
                  forgetActiveExport();
                  setPhase({ name: "idle" });
                }}
                className="secondary-compact mt-3 h-10 w-full max-w-[440px] rounded-xl"
              >
                Exportera en ny version
              </button>
              <button type="button" onClick={onClose} className="mt-3 text-[10px] font-semibold text-[#6f7b86] transition hover:text-[#c8d0d7]">
                Tillbaka till editorn
              </button>
            </div>
          )}

          {phase.name === "error" && (
            <div className="py-3 sm:py-5" role="alert">
              <Notice tone="danger" icon={<AlertTriangle size={14} />}>
                <strong>Renderingen avbröts.</strong> {phase.message}
              </Notice>
              <button
                type="button"
                onClick={() => void startExport()}
                className="secondary-compact mt-4 h-11 w-full rounded-xl"
              >
                Försök igen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function aspectLabel(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(ratio - 1) < 0.01) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.01) return "16:9";
  return `${width}:${height}`;
}

function remainingLabel(progress: number, startedAt: number): string {
  if (progress < 0.04 || !startedAt) return "";
  const elapsed = (Date.now() - startedAt) / 1000;
  const remaining = Math.round((elapsed / progress) * (1 - progress));
  if (remaining < 3) return "";
  return remaining >= 90
    ? ` · cirka ${Math.round(remaining / 60)} min kvar`
    : ` · cirka ${remaining} s kvar`;
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#10161d] px-3 py-3">
      <p className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.13em] text-[#5f6c78]">
        <span className="text-[#84919d]">{icon}</span> {label}
      </p>
      <p className="mt-1.5 truncate text-[10px] font-semibold text-[#d2d9df]">{value}</p>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "danger" | "warning" | "info" | "neutral";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = {
    danger: "bg-rose-500/[0.08] text-rose-200 ring-rose-400/15",
    warning: "bg-amber-400/[0.07] text-amber-200 ring-amber-300/15",
    info: "bg-sky-400/[0.07] text-sky-200 ring-sky-300/15",
    neutral: "bg-white/[0.025] text-[#8d99a4] ring-white/[0.065]",
  }[tone];
  return (
    <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed ring-1 ${toneClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
