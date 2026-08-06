"use client";

import { useEffect, useRef, useState } from "react";
import type { Caption } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { activeCaptionIndex } from "@/lib/captions/active";
import { useTranscription } from "@/hooks/useTranscription";
import {
  AlertTriangle,
  Captions as CaptionsIcon,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Eraser,
  Merge,
  Plus,
  Replace,
  Scissors,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";

/** Right panel, Captions tab: auto-caption trigger + line-by-line editor + tools. */
export default function CaptionsPanel() {
  const captions = useEditorStore((s) => s.captions);
  const tracks = useEditorStore((s) => s.tracks);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  // The id of the caption on screen, not the raw playhead — this list would
  // otherwise re-render on all sixty frames a second of playback.
  const activeCaptionId = useEditorStore((s) => {
    const index = activeCaptionIndex(s.captions, s.currentTime);
    return index === -1 ? null : s.captions[index].id;
  });
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  const isTranscribing = useEditorStore((s) => s.isTranscribing);

  const addCaptionAtPlayhead = useEditorStore((s) => s.addCaptionAtPlayhead);
  const cleanAllCaptions = useEditorStore((s) => s.cleanAllCaptions);
  const shiftAllCaptions = useEditorStore((s) => s.shiftAllCaptions);
  const searchReplaceCaptions = useEditorStore((s) => s.searchReplaceCaptions);
  const addToast = useEditorStore((s) => s.addToast);

  const {
    runTranscription,
    language,
    setLanguage,
    quality,
    setQuality,
    scope,
    setScope,
    progress,
  } = useTranscription();
  const duration = tracksDuration(tracks);
  const hasClips = duration > 0;
  const selectedIds = new Set(selectedClipIds);
  const selectedMainClipCount =
    tracks.find((track) => track.type === "video")?.clips.filter((clip) => selectedIds.has(clip.id))
      .length ?? 0;
  const canTranscribe = hasClips && (scope === "timeline" || selectedMainClipCount > 0);

  const [showReplace, setShowReplace] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [reviewLowConfidence, setReviewLowConfidence] = useState(false);
  /** Snapshot the queue so a row stays mounted while editing clears confidence. */
  const [reviewQueueIds, setReviewQueueIds] = useState<string[]>([]);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const lowConfidenceCount = captions.filter(captionNeedsReview).length;
  const reviewQueue = new Set(reviewQueueIds);
  const visibleCaptions = reviewLowConfidence
    ? captions.filter((caption) => reviewQueue.has(caption.id))
    : captions;
  const showSetup = captions.length === 0 || setupExpanded;

  const runReplace = () => {
    const count = searchReplaceCaptions(findText, replaceText);
    addToast(count > 0 ? "success" : "info", count > 0 ? `Replaced ${count} match${count === 1 ? "" : "es"}.` : "No matches found.");
  };

  return (
    <div className="flex h-full flex-col bg-[#101216]">
      <div className="max-h-[72%] shrink-0 overflow-y-auto border-b border-white/[0.07]">
        <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="panel-eyebrow text-[var(--caption)]">Captions</p>
            <p className="mt-0.5 truncate text-[10px] text-[#778391]">
              {captions.length > 0
                ? `${captions.length} ${captions.length === 1 ? "line" : "lines"} · edit text directly`
                : "Create captions on this device"}
            </p>
          </div>
          {captions.length > 0 && (
            <button
              type="button"
              aria-expanded={setupExpanded}
              onClick={() => setSetupExpanded((value) => !value)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 text-[9px] font-semibold text-[#9aa5b1] ring-1 ring-white/[0.08] transition hover:bg-white/[0.07] hover:text-[#e1e6eb]"
            >
              <Settings2 size={12} />
              Settings
              <ChevronDown
                size={12}
                className={`transition-transform ${setupExpanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        {showSetup && (
          <div className="border-t border-white/[0.06] px-3 pb-3 pt-2.5">
            <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-[var(--caption)]/[0.055] p-2.5 ring-1 ring-[var(--caption)]/10">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--caption)]" />
              <p className="text-[9px] leading-relaxed text-[#809087]">
                Audio stays on this device. The caption model is cached after the first download.
              </p>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 p-1.5 ring-1 ring-white/[0.07]">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as typeof language)}
                className="h-8 min-w-0 rounded-lg border-0 bg-white/[0.05] px-2 text-[10px] font-semibold text-zinc-200 outline-none ring-1 ring-white/[0.07] focus:ring-[var(--caption)]/40"
                title="Spoken language"
              >
                <option value="auto">Detect language</option>
                <option value="en">English</option>
                <option value="sv">Swedish</option>
              </select>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as typeof quality)}
                className="h-8 min-w-0 rounded-lg border-0 bg-white/[0.05] px-2 text-[10px] font-semibold text-zinc-200 outline-none ring-1 ring-white/[0.07] focus:ring-[var(--caption)]/40"
                title="Choose caption speed and accuracy"
              >
                <option value="fast">Fast · ~75 MB</option>
                <option value="accurate">Accurate · ~150 MB</option>
              </select>
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
              className="mb-2 h-9 w-full rounded-xl border-0 bg-white/[0.045] px-3 text-[10px] font-semibold text-zinc-200 outline-none ring-1 ring-white/[0.07] focus:ring-[var(--caption)]/40"
              title="Caption the whole timeline or only selected clips on the main video track"
            >
              <option value="timeline">Entire timeline</option>
              <option value="selected" disabled={selectedMainClipCount === 0}>
                Selected main clips ({selectedMainClipCount})
              </option>
            </select>
            <button
              onClick={() => void runTranscription()}
              disabled={isTranscribing || !canTranscribe}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#9ce5c3] px-4 text-[12px] font-extrabold text-[#0e1a15] transition hover:bg-[#b9f0d7] active:translate-y-px disabled:opacity-40"
            >
              {isTranscribing ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {progress?.stage === "model" ? "Loading caption model…" : "Creating captions…"}
                </>
              ) : (
                <>
                  <CaptionsIcon size={16} />
                  {scope === "selected" ? "Caption selected clips" : "Create captions"}
                </>
              )}
            </button>
            {scope === "selected" && selectedMainClipCount === 0 && (
              <p className="mt-2 text-center text-[11px] text-amber-400/80">
                Select one or more clips on the main video track.
              </p>
            )}
            {isTranscribing && (
              <div className="mt-2.5 rounded-lg bg-black/20 p-2.5 ring-1 ring-white/[0.07]">
                <div className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="truncate text-[#9aa6b2]">
                    {progress?.detail ?? "Working on this device"}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--caption)]">
                    {progress?.stage === "model" && progress.progress > 0
                      ? `${Math.round(progress.progress * 100)}%`
                      : progress?.device === "webgpu"
                        ? "GPU"
                        : "LOCAL"}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={`h-full rounded-full bg-[var(--caption)] transition-[width] ${
                      progress?.stage === "transcribing" ? "w-2/3 animate-pulse" : ""
                    }`}
                    style={
                      progress?.stage === "transcribing"
                        ? undefined
                        : { width: `${Math.max(4, (progress?.progress ?? 0) * 100)}%` }
                    }
                  />
                </div>
                {duration > 180 && (
                  <p className="mt-2 text-[9px] leading-relaxed text-[#687480]">
                    Long videos can take a few minutes. You can keep editing.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* caption tools */}
      {captions.length > 0 && (
        <div className="border-b border-white/8 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            <ToolIcon title="Clean captions: fix punctuation, strip ums/uhs, bold key words" onClick={cleanAllCaptions}>
              <Eraser size={13} />
            </ToolIcon>
            <ToolIcon title="Shift all captions 0.1s earlier" onClick={() => shiftAllCaptions(-0.1)}>
              <ChevronsLeft size={13} />
            </ToolIcon>
            <ToolIcon title="Shift all captions 0.1s later" onClick={() => shiftAllCaptions(0.1)}>
              <ChevronsRight size={13} />
            </ToolIcon>
            <ToolIcon title="Search & replace" onClick={() => setShowReplace((v) => !v)} active={showReplace}>
              <Replace size={13} />
            </ToolIcon>
            <ToolIcon
              title={
                lowConfidenceCount > 0
                  ? `Review ${lowConfidenceCount} low-confidence caption${lowConfidenceCount === 1 ? "" : "s"}`
                  : "No low-confidence captions"
              }
              onClick={() => {
                if (reviewLowConfidence) {
                  setReviewLowConfidence(false);
                  setReviewQueueIds([]);
                } else {
                  setReviewQueueIds(
                    captions.filter(captionNeedsReview).map((caption) => caption.id)
                  );
                  setReviewLowConfidence(true);
                }
              }}
              active={reviewLowConfidence}
            >
              <AlertTriangle size={13} />
            </ToolIcon>
            <span className="ml-auto text-[10px] text-zinc-600">
              {reviewLowConfidence ? `${visibleCaptions.length} of ` : ""}
              {captions.length} lines
            </span>
          </div>
          {showReplace && (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Find"
                className="w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--caption)]"
              />
              <input
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace"
                onKeyDown={(e) => e.key === "Enter" && runReplace()}
                className="w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--caption)]"
              />
              <button
                onClick={runReplace}
                className="rounded bg-[var(--caption)]/15 px-2 py-1 text-[11px] font-semibold text-[var(--caption)] transition hover:bg-[var(--caption)]/25"
              >
                Go
              </button>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {captions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs leading-relaxed text-zinc-600">
            No captions yet.
            <br />
            Choose <span className="font-semibold text-zinc-400">Create captions</span> to
            transcribe the timeline on this device.
          </div>
        ) : visibleCaptions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs leading-relaxed text-zinc-600">
            No low-confidence captions left to review.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {visibleCaptions.map((cap) => (
              <CaptionRow
                key={cap.id}
                caption={cap}
                isLast={captions[captions.length - 1]?.id === cap.id}
                active={cap.id === activeCaptionId}
                selected={cap.id === selectedCaptionId}
              />
            ))}
          </div>
        )}
        <button
          onClick={addCaptionAtPlayhead}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs font-medium text-zinc-400 transition hover:border-[var(--caption)]/50 hover:text-[var(--caption)]"
        >
          <Plus size={13} /> Add caption at playhead
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function ToolIcon({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 transition ${
        active ? "bg-[var(--caption)]/15 text-[var(--caption)]" : "text-zinc-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function CaptionRow({
  caption,
  active,
  selected,
  isLast,
}: {
  caption: Caption;
  active: boolean;
  selected: boolean;
  isLast: boolean;
}) {
  const updateCaptionText = useEditorStore((s) => s.updateCaptionText);
  const updateCaptionTiming = useEditorStore((s) => s.updateCaptionTiming);
  const deleteCaption = useEditorStore((s) => s.deleteCaption);
  const mergeCaptionWithNext = useEditorStore((s) => s.mergeCaptionWithNext);
  const splitCaption = useEditorStore((s) => s.splitCaption);
  const selectCaption = useEditorStore((s) => s.selectCaption);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const lowConfidenceWords =
    caption.words?.filter(
      (word) => word.confidence !== undefined && word.confidence < LOW_WORD_CONFIDENCE
    ) ?? [];
  const needsReview = captionNeedsReview(caption);

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <div
      ref={rowRef}
      className={`group rounded-lg p-2.5 ring-1 transition ${
        active
          ? "bg-[var(--caption)]/10 ring-[var(--caption)]/40"
          : selected
            ? "bg-white/8 ring-white/20"
            : "bg-white/3 ring-white/5 hover:bg-white/6"
      }`}
      onClick={() => {
        selectCaption(caption.id);
        setPlaying(false);
        setCurrentTime(caption.startTime + 0.001);
      }}
    >
      <input
        value={caption.text}
        onChange={(e) => updateCaptionText(caption.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="min-h-7 w-full bg-transparent text-[13px] font-medium leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600"
        placeholder="Caption text…"
      />
      <div className="mt-1 flex items-center gap-1">
        <TimeInput
          value={caption.startTime}
          onCommit={(v) => updateCaptionTiming(caption.id, v, caption.endTime)}
        />
        <span className="text-[9px] text-zinc-600">→</span>
        <TimeInput
          value={caption.endTime}
          onCommit={(v) => updateCaptionTiming(caption.id, caption.startTime, v)}
        />
        {caption.words && (
          <span
            className="ml-1 rounded bg-emerald-500/15 px-1 text-[8px] font-semibold uppercase tracking-wide text-emerald-400"
            title="Word-level timestamps available — word highlighting works"
          >
            words
          </span>
        )}
        {needsReview && (
          <span
            className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[8px] font-semibold uppercase tracking-wide text-amber-300"
            title={
              lowConfidenceWords.length > 0
                ? `${lowConfidenceWords.length} word${lowConfidenceWords.length === 1 ? "" : "s"} below ${Math.round(LOW_WORD_CONFIDENCE * 100)}% confidence`
                : "This caption has low average transcription confidence"
            }
          >
            <AlertTriangle size={8} />
            {caption.confidence === undefined
              ? "review"
              : `${Math.round(caption.confidence * 100)}%`}
          </span>
        )}
        <div className="caption-row-actions ml-auto flex items-center opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              splitCaption(caption.id);
            }}
            className="rounded p-1 text-zinc-600 transition hover:bg-white/10 hover:text-zinc-200"
            title="Split caption in half"
          >
            <Scissors size={12} />
          </button>
          {!isLast && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                mergeCaptionWithNext(caption.id);
              }}
              className="rounded p-1 text-zinc-600 transition hover:bg-white/10 hover:text-zinc-200"
              title="Merge with next caption"
            >
              <Merge size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteCaption(caption.id);
            }}
            className="rounded p-1 text-zinc-600 transition hover:bg-rose-500/20 hover:text-rose-400"
            title="Delete caption"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

const LOW_CAPTION_CONFIDENCE = 0.72;
const LOW_WORD_CONFIDENCE = 0.5;

function captionNeedsReview(caption: Caption): boolean {
  if (caption.confidence !== undefined && caption.confidence < LOW_CAPTION_CONFIDENCE) {
    return true;
  }
  return Boolean(
    caption.words?.some(
      (word) => word.confidence !== undefined && word.confidence < LOW_WORD_CONFIDENCE
    )
  );
}

/** Seconds input that commits on blur/Enter so typing isn't fighting the store. */
function TimeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Sync the draft when the store value changes underneath us (unless typing).
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) setDraft(value.toFixed(2));
  }

  const commit = () => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed)) onCommit(parsed);
    setFocused(false);
  };

  return (
    <input
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
      className="w-14 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-center font-mono text-[10px] text-zinc-400 outline-none focus:border-[var(--caption)]"
    />
  );
}
