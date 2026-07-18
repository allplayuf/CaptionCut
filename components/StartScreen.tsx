"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import {
  ArrowRight,
  Clapperboard,
  Cloud,
  FolderOpen,
  Mic,
  Trophy,
  Upload,
  Zap,
} from "lucide-react";

const EXAMPLES = [
  {
    icon: Trophy,
    title: "Football match",
    text: "Goals, saves and celebrations cut into a hype montage.",
  },
  {
    icon: Zap,
    title: "Street football",
    text: "Raw cage-football energy — skills, nutmegs, reactions.",
  },
  {
    icon: Mic,
    title: "Interview + match",
    text: "The best spoken lines interleaved with the action.",
  },
  {
    icon: Clapperboard,
    title: "Match recap",
    text: "A clean chronological recap with captions.",
  },
];

/**
 * First-run screen shown while the project is empty: explains the workflow in
 * one sentence, takes the drag-and-drop upload, and lists recent projects.
 * Disappears the moment media lands in the project.
 */
export default function StartScreen({ onSkip }: { onSkip: () => void }) {
  const { uploading, handleFiles } = useMediaUpload();
  const loadProject = useEditorStore((s) => s.loadProject);
  const addToast = useEditorStore((s) => s.addToast);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((list: ProjectSummary[]) => {
        if (Array.isArray(list)) setRecent(list.filter((p) => p.clipCount > 0).slice(0, 4));
      })
      .catch(() => {});
  }, []);

  const openProject = async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) throw new Error();
      loadProject((await response.json()) as Project);
    } catch {
      addToast("error", "Could not open that project.");
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-[#08080d] px-6 py-10">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-violet-600/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 left-1/4 h-80 w-96 rounded-full bg-emerald-600/10 blur-3xl" />

      <div className="relative flex w-full max-w-2xl flex-col items-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-xl shadow-fuchsia-500/30">
          <Clapperboard size={22} />
        </div>
        <h1 className="bg-gradient-to-r from-violet-200 via-white to-fuchsia-200 bg-clip-text text-3xl font-black tracking-tight text-transparent">
          CaptionCut
        </h1>
        <p className="mt-2 max-w-md text-center text-sm leading-relaxed text-zinc-400">
          Upload your raw match clips, hit <span className="font-semibold text-emerald-300">Create montage</span>,
          get a TikTok-ready football edit — then fine-tune every cut on a real timeline.
        </p>

        {/* upload zone */}
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
          }}
          disabled={uploading !== null}
          className={`mt-8 flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-8 py-12 transition ${
            dragOver
              ? "border-fuchsia-400 bg-fuchsia-500/10"
              : "border-white/15 bg-white/[0.03] hover:border-violet-400/60 hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/25">
            <Upload size={24} />
          </div>
          {uploading ? (
            <div className="w-full max-w-sm">
              <p className="truncate text-center text-sm text-zinc-300">
                {uploading.total > 1 && (
                  <span className="mr-1.5 font-mono text-xs text-zinc-500">
                    {uploading.index}/{uploading.total}
                  </span>
                )}
                {uploading.name}
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                  style={{ width: `${Math.round(uploading.progress * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-base font-semibold text-zinc-100">
                Drop your clips here <span className="text-zinc-500">or click to browse</span>
              </p>
              <p className="text-xs text-zinc-500">
                Many short phone clips work best · video, music and images · vertical or horizontal
              </p>
            </>
          )}
        </button>

        <div className="mt-3 flex w-full items-center gap-3">
          <span className="h-px flex-1 bg-white/8" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">or</span>
          <span className="h-px flex-1 bg-white/8" />
        </div>
        <GoogleDriveButton
          disabled={uploading !== null}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.045] px-4 py-3 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/[0.075] hover:ring-sky-400/30 disabled:opacity-50"
        >
          <Cloud size={15} className="text-sky-300" /> Choose video or audio from Google Drive
        </GoogleDriveButton>

        {/* example workflows */}
        <div className="mt-6 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {EXAMPLES.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/8"
            >
              <Icon size={14} className="text-emerald-300" />
              <p className="mt-1.5 text-xs font-semibold text-zinc-200">{title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{text}</p>
            </div>
          ))}
        </div>

        {/* recent projects */}
        {recent.length > 0 && (
          <div className="mt-8 w-full">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <FolderOpen size={11} /> Recent projects
            </p>
            <div className="flex flex-col gap-1.5">
              {recent.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void openProject(p.id)}
                  className="group flex items-center justify-between rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-left ring-1 ring-white/8 transition hover:bg-white/[0.07] hover:ring-white/15"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-zinc-200">{p.name}</p>
                    <p className="text-[10px] text-zinc-500">
                      {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} ·{" "}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-zinc-600 transition group-hover:text-zinc-300" />
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onSkip}
          className="mt-6 text-[11px] font-medium text-zinc-600 underline-offset-2 transition hover:text-zinc-400 hover:underline"
        >
          Skip — start in the empty editor
        </button>
      </div>
    </div>
  );
}
