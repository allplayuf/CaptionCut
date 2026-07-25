"use client";

import { useEffect, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { buildProjectSnapshot, stepFrame, useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import Header from "@/components/Header";
import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import VideoPreview from "@/components/VideoPreview";
import StartScreen from "@/components/StartScreen";
import Timeline from "@/components/Timeline";
import ExportModal from "@/components/ExportModal";
import Toasts from "@/components/Toasts";

export default function EditorPage() {
  const [exportOpen, setExportOpen] = useState(false);
  const revision = useEditorStore((s) => s.revision);
  const projectId = useEditorStore((s) => s.projectId);
  const mediaCount = useEditorStore((s) => s.media.length);
  /** Wait for the resume fetch before deciding to show the start screen. */
  const [booted, setBooted] = useState(false);
  /** Project ids whose start screen the user skipped this session. */
  const [skippedStartId, setSkippedStartId] = useState<string | null>(null);

  // Resume the most recently edited project on load.
  useEffect(() => {
    (async () => {
      try {
        const list = (await (await fetch("/api/projects")).json()) as ProjectSummary[];
        if (Array.isArray(list) && list.length > 0) {
          const response = await fetch(`/api/projects/${list[0].id}`);
          if (response.ok) {
            useEditorStore.getState().loadProject((await response.json()) as Project);
          }
        }
      } catch {
        // starting fresh is fine
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  // Debounced autosave whenever project content changes.
  useEffect(() => {
    if (revision === 0) return;
    useEditorStore.getState().setSaveState("saving");
    const timer = setTimeout(() => {
      const snapshot = buildProjectSnapshot(useEditorStore.getState());
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      })
        .then((r) => useEditorStore.getState().setSaveState(r.ok ? "saved" : "error"))
        .catch(() => useEditorStore.getState().setSaveState("error"));
    }, 1200);
    return () => clearTimeout(timer);
  }, [revision]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      const s = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        s.redo();
      } else if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        s.splitAtPlayhead();
      } else if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        if (s.selectedClipIds.length > 0 || s.selectedClipId) s.duplicateSelectedClips();
      } else if (mod && (e.key === "c" || e.key === "C")) {
        // Only hijack copy when a clip is selected (text selection still works).
        if (s.selectedClipId && !window.getSelection()?.toString()) {
          e.preventDefault();
          s.copyClip(s.selectedClipId);
        }
      } else if (mod && (e.key === "v" || e.key === "V")) {
        if (s.clipboard) {
          e.preventDefault();
          s.pasteClip();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        s.setPlaying(false);
        s.setCurrentTime(0);
      } else if (e.key === "End") {
        e.preventDefault();
        s.setPlaying(false);
        s.setCurrentTime(tracksDuration(s.tracks));
      } else if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.isPlaying);
      } else if (e.key === "s" || e.key === "S") {
        s.splitAtPlayhead();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (s.selectedClipIds.length > 0 || s.selectedClipId)
      ) {
        s.deleteSelectedClips();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.altKey && (s.selectedClipIds.length > 0 || s.selectedClipId)) {
          // Alt = nudge selected overlay/audio clips (1 frame; +Shift = 10).
          e.preventDefault();
          s.nudgeSelectedClips(dir * (e.shiftKey ? 10 / 30 : 1 / 30));
        } else {
          // plain = 1s, shift = 1 frame
          stepFrame(dir as -1 | 1, e.shiftKey);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="captioncut-shell relative flex h-screen flex-col bg-[#080b10] text-[#e8edf2]">
      <Header onExport={() => setExportOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar />

        <main className="min-w-0 flex-1 bg-[#080b10] px-4 pb-3 pt-2">
          <VideoPreview />
        </main>
      </div>

      <div className="h-[278px] shrink-0">
        <Timeline />
      </div>

      {booted && mediaCount === 0 && skippedStartId !== projectId && (
        <StartScreen onSkip={() => setSkippedStartId(projectId)} />
      )}

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <Toasts />
    </div>
  );
}
