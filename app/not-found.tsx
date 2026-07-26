import Link from "next/link";
import { ArrowLeft, Film } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--ink)] px-5 text-[var(--text)]">
      <section className="surface-panel w-full max-w-sm p-7 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-[var(--cut)] ring-1 ring-white/[0.08]">
          <Film size={19} />
        </span>
        <p className="panel-eyebrow mt-5 text-[#707782]">404</p>
        <h1 className="mt-2 text-xl font-semibold tracking-[-0.035em]">
          This frame doesn’t exist.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#7f8791]">
          The link may be outdated or the page may have moved.
        </p>
        <Link href="/" className="primary-compact mt-6 h-11 w-full text-xs">
          <ArrowLeft size={14} /> Back to the editor
        </Link>
      </section>
    </main>
  );
}
