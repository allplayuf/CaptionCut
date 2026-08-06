"use client";

import { useState } from "react";
import type { TimelineClip, Track, TransitionKind } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { transitionSpec } from "@/lib/timeline/transitions";
import {
  Copy,
  Gauge,
  Maximize,
  Scissors,
  Shuffle,
  Snowflake,
  Trash2,
  Video,
  Volume2,
} from "lucide-react";

/**
 * Actions for the selected clip, on the clip.
 *
 * Every one of these already existed — split, speed, freeze, framing,
 * stabilize, duplicate, delete — but they were spread across the Inspector
 * panel and the keyboard map, so working on a single clip meant leaving the
 * timeline. Anchoring them to the selection is the direct-manipulation pattern
 * that makes an editor feel immediate rather than administrative.
 */

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export default function ClipToolbar({
  clip,
  track,
  left,
  laneTop,
}: {
  clip: TimelineClip;
  track: Track;
  /** Clip's left edge in content-space pixels. */
  left: number;
  /** Top of the clip's lane in content-space pixels. */
  laneTop: number;
}) {
  const updateTimelineClip = useEditorStore((s) => s.updateTimelineClip);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const deleteClip = useEditorStore((s) => s.deleteClip);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const addEffectClip = useEditorStore((s) => s.addEffectClip);
  const addToast = useEditorStore((s) => s.addToast);
  const [showSpeeds, setShowSpeeds] = useState(false);

  const isMain = track.type === "video";
  const hasAudio = ["music", "sfx", "voice", "broll"].includes(track.type);
  const speed = clip.speed ?? 1;
  const locked = track.locked;
  const isFirstClip = track.clips[0]?.id === clip.id;
  const transition = clip.transition ?? "none";

  /** One button, three states — the whole choice is Cut / Dip / Flash. */
  const cycleTransition = () => {
    const order: TransitionKind[] = ["none", "dip", "flash"];
    const next = order[(order.indexOf(transition) + 1) % order.length];
    updateTimelineClip(clip.id, { transition: next });
  };

  /** The playhead has to be inside the clip for a split to mean anything. */
  const splitHere = () => {
    const time = useEditorStore.getState().currentTime;
    if (time <= clip.startTime + 0.05 || time >= clip.endTime - 0.05) {
      addToast("info", "Move the playhead into the clip to split it.");
      return;
    }
    splitAtPlayhead();
  };

  const freezeHere = () => {
    const time = useEditorStore.getState().currentTime;
    const at = time > clip.startTime && time < clip.endTime ? time : clip.startTime;
    addEffectClip(at, Math.min(1.2, Math.max(0.3, clip.endTime - at)), { kind: "freeze" });
    addToast("success", "Freeze frame added.");
  };

  // Sit above the lane, or below it when the clip is on the very first row.
  const above = laneTop >= 34;

  return (
    <div
      className="absolute z-30 flex items-center gap-0.5 rounded-lg bg-[#161b22] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.12]"
      style={{ left: Math.max(2, left), top: above ? laneTop - 32 : laneTop + 44 }}
      role="toolbar"
      aria-label="Clip actions"
      // The timeline's lane handler treats bare pointer-downs as a scrub.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {isMain && (
        <ToolButton onClick={splitHere} title="Split at the playhead (C)" disabled={locked}>
          <Scissors size={12} />
        </ToolButton>
      )}

      {isMain && (
        <div className="relative">
          <ToolButton
            onClick={() => setShowSpeeds((v) => !v)}
            title="Playback speed"
            active={speed !== 1}
            disabled={locked}
          >
            <Gauge size={12} />
            <span className="text-[9px] font-bold tabular-nums">{speed}×</span>
          </ToolButton>
          {showSpeeds && (
            <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 rounded-lg bg-[#161b22] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.12]">
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    updateTimelineClip(clip.id, { speed: value });
                    setShowSpeeds(false);
                  }}
                  aria-pressed={speed === value}
                  className={`rounded px-1.5 py-1 text-[9px] font-bold tabular-nums transition ${
                    speed === value
                      ? "bg-[var(--cut)]/18 text-[#f2c38a]"
                      : "text-[#8d949e] hover:text-[#d3d8de]"
                  }`}
                >
                  {value}×
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isMain && (
        <ToolButton onClick={freezeHere} title="Freeze this frame" disabled={locked}>
          <Snowflake size={12} />
        </ToolButton>
      )}

      {/* The first clip has no incoming cut to transition across. */}
      {isMain && !isFirstClip && (
        <ToolButton
          onClick={cycleTransition}
          title={`Transition into this clip: ${transitionSpec(transition).name} — ${transitionSpec(transition).hint}`}
          active={transition !== "none"}
          disabled={locked}
        >
          <Shuffle size={12} />
          {transition !== "none" && (
            <span className="text-[9px] font-bold">{transitionSpec(transition).name}</span>
          )}
        </ToolButton>
      )}

      {isMain && (
        <ToolButton
          onClick={() =>
            updateTimelineClip(clip.id, { fit: clip.fit === "fit" ? "fill" : "fit" })
          }
          title={
            clip.fit === "fit"
              ? "Letterboxed with a blurred fill — switch to fill the frame"
              : "Fills the frame — switch to letterbox with a blurred fill"
          }
          active={clip.fit === "fit"}
          disabled={locked}
        >
          <Maximize size={12} />
        </ToolButton>
      )}

      {isMain && (
        <ToolButton
          onClick={() => updateTimelineClip(clip.id, { stabilize: !clip.stabilize })}
          title="Smooth out camera shake (applied on export)"
          active={Boolean(clip.stabilize)}
          disabled={locked}
        >
          <Video size={12} />
        </ToolButton>
      )}

      {hasAudio && (
        <div className="flex items-center gap-1 px-1">
          <Volume2 size={12} className="text-[#8d949e]" />
          <input
            type="range"
            min={0}
            max={200}
            value={Math.round((clip.volume ?? 1) * 100)}
            onChange={(e) =>
              updateTimelineClip(clip.id, { volume: parseInt(e.target.value, 10) / 100 })
            }
            className="w-16 accent-[var(--cut)]"
            aria-label="Clip volume"
            disabled={locked}
          />
        </div>
      )}

      <span className="mx-0.5 h-4 w-px bg-white/[0.1]" />

      <ToolButton onClick={() => duplicateClip(clip.id)} title="Duplicate (Ctrl+D)" disabled={locked}>
        <Copy size={12} />
      </ToolButton>
      <ToolButton onClick={() => deleteClip(clip.id)} title="Delete (Del)" danger disabled={locked}>
        <Trash2 size={12} />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  title,
  active,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={`flex h-6 items-center gap-1 rounded px-1.5 transition disabled:opacity-30 ${
        active
          ? "bg-[var(--cut)]/18 text-[#f2c38a]"
          : danger
            ? "text-[#8d949e] hover:bg-[#ff5f56]/15 hover:text-[#ff8079]"
            : "text-[#8d949e] hover:bg-white/[0.07] hover:text-[#d3d8de]"
      }`}
    >
      {children}
    </button>
  );
}
