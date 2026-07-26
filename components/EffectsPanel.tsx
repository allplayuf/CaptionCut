"use client";

import type { ClipEffect } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { formatTime } from "@/lib/video/timeline";
import {
  Aperture,
  Focus,
  Move,
  Snowflake,
  Sparkles,
  Sun,
  Zap,
  ZoomIn,
} from "lucide-react";

interface EffectChoice {
  id: string;
  title: string;
  description: string;
  duration: number | "remaining";
  icon: typeof Sparkles;
  tone: string;
  effect: ClipEffect;
  badge?: string;
}

const EFFECTS: EffectChoice[] = [
  {
    id: "punch",
    title: "Punch-in",
    description: "A quick, controlled push for key words and reactions.",
    duration: 0.7,
    icon: ZoomIn,
    tone: "from-[#78aef8]/25 to-[#78aef8]/5 text-[#9bc4ff]",
    effect: {
      kind: "zoom",
      zoomScale: 1.13,
      anchorX: 0.5,
      anchorY: 0.42,
      easing: "snappy",
    },
    badge: "Speech",
  },
  {
    id: "drift",
    title: "Slow drift",
    description: "A subtle cinematic push that adds life to a static frame.",
    duration: 3.2,
    icon: Focus,
    tone: "from-[#63d9c6]/25 to-[#63d9c6]/5 text-[#8ce7d8]",
    effect: {
      kind: "slow-zoom",
      zoomScale: 1.12,
      anchorX: 0.5,
      anchorY: 0.44,
      easing: "smooth",
    },
    badge: "Cinematic",
  },
  {
    id: "handheld",
    title: "Handheld",
    description: "Organic camera movement with a smooth entrance and exit.",
    duration: 0.8,
    icon: Move,
    tone: "from-[#c49af6]/25 to-[#c49af6]/5 text-[#d4b6ff]",
    effect: { kind: "shake", intensity: 0.32, easing: "smooth" },
    badge: "Energy",
  },
  {
    id: "vignette",
    title: "Cinematic focus",
    description: "Subtle edge falloff and color depth that keep focus on the subject.",
    duration: "remaining",
    icon: Aperture,
    tone: "from-[#f5b86b]/22 to-[#f5b86b]/5 text-[#ffd090]",
    effect: { kind: "vignette", strength: 0.34 },
  },
  {
    id: "impact",
    title: "Impact",
    description: "Punch, organic shake, and a short light pulse in one balanced effect.",
    duration: 0.72,
    icon: Zap,
    tone: "from-[#f08ca0]/25 to-[#f08ca0]/5 text-[#ffadba]",
    effect: {
      kind: "impact",
      zoomScale: 1.18,
      anchorX: 0.5,
      anchorY: 0.43,
      intensity: 0.5,
      easing: "snappy",
    },
    badge: "Highlight",
  },
  {
    id: "freeze",
    title: "Freeze",
    description: "Hold one frame while music, captions, and the timeline continue.",
    duration: 1.2,
    icon: Snowflake,
    tone: "from-[#a9d8ff]/20 to-[#a9d8ff]/5 text-[#c6e5ff]",
    effect: { kind: "freeze" },
  },
  {
    id: "flash",
    title: "Soft flash",
    description: "A brief light pulse with a quick attack and soft decay.",
    duration: 0.24,
    icon: Sun,
    tone: "from-white/20 to-white/[0.03] text-white",
    effect: { kind: "flash" },
  },
];

export default function EffectsPanel() {
  const tracks = useEditorStore((state) => state.tracks);
  const currentTime = useEditorStore((state) => state.currentTime);
  const addEffectClip = useEditorStore((state) => state.addEffectClip);
  const applyEffectPreset = useEditorStore((state) => state.applyEffectPreset);
  const addToast = useEditorStore((state) => state.addToast);
  const duration = tracksDuration(tracks);
  const hasVideo = duration > 0.05;
  const activeCount =
    tracks.find((track) => track.type === "effects")?.clips.filter(
      (clip) => currentTime >= clip.startTime && currentTime < clip.endTime
    ).length ?? 0;

  const apply = (choice: EffectChoice) => {
    if (!hasVideo) {
      addToast("info", "Add a video to the timeline first.");
      return;
    }
    const start = Math.min(currentTime, Math.max(0, duration - 0.08));
    const wanted =
      choice.duration === "remaining"
        ? Math.min(6, Math.max(0.4, duration - start))
        : choice.duration;
    const effectDuration = Math.max(0.08, Math.min(wanted, duration - start));
    addEffectClip(start, effectDuration, choice.effect);
    addToast(
      "success",
      `${choice.title} added at ${formatTime(start)}. Drag the block edges to change its length.`
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="panel-eyebrow text-[#c5a4ff]">Effects</p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text)]">
            Motion with control
          </h2>
        </div>
        <span
          className={`rounded-full px-2 py-1 font-mono text-[8px] ring-1 ${
            activeCount
              ? "bg-[#c49af6]/10 text-[#d1b3fb] ring-[#c49af6]/20"
              : "bg-white/[0.035] text-[#667280] ring-white/[0.07]"
          }`}
        >
          {activeCount ? `${activeCount} active` : formatTime(currentTime)}
        </span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">
        Effects start at the playhead and render exactly as previewed.
      </p>

      <section className="mt-4 rounded-lg bg-[#0a0e13] p-3 ring-1 ring-white/[0.07]">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#78aef833,#63d9c61a)] text-[#9bc4ff]">
            <Aperture size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-[#dce3ea]">Effect stacks</p>
            <p className="mt-0.5 text-[8px] leading-relaxed text-[#64717e]">
              Balanced combinations for emphasis and pacing.
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <PresetButton
            label="Impact"
            onClick={() => applyEffectPreset("goal-impact")}
            disabled={!hasVideo}
          />
          <PresetButton
            label="Reaction"
            onClick={() => applyEffectPreset("reaction")}
            disabled={!hasVideo}
          />
          <PresetButton
            label="Outro"
            onClick={() => applyEffectPreset("ending-freeze")}
            disabled={!hasVideo}
          />
        </div>
      </section>

      <div className="mt-4">
        <p className="panel-eyebrow text-[#677482]">Single effects</p>
        <div className="mt-2 space-y-2">
          {EFFECTS.map((choice) => {
            const Icon = choice.icon;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => apply(choice)}
                disabled={!hasVideo}
                className="effect-card group"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${choice.tone} ring-1 ring-white/[0.07]`}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-[#dce3e9]">{choice.title}</span>
                    {choice.badge && (
                      <span className="rounded-full bg-white/[0.045] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-[#6f7c89]">
                        {choice.badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[9px] leading-relaxed text-[#6d7986]">
                    {choice.description}
                  </span>
                </span>
                <span className="translate-x-1 text-[#4e5a67] opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100">
                  <PlusMark />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PresetButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-white/[0.045] px-2 py-2 text-[8px] font-bold text-[#aab5c0] ring-1 ring-white/[0.07] transition hover:bg-white/[0.08] hover:text-white disabled:opacity-35"
    >
      {label}
    </button>
  );
}

function PlusMark() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.05] ring-1 ring-white/[0.08]">
      +
    </span>
  );
}
