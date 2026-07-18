"use client";

import { useEffect, useRef, useState } from "react";
import type { Caption } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { useTranscription } from "@/hooks/useTranscription";
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  Merge,
  Plus,
  Replace,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

/** Right panel, Captions tab: auto-caption trigger + line-by-line editor + tools. */
export default function CaptionsPanel() {
  const captions = useEditorStore((s) => s.captions);
  const tracks = useEditorStore((s) => s.tracks);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const currentTime = useEditorStore((s) => s.currentTime);
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
    prompt,
    setPrompt,
  } = useTranscription();
  const duration = tracksDuration(tracks);
  const hasClips = duration > 0;
  const selectedIds = new Set(selectedClipIds);
  const selectedMainClipCount =
    tracks.find((track) => track.type === "video")?.clips.filter((clip) => selectedIds.has(clip.id))
      .length ?? 0;
  const canTranscribe = hasClips && (scope === "timeline" || selectedMainClipCount > 0);

  const [showReplace, setShowReplace] = useState(false);
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

  const runReplace = () => {
    const count = searchReplaceCaptions(findText, replaceText);
    addToast(count > 0 ? "success" : "info", count > 0 ? `Replaced ${count} match${count === 1 ? "" : "es"}.` : "No matches found.");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/8 p-3">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400"
            title="Spoken language"
          >
            <option value="auto">Detect language</option>
            <option value="en">English</option>
            <option value="sv">Svenska</option>
          </select>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as typeof quality)}
            className="min-w-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400"
            title="Speech model quality. WHISPER_MODEL can override this local model mapping."
          >
            <option value="accurate">Accurate · small</option>
            <option value="fast">Fast · base</option>
          </select>
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-400"
          title="Caption the whole timeline or only selected clips on the main video track"
        >
          <option value="timeline">Entire timeline</option>
          <option value="selected" disabled={selectedMainClipCount === 0}>
            Selected main clips ({selectedMainClipCount})
          </option>
        </select>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          placeholder="Names & jargon, e.g. CaptionCut, Matij…"
          title="Optional glossary or context to help Whisper spell unusual words correctly"
          className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400"
        />
        <button
          onClick={() => void runTranscription()}
          disabled={isTranscribing || !canTranscribe}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {isTranscribing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Transcribing…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {scope === "selected" ? "Caption selected clips" : "Auto Captions"}
            </>
          )}
        </button>
        {scope === "selected" && selectedMainClipCount === 0 && (
          <p className="mt-2 text-center text-[11px] text-amber-400/80">
            Select one or more clips on the main video track.
          </p>
        )}
        {isTranscribing && (
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {duration > 180
              ? "Long video — local transcription can take a few minutes."
              : "Running locally on your machine — free & private."}
          </p>
        )}
      </div>

      {/* caption tools */}
      {captions.length > 0 && (
        <div className="border-b border-white/8 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            <ToolIcon title="Clean captions: fix punctuation, strip ums/uhs, bold key words" onClick={cleanAllCaptions}>
              <Wand2 size={13} />
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
                className="w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-400"
              />
              <input
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace"
                onKeyDown={(e) => e.key === "Enter" && runReplace()}
                className="w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-violet-400"
              />
              <button
                onClick={runReplace}
                className="rounded bg-violet-500/25 px-2 py-1 text-[11px] font-semibold text-violet-200 transition hover:bg-violet-500/40"
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
            Hit <span className="font-semibold text-zinc-400">Auto Captions</span> to transcribe
            your video into punchy TikTok-style lines.
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
                active={currentTime >= cap.startTime && currentTime < cap.endTime}
                selected={cap.id === selectedCaptionId}
              />
            ))}
          </div>
        )}
        <button
          onClick={addCaptionAtPlayhead}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs font-medium text-zinc-400 transition hover:border-violet-400/50 hover:text-violet-300"
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
        active ? "bg-violet-500/25 text-violet-200" : "text-zinc-400 hover:bg-white/10 hover:text-white"
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
      className={`group rounded-lg p-2 ring-1 transition ${
        active
          ? "bg-violet-500/15 ring-violet-400/50"
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
        className="w-full bg-transparent text-xs font-medium text-zinc-100 outline-none placeholder:text-zinc-600"
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
        <div className="ml-auto flex items-center opacity-0 transition group-hover:opacity-100">
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
      className="w-14 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-center font-mono text-[10px] text-zinc-400 outline-none focus:border-violet-400"
    />
  );
}
