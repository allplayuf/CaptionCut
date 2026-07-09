"use client";

import { useState } from "react";
import type { Caption, EditStyle, TimeRange } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useTranscription } from "@/hooks/useTranscription";
import { invertRanges, mainClips, tracksDuration } from "@/lib/timeline/tracks";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { detectSilence, type SilenceAggressiveness } from "@/lib/autoEdit/detectSilence";
import { fillerCutRanges } from "@/lib/autoEdit/detectFillerWords";
import { detectHooks } from "@/lib/autoEdit/detectHooks";
import { findBestWindow } from "@/lib/autoEdit/scoreMoments";
import { generateEditRecipe } from "@/lib/autoEdit/generateEditRecipe";
import { Clapperboard, Crosshair, Film, Scissors, Sparkles, Wand2, Zap } from "lucide-react";

const EDIT_STYLES: Array<{ id: EditStyle; name: string }> = [
  { id: "viral", name: "Viral" },
  { id: "clean", name: "Clean" },
  { id: "podcast", name: "Podcast" },
  { id: "sports", name: "Sports" },
  { id: "storytime", name: "Storytime" },
  { id: "educational", name: "Educational" },
  { id: "meme", name: "Meme" },
];

/**
 * Right panel, AI Edit tab: one-button Auto Edit plus the individual smart
 * tools (hooks, silence/filler cuts, best-N-seconds). Everything runs locally
 * — transcript heuristics + audio amplitude, no API needed.
 */
export default function AIPanel() {
  const captions = useEditorStore((s) => s.captions);
  const tracks = useEditorStore((s) => s.tracks);
  const isTranscribing = useEditorStore((s) => s.isTranscribing);
  const editRecipe = useEditorStore((s) => s.editRecipe);

  const { runTranscription } = useTranscription();
  const [style, setStyle] = useState<EditStyle>("viral");
  const [busy, setBusy] = useState<string | null>(null);

  const duration = tracksDuration(tracks);
  const hasContent = duration > 0.5;
  const disabled = !hasContent || isTranscribing || busy !== null;

  /** Captions are the transcript — transcribe first when missing. */
  const ensureCaptions = async (): Promise<Caption[] | null> => {
    const current = useEditorStore.getState().captions;
    if (current.length > 0) return current;
    useEditorStore.getState().addToast("info", "Transcribing first — auto edit needs the transcript.");
    return runTranscription();
  };

  /** Timeline-wide amplitude curve stitched from the decoded media waveforms. */
  const timelinePeaks = (): number[] | null => {
    const s = useEditorStore.getState();
    const clips = mainClips(s.tracks);
    const out: number[] = [];
    for (const clip of clips) {
      const asset = s.media.find((m) => m.id === clip.mediaId);
      const peaks = s.waveforms[clip.mediaId];
      if (!asset || !peaks || asset.duration <= 0) return null; // amplitude unknown → transcript-only
      const from = Math.floor((clip.sourceStart / asset.duration) * peaks.length);
      const to = Math.max(from + 1, Math.ceil((clip.sourceEnd / asset.duration) * peaks.length));
      out.push(...peaks.slice(from, to));
    }
    return out.length > 0 ? out : null;
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      useEditorStore
        .getState()
        .addToast("error", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const runAutoEdit = () =>
    withBusy("auto", async () => {
      const caps = await ensureCaptions();
      if (!caps || caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const recipe = generateEditRecipe({
        projectId: s.projectId,
        transcript: analyzeTranscript(caps),
        captions: caps,
        peaks: timelinePeaks(),
        duration: dur,
        style,
      });
      s.applyEditRecipe(recipe);
    });

  const runBestSeconds = (target: number) =>
    withBusy(`best-${target}`, async () => {
      const caps = await ensureCaptions();
      if (!caps || caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const window = findBestWindow(
        { transcript: analyzeTranscript(caps), peaks: timelinePeaks(), duration: dur },
        target
      );
      if (!window) {
        s.addToast("info", "The video is already shorter than that.");
        return;
      }
      s.applyRearrange([window], `Kept the best ${Math.round(window.end - window.start)}s ✂️`);
    });

  const runRemoveSilence = (level: SilenceAggressiveness) =>
    withBusy(`silence-${level}`, async () => {
      const caps = await ensureCaptions();
      if (!caps || caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const silences = detectSilence(
        { transcript: analyzeTranscript(caps), peaks: timelinePeaks(), duration: dur },
        level
      );
      if (silences.length === 0) {
        s.addToast("info", "No cuttable silence found at this level.");
        return;
      }
      const removedSec = silences.reduce((sum, r) => sum + (r.end - r.start), 0);
      s.applyRearrange(
        invertRanges(silences, dur),
        `Removed ${removedSec.toFixed(1)}s of silence (${silences.length} cuts) 🔇`
      );
    });

  const runRemoveFillers = () =>
    withBusy("fillers", async () => {
      const caps = await ensureCaptions();
      if (!caps || caps.length === 0) return;
      const s = useEditorStore.getState();
      const dur = tracksDuration(s.tracks);
      const fillers = fillerCutRanges(analyzeTranscript(caps));
      if (fillers.length === 0) {
        s.addToast("info", "No filler words found — clean take! 👌");
        return;
      }
      s.applyRearrange(invertRanges(fillers, dur), `Cut ${fillers.length} filler words 🧹`);
    });

  const applyHookAsOpener = (hook: { startTime: number; endTime: number; text: string }) => {
    const s = useEditorStore.getState();
    const dur = tracksDuration(s.tracks);
    const range: TimeRange = {
      start: Math.max(0, hook.startTime - 0.12),
      end: Math.min(dur, hook.endTime + 0.15),
    };
    if (range.start < 0.5) {
      s.addToast("info", "That line already opens the video.");
      return;
    }
    const kept: TimeRange[] = [range, { start: 0, end: range.start }, { start: range.end, end: dur }].filter(
      (r) => r.end - r.start > 0.05
    );
    s.applyRearrange(kept, "Hook moved to the front 🎣");
  };

  const hooks = captions.length > 0 ? detectHooks(analyzeTranscript(captions), 5) : [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* auto edit */}
      <section>
        <SectionLabel>Auto Edit</SectionLabel>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {EDIT_STYLES.map((es) => (
            <button
              key={es.id}
              onClick={() => setStyle(es.id)}
              className={`rounded-lg px-1 py-1.5 text-[10px] font-semibold transition ${
                style === es.id
                  ? "bg-violet-500/30 text-violet-200 ring-1 ring-violet-400"
                  : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
              }`}
            >
              {es.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => void runAutoEdit()}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {busy === "auto" || isTranscribing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {isTranscribing ? "Transcribing…" : "Editing…"}
            </>
          ) : (
            <>
              <Wand2 size={16} />
              Auto Edit
            </>
          )}
        </button>
        <p className="mt-1.5 text-center text-[10px] leading-snug text-zinc-600">
          Cuts dead air & fillers, adds punch-zooms, hook + CTA — one click, all local.
        </p>
        {editRecipe && (
          <div className="mt-2 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-snug text-emerald-300 ring-1 ring-emerald-400/20">
            {editRecipe.reasoningSummary}
            <span className="mt-0.5 block text-emerald-500/70">Not happy? Ctrl+Z undoes the whole edit.</span>
          </div>
        )}
      </section>

      {/* hooks */}
      <section>
        <SectionLabel>
          <Crosshair size={11} /> Opening hooks
        </SectionLabel>
        {hooks.length === 0 ? (
          <p className="rounded-lg bg-white/3 px-2.5 py-2 text-[11px] leading-snug text-zinc-600 ring-1 ring-white/5">
            Run Auto Captions first — hook detection reads the transcript.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {hooks.map((hook, i) => (
              <div key={i} className="group rounded-lg bg-white/4 p-2 ring-1 ring-white/8 transition hover:bg-white/7">
                <p className="text-[11px] font-medium leading-snug text-zinc-200">“{hook.text}”</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="rounded bg-fuchsia-500/15 px-1 font-mono text-[9px] text-fuchsia-300">
                    {hook.score.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">{hook.reasons.join(" · ")}</span>
                  <button
                    onClick={() => applyHookAsOpener(hook)}
                    disabled={disabled}
                    className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300 opacity-0 transition hover:bg-violet-500/40 group-hover:opacity-100 disabled:opacity-0"
                  >
                    Use as opening hook
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* smart cuts */}
      <section>
        <SectionLabel>
          <Scissors size={11} /> Smart cuts
        </SectionLabel>
        <div className="mb-1.5 grid grid-cols-3 gap-1">
          {(["light", "medium", "aggressive"] as const).map((level) => (
            <SmallAction
              key={level}
              onClick={() => void runRemoveSilence(level)}
              disabled={disabled}
              busy={busy === `silence-${level}`}
            >
              {level === "light" ? "Silence −" : level === "medium" ? "Silence −−" : "Silence −−−"}
            </SmallAction>
          ))}
        </div>
        <SmallAction onClick={() => void runRemoveFillers()} disabled={disabled} busy={busy === "fillers"} wide>
          <Zap size={12} /> Remove filler words (um, uh, typ, asså…)
        </SmallAction>
      </section>

      {/* best moments */}
      <section>
        <SectionLabel>
          <Sparkles size={11} /> Best moments
        </SectionLabel>
        <div className="grid grid-cols-3 gap-1">
          {[30, 45, 60].map((sec) => (
            <SmallAction
              key={sec}
              onClick={() => void runBestSeconds(sec)}
              disabled={disabled || duration <= sec}
              busy={busy === `best-${sec}`}
            >
              <Clapperboard size={12} /> {sec}s
            </SmallAction>
          ))}
        </div>
        <p className="mt-1 text-center text-[10px] text-zinc-600">
          Keeps the highest-scoring stretch, snapped to sentences.
        </p>
      </section>

      {/* b-roll suggestions */}
      {editRecipe && editRecipe.brollSuggestions.length > 0 && (
        <section>
          <SectionLabel>
            <Film size={11} /> B-roll suggestions
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {editRecipe.brollSuggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  useEditorStore.getState().setPlaying(false);
                  useEditorStore.getState().setCurrentTime(s.time);
                }}
                className="rounded-lg bg-white/4 p-2 text-left ring-1 ring-white/8 transition hover:bg-white/7"
                title="Jump to this moment, then add a b-roll clip from the media panel"
              >
                <span className="font-mono text-[9px] text-sky-300">{s.time.toFixed(1)}s</span>
                <span className="ml-1.5 text-[11px] font-medium text-zinc-200">“{s.keyword}”</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">{s.reason}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  );
}

function SmallAction({
  children,
  onClick,
  disabled,
  busy,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-medium text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-30 ${
        wide ? "w-full" : ""
      }`}
    >
      {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : children}
    </button>
  );
}
