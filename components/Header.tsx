"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { FORMATS } from "@/lib/video/formats";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clapperboard,
  Cloud,
  CloudUpload,
  Download,
  FilePlus2,
  History,
  HardDrive,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";

export default function Header({ onExport }: { onExport: () => void }) {
  const projectName = useEditorStore((state) => state.projectName);
  const projectId = useEditorStore((state) => state.projectId);
  const tracks = useEditorStore((state) => state.tracks);
  const saveState = useEditorStore((state) => state.saveState);
  const canUndo = useEditorStore((state) => state.past.length > 0);
  const canRedo = useEditorStore((state) => state.future.length > 0);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const resetToNewProject = useEditorStore((state) => state.resetToNewProject);
  const loadProject = useEditorStore((state) => state.loadProject);
  const addToast = useEditorStore((state) => state.addToast);

  const [menuOpen, setMenuOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    fetch("/api/projects")
      .then((response) => response.json())
      .then((list: ProjectSummary[]) => Array.isArray(list) && setProjects(list))
      .catch(() => {});
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const openProject = async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) throw new Error();
      loadProject((await response.json()) as Project);
      setMenuOpen(false);
    } catch {
      addToast("error", "Projektet gick inte att öppna.");
    }
  };

  const removeProject = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
    setProjects((list) => list.filter((project) => project.id !== id));
    if (id === projectId) resetToNewProject();
    addToast("info", "Projektet raderades.");
  };

  return (
    <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0b0e13] px-3">
      <div className="flex items-center gap-2">
        <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[10px] bg-[#ffb45b] text-[#181108]">
          <Clapperboard size={16} strokeWidth={2.4} />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#7db8ff]" />
        </div>
        <span className="text-[14px] font-extrabold tracking-[-0.035em] text-[#f1f4f7]">
          CaptionCut
        </span>
      </div>

      <div className="mx-1 h-5 w-px bg-white/[0.09]" />

      <input
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
        className="w-48 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs font-semibold text-[#dce2e8] outline-none transition hover:border-white/10 focus:border-[#ffb45b]/60"
        placeholder="Projektnamn"
      />

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((value) => !value)}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#7d8896] transition hover:bg-white/[0.05] hover:text-[#cbd3dc]"
        >
          Projekt <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-white/10 bg-[#151a22] p-1.5 shadow-2xl shadow-black/60">
            <button
              onClick={() => {
                resetToNewProject();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#ffbd6d] transition hover:bg-white/[0.05]"
            >
              <FilePlus2 size={14} /> Nytt projekt
            </button>
            {projects.length > 0 && <div className="my-1 h-px bg-white/[0.07]" />}
            {projects.map((project) => (
              <div
                key={project.id}
                className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition hover:bg-white/[0.05]"
              >
                <button
                  onClick={() => void openProject(project.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-medium text-[#dce2e8]">
                    {project.name}
                    {project.id === projectId && (
                      <span className="ml-1.5 text-[9px] text-[#ffb45b]">öppet</span>
                    )}
                  </p>
                  <p className="text-[10px] text-[#66717f]">
                    {project.clipCount} klipp · {new Date(project.updatedAt).toLocaleString("sv-SE")}
                  </p>
                </button>
                <button
                  onClick={() => void removeProject(project.id)}
                  onMouseLeave={() =>
                    confirmDeleteId === project.id && setConfirmDeleteId(null)
                  }
                  className={`flex items-center gap-1 rounded p-1 text-[#59636f] transition hover:bg-red-500/15 hover:text-red-300 ${
                    confirmDeleteId === project.id
                      ? "bg-red-500/15 px-1.5 text-[9px] font-bold text-red-300 opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={
                    confirmDeleteId === project.id
                      ? "Klicka igen för att radera"
                      : "Radera projekt"
                  }
                >
                  <Trash2 size={12} />
                  {confirmDeleteId === project.id && "Säker?"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <VersionsMenu />
      <div className="mx-1 h-5 w-px bg-white/[0.09]" />

      <button
        onClick={undo}
        disabled={!canUndo}
        title="Ångra (Ctrl+Z)"
        className="rounded-lg p-1.5 text-[#818c99] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Gör om (Ctrl+Shift+Z)"
        className="rounded-lg p-1.5 text-[#818c99] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
      >
        <Redo2 size={14} />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <StorageBadge />
        <SaveState state={saveState} />
        <FormatBadge />
        <button
          onClick={onExport}
          disabled={tracksDuration(tracks) <= 0}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#ffb45b] px-4 text-xs font-extrabold text-[#191209] shadow-[0_8px_24px_rgba(255,180,91,0.14)] transition hover:bg-[#ffc477] active:scale-[0.98] disabled:opacity-35"
        >
          <Download size={14} /> Exportera
        </button>
      </div>
    </header>
  );
}

function StorageBadge() {
  const [storage, setStorage] = useState<"blob" | "local" | "unconfigured" | null>(null);

  useEffect(() => {
    fetch("/api/upload", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { storage?: "blob" | "local" | "unconfigured" }) =>
        setStorage(body.storage ?? "unconfigured")
      )
      .catch(() => setStorage("unconfigured"));
  }, []);

  if (!storage) return null;
  if (storage === "blob") {
    return (
      <span
        className="flex items-center gap-1 rounded-full bg-[#9ce5c3]/[0.07] px-2 py-1 text-[9px] font-medium text-[#9ce5c3]"
        title="Projekt och media sparas i molnet för den här webbläsaren"
      >
        <Cloud size={10} /> Moln
      </span>
    );
  }
  if (storage === "local") {
    return (
      <span
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium text-[#65717f]"
        title="Lokal utveckling — data sparas på den här datorn"
      >
        <HardDrive size={10} /> Lokalt
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[9px] font-medium text-red-300"
      title="Molnlagring måste anslutas innan uppladdning fungerar"
    >
      <AlertTriangle size={10} /> Lagring saknas
    </span>
  );
}

function SaveState({ state }: { state: "saved" | "saving" | "error" }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium ${
        state === "error"
          ? "bg-red-500/10 text-red-300"
          : state === "saving"
            ? "text-[#7d8896]"
            : "text-[#65717f]"
      }`}
      title={state === "error" ? "Autosparningen misslyckades" : "Allt sparas automatiskt"}
    >
      {state === "saving" ? (
        <>
          <CloudUpload size={11} className="animate-pulse" /> Sparar…
        </>
      ) : state === "error" ? (
        <>
          <AlertTriangle size={11} /> Kunde inte spara
        </>
      ) : (
        <>
          <Check size={11} /> Sparat
        </>
      )}
    </span>
  );
}

function FormatBadge() {
  const format = useEditorStore((state) => state.format);
  const spec = FORMATS[format];
  return (
    <span className="rounded-full bg-white/[0.035] px-2.5 py-1 font-mono text-[9px] text-[#687380] ring-1 ring-white/[0.07]">
      {spec.label} · {spec.width}×{spec.height}
    </span>
  );
}

function VersionsMenu() {
  const versions = useEditorStore((state) => state.versions);
  const saveVersion = useEditorStore((state) => state.saveVersion);
  const restoreVersion = useEditorStore((state) => state.restoreVersion);
  const deleteVersion = useEditorStore((state) => state.deleteVersion);
  const resetToAutoEdit = useEditorStore((state) => state.resetToAutoEdit);
  const addToast = useEditorStore((state) => state.addToast);
  const hasContent = useEditorStore((state) => tracksDuration(state.tracks) > 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasAutoEdit = versions.some((version) => version.kind === "auto-edit");

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#7d8896] transition hover:bg-white/[0.05] hover:text-[#cbd3dc]"
        title="Sparade versioner"
      >
        <History size={12} /> Versioner <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-xl border border-white/10 bg-[#151a22] p-1.5 shadow-2xl shadow-black/60">
          <button
            onClick={() => {
              if (!hasContent) {
                addToast("info", "Det finns inget på tidslinjen att spara ännu.");
                return;
              }
              saveVersion(`Version ${new Date().toLocaleTimeString("sv-SE")}`);
              addToast("success", "Versionen sparades.");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#ffbd6d] transition hover:bg-white/[0.05]"
          >
            <Save size={14} /> Spara nuvarande version
          </button>
          <button
            onClick={() => {
              resetToAutoEdit();
              setOpen(false);
            }}
            disabled={!hasAutoEdit}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#b8c1cc] transition hover:bg-white/[0.05] disabled:opacity-35"
          >
            <RotateCcw size={14} /> Återställ smart redigering
          </button>
          {versions.length > 0 && <div className="my-1 h-px bg-white/[0.07]" />}
          {versions.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] leading-snug text-[#65717f]">
              Inga versioner ännu. Spara en innan du testar en större förändring.
            </p>
          )}
          {versions.map((version) => (
            <div
              key={version.id}
              className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition hover:bg-white/[0.05]"
            >
              <button
                onClick={() => {
                  restoreVersion(version.id);
                  setOpen(false);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-xs font-medium text-[#dce2e8]">
                  {version.name}
                  {version.kind !== "manual" && (
                    <span className="ml-1.5 text-[9px] text-[#9ce5c3]">auto</span>
                  )}
                </p>
                <p className="text-[10px] text-[#65717f]">
                  {new Date(version.createdAt).toLocaleString("sv-SE")}
                </p>
              </button>
              <button
                onClick={() => deleteVersion(version.id)}
                className="rounded p-1 text-[#59636f] opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                title="Radera version"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
