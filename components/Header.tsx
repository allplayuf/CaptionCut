"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { FORMATS } from "@/lib/video/formats";
import type { EditorTool } from "@/lib/ui/editorTools";
import {
  AlertTriangle,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Cloud,
  CloudUpload,
  Download,
  FilePlus2,
  FolderOpen,
  History,
  HardDrive,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";

export default function Header({
  onExport,
  onCommand,
  onHelp,
  onOpenTool,
  onRetrySave,
}: {
  onExport: () => void;
  onCommand: () => void;
  onHelp: () => void;
  onOpenTool: (tool: EditorTool) => void;
  onRetrySave: () => void;
}) {
  const projectName = useEditorStore((state) => state.projectName);
  const projectId = useEditorStore((state) => state.projectId);
  const tracks = useEditorStore((state) => state.tracks);
  const mediaCount = useEditorStore((state) => state.media.length);
  const captionCount = useEditorStore((state) => state.captions.length);
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
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeWithEscape);
    };
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
    <header className="app-header relative z-40 flex h-[60px] shrink-0 items-center gap-2 border-b border-white/[0.075] bg-[#0a0e13]/95 px-3 shadow-[0_8px_35px_rgba(0,0,0,.16)] backdrop-blur">
      <div className="app-brand flex items-center gap-2">
        <div className="brand-mark">
          <Clapperboard size={16} strokeWidth={2.4} />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#7db8ff]" />
        </div>
        <span className="app-brand-label text-[14px] font-extrabold tracking-[-0.035em] text-[#f1f4f7]">
          CaptionCut
        </span>
      </div>

      <div className="header-project-divider mx-1 h-5 w-px bg-white/[0.09]" />

      <input
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
        aria-label="Projektnamn"
        maxLength={80}
        className="project-name-input w-40 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[11px] font-semibold text-[#dce2e8] outline-none transition hover:border-white/10 hover:bg-white/[0.025] focus:border-[var(--cut)]/55"
        placeholder="Projektnamn"
      />

      <div ref={menuRef} className="header-project-menu relative">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#7d8896] transition hover:bg-white/[0.05] hover:text-[#cbd3dc]"
        >
          Projekt <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Projekt"
            className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-white/10 bg-[#151a22] p-1.5 shadow-2xl shadow-black/60"
          >
            <button
              type="button"
              role="menuitem"
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
                  type="button"
                  role="menuitem"
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
                  type="button"
                  role="menuitem"
                  onClick={() => void removeProject(project.id)}
                  onMouseLeave={() =>
                    confirmDeleteId === project.id && setConfirmDeleteId(null)
                  }
                  className={`flex items-center gap-1 rounded p-1 text-[#59636f] transition hover:bg-red-500/15 hover:text-red-300 ${
                    confirmDeleteId === project.id
                      ? "bg-red-500/15 px-1.5 text-[9px] font-bold text-red-300 opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                  }`}
                  aria-label={
                    confirmDeleteId === project.id
                      ? `Bekräfta radering av ${project.name}`
                      : `Radera ${project.name}`
                  }
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
      <div className="header-history-divider mx-1 h-5 w-px bg-white/[0.09]" />

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

      <WorkflowNav
        mediaReady={mediaCount > 0}
        timelineReady={tracksDuration(tracks) > 0}
        captionsReady={captionCount > 0}
        onOpenTool={onOpenTool}
        onExport={onExport}
      />

      <div className="header-actions ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCommand}
          className="command-trigger"
          title="Öppna kommandopaletten (Ctrl+K)"
        >
          <Search size={12} />
          <span className="hidden 2xl:inline">Kommandon</span>
          <kbd className="hidden lg:inline">Ctrl K</kbd>
        </button>
        <button
          type="button"
          onClick={onHelp}
          className="header-icon"
          title="Snabbguide och kortkommandon"
          aria-label="Öppna snabbguide"
        >
          <CircleHelp size={14} />
        </button>
        <div className="hidden items-center gap-1.5 min-[1180px]:flex">
          <StorageBadge />
          <SaveState state={saveState} onRetry={onRetrySave} />
        </div>
        <div className="hidden 2xl:block">
          <FormatBadge />
        </div>
        <button
          onClick={onExport}
          disabled={tracksDuration(tracks) <= 0}
          aria-label="Exportera video"
          className="flex h-9 items-center gap-1.5 rounded-[11px] bg-[var(--cut)] px-3.5 text-[10px] font-extrabold text-[#191209] shadow-[0_8px_24px_rgba(242,182,109,0.14)] transition hover:bg-[#fac688] active:translate-y-px disabled:opacity-35"
        >
          <Download size={14} /> <span className="export-label">Exportera</span>
        </button>
      </div>
    </header>
  );
}

function WorkflowNav({
  mediaReady,
  timelineReady,
  captionsReady,
  onOpenTool,
  onExport,
}: {
  mediaReady: boolean;
  timelineReady: boolean;
  captionsReady: boolean;
  onOpenTool: (tool: EditorTool) => void;
  onExport: () => void;
}) {
  const steps = [
    {
      label: "Material",
      icon: FolderOpen,
      ready: mediaReady,
      onClick: () => onOpenTool("media"),
    },
    {
      label: "Klipp",
      icon: Scissors,
      ready: timelineReady,
      onClick: () => onOpenTool("cut"),
    },
    {
      label: "Text",
      icon: Captions,
      ready: captionsReady,
      onClick: () => onOpenTool("captions"),
    },
    {
      label: "Export",
      icon: Download,
      ready: false,
      disabled: !timelineReady,
      onClick: onExport,
    },
  ];

  return (
    <nav
      className="hidden shrink-0 items-center rounded-xl bg-white/[0.025] p-1 ring-1 ring-white/[0.065] min-[1050px]:flex"
      aria-label="Arbetsflöde"
    >
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex items-center">
            {index > 0 && <ChevronRight size={10} className="mx-0.5 text-[#3f4a55]" />}
            <button
              type="button"
              onClick={step.onClick}
              disabled={step.disabled}
              className="group flex h-7 items-center gap-1.5 rounded-lg px-2 text-[8px] font-bold uppercase tracking-[0.08em] text-[#71808d] transition hover:bg-white/[0.05] hover:text-[#c7d0d8] disabled:opacity-35"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ${
                  step.ready
                    ? "bg-[var(--caption)]/15 text-[var(--caption)]"
                    : "bg-white/[0.04] text-[#5e6b77] group-hover:text-[#8795a1]"
                }`}
              >
                {step.ready ? <Check size={9} strokeWidth={3} /> : <Icon size={9} />}
              </span>
              {step.label}
            </button>
          </div>
        );
      })}
    </nav>
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
        title="Projekt och media synkas i molnet; captions skapas lokalt på enheten"
      >
        <Cloud size={10} /> Media i moln · text lokalt
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

function SaveState({
  state,
  onRetry,
}: {
  state: "saved" | "saving" | "error";
  onRetry: () => void;
}) {
  if (state === "error") {
    return (
      <span role="status" aria-live="polite">
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[9px] font-medium text-red-300 transition hover:bg-red-500/20"
          title="Autosparningen misslyckades. Klicka för att försöka igen."
        >
          <AlertTriangle size={11} /> Försök spara igen
        </button>
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium ${
        state === "saving" ? "text-[#7d8896]" : "text-[#65717f]"
      }`}
      title="Allt sparas automatiskt"
    >
      {state === "saving" ? (
        <>
          <CloudUpload size={11} className="animate-pulse" /> Sparar…
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
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="header-versions relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#7d8896] transition hover:bg-white/[0.05] hover:text-[#cbd3dc]"
        title="Sparade versioner"
      >
        <History size={12} /> Versioner <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Sparade versioner"
          className="absolute left-0 top-full z-30 mt-1 w-80 rounded-xl border border-white/10 bg-[#151a22] p-1.5 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            role="menuitem"
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
            type="button"
            role="menuitem"
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
                type="button"
                role="menuitem"
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
                type="button"
                role="menuitem"
                onClick={() => deleteVersion(version.id)}
                className="rounded p-1 text-[#59636f] opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                title="Radera version"
                aria-label={`Radera ${version.name}`}
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
