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
import { GripHorizontal, GripVertical } from "lucide-react";

const DEFAULT_SIDEBAR_WIDTH = 408;
const DEFAULT_TIMELINE_HEIGHT = 310;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function EditorPage() {
  const [exportOpen, setExportOpen] = useState(false);
  const revision = useEditorStore((s) => s.revision);
  const projectId = useEditorStore((s) => s.projectId);
  const mediaCount = useEditorStore((s) => s.media.length);
  /** Wait for the resume fetch before deciding to show the start screen. */
  const [booted, setBooted] = useState(false);
  /** Project ids whose start screen the user skipped this session. */
  const [skippedStartId, setSkippedStartId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  // Personal workspace sizing persists on this device.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const savedSidebar = Number(localStorage.getItem("captioncut.sidebarWidth"));
      const savedTimeline = Number(localStorage.getItem("captioncut.timelineHeight"));
      const savedCollapsed = localStorage.getItem("captioncut.sidebarCollapsed");
      if (Number.isFinite(savedSidebar) && savedSidebar > 0) {
        setSidebarWidth(clamp(savedSidebar, 320, Math.min(620, window.innerWidth - 360)));
      }
      if (Number.isFinite(savedTimeline) && savedTimeline > 0) {
        setTimelineHeight(clamp(savedTimeline, 220, window.innerHeight - 180));
      }
      setSidebarCollapsed(savedCollapsed === "true");
      setLayoutReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!layoutReady) return;
    localStorage.setItem("captioncut.sidebarWidth", String(Math.round(sidebarWidth)));
  }, [layoutReady, sidebarWidth]);

  useEffect(() => {
    if (!layoutReady) return;
    localStorage.setItem("captioncut.timelineHeight", String(Math.round(timelineHeight)));
  }, [layoutReady, timelineHeight]);

  useEffect(() => {
    if (!layoutReady) return;
    localStorage.setItem("captioncut.sidebarCollapsed", String(sidebarCollapsed));
  }, [layoutReady, sidebarCollapsed]);

  const beginSidebarResize = (event: React.PointerEvent) => {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("is-resizing");
    const move = (moveEvent: PointerEvent) =>
      setSidebarWidth(
        clamp(startWidth + moveEvent.clientX - startX, 320, Math.min(620, window.innerWidth - 360))
      );
    const up = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginTimelineResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    document.body.classList.add("is-resizing");
    const move = (moveEvent: PointerEvent) =>
      setTimelineHeight(
        clamp(startHeight - (moveEvent.clientY - startY), 220, window.innerHeight - 180)
      );
    const up = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
    <div className="captioncut-shell relative flex h-screen flex-col bg-[var(--ink)] text-[var(--text)]">
      <Header onExport={() => setExportOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        />

        {!sidebarCollapsed && (
          <button
            type="button"
            role="separator"
            aria-label="Ändra verktygspanelens bredd"
            aria-orientation="vertical"
            className="workspace-resizer workspace-resizer-vertical"
            onPointerDown={beginSidebarResize}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setSidebarWidth((value) => clamp(value - 16, 320, 620));
              if (event.key === "ArrowRight") setSidebarWidth((value) => clamp(value + 16, 320, 620));
            }}
            title="Dra för större eller mindre verktyg · dubbelklicka för standard"
          >
            <GripVertical size={12} />
          </button>
        )}

        <main className="preview-stage min-w-0 flex-1 px-4 pb-3 pt-2">
          <VideoPreview />
        </main>
      </div>

      <button
        type="button"
        role="separator"
        aria-label="Ändra tidslinjens höjd"
        aria-orientation="horizontal"
        className="workspace-resizer workspace-resizer-horizontal"
        onPointerDown={beginTimelineResize}
        onDoubleClick={() => setTimelineHeight(DEFAULT_TIMELINE_HEIGHT)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            setTimelineHeight((value) => clamp(value + 20, 220, window.innerHeight - 180));
          }
          if (event.key === "ArrowDown") {
            setTimelineHeight((value) => clamp(value - 20, 220, window.innerHeight - 180));
          }
        }}
        title="Dra upp för större tidslinje · dubbelklicka för standard"
      >
        <GripHorizontal size={14} />
      </button>
      <div className="shrink-0" style={{ height: timelineHeight }}>
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
