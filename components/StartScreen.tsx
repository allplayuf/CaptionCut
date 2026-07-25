"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import GoogleDriveButton from "@/components/GoogleDriveButton";
import {
  ArrowRight,
  Check,
  Cloud,
  FileVideo2,
  FolderOpen,
  Pause,
  Scissors,
  Sparkles,
  Upload,
} from "lucide-react";

const STEPS = [
  {
    icon: Upload,
    title: "Importera",
    text: "Dra in den råa videon. Formatet spelar ingen roll.",
  },
  {
    icon: Pause,
    title: "Rensa",
    text: "Granska pauser och utfyllnadsord innan de tas bort.",
  },
  {
    icon: Scissors,
    title: "Finjustera",
    text: "Klipp i transcriptet eller direkt på tidslinjen.",
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
      addToast("error", "Projektet gick inte att öppna.");
    }
  };

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-[#080b10]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-11rem] h-[26rem] w-[26rem] rounded-full bg-[#7db8ff]/[0.07] blur-3xl" />
        <div className="absolute bottom-[-13rem] right-[-8rem] h-[30rem] w-[30rem] rounded-full bg-[#ffb45b]/[0.08] blur-3xl" />
        <div className="start-grid absolute inset-0 opacity-30" />
      </div>

      <div className="relative mx-auto grid min-h-full w-full max-w-[1160px] grid-cols-1 items-center gap-12 px-7 py-10 lg:grid-cols-[1fr_460px] lg:px-12">
        <section>
          <div className="mb-8 flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#ffb45b] text-[#181108]">
              <FileVideo2 size={17} strokeWidth={2.4} />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#7db8ff]" />
            </div>
            <span className="text-sm font-extrabold tracking-[-0.035em] text-[#eef2f5]">
              CaptionCut
            </span>
            <span className="rounded-full bg-white/[0.04] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[#697583] ring-1 ring-white/[0.07]">
              Video editor
            </span>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ffb45b]">
            Klipp mindre. Säg mer.
          </p>
          <h1 className="mt-3 max-w-[650px] text-[clamp(2.8rem,5.8vw,5.4rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-[#f3f5f7]">
            Redigera videon som om den vore text.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#8a95a3]">
            CaptionCut hittar tystnad, utfyllnadsord och det du inte vill ha med. Du granskar
            varje klipp innan något försvinner.
          </p>

          <div className="mt-9 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <div
                key={title}
                className="rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.07]"
              >
                <div className="flex items-center justify-between">
                  <Icon size={15} className={index === 1 ? "text-[#ffb45b]" : "text-[#7db8ff]"} />
                  <span className="font-mono text-[9px] text-[#4f5a67]">0{index + 1}</span>
                </div>
                <p className="mt-4 text-xs font-semibold text-[#dce2e8]">{title}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-[#717c89]">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] bg-[#10151c]/95 p-3 shadow-2xl shadow-black/40 ring-1 ring-white/[0.09] backdrop-blur">
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
            className={`flex min-h-[245px] w-full flex-col items-center justify-center rounded-[22px] border border-dashed px-8 py-10 text-center transition ${
              dragOver
                ? "border-[#ffb45b] bg-[#ffb45b]/[0.08]"
                : "border-white/[0.13] bg-[#090c11] hover:border-[#7db8ff]/50 hover:bg-[#0c1016]"
            }`}
          >
            {uploading ? (
              <div className="w-full max-w-xs">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7db8ff]/10 text-[#7db8ff]">
                  <Sparkles size={20} className="animate-pulse" />
                </div>
                <p className="mt-4 truncate text-sm font-semibold text-[#e0e6ec]">
                  {uploading.name}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[#6d7885]">
                  {uploading.total > 1 && `${uploading.index}/${uploading.total} · `}
                  {Math.round(uploading.progress * 100)}%
                </p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-[#ffb45b] transition-all"
                    style={{ width: `${Math.round(uploading.progress * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ffb45b] text-[#181108] shadow-[0_12px_35px_rgba(255,180,91,0.18)]">
                  <Upload size={21} strokeWidth={2.3} />
                </div>
                <p className="mt-5 text-base font-semibold tracking-[-0.02em] text-[#edf1f5]">
                  Släpp en video här
                </p>
                <p className="mt-1.5 text-xs text-[#74808e]">
                  eller klicka för att välja från datorn
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#56616e]">
                  <span className="flex items-center gap-1"><Check size={9} /> video</span>
                  <span className="flex items-center gap-1"><Check size={9} /> ljud</span>
                  <span className="flex items-center gap-1"><Check size={9} /> bilder</span>
                </div>
              </>
            )}
          </button>

          <div className="my-3 flex items-center gap-3 px-2">
            <span className="h-px flex-1 bg-white/[0.07]" />
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#56616e]">
              eller
            </span>
            <span className="h-px flex-1 bg-white/[0.07]" />
          </div>

          <GoogleDriveButton
            disabled={uploading !== null}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.045] px-4 py-3 text-xs font-semibold text-[#cdd5de] ring-1 ring-white/[0.08] transition hover:bg-white/[0.075] hover:ring-[#7db8ff]/25 disabled:opacity-50"
          >
            <Cloud size={14} className="text-[#7db8ff]" /> Välj från Google Drive
          </GoogleDriveButton>

          <div className="mt-3 flex items-center justify-center gap-3 font-mono text-[8px] uppercase tracking-[0.1em] text-[#5f6a77]">
            <span className="flex items-center gap-1"><Check size={9} /> egen arbetsyta</span>
            <span className="flex items-center gap-1"><Check size={9} /> autosparning</span>
            <span className="flex items-center gap-1"><Check size={9} /> inget konto</span>
          </div>

          {recent.length > 0 && (
            <div className="mt-5 border-t border-white/[0.07] px-1 pt-4">
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.13em] text-[#64707e]">
                <FolderOpen size={11} /> Senaste projekt
              </p>
              <div className="space-y-1">
                {recent.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => void openProject(project.id)}
                    className="group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-[#cfd7df]">
                        {project.name}
                      </p>
                      <p className="mt-0.5 text-[9px] text-[#5f6a77]">
                        {project.clipCount} klipp ·{" "}
                        {new Date(project.updatedAt).toLocaleDateString("sv-SE")}
                      </p>
                    </div>
                    <ArrowRight
                      size={13}
                      className="text-[#4f5965] transition group-hover:translate-x-0.5 group-hover:text-[#ffb45b]"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onSkip}
            className="mx-auto mt-3 block rounded-lg px-3 py-1.5 text-[10px] font-medium text-[#596471] transition hover:bg-white/[0.04] hover:text-[#8e99a6]"
          >
            Öppna tom redigerare
          </button>
        </section>
      </div>
    </div>
  );
}
