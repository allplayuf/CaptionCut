"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clapperboard,
  CloudUpload,
  Download,
  FilePlus2,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";

export default function Header({ onExport }: { onExport: () => void }) {
  const projectName = useEditorStore((s) => s.projectName);
  const projectId = useEditorStore((s) => s.projectId);
  const tracks = useEditorStore((s) => s.tracks);
  const saveState = useEditorStore((s) => s.saveState);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const resetToNewProject = useEditorStore((s) => s.resetToNewProject);
  const loadProject = useEditorStore((s) => s.loadProject);
  const addToast = useEditorStore((s) => s.addToast);

  const [menuOpen, setMenuOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  /** Project pending delete confirmation (second click confirms). */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((list: ProjectSummary[]) => Array.isArray(list) && setProjects(list))
      .catch(() => {});
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
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
      addToast("error", "Could not open that project.");
    }
  };

  const removeProject = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
    setProjects((list) => list.filter((p) => p.id !== id));
    if (id === projectId) resetToNewProject();
    addToast("info", "Project deleted.");
  };

  return (
    <header className="flex items-center gap-3 border-b border-white/8 bg-[#0d0d14] px-4 py-2">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Clapperboard size={15} />
        </div>
        <span className="bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-sm font-extrabold tracking-tight text-transparent">
          CaptionCut
        </span>
      </div>

      <div className="mx-2 h-5 w-px bg-white/10" />

      <input
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="w-52 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-zinc-200 outline-none transition hover:border-white/10 focus:border-violet-400"
        placeholder="Project name"
      />

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/8 hover:text-zinc-200"
        >
          Projects <ChevronDown size={13} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-white/10 bg-[#16161f] p-1.5 shadow-2xl shadow-black/60">
            <button
              onClick={() => {
                resetToNewProject();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-violet-300 transition hover:bg-white/8"
            >
              <FilePlus2 size={14} /> New project
            </button>
            {projects.length > 0 && <div className="my-1 h-px bg-white/8" />}
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition hover:bg-white/8"
              >
                <button
                  onClick={() => void openProject(p.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-medium text-zinc-200">
                    {p.name}
                    {p.id === projectId && (
                      <span className="ml-1.5 text-[9px] text-fuchsia-400">current</span>
                    )}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} ·{" "}
                    {new Date(p.updatedAt).toLocaleString()}
                  </p>
                </button>
                <button
                  onClick={() => void removeProject(p.id)}
                  onMouseLeave={() => confirmDeleteId === p.id && setConfirmDeleteId(null)}
                  className={`flex items-center gap-1 rounded p-1 text-zinc-600 transition hover:bg-rose-500/20 hover:text-rose-400 ${
                    confirmDeleteId === p.id
                      ? "bg-rose-500/20 px-1.5 text-[9px] font-bold text-rose-300 opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={confirmDeleteId === p.id ? "Click again to permanently delete" : "Delete project"}
                >
                  <Trash2 size={12} />
                  {confirmDeleteId === p.id && "Sure?"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/8 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/8 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Redo2 size={14} />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition ${
            saveState === "error"
              ? "bg-rose-500/10 text-rose-300"
              : saveState === "saving"
                ? "text-zinc-500"
                : "text-zinc-600"
          }`}
          title={
            saveState === "error"
              ? "Autosave failed — your latest changes may not be on disk"
              : "Everything autosaves to your projects folder"
          }
        >
          {saveState === "saving" ? (
            <>
              <CloudUpload size={11} className="animate-pulse" /> Saving…
            </>
          ) : saveState === "error" ? (
            <>
              <AlertTriangle size={11} /> Save failed
            </>
          ) : (
            <>
              <Check size={11} /> Saved
            </>
          )}
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[10px] text-zinc-500 ring-1 ring-white/10">
          9:16 · 1080×1920
        </span>
        <button
          onClick={onExport}
          disabled={tracksDuration(tracks) <= 0}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-1.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          <Download size={15} /> Export
        </button>
      </div>
    </header>
  );
}
