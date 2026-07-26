"use client";

import { useEffect, useState } from "react";
import type { Project, ProjectSummary } from "@/types";
import { stepFrame, useEditorStore } from "@/hooks/useEditorStore";
import { tracksDuration } from "@/lib/timeline/tracks";
import { preloadLocalCaptionModel } from "@/lib/transcription/browserWhisper";
import { useProjectAutosave } from "@/hooks/useProjectAutosave";
import Header from "@/components/Header";
import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import VideoPreview from "@/components/VideoPreview";
import StartScreen from "@/components/StartScreen";
import Timeline from "@/components/Timeline";
import ExportModal from "@/components/ExportModal";
import Toasts from "@/components/Toasts";
import { CommandPalette, HelpDrawer } from "@/components/WorkspaceOverlays";
import type { EditorTool } from "@/lib/ui/editorTools";
import { GripHorizontal, GripVertical } from "lucide-react";

const MIN_SIDEBAR_WIDTH = 344;
const DEFAULT_SIDEBAR_WIDTH = 456;
const COMFORTABLE_SIDEBAR_WIDTH = 520;
const MAX_SIDEBAR_WIDTH = 760;
const MIN_TIMELINE_HEIGHT = 150;
const DEFAULT_TIMELINE_HEIGHT = 238;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function maxSidebarWidth() {
  if (typeof window === "undefined") return MAX_SIDEBAR_WIDTH;
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 360)
  );
}

export default function EditorPage() {
  const [exportOpen, setExportOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>("cut");
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
  const retryAutosave = useProjectAutosave({ projectId, revision, enabled: booted });

  const selectTool = (tool: EditorTool) => {
    setActiveTool(tool);
    if (tool === "captions") {
      setSidebarWidth((current) =>
        Math.max(current, Math.min(COMFORTABLE_SIDEBAR_WIDTH, maxSidebarWidth()))
      );
    }
  };

  const openTool = (tool: EditorTool) => {
    selectTool(tool);
    setSidebarCollapsed(false);
  };

  // Personal workspace sizing persists on this device.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const savedSidebar = Number(localStorage.getItem("captioncut.sidebarWidth"));
      const savedTimeline = Number(localStorage.getItem("captioncut.timelineHeight"));
      const savedCollapsed = localStorage.getItem("captioncut.sidebarCollapsed");
      if (Number.isFinite(savedSidebar) && savedSidebar > 0) {
        setSidebarWidth(clamp(savedSidebar, MIN_SIDEBAR_WIDTH, maxSidebarWidth()));
      }
      if (Number.isFinite(savedTimeline) && savedTimeline > 0) {
        setTimelineHeight(
          clamp(savedTimeline, MIN_TIMELINE_HEIGHT, window.innerHeight - 180)
        );
      }
      setSidebarCollapsed(
        window.innerWidth < 768 ||
          savedCollapsed === "true" ||
          (savedCollapsed === null && window.innerWidth < 980)
      );
      setLayoutReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // A tools panel that was open on desktop must never crush the phone preview
  // after a resize or orientation change.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    const collapseOnPhone = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setSidebarCollapsed(true);
    };
    collapseOnPhone(phone);
    phone.addEventListener("change", collapseOnPhone);
    return () => phone.removeEventListener("change", collapseOnPhone);
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
    if (window.matchMedia("(max-width: 767px)").matches) return;
    localStorage.setItem("captioncut.sidebarCollapsed", String(sidebarCollapsed));
  }, [layoutReady, sidebarCollapsed]);

  // Once a user imports media, quietly cache the free local caption model.
  useEffect(() => {
    if (mediaCount === 0) return;
    const start = () => void preloadLocalCaptionModel("fast").catch(() => {});
    const idle = window.requestIdleCallback?.(start, { timeout: 2500 });
    const timer = idle === undefined ? window.setTimeout(start, 1200) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [mediaCount]);

  const beginSidebarResize = (event: React.PointerEvent) => {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("is-resizing");
    const move = (moveEvent: PointerEvent) =>
      setSidebarWidth(
        clamp(
          startWidth + moveEvent.clientX - startX,
          MIN_SIDEBAR_WIDTH,
          maxSidebarWidth()
        )
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
        clamp(
          startHeight - (moveEvent.clientY - startY),
          MIN_TIMELINE_HEIGHT,
          window.innerHeight - 180
        )
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

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (mod && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setExportOpen(true);
        return;
      }
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        Boolean(target.closest("button, a, [role='slider'], [role='menuitem']"))
      ) {
        return;
      }
      if (e.key === "?" && !mod && !e.altKey) {
        setHelpOpen(true);
        return;
      }
      const s = useEditorStore.getState();

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
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        s.splitAtPlayhead();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (s.selectedClipIds.length > 0 || s.selectedClipId)
      ) {
        e.preventDefault();
        s.deleteSelectedClips();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.altKey && (s.selectedClipIds.length > 0 || s.selectedClipId)) {
          // Alt = nudge selected overlay/audio clips (1 frame; +Shift = 10).
          e.preventDefault();
          s.nudgeSelectedClips(dir * (e.shiftKey ? 10 / 30 : 1 / 30));
        } else {
          // Plain arrows step one frame; Shift crosses ten frames quickly.
          e.preventDefault();
          stepFrame(dir as -1 | 1, e.shiftKey ? 10 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="captioncut-shell relative flex h-screen flex-col bg-[var(--ink)] text-[var(--text)]">
      <Header
        onExport={() => setExportOpen(true)}
        onCommand={() => setCommandOpen(true)}
        onHelp={() => setHelpOpen(true)}
        onRetrySave={retryAutosave}
      />

      <div className="workspace-body flex min-h-0 flex-1">
        <WorkspaceSidebar
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          activeTool={activeTool}
          onToolChange={selectTool}
        />

        {!sidebarCollapsed && (
          <button
            type="button"
            role="separator"
            aria-label="Resize tools panel"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={Math.round(sidebarWidth)}
            className="workspace-resizer workspace-resizer-vertical"
            onPointerDown={beginSidebarResize}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setSidebarWidth((value) =>
                  clamp(value - 24, MIN_SIDEBAR_WIDTH, maxSidebarWidth())
                );
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setSidebarWidth((value) =>
                  clamp(value + 24, MIN_SIDEBAR_WIDTH, maxSidebarWidth())
                );
              }
            }}
            title="Drag to resize · double-click to reset"
          >
            <GripVertical size={12} />
          </button>
        )}

        <main className="preview-stage min-w-0 flex-1 px-4 pb-3 pt-2">
          <VideoPreview onOpenLibrary={() => openTool("media")} />
        </main>
      </div>

      <button
        type="button"
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        className="workspace-resizer workspace-resizer-horizontal"
        onPointerDown={beginTimelineResize}
        onDoubleClick={() => setTimelineHeight(DEFAULT_TIMELINE_HEIGHT)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            setTimelineHeight((value) =>
              clamp(value + 20, MIN_TIMELINE_HEIGHT, window.innerHeight - 180)
            );
          }
          if (event.key === "ArrowDown") {
            setTimelineHeight((value) =>
              clamp(value - 20, MIN_TIMELINE_HEIGHT, window.innerHeight - 180)
            );
          }
        }}
        title="Drag to resize · double-click to reset"
      >
        <GripHorizontal size={14} />
      </button>
      <div className="timeline-region shrink-0" style={{ height: timelineHeight }}>
        <Timeline />
      </div>

      {booted && mediaCount === 0 && skippedStartId !== projectId && (
        <StartScreen onSkip={() => setSkippedStartId(projectId)} />
      )}

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onOpenTool={openTool}
        onExport={() => setExportOpen(true)}
        onHelp={() => {
          setCommandOpen(false);
          setHelpOpen(true);
        }}
      />
      <HelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenTool={openTool}
        onExport={() => setExportOpen(true)}
      />
      <Toasts />
    </div>
  );
}
