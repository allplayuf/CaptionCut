"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import {
  ArrowRight,
  Captions,
  Check,
  Cloud,
  Download,
  FileVideo2,
  FolderOpen,
  LoaderCircle,
  Scissors,
  Upload,
} from "lucide-react";

const STEPS = [
  {
    icon: Scissors,
    title: "Cut from the transcript",
    text: "Remove a sentence and the video follows.",
  },
  {
    icon: Captions,
    title: "Caption on device",
    text: "Speech stays in your browser.",
  },
  {
    icon: Download,
    title: "Export the final cut",
    text: "One finished MP4, ready to publish.",
  },
];

export default function StartScreen({ onSkip }: { onSkip: () => void }) {
  const { uploading, handleFiles } = useMediaUpload();
  const loadProject = useEditorStore((state) => state.loadProject);
  const addToast = useEditorStore((state) => state.addToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((response) => response.json())
      .then((list: ProjectSummary[]) => {
        if (Array.isArray(list)) {
          setRecent(list.filter((project) => project.clipCount > 0).slice(0, 3));
        }
      })
      .catch(() => {});
  }, []);

  const openProject = async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) throw new Error();
      loadProject((await response.json()) as Project);
    } catch {
      addToast("error", "Couldn’t open that project.");
    }
  };

  return (
    <div className="start-screen absolute inset-0 z-40 overflow-y-auto">
      <div className="start-grid pointer-events-none absolute inset-0 opacity-25" />

      <div className="start-layout relative mx-auto grid min-h-full w-full max-w-[1180px] grid-cols-1 items-center gap-14 px-7 py-10 lg:grid-cols-[1fr_440px] lg:px-12">
        <section className="start-intro">
          <div className="mb-10 flex items-center gap-2.5">
            <div className="brand-mark h-9 w-9">
              <FileVideo2 size={17} strokeWidth={2.4} />
              <span className="brand-film-line" />
            </div>
            <span className="text-sm font-black tracking-[-0.04em] text-[#f4f4f1]">
              CaptionCut
            </span>
          </div>

          <p className="panel-eyebrow text-[var(--cut)]">
            Transcript-first video editor
          </p>
          <h1 className="start-title mt-4 max-w-[650px] text-[clamp(3rem,6vw,5.7rem)] font-black leading-[0.88] tracking-[-0.07em] text-[#f4f4f1]">
            Make the cut.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#9299a2]">
            Import footage, edit from the transcript, and export a finished video.
          </p>

          <div className="mt-10 max-w-xl border-y border-white/[0.08]">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="grid grid-cols-[32px_1fr] gap-x-3 border-b border-white/[0.07] py-4 last:border-b-0 sm:grid-cols-[32px_180px_1fr]"
              >
                <Icon size={15} className="mt-0.5 text-[var(--cut)]" />
                <p className="text-xs font-semibold text-[#dcdfdf]">{title}</p>
                <p className="col-start-2 mt-1 text-[11px] leading-relaxed text-[#737b85] sm:col-start-3 sm:mt-0">
                  {text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="start-import surface-panel p-3">
          <div className="px-2 pb-3 pt-1">
            <p className="text-sm font-semibold text-[#eceeec]">Start a project</p>
            <p className="mt-1 text-[11px] text-[#727a84]">Add video, audio, or still images.</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
            }}
            disabled={uploading !== null}
            className={`flex min-h-[230px] w-full flex-col items-center justify-center rounded-lg border border-dashed px-8 py-9 text-center transition ${
              dragOver
                ? "border-[var(--cut)] bg-[var(--cut)]/[0.07]"
                : "border-white/[0.14] bg-[#090a0c] hover:border-white/25 hover:bg-[#0c0e11]"
            }`}
          >
            {uploading ? (
              <div className="w-full max-w-xs">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--cut)]">
                  <LoaderCircle size={19} className="animate-spin" />
                </div>
                <p className="mt-4 truncate text-sm font-semibold text-[#e0e3e3]">
                  {uploading.name}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[#6d747d]">
                  {uploading.total > 1 && `${uploading.index}/${uploading.total} · `}
                  {Math.round(uploading.progress * 100)}%
                </p>
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-[var(--cut)] transition-all"
                    style={{ width: `${Math.round(uploading.progress * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--cut)] text-[#17120d]">
                  <Upload size={19} strokeWidth={2.3} />
                </div>
                <p className="mt-5 text-sm font-semibold tracking-[-0.01em] text-[#edf0ed]">
                  Drop media here
                </p>
                <p className="mt-1.5 text-[11px] text-[#78808a]">
                  or browse your device
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-[#5f6872]">
                  <span className="flex items-center gap-1"><Check size={9} /> Video</span>
                  <span className="flex items-center gap-1"><Check size={9} /> Audio</span>
                  <span className="flex items-center gap-1"><Check size={9} /> Images</span>
                </div>
              </>
            )}
          </button>

          <div className="my-3 flex items-center gap-3 px-2">
            <span className="h-px flex-1 bg-white/[0.07]" />
            <span className="text-[10px] text-[#59616b]">or</span>
            <span className="h-px flex-1 bg-white/[0.07]" />
          </div>

          <GoogleDriveButton
            disabled={uploading !== null}
            className="secondary-compact min-h-11 w-full px-4 text-xs"
          >
            <Cloud size={14} /> Choose from Google Drive
          </GoogleDriveButton>

          <p className="mt-3 text-center text-[10px] text-[#5f6872]">
            Captions run on this device. Projects save automatically.
          </p>

          {recent.length > 0 && (
            <div className="mt-5 border-t border-white/[0.07] px-1 pt-4">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-[#69727c]">
                <FolderOpen size={11} /> Recent projects
              </p>
              <div className="space-y-1">
                {recent.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => void openProject(project.id)}
                    className="group flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left transition hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[#cfd3d4]">
                        {project.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#5f6872]">
                        {project.clipCount} {project.clipCount === 1 ? "clip" : "clips"} ·{" "}
                        {new Date(project.updatedAt).toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <ArrowRight
                      size={13}
                      className="text-[#4f5965] transition group-hover:translate-x-0.5 group-hover:text-[var(--cut)]"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onSkip}
            className="mx-auto mt-3 block rounded-md px-3 py-1.5 text-[10px] font-medium text-[#626a74] transition hover:bg-white/[0.04] hover:text-[#a0a6ad]"
          >
            Open empty editor
          </button>
        </section>
      </div>
    </div>
  );
}
