"use client";

import { useEffect, useRef, useState } from "react";
import type { Caption, TranscriptionLanguage } from "@/types";
import { buildProjectSnapshot, useEditorStore } from "@/hooks/useEditorStore";
import { totalDuration } from "@/lib/video/timeline";
import { Plus, Sparkles, Trash2 } from "lucide-react";

/** Right panel, Captions tab: auto-caption trigger + line-by-line editor. */
export default function CaptionsPanel() {
  const captions = useEditorStore((s) => s.captions);
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  const isTranscribing = useEditorStore((s) => s.isTranscribing);

  const setCaptions = useEditorStore((s) => s.setCaptions);
  const setTranscribing = useEditorStore((s) => s.setTranscribing);
  const addCaptionAtPlayhead = useEditorStore((s) => s.addCaptionAtPlayhead);
  const addToast = useEditorStore((s) => s.addToast);

  const [language, setLanguage] = useState<TranscriptionLanguage>("auto");
  const duration = totalDuration(clips);

  const runAutoCaptions = async () => {
    if (clips.length === 0) {
      addToast("info", "Upload a video first.");
      return;
    }
    setTranscribing(true);
    try {
      // Heads-up when the free local model still needs its one-time download.
      try {
        const status = await (await fetch("/api/transcribe")).json();
        if (status?.provider === "local-whisper" && status.ready === false) {
          addToast(
            "info",
            "First run: downloading the free local speech model (~150 MB). This happens once — captions will start right after."
          );
        }
      } catch {
        // status probe is best-effort
      }

      const state = useEditorStore.getState();
      const snapshot = buildProjectSnapshot(state);
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media: snapshot.media, clips: snapshot.clips, language }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Transcription failed.");

      setCaptions(body.captions as Caption[]);
      if (body.provider === "mock") {
        addToast("info", "Demo captions generated (mock mode). Unset TRANSCRIPTION_PROVIDER for real local transcription.");
      } else {
        addToast("success", `Generated ${body.captions.length} captions ✨`);
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/8 p-3">
        <div className="mb-2 flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400"
            title="Spoken language"
          >
            <option value="auto">Detect language</option>
            <option value="en">English</option>
            <option value="sv">Svenska</option>
          </select>
        </div>
        <button
          onClick={runAutoCaptions}
          disabled={isTranscribing || clips.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {isTranscribing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Transcribing…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Auto Captions
            </>
          )}
        </button>
        {isTranscribing && (
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {duration > 180
              ? "Long video — local transcription can take a few minutes."
              : "Running locally on your machine — free & private."}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {captions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs leading-relaxed text-zinc-600">
            No captions yet.
            <br />
            Hit <span className="font-semibold text-zinc-400">Auto Captions</span> to transcribe
            your video into punchy TikTok-style lines.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {captions.map((cap) => (
              <CaptionRow
                key={cap.id}
                caption={cap}
                active={currentTime >= cap.startTime && currentTime < cap.endTime}
                selected={cap.id === selectedCaptionId}
              />
            ))}
          </div>
        )}
        <button
          onClick={addCaptionAtPlayhead}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs font-medium text-zinc-400 transition hover:border-violet-400/50 hover:text-violet-300"
        >
          <Plus size={13} /> Add caption at playhead
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function CaptionRow({
  caption,
  active,
  selected,
}: {
  caption: Caption;
  active: boolean;
  selected: boolean;
}) {
  const updateCaptionText = useEditorStore((s) => s.updateCaptionText);
  const updateCaptionTiming = useEditorStore((s) => s.updateCaptionTiming);
  const deleteCaption = useEditorStore((s) => s.deleteCaption);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <div
      ref={rowRef}
      className={`group rounded-lg p-2 ring-1 transition ${
        active
          ? "bg-violet-500/15 ring-violet-400/50"
          : selected
            ? "bg-white/8 ring-white/20"
            : "bg-white/3 ring-white/5 hover:bg-white/6"
      }`}
      onClick={() => {
        selectCaption(caption.id);
        setPlaying(false);
        setCurrentTime(caption.startTime + 0.001);
      }}
    >
      <input
        value={caption.text}
        onChange={(e) => updateCaptionText(caption.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-transparent text-xs font-medium text-zinc-100 outline-none placeholder:text-zinc-600"
        placeholder="Caption text…"
      />
      <div className="mt-1 flex items-center gap-1">
        <TimeInput
          value={caption.startTime}
          onCommit={(v) => updateCaptionTiming(caption.id, v, caption.endTime)}
        />
        <span className="text-[9px] text-zinc-600">→</span>
        <TimeInput
          value={caption.endTime}
          onCommit={(v) => updateCaptionTiming(caption.id, caption.startTime, v)}
        />
        {caption.words && (
          <span
            className="ml-1 rounded bg-emerald-500/15 px-1 text-[8px] font-semibold uppercase tracking-wide text-emerald-400"
            title="Word-level timestamps available — word highlighting works"
          >
            words
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteCaption(caption.id);
          }}
          className="ml-auto rounded p-1 text-zinc-600 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
          title="Delete caption"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/** Seconds input that commits on blur/Enter so typing isn't fighting the store. */
function TimeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Sync the draft when the store value changes underneath us (unless typing).
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) setDraft(value.toFixed(2));
  }

  const commit = () => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed)) onCommit(parsed);
    setFocused(false);
  };

  return (
    <input
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
      className="w-14 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-center font-mono text-[10px] text-zinc-400 outline-none focus:border-violet-400"
    />
  );
}
