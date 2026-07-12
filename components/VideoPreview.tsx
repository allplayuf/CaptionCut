"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { clipDuration, clipSpeed, formatTime, timelineToSource, totalDuration } from "@/lib/video/timeline";
import { flashOpacityAt, freezeAt, mainClips, mainVideoTrack, zoomAt } from "@/lib/timeline/tracks";
import { FORMATS, FORMAT_IDS } from "@/lib/video/formats";
import CaptionOverlay from "./CaptionOverlay";
import SafeZoneOverlay from "./SafeZoneOverlay";
import { AudioTracks, TextOverlays, VisualOverlays } from "./preview/OverlayLayers";
import { Eye, EyeOff, Maximize2, Minimize2, Pause, Play, SkipBack } from "lucide-react";

/**
 * The format-aware preview player (9:16 / 1:1 / 16:9). Plays through the main
 * video track (ordered, trimmed clips) using a single <video> element whose
 * src/currentTime are kept in sync with the store's timeline position, then
 * composites the overlay tracks (b-roll, images, text, stickers), effects
 * (punch-zooms, freeze-frames, flashes) and audio tracks on top.
 */
export default function VideoPreview() {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const analyses = useEditorStore((s) => s.analyses);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const format = useEditorStore((s) => s.format);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setFormat = useEditorStore((s) => s.setFormat);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);

  const clips = useMemo(() => mainClips(tracks), [tracks]);
  const videoTrack = mainVideoTrack(tracks);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** Last timeline time reported by the playback loop — distinguishes our own
   *  store updates from external seeks (timeline scrubs, caption clicks). */
  const internalTimeRef = useRef(-1);
  const playingRef = useRef(false);

  const [frameWidth, setFrameWidth] = useState(270);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [buffering, setBuffering] = useState(false);

  const canvas = FORMATS[format];
  const duration = totalDuration(clips);
  // Freeze-frame effect: the shown frame holds at the freeze window's start
  // while the playhead keeps moving (matches the export's cloned frame).
  const freeze = freezeAt(tracks, currentTime);
  const displayTime = freeze ? freeze.startTime : currentTime;
  const pos = timelineToSource(clips, displayTime);
  const activeMediaId = pos?.clip.mediaId ?? null;

  // Fit the format's frame into the available center area.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const aspect = canvas.width / canvas.height;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      setFrameWidth(Math.max(120, Math.min(width - 24, (height - 24) * aspect)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvas.width, canvas.height]);

  // Theater mode: fullscreen the whole preview column via the browser API.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = wrapperRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  };

  // Keep <video> src + currentTime + playbackRate in sync with the timeline.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !pos) return;

    const rate = clipSpeed(pos.clip);
    if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;

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

  // Main track mute follows the track control.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = videoTrack.muted;
  }, [videoTrack.muted]);

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
    let lastTick = performance.now();
    const tick = () => {
      if (!playingRef.current) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      const state = useEditorStore.getState();
      const stateClips = mainClips(state.tracks);
      const total = totalDuration(stateClips);

      // Inside a freeze-frame: hold the video, advance the timeline by wall
      // clock (music/sfx overlays keep playing; main audio goes silent).
      const frozen = freezeAt(state.tracks, state.currentTime);
      if (frozen) {
        if (!video.paused) video.pause();
        const t = state.currentTime + dt;
        if (t >= total - 0.02) {
          internalTimeRef.current = total;
          state.setCurrentTime(total);
          state.setPlaying(false);
          return;
        }
        internalTimeRef.current = t;
        state.setCurrentTime(t);
        raf = requestAnimationFrame(tick);
        return;
      }

      const posNow = timelineToSource(stateClips, state.currentTime);
      if (!posNow) {
        state.setPlaying(false);
        return;
      }
      const { clip, clipTimelineStart } = posNow;
      const rate = clipSpeed(clip);
      if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
      if (video.paused) {
        // Coming out of a freeze: land the video on the timeline position.
        if (video.dataset.mediaId === clip.mediaId) video.currentTime = posNow.sourceTime;
        void video.play().catch(() => {});
      }
      let t = clipTimelineStart + (video.currentTime - clip.sourceStart) / rate;

      if (video.currentTime >= clip.sourceEnd - 0.02 || video.ended) {
        const clipEnd = clipTimelineStart + clipDuration(clip);
        if (clipEnd >= total - 0.03) {
          internalTimeRef.current = total;
          state.setCurrentTime(total);
          state.setPlaying(false);
          return;
        }
        t = clipEnd + 0.001;
        const nextPos = timelineToSource(stateClips, t);
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

  const frameHeight = (frameWidth * canvas.height) / canvas.width;
  const scale = frameWidth / canvas.width;
  const hasContent = clips.length > 0;

  // Smart crop: footage wider than the canvas pans the crop window toward the
  // motion center (players/ball) — mirrors the export's crop offset.
  const cropX = useMemo(() => {
    if (!pos) return 0.5;
    const asset = media.find((m) => m.id === pos.clip.mediaId);
    const v = analyses[pos.clip.mediaId]?.video;
    if (!asset?.width || !asset.height || !v?.motionCenterX || !v.motionCenterRate) return 0.5;
    const scaleFactor = Math.max(canvas.width / asset.width, canvas.height / asset.height);
    const scaledW = asset.width * scaleFactor;
    if (scaledW - canvas.width < 40) return 0.5;
    const centers = v.motionCenterX;
    const from = Math.max(0, Math.floor(pos.clip.sourceStart * v.motionCenterRate));
    const to = Math.min(centers.length, Math.ceil(pos.clip.sourceEnd * v.motionCenterRate));
    if (to <= from) return 0.5;
    let sum = 0;
    for (let i = from; i < to; i++) sum += centers[i];
    const cx = sum / (to - from);
    // object-position p% aligns the p% point of the video with the frame's.
    const x = Math.max(0, Math.min(scaledW - canvas.width, scaledW * cx - canvas.width / 2));
    return x / (scaledW - canvas.width);
  }, [pos, media, analyses, canvas.width, canvas.height]);

  // Effects at the playhead (visual layers only).
  const zoom = zoomAt(tracks, currentTime);
  const flash = flashOpacityAt(tracks, currentTime);

  const togglePlay = () => {
    if (!hasContent) return;
    if (!isPlaying && currentTime >= duration - 0.03) setCurrentTime(0);
    setPlaying(!isPlaying);
  };

  /** Seek from a pointer position on the scrubber. */
  const scrubTo = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setCurrentTime(frac * duration);
  };

  const onScrubberDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasContent) return;
    const el = e.currentTarget;
    setPlaying(false);
    scrubTo(e.clientX, el);
    const move = (ev: PointerEvent) => scrubTo(ev.clientX, el);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center bg-[#08080d]">
      <div ref={wrapperRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10"
          style={{ width: frameWidth, height: frameHeight }}
        >
          {hasContent ? (
            <>
              {/* zoomable visual stack: main video + b-roll + images */}
              <div
                className="absolute inset-0"
                style={{
                  transform: `scale(${zoom.scale})`,
                  transformOrigin: `${zoom.anchorX * 100}% ${zoom.anchorY * 100}%`,
                  // Short + sharp: the export punches instantly on the cut, so
                  // the preview shouldn't ease in slowly.
                  transition: "transform 70ms ease-out",
                  willChange: "transform",
                }}
              >
                <video
                  ref={videoRef}
                  className={`h-full w-full object-cover ${videoTrack.hidden ? "opacity-0" : ""}`}
                  style={{ objectPosition: `${(cropX * 100).toFixed(1)}% 50%` }}
                  playsInline
                  preload="auto"
                  onClick={togglePlay}
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onCanPlay={() => setBuffering(false)}
                  onSeeking={() => setBuffering(true)}
                  onSeeked={() => setBuffering(false)}
                />
                <VisualOverlays scale={scale} canvasW={canvas.width} canvasH={canvas.height} />
              </div>

              {/* flash sits above the footage but below text/captions — same
                  stacking as the export (overlay before libass burn-in) */}
              {flash > 0 && (
                <div
                  className="pointer-events-none absolute inset-0 bg-white"
                  style={{ opacity: flash }}
                />
              )}
              <TextOverlays scale={scale} canvasW={canvas.width} canvasH={canvas.height} />
              <AudioTracks />
              {buffering && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-4xl">🎬</div>
              <p className="text-sm font-medium text-zinc-400">
                Upload a video to get started
              </p>
              <p className="text-xs text-zinc-600">
                It will be fit to {canvas.id} · {canvas.width}×{canvas.height} automatically
              </p>
            </div>
          )}

          <CaptionOverlay scale={scale} />
          {showSafeZones && hasContent && format === "9:16" && <SafeZoneOverlay scale={scale} />}
        </div>
      </div>

      {/* scrubber */}
      <div
        className={`group mt-3 w-full max-w-md ${hasContent ? "cursor-pointer" : "opacity-40"}`}
        onPointerDown={onScrubberDown}
        title="Seek"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 transition-all group-hover:h-2.5">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
            style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* transport bar */}
      <div className="mt-2 flex w-full max-w-md items-center justify-center gap-3">
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
        <div className="flex items-center gap-0.5 rounded-full bg-white/5 p-0.5 ring-1 ring-white/10" title="Editing format">
          {FORMAT_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setFormat(id)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold transition ${
                id === format
                  ? "bg-violet-500/30 text-violet-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        {format === "9:16" && (
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
        )}
        <button
          onClick={toggleFullscreen}
          disabled={!hasContent}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title={isFullscreen ? "Exit theater mode" : "Theater mode (fullscreen)"}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}
