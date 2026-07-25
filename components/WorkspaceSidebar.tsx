"use client";

import { useState } from "react";
import {
  Captions,
  FolderOpen,
  LayoutTemplate,
  MoreHorizontal,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
} from "lucide-react";
import AIPanel from "./AIPanel";
import CaptionsPanel from "./CaptionsPanel";
import CutPanel from "./CutPanel";
import InspectorPanel from "./InspectorPanel";
import MediaPanel from "./MediaPanel";
import SequenceBuilderPanel from "./SequenceBuilderPanel";
import StylePanel from "./StylePanel";

type Tool =
  | "cut"
  | "captions"
  | "media"
  | "adjust"
  | "more"
  | "smart"
  | "sequence"
  | "style";

const PRIMARY_TOOLS: Array<{
  id: Tool;
  label: string;
  icon: typeof Scissors;
}> = [
  { id: "cut", label: "Klipp", icon: Scissors },
  { id: "captions", label: "Text", icon: Captions },
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "adjust", label: "Justera", icon: SlidersHorizontal },
];

export default function WorkspaceSidebar() {
  const [tool, setTool] = useState<Tool>("cut");

  return (
    <aside className="flex min-h-0 w-[388px] max-w-[48vw] shrink-0 border-r border-white/[0.07] bg-[#0b0e13]">
      <nav
        className="flex w-[68px] shrink-0 flex-col border-r border-white/[0.07] px-2 py-3"
        aria-label="Redigeringsverktyg"
      >
        <div className="space-y-1">
          {PRIMARY_TOOLS.map(({ id, label, icon: Icon }) => (
            <RailButton
              key={id}
              active={tool === id}
              icon={<Icon size={17} />}
              label={label}
              onClick={() => setTool(id)}
            />
          ))}
        </div>
        <div className="mt-auto">
          <RailButton
            active={["more", "smart", "sequence", "style"].includes(tool)}
            icon={<MoreHorizontal size={18} />}
            label="Mer"
            onClick={() => setTool("more")}
          />
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <Panel active={tool === "cut"}>
          <CutPanel />
        </Panel>
        <Panel active={tool === "captions"}>
          <CaptionsPanel />
        </Panel>
        <Panel active={tool === "media"}>
          <MediaPanel />
        </Panel>
        <Panel active={tool === "adjust"}>
          <InspectorPanel />
        </Panel>
        <Panel active={tool === "smart"}>
          <AIPanel />
        </Panel>
        <Panel active={tool === "sequence"}>
          <SequenceBuilderPanel />
        </Panel>
        <Panel active={tool === "style"}>
          <StylePanel />
        </Panel>
        <Panel active={tool === "more"}>
          <MoreTools onPick={setTool} />
        </Panel>
      </div>
    </aside>
  );
}

function Panel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? "h-full" : "hidden"}>{children}</div>;
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
      className={`relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[9px] font-semibold transition ${
        active
          ? "bg-[#ffb45b]/10 text-[#ffc477]"
          : "text-[#65717f] hover:bg-white/[0.04] hover:text-[#b8c1cb]"
      }`}
    >
      {active && (
        <span className="absolute -left-2 top-3 h-6 w-[3px] rounded-r-full bg-[#ffb45b]" />
      )}
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MoreTools({ onPick }: { onPick: (tool: Tool) => void }) {
  const tools = [
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
