"use client";

import { useMemo, useRef, useState } from "react";
import type { EditorTool } from "@/lib/ui/editorTools";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { tracksDuration } from "@/lib/timeline/tracks";
import { formatTime } from "@/lib/video/timeline";
import {
  ArrowRight,
  Captions,
  Check,
  CircleHelp,
  Download,
  FolderOpen,
  Keyboard,
  LayoutTemplate,
  PanelLeftClose,
  Play,
  Redo2,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";

interface OverlayActions {
  onOpenTool: (tool: EditorTool) => void;
  onExport: () => void;
}

interface CommandAction {
  id: string;
  label: string;
  detail: string;
  group: "Gå till" | "Redigera" | "Projekt";
  shortcut?: string;
  icon: typeof Search;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenTool,
  onExport,
  onHelp,
}: OverlayActions & {
  open: boolean;
  onClose: () => void;
  onHelp: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tracks = useEditorStore((state) => state.tracks);
  const captions = useEditorStore((state) => state.captions);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const canUndo = useEditorStore((state) => state.past.length > 0);
  const canRedo = useEditorStore((state) => state.future.length > 0);
  const splitAtPlayhead = useEditorStore((state) => state.splitAtPlayhead);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const toggleSafeZones = useEditorStore((state) => state.toggleSafeZones);
  const duration = tracksDuration(tracks);
  const dialogRef = useDialogA11y<HTMLDivElement>({
    open,
    onClose,
    initialFocusRef: inputRef,
  });

  const finish = (action: () => void) => {
    action();
    onClose();
    setQuery("");
    setActiveIndex(0);
  };

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        id: "media",
        label: "Öppna bibliotek",
        detail: "Importera, sortera och välj källmaterial",
        group: "Gå till",
        shortcut: "M",
        icon: FolderOpen,
        run: () => onOpenTool("media"),
      },
      {
        id: "cut",
        label: "Öppna klippverktyg",
        detail: "Pauser, transcript och manuella klipp",
        group: "Gå till",
        shortcut: "C",
        icon: Scissors,
        run: () => onOpenTool("cut"),
      },
      {
        id: "captions",
        label: "Öppna captions",
        detail: `${captions.length} textrader i projektet`,
        group: "Gå till",
        icon: Captions,
        run: () => onOpenTool("captions"),
      },
      {
        id: "effects",
        label: "Öppna effekter",
        detail: "Zoom, rörelse, impact och filmisk finish",
        group: "Gå till",
        icon: WandSparkles,
        run: () => onOpenTool("effects"),
      },
      {
        id: "smart",
        label: "Smart redigering",
        detail: "Bygg eller regenerera ett komplett första klipp",
        group: "Gå till",
        icon: Sparkles,
        run: () => onOpenTool("smart"),
      },
      {
        id: "inspect",
        label: "Justera valt klipp",
        detail: "Timing, hastighet, ljud och position",
        group: "Gå till",
        icon: SlidersHorizontal,
        run: () => onOpenTool("adjust"),
      },
      {
        id: "play",
        label: isPlaying ? "Pausa uppspelning" : "Spela upp",
        detail: duration > 0 ? `${formatTime(duration)} på tidslinjen` : "Tidslinjen är tom",
        group: "Redigera",
        shortcut: "Space",
        icon: Play,
        disabled: duration <= 0,
        run: () => setPlaying(!isPlaying),
      },
      {
        id: "split",
        label: "Dela vid spelhuvudet",
        detail: "Skapar ett rent klipp på nuvarande tid",
        group: "Redigera",
        shortcut: "C",
        icon: Scissors,
        disabled: duration <= 0,
        run: splitAtPlayhead,
      },
      {
        id: "undo",
        label: "Ångra senaste ändringen",
        detail: "Går ett steg tillbaka",
        group: "Redigera",
        shortcut: "Ctrl Z",
        icon: Undo2,
        disabled: !canUndo,
        run: undo,
      },
      {
        id: "redo",
        label: "Gör om",
        detail: "Återställer den ångrade ändringen",
        group: "Redigera",
        shortcut: "Ctrl ⇧ Z",
        icon: Redo2,
        disabled: !canRedo,
        run: redo,
      },
      {
        id: "safe",
        label: "Visa eller dölj säker yta",
        detail: "Kontrollera att text inte täcks i sociala appar",
        group: "Projekt",
        icon: LayoutTemplate,
        run: toggleSafeZones,
      },
      {
        id: "export",
        label: "Exportera video",
        detail: "Välj format och renderingskvalitet",
        group: "Projekt",
        shortcut: "Ctrl E",
        icon: Download,
        disabled: duration <= 0,
        run: onExport,
      },
      {
        id: "help",
        label: "Öppna snabbguiden",
        detail: "Arbetsflöde, status och kortkommandon",
        group: "Projekt",
        shortcut: "?",
        icon: CircleHelp,
        run: onHelp,
      },
    ],
    [
      captions.length,
      canRedo,
      canUndo,
      duration,
      isPlaying,
      onExport,
      onHelp,
      onOpenTool,
      redo,
      setPlaying,
      splitAtPlayhead,
      toggleSafeZones,
      undo,
    ]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    if (!needle) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.detail} ${action.group}`.toLocaleLowerCase("sv-SE").includes(needle)
    );
  }, [actions, query]);

  if (!open) return null;

  const resolvedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Kommandopalett"
        tabIndex={-1}
        className="w-full max-w-[620px] overflow-hidden rounded-[22px] bg-[#11171e] shadow-[0_32px_100px_rgba(0,0,0,.62)] ring-1 ring-white/[0.12]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.075] px-4">
          <Search size={17} className="shrink-0 text-[var(--timeline)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((value) => Math.min(filtered.length - 1, value + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((value) => Math.max(0, value - 1));
              }
              if (event.key === "Enter") {
                const action = filtered[resolvedIndex];
                if (action && !action.disabled) finish(action.run);
              }
            }}
            placeholder="Sök verktyg eller handling…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[14px] font-medium text-[#edf2f5] outline-none placeholder:text-[#596672]"
          />
          <kbd className="!px-1.5 !py-0.5 !text-[9px]">Esc</kbd>
        </div>

        <div className="max-h-[460px] overflow-y-auto p-2">
          {filtered.length > 0 ? (
            filtered.map((action, index) => {
              const Icon = action.icon;
              const active = index === resolvedIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => finish(action.run)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? "bg-white/[0.075]" : "hover:bg-white/[0.045]"
                  } disabled:opacity-35`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      active
                        ? "bg-[var(--timeline)]/15 text-[#a9d2f3]"
                        : "bg-white/[0.035] text-[#778491]"
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-[#dce4eb]">
                      {action.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#687581]">
                      {action.detail}
                    </span>
                  </span>
                  <span className="hidden text-[8px] font-bold uppercase tracking-[0.1em] text-[#505d69] sm:block">
                    {action.group}
                  </span>
                  {action.shortcut && <kbd>{action.shortcut}</kbd>}
                </button>
              );
            })
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center text-center">
              <Search size={18} className="text-[#4f5b67]" />
              <p className="mt-3 text-[11px] font-semibold text-[#9ba7b2]">
                Inget matchar “{query}”
              </p>
              <p className="mt-1 text-[9px] text-[#5e6a76]">Prova ett verktyg eller en handling.</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.065] bg-[#0c1117] px-4 py-2 text-[8px] text-[#56636f]">
          <span><kbd>↑↓</kbd> välj</span>
          <span><kbd>Enter</kbd> öppna</span>
          <span className="ml-auto">CaptionCut kommandon</span>
        </div>
      </div>
    </div>
  );
}

export function HelpDrawer({
  open,
  onClose,
  onOpenTool,
  onExport,
}: OverlayActions & { open: boolean; onClose: () => void }) {
  const media = useEditorStore((state) => state.media);
  const tracks = useEditorStore((state) => state.tracks);
  const captions = useEditorStore((state) => state.captions);
  const duration = tracksDuration(tracks);
  const mainClips = tracks.find((track) => track.type === "video")?.clips.length ?? 0;
  const effects = tracks.find((track) => track.type === "effects")?.clips.length ?? 0;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLElement>({
    open,
    onClose,
    initialFocusRef: closeButtonRef,
  });

  if (!open) return null;

  const steps = [
    {
      title: "Samla material",
      text: `${media.length} filer i biblioteket`,
      done: media.length > 0,
      icon: FolderOpen,
      action: () => onOpenTool("media"),
      label: "Öppna bibliotek",
    },
    {
      title: "Bygg berättelsen",
      text: `${mainClips} klipp · ${formatTime(duration)}`,
      done: mainClips > 0,
      icon: Scissors,
      action: () => onOpenTool(mainClips > 3 ? "smart" : "cut"),
      label: mainClips > 3 ? "Smart redigering" : "Öppna klipp",
    },
    {
      title: "Gör den tydlig",
      text: `${captions.length} captions · ${effects} effekter`,
      done: captions.length > 0,
      icon: Captions,
      action: () => onOpenTool("captions"),
      label: "Öppna captions",
    },
    {
      title: "Leverera",
      text: duration > 0 ? "Redo för exportkontroll" : "Behöver video på tidslinjen",
      done: false,
      icon: Download,
      action: onExport,
      label: "Öppna export",
      disabled: duration <= 0,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[65] flex justify-end bg-black/45 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-guide-title"
        tabIndex={-1}
        className="flex h-full w-full max-w-[410px] flex-col border-l border-white/[0.09] bg-[#10161d] shadow-[-28px_0_80px_rgba(0,0,0,.45)]"
      >
        <header className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--timeline)]/12 text-[#9cc9ed] ring-1 ring-[var(--timeline)]/20">
            <CircleHelp size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="panel-eyebrow text-[var(--timeline)]">Snabbguide</p>
            <h2 id="quick-guide-title" className="mt-1 text-[18px] font-semibold tracking-[-0.03em]">
              Från råmaterial till färdig video
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Stäng snabbguiden"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="group grid grid-cols-[28px_36px_minmax(0,1fr)] items-center gap-2 rounded-2xl bg-white/[0.028] p-3 ring-1 ring-white/[0.07]"
                >
                  <span className="font-mono text-[9px] text-[#53606c]">{index + 1}</span>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                      step.done
                        ? "bg-[var(--caption)]/12 text-[var(--caption)]"
                        : "bg-white/[0.04] text-[#71808d]"
                    }`}
                  >
                    {step.done ? <Check size={14} /> : <Icon size={14} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#dbe3ea]">{step.title}</p>
                    <p className="mt-0.5 text-[9px] text-[#697682]">{step.text}</p>
                    <button
                      type="button"
                      onClick={() => {
                        step.action();
                        onClose();
                      }}
                      disabled={step.disabled}
                      className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-[#8bbce3] transition hover:text-[#b6d8f2] disabled:opacity-35"
                    >
                      {step.label} <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <section className="mt-5">
            <p className="panel-eyebrow text-[#687581]">Kortkommandon</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {[
                ["Spela / pausa", "Space"],
                ["Dela klipp", "C"],
                ["Radera klipp", "⌫"],
                ["Ångra", "Ctrl Z"],
                ["Duplicera", "Ctrl D"],
                ["En bildruta", "← →"],
                ["Tio bildrutor", "⇧ ← →"],
                ["Kommandon", "Ctrl K"],
              ].map(([label, shortcut]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-xl bg-[#0a0f14] px-3 py-2 ring-1 ring-white/[0.06]"
                >
                  <span className="text-[9px] text-[#7b8793]">{label}</span>
                  <kbd>{shortcut}</kbd>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-[var(--cut)]/12 bg-[var(--cut)]/[0.035] p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[#e4bd8d]">
              <PanelLeftClose size={12} /> Anpassa arbetsytan efter uppgiften
            </p>
            <p className="mt-1.5 text-[9px] leading-relaxed text-[#77838e]">
              Dra kanten vid verktygen eller handtaget ovanför tidslinjen. Dubbelklicka ett handtag
              för standardstorlek. Dina mått sparas automatiskt på enheten.
            </p>
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-white/[0.07] bg-[#0c1117] px-5 py-3 text-[9px] text-[#5f6b77]">
          <Keyboard size={12} />
          Tryck <kbd>Ctrl K</kbd> när du vet vad du vill göra men inte var det finns.
        </footer>
      </aside>
    </div>
  );
}
