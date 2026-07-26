"use client";

import { useMemo, useState } from "react";
import type { Caption, TimeRange } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useTranscription } from "@/hooks/useTranscription";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import {
  detectSilence,
  type SilenceAggressiveness,
} from "@/lib/autoEdit/detectSilence";
import { fillerCutRanges } from "@/lib/autoEdit/detectFillerWords";
import {
  invertRanges,
  mainClips,
  mainVideoTrack,
  tracksDuration,
} from "@/lib/timeline/tracks";
import { formatTime } from "@/lib/video/timeline";
import {
  Check,
  ChevronRight,
  Eraser,
  FileText,
  LoaderCircle,
  Pause,
  Play,
  Scissors,
  Trash2,
  ScanSearch,
} from "lucide-react";

type View = "pauses" | "transcript";

const LEVELS: Array<{
  id: SilenceAggressiveness;
  label: string;
  note: string;
}> = [
  { id: "light", label: "Light", note: "long pauses only" },
  { id: "medium", label: "Balanced", note: "recommended" },
  { id: "aggressive", label: "Tight", note: "faster pacing" },
];

/**
 * The primary editing surface. Silence removal is deliberately a two-step
 * review flow: scan first, then choose exactly which gaps should be cut.
 */
export default function CutPanel() {
  const tracks = useEditorStore((state) => state.tracks);
  const captions = useEditorStore((state) => state.captions);
  const revision = useEditorStore((state) => state.revision);
  const currentTime = useEditorStore((state) => state.currentTime);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const isTranscribing = useEditorStore((state) => state.isTranscribing);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const splitAtPlayhead = useEditorStore((state) => state.splitAtPlayhead);
  const deleteSelectedClips = useEditorStore((state) => state.deleteSelectedClips);
  const applyRearrange = useEditorStore((state) => state.applyRearrange);
  const addToast = useEditorStore((state) => state.addToast);

  const { runTranscription, coverageStatus } = useTranscription();
  const [view, setView] = useState<View>("pauses");
  const [level, setLevel] = useState<SilenceAggressiveness>("medium");
  const [busy, setBusy] = useState<"scan" | "fillers" | null>(null);
  const [pauses, setPauses] = useState<TimeRange[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [scanRevision, setScanRevision] = useState<number | null>(null);

  const duration = tracksDuration(tracks);
  const mainTrack = mainVideoTrack(tracks);
  const hasSelection = selectedClipIds.length > 0 || Boolean(selectedClipId);
  const visiblePauses = scanRevision === revision ? pauses : [];
  const chosenRanges = visiblePauses.filter((_, index) => chosen.has(index));
  const removedDuration = chosenRanges.reduce(
    (sum, range) => sum + range.end - range.start,
    0
  );

  const transcriptStats = useMemo(() => {
    const transcript = analyzeTranscript(captions);
    return {
      words: transcript.words.length,
      speechSeconds: transcript.sentences.reduce(
        (sum, sentence) => sum + sentence.endTime - sentence.startTime,
        0
      ),
    };
  }, [captions]);

  const timelinePeaks = (): number[] | null => {
    const state = useEditorStore.getState();
    const clips = mainClips(state.tracks);
    const out: number[] = [];
    for (const clip of clips) {
      const asset = state.media.find((item) => item.id === clip.mediaId);
      const peaks = state.waveforms[clip.mediaId];
      if (!asset || !peaks || asset.duration <= 0) return null;
      const from = Math.floor((clip.sourceStart / asset.duration) * peaks.length);
      const to = Math.max(
        from + 1,
        Math.ceil((clip.sourceEnd / asset.duration) * peaks.length)
      );
      out.push(...peaks.slice(from, to));
    }
    return out.length > 0 ? out : null;
  };

  const getCurrentTranscript = async (): Promise<Caption[]> => {
    const state = useEditorStore.getState();
    if (state.captions.length > 0 && coverageStatus() !== "incomplete") {
      return state.captions;
    }
    return (await runTranscription({ scope: "timeline" })) ?? [];
  };

  const scanPauses = async () => {
    if (duration <= 0) return;
    setBusy("scan");
    try {
      const currentCaptions = await getCurrentTranscript();
      if (currentCaptions.length === 0) return;
      const state = useEditorStore.getState();
      const ranges = detectSilence(
        {
          transcript: analyzeTranscript(currentCaptions),
          peaks: timelinePeaks(),
          duration: tracksDuration(state.tracks),
        },
        level
      );
      setPauses(ranges);
      setChosen(new Set(ranges.map((_, index) => index)));
      setScanRevision(state.revision);
      if (ranges.length === 0) {
        state.addToast("info", "No pauses found at this level.");
      }
    } catch (error) {
      useEditorStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Couldn’t find pauses.");
    } finally {
      setBusy(null);
    }
  };

  const applyPauseCuts = () => {
    if (chosenRanges.length === 0) {
      addToast("info", "Select at least one pause.");
      return;
    }
    applyRearrange(
      invertRanges(chosenRanges, duration),
      `${chosenRanges.length} ${chosenRanges.length === 1 ? "pause" : "pauses"} removed · ${removedDuration.toFixed(1)}s shorter`
    );
  };

  const removeFillers = async () => {
    setBusy("fillers");
    try {
      const currentCaptions = await getCurrentTranscript();
      if (currentCaptions.length === 0) return;
      const state = useEditorStore.getState();
      const ranges = fillerCutRanges(analyzeTranscript(currentCaptions));
      if (ranges.length === 0) {
        state.addToast("info", "No clear filler words found.");
        return;
      }
      state.applyRearrange(
        invertRanges(ranges, tracksDuration(state.tracks)),
        `${ranges.length} filler ${ranges.length === 1 ? "word" : "words"} removed`
      );
    } finally {
      setBusy(null);
    }
  };

  const jumpTo = (time: number) => {
    setPlaying(false);
    setCurrentTime(Math.max(0, time));
  };

  const removeCaptionSection = (caption: Caption) => {
    const currentDuration = tracksDuration(useEditorStore.getState().tracks);
    applyRearrange(
      invertRanges(
        [{ start: Math.max(0, caption.startTime - 0.04), end: caption.endTime + 0.04 }],
        currentDuration
      ),
      "Section removed from the video"
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101216]">
      <div className="border-b border-white/[0.07] px-4 pb-3 pt-4">
        <p className="panel-eyebrow text-[var(--cut)]">
          Cut
        </p>
        <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.025em] text-[#f4f6f8]">
          Keep what matters.
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[#838b95]">
          Review pauses or cut directly from the transcript.
        </p>

        <div className="mt-4 grid grid-cols-2 rounded-lg bg-[#080a0d] p-1 ring-1 ring-white/[0.07]">
          <ViewButton active={view === "pauses"} onClick={() => setView("pauses")}>
            Pauses
          </ViewButton>
          <ViewButton active={view === "transcript"} onClick={() => setView("transcript")}>
            Transcript
          </ViewButton>
        </div>
      </div>

      {view === "pauses" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-lg bg-[#15181d] p-3.5 ring-1 ring-white/[0.08]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cut)]/12 text-[var(--cut)]">
                <Pause size={15} fill="currentColor" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#eef1f0]">Find pauses</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#7e8998]">
                  Nothing changes until you apply the selection.
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1">
              {LEVELS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setLevel(item.id);
                    setPauses([]);
                    setChosen(new Set());
                  }}
                  className={`rounded-lg px-2 py-2 text-left transition ${
                    level === item.id
                      ? "bg-[var(--cut)] text-[#17110a]"
                      : "bg-white/[0.045] text-[#b7c0cb] hover:bg-white/[0.075]"
                  }`}
                >
                  <span className="block text-[11px] font-bold">{item.label}</span>
                  <span
                    className={`mt-0.5 block text-[9px] leading-tight ${
                      level === item.id ? "text-[#5b4021]" : "text-[#6f7a89]"
                    }`}
                  >
                    {item.note}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => void scanPauses()}
              disabled={duration <= 0 || busy !== null || isTranscribing}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#edf1f5] text-xs font-bold text-[#10141b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy === "scan" || isTranscribing ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <ScanSearch size={14} />
              )}
              {isTranscribing ? "Reading the audio…" : "Find pauses"}
            </button>
          </div>

          {visiblePauses.length > 0 && (
            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#d9dfe6]">
                  {visiblePauses.length} {visiblePauses.length === 1 ? "pause" : "pauses"}
                </p>
                <button
                  onClick={() =>
                    setChosen(
                      chosen.size === visiblePauses.length
                        ? new Set()
                        : new Set(visiblePauses.map((_, index) => index))
                    )
                  }
                  className="text-[10px] font-medium text-[var(--cut)] hover:text-[#ffd099]"
                >
                  {chosen.size === visiblePauses.length ? "Clear" : "Select all"}
                </button>
              </div>

              <div className="space-y-1.5">
                {visiblePauses.map((range, index) => {
                  const active =
                    currentTime >= range.start && currentTime < range.end;
                  const checked = chosen.has(index);
                  return (
                    <div
                      key={`${range.start}-${range.end}`}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-2 ring-1 transition ${
                        active
                          ? "bg-[#26303b] ring-[#7db8ff]/35"
                          : "bg-white/[0.035] ring-white/[0.06]"
                      }`}
                    >
                      <button
                        onClick={() =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        aria-label={checked ? "Keep pause" : "Remove pause"}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition ${
                          checked
                            ? "bg-[var(--cut)] text-[#181108] ring-[var(--cut)]"
                            : "bg-transparent text-transparent ring-white/20"
                        }`}
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                      <button
                        onClick={() => jumpTo(Math.max(0, range.start - 0.35))}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Play size={11} className="shrink-0 text-[#7db8ff]" fill="currentColor" />
                        <span className="font-mono text-[10px] text-[#9ca7b5]">
                          {formatTime(range.start)}
                        </span>
                        <span className="truncate text-[11px] text-[#6f7a89]">
                          silent for {(range.end - range.start).toFixed(1)}s
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={applyPauseCuts}
                disabled={chosenRanges.length === 0}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--cut)] text-xs font-extrabold text-[#191209] transition hover:bg-[#ffc477] disabled:opacity-35"
              >
                <Scissors size={14} />
                Remove {chosenRanges.length} {chosenRanges.length === 1 ? "pause" : "pauses"}
                <span className="font-mono font-medium opacity-60">
                  −{removedDuration.toFixed(1)}s
                </span>
              </button>
            </section>
          )}

          <div className="my-4 h-px bg-white/[0.07]" />

          <button
            onClick={() => void removeFillers()}
            disabled={duration <= 0 || busy !== null}
            className="group flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition hover:bg-white/[0.04] disabled:opacity-35"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#9ce5c3]/10 text-[#9ce5c3]">
              {busy === "fillers" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Eraser size={14} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#dbe1e8]">Remove filler words</p>
              <p className="mt-0.5 truncate text-[10px] text-[#707b89]">
                Um, uh, like, and repeated phrases
              </p>
            </div>
            <ChevronRight size={14} className="text-[#4e5864] transition group-hover:translate-x-0.5" />
          </button>

          <div className="mt-3 rounded-lg border border-dashed border-white/[0.09] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#66717f]">
              Manual
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={splitAtPlayhead}
                disabled={duration <= 0}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.055] py-2 text-[11px] font-semibold text-[#c9d1da] transition hover:bg-white/[0.09] disabled:opacity-30"
              >
                <Scissors size={12} /> Split <kbd>S</kbd>
              </button>
              <button
                onClick={deleteSelectedClips}
                disabled={!hasSelection}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.055] py-2 text-[11px] font-semibold text-[#c9d1da] transition hover:bg-[#ff6b6b]/10 hover:text-[#ff9a9a] disabled:opacity-30"
              >
                <Trash2 size={12} /> Delete <kbd>⌫</kbd>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <TranscriptView
          captions={captions}
          duration={duration}
          wordCount={transcriptStats.words}
          speechSeconds={transcriptStats.speechSeconds}
          isTranscribing={isTranscribing}
          onTranscribe={() => void runTranscription({ scope: "timeline" })}
          onJump={jumpTo}
          onRemove={removeCaptionSection}
          currentTime={currentTime}
        />
      )}

      <div className="border-t border-white/[0.07] px-4 py-2.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-[#65707e]">
          <span>{mainTrack.clips.length} {mainTrack.clips.length === 1 ? "clip" : "clips"}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function TranscriptView({
  captions,
  duration,
  wordCount,
  speechSeconds,
  isTranscribing,
  onTranscribe,
  onJump,
  onRemove,
  currentTime,
}: {
  captions: Caption[];
  duration: number;
  wordCount: number;
  speechSeconds: number;
  isTranscribing: boolean;
  onTranscribe: () => void;
  onJump: (time: number) => void;
  onRemove: (caption: Caption) => void;
  currentTime: number;
}) {
  if (captions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#7db8ff]/10 text-[#7db8ff]">
          <Scissors size={18} />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-[#e8edf2]">Edit like a document</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#74808e]">
          Create a transcript, preview any line, and remove it from the video.
        </p>
        <button
          onClick={onTranscribe}
          disabled={duration <= 0 || isTranscribing}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-[#edf1f5] px-4 text-xs font-bold text-[#10141b] transition hover:bg-white disabled:opacity-35"
        >
          {isTranscribing ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <FileText size={14} />
          )}
          {isTranscribing ? "Creating transcript…" : "Create transcript"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#687380]">
        <span>{wordCount} words</span>
        <span>{Math.round(speechSeconds)}s speech</span>
        <span className="ml-auto">Click to preview</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {captions.map((caption) => {
          const active = currentTime >= caption.startTime && currentTime < caption.endTime;
          return (
            <div
              key={caption.id}
              className={`group mb-1 flex items-start gap-2 rounded-md px-2 py-2 ring-1 transition ${
                active
                  ? "bg-[#7db8ff]/10 ring-[#7db8ff]/25"
                  : "bg-transparent ring-transparent hover:bg-white/[0.035]"
              }`}
            >
              <button
                onClick={() => onJump(caption.startTime + 0.001)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="mb-1 block font-mono text-[9px] text-[#65707e]">
                  {formatTime(caption.startTime)}
                </span>
                <span className="block text-[12px] leading-relaxed text-[#cdd5de]">
                  {caption.text}
                </span>
              </button>
              <button
                onClick={() => onRemove(caption)}
                title="Remove this section from the video"
                className="mt-1 rounded-lg p-1.5 text-[#596471] opacity-0 transition hover:bg-[#ff6b6b]/10 hover:text-[#ff9696] group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg py-2 text-[11px] font-bold transition ${
        active
          ? "bg-[#202630] text-[#f0f3f6] shadow-sm"
          : "text-[#6f7a88] hover:text-[#b4bec9]"
      }`}
    >
      {children}
    </button>
  );
}
