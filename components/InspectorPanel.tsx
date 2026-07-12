"use client";

import type { ClipTransform, TimelineClip, Track } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { formatTime } from "@/lib/video/timeline";
import { assetKind, clipSpeedOf, tracksDuration } from "@/lib/timeline/tracks";
import { FORMATS, FORMAT_IDS } from "@/lib/video/formats";
import { Copy, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";

/**
 * Right panel, Inspector tab: contextual settings for whatever is selected —
 * a timeline clip (timing, speed, volume, transform, text style, zoom effect),
 * a caption (text + timing), or, with nothing selected, the project itself.
 */
export default function InspectorPanel() {
  const tracks = useEditorStore((s) => s.tracks);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);

  let found: { track: Track; clip: TimelineClip } | null = null;
  if (selectedClipId) {
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) {
        found = { track, clip };
        break;
      }
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {found ? (
        <ClipInspector track={found.track} clip={found.clip} />
      ) : selectedCaptionId ? (
        <CaptionInspector captionId={selectedCaptionId} />
      ) : (
        <ProjectInspector />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Clip                                                              */
/* ---------------------------------------------------------------- */

function ClipInspector({ track, clip }: { track: Track; clip: TimelineClip }) {
  const media = useEditorStore((s) => s.media);
  const updateTimelineClip = useEditorStore((s) => s.updateTimelineClip);
  const moveTimelineClip = useEditorStore((s) => s.moveTimelineClip);
  const trimTimelineClip = useEditorStore((s) => s.trimTimelineClip);
  const deleteClip = useEditorStore((s) => s.deleteClip);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);

  const asset = clip.assetId ? media.find((m) => m.id === clip.assetId) : undefined;
  const isMain = track.type === "video";
  const isAudio = ["music", "sfx", "voice"].includes(track.type);
  const isText = track.type === "text";
  const isSticker = track.type === "sticker";
  const isImage = track.type === "image";
  const isBroll = track.type === "broll";
  const isZoom = track.type === "effects" && clip.effect?.kind === "zoom";
  const isFreeze = track.type === "effects" && clip.effect?.kind === "freeze";
  const isFlash = track.type === "effects" && clip.effect?.kind === "flash";
  const hasTransform = isText || isSticker || isImage;
  const duration = clip.endTime - clip.startTime;

  const t: ClipTransform = {
    x: 0,
    y: 0,
    scale: isImage ? 0.8 : 1,
    rotation: 0,
    opacity: 1,
    ...clip.transform,
  };
  const patchTransform = (patch: Partial<ClipTransform>) =>
    updateTimelineClip(clip.id, { transform: { ...t, ...patch } });

  const label =
    isText || isSticker
      ? clip.text ?? ""
      : isZoom
        ? "Punch-in zoom"
        : isFreeze
          ? "Freeze frame"
          : isFlash
            ? "Flash"
            : asset?.originalName ?? track.name;

  return (
    <>
      <header>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <SlidersHorizontal size={11} /> {track.name} clip
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{label}</p>
        {asset && (
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {asset.width > 0 && `${asset.width}×${asset.height} · `}
            {assetKind(asset) !== "image" && `${formatTime(asset.duration)} source`}
          </p>
        )}
      </header>

      {/* timing */}
      <Section title="Timing">
        <div className="grid grid-cols-3 gap-1.5">
          <Readout label="Start" value={formatTime(clip.startTime)} />
          <Readout label="End" value={formatTime(clip.endTime)} />
          <Readout label="Length" value={`${duration.toFixed(2)}s`} />
        </div>
        {!isMain && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <NumberField
              label="Start (s)"
              value={clip.startTime}
              step={0.1}
              min={0}
              onChange={(v) => moveTimelineClip(clip.id, v)}
            />
            <NumberField
              label="End (s)"
              value={clip.endTime}
              step={0.1}
              min={clip.startTime + 0.2}
              onChange={(v) => trimTimelineClip(clip.id, "end", v)}
            />
          </div>
        )}
        {isMain && clip.sourceStart !== undefined && (
          <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
            Using {clip.sourceStart.toFixed(2)}s – {(clip.sourceEnd ?? 0).toFixed(2)}s of the source.
            Drag the clip edges on the timeline to trim.
          </p>
        )}
      </Section>

      {/* speed (main video) */}
      {isMain && (
        <Section title="Speed">
          <SliderField
            label="Playback rate"
            value={clipSpeedOf(clip)}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => updateTimelineClip(clip.id, { speed: Math.abs(v - 1) < 0.026 ? undefined : v })}
          />
          <div className="mt-1 flex gap-1">
            {[0.5, 0.85, 1, 1.5, 2].map((v) => (
              <button
                key={v}
                onClick={() => updateTimelineClip(clip.id, { speed: v === 1 ? undefined : v })}
                className={`flex-1 rounded px-1 py-0.5 text-[10px] font-semibold ring-1 transition ${
                  Math.abs(clipSpeedOf(clip) - v) < 0.026
                    ? "bg-violet-500/25 text-violet-200 ring-violet-400"
                    : "bg-white/5 text-zinc-400 ring-white/10 hover:bg-white/10"
                }`}
              >
                {v}×
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* audio */}
      {(isAudio || isBroll) && (
        <Section title="Audio">
          <SliderField
            label="Volume"
            value={clip.volume ?? (isBroll ? 0 : 1)}
            min={0}
            max={2}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => updateTimelineClip(clip.id, { volume: v })}
          />
          {isAudio && (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <NumberField
                label="Fade in (s)"
                value={clip.fadeIn ?? 0}
                step={0.1}
                min={0}
                onChange={(v) => updateTimelineClip(clip.id, { fadeIn: v > 0.01 ? v : undefined })}
              />
              <NumberField
                label="Fade out (s)"
                value={clip.fadeOut ?? 0}
                step={0.1}
                min={0}
                onChange={(v) => updateTimelineClip(clip.id, { fadeOut: v > 0.01 ? v : undefined })}
              />
            </div>
          )}
        </Section>
      )}

      {/* text content + style */}
      {(isText || isSticker) && (
        <Section title={isSticker ? "Sticker" : "Text"}>
          <textarea
            value={clip.text ?? ""}
            onChange={(e) => updateTimelineClip(clip.id, { text: e.target.value })}
            rows={isSticker ? 1 : 2}
            className="w-full resize-none rounded-lg border-0 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none ring-1 ring-white/10 transition focus:ring-violet-400"
          />
          {isText && <TextStyleFields clip={clip} />}
        </Section>
      )}

      {/* transform */}
      {hasTransform && (
        <Section
          title="Transform"
          action={
            <button
              onClick={() =>
                updateTimelineClip(clip.id, {
                  transform: { x: 0, y: isText ? -520 : 0, scale: isImage ? 0.8 : 1, rotation: 0, opacity: 1 },
                })
              }
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
              title="Reset position, scale and rotation"
            >
              <RotateCcw size={10} /> Reset
            </button>
          }
        >
          <SliderField label="Horizontal" value={t.x} min={-540} max={540} step={5} format={(v) => `${Math.round(v)}px`} onChange={(v) => patchTransform({ x: v })} />
          <SliderField label="Vertical" value={t.y} min={-960} max={960} step={5} format={(v) => `${Math.round(v)}px`} onChange={(v) => patchTransform({ y: v })} />
          <SliderField label="Scale" value={t.scale} min={0.2} max={isImage ? 1 : 3} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchTransform({ scale: v })} />
          <SliderField label="Rotation" value={t.rotation} min={-45} max={45} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => patchTransform({ rotation: v })} />
          <SliderField label="Opacity" value={t.opacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchTransform({ opacity: v })} />
        </Section>
      )}

      {/* zoom effect */}
      {isZoom && clip.effect && (
        <Section title="Punch-in zoom">
          <SliderField
            label="Zoom strength"
            value={clip.effect.zoomScale ?? 1.15}
            min={1.02}
            max={2}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => updateTimelineClip(clip.id, { effect: { ...clip.effect!, zoomScale: v } })}
          />
          <SliderField
            label="Anchor ↔"
            value={clip.effect.anchorX ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => updateTimelineClip(clip.id, { effect: { ...clip.effect!, anchorX: v } })}
          />
          <SliderField
            label="Anchor ↕"
            value={clip.effect.anchorY ?? 0.45}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => updateTimelineClip(clip.id, { effect: { ...clip.effect!, anchorY: v } })}
          />
        </Section>
      )}

      {/* freeze / flash effects */}
      {isFreeze && (
        <Section title="Freeze frame">
          <p className="text-[10px] leading-snug text-zinc-500">
            Holds the frame at {formatTime(clip.startTime)} for {duration.toFixed(2)}s while the
            timeline (music, captions) keeps running. Trim the clip edges to change the hold length.
          </p>
        </Section>
      )}
      {isFlash && (
        <Section title="Flash">
          <p className="text-[10px] leading-snug text-zinc-500">
            White flash pop that decays over the clip&apos;s {duration.toFixed(2)}s — great on goals
            and impacts. Trim the clip to change how long the flash lingers.
          </p>
        </Section>
      )}

      {/* actions */}
      <div className="flex gap-1.5">
        <button
          onClick={() => duplicateClip(clip.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
        >
          <Copy size={12} /> Duplicate
        </button>
        <button
          onClick={() => deleteClip(clip.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-400/20 transition hover:bg-rose-500/20"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </>
  );
}

function TextStyleFields({ clip }: { clip: TimelineClip }) {
  const updateTimelineClip = useEditorStore((s) => s.updateTimelineClip);
  const s = clip.style ?? {};
  const patch = (p: Partial<NonNullable<TimelineClip["style"]>>) =>
    updateTimelineClip(clip.id, { style: { ...s, ...p } });

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <SliderField
        label="Font size"
        value={s.fontSize ?? 64}
        min={24}
        max={160}
        step={2}
        format={(v) => `${Math.round(v)}px`}
        onChange={(v) => patch({ fontSize: v })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <ColorField label="Text" value={s.color ?? "#FFFFFF"} onChange={(v) => patch({ color: v })} />
        <ColorField label="Outline" value={s.strokeColor ?? "#000000"} onChange={(v) => patch({ strokeColor: v })} />
      </div>
      <SliderField
        label="Outline width"
        value={s.strokeWidth ?? 5}
        min={0}
        max={12}
        step={1}
        format={(v) => `${Math.round(v)}px`}
        onChange={(v) => patch({ strokeWidth: v })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Caption                                                           */
/* ---------------------------------------------------------------- */

function CaptionInspector({ captionId }: { captionId: string }) {
  const captions = useEditorStore((s) => s.captions);
  const updateCaptionText = useEditorStore((s) => s.updateCaptionText);
  const updateCaptionTiming = useEditorStore((s) => s.updateCaptionTiming);
  const deleteCaption = useEditorStore((s) => s.deleteCaption);
  const splitCaption = useEditorStore((s) => s.splitCaption);
  const mergeCaptionWithNext = useEditorStore((s) => s.mergeCaptionWithNext);

  const caption = captions.find((c) => c.id === captionId);
  if (!caption) return <ProjectInspector />;

  return (
    <>
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Caption</p>
        <p className="mt-1 font-mono text-[10px] text-zinc-500">
          {formatTime(caption.startTime)} → {formatTime(caption.endTime)}
        </p>
      </header>

      <Section title="Text">
        <textarea
          value={caption.text}
          onChange={(e) => updateCaptionText(caption.id, e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border-0 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none ring-1 ring-white/10 transition focus:ring-violet-400"
        />
      </Section>

      <Section title="Timing">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="Start (s)"
            value={caption.startTime}
            step={0.05}
            min={0}
            onChange={(v) => updateCaptionTiming(caption.id, v, caption.endTime)}
          />
          <NumberField
            label="End (s)"
            value={caption.endTime}
            step={0.05}
            min={0}
            onChange={(v) => updateCaptionTiming(caption.id, caption.startTime, v)}
          />
        </div>
      </Section>

      <div className="flex gap-1.5">
        <button
          onClick={() => splitCaption(caption.id)}
          className="flex-1 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
        >
          Split
        </button>
        <button
          onClick={() => mergeCaptionWithNext(caption.id)}
          className="flex-1 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
        >
          Merge next
        </button>
        <button
          onClick={() => deleteCaption(caption.id)}
          className="flex items-center justify-center gap-1 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-400/20 transition hover:bg-rose-500/20"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <p className="text-[10px] leading-snug text-zinc-600">
        Caption look (font, colors, position) is set for the whole project in the Style tab.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Project                                                           */
/* ---------------------------------------------------------------- */

function ProjectInspector() {
  const projectName = useEditorStore((s) => s.projectName);
  const tracks = useEditorStore((s) => s.tracks);
  const media = useEditorStore((s) => s.media);
  const captions = useEditorStore((s) => s.captions);
  const format = useEditorStore((s) => s.format);
  const setFormat = useEditorStore((s) => s.setFormat);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);

  const duration = tracksDuration(tracks);
  const mainCount = tracks.find((t) => t.type === "video")?.clips.length ?? 0;
  const overlayCount = tracks
    .filter((t) => t.type !== "video")
    .reduce((sum, t) => sum + t.clips.length, 0);

  return (
    <>
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Project</p>
        <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{projectName}</p>
      </header>

      <Section title="Format">
        <div className="flex gap-1">
          {FORMAT_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setFormat(id)}
              className={`flex-1 rounded-lg px-1 py-1.5 text-center ring-1 transition ${
                id === format
                  ? "bg-violet-500/20 text-violet-200 ring-violet-400"
                  : "bg-white/5 text-zinc-400 ring-white/10 hover:bg-white/10"
              }`}
            >
              <span className="block text-[11px] font-bold">{FORMATS[id].label}</span>
              <span className="block text-[9px] text-zinc-500">
                {FORMATS[id].width}×{FORMATS[id].height}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          The preview, captions and overlays follow this format; the matching export preset is
          preselected in the Export dialog.
        </p>
      </Section>

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-1.5">
          <Readout label="Duration" value={formatTime(duration)} />
          <Readout label="Clips" value={`${mainCount} main · ${overlayCount} overlay`} />
          <Readout label="Captions" value={String(captions.length)} />
          <Readout label="Media files" value={String(media.length)} />
        </div>
      </Section>

      <Section title="Preview">
        <label className="flex cursor-pointer items-center justify-between rounded-lg bg-white/5 px-2.5 py-2 ring-1 ring-white/8">
          <span className="text-[11px] font-medium text-zinc-300">TikTok safe-zone guides</span>
          <input
            type="checkbox"
            checked={showSafeZones}
            onChange={toggleSafeZones}
            className="h-3.5 w-3.5 accent-violet-400"
          />
        </label>
      </Section>

      <p className="text-[10px] leading-snug text-zinc-600">
        Select a clip on the timeline or a caption to edit its settings here. Export format
        (TikTok, Instagram Square, Landscape) is chosen in the Export dialog.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Field primitives                                                  */
/* ---------------------------------------------------------------- */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/8">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-200">{value}</p>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-1 block">
      <span className="flex items-center justify-between text-[10px] text-zinc-500">
        {label}
        <span className="font-mono text-zinc-300">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-0.5 w-full accent-violet-400"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        step={step}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v);
        }}
        className="mt-0.5 w-full rounded-lg border-0 bg-white/5 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none ring-1 ring-white/10 transition focus:ring-violet-400"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/8">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </label>
  );
}
