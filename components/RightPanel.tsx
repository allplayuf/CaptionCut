"use client";

import { useState } from "react";
import { useEditorStore } from "@/hooks/useEditorStore";
import AIPanel from "./AIPanel";
import CaptionsPanel from "./CaptionsPanel";
import InspectorPanel from "./InspectorPanel";
import StylePanel from "./StylePanel";

type Tab = "ai" | "inspect" | "captions" | "style";

/** Right sidebar: AI Edit / Inspector / Captions / Style tabs. Selecting a
 *  clip or caption anywhere jumps to the Inspector so its settings are one
 *  glance away (like Premiere's Essential panel). */
export default function RightPanel() {
  const [tab, setTab] = useState<Tab>("ai");
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);

  // Jump to the Inspector whenever a new clip/caption is selected
  // (state adjusted during render — no effect, no extra paint).
  const selectionKey = selectedClipId ?? selectedCaptionId;
  const [lastSelection, setLastSelection] = useState(selectionKey);
  if (selectionKey !== lastSelection) {
    setLastSelection(selectionKey);
    if (selectionKey) setTab("inspect");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-white/8">
        {(
          [
            ["ai", "AI Edit"],
            ["inspect", "Inspector"],
            ["captions", "Captions"],
            ["style", "Style"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 py-2.5 text-xs font-semibold transition ${
              tab === value
                ? "border-b-2 border-fuchsia-400 text-zinc-100"
                : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {/* Keep panels mounted while switching tabs. AI drafts, source roles,
            caption glossary and review filters are working state — changing
            tabs must not silently throw them away. */}
        <div className={tab === "ai" ? "h-full" : "hidden"}>
          <AIPanel />
        </div>
        <div className={tab === "inspect" ? "h-full" : "hidden"}>
          <InspectorPanel />
        </div>
        <div className={tab === "captions" ? "h-full" : "hidden"}>
          <CaptionsPanel />
        </div>
        <div className={tab === "style" ? "h-full" : "hidden"}>
          <StylePanel />
        </div>
      </div>
    </div>
  );
}
