"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { isSecondaryTool, type EditorTool } from "@/lib/ui/editorTools";
import {
  Aperture,
  Captions,
  Clapperboard,
  FolderOpen,
  LayoutTemplate,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  SlidersHorizontal,
  SwatchBook,
  Wand2,
} from "lucide-react";
import MontagePanel from "./MontagePanel";

const AIPanel = dynamic(() => import("./AIPanel"), { loading: PanelLoading });
const CaptionsPanel = dynamic(() => import("./CaptionsPanel"), { loading: PanelLoading });
const CutPanel = dynamic(() => import("./CutPanel"), { loading: PanelLoading });
const EffectsPanel = dynamic(() => import("./EffectsPanel"), { loading: PanelLoading });
const InspectorPanel = dynamic(() => import("./InspectorPanel"), { loading: PanelLoading });
const LibraryPanel = dynamic(() => import("./LibraryPanel"), { loading: PanelLoading });
const SequenceBuilderPanel = dynamic(() => import("./SequenceBuilderPanel"), {
  loading: PanelLoading,
});
const StylePanel = dynamic(() => import("./StylePanel"), { loading: PanelLoading });

/**
 * The rail, in the order a video actually gets made: build the cut, then feed
 * it footage, then caption it, then style it, then garnish it.
 */
const PRIMARY_TOOLS: Array<{
  id: EditorTool;
  label: string;
  icon: typeof Scissors;
}> = [
  { id: "montage", label: "Montage", icon: Wand2 },
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "style", label: "Style", icon: SwatchBook },
  { id: "effects", label: "Effects", icon: Aperture },
];

export default function WorkspaceSidebar({
  width = 408,
  collapsed = false,
  onToggleCollapsed,
  activeTool,
  onToolChange,
}: {
  width?: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  activeTool?: EditorTool;
  onToolChange?: (tool: EditorTool) => void;
}) {
  const [localTool, setLocalTool] = useState<EditorTool>("montage");
  const tool = activeTool ?? localTool;
  const setTool = onToolChange ?? setLocalTool;
  const pickTool = (nextTool: EditorTool) => {
    setTool(nextTool);
    if (collapsed) onToggleCollapsed?.();
  };

  return (
    <aside
      className="workspace-sidebar flex min-h-0 shrink-0 border-r border-white/[0.07] bg-[#0c0e11] transition-[width] duration-150"
      data-collapsed={collapsed}
      style={{ width: collapsed ? 66 : width }}
    >
      <nav
        className="workspace-tool-rail flex w-[66px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] px-1.5 py-2"
        aria-label="Editing tools"
      >
        <div className="space-y-1">
          {PRIMARY_TOOLS.map(({ id, label, icon: Icon }) => (
            <RailButton
              key={id}
              active={tool === id}
              icon={<Icon size={17} />}
              label={label}
              onClick={() => pickTool(id)}
            />
          ))}
        </div>
        <div className="mt-auto space-y-1">
          <RailButton
            active={tool === "more" || isSecondaryTool(tool)}
            icon={<MoreHorizontal size={18} />}
            label="More"
            onClick={() => pickTool("more")}
          />
          {onToggleCollapsed && (
            <RailButton
              active={false}
              icon={collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              label={collapsed ? "Open" : "Hide"}
              onClick={onToggleCollapsed}
            />
          )}
        </div>
      </nav>

      {!collapsed && (
        <div className="workspace-panel-shell flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="workspace-tool-panel min-h-0 min-w-0 flex-1">
            {tool === "montage" && <MontagePanel onOpenAdvanced={() => setTool("more")} />}
            {tool === "media" && <LibraryPanel onOpenSmart={() => setTool("montage")} />}
            {tool === "captions" && <CaptionsPanel />}
            {tool === "style" && <StylePanel />}
            {tool === "effects" && <EffectsPanel />}
            {tool === "cut" && <CutPanel />}
            {tool === "adjust" && <InspectorPanel />}
            {tool === "smart" && <AIPanel />}
            {tool === "sequence" && <SequenceBuilderPanel />}
            {tool === "more" && <MoreTools onPick={setTool} />}
          </div>
        </div>
      )}
    </aside>
  );
}

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[#101216]" role="status">
      <span className="flex items-center gap-2 text-[11px] font-semibold text-[#747d87]">
        <span className="h-3 w-3 animate-spin rounded-full border border-white/15 border-t-[var(--cut)]" />
        Opening tool…
      </span>
    </div>
  );
}

function RailButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-pressed={active}
      className={`relative flex w-full flex-col items-center gap-1 rounded-md py-2 text-[9px] font-semibold transition ${
        active
          ? "bg-white/[0.055] text-[#f2c38a]"
          : "text-[#69717b] hover:bg-white/[0.035] hover:text-[#b9bec4]"
      }`}
    >
      {active && (
        <span className="absolute -left-1.5 top-2 h-6 w-0.5 rounded-r-full bg-[var(--cut)]" />
      )}
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MoreTools({ onPick }: { onPick: (tool: EditorTool) => void }) {
  const tools = [
    {
      id: "cut" as const,
      icon: Scissors,
      title: "Cut by hand",
      text: "Trim pauses and filler, or edit against the transcript.",
      tone: "text-[var(--cut)] bg-[var(--cut)]/10",
    },
    {
      id: "adjust" as const,
      icon: SlidersHorizontal,
      title: "Inspector",
      text: "Transform, audio, crop, and clip settings.",
      tone: "text-[#c49af6] bg-[#c49af6]/10",
    },
    {
      id: "smart" as const,
      icon: Clapperboard,
      title: "Interviews & first cut",
      text: "Speech-led edits with B-roll, and per-clip source roles.",
      tone: "text-[#7db8ff] bg-[#7db8ff]/10",
    },
    {
      id: "sequence" as const,
      icon: LayoutTemplate,
      title: "Sequence",
      text: "Arrange hooks, answers, and supporting shots by hand.",
      tone: "text-[#9ce5c3] bg-[#9ce5c3]/10",
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#101216] p-4">
      <p className="panel-eyebrow text-[#6b737d]">More tools</p>
      <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[#edf0ef]">
        Take manual control.
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[#7b838d]">
        The montage handles pacing and effects for you. Reach for these when you
        want to place every cut yourself.
      </p>

      <div className="mt-5 space-y-2">
        {tools.map(({ id, icon: Icon, title, text, tone }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="group flex w-full items-start gap-3 rounded-lg bg-white/[0.025] p-3.5 text-left ring-1 ring-white/[0.07] transition hover:bg-white/[0.05] hover:ring-white/[0.12]"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}>
              <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[#e0e3e3]">{title}</span>
              <span className="mt-1 block text-[10px] leading-relaxed text-[#737b85]">{text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
