"use client";

import { useState } from "react";
import type { MediaAsset, TimelineClip } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useTranscription } from "@/hooks/useTranscription";
import {
  findFastInterviewAnswers,
  type FastInterviewAnswer,
  type FastInterviewResult,
} from "@/lib/autoEdit/fastInterview";
import { assetKind, mainVideoTrack } from "@/lib/timeline/tracks";
import { filmstripUrl } from "@/lib/video/client";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CirclePlay,
  Clapperboard,
  CopyCheck,
  Crosshair,
  Film,
  LoaderCircle,
  Mic2,
  Plus,
  Radio,
  RefreshCw,
  Scissors,
} from "lucide-react";

type BuilderMode = "sequence" | "interview";

interface InterviewDraft {
  result: FastInterviewResult;
  revision: number;
}

/** A guided edit surface for deliberate hook-first sequences and rapid vox-pops. */
export default function SequenceBuilderPanel() {
  const tracks = useEditorStore((state) => state.tracks);
  const media = useEditorStore((state) => state.media);
  const revision = useEditorStore((state) => state.revision);
  const isTranscribing = useEditorStore((state) => state.isTranscribing);
  const [mode, setMode] = useState<BuilderMode>("sequence");
  const [question, setQuestion] = useState("Who will win the World Cup?");
  const [acceptedAnswers, setAcceptedAnswers] = useState("Spain, Argentina");
  const [dedupeAnswers, setDedupeAnswers] = useState(true);
  const [showQuestion, setShowQuestion] = useState(true);
  const [finding, setFinding] = useState(false);
  const [draft, setDraft] = useState<InterviewDraft | null>(null);
  const [answerOrder, setAnswerOrder] = useState<string[]>([]);
  const { runTranscription, coverageStatus } = useTranscription();

  const mainTrack = mainVideoTrack(tracks);
  const videoAssets = media.filter((asset) => assetKind(asset) === "video");
  const activeAnswers = draft
    ? answerOrder
        .map((id) => draft.result.answers.find((answer) => answer.id === id))
        .filter((answer): answer is FastInterviewAnswer => Boolean(answer))
    : [];
  const draftIsStale = Boolean(draft && draft.revision !== revision);

  const invalidateDraft = () => {
    setDraft(null);
    setAnswerOrder([]);
  };

  const useAssetAsHook = (asset: MediaAsset) => {
    const store = useEditorStore.getState();
    const existing = mainVideoTrack(store.tracks).clips.find((clip) => clip.assetId === asset.id);
    if (existing) {
      if (existing === mainVideoTrack(store.tracks).clips[0]) {
        store.addToast("info", `“${shortName(asset.originalName)}” is already the hook.`);
        return;
      }
      store.moveClipToIndex(existing.id, 0);
    } else {
      store.addClipFromMedia(asset.id);
      const addedId = useEditorStore.getState().selectedClipId;
      if (addedId) useEditorStore.getState().moveClipToIndex(addedId, 0);
      useEditorStore.getState().selectClip(null);
    }
    useEditorStore.getState().addToast("success", `Hook set to “${shortName(asset.originalName)}”.`);
  };

  const addNext = (asset: MediaAsset) => {
    const store = useEditorStore.getState();
    store.addClipFromMedia(asset.id);
    useEditorStore.getState().selectClip(null);
    useEditorStore.getState().addToast("success", `Added “${shortName(asset.originalName)}” to the end.`);
  };

  const findAnswers = async () => {
    const store = useEditorStore.getState();
    if (mainVideoTrack(store.tracks).clips.length === 0) {
      store.addToast("info", "Add interview clips to the main track first.");
      return;
    }
    if (!question.trim()) {
      store.addToast("info", "Type the repeated interview question first.");
      return;
    }

    setFinding(true);
    try {
      const coverage = coverageStatus();
      let transcript = store.captions;
      if (transcript.length === 0 || coverage === "incomplete") {
        transcript = (await runTranscription({ scope: "timeline" })) ?? [];
      }
      if (transcript.length === 0) {
        useEditorStore.getState().addToast("info", "No speech was found. Check the clips or run captions first.");
        return;
      }

      const current = useEditorStore.getState();
      const result = findFastInterviewAnswers({
        captions: transcript,
        question,
        acceptedAnswers: parseAnswers(acceptedAnswers),
        clips: mainVideoTrack(current.tracks).clips,
        dedupeAnswers,
      });
      setDraft({ result, revision: current.revision });
      setAnswerOrder(result.answers.map((answer) => answer.id));
      if (result.answers.length === 0) {
        current.addToast(
          "info",
          result.questionOccurrences > 0
            ? "The question was found, but none of the responses matched your answer choices."
            : "The question was not found. Check its wording or add answer choices as anchors."
        );
      }
    } catch (error) {
      useEditorStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Could not find interview answers.");
    } finally {
      setFinding(false);
    }
  };

  const toggleAnswer = (answerId: string) => {
    setAnswerOrder((current) =>
      current.includes(answerId) ? current.filter((id) => id !== answerId) : [...current, answerId]
    );
  };

  const moveAnswer = (answerId: string, direction: -1 | 1) => {
    setAnswerOrder((current) => {
      const index = current.indexOf(answerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const applyInterview = () => {
    if (!draft || activeAnswers.length === 0) {
      useEditorStore.getState().addToast("info", "Keep at least one answer before building the edit.");
      return;
    }
    const store = useEditorStore.getState();
    if (store.revision !== draft.revision) {
      store.addToast("info", "The timeline changed. Find the answers again before applying them.");
      return;
    }
    store.applyFastInterview(
      activeAnswers.map((answer) => ({ start: answer.start, end: answer.end })),
      question,
      showQuestion
    );
    setDraft(null);
    setAnswerOrder([]);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0c0c13]">
      <div className="border-b border-white/8 bg-[linear-gradient(135deg,rgba(251,146,60,0.10),transparent_58%)] p-3">
        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.22em] text-orange-300/80">
          <Radio size={11} /> Broadcast rundown
        </div>
        <h2 className="mt-1 text-[19px] font-black tracking-[-0.04em] text-zinc-50">Build the cut in story order.</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
          Lock the first beat, or turn one repeated question into clean rapid answers.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-white/8">
          <ModeButton
            active={mode === "sequence"}
            icon={<Crosshair size={13} />}
            label="Hook + clips"
            onClick={() => setMode("sequence")}
          />
          <ModeButton
            active={mode === "interview"}
            icon={<Mic2 size={13} />}
            label="Fast interview"
            onClick={() => setMode("interview")}
          />
        </div>
      </div>

      {mode === "sequence" ? (
        <SequenceMode
          clips={mainTrack.clips}
          media={media}
          videoAssets={videoAssets}
          onUseAsHook={useAssetAsHook}
          onAddNext={addNext}
        />
      ) : (
        <div className="flex flex-col gap-4 p-3">
          <section>
            <StepLabel step="01" label="Name the repeated question" />
            <label className="block">
              <span className="sr-only">Interview question</span>
              <textarea
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  invalidateDraft();
                }}
                rows={2}
                placeholder="What question did everyone answer?"
                className="w-full resize-none rounded-xl border-0 bg-white/5 px-3 py-2.5 text-[12px] font-semibold leading-snug text-zinc-100 outline-none ring-1 ring-white/10 placeholder:text-zinc-600 focus:ring-orange-400/70"
              />
            </label>
          </section>

          <section>
            <StepLabel step="02" label="Choose the answers to keep" optional />
            <input
              value={acceptedAnswers}
              onChange={(event) => {
                setAcceptedAnswers(event.target.value);
                invalidateDraft();
              }}
              placeholder="Spain, Argentina"
              className="w-full rounded-xl border-0 bg-white/5 px-3 py-2.5 text-[11px] text-zinc-100 outline-none ring-1 ring-white/10 placeholder:text-zinc-600 focus:ring-orange-400/70"
            />
            <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">
              Separate choices with commas. Leave empty to keep every different answer.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <ToggleCard
                checked={dedupeAnswers}
                label="One of each answer"
                description="Skip repeats"
                onChange={(value) => {
                  setDedupeAnswers(value);
                  invalidateDraft();
                }}
              />
              <ToggleCard
                checked={showQuestion}
                label="Question on screen"
                description="No spoken repeats"
                onChange={setShowQuestion}
              />
            </div>
          </section>

          <button
            type="button"
            onClick={() => void findAnswers()}
            disabled={finding || isTranscribing || mainTrack.clips.length === 0}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 py-2.5 text-[11px] font-black text-[#1b0b03] shadow-[0_8px_24px_rgba(249,115,22,0.18)] transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {finding || isTranscribing ? (
              <><LoaderCircle size={14} className="animate-spin" /> Listening for answers…</>
            ) : (
              <><RefreshCw size={14} /> Find clean answers</>
            )}
          </button>

          {draft && (
            <InterviewReview
              draft={draft}
              answerOrder={answerOrder}
              stale={draftIsStale}
              onToggle={toggleAnswer}
              onMove={moveAnswer}
              onPreview={(answer) => {
                const store = useEditorStore.getState();
                store.setPlaying(false);
                store.setCurrentTime(Math.max(0, answer.start - 0.15));
              }}
              onRefresh={() => void findAnswers()}
              onApply={applyInterview}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SequenceMode({
  clips,
  media,
  videoAssets,
  onUseAsHook,
  onAddNext,
}: {
  clips: TimelineClip[];
  media: MediaAsset[];
  videoAssets: MediaAsset[];
  onUseAsHook: (asset: MediaAsset) => void;
  onAddNext: (asset: MediaAsset) => void;
}) {
  const moveClipToIndex = useEditorStore((state) => state.moveClipToIndex);
  const opener = clips[0];
  return (
    <div className="flex flex-col gap-4 p-3">
      <section>
        <StepLabel step="01" label="Lock the opener" />
        {opener ? (
          <div className="overflow-hidden rounded-xl bg-orange-500/10 ring-1 ring-orange-400/35">
            <div className="flex items-center gap-2 border-b border-orange-300/15 bg-orange-500/10 px-2.5 py-1.5">
              <span className="rounded bg-orange-400 px-1.5 py-0.5 font-mono text-[8px] font-black text-orange-950">HOOK / 00</span>
              <span className="text-[9px] font-semibold text-orange-200">This clip always plays first</span>
            </div>
            <SequenceClipRow clip={opener} asset={media.find((asset) => asset.id === opener.assetId)} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-orange-400/35 bg-orange-500/5 px-3 py-5 text-center">
            <Crosshair size={18} className="mx-auto text-orange-300" />
            <p className="mt-2 text-[11px] font-bold text-zinc-300">Your hook lands here</p>
            <p className="mt-1 text-[9px] text-zinc-600">Choose Hook on one of the source clips below.</p>
          </div>
        )}
      </section>

      <section>
        <StepLabel step="02" label="Stack the rest" />
        {clips.length <= 1 ? (
          <p className="rounded-xl bg-white/3 px-3 py-3 text-[10px] leading-relaxed text-zinc-600 ring-1 ring-white/6">
            Add clips with <span className="font-semibold text-zinc-400">+ Next</span>. They stay in this order on the main timeline.
          </p>
        ) : (
          <div className="relative ml-2 border-l border-dashed border-white/12 pl-3">
            <div className="flex flex-col gap-1.5">
              {clips.slice(1).map((clip, offset) => {
                const index = offset + 1;
                return (
                  <div key={clip.id} className="relative rounded-xl bg-white/4 p-2 ring-1 ring-white/8">
                    <span className="absolute -left-[21px] top-4 flex h-4 w-4 items-center justify-center rounded-full bg-[#171720] font-mono text-[7px] font-bold text-zinc-500 ring-1 ring-white/15">
                      {String(index).padStart(2, "0")}
                    </span>
                    <SequenceClipRow clip={clip} asset={media.find((asset) => asset.id === clip.assetId)} compact />
                    <div className="mt-1.5 flex items-center justify-end gap-1 border-t border-white/6 pt-1.5">
                      <TinyButton label="Make hook" icon={<Crosshair size={9} />} onClick={() => moveClipToIndex(clip.id, 0)} />
                      <IconButton label="Move earlier" disabled={index === 1} onClick={() => moveClipToIndex(clip.id, index - 1)}>
                        <ArrowUp size={10} />
                      </IconButton>
                      <IconButton label="Move later" disabled={index === clips.length - 1} onClick={() => moveClipToIndex(clip.id, index + 1)}>
                        <ArrowDown size={10} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section>
        <StepLabel step="03" label="Choose source clips" />
        {videoAssets.length === 0 ? (
          <p className="rounded-xl bg-white/3 px-3 py-3 text-[10px] text-zinc-600 ring-1 ring-white/6">
            Upload video in the Media panel, then come back to build the sequence.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {videoAssets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-2 rounded-xl bg-white/4 p-2 ring-1 ring-white/8">
                <VideoThumb asset={asset} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold text-zinc-300">{shortName(asset.originalName)}</p>
                  <p className="mt-0.5 font-mono text-[8px] text-zinc-600">{formatTime(asset.duration)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onUseAsHook(asset)}
                  className="rounded-lg bg-orange-500/15 px-2 py-1.5 text-[9px] font-bold text-orange-300 ring-1 ring-orange-400/25 transition hover:bg-orange-500/25"
                >
                  Hook
                </button>
                <button
                  type="button"
                  onClick={() => onAddNext(asset)}
                  className="flex items-center gap-1 rounded-lg bg-white/6 px-2 py-1.5 text-[9px] font-bold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <Plus size={9} /> Next
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InterviewReview({
  draft,
  answerOrder,
  stale,
  onToggle,
  onMove,
  onPreview,
  onRefresh,
  onApply,
}: {
  draft: InterviewDraft;
  answerOrder: string[];
  stale: boolean;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onPreview: (answer: FastInterviewAnswer) => void;
  onRefresh: () => void;
  onApply: () => void;
}) {
  const { result } = draft;
  return (
    <section className="overflow-hidden rounded-2xl bg-[#111119] ring-1 ring-white/10">
      <div className="border-b border-white/8 bg-white/3 p-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300 ring-1 ring-teal-400/20">
            <CopyCheck size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-200">Answer-only draft</p>
            <p className="mt-0.5 text-[8px] text-zinc-600">
              {result.questionOccurrences} question{result.questionOccurrences === 1 ? "" : "s"} removed
              {result.ignoredDuplicates > 0 ? ` · ${result.ignoredDuplicates} duplicate${result.ignoredDuplicates === 1 ? "" : "s"} skipped` : ""}
            </p>
          </div>
          <span className="rounded-full bg-teal-500/10 px-2 py-1 font-mono text-[9px] font-bold text-teal-300 ring-1 ring-teal-400/15">
            {answerOrder.length}/{result.answers.length}
          </span>
        </div>
      </div>

      {result.answers.length === 0 ? (
        <div className="p-3 text-center">
          <Scissors size={17} className="mx-auto text-zinc-700" />
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">No matching answer clips yet. Adjust the wording or answer choices and try again.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-px bg-white/5">
          {result.answers.map((answer) => {
            const kept = answerOrder.includes(answer.id);
            const orderIndex = answerOrder.indexOf(answer.id);
            return (
              <div key={answer.id} className={`bg-[#111119] p-2.5 transition ${kept ? "opacity-100" : "opacity-45"}`}>
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onToggle(answer.id)}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded transition ${kept ? "bg-teal-400 text-teal-950" : "bg-white/5 text-transparent ring-1 ring-white/15"}`}
                    aria-label={kept ? "Remove answer from draft" : "Keep answer in draft"}
                  >
                    <Check size={10} strokeWidth={3} />
                  </button>
                  <button type="button" onClick={() => onPreview(answer)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      {answer.matchedAnswer && (
                        <span className="rounded bg-orange-500/12 px-1.5 py-0.5 text-[8px] font-bold text-orange-300 ring-1 ring-orange-400/15">
                          {answer.matchedAnswer}
                        </span>
                      )}
                      <span className="font-mono text-[8px] text-zinc-600">{formatTime(answer.start)}–{formatTime(answer.end)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] font-medium leading-snug text-zinc-300">“{answer.text}”</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label="Move answer earlier" disabled={!kept || orderIndex <= 0} onClick={() => onMove(answer.id, -1)}><ArrowUp size={9} /></IconButton>
                    <IconButton label="Move answer later" disabled={!kept || orderIndex < 0 || orderIndex >= answerOrder.length - 1} onClick={() => onMove(answer.id, 1)}><ArrowDown size={9} /></IconButton>
                    <IconButton label="Preview answer" onClick={() => onPreview(answer)}><CirclePlay size={9} /></IconButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="p-2.5">
        {stale ? (
          <button type="button" onClick={onRefresh} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500/15 px-3 py-2 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/20">
            <RefreshCw size={11} /> Timeline changed — find again
          </button>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={answerOrder.length === 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-400 px-3 py-2 text-[10px] font-black text-teal-950 transition hover:bg-teal-300 disabled:opacity-35"
          >
            <Clapperboard size={12} /> Build fast interview <ArrowRight size={11} />
          </button>
        )}
      </div>
    </section>
  );
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold transition ${active ? "bg-zinc-100 text-zinc-950 shadow-sm" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"}`}
    >
      {icon} {label}
    </button>
  );
}

function StepLabel({ step, label, optional = false }: { step: string; label: string; optional?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="font-mono text-[8px] font-black text-orange-400">{step}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">{label}</span>
      {optional && <span className="ml-auto text-[8px] text-zinc-700">optional</span>}
    </div>
  );
}

function ToggleCard({ checked, label, description, onChange }: { checked: boolean; label: string; description: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`rounded-xl p-2 text-left ring-1 transition ${checked ? "bg-teal-500/8 ring-teal-400/20" : "bg-white/3 ring-white/8"}`}
    >
      <span className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-300">
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded ${checked ? "bg-teal-400 text-teal-950" : "bg-white/5 text-transparent ring-1 ring-white/15"}`}><Check size={9} strokeWidth={3} /></span>
        {label}
      </span>
      <span className="mt-1 block pl-5 text-[8px] text-zinc-600">{description}</span>
    </button>
  );
}

function SequenceClipRow({ clip, asset, compact = false }: { clip: TimelineClip; asset?: MediaAsset; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        const store = useEditorStore.getState();
        store.setPlaying(false);
        store.setCurrentTime(clip.startTime);
      }}
      className={`flex w-full items-center gap-2 text-left ${compact ? "" : "p-2.5"}`}
      title="Preview this clip"
    >
      {asset ? <VideoThumb asset={asset} small={compact} /> : <div className="flex h-8 w-10 items-center justify-center rounded-md bg-white/5 text-zinc-700"><Film size={12} /></div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold text-zinc-200">{asset ? shortName(asset.originalName) : "Missing source"}</p>
        <p className="mt-0.5 font-mono text-[8px] text-zinc-600">{formatTime(clip.endTime - clip.startTime)} · tap to preview</p>
      </div>
      <ChevronRight size={12} className="text-zinc-700" />
    </button>
  );
}

function VideoThumb({ asset, small = false }: { asset: MediaAsset; small?: boolean }) {
  return (
    <div
      className={`shrink-0 rounded-md bg-black/70 bg-no-repeat ring-1 ring-white/10 ${small ? "h-8 w-11" : "h-9 w-12"}`}
      style={{
        backgroundImage: `url(${filmstripUrl(asset)})`,
        backgroundSize: "2000% 100%",
        backgroundPosition: `${(100 * 10) / 19}% 0%`,
      }}
    />
  );
}

function TinyButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded-md bg-orange-500/10 px-1.5 py-1 text-[8px] font-bold text-orange-300 transition hover:bg-orange-500/20">
      {icon} {label}
    </button>
  );
}

function IconButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-5 w-5 items-center justify-center rounded-md bg-white/5 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200 disabled:opacity-20">
      {children}
    </button>
  );
}

function parseAnswers(value: string): string[] {
  return value.split(/[,;\n]/).map((answer) => answer.trim()).filter(Boolean);
}

function shortName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
