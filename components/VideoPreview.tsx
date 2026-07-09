"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { clipDuration, formatTime, timelineToSource, totalDuration } from "@/lib/video/timeline";
import CaptionOverlay from "./CaptionOverlay";
import SafeZoneOverlay from "./SafeZoneOverlay";
import { Eye, EyeOff, Pause, Play, SkipBack } from "lucide-react";

/**
 * The 9:16 preview player. Plays through the virtual timeline (ordered,
 * trimmed clips) using a single <video> element whose src/currentTime are kept
 * in sync with the store's timeline position.
 */
export default function VideoPreview() {
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** Last timeline time reported by the playback loop — distinguishes our own
   *  store updates from external seeks (timeline scrubs, caption clicks). */
  const internalTimeRef = useRef(-1);
  const playingRef = useRef(false);

  const [frameWidth, setFrameWidth] = useState(270);

  const duration = totalDuration(clips);
  const pos = timelineToSource(clips, currentTime);
  const activeMediaId = pos?.clip.mediaId ?? null;

  // Fit the 9:16 frame into the available center area.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setFrameWidth(Math.max(120, Math.min(width - 24, ((height - 24) * 9) / 16)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep <video> src + currentTime in sync with the timeline position.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !pos) return;

    if (video.dataset.mediaId !== pos.clip.mediaId) {
      video.dataset.mediaId = pos.clip.mediaId;
      video.src = mediaUrl(pos.clip.mediaId);
      video.currentTime = pos.sourceTime;
      if (playingRef.current) void video.play().catch(() => setPlaying(false));
      internalTimeRef.current = currentTime;
      return;
    }
    // External seek (scrub/caption click) — our own playback updates match
    // internalTimeRef exactly and are skipped.
    if (Math.abs(currentTime - internalTimeRef.current) > 0.0005) {
      if (Math.abs(video.currentTime - pos.sourceTime) > 0.04) {
        video.currentTime = pos.sourceTime;
      }
      internalTimeRef.current = currentTime;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, activeMediaId, clips]);

  // Playback loop: advance the timeline from the video's clock, hopping
  // across clip boundaries.
  useEffect(() => {
    playingRef.current = isPlaying;
    const video = videoRef.current;
    if (!video) return;

    if (!isPlaying) {
      video.pause();
      return;
    }

    void video.play().catch(() => setPlaying(false));
    let raf = 0;
    const tick = () => {
      if (!playingRef.current) return;
      const state = useEditorStore.getState();
      const posNow = timelineToSource(state.clips, state.currentTime);
      if (!posNow) {
        state.setPlaying(false);
        return;
      }
      const { clip, clipTimelineStart } = posNow;
      const total = totalDuration(state.clips);
      let t = clipTimelineStart + (video.currentTime - clip.sourceStart);

      if (video.currentTime >= clip.sourceEnd - 0.02 || video.ended) {
        const clipEnd = clipTimelineStart + clipDuration(clip);
        if (clipEnd >= total - 0.03) {
          internalTimeRef.current = total;
          state.setCurrentTime(total);
          state.setPlaying(false);
          return;
        }
        t = clipEnd + 0.001;
        const nextPos = timelineToSource(state.clips, t);
        // Same-file boundary needs a manual seek; a file switch is handled by
        // the src-sync effect above.
        if (nextPos && nextPos.clip.mediaId === clip.mediaId) {
          video.currentTime = nextPos.sourceTime;
        }
      }

      internalTimeRef.current = t;
      state.setCurrentTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const frameHeight = (frameWidth * 16) / 9;
  const scale = frameWidth / 1080;
  const hasContent = clips.length > 0;

  const togglePlay = () => {
    if (!hasContent) return;
    if (!isPlaying && currentTime >= duration - 0.03) setCurrentTime(0);
    setPlaying(!isPlaying);
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <div ref={wrapperRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10"
          style={{ width: frameWidth, height: frameHeight }}
        >
          {hasContent ? (
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              preload="auto"
              onClick={togglePlay}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-4xl">🎬</div>
              <p className="text-sm font-medium text-zinc-400">
                Upload a video to get started
              </p>
              <p className="text-xs text-zinc-600">
                It will be fit to 9:16 · 1080×1920 automatically
              </p>
            </div>
          )}

          <CaptionOverlay scale={scale} />
          {showSafeZones && hasContent && <SafeZoneOverlay scale={scale} />}
        </div>
      </div>

      {/* transport bar */}
      <div className="mt-3 flex w-full max-w-md items-center justify-center gap-3">
        <button
          onClick={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
          disabled={!hasContent}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Back to start"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={togglePlay}
          disabled={!hasContent}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/25 transition hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          title="Play/pause (Space)"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <div className="w-28 font-mono text-xs tabular-nums text-zinc-400">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <button
          onClick={toggleSafeZones}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            showSafeZones
              ? "bg-violet-500/20 text-violet-300"
              : "text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
          }`}
          title="Toggle TikTok safe-zone guides"
        >
          {showSafeZones ? <Eye size={14} /> : <EyeOff size={14} />}
          Safe zones
        </button>
      </div>
    </div>
  );
}
