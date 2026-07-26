"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  CloudUpload,
  Download,
  FilePlus2,
  History,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";

export default function Header({
  onExport,
  onCommand,
  onHelp,
  onRetrySave,
}: {
  onExport: () => void;
  onCommand: () => void;
  onHelp: () => void;
  onRetrySave: () => void;
}) {
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
      addToast("error", "Couldn’t open that project.");
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
    addToast("info", "Project deleted.");
  };

  return (
    <header className="app-header relative z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-white/[0.07] px-3">
      <div className="app-brand flex items-center gap-2">
        <div className="brand-mark">
          <Clapperboard size={16} strokeWidth={2.4} />
          <span className="brand-film-line" />
        </div>
        <span className="app-brand-label text-[14px] font-black tracking-[-0.04em] text-[#f4f4f1]">
          CaptionCut
        </span>
      </div>

      <div className="header-project-divider mx-1.5 h-5 w-px bg-white/[0.08]" />

      <input
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
        aria-label="Project name"
        maxLength={80}
        className="project-name-input w-44 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs font-semibold text-[#dedfdd] outline-none transition hover:border-white/10 hover:bg-white/[0.03] focus:border-[var(--cut)]/55"
        placeholder="Untitled project"
      />

      <div ref={menuRef} className="header-project-menu relative">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="header-utility"
        >
          Projects <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Projects"
            className="surface-menu absolute left-0 top-full z-30 mt-1.5 w-72 p-1.5"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                resetToNewProject();
                setMenuOpen(false);
              }}
              className="menu-item text-[var(--cut)]"
            >
              <FilePlus2 size={14} /> New project
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
                      <span className="ml-1.5 text-[9px] text-[var(--cut)]">open</span>
                    )}
                  </p>
                  <p className="text-[10px] text-[#66717f]">
                    {project.clipCount} {project.clipCount === 1 ? "clip" : "clips"} ·{" "}
                    {new Date(project.updatedAt).toLocaleString("en-US")}
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
                      ? `Confirm deleting ${project.name}`
                      : `Delete ${project.name}`
                  }
                  title={
                    confirmDeleteId === project.id
                      ? "Click again to delete"
                      : "Delete project"
                  }
                >
                  <Trash2 size={12} />
                  {confirmDeleteId === project.id && "Delete?"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <VersionsMenu />
      <div className="header-history-divider mx-1 h-5 w-px bg-white/[0.08]" />

      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        className="header-icon"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        className="header-icon"
      >
        <Redo2 size={14} />
      </button>

      <div className="header-actions ml-auto flex items-center gap-1.5">
        <StorageAlert />
        <div className="hidden sm:block">
          <SaveState state={saveState} onRetry={onRetrySave} />
        </div>
        <button
          type="button"
          onClick={onCommand}
          className="command-trigger"
          title="Search commands (Ctrl+K)"
        >
          <Search size={12} />
          <span className="hidden xl:inline">Search</span>
          <kbd className="hidden lg:inline">Ctrl K</kbd>
        </button>
        <button
          type="button"
          onClick={onHelp}
          className="header-icon"
          title="Help and keyboard shortcuts"
          aria-label="Open help"
        >
          <CircleHelp size={14} />
        </button>
        <button
          onClick={onExport}
          disabled={tracksDuration(tracks) <= 0}
          aria-label="Export video"
          className="primary-compact h-9 px-3.5 text-[11px]"
        >
          <Download size={14} /> <span className="export-label">Export</span>
        </button>
      </div>
    </header>
  );
}

function StorageAlert() {
  const [storage, setStorage] = useState<"blob" | "local" | "unconfigured" | null>(null);

  useEffect(() => {
    fetch("/api/upload", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { storage?: "blob" | "local" | "unconfigured" }) =>
        setStorage(body.storage ?? "unconfigured")
      )
      .catch(() => setStorage("unconfigured"));
  }, []);

  if (!storage || storage !== "unconfigured") return null;
  return (
    <span
      className="hidden items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300 sm:flex"
      title="Connect cloud storage before accepting uploads."
    >
      <AlertTriangle size={11} /> Storage offline
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
          className="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300 transition hover:bg-red-500/20"
          title="Autosave failed. Click to try again."
        >
          <AlertTriangle size={11} /> Retry save
        </button>
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${
        state === "saving" ? "text-[#7d8896]" : "text-[#65717f]"
      }`}
      title="Changes save automatically"
    >
      {state === "saving" ? (
        <>
          <CloudUpload size={11} className="animate-pulse" /> Saving…
        </>
      ) : (
        <>
          <Check size={11} /> Saved
        </>
      )}
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
        title="Saved versions"
      >
        <History size={12} /> Versions <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Saved versions"
          className="surface-menu absolute left-0 top-full z-30 mt-1.5 w-80 p-1.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (!hasContent) {
                addToast("info", "There’s nothing on the timeline to save yet.");
                return;
              }
              saveVersion(`Version ${new Date().toLocaleTimeString("en-US")}`);
              addToast("success", "Version saved.");
              setOpen(false);
            }}
            className="menu-item text-[var(--cut)]"
          >
            <Save size={14} /> Save current version
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
            <RotateCcw size={14} /> Restore first cut
          </button>
          {versions.length > 0 && <div className="my-1 h-px bg-white/[0.07]" />}
          {versions.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] leading-snug text-[#65717f]">
              No saved versions yet.
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
                  {new Date(version.createdAt).toLocaleString("en-US")}
                </p>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => deleteVersion(version.id)}
                className="rounded p-1 text-[#59636f] opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                title="Delete version"
                aria-label={`Delete ${version.name}`}
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
