"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function EditorError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("CaptionCut editor error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ink)] px-5 text-[var(--text)]">
      <section
        role="alert"
        className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#10161d] p-7 text-center shadow-2xl shadow-black/50"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300 ring-1 ring-rose-400/20">
          <AlertTriangle size={21} />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.035em]">
          Editorn stannade oväntat
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#82909c]">
          Projektet är fortfarande sparat. Försök öppna arbetsytan igen.
        </p>
        <button
          type="button"
          onClick={unstable_retry}
          className="primary-compact mt-6 h-11 w-full text-xs"
        >
          <RefreshCw size={14} /> Öppna editorn igen
        </button>
        {error.digest && (
          <p className="mt-4 font-mono text-[9px] text-[#53606c]">
            Felkod {error.digest}
          </p>
        )}
      </section>
    </main>
  );
}
