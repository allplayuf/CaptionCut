"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, MediaAsset, TimelineClip } from "@/types";
import { useEditorStore, type EditorState } from "@/hooks/useEditorStore";
import { usePlayheadFrame, useCoarseTime } from "@/lib/ui/playhead";
import { mediaUrl } from "@/lib/video/client";
import { clipDuration, clipSpeed, formatTime, timelineToSource, totalDuration } from "@/lib/video/timeline";
import { effectStateAt, flashOpacityAt, freezeAt, mainClips, mainVideoTrack } from "@/lib/timeline/tracks";
import { transitionVeilAt } from "@/lib/timeline/transitions";
import { FORMATS, FORMAT_IDS } from "@/lib/video/formats";
import CaptionOverlay from "./CaptionOverlay";
import SafeZoneOverlay from "./SafeZoneOverlay";
import { AudioTracks, TextOverlays, VisualOverlays } from "./preview/OverlayLayers";
import { Eye, EyeOff, Maximize2, Minimize2, Pause, Play, Scissors, SkipBack } from "lucide-react";

/**
 * The format-aware preview player (9:16 / 1:1 / 16:9). Plays through the main
 * video track (ordered, trimmed clips) using a single <video> element whose
 * src/currentTime are kept in sync with the store's timeline position, then
 * composites the overlay tracks (b-roll, images, text, stickers), effects
 * (punch-zooms, freeze-frames, flashes) and audio tracks on top.
 *
 * Everything that changes at playback rate — the zoom/shake transform, the
 * flash and vignette layers, the scrubber fill, the <video> clock — is written
 * straight to the DOM from `usePlayheadFrame`, so a playing timeline renders
 * zero React updates. The component itself only re-renders when the *clip*
 * under the playhead changes, which is what the framing and crop depend on.
 */
export default function VideoPreview({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const analyses = useEditorStore((s) => s.analyses);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const format = useEditorStore((s) => s.format);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setFormat = useEditorStore((s) => s.setFormat);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);

  const clips = useMemo(() => mainClips(tracks), [tracks]);
  const videoTrack = mainVideoTrack(tracks);

  /** Which main clip is on screen. Changes on cuts, not on frames. */
  const activeIndex = useEditorStore(activeMainClipIndex);
  const activeMainClip: TimelineClip | null = videoTrack.clips[activeIndex] ?? null;
  const activeMediaId = activeMainClip?.assetId ?? null;
  const activeMedia = activeMediaId ? media.find((asset) => asset.id === activeMediaId) : undefined;
  /** A freeze silences the main audio, so the linked recorder must stop too. */
  const frozen = useEditorStore((s) => freezeAt(s.tracks, s.currentTime) !== null);

  const linkedAudio = activeMedia?.linkedAudio;
  const linkedAudioAsset = linkedAudio
    ? media.find((asset) => asset.id === linkedAudio.audioAssetId)
    : undefined;

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** The zoom/shake stack, the flash sheet and the vignette — all DOM-driven. */
  const stageRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const scrubFillRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  /** Last timeline time reported by the playback loop — distinguishes our own
   *  store updates from external seeks (timeline scrubs, caption clicks). */
  const internalTimeRef = useRef(-1);
  const playingRef = useRef(false);

  const [frameWidth, setFrameWidth] = useState(270);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [buffering, setBuffering] = useState(false);

  const canvas = FORMATS[format];
  const duration = totalDuration(clips);
  const frameHeight = (frameWidth * canvas.height) / canvas.width;
  const scale = frameWidth / canvas.width;
  const hasContent = clips.length > 0;
  const fitMode = activeMainClip?.fit === "fit";
  const stabilized = Boolean(activeMainClip?.stabilize);

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
  usePlayheadFrame((time, state) => {
    const video = videoRef.current;
    if (!video) return;
    // A freeze holds the shown frame at the window's start while the playhead
    // keeps moving (matches the export's cloned frame).
    const freeze = freezeAt(state.tracks, time);
    const pos = timelineToSource(clips, freeze ? freeze.startTime : time);
    if (!pos) return;

    const rate = clipSpeed(pos.clip);
    if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;

    if (video.dataset.mediaId !== pos.clip.mediaId) {
      video.dataset.mediaId = pos.clip.mediaId;
      const asset = state.media.find((m) => m.id === pos.clip.mediaId);
      video.src = mediaUrl(asset ?? pos.clip.mediaId);
      video.currentTime = pos.sourceTime;
      if (playingRef.current) void video.play().catch(() => setPlaying(false));
      internalTimeRef.current = time;
      return;
    }
    // External seek (scrub/caption click) — our own playback updates match
    // internalTimeRef exactly and are skipped.
    if (Math.abs(time - internalTimeRef.current) > 0.0005) {
      if (Math.abs(video.currentTime - pos.sourceTime) > 0.04) {
        video.currentTime = pos.sourceTime;
      }
      internalTimeRef.current = time;
    }
  });

  // Effects + scrubber, painted straight to the DOM every frame.
  usePlayheadFrame((time, state) => {
    const fx = effectStateAt(state.tracks, time);
    const stage = stageRef.current;
    if (stage) {
      // Shake offsets live on the 1080x1920 reference canvas; scale to screen
      // px exactly like the exporter scales them to its canvas.
      const shakePxX = fx.shakeX * (canvas.width / 1080) * scale;
      const shakePxY = fx.shakeY * (canvas.height / 1920) * scale;
      // Stabilize preview: the same 1.03 over-zoom the export uses to hide
      // deshake borders, so the framing matches (smoothing is export-only).
      const visualScale = fx.scale * (stabilized ? 1.03 : 1);
      stage.style.transform = `translate(${shakePxX.toFixed(2)}px, ${shakePxY.toFixed(2)}px) scale(${visualScale})`;
      stage.style.transformOrigin = `${fx.anchorX * 100}% ${fx.anchorY * 100}%`;
      // Short + sharp: the export punches instantly on the cut, so the preview
      // shouldn't ease in slowly. No easing while a shake animates every frame.
      stage.style.transition = fx.shakeX || fx.shakeY ? "none" : "transform 70ms ease-out";
      // Mirrors the export's vignette eq boost (contrast/saturation).
      stage.style.filter = fx.vignette > 0 ? "contrast(1.05) saturate(1.12)" : "";
    }
    // The gradient runs transparent -> rgba(0,0,0,0.55), so scaling its opacity
    // by the vignette amount reproduces the export's alpha exactly.
    const vignette = vignetteRef.current;
    if (vignette) vignette.style.opacity = fx.vignette.toFixed(3);

    const flash = flashRef.current;
    if (flash) flash.style.opacity = flashOpacityAt(state.tracks, time).toFixed(3);

    // Transition veil — same triangular ramp the exporter overlays on the cut.
    const veilEl = veilRef.current;
    if (veilEl) {
      const veil = transitionVeilAt(clips, time);
      veilEl.style.opacity = veil ? veil.opacity.toFixed(3) : "0";
      if (veil) veilEl.style.backgroundColor = veil.color;
    }

    const fill = scrubFillRef.current;
    const scrub = scrubRef.current;
    if (fill || scrub) {
      const total = totalDuration(mainClips(state.tracks));
      if (fill) fill.style.width = `${total > 0 ? Math.min(100, (time / total) * 100) : 0}%`;
      // Keep the slider's announced position current without re-rendering.
      // Tenths are the finest granularity the readout shows, so only publish
      // a new value when that rounded number actually moves.
      const tenths = (Math.round(time * 10) / 10).toString();
      if (scrub && scrub.dataset.at !== tenths) {
        scrub.dataset.at = tenths;
        scrub.setAttribute("aria-valuenow", tenths);
        scrub.setAttribute("aria-valuetext", `${formatTime(time)} of ${formatTime(total)}`);
      }
    }
  });

  // Main track mute follows the track control. A linked recorder can replace
  // the camera scratch track per source without muting every other video.
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted =
        videoTrack.muted ||
        Boolean(linkedAudio?.muteCameraAudio && linkedAudioAsset?.hasAudio);
    }
  }, [videoTrack.muted, linkedAudio?.muteCameraAudio, linkedAudioAsset?.hasAudio]);

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
      const frozenNow = freezeAt(state.tracks, state.currentTime);
      if (frozenNow) {
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
        // the src-sync frame callback above.
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

  // Smart crop: footage wider than the canvas pans the crop window toward the
  // motion center (players/ball) — mirrors the export's crop offset. Keyed on
  // the active clip, so it costs nothing while a clip plays through.
  const cropX = useMemo(() => {
    if (!activeMainClip?.assetId) return 0.5;
    const asset = media.find((m) => m.id === activeMainClip.assetId);
    const v = analyses[activeMainClip.assetId]?.video;
    if (!asset?.width || !asset.height || !v?.motionCenterX || !v.motionCenterRate) return 0.5;
    const scaleFactor = Math.max(canvas.width / asset.width, canvas.height / asset.height);
    const scaledW = asset.width * scaleFactor;
    if (scaledW - canvas.width < 40) return 0.5;
    const centers = v.motionCenterX;
    const from = Math.max(0, Math.floor((activeMainClip.sourceStart ?? 0) * v.motionCenterRate));
    const to = Math.min(centers.length, Math.ceil((activeMainClip.sourceEnd ?? 0) * v.motionCenterRate));
    if (to <= from) return 0.5;
    let sum = 0;
    for (let i = from; i < to; i++) sum += centers[i];
    const cx = sum / (to - from);
    // object-position p% aligns the p% point of the video with the frame's.
    const x = Math.max(0, Math.min(scaledW - canvas.width, scaledW * cx - canvas.width / 2));
    return x / (scaledW - canvas.width);
  }, [activeMainClip, media, analyses, canvas.width, canvas.height]);

  const togglePlay = () => {
    if (!hasContent) return;
    const now = useEditorStore.getState().currentTime;
    if (!isPlaying && now >= duration - 0.03) setCurrentTime(0);
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

  const onScrubberKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasContent) return;
    const step = (event.shiftKey ? 10 : 1) / 30;
    const now = useEditorStore.getState().currentTime;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = now - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = now + step;
    if (event.key === "PageDown") next = now - 5;
    if (event.key === "PageUp") next = now + 5;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = duration;
    if (next === null) return;
    event.preventDefault();
    setPlaying(false);
    setCurrentTime(Math.max(0, Math.min(duration, next)));
  };

  return (
    <div className="video-preview flex h-full min-h-0 flex-col items-center bg-transparent">
      <div className="preview-meta flex h-8 w-full shrink-0 items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="panel-eyebrow text-[#667482]">Preview</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[8px] text-[#586571]">
          <span>{canvas.width}×{canvas.height}</span>
          <span>·</span>
          <span>{canvas.id}</span>
        </div>
      </div>
      <div ref={wrapperRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          data-preview-frame
          className="relative overflow-hidden rounded-[12px] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.11]"
          style={{ width: frameWidth, height: frameHeight }}
        >
          {hasContent ? (
            <>
              {/* zoomable visual stack: main video + b-roll + images */}
              <div ref={stageRef} className="absolute inset-0" style={{ willChange: "transform" }}>
                {fitMode && (
                  <BlurredFitBackground
                    clips={clips}
                    mediaId={activeMediaId}
                    storageUrl={activeMedia?.storageUrl}
                    hidden={videoTrack.hidden}
                  />
                )}
                <video
                  ref={videoRef}
                  className={`relative h-full w-full ${fitMode ? "object-contain" : "object-cover"} ${videoTrack.hidden ? "opacity-0" : ""}`}
                  style={fitMode ? undefined : { objectPosition: `${(cropX * 100).toFixed(1)}% 50%` }}
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

              {/* vignette darkening — matches the export's vignette filter */}
              <div
                ref={vignetteRef}
                className="pointer-events-none absolute inset-0"
                style={{
                  opacity: 0,
                  background:
                    "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.55) 100%)",
                }}
              />

              {/* flash sits above the footage but below text/captions — same
                  stacking as the export (overlay before libass burn-in) */}
              <div
                ref={flashRef}
                className="pointer-events-none absolute inset-0 bg-white"
                style={{ opacity: 0 }}
              />

              {/* transition veil — stacked with the flash, below captions */}
              <div
                ref={veilRef}
                className="pointer-events-none absolute inset-0"
                style={{ opacity: 0, backgroundColor: "#000000" }}
              />
              <TextOverlays scale={scale} canvasW={canvas.width} canvasH={canvas.height} />
              <AudioTracks />
              {linkedAudio && linkedAudioAsset?.hasAudio && activeMainClip && (
                <LinkedAudioPlayer
                  asset={linkedAudioAsset}
                  clips={clips}
                  offsetSeconds={linkedAudio.offsetSeconds}
                  playing={isPlaying && !frozen}
                  muted={videoTrack.muted}
                />
              )}
              {buffering && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                </div>
              )}
              {stabilized && (
                <div
                  className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30"
                  title="Framing matches the export; the motion smoothing itself (deshake) is applied during rendering."
                >
                  Stabilized · smoothing applies on export
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#05070a] px-4 text-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--cut)]/10 text-[var(--cut)]">
                <Scissors size={14} />
              </div>
              <p className="text-[11px] font-semibold text-[#b8c1cc]">The timeline is empty</p>
              <p className="max-w-[180px] text-[9px] leading-relaxed text-[#596471]">
                Choose a video in Media. It will fit the {canvas.id} frame.
              </p>
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className="whitespace-nowrap rounded-lg bg-[var(--cut)] px-3 py-1.5 text-[8px] font-extrabold text-[#1b140b] transition hover:bg-[#fac688]"
                >
                  Open media
                </button>
              )}
            </div>
          )}

          <CaptionOverlay scale={scale} />
          {showSafeZones && hasContent && format === "9:16" && <SafeZoneOverlay scale={scale} />}
        </div>
      </div>

      {/* scrubber */}
      <div
        ref={scrubRef}
        className={`preview-scrubber group mt-3 w-full max-w-md ${hasContent ? "cursor-pointer" : "opacity-40"}`}
        onPointerDown={onScrubberDown}
        onKeyDown={onScrubberKeyDown}
        role="slider"
        tabIndex={hasContent ? 0 : -1}
        aria-label="Seek video"
        aria-disabled={!hasContent}
        aria-valuemin={0}
        // Starting value only. The playhead frame callback above rewrites this
        // attribute (and aria-valuetext) as the position moves; React never
        // re-applies it because the prop itself never changes.
        aria-valuenow={0}
        aria-valuemax={Math.max(0, duration)}
        title="Seek video"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 transition-all group-hover:h-2.5">
          <div
            ref={scrubFillRef}
            className="absolute inset-y-0 left-0 rounded-full bg-[#ffb45b]"
            style={{ width: 0 }}
          />
        </div>
      </div>

      {/* transport bar */}
      <div className="preview-controls mt-2 flex w-full max-w-md items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
          disabled={!hasContent}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Go to start"
          aria-label="Go to start"
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasContent}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#edf1f5] text-[#11151b] shadow-[0_8px_24px_rgba(0,0,0,0.32)] transition hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          title="Play/pause (Space)"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <TimeReadout duration={duration} />
        <div className="preview-format flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5 ring-1 ring-white/[0.08]" title="Video format">
          {FORMAT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFormat(id)}
              aria-label={`Video format ${id}`}
              aria-pressed={id === format}
              className={`rounded px-2 py-1 text-[10px] font-semibold transition ${
                id === format
                  ? "bg-[#7db8ff]/18 text-[#afd3ff]"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        {format === "9:16" && (
          <button
            type="button"
            onClick={toggleSafeZones}
            aria-pressed={showSafeZones}
            className={`preview-safe-zones flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              showSafeZones
                ? "bg-[#7db8ff]/15 text-[#9bcaff]"
                : "text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
            }`}
            title="Show or hide TikTok safe areas"
          >
            {showSafeZones ? <Eye size={14} /> : <EyeOff size={14} />}
            Safe areas
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          disabled={!hasContent}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Index of the main clip whose picture is showing, or -1. Past the end it
 * clamps to the last clip, matching `timelineToSource`. Allocation-free: it
 * runs on every store change for every subscriber.
 */
function activeMainClipIndex(state: EditorState): number {
  const clips = mainVideoTrack(state.tracks).clips;
  if (clips.length === 0) return -1;
  const freeze = freezeAt(state.tracks, state.currentTime);
  const shown = freeze ? freeze.startTime : state.currentTime;
  for (let i = 0; i < clips.length; i++) {
    if (shown < clips[i].endTime) return i;
  }
  return clips.length - 1;
}

/** Elapsed/total readout — a few updates a second is plenty for tenths. */
function TimeReadout({ duration }: { duration: number }) {
  const time = useCoarseTime();
  return (
    <div className="preview-time w-28 font-mono text-xs tabular-nums text-zinc-400">
      {formatTime(time)} / {formatTime(duration)}
    </div>
  );
}

/** Separate recorder audio resolved from the active video's source time. */
function LinkedAudioPlayer({
  asset,
  clips,
  offsetSeconds,
  playing,
  muted,
}: {
  asset: MediaAsset;
  clips: Clip[];
  offsetSeconds: number;
  playing: boolean;
  muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(playing);

  useEffect(() => {
    playingRef.current = playing;
    const audio = ref.current;
    if (audio && !playing) audio.pause();
  }, [playing]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = 1;
  }, [muted]);

  usePlayheadFrame((time) => {
    const audio = ref.current;
    if (!audio) return;
    const pos = timelineToSource(clips, time);
    if (!pos) return;
    audio.playbackRate = clipSpeed(pos.clip);
    const sourceTime = pos.sourceTime - offsetSeconds;
    if (sourceTime < 0 || sourceTime >= asset.duration - 0.01) {
      audio.pause();
      return;
    }
    if (Math.abs(audio.currentTime - sourceTime) > 0.04) {
      audio.currentTime = Math.max(0, Math.min(asset.duration, sourceTime));
    }
    if (playingRef.current && audio.paused) void audio.play().catch(() => {});
  });

  return <audio ref={ref} src={mediaUrl(asset)} preload="auto" />;
}

/**
 * Blurred cover-crop of the active clip behind a letterboxed ("fit") frame —
 * the preview twin of the export's boxblur background fill. It loosely tracks
 * the main video's clock; sub-100ms drift is invisible under the blur.
 */
function BlurredFitBackground({
  clips,
  mediaId,
  storageUrl,
  hidden,
}: {
  clips: Clip[];
  mediaId: string | null;
  storageUrl?: string;
  hidden: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const isPlaying = useEditorStore((s) => s.isPlaying);

  useEffect(() => {
    const el = ref.current;
    if (!el || !mediaId) return;
    if (el.dataset.mediaId !== mediaId) {
      el.dataset.mediaId = mediaId;
      el.src = mediaUrl({ id: mediaId, storageUrl });
    }
  }, [mediaId, storageUrl]);

  usePlayheadFrame((time) => {
    const el = ref.current;
    if (!el || !mediaId) return;
    const pos = timelineToSource(clips, time);
    if (!pos) return;
    if (Math.abs(el.currentTime - pos.sourceTime) > 0.2) el.currentTime = pos.sourceTime;
    if (isPlaying && el.paused) void el.play().catch(() => {});
    else if (!isPlaying && !el.paused) el.pause();
  });

  if (!mediaId) return null;
  return (
    <video
      ref={ref}
      className={`absolute inset-0 h-full w-full object-cover ${hidden ? "opacity-0" : ""}`}
      style={{ filter: "blur(14px)", transform: "scale(1.06)" }}
      muted
      playsInline
      preload="auto"
    />
  );
}
