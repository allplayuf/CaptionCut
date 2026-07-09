"use client";

import { useEffect, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { buildProjectSnapshot, useEditorStore } from "@/hooks/useEditorStore";
import Header from "@/components/Header";
import MediaPanel from "@/components/MediaPanel";
import VideoPreview from "@/components/VideoPreview";
import RightPanel from "@/components/RightPanel";
import Timeline from "@/components/Timeline";
import ExportModal from "@/components/ExportModal";
import Toasts from "@/components/Toasts";

export default function EditorPage() {
  const [exportOpen, setExportOpen] = useState(false);
  const revision = useEditorStore((s) => s.revision);

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
      }
    })();
  }, []);

  // Debounced autosave whenever project content changes.
  useEffect(() => {
    if (revision === 0) return;
    const timer = setTimeout(() => {
      const snapshot = buildProjectSnapshot(useEditorStore.getState());
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
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
      if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.isPlaying);
      } else if (e.key === "s" || e.key === "S") {
        s.splitAtPlayhead();
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedClipId) {
        s.deleteClip(s.selectedClipId);
      } else if (e.key === "ArrowLeft") {
        s.setPlaying(false);
        s.setCurrentTime(s.currentTime - (e.shiftKey ? 5 : 1));
      } else if (e.key === "ArrowRight") {
        s.setPlaying(false);
        s.setCurrentTime(s.currentTime + (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#08080d] text-zinc-200">
      <Header onExport={() => setExportOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-white/8 bg-[#0d0d14]">
          <MediaPanel />
        </aside>

        <main className="min-w-0 flex-1 p-4">
          <VideoPreview />
        </main>

        <aside className="w-80 shrink-0 border-l border-white/8 bg-[#0d0d14]">
          <RightPanel />
        </aside>
      </div>

      <div className="h-44 shrink-0">
        <Timeline />
      </div>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <Toasts />
    </div>
  );
}
