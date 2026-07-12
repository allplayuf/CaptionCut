"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Caption, Track, TimelineClip } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { filmstripUrl, mediaUrl } from "@/lib/video/client";
import { computePeaks, placeholderPeaks } from "@/lib/audio/waveform";
import { formatTime } from "@/lib/video/timeline";
import { mainVideoTrack, snapTargets, snapTime, tracksDuration } from "@/lib/timeline/tracks";
import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Redo2,
  Rewind,
  Scissors,
  Search,
  Smile,
  Snowflake,
  Type,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const HEADER_W = 116;
const PAD = 12;
const SNAP_PX = 8;

const TRACK_HEIGHTS: Partial<Record<Track["type"], number>> = { video: 54 };
const DEFAULT_TRACK_HEIGHT = 26;

const TRACK_COLORS: Record<Track["type"], string> = {
  video: "from-zinc-700/80 to-zinc-800/80",
  broll: "from-sky-700/70 to-sky-900/70",
  image: "from-teal-700/70 to-teal-900/70",
  caption: "from-violet-600/60 to-violet-800/60",
  text: "from-amber-600/70 to-amber-800/70",
  sticker: "from-pink-600/70 to-pink-800/70",
  music: "from-emerald-700/70 to-emerald-900/70",
  sfx: "from-lime-700/70 to-lime-900/70",
  voice: "from-cyan-700/70 to-cyan-900/70",
  effects: "from-fuchsia-600/70 to-fuchsia-800/70",
};

export default function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const captions = useEditorStore((s) => s.captions);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const waveforms = useEditorStore((s) => s.waveforms);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);

  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const deleteSelectedClips = useEditorStore((s) => s.deleteSelectedClips);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const moveClipToIndex = useEditorStore((s) => s.moveClipToIndex);
  const moveTimelineClip = useEditorStore((s) => s.moveTimelineClip);
  const trimTimelineClip = useEditorStore((s) => s.trimTimelineClip);
  const updateCaptionTiming = useEditorStore((s) => s.updateCaptionTiming);
  const setWaveform = useEditorStore((s) => s.setWaveform);
  const addTextClip = useEditorStore((s) => s.addTextClip);
  const addStickerClip = useEditorStore((s) => s.addStickerClip);
  const addEffectClip = useEditorStore((s) => s.addEffectClip);
  const insertReplay = useEditorStore((s) => s.insertReplay);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(800);
  const [zoom, setZoom] = useState<number | null>(null); // px per second; null = fit
  /** Live drag-reorder of a main-track clip: visual offset + insertion slot. */
  const [reorder, setReorder] = useState<{ clipId: string; dx: number; slot: number } | null>(null);
  const waveformStartedRef = useRef<Set<string>>(new Set());

  const duration = Math.max(tracksDuration(tracks), 0.001);
  const fitPxPerSec = Math.max(8, (viewportW - 2 * PAD) / duration);
  const pxPerSec = zoom ?? fitPxPerSec;
  const contentW = duration * pxPerSec + 2 * PAD;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportW(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Kick off waveform decoding for audible media on the timeline.
  useEffect(() => {
    for (const track of tracks) {
      if (!["video", "broll", "music", "sfx", "voice"].includes(track.type)) continue;
      for (const clip of track.clips) {
        const id = clip.assetId;
        if (!id || waveforms[id] !== undefined || waveformStartedRef.current.has(id)) continue;
        waveformStartedRef.current.add(id);
        computePeaks(mediaUrl(id))
          .then((peaks) => setWaveform(id, peaks))
          .catch(() => setWaveform(id, null));
      }
    }
  }, [tracks, waveforms, setWaveform]);

  /** Timeline seconds from a pointer event, in content coordinates. */
  const timeFromEvent = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    const x = clientX - rect.left - PAD;
    return Math.max(0, Math.min(duration, x / pxPerSec));
  };

  const onScrub = (e: React.PointerEvent) => {
    if (duration <= 0.001) return;
    setPlaying(false);
    setCurrentTime(timeFromEvent(e.clientX));
    const move = (ev: PointerEvent) => setCurrentTime(timeFromEvent(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Insertion slot (0..n) in the main track for a pointer time. */
  const reorderSlot = (time: number): number => {
    const clips = mainVideoTrack(tracks).clips;
    for (let i = 0; i < clips.length; i++) {
      if (time < (clips[i].startTime + clips[i].endTime) / 2) return i;
    }
    return clips.length;
  };

  const onReorderDrag = (clipId: string, dx: number, clientX: number) => {
    setReorder({ clipId, dx, slot: reorderSlot(timeFromEvent(clientX)) });
  };

  const onReorderEnd = (clipId: string) => {
    setReorder((r) => {
      if (r && r.clipId === clipId) {
        const clips = mainVideoTrack(tracks).clips;
        const from = clips.findIndex((c) => c.id === clipId);
        // Slot is an insertion point; account for the clip leaving its old spot.
        const target = r.slot > from ? r.slot - 1 : r.slot;
        if (from >= 0 && target !== from) moveClipToIndex(clipId, target);
      }
      return null;
    });
  };

  const ruler = useMemo(() => {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((st) => st * pxPerSec >= 64) ?? 60;
    const marks: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += step) marks.push(t);
    return { marks, step };
  }, [duration, pxPerSec]);

  // Visible tracks: main video always; others when they have clips.
  const visibleTracks = tracks.filter((t) => t.type === "video" || t.clips.length > 0);
  const playheadX = PAD + currentTime * pxPerSec;

  const zoomBy = (factor: number) =>
    setZoom(Math.max(fitPxPerSec * 0.5, Math.min(400, pxPerSec * factor)));

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  return (
    <div className="flex h-full flex-col border-t border-white/8 bg-[#0d0d14]">
      {/* toolbar */}
      <div className="flex items-center gap-1 px-3 py-1">
        <ToolButton onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </ToolButton>
        <ToolButton onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={14} />
        </ToolButton>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton onClick={splitAtPlayhead} disabled={duration <= 0.001} title="Split at playhead (S)">
          <Scissors size={14} /> Split
        </ToolButton>
        <ToolButton
          onClick={() => selectedClipId && duplicateClip(selectedClipId)}
          disabled={!selectedClipId}
          title="Duplicate selected clip (Ctrl+D)"
        >
          <Copy size={14} />
        </ToolButton>
        <ToolButton
          onClick={deleteSelectedClips}
          disabled={selectedClipIds.length === 0 && !selectedClipId}
          title={
            selectedClipIds.length > 1
              ? `Delete ${selectedClipIds.length} selected clips (Del)`
              : "Delete selected clip (Del) · Ctrl+click to multi-select"
          }
        >
          <Trash2 size={14} />
          {selectedClipIds.length > 1 && <span>{selectedClipIds.length}</span>}
        </ToolButton>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton onClick={() => addTextClip("Your text", undefined)} disabled={duration <= 0.001} title="Add text at playhead">
          <Type size={14} /> Text
        </ToolButton>
        <ToolButton onClick={() => addStickerClip("🔥")} disabled={duration <= 0.001} title="Add sticker at playhead">
          <Smile size={14} />
        </ToolButton>
        <ToolButton
          onClick={() =>
            addEffectClip(useEditorStore.getState().currentTime, 2, {
              kind: "zoom",
              zoomScale: 1.15,
              anchorX: 0.5,
              anchorY: 0.45,
            })
          }
          disabled={duration <= 0.001}
          title="Add punch-in zoom at playhead"
        >
          <Search size={14} /> Zoom
        </ToolButton>
        <ToolButton
          onClick={() => addEffectClip(useEditorStore.getState().currentTime, 1.2, { kind: "freeze" })}
          disabled={duration <= 0.001}
          title="Freeze the frame at the playhead (trim the clip to change hold length)"
        >
          <Snowflake size={14} />
        </ToolButton>
        <ToolButton
          onClick={() => addEffectClip(useEditorStore.getState().currentTime, 0.25, { kind: "flash" })}
          disabled={duration <= 0.001}
          title="White flash pop at the playhead (goal / impact accent)"
        >
          <Zap size={14} />
        </ToolButton>
        <ToolButton
          onClick={insertReplay}
          disabled={duration <= 0.001}
          title="Instant replay: repeat the last 3 seconds in slow motion"
        >
          <Rewind size={14} /> Replay
        </ToolButton>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton onClick={() => zoomBy(1 / 1.4)} title="Zoom timeline out (Ctrl+scroll)">
            <ZoomOut size={14} />
          </ToolButton>
          <button
            onClick={() => setZoom(null)}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:bg-white/10 hover:text-zinc-300"
            title="Fit timeline to window"
          >
            Fit
          </button>
          <ToolButton onClick={() => zoomBy(1.4)} title="Zoom timeline in (Ctrl+scroll)">
            <ZoomIn size={14} />
          </ToolButton>
          <span className="ml-2 font-mono text-[11px] tabular-nums text-zinc-500">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* tracks */}
      <div className="flex min-h-0 flex-1">
        {/* headers */}
        <div className="shrink-0 overflow-hidden border-r border-white/8" style={{ width: HEADER_W }}>
          <div className="h-5" />
          {visibleTracks.map((track) => (
            <TrackHeader key={track.id} track={track} />
          ))}
          <div className="flex items-center gap-1 px-2 text-[10px] font-medium text-violet-300/80" style={{ height: 24 }}>
            Captions
          </div>
        </div>

        {/* scrollable lanes */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden select-none" onWheel={onWheel}>
          <div ref={contentRef} className="relative" style={{ width: contentW }}>
            {/* ruler */}
            <div className="relative h-5 cursor-col-resize text-[9px] text-zinc-600" onPointerDown={onScrub}>
              {ruler.marks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-white/10 pl-1 pt-0.5 font-mono"
                  style={{ left: PAD + t * pxPerSec }}
                >
                  {ruler.step < 1 ? formatTime(t) : formatTime(t).replace(/\.\d$/, "")}
                </div>
              ))}
            </div>

            {/* lanes */}
            {visibleTracks.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                media={media}
                waveforms={waveforms}
                pxPerSec={pxPerSec}
                duration={duration}
                selectedClipIds={selectedClipIds}
                reorder={track.type === "video" ? reorder : null}
                onReorderDrag={onReorderDrag}
                onReorderEnd={onReorderEnd}
                onScrub={onScrub}
                onSelect={(id, additive) => selectClip(id, { additive })}
                onMove={(clipId, newStart, dragged, snap) => {
                  if (!snap) {
                    moveTimelineClip(clipId, newStart);
                    return;
                  }
                  const targets = snapTargets(tracks, captions, currentTime).filter(
                    (t) => t !== dragged.startTime && t !== dragged.endTime
                  );
                  const dur = dragged.endTime - dragged.startTime;
                  let start = snapTime(newStart, targets, SNAP_PX / pxPerSec);
                  const endSnapped = snapTime(start + dur, targets, SNAP_PX / pxPerSec);
                  if (endSnapped !== start + dur) start = endSnapped - dur;
                  moveTimelineClip(clipId, start);
                }}
                onTrim={(clipId, edge, newTime, snap) => {
                  if (!snap) {
                    trimTimelineClip(clipId, edge, newTime);
                    return;
                  }
                  const targets = snapTargets(tracks, captions, currentTime);
                  trimTimelineClip(clipId, edge, snapTime(newTime, targets, SNAP_PX / pxPerSec));
                }}
              />
            ))}

            {/* captions lane — blocks are draggable and edge-trimmable */}
            <div className="relative cursor-col-resize border-t border-white/5" style={{ height: 24 }} onPointerDown={onScrub}>
              {captions.map((cap) => (
                <CaptionBlock
                  key={cap.id}
                  caption={cap}
                  pxPerSec={pxPerSec}
                  selected={cap.id === selectedCaptionId}
                  onJump={() => {
                    setPlaying(false);
                    setCurrentTime(cap.startTime + 0.001);
                    selectCaption(cap.id);
                  }}
                  onSelect={() => selectCaption(cap.id)}
                  onMove={(newStart, snap) => {
                    const dur = cap.endTime - cap.startTime;
                    let start = newStart;
                    if (snap) {
                      const targets = snapTargets(tracks, captions, currentTime).filter(
                        (t) => t !== cap.startTime && t !== cap.endTime
                      );
                      start = snapTime(newStart, targets, SNAP_PX / pxPerSec);
                      const endSnapped = snapTime(start + dur, targets, SNAP_PX / pxPerSec);
                      if (endSnapped !== start + dur) start = endSnapped - dur;
                    }
                    start = Math.max(0, start);
                    updateCaptionTiming(cap.id, start, start + dur);
                  }}
                  onTrim={(edge, newTime, snap) => {
                    const targets = snapTargets(tracks, captions, currentTime);
                    const t = snap ? snapTime(newTime, targets, SNAP_PX / pxPerSec) : newTime;
                    if (edge === "start") updateCaptionTiming(cap.id, t, cap.endTime);
                    else updateCaptionTiming(cap.id, cap.startTime, t);
                  }}
                />
              ))}
            </div>

            {/* playhead */}
            {duration > 0.001 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-fuchsia-400"
                style={{ left: playheadX }}
              >
                <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-fuchsia-400" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function TrackHeader({ track }: { track: Track }) {
  const toggleTrackLocked = useEditorStore((s) => s.toggleTrackLocked);
  const toggleTrackMuted = useEditorStore((s) => s.toggleTrackMuted);
  const toggleTrackHidden = useEditorStore((s) => s.toggleTrackHidden);
  const height = TRACK_HEIGHTS[track.type] ?? DEFAULT_TRACK_HEIGHT;
  const audible = ["video", "broll", "music", "sfx", "voice"].includes(track.type);
  const visual = track.type !== "music" && track.type !== "sfx" && track.type !== "voice";

  return (
    <div className="flex items-center gap-0.5 border-t border-white/5 px-1.5" style={{ height }}>
      <span className={`min-w-0 flex-1 truncate text-[10px] font-medium ${track.hidden ? "text-zinc-600" : "text-zinc-400"}`}>
        {track.name}
      </span>
      <HeaderIcon
        onClick={() => toggleTrackLocked(track.id)}
        title={track.locked ? "Unlock track" : "Lock track"}
        active={track.locked}
      >
        {track.locked ? <Lock size={11} /> : <LockOpen size={11} />}
      </HeaderIcon>
      {audible && (
        <HeaderIcon
          onClick={() => toggleTrackMuted(track.id)}
          title={track.muted ? "Unmute track" : "Mute track"}
          active={track.muted}
        >
          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </HeaderIcon>
      )}
      {visual && (
        <HeaderIcon
          onClick={() => toggleTrackHidden(track.id)}
          title={track.hidden ? "Show track" : "Hide track"}
          active={track.hidden}
        >
          {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
        </HeaderIcon>
      )}
    </div>
  );
}

function HeaderIcon({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded p-0.5 transition ${active ? "text-fuchsia-400" : "text-zinc-600 hover:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

interface TrackLaneProps {
  track: Track;
  media: { id: string; originalName: string; duration: number }[];
  waveforms: Record<string, number[] | null>;
  pxPerSec: number;
  duration: number;
  selectedClipIds: string[];
  /** Live main-track drag-reorder state (null while idle / other lanes). */
  reorder: { clipId: string; dx: number; slot: number } | null;
  onReorderDrag: (clipId: string, dx: number, clientX: number) => void;
  onReorderEnd: (clipId: string) => void;
  onScrub: (e: React.PointerEvent) => void;
  /** `additive` is true for Ctrl/Cmd-click (multi-select toggle). */
  onSelect: (id: string, additive: boolean) => void;
  /** `snap` is false while Shift is held (free positioning). */
  onMove: (clipId: string, newStart: number, clip: TimelineClip, snap: boolean) => void;
  onTrim: (clipId: string, edge: "start" | "end", newTime: number, snap: boolean) => void;
}

function TrackLane({
  track,
  media,
  waveforms,
  pxPerSec,
  selectedClipIds,
  reorder,
  onReorderDrag,
  onReorderEnd,
  onScrub,
  onSelect,
  onMove,
  onTrim,
}: TrackLaneProps) {
  const height = TRACK_HEIGHTS[track.type] ?? DEFAULT_TRACK_HEIGHT;

  // Insertion indicator x for a live reorder drag.
  let slotX: number | null = null;
  if (reorder) {
    const clips = track.clips;
    const t = reorder.slot === 0 ? 0 : clips[Math.min(reorder.slot, clips.length) - 1]?.endTime ?? 0;
    slotX = PAD + t * pxPerSec;
  }

  return (
    <div
      className={`relative cursor-col-resize border-t border-white/5 ${track.hidden ? "opacity-35" : ""}`}
      style={{ height }}
      onPointerDown={onScrub}
    >
      {track.clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          track={track}
          label={clipLabel(clip, media)}
          peaks={
            track.type === "video" && clip.assetId
              ? waveforms[clip.assetId] ?? placeholderPeaksCached(clip.assetId)
              : null
          }
          peaksRange={peaksRange(clip, media)}
          pxPerSec={pxPerSec}
          height={height}
          selected={selectedClipIds.includes(clip.id)}
          dragDx={reorder?.clipId === clip.id ? reorder.dx : null}
          onSelect={(additive) => onSelect(clip.id, additive)}
          onMove={(newStart, snap) => onMove(clip.id, newStart, clip, snap)}
          onReorderDrag={(dx, clientX) => onReorderDrag(clip.id, dx, clientX)}
          onReorderEnd={() => onReorderEnd(clip.id)}
          onTrim={(edge, newTime, snap) => onTrim(clip.id, edge, newTime, snap)}
        />
      ))}
      {slotX !== null && (
        <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 rounded bg-amber-300" style={{ left: slotX }} />
      )}
    </div>
  );
}

function clipLabel(clip: TimelineClip, media: { id: string; originalName: string }[]): string {
  if (clip.type === "text" || clip.type === "sticker") return clip.text ?? "";
  if (clip.type === "effects") {
    if (clip.effect?.kind === "zoom") return `zoom ×${(clip.effect.zoomScale ?? 1).toFixed(2)}`;
    if (clip.effect?.kind === "freeze") return "❄ freeze";
    if (clip.effect?.kind === "flash") return "⚡ flash";
    return "fx";
  }
  const asset = clip.assetId ? media.find((m) => m.id === clip.assetId) : undefined;
  const name = asset?.originalName ?? "clip";
  return clip.metadata?.replay ? `↩ ${name}` : name;
}

function peaksRange(clip: TimelineClip, media: { id: string; duration: number }[]): [number, number] {
  const asset = clip.assetId ? media.find((m) => m.id === clip.assetId) : undefined;
  if (!asset || !asset.duration) return [0, 1];
  return [(clip.sourceStart ?? 0) / asset.duration, (clip.sourceEnd ?? asset.duration) / asset.duration];
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

/* ---------------------------------------------------------------- */

interface ClipBlockProps {
  clip: TimelineClip;
  track: Track;
  label: string;
  peaks: number[] | null;
  peaksRange: [number, number];
  pxPerSec: number;
  height: number;
  selected: boolean;
  /** Visual x offset while this clip is being drag-reordered (main track). */
  dragDx: number | null;
  onSelect: (additive: boolean) => void;
  onMove: (newStart: number, snap: boolean) => void;
  onReorderDrag: (dx: number, clientX: number) => void;
  onReorderEnd: () => void;
  onTrim: (edge: "start" | "end", newTime: number, snap: boolean) => void;
}

function ClipBlock({
  clip,
  track,
  label,
  peaks,
  peaksRange,
  pxPerSec,
  height,
  selected,
  dragDx,
  onSelect,
  onMove,
  onReorderDrag,
  onReorderEnd,
  onTrim,
}: ClipBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const left = 12 + clip.startTime * pxPerSec;
  const width = Math.max(8, (clip.endTime - clip.startTime) * pxPerSec);
  const isMain = track.type === "video";
  const movable = !track.locked;
  const hasFilmstrip = (isMain || track.type === "broll") && Boolean(clip.assetId);

  // waveform — bottom-anchored so filmstrip thumbnails stay visible above it
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(8, Math.round(height * (hasFilmstrip ? 0.34 : 0.8)));
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = selected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)";

    const startIdx = Math.floor(peaksRange[0] * peaks.length);
    const endIdx = Math.max(startIdx + 1, Math.floor(peaksRange[1] * peaks.length));
    const slice = peaks.slice(startIdx, endIdx);
    const bars = Math.floor(w / 2);
    for (let i = 0; i < bars; i++) {
      const peak = slice.length ? slice[Math.floor((i / bars) * slice.length)] ?? 0 : 0.3;
      const barH = Math.max(2, peak * h * 1.7);
      ctx.fillRect(i * 4, h * 2 - barH * 2, 2.5, barH * 2);
    }
  }, [peaks, peaksRange, width, height, selected, hasFilmstrip]);

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    const additive = e.ctrlKey || e.metaKey;
    onSelect(additive);
    // Ctrl/Cmd-click toggles membership in the multi-selection — no drag.
    if (additive || !movable) return;
    const startX = e.clientX;
    const origStart = clip.startTime;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      // Main track reorders by insertion; free tracks move in absolute time.
      // Shift disables snapping.
      if (isMain) onReorderDrag(dx, ev.clientX);
      else onMove(Math.max(0, origStart + dx / pxPerSec), !ev.shiftKey);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (isMain && moved) onReorderEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startTrim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(false);
    const startX = e.clientX;
    const orig = edge === "start" ? clip.startTime : clip.endTime;
    const move = (ev: PointerEvent) => {
      onTrim(edge, orig + (ev.clientX - startX) / pxPerSec, !ev.shiftKey);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Filmstrip mapping: the sprite spans the whole source file; show only the
  // [f0..f1] slice this clip uses, stretched to the clip's pixel width.
  const [f0, f1] = peaksRange;
  const stripW = f1 - f0 > 0.001 ? width / (f1 - f0) : width;

  const dragging = dragDx !== null;
  return (
    <div
      className={`group absolute top-0.5 bottom-0.5 overflow-hidden rounded-md bg-gradient-to-b ${TRACK_COLORS[track.type]} ${
        selected ? "ring-2 ring-fuchsia-400" : "ring-1 ring-white/10 hover:ring-white/30"
      } ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${
        dragging ? "z-30 opacity-80 shadow-xl shadow-black/50" : "transition-shadow"
      }`}
      style={{ left, width, transform: dragging ? `translateX(${dragDx}px)` : undefined }}
      onPointerDown={startDrag}
    >
      {hasFilmstrip && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${filmstripUrl(clip.assetId!)})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${stripW}px 100%`,
            backgroundPositionX: `${-f0 * stripW}px`,
          }}
        />
      )}
      {hasFilmstrip && (
        <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-black/60 to-transparent" />
      )}
      {peaks && (
        <canvas
          ref={canvasRef}
          className={`absolute inset-x-1 bottom-0.5 w-[calc(100%-0.5rem)] opacity-80 ${
            hasFilmstrip ? "h-[34%]" : "top-3 h-[calc(100%-1rem)]"
          }`}
        />
      )}
      <div className="pointer-events-none absolute inset-x-1.5 top-0.5 flex items-center gap-1 truncate text-[9px] font-medium text-white/80">
        {clip.speed && Math.abs(clip.speed - 1) > 0.01 && (
          <span className="rounded bg-amber-400/90 px-0.5 font-bold text-black">{clip.speed}×</span>
        )}
        <span className="truncate">{label}</span>
      </div>
      {selected && !track.locked && (
        <>
          <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-fuchsia-400/90" onPointerDown={startTrim("start")} />
          <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-fuchsia-400/90" onPointerDown={startTrim("end")} />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

/** A caption block on the captions lane: click to jump, drag to move, edges to trim. */
function CaptionBlock({
  caption,
  pxPerSec,
  selected,
  onJump,
  onSelect,
  onMove,
  onTrim,
}: {
  caption: Caption;
  pxPerSec: number;
  selected: boolean;
  onJump: () => void;
  onSelect: () => void;
  onMove: (newStart: number, snap: boolean) => void;
  onTrim: (edge: "start" | "end", newTime: number, snap: boolean) => void;
}) {
  const left = PAD + caption.startTime * pxPerSec;
  const width = Math.max(6, (caption.endTime - caption.startTime) * pxPerSec);

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const origStart = caption.startTime;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      onMove(Math.max(0, origStart + dx / pxPerSec), !ev.shiftKey);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onJump();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startTrim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const startX = e.clientX;
    const orig = edge === "start" ? caption.startTime : caption.endTime;
    const move = (ev: PointerEvent) =>
      onTrim(edge, orig + (ev.clientX - startX) / pxPerSec, !ev.shiftKey);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`absolute top-0.5 h-5 cursor-grab overflow-hidden rounded bg-violet-500/40 px-1 text-left text-[9px] leading-5 text-violet-100 transition-colors hover:bg-violet-500/60 active:cursor-grabbing ${
        selected ? "ring-1 ring-violet-200" : ""
      }`}
      style={{ left, width }}
      title={caption.text}
      onPointerDown={startDrag}
    >
      {caption.text}
      {selected && (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-violet-300/90" onPointerDown={startTrim("start")} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-violet-300/90" onPointerDown={startTrim("end")} />
        </>
      )}
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
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
