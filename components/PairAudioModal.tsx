"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { suggestAudioSync } from "@/lib/audio/sync";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import {
  Check,
  Cloud,
  Film,
  Link2,
  Music,
  RefreshCw,
  Unlink2,
  X,
} from "lucide-react";

/**
 * Pair a separate recorder track with a camera clip: pick the audio, find the
 * offset (auto-detected from the waveforms or nudged by hand), and decide
 * whether the camera's own scratch audio stays audible.
 */
export function PairAudioModal({
  video,
  audios,
  onClose,
}: {
  video: MediaAsset;
  audios: MediaAsset[];
  onClose: () => void;
}) {
  const recommended = bestAudioMatch(video, audios);
  const initialAudioId = video.linkedAudio?.audioAssetId ?? recommended?.id ?? audios[0]?.id ?? "";
  const [audioId, setAudioId] = useState(initialAudioId);
  const [offsetSeconds, setOffsetSeconds] = useState(video.linkedAudio?.offsetSeconds ?? 0);
  const [muteCameraAudio, setMuteCameraAudio] = useState(
    video.linkedAudio?.muteCameraAudio ?? true
  );
  const [syncMethod, setSyncMethod] = useState<"starts" | "waveform" | "manual">(
    video.linkedAudio?.syncMethod ?? "starts"
  );
  const [confidence, setConfidence] = useState(video.linkedAudio?.confidence);
  const dialogRef = useRef<HTMLDivElement>(null);
  const analyses = useEditorStore((s) => s.analyses);
  const linkAudioToVideo = useEditorStore((s) => s.linkAudioToVideo);
  const unlinkAudioFromVideo = useEditorStore((s) => s.unlinkAudioFromVideo);
  // A Drive import can finish while this dialog is open. Resolve a fresh
  // fallback during render so the controlled select becomes usable without
  // a cascading state update in an effect.
  const resolvedAudioId = audios.some((candidate) => candidate.id === audioId)
    ? audioId
    : bestAudioMatch(video, audios)?.id ?? audios[0]?.id ?? "";
  const audio = audios.find((candidate) => candidate.id === resolvedAudioId);
  const canWaveformSync = Boolean(
    analyses[video.id]?.audio && analyses[resolvedAudioId]?.audio
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const nudge = (delta: number) => {
    setOffsetSeconds((value) => Math.round((value + delta) * 100) / 100);
    setSyncMethod("manual");
    setConfidence(undefined);
  };

  const autoSync = () => {
    const suggestion = suggestAudioSync(analyses[video.id], analyses[resolvedAudioId]);
    if (!suggestion) {
      useEditorStore
        .getState()
        .addToast("info", "Sound analysis is not ready for both files yet. Align their starts for now.");
      return;
    }
    setOffsetSeconds(suggestion.offsetSeconds);
    setConfidence(suggestion.confidence);
    setSyncMethod("waveform");
    useEditorStore.getState().addToast(
      suggestion.confidence >= 0.55 ? "success" : "info",
      suggestion.confidence >= 0.55
        ? `Sound matched at ${formatSignedSeconds(suggestion.offsetSeconds)}.`
        : "A possible sound match was found. Preview it and fine-tune the offset if needed."
    );
  };

  const confirm = () => {
    if (!audio) return;
    linkAudioToVideo(video.id, audio.id, {
      offsetSeconds,
      muteCameraAudio,
      syncMethod,
      confidence,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-audio-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-[#12121b] shadow-2xl shadow-black/70 ring-1 ring-white/12"
      >
        <div className="flex items-start justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              <Link2 size={11} /> Linked sources
            </p>
            <h2 id="pair-audio-title" className="text-base font-bold text-zinc-100">
              Pair video with separate audio
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              The audio follows every trim, split, reorder and speed change on this video.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
            aria-label="Close audio pairing"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SourceChip icon={<Film size={13} />} tone="video" name={video.originalName} />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 to-emerald-500/25 text-emerald-300 ring-1 ring-white/10">
              <Link2 size={13} />
            </div>
            <SourceChip
              icon={<Music size={13} />}
              tone="audio"
              name={audio?.originalName ?? "Choose audio"}
            />
          </div>

          {audios.length === 0 ? (
            <div className="rounded-xl border border-dashed border-emerald-400/25 bg-emerald-500/[0.05] p-4 text-center">
              <Music size={18} className="mx-auto text-emerald-300" />
              <p className="mt-2 text-xs font-semibold text-zinc-200">Add the separate audio first</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                Import a recorder, microphone or sound file, then choose it here.
              </p>
              <GoogleDriveButton
                kind="audio"
                className="mx-auto mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-[10px] font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/12"
              >
                <Cloud size={12} className="text-sky-300" /> Choose from Drive
              </GoogleDriveButton>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Audio file
                </span>
                <select
                  value={resolvedAudioId}
                  onChange={(event) => {
                    setAudioId(event.target.value);
                    setOffsetSeconds(0);
                    setSyncMethod("starts");
                    setConfidence(undefined);
                  }}
                  className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs text-zinc-200 outline-none ring-1 ring-white/10 transition focus:ring-emerald-400/50"
                >
                  {audios.map((candidate) => (
                    <option key={candidate.id} value={candidate.id} className="bg-zinc-900">
                      {candidate.originalName}
                      {candidate.id === recommended?.id ? " · best match" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl bg-black/20 p-3 ring-1 ring-white/8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-zinc-200">Sync timing</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      Match scratch audio automatically, or align the starts.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={autoSync}
                    disabled={!canWaveformSync}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500/12 px-2.5 py-2 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/20 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      canWaveformSync
                        ? "Match the two recordings by their sound energy"
                        : "Audio analysis is still preparing"
                    }
                  >
                    <RefreshCw size={11} /> Auto-sync sound
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => nudge(-0.1)}
                    className="h-8 rounded-lg bg-white/6 px-2.5 font-mono text-xs text-zinc-300 ring-1 ring-white/8 hover:bg-white/10"
                    title="Advance audio by 0.1 seconds"
                  >
                    −0.1
                  </button>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Audio delay in seconds</span>
                    <div className="relative">
                      <input
                        type="number"
                        min={-600}
                        max={600}
                        step={0.01}
                        value={offsetSeconds}
                        onChange={(event) => {
                          setOffsetSeconds(Number(event.target.value) || 0);
                          setSyncMethod("manual");
                          setConfidence(undefined);
                        }}
                        className="h-8 w-full rounded-lg bg-white/[0.06] px-2 pr-7 text-center font-mono text-xs tabular-nums text-zinc-100 outline-none ring-1 ring-white/10 focus:ring-emerald-400/50"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-zinc-600">
                        s
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => nudge(0.1)}
                    className="h-8 rounded-lg bg-white/6 px-2.5 font-mono text-xs text-zinc-300 ring-1 ring-white/8 hover:bg-white/10"
                    title="Delay audio by 0.1 seconds"
                  >
                    +0.1
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-zinc-600">
                  <span>Negative advances · positive delays audio</span>
                  <span className="font-mono text-emerald-400/80">
                    {syncMethod === "waveform"
                      ? `${Math.round((confidence ?? 0) * 100)}% match`
                      : syncMethod === "manual"
                        ? "manual"
                        : "starts aligned"}
                  </span>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/[0.035] p-3 ring-1 ring-white/8">
                <input
                  type="checkbox"
                  checked={muteCameraAudio}
                  onChange={(event) => setMuteCameraAudio(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                />
                <span>
                  <span className="block text-[11px] font-semibold text-zinc-200">
                    Use the separate audio instead of camera audio
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                    Turn this off to mix both recordings together.
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/8 bg-black/15 px-5 py-3.5">
          {video.linkedAudio ? (
            <button
              type="button"
              onClick={() => {
                unlinkAudioFromVideo(video.id);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold text-rose-300 transition hover:bg-rose-500/10"
            >
              <Unlink2 size={12} /> Unlink
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[10px] font-semibold text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!audio}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-emerald-500 px-3 py-2 text-[10px] font-bold text-white shadow-lg shadow-emerald-500/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={12} /> {video.linkedAudio ? "Update pair" : "Pair sources"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceChip({
  icon,
  name,
  tone,
}: {
  icon: React.ReactNode;
  name: string;
  tone: "video" | "audio";
}) {
  return (
    <div
      className={`min-w-0 rounded-xl p-2.5 ring-1 ${
        tone === "video"
          ? "bg-violet-500/8 text-violet-300 ring-violet-400/15"
          : "bg-emerald-500/8 text-emerald-300 ring-emerald-400/15"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="truncate text-[10px] font-semibold text-zinc-200" title={name}>
          {name}
        </span>
      </div>
    </div>
  );
}

function bestAudioMatch(video: MediaAsset, audios: MediaAsset[]): MediaAsset | undefined {
  const videoTokens = nameTokens(video.originalName);
  return [...audios]
    .map((audio) => {
      const audioTokens = nameTokens(audio.originalName);
      const shared = audioTokens.filter((token) => videoTokens.includes(token)).length;
      const durationDelta = Math.abs(video.duration - audio.duration);
      const durationScore = 1 - Math.min(1, durationDelta / Math.max(1, video.duration));
      return { audio, score: shared * 3 + durationScore };
    })
    .sort((a, b) => b.score - a.score)[0]?.audio;
}

function nameTokens(name: string): string[] {
  const ignored = new Set(["audio", "video", "track", "recording", "rec", "mic", "camera", "cam"]);
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function formatSignedSeconds(seconds: number): string {
  const value = Math.round(seconds * 100) / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}s`;
}
