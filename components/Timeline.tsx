"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { computePeaks, placeholderPeaks } from "@/lib/audio/waveform";
import { clipDuration, clipStartTime, formatTime, totalDuration } from "@/lib/video/timeline";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Scissors, Trash2 } from "lucide-react";

const LANE_PADDING = 16;

export default function Timeline() {
  const clips = useEditorStore((s) => s.clips);
  const media = useEditorStore((s) => s.media);
  const captions = useEditorStore((s) => s.captions);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const waveforms = useEditorStore((s) => s.waveforms);

  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const deleteClip = useEditorStore((s) => s.deleteClip);
  const moveClip = useEditorStore((s) => s.moveClip);
  const trimClip = useEditorStore((s) => s.trimClip);
  const setWaveform = useEditorStore((s) => s.setWaveform);

  const laneRef = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(800);
  const waveformStartedRef = useRef<Set<string>>(new Set());

  const duration = Math.max(totalDuration(clips), 0.001);
  const pxPerSec = (laneWidth - 2 * LANE_PADDING) / duration;

  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setLaneWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Kick off waveform decoding for any media that hasn't been processed yet.
  useEffect(() => {
    for (const clip of clips) {
      const id = clip.mediaId;
      if (waveforms[id] !== undefined || waveformStartedRef.current.has(id)) continue;
      waveformStartedRef.current.add(id);
      computePeaks(mediaUrl(id))
        .then((peaks) => setWaveform(id, peaks))
        .catch(() => setWaveform(id, null)); // placeholder pattern will be used
    }
  }, [clips, waveforms, setWaveform]);

  const timeFromEvent = (e: React.PointerEvent) => {
    const rect = laneRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - LANE_PADDING;
    return Math.max(0, Math.min(duration, x / pxPerSec));
  };

  const onScrub = (e: React.PointerEvent) => {
    if (clips.length === 0) return;
    setPlaying(false);
    setCurrentTime(timeFromEvent(e));
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = laneRef.current!.getBoundingClientRect();
      const x = ev.clientX - rect.left - LANE_PADDING;
      setCurrentTime(Math.max(0, Math.min(duration, x / pxPerSec)));
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  };

  const ruler = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((st) => st * pxPerSec >= 64) ?? 60;
    const marks: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += step) marks.push(t);
    return { marks, step };
  }, [duration, pxPerSec]);

  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId);
  const playheadX = LANE_PADDING + currentTime * pxPerSec;

  return (
    <div className="flex h-full flex-col border-t border-white/8 bg-[#0d0d14]">
      {/* toolbar */}
      <div className="flex items-center gap-1 px-4 py-1.5">
        <ToolButton
          onClick={splitAtPlayhead}
          disabled={clips.length === 0}
          title="Split clip at playhead (S)"
        >
          <Scissors size={14} /> Split
        </ToolButton>
        <ToolButton
          onClick={() => selectedClipId && deleteClip(selectedClipId)}
          disabled={!selectedClipId}
          title="Delete selected clip"
        >
          <Trash2 size={14} /> Delete
        </ToolButton>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton
          onClick={() => selectedClipId && moveClip(selectedClipId, -1)}
          disabled={selectedIndex <= 0}
          title="Move clip earlier"
        >
          <ChevronLeft size={14} />
        </ToolButton>
        <ToolButton
          onClick={() => selectedClipId && moveClip(selectedClipId, 1)}
          disabled={selectedIndex < 0 || selectedIndex >= clips.length - 1}
          title="Move clip later"
        >
          <ChevronRight size={14} />
        </ToolButton>
        {selectedClipId && (
          <span className="ml-1 flex items-center gap-1 text-[11px] text-zinc-500">
            <ArrowLeftRight size={11} /> drag clip edges to trim
          </span>
        )}
        <div className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">
          {clips.length} clip{clips.length === 1 ? "" : "s"} · {formatTime(duration)}
        </div>
      </div>

      {/* lanes */}
      <div ref={laneRef} className="relative min-h-0 flex-1 select-none">
        {/* ruler */}
        <div
          className="absolute inset-x-0 top-0 h-5 cursor-col-resize text-[9px] text-zinc-600"
          onPointerDown={onScrub}
        >
          {ruler.marks.map((t) => (
            <div
              key={t}
              className="absolute top-0 h-full border-l border-white/10 pl-1 pt-0.5 font-mono"
              style={{ left: LANE_PADDING + t * pxPerSec }}
            >
              {ruler.step < 1 ? formatTime(t) : formatTime(t).replace(/\.\d$/, "")}
            </div>
          ))}
        </div>

        {/* clip lane */}
        <div
          className="absolute inset-x-0 top-6 bottom-8 cursor-col-resize"
          onPointerDown={onScrub}
        >
          {clips.length === 0 && (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              Your clips will appear here
            </div>
          )}
          {clips.map((clip, i) => {
            const start = clipStartTime(clips, i);
            const asset = media.find((m) => m.id === clip.mediaId);
            const peaks =
              waveforms[clip.mediaId] ?? placeholderPeaksCached(clip.mediaId);
            const isSelected = clip.id === selectedClipId;
            return (
              <ClipBlock
                key={clip.id}
                left={LANE_PADDING + start * pxPerSec}
                width={Math.max(8, clipDuration(clip) * pxPerSec)}
                label={asset?.originalName ?? "clip"}
                peaks={peaks}
                peaksStart={asset ? clip.sourceStart / asset.duration : 0}
                peaksEnd={asset ? clip.sourceEnd / asset.duration : 1}
                selected={isSelected}
                onSelect={() => selectClip(clip.id)}
                onTrim={(edge, deltaPx) => {
                  const deltaSec = deltaPx / pxPerSec;
                  if (edge === "start") {
                    trimClip(clip.id, { sourceStart: clip.sourceStart + deltaSec });
                  } else {
                    trimClip(clip.id, { sourceEnd: clip.sourceEnd + deltaSec });
                  }
                }}
              />
            );
          })}
        </div>

        {/* caption lane */}
        <div className="absolute inset-x-0 bottom-1 h-6">
          {captions.map((cap) => (
            <button
              key={cap.id}
              className="absolute top-0 h-5 overflow-hidden rounded bg-violet-500/40 px-1 text-left text-[9px] leading-5 text-violet-100 ring-violet-300 transition hover:bg-violet-500/60 focus:outline-none focus:ring-1"
              style={{
                left: LANE_PADDING + cap.startTime * pxPerSec,
                width: Math.max(6, (cap.endTime - cap.startTime) * pxPerSec),
              }}
              title={cap.text}
              onClick={() => {
                setPlaying(false);
                setCurrentTime(cap.startTime + 0.001);
                selectCaption(cap.id);
              }}
            >
              {cap.text}
            </button>
          ))}
        </div>

        {/* playhead */}
        {clips.length > 0 && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-fuchsia-400"
            style={{ left: playheadX }}
          >
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-fuchsia-400" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function ToolButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const placeholderCache = new Map<string, number[]>();
function placeholderPeaksCached(mediaId: string): number[] {
  let peaks = placeholderCache.get(mediaId);
  if (!peaks) {
    peaks = placeholderPeaks(mediaId);
    placeholderCache.set(mediaId, peaks);
  }
  return peaks;
}

interface ClipBlockProps {
  left: number;
  width: number;
  label: string;
  peaks: number[] | null;
  /** Fraction of the media covered by this clip (for slicing the waveform). */
  peaksStart: number;
  peaksEnd: number;
  selected: boolean;
  onSelect: () => void;
  onTrim: (edge: "start" | "end", deltaPx: number) => void;
}

function ClipBlock({
  left,
  width,
  label,
  peaks,
  peaksStart,
  peaksEnd,
  selected,
  onSelect,
  onTrim,
}: ClipBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(2, Math.floor(width));
    const h = 44;
    canvas.width = w * 2; // 2x for crisp rendering
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = selected ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)";

    const data = peaks ?? [];
    const startIdx = Math.floor(peaksStart * data.length);
    const endIdx = Math.max(startIdx + 1, Math.floor(peaksEnd * data.length));
    const slice = data.slice(startIdx, endIdx);
    const bars = Math.floor(w / 2);
    for (let i = 0; i < bars; i++) {
      const peak = slice.length
        ? slice[Math.floor((i / bars) * slice.length)] ?? 0
        : 0.3;
      const barH = Math.max(2, peak * h * 1.7);
      ctx.fillRect(i * 4, h - barH, 2.5, barH * 2);
    }
  }, [peaks, peaksStart, peaksEnd, width, selected]);

  const startTrim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    let applied = 0;
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX - applied;
      applied += delta;
      onTrim(edge, delta);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`group absolute top-1 bottom-1 overflow-hidden rounded-lg transition-shadow ${
        selected
          ? "bg-gradient-to-b from-violet-600/70 to-violet-800/70 ring-2 ring-fuchsia-400"
          : "bg-gradient-to-b from-zinc-700/80 to-zinc-800/80 ring-1 ring-white/10 hover:ring-white/30"
      }`}
      style={{ left, width }}
      // select on press; the event still bubbles to the lane's scrub handler
      onPointerDown={onSelect}
    >
      <canvas ref={canvasRef} className="absolute inset-x-1 top-3 bottom-1 h-[calc(100%-1rem)] w-[calc(100%-0.5rem)] opacity-80" />
      <div className="pointer-events-none absolute inset-x-1.5 top-0.5 truncate text-[9px] font-medium text-white/70">
        {label}
      </div>
      {selected && (
        <>
          <div
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-fuchsia-400/90"
            onPointerDown={startTrim("start")}
          />
          <div
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-fuchsia-400/90"
            onPointerDown={startTrim("end")}
          />
        </>
      )}
    </div>
  );
}
