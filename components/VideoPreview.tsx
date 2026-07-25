"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaAsset } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { mediaUrl } from "@/lib/video/client";
import { clipDuration, clipSpeed, formatTime, timelineToSource, totalDuration } from "@/lib/video/timeline";
import { effectStateAt, flashOpacityAt, freezeAt, mainClips, mainVideoTrack } from "@/lib/timeline/tracks";
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
 */
export default function VideoPreview({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
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
  const activeMedia = activeMediaId ? media.find((asset) => asset.id === activeMediaId) : undefined;
  const linkedAudio = activeMedia?.linkedAudio;
  const linkedAudioAsset = linkedAudio
    ? media.find((asset) => asset.id === linkedAudio.audioAssetId)
    : undefined;

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
      video.src = mediaUrl(activeMedia ?? pos.clip.mediaId);
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
  }, [currentTime, activeMediaId, activeMedia, clips]);

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
  const fx = effectStateAt(tracks, currentTime);
  const flash = flashOpacityAt(tracks, currentTime);

  // Per-clip framing of the clip under the playhead.
  const activeMainClip = pos
    ? videoTrack.clips.find((c) => displayTime >= c.startTime && displayTime < c.endTime) ?? null
    : null;
  const fitMode = activeMainClip?.fit === "fit";
  const stabilized = Boolean(activeMainClip?.stabilize);

  // Shake offsets live on the 1080x1920 reference canvas; scale to screen px
  // exactly like the exporter scales them to its canvas.
  const shakePxX = fx.shakeX * (canvas.width / 1080) * scale;
  const shakePxY = fx.shakeY * (canvas.height / 1920) * scale;
  // Stabilize preview: the same 1.03 over-zoom the export uses to hide
  // deshake borders, so the framing matches (smoothing itself is export-only).
  const visualScale = fx.scale * (stabilized ? 1.03 : 1);

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
    <div className="flex h-full min-h-0 flex-col items-center bg-transparent">
      <div className="flex h-8 w-full shrink-0 items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="panel-eyebrow text-[#667482]">Förhandsvisning</span>
          {hasContent && (
            <span className="rounded-full bg-[var(--caption)]/[0.06] px-2 py-0.5 text-[8px] font-semibold text-[var(--caption)] ring-1 ring-[var(--caption)]/10">
              Live
            </span>
          )}
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
          className="relative overflow-hidden rounded-[20px] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.11]"
          style={{ width: frameWidth, height: frameHeight }}
        >
          {hasContent ? (
            <>
              {/* zoomable visual stack: main video + b-roll + images */}
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${shakePxX.toFixed(2)}px, ${shakePxY.toFixed(2)}px) scale(${visualScale})`,
                  transformOrigin: `${fx.anchorX * 100}% ${fx.anchorY * 100}%`,
                  // Short + sharp: the export punches instantly on the cut, so
                  // the preview shouldn't ease in slowly. No easing while a
                  // shake/slow-zoom animates every frame.
                  transition: fx.shakeX || fx.shakeY ? "none" : "transform 70ms ease-out",
                  willChange: "transform",
                  // Mirrors the export's vignette eq boost (contrast/saturation).
                  filter: fx.vignette > 0 ? "contrast(1.05) saturate(1.12)" : undefined,
                }}
              >
                {fitMode && (
                  <BlurredFitBackground
                    mediaId={activeMediaId}
                    storageUrl={activeMedia?.storageUrl}
                    sourceTime={pos?.sourceTime ?? 0}
                    playing={isPlaying}
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
              {fx.vignette > 0 && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,${(0.55 * fx.vignette).toFixed(3)}) 100%)`,
                  }}
                />
              )}

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
              {linkedAudio && linkedAudioAsset?.hasAudio && pos && (
                <LinkedAudioPlayer
                  asset={linkedAudioAsset}
                  sourceTime={pos.sourceTime - linkedAudio.offsetSeconds}
                  playbackRate={clipSpeed(pos.clip)}
                  playing={isPlaying && !freeze}
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
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--cut)]/10 text-[var(--cut)]">
                <Scissors size={14} />
              </div>
              <p className="text-[11px] font-semibold text-[#b8c1cc]">Tidslinjen är tom</p>
              <p className="max-w-[180px] text-[9px] leading-relaxed text-[#596471]">
                Välj en video i Bibliotek. Den anpassas automatiskt till {canvas.id}.
              </p>
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className="rounded-lg bg-[var(--cut)] px-3 py-1.5 text-[8px] font-extrabold text-[#1b140b] transition hover:bg-[#fac688]"
                >
                  Öppna bibliotek
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
        className={`group mt-3 w-full max-w-md ${hasContent ? "cursor-pointer" : "opacity-40"}`}
        onPointerDown={onScrubberDown}
        title="Sök i videon"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 transition-all group-hover:h-2.5">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#ffb45b]"
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
          title="Till början"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={togglePlay}
          disabled={!hasContent}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#edf1f5] text-[#11151b] shadow-[0_8px_24px_rgba(0,0,0,0.32)] transition hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          title="Spela/pausa (Mellanslag)"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <div className="w-28 font-mono text-xs tabular-nums text-zinc-400">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5 ring-1 ring-white/[0.08]" title="Videoformat">
          {FORMAT_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setFormat(id)}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold transition ${
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
            onClick={toggleSafeZones}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              showSafeZones
                ? "bg-[#7db8ff]/15 text-[#9bcaff]"
                : "text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
            }`}
            title="Visa eller dölj TikTok-säkerhetsytor"
          >
            {showSafeZones ? <Eye size={14} /> : <EyeOff size={14} />}
            Säker yta
          </button>
        )}
        <button
          onClick={toggleFullscreen}
          disabled={!hasContent}
          className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title={isFullscreen ? "Stäng helskärm" : "Visa i helskärm"}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Blurred cover-crop of the active clip behind a letterboxed ("fit") frame —
 * the preview twin of the export's boxblur background fill. It loosely tracks
 * the main video's clock; sub-100ms drift is invisible under the blur.
 */
/** Separate recorder audio resolved from the active video's source time. */
function LinkedAudioPlayer({
  asset,
  sourceTime,
  playbackRate,
  playing,
  muted,
}: {
  asset: MediaAsset;
  sourceTime: number;
  playbackRate: number;
  playing: boolean;
  muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const inRange = sourceTime >= 0 && sourceTime < asset.duration - 0.01;

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = 1;
    audio.playbackRate = playbackRate;
  }, [muted, playbackRate]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (!inRange) {
      audio.pause();
      return;
    }
    if (Math.abs(audio.currentTime - sourceTime) > 0.04) {
      audio.currentTime = Math.max(0, Math.min(asset.duration, sourceTime));
    }
    if (playing) void audio.play().catch(() => {});
    else audio.pause();
  }, [asset.duration, inRange, playing, sourceTime]);

  return <audio ref={ref} src={mediaUrl(asset)} preload="auto" />;
}

function BlurredFitBackground({
  mediaId,
  storageUrl,
  sourceTime,
  playing,
  hidden,
}: {
  mediaId: string | null;
  storageUrl?: string;
  sourceTime: number;
  playing: boolean;
  hidden: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !mediaId) return;
    const src = mediaUrl({ id: mediaId, storageUrl });
    if (el.dataset.mediaId !== mediaId) {
      el.dataset.mediaId = mediaId;
      el.src = src;
    }
    if (Math.abs(el.currentTime - sourceTime) > 0.2) el.currentTime = sourceTime;
    if (playing && el.paused) void el.play().catch(() => {});
    else if (!playing && !el.paused) el.pause();
  }, [mediaId, storageUrl, sourceTime, playing]);

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
