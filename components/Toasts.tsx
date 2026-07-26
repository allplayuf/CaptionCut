"use client";

import { useEditorStore } from "@/hooks/useEditorStore";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const ICONS = {
  info: <Info size={15} className="text-sky-400" />,
  success: <CheckCircle2 size={15} className="text-emerald-400" />,
  error: <AlertTriangle size={15} className="text-rose-400" />,
};

export default function Toasts() {
  const toasts = useEditorStore((s) => s.toasts);
  const dismissToast = useEditorStore((s) => s.dismissToast);

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-atomic="true"
          className="pointer-events-auto flex items-start gap-2 rounded-xl border border-white/10 bg-[#1a1a24]/95 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur"
        >
          <span className="mt-0.5 shrink-0">{ICONS[toast.kind]}</span>
          <p className="flex-1 text-xs leading-snug text-zinc-200">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-300"
            aria-label="Stäng meddelandet"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
