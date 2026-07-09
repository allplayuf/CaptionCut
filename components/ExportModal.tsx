"use client";

import { useEffect, useRef, useState } from "react";
import type { ExportJobState, ExportPresetId } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { formatTime } from "@/lib/video/timeline";
import { tracksDuration } from "@/lib/timeline/tracks";
import { buildExportRequest } from "@/lib/export/request";
import { EXPORT_PRESETS } from "@/lib/export/presets";
import { CheckCircle2, Download, X } from "lucide-react";

type Phase =
  | { name: "idle" }
  | { name: "running"; jobId: string; progress: number }
  | { name: "done"; jobId: string }
  | { name: "error"; message: string };

export default function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tracks = useEditorStore((s) => s.tracks);
  const captions = useEditorStore((s) => s.captions);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [presetId, setPresetId] = useState<ExportPresetId>("tiktok");
  const [lastOpen, setLastOpen] = useState(open);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration = tracksDuration(tracks);
  const preset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? EXPORT_PRESETS[0];
  const overlayCount = tracks
    .filter((t) => !["video", "caption"].includes(t.type) && !t.hidden)
    .reduce((sum, t) => sum + t.clips.length, 0);

  // Reset to a fresh idle state each time the modal is reopened.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setPhase({ name: "idle" });
  }

  useEffect(() => {
    if (!open && pollRef.current) clearInterval(pollRef.current);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open]);

  if (!open) return null;

  const startExport = async () => {
    const s = useEditorStore.getState();
    const payload = buildExportRequest({
      media: s.media,
      tracks: s.tracks,
      captions: s.captions,
      style: s.style,
      presetId,
    });
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Export failed to start.");

      const jobId = (body as ExportJobState).id;
      setPhase({ name: "running", jobId, progress: 0 });

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/export/${jobId}`);
          const state = (await r.json()) as ExportJobState & { error?: string };
          if (state.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({ name: "done", jobId });
          } else if (state.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({ name: "error", message: state.error ?? "Export failed." });
          } else {
            setPhase({ name: "running", jobId, progress: state.progress ?? 0 });
          }
        } catch {
          // transient poll failure — keep trying
        }
      }, 800);
    } catch (err) {
      setPhase({ name: "error", message: err instanceof Error ? err.message : "Export failed." });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[440px] rounded-2xl border border-white/10 bg-[#16161f] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-100">Export Video</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        {phase.name === "idle" && (
          <div className="mb-4 flex flex-col gap-1.5">
            {EXPORT_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPresetId(p.id)}
                className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${
                  p.id === presetId
                    ? "bg-violet-500/15 ring-violet-400"
                    : "bg-white/4 ring-white/10 hover:bg-white/8"
                }`}
              >
                <p className="text-sm font-semibold text-zinc-100">{p.name}</p>
                <p className="text-[11px] text-zinc-500">{p.description}</p>
              </button>
            ))}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <Spec label="Format" value={`9:16 · ${preset.width}×${preset.height} · ${preset.fps}fps`} />
          <Spec label="Duration" value={formatTime(duration)} />
          <Spec
            label="Captions"
            value={captions.length > 0 ? `${captions.length} burned in` : "none"}
          />
          <Spec label="Layers" value={overlayCount > 0 ? `${overlayCount} overlay clips` : "video only"} />
        </div>

        {phase.name === "idle" && (
          <>
            {duration > 180 && (
              <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-300">
                This video is over 3 minutes — rendering may take several minutes.
              </p>
            )}
            <button
              onClick={() => void startExport()}
              className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98]"
            >
              Start export
            </button>
          </>
        )}

        {phase.name === "running" && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
              <span>Rendering…</span>
              <span className="font-mono">{Math.round(phase.progress * 100)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
                style={{ width: `${Math.max(2, Math.round(phase.progress * 100))}%` }}
              />
            </div>
            <p className="mt-3 text-center text-[11px] text-zinc-500">
              Cutting, zooming, mixing audio and burning captions in…
            </p>
          </div>
        )}

        {phase.name === "done" && (
          <div className="flex flex-col items-center gap-3 py-2">
            <CheckCircle2 size={36} className="text-emerald-400" />
            <p className="text-sm font-medium text-zinc-200">Your video is ready!</p>
            <a
              href={`/api/export/${phase.jobId}/download`}
              download
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110"
            >
              <Download size={15} /> Download MP4
            </a>
          </div>
        )}

        {phase.name === "error" && (
          <div>
            <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs leading-snug text-rose-300">
              {phase.message}
            </p>
            <button
              onClick={() => void startExport()}
              className="w-full rounded-xl bg-white/10 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/15"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/8">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 font-medium text-zinc-200">{value}</p>
    </div>
  );
}
