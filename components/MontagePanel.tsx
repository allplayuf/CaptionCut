"use client";

import { useState } from "react";
import type { MontageModifiers, MontageStyle } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useMontageBuilder } from "@/hooks/useMontageBuilder";
import { MONTAGE_PRESETS } from "@/lib/autoEdit/montage";
import { assetKind, mainVideoTrack, tracksDuration } from "@/lib/timeline/tracks";
import {
  Clapperboard,
  Gauge,
  RefreshCw,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react";

/**
 * The main event: turn a pile of imported clips into a finished montage.
 *
 * The engine behind this (lib/autoEdit/montage.ts) already ranks moments,
 * drops repeats and locks cuts to the music — it was just buried behind a
 * multi-step setup. Here it is one button, with the two choices that actually
 * change the result (style, length) visible up front and everything else
 * offered as a nudge *after* you've seen a cut.
 */

/** Interview needs speech and per-clip roles — that lives in the advanced panel. */
const STYLES = (Object.keys(MONTAGE_PRESETS) as MontageStyle[]).filter(
  (id) => id !== "interview"
);

const LENGTHS = [12, 20, 30];

export default function MontagePanel({ onOpenAdvanced }: { onOpenAdvanced?: () => void }) {
  const media = useEditorStore((s) => s.media);
  const tracks = useEditorStore((s) => s.tracks);
  const editRecipe = useEditorStore((s) => s.editRecipe);
  const addMediaBatchToTimeline = useEditorStore((s) => s.addMediaBatchToTimeline);
  const undo = useEditorStore((s) => s.undo);
  const setPlaying = useEditorStore((s) => s.setPlaying);

  const [preset, setPreset] = useState<MontageStyle>("hype");
  const [targetDuration, setTargetDuration] = useState(20);
  /** Sticky nudges — every rebuild keeps them until they're switched off. */
  const [modifiers, setModifiers] = useState<MontageModifiers>({});
  const [seed, setSeed] = useState(0);

  const { building, stage, buildAndApply } = useMontageBuilder();

  const videoAssets = media.filter((asset) => assetKind(asset) === "video");
  const clipCount = mainVideoTrack(tracks).clips.length;
  const duration = tracksDuration(tracks);
  const built = editRecipe !== null;

  const addEverything = () => addMediaBatchToTimeline(videoAssets.map((a) => a.id));

  const build = async (nextSeed: number, mods: MontageModifiers) => {
    const ok = await buildAndApply({ preset, targetDuration, seed: nextSeed, modifiers: mods });
    if (ok) setPlaying(true);
  };

  const buildNow = () => {
    setSeed(0);
    void build(0, modifiers);
  };

  /** A different take from the same footage — same settings, new seed. */
  const regenerate = () => {
    const next = seed + 1;
    setSeed(next);
    void build(next, modifiers);
  };

  /** Apply a nudge and immediately re-cut so the change is visible. */
  const nudge = (patch: MontageModifiers) => {
    const next = { ...modifiers, ...patch };
    setModifiers(next);
    void build(seed, next);
  };

  const toggleNudge = (key: keyof MontageModifiers, value: number | "action" | "reaction") => {
    const active = modifiers[key] === value;
    nudge({ [key]: active ? undefined : value } as MontageModifiers);
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--panel)] p-4">
      <p className="panel-eyebrow text-[#f2c38a]">Montage</p>
      <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text)]">
        {clipCount > 0 ? "Cut it together" : "Start with your clips"}
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        {clipCount > 0
          ? `${clipCount} ${clipCount === 1 ? "clip" : "clips"} on the timeline · ${Math.round(duration)}s of footage.`
          : "Drop your match footage in, then build the cut in one tap."}
      </p>

      {/* Nothing on the timeline yet — offer the whole library at once. */}
      {clipCount === 0 && videoAssets.length > 0 && (
        <button
          type="button"
          onClick={addEverything}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--cut)] px-4 py-3 text-[12px] font-extrabold text-[#1b140b] transition hover:bg-[#fac688]"
        >
          <Clapperboard size={15} />
          Add all {videoAssets.length} clips
        </button>
      )}

      {clipCount === 0 && videoAssets.length === 0 && (
        <p className="mt-4 rounded-lg bg-white/[0.025] p-3 text-[10px] leading-relaxed text-[#79818c] ring-1 ring-white/[0.06]">
          Import video in the Media tool first. Everything after that is one tap.
        </p>
      )}

      {clipCount > 0 && (
        <>
          <SectionLabel>Style</SectionLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setPreset(id)}
                aria-pressed={preset === id}
                title={MONTAGE_PRESETS[id].description}
                className={`rounded-md px-2.5 py-2 text-left text-[10px] font-semibold ring-1 transition ${
                  preset === id
                    ? "bg-[var(--cut)]/12 text-[#f2c38a] ring-[var(--cut)]/35"
                    : "bg-white/[0.03] text-[#8d949e] ring-white/[0.07] hover:text-[#c3c9d1]"
                }`}
              >
                {MONTAGE_PRESETS[id].name}
              </button>
            ))}
          </div>

          <SectionLabel>Length</SectionLabel>
          <div className="flex gap-1.5">
            {LENGTHS.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setTargetDuration(sec)}
                aria-pressed={targetDuration === sec}
                className={`flex-1 rounded-md py-2 text-[10px] font-semibold ring-1 transition ${
                  targetDuration === sec
                    ? "bg-[var(--cut)]/12 text-[#f2c38a] ring-[var(--cut)]/35"
                    : "bg-white/[0.03] text-[#8d949e] ring-white/[0.07] hover:text-[#c3c9d1]"
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={buildNow}
            disabled={building}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--cut)] px-4 py-3.5 text-[12px] font-extrabold text-[#1b140b] transition hover:bg-[#fac688] disabled:opacity-60"
          >
            {building ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#1b140b]/30 border-t-[#1b140b]" />
            ) : (
              <Wand2 size={15} />
            )}
            {building ? "Building…" : built ? "Build it again" : "Build my montage"}
          </button>

          {stage && (
            <p className="mt-2 text-center text-[10px] text-[#7f8892]" role="status">
              {stage}
            </p>
          )}

          {built && !building && (
            <>
              <SectionLabel>Not quite right?</SectionLabel>
              <div className="space-y-1.5">
                <NudgeRow>
                  <Nudge onClick={regenerate} icon={<RefreshCw size={12} />}>
                    Another take
                  </Nudge>
                  <Nudge
                    onClick={() => toggleNudge("pace", 0.72)}
                    active={modifiers.pace === 0.72}
                    icon={<Gauge size={12} />}
                  >
                    Faster
                  </Nudge>
                </NudgeRow>
                <NudgeRow>
                  <Nudge
                    onClick={() => toggleNudge("pace", 1.35)}
                    active={modifiers.pace === 1.35}
                  >
                    Calmer
                  </Nudge>
                  <Nudge
                    onClick={() => toggleNudge("effectsLevel", 0.35)}
                    active={modifiers.effectsLevel === 0.35}
                    icon={<Sparkles size={12} />}
                  >
                    Fewer effects
                  </Nudge>
                </NudgeRow>
                <NudgeRow>
                  <Nudge
                    onClick={() => toggleNudge("favorKind", "action")}
                    active={modifiers.favorKind === "action"}
                  >
                    More action
                  </Nudge>
                  <Nudge
                    onClick={() => toggleNudge("favorKind", "reaction")}
                    active={modifiers.favorKind === "reaction"}
                  >
                    More reactions
                  </Nudge>
                </NudgeRow>
              </div>

              <button
                type="button"
                onClick={() => undo()}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-white/[0.03] py-2 text-[10px] font-semibold text-[#8d949e] ring-1 ring-white/[0.07] transition hover:text-[#c3c9d1]"
              >
                <Undo2 size={12} />
                Undo the montage
              </button>

              <p className="mt-3 text-[10px] leading-relaxed text-[#6f7883]">
                {editRecipe?.reasoningSummary}
              </p>
            </>
          )}

          {onOpenAdvanced && (
            <button
              type="button"
              onClick={onOpenAdvanced}
              className="mt-4 w-full rounded-md py-2 text-[10px] font-semibold text-[#69717b] transition hover:text-[#a6adb6]"
            >
              Interviews, per-clip control, and manual tools →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="panel-eyebrow mt-5 mb-2 text-[#6b737d]">{children}</p>
  );
}

function NudgeRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1.5">{children}</div>;
}

function Nudge({
  children,
  onClick,
  active,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-[10px] font-semibold ring-1 transition ${
        active
          ? "bg-[#7db8ff]/12 text-[#afd3ff] ring-[#7db8ff]/30"
          : "bg-white/[0.03] text-[#8d949e] ring-white/[0.07] hover:text-[#c3c9d1]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
