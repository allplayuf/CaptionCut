"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { EditorTool } from "@/lib/ui/editorTools";
import {
  Captions,
  FolderOpen,
  LayoutTemplate,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
  WandSparkles,
} from "lucide-react";
import CutPanel from "./CutPanel";

const AIPanel = dynamic(() => import("./AIPanel"), { loading: PanelLoading });
const CaptionsPanel = dynamic(() => import("./CaptionsPanel"), { loading: PanelLoading });
const EffectsPanel = dynamic(() => import("./EffectsPanel"), { loading: PanelLoading });
const InspectorPanel = dynamic(() => import("./InspectorPanel"), { loading: PanelLoading });
const LibraryPanel = dynamic(() => import("./LibraryPanel"), { loading: PanelLoading });
const SequenceBuilderPanel = dynamic(() => import("./SequenceBuilderPanel"), {
  loading: PanelLoading,
});
const StylePanel = dynamic(() => import("./StylePanel"), { loading: PanelLoading });

const PRIMARY_TOOLS: Array<{
  id: EditorTool;
  label: string;
  icon: typeof Scissors;
}> = [
  { id: "cut", label: "Klipp", icon: Scissors },
  { id: "smart", label: "Auto", icon: Sparkles },
  { id: "captions", label: "Text", icon: Captions },
  { id: "media", label: "Bibliotek", icon: FolderOpen },
  { id: "effects", label: "Effekter", icon: WandSparkles },
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
  const [localTool, setLocalTool] = useState<EditorTool>("cut");
  const tool = activeTool ?? localTool;
  const setTool = onToolChange ?? setLocalTool;
  const pickTool = (nextTool: EditorTool) => {
    setTool(nextTool);
    if (collapsed) onToggleCollapsed?.();
  };

  return (
    <aside
      className="workspace-sidebar flex min-h-0 shrink-0 border-r border-white/[0.07] bg-[#0a0e13] shadow-[12px_0_35px_rgba(0,0,0,.08)] transition-[width] duration-150"
      data-collapsed={collapsed}
      style={{ width: collapsed ? 62 : width }}
    >
      <nav
        className="workspace-tool-rail flex w-[62px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] px-1.5 py-2"
        aria-label="Redigeringsverktyg"
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
            active={["more", "adjust", "sequence", "style"].includes(tool)}
            icon={<MoreHorizontal size={18} />}
            label="Mer"
            onClick={() => pickTool("more")}
          />
          {onToggleCollapsed && (
            <RailButton
              active={false}
              icon={collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              label={collapsed ? "Öppna" : "Dölj"}
              onClick={onToggleCollapsed}
            />
          )}
        </div>
      </nav>

      {!collapsed && <div className="workspace-tool-panel min-w-0 flex-1">
        {tool === "cut" && <CutPanel />}
        {tool === "captions" && <CaptionsPanel />}
        {tool === "media" && <LibraryPanel onOpenSmart={() => setTool("smart")} />}
        {tool === "effects" && <EffectsPanel />}
        {tool === "adjust" && <InspectorPanel />}
        {tool === "smart" && <AIPanel />}
        {tool === "sequence" && <SequenceBuilderPanel />}
        {tool === "style" && <StylePanel />}
        {tool === "more" && <MoreTools onPick={setTool} />}
      </div>}
    </aside>
  );
}

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[#10141b]" role="status">
      <span className="flex items-center gap-2 text-[10px] font-semibold text-[#71808d]">
        <span className="h-3 w-3 animate-spin rounded-full border border-white/15 border-t-[var(--cut)]" />
        Öppnar verktyget…
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
      className={`relative flex w-full flex-col items-center gap-1 rounded-xl py-1.5 text-[9px] font-semibold transition ${
        active
          ? "bg-[var(--cut)]/10 text-[#f6c98f]"
          : "text-[#65717f] hover:bg-white/[0.04] hover:text-[#b8c1cb]"
      }`}
    >
      {active && (
        <span className="absolute -left-2 top-2 h-5 w-[3px] rounded-r-full bg-[var(--cut)] shadow-[0_0_12px_rgba(242,182,109,.35)]" />
      )}
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MoreTools({ onPick }: { onPick: (tool: EditorTool) => void }) {
  const tools = [
    {
      id: "adjust" as const,
      icon: SlidersHorizontal,
      title: "Justera",
      text: "Storlek, ljud, position och inställningar för det valda klippet.",
      tone: "text-[#c49af6] bg-[#c49af6]/10",
    },
    {
      id: "smart" as const,
      icon: Sparkles,
      title: "Smart redigering",
      text: "Bygg ett helt redigeringsförslag från materialet.",
      tone: "text-[#7db8ff] bg-[#7db8ff]/10",
    },
    {
      id: "sequence" as const,
      icon: LayoutTemplate,
      title: "Bygg sekvens",
      text: "Ordna hook, svar och klipp i en tydlig struktur.",
      tone: "text-[#ffb45b] bg-[#ffb45b]/10",
    },
    {
      id: "style" as const,
      icon: SwatchBook,
      title: "Stil & grafik",
      text: "Färg, textlager och visuellt uttryck.",
      tone: "text-[#9ce5c3] bg-[#9ce5c3]/10",
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#10141b] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6b7684]">
        Fler verktyg
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-[#edf1f5]">
        När grundklippet sitter.
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-[#7b8694]">
        De här verktygen finns kvar, men stör inte det dagliga klipparbetet.
      </p>

      <div className="mt-5 space-y-2">
        {tools.map(({ id, icon: Icon, title, text, tone }) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            className="group flex w-full items-start gap-3 rounded-2xl bg-white/[0.035] p-3.5 text-left ring-1 ring-white/[0.07] transition hover:bg-white/[0.06] hover:ring-white/[0.12]"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[#e0e6ec]">{title}</span>
              <span className="mt-1 block text-[10px] leading-relaxed text-[#737f8d]">{text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
