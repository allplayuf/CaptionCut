"use client";

import type { CaptionPosition } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { CAPTION_PRESETS } from "@/lib/captions/presets";

const FONT_OPTIONS = [
  "Arial",
  "Arial Black",
  "Impact",
  "Segoe UI",
  "Verdana",
  "Georgia",
  "Trebuchet MS",
  "Comic Sans MS",
];

/** Right panel, Style tab: presets + full caption styling controls. */
export default function StylePanel() {
  const style = useEditorStore((s) => s.style);
  const setStyle = useEditorStore((s) => s.setStyle);
  const applyPreset = useEditorStore((s) => s.applyPreset);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* presets */}
      <section>
        <SectionLabel>Presets</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.style)}
              className="rounded-xl bg-white/[0.035] px-2 py-2.5 ring-1 ring-white/[0.075] transition hover:bg-white/[0.065] hover:ring-[var(--caption)]/40"
            >
              <span
                className="block truncate text-center text-sm"
                style={{
                  fontFamily: `'${preset.style.fontFamily}', sans-serif`,
                  fontWeight: preset.style.fontWeight,
                  color: preset.style.textColor,
                  textTransform: preset.style.allCaps ? "uppercase" : "none",
                  WebkitTextStroke:
                    preset.style.strokeWidth > 0 && !preset.style.backgroundColor
                      ? `1px ${preset.style.strokeColor}`
                      : undefined,
                  backgroundColor: preset.style.backgroundColor
                    ? `${preset.style.backgroundColor}BB`
                    : undefined,
                  borderRadius: 4,
                }}
              >
                {preset.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* text */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Text</SectionLabel>
        <Row label="Font">
          <select
            value={style.fontFamily}
            onChange={(e) => setStyle({ fontFamily: e.target.value })}
            className="w-36 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-[var(--caption)]"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </Row>
        <Row label={`Size · ${style.fontSize}`}>
          <input
            type="range"
            min={36}
            max={130}
            value={style.fontSize}
            onChange={(e) => setStyle({ fontSize: parseInt(e.target.value, 10) })}
            className="w-36 accent-[var(--caption)]"
          />
        </Row>
        <Row label="Weight">
          <div className="flex gap-1">
            {([400, 600, 700, 900] as const).map((w) => (
              <Chip key={w} active={style.fontWeight === w} onClick={() => setStyle({ fontWeight: w })}>
                {w === 400 ? "Reg" : w === 600 ? "Semi" : w === 700 ? "Bold" : "Black"}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Text color">
          <ColorInput value={style.textColor} onChange={(v) => setStyle({ textColor: v })} />
        </Row>
        <Row label="ALL CAPS">
          <Toggle checked={style.allCaps} onChange={(v) => setStyle({ allCaps: v })} />
        </Row>
      </section>

      {/* effects */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Effects</SectionLabel>
        <Row label={`Stroke · ${style.strokeWidth}`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={16}
              value={style.strokeWidth}
              onChange={(e) => setStyle({ strokeWidth: parseInt(e.target.value, 10) })}
              className="w-24 accent-[var(--caption)]"
              disabled={style.backgroundColor !== null}
            />
            <ColorInput value={style.strokeColor} onChange={(v) => setStyle({ strokeColor: v })} />
          </div>
        </Row>
        <Row label="Shadow">
          <Toggle
            checked={style.shadow}
            onChange={(v) => setStyle({ shadow: v })}
            disabled={style.backgroundColor !== null}
          />
        </Row>
        <Row label="Background">
          <div className="flex items-center gap-2">
            <Toggle
              checked={style.backgroundColor !== null}
              onChange={(v) => setStyle({ backgroundColor: v ? "#000000" : null })}
            />
            {style.backgroundColor !== null && (
              <ColorInput
                value={style.backgroundColor}
                onChange={(v) => setStyle({ backgroundColor: v })}
              />
            )}
          </div>
        </Row>
        {style.backgroundColor !== null && (
          <Row label={`Bg opacity · ${Math.round(style.backgroundOpacity * 100)}%`}>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(style.backgroundOpacity * 100)}
              onChange={(e) => setStyle({ backgroundOpacity: parseInt(e.target.value, 10) / 100 })}
              className="w-36 accent-[var(--caption)]"
            />
          </Row>
        )}
        {style.backgroundColor !== null && (
          <p className="-mt-2 text-[10px] leading-snug text-zinc-600">
            Background replaces stroke &amp; shadow in the export.
          </p>
        )}
        <Row label="Highlight word">
          <div className="flex items-center gap-2">
            <Toggle
              checked={style.highlightColor !== null}
              onChange={(v) => setStyle({ highlightColor: v ? "#FFD400" : null })}
            />
            {style.highlightColor !== null && (
              <ColorInput
                value={style.highlightColor}
                onChange={(v) => setStyle({ highlightColor: v })}
              />
            )}
          </div>
        </Row>
        <p className="-mt-2 text-[10px] leading-snug text-zinc-600">
          Highlights the currently spoken word (needs word timestamps from Auto Captions).
        </p>
      </section>

      {/* position */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Position</SectionLabel>
        <div className="flex gap-1">
          {(
            [
              ["center", "Center"],
              ["lower", "Lower"],
              ["bottom", "Bottom"],
            ] as Array<[CaptionPosition, string]>
          ).map(([value, label]) => (
            <Chip
              key={value}
              active={style.position === value}
              onClick={() => setStyle({ position: value })}
            >
              {label}
            </Chip>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-zinc-600">
          All positions stay inside the TikTok safe zones (toggle the guides under the preview).
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-[var(--caption)]/15 text-[var(--caption)] ring-1 ring-[var(--caption)]/45"
          : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative h-5 w-9 rounded-full transition disabled:opacity-30 ${
        checked ? "bg-[var(--caption)]" : "bg-white/10"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative h-6 w-9 cursor-pointer overflow-hidden rounded-md ring-1 ring-white/20">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute -inset-2 h-12 w-14 cursor-pointer"
      />
    </label>
  );
}
