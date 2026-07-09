"use client";

import { useState } from "react";
import CaptionsPanel from "./CaptionsPanel";
import StylePanel from "./StylePanel";

/** Right sidebar: Captions / Style tabs. */
export default function RightPanel() {
  const [tab, setTab] = useState<"captions" | "style">("captions");

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-white/8">
        {(
          [
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
        {tab === "captions" ? <CaptionsPanel /> : <StylePanel />}
      </div>
    </div>
  );
}
