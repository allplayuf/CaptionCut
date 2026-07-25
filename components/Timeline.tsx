"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Caption, Track, TimelineClip } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { filmstripUrl, mediaUrl } from "@/lib/video/client";
import { computePeaks, placeholderPeaks } from "@/lib/audio/waveform";
import { formatTime } from "@/lib/video/timeline";
import { mainVideoTrack, snapTargets, snapTime, tracksDuration } from "@/lib/timeline/tracks";
import { timelineBeatMarkers } from "@/lib/autoEdit/signals";
import {
  Eye,
  EyeOff,
  Layers3,
  Lock,
  LockOpen,
  Magnet,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const HEADER_W = 116;
const PAD = 12;
const SNAP_PX = 8;

const TRACK_HEIGHTS: Partial<Record<Track["type"], number>> = {
  video: 54,
  music: 36,
  sfx: 30,
  voice: 30,
};
const DEFAULT_TRACK_HEIGHT = 26;

/** Tracks whose clips draw an audio waveform. */
const WAVEFORM_TRACKS: Track["type"][] = ["video", "broll", "music", "sfx", "voice"];

const TRACK_COLORS: Record<Track["type"], string> = {
  video: "from-zinc-700/80 to-zinc-800/80",
  broll: "from-sky-700/70 to-sky-900/70",
  image: "from-teal-700/70 to-teal-900/70",
  caption: "from-[#5ca889]/60 to-[#386f5b]/60",
  text: "from-amber-600/70 to-amber-800/70",
  sticker: "from-pink-600/70 to-pink-800/70",
  music: "from-emerald-700/70 to-emerald-900/70",
  sfx: "from-lime-700/70 to-lime-900/70",
  voice: "from-cyan-700/70 to-cyan-900/70",
  effects: "from-[#517ca8]/70 to-[#314f72]/70",
};

const TRACK_LABELS_SV: Record<Track["type"], string> = {
  video: "Huvudvideo",
  broll: "B-roll",
  image: "Bilder",
  caption: "Captions",
  text: "Textgrafik",
  sticker: "Stickers",
  music: "Musik",
  sfx: "Ljudeffekter",
  voice: "Berättarröst",
  effects: "Effekter",
};

const TRACK_DOTS: Record<Track["type"], string> = {
  video: "#a6b1bc",
  broll: "#78b8ed",
  image: "#78d9c5",
  caption: "#78d9c5",
  text: "#f2b66d",
  sticker: "#ee93bd",
  music: "#66c99b",
  sfx: "#9ed47a",
  voice: "#6fd1dd",
  effects: "#c49af6",
};

export default function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const captions = useEditorStore((s) => s.captions);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const waveforms = useEditorStore((s) => s.waveforms);

  const analyses = useEditorStore((s) => s.analyses);
  const beat = useEditorStore((s) => s.beat);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectClip = useEditorStore((s) => s.selectClip);
  const setSelectedClips = useEditorStore((s) => s.setSelectedClips);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const deleteSelectedClips = useEditorStore((s) => s.deleteSelectedClips);
  const moveClipToIndex = useEditorStore((s) => s.moveClipToIndex);
  const moveTimelineClip = useEditorStore((s) => s.moveTimelineClip);
  const moveSelectedClips = useEditorStore((s) => s.moveSelectedClips);
  const trimTimelineClip = useEditorStore((s) => s.trimTimelineClip);
  const updateCaptionTiming = useEditorStore((s) => s.updateCaptionTiming);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setWaveform = useEditorStore((s) => s.setWaveform);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(800);
  const [zoom, setZoom] = useState<number | null>(null); // px per second; null = fit
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  /** Live drag-reorder of a main-track clip: visual offset + insertion slot. */
  const [reorder, setReorder] = useState<{ clipId: string; dx: number; slot: number } | null>(null);
  /** Live marquee selection rectangle, in content-div pixel coordinates. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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
        const asset = media.find((item) => item.id === id);
        if (!asset) continue;
        computePeaks(mediaUrl(asset))
          .then((peaks) => setWaveform(id, peaks))
          .catch(() => setWaveform(id, null));
      }
    }
  }, [tracks, media, waveforms, setWaveform]);

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

  // Soundtrack beat grid → ruler ticks + snap targets.
  const beatInfo = useMemo(
    () => timelineBeatMarkers(tracks, analyses, beat, duration),
    [tracks, analyses, beat, duration]
  );

  /** Clip edges + playhead + beat instants — everything drags snap onto. */
  const allSnapTargets = () => {
    const targets = snapTargets(tracks, captions, currentTime);
    if (beatInfo) targets.push(...beatInfo.beats);
    return targets;
  };

  // Visible tracks: main video always; others when they have clips.
  const visibleTracks = showAllTracks
    ? tracks
    : tracks.filter((t) => t.type === "video" || t.clips.length > 0);
  const playheadX = PAD + currentTime * pxPerSec;

  // Vertical lane geometry inside the content div (ruler is 20px tall) —
  // used to map the marquee rectangle onto clips.
  const laneGeometry = computeLaneGeometry(visibleTracks);

  /**
   * Pointer-down on empty lane space: a plain click scrubs to that time, a
   * drag becomes a marquee that selects every clip it touches (Premiere-style).
   */
  const onLaneDown = (e: React.PointerEvent) => {
    if (duration <= 0.001 || e.button !== 0) return;
    const rect = contentRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let active = false;

    const clipsInBox = (box: { x0: number; y0: number; x1: number; y1: number }): string[] => {
      const ids: string[] = [];
      for (const lane of laneGeometry) {
        if (lane.track.locked) continue;
        if (lane.top + lane.height < box.y0 || lane.top > box.y1) continue;
        for (const clip of lane.track.clips) {
          const left = PAD + clip.startTime * pxPerSec;
          const right = PAD + clip.endTime * pxPerSec;
          if (right >= box.x0 && left <= box.x1) ids.push(clip.id);
        }
      }
      return ids;
    };

    const move = (ev: PointerEvent) => {
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      if (!active && Math.hypot(cx - sx, cy - sy) < 5) return;
      active = true;
      const box = {
        x0: Math.min(sx, cx),
        y0: Math.min(sy, cy),
        x1: Math.max(sx, cx),
        y1: Math.max(sy, cy),
      };
      setMarquee(box);
      setSelectedClips(clipsInBox(box));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!active) {
        // Plain click: deselect + move the playhead here.
        setSelectedClips([]);
        setPlaying(false);
        setCurrentTime(timeFromEvent(ev.clientX));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const zoomBy = (factor: number) =>
    setZoom(Math.max(fitPxPerSec * 0.5, Math.min(400, pxPerSec * factor)));

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  return (
    <div className="flex h-full flex-col border-t border-white/[0.07] bg-[#0a0e13] shadow-[0_-12px_40px_rgba(0,0,0,.2)]">
      {/* toolbar */}
      <div className="flex h-10 items-center gap-1 border-b border-white/[0.06] bg-[linear-gradient(90deg,rgba(120,184,237,.025),transparent_42%)] px-3">
        <span className="mr-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#6d7986]">
          Tidslinje
        </span>
        <ToolButton onClick={splitAtPlayhead} disabled={duration <= 0.001} title="Dela vid spelhuvudet (S)">
          <Scissors size={13} /> Dela
        </ToolButton>
        <ToolButton
          onClick={deleteSelectedClips}
          disabled={selectedClipIds.length === 0 && !selectedClipId}
          title={
            selectedClipIds.length > 1
              ? `Radera ${selectedClipIds.length} valda klipp`
              : "Radera valt klipp (Delete)"
          }
        >
          <Trash2 size={13} /> Radera
          {selectedClipIds.length > 1 && <span>{selectedClipIds.length}</span>}
        </ToolButton>
        <ToolButton
          onClick={() => setSnapEnabled((value) => !value)}
          title={snapEnabled ? "Fästning är på · Shift kringgår tillfälligt" : "Slå på fästning"}
        >
          <Magnet size={13} className={snapEnabled ? "text-[var(--timeline)]" : ""} />
          Fäst
        </ToolButton>
        <ToolButton
          onClick={() => setShowAllTracks((value) => !value)}
          title={showAllTracks ? "Dölj tomma spår" : "Visa alla video-, ljud- och effektspår"}
        >
          <Layers3 size={13} className={showAllTracks ? "text-[var(--caption)]" : ""} />
          {showAllTracks ? "Aktiva spår" : "Alla spår"}
        </ToolButton>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton onClick={() => zoomBy(1 / 1.4)} title="Zooma ut tidslinjen">
            <ZoomOut size={13} />
          </ToolButton>
          <button
            onClick={() => setZoom(null)}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#697583] transition hover:bg-white/[0.06] hover:text-[#c3ccd5]"
            title="Visa hela tidslinjen"
          >
            Anpassa
          </button>
          <ToolButton onClick={() => zoomBy(1.4)} title="Zooma in tidslinjen">
            <ZoomIn size={13} />
          </ToolButton>
          <span className="ml-2 font-mono text-[10px] tabular-nums text-[#697583]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* tracks */}
      <div className="flex min-h-0 flex-1">
        {/* headers */}
        <div
          ref={headerScrollRef}
          className="shrink-0 overflow-hidden border-r border-white/[0.07]"
          style={{ width: HEADER_W }}
        >
          <div className="h-5" />
          {visibleTracks.map((track) => (
            <TrackHeader key={track.id} track={track} />
          ))}
          <div className="flex items-center gap-1 px-2 text-[10px] font-medium text-[#9ce5c3]/80" style={{ height: 24 }}>
            Text
          </div>
        </div>

        {/* scrollable lanes */}
        <div
          ref={scrollRef}
          className="min-w-0 flex-1 select-none overflow-auto"
          onWheel={onWheel}
          onScroll={(event) => {
            if (headerScrollRef.current) headerScrollRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div ref={contentRef} className="relative min-h-full" style={{ width: contentW }}>
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
              {/* soundtrack beat ticks — drags and trims snap onto these */}
              {beatInfo?.beats.map((t, i) => (
                <div
                  key={`b${i}`}
                  className={`pointer-events-none absolute bottom-0 w-px ${
                    beatInfo.source === "manual" ? "bg-sky-400/70" : "bg-emerald-400/70"
                  }`}
                  style={{ left: PAD + t * pxPerSec, height: 6 }}
                />
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
                onLaneDown={onLaneDown}
                onSelect={(id, additive, range) => selectClip(id, { additive, range })}
                onDragStart={pushHistory}
                onMove={(clipId, newStart, dragged, snap) => {
                  // Group move when the dragged clip is part of a multi-selection.
                  const s = useEditorStore.getState();
                  const grouped = s.selectedClipIds.length > 1 && s.selectedClipIds.includes(clipId);
                  let start = newStart;
                  if (snap && snapEnabled) {
                    const targets = allSnapTargets().filter(
                      (t) => t !== dragged.startTime && t !== dragged.endTime
                    );
                    const dur = dragged.endTime - dragged.startTime;
                    start = snapTime(newStart, targets, SNAP_PX / pxPerSec);
                    const endSnapped = snapTime(start + dur, targets, SNAP_PX / pxPerSec);
                    if (endSnapped !== start + dur) start = endSnapped - dur;
                  }
                  if (grouped) moveSelectedClips(clipId, start, { transient: true });
                  else moveTimelineClip(clipId, start, { transient: true });
                }}
                onTrim={(clipId, edge, newTime, snap) => {
                  const time = snap && snapEnabled
                    ? snapTime(newTime, allSnapTargets(), SNAP_PX / pxPerSec)
                    : newTime;
                  trimTimelineClip(clipId, edge, time, { transient: true });
                }}
              />
            ))}

            {/* captions lane — blocks are draggable and edge-trimmable */}
            <div className="relative cursor-col-resize border-t border-white/5" style={{ height: 24 }} onPointerDown={onLaneDown}>
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
                  onDragStart={pushHistory}
                  onMove={(newStart, snap) => {
                    const dur = cap.endTime - cap.startTime;
                    let start = newStart;
                    if (snap && snapEnabled) {
                      const targets = allSnapTargets().filter(
                        (t) => t !== cap.startTime && t !== cap.endTime
                      );
                      start = snapTime(newStart, targets, SNAP_PX / pxPerSec);
                      const endSnapped = snapTime(start + dur, targets, SNAP_PX / pxPerSec);
                      if (endSnapped !== start + dur) start = endSnapped - dur;
                    }
                    start = Math.max(0, start);
                    updateCaptionTiming(cap.id, start, start + dur, { transient: true });
                  }}
                  onTrim={(edge, newTime, snap) => {
                    const t =
                      snap && snapEnabled
                        ? snapTime(newTime, allSnapTargets(), SNAP_PX / pxPerSec)
                        : newTime;
                    if (edge === "start") updateCaptionTiming(cap.id, t, cap.endTime, { transient: true });
                    else updateCaptionTiming(cap.id, cap.startTime, t, { transient: true });
                  }}
                />
              ))}
            </div>

            {/* marquee selection rectangle */}
            {marquee && (
              <div
                className="pointer-events-none absolute z-20 rounded-sm border border-[#7db8ff]/70 bg-[#7db8ff]/10"
                style={{
                  left: marquee.x0,
                  top: marquee.y0,
                  width: marquee.x1 - marquee.x0,
                  height: marquee.y1 - marquee.y0,
                }}
              />
            )}

            {duration <= 0.001 && (
              <div
                className="pointer-events-none absolute flex flex-col items-center justify-center text-center"
                style={{
                  left: PAD,
                  top: RULER_H + 8,
                  width: Math.max(260, viewportW - PAD * 2),
                  height: 112,
                }}
              >
                <div className="flex items-center gap-2 rounded-full bg-white/[0.025] px-3 py-1.5 ring-1 ring-white/[0.055]">
                  <Scissors size={11} className="text-[var(--cut)]" />
                  <span className="text-[9px] font-semibold text-[#74818d]">
                    Tidslinjen väntar på material
                  </span>
                </div>
                <p className="mt-2 text-[8px] text-[#4e5a66]">
                  Importera i Bibliotek · dra klipp för att ordna · tryck S för att dela
                </p>
              </div>
            )}

            {/* playhead */}
            {duration > 0.001 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-[#ffb45b]"
                style={{ left: playheadX }}
              >
                <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-[#ffb45b]" />
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
      <span
        className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: TRACK_DOTS[track.type], opacity: track.hidden ? 0.3 : 0.8 }}
      />
      <span className={`min-w-0 flex-1 truncate text-[9px] font-semibold ${track.hidden ? "text-zinc-600" : "text-zinc-400"}`}>
        {TRACK_LABELS_SV[track.type]}
      </span>
      <HeaderIcon
        onClick={() => toggleTrackLocked(track.id)}
        title={track.locked ? "Lås upp spåret" : "Lås spåret"}
        active={track.locked}
      >
        {track.locked ? <Lock size={11} /> : <LockOpen size={11} />}
      </HeaderIcon>
      {audible && (
        <HeaderIcon
          onClick={() => toggleTrackMuted(track.id)}
          title={track.muted ? "Slå på ljudet" : "Stäng av ljudet"}
          active={track.muted}
        >
          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </HeaderIcon>
      )}
      {visual && (
        <HeaderIcon
          onClick={() => toggleTrackHidden(track.id)}
          title={track.hidden ? "Visa spåret" : "Dölj spåret"}
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
      className={`rounded p-0.5 transition ${active ? "text-[#ffb45b]" : "text-zinc-600 hover:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

interface TrackLaneProps {
  track: Track;
  media: { id: string; originalName: string; duration: number; storageUrl?: string }[];
  waveforms: Record<string, number[] | null>;
  pxPerSec: number;
  duration: number;
  selectedClipIds: string[];
  /** Live main-track drag-reorder state (null while idle / other lanes). */
  reorder: { clipId: string; dx: number; slot: number } | null;
  onReorderDrag: (clipId: string, dx: number, clientX: number) => void;
  onReorderEnd: (clipId: string) => void;
  /** Empty-lane pointer down: click scrubs, drag marquee-selects. */
  onLaneDown: (e: React.PointerEvent) => void;
  /** `additive` = Ctrl/Cmd-click toggle, `range` = Shift-click span. */
  onSelect: (id: string, additive: boolean, range: boolean) => void;
  /** Called once when a move/trim gesture actually starts (history point). */
  onDragStart: () => void;
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
  onLaneDown,
  onSelect,
  onDragStart,
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
      className={`relative border-t border-white/5 ${track.hidden ? "opacity-35" : ""}`}
      style={{ height }}
      onPointerDown={onLaneDown}
    >
      {track.clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          track={track}
          label={clipLabel(clip, media)}
          peaks={
            WAVEFORM_TRACKS.includes(track.type) && clip.assetId
              ? waveforms[clip.assetId] ?? placeholderPeaksCached(clip.assetId)
              : null
          }
          peaksRange={peaksRange(clip, media)}
          pxPerSec={pxPerSec}
          height={height}
          selected={selectedClipIds.includes(clip.id)}
          storageUrl={media.find((item) => item.id === clip.assetId)?.storageUrl}
          dragDx={reorder?.clipId === clip.id ? reorder.dx : null}
          onSelect={(additive, range) => onSelect(clip.id, additive, range)}
          onDragStart={onDragStart}
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

/** Ruler height in px (`h-5`) — lanes stack directly beneath it. */
const RULER_H = 20;

/** Top offset + height of each visible lane inside the content div. */
function computeLaneGeometry(
  visibleTracks: Track[]
): Array<{ track: Track; top: number; height: number }> {
  let y = RULER_H;
  return visibleTracks.map((track) => {
    const height = TRACK_HEIGHTS[track.type] ?? DEFAULT_TRACK_HEIGHT;
    const lane = { track, top: y, height };
    y += height;
    return lane;
  });
}

function clipLabel(clip: TimelineClip, media: { id: string; originalName: string }[]): string {
  if (clip.type === "text" || clip.type === "sticker") return clip.text ?? "";
  if (clip.type === "effects") {
    const fx = clip.effect;
    if (fx?.kind === "zoom") return `zoom ×${(fx.zoomScale ?? 1).toFixed(2)}`;
    if (fx?.kind === "slow-zoom") return `↗ slow zoom ×${(fx.zoomScale ?? 1.25).toFixed(2)}`;
    if (fx?.kind === "shake") return "✋ shake";
    if (fx?.kind === "vignette") return "◐ vignette";
    if (fx?.kind === "impact") return "⚽ goal impact";
    if (fx?.kind === "freeze") return "❄ freeze";
    if (fx?.kind === "flash") return "⚡ flash";
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
  storageUrl?: string;
  /** Visual x offset while this clip is being drag-reordered (main track). */
  dragDx: number | null;
  onSelect: (additive: boolean, range: boolean) => void;
  onDragStart: () => void;
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
  storageUrl,
  dragDx,
  onSelect,
  onDragStart,
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
    const range = e.shiftKey;
    onSelect(additive, range);
    // Modifier clicks adjust the multi-selection — no drag.
    if (additive || range || !movable) return;
    const startX = e.clientX;
    const origStart = clip.startTime;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      // Free-track moves mutate live (transient) — record one history entry
      // up front. Main-track reorder commits once on release by itself.
      if (!moved && !isMain) onDragStart();
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
    onSelect(false, false);
    const startX = e.clientX;
    const orig = edge === "start" ? clip.startTime : clip.endTime;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 2) return;
        onDragStart();
        moved = true;
      }
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
        selected ? "ring-2 ring-[#7db8ff]" : "ring-1 ring-white/10 hover:ring-white/30"
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
            backgroundImage: `url(${filmstripUrl({ id: clip.assetId!, storageUrl })})`,
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
          <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-[#7db8ff]/90" onPointerDown={startTrim("start")} />
          <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-[#7db8ff]/90" onPointerDown={startTrim("end")} />
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
  onDragStart,
  onMove,
  onTrim,
}: {
  caption: Caption;
  pxPerSec: number;
  selected: boolean;
  onJump: () => void;
  onSelect: () => void;
  onDragStart: () => void;
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
      if (!moved) onDragStart();
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
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 2) return;
        onDragStart();
        moved = true;
      }
      onTrim(edge, orig + (ev.clientX - startX) / pxPerSec, !ev.shiftKey);
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
      className={`absolute top-0.5 h-5 cursor-grab overflow-hidden rounded bg-[#5ca889]/40 px-1 text-left text-[9px] leading-5 text-[#d8f5e9] transition-colors hover:bg-[#5ca889]/60 active:cursor-grabbing ${
        selected ? "ring-1 ring-[#9ce5c3]" : ""
      }`}
      style={{ left, width }}
      title={caption.text}
      onPointerDown={startDrag}
    >
      {caption.text}
      {selected && (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-[#9ce5c3]/90" onPointerDown={startTrim("start")} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-[#9ce5c3]/90" onPointerDown={startTrim("end")} />
        </>
      )}
    </div>
  );
}

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
