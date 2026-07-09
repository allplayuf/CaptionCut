"use client";

import type { CSSProperties } from "react";
import type { Caption, CaptionStyle } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";

/**
 * Renders the active caption over the preview using the same geometry as the
 * ASS export (1080x1920 canvas, scaled by `scale`), so what you see is what
 * gets burned in.
 */

/** Must match POSITION_MARGIN_V in lib/export/ass.ts. */
const POSITION_BOTTOM_MARGIN: Record<CaptionStyle["position"], number> = {
  center: 0,
  lower: 560,
  bottom: 330,
};

export default function CaptionOverlay({ scale }: { scale: number }) {
  const captions = useEditorStore((s) => s.captions);
  const style = useEditorStore((s) => s.style);
  const currentTime = useEditorStore((s) => s.currentTime);

  const active = findActiveCaption(captions, currentTime);
  if (!active) return null;

  const isCenter = style.position === "center";
  const bottomMargin = POSITION_BOTTOM_MARGIN[style.position] * scale;

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: 70 * scale,
    right: 70 * scale,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    ...(isCenter
      ? { top: "50%", transform: "translateY(-50%)" }
      : { bottom: bottomMargin }),
  };

  const hasBox = style.backgroundColor !== null;

  const textStyle: CSSProperties = {
    fontFamily: `'${style.fontFamily}', sans-serif`,
    fontSize: style.fontSize * scale,
    fontWeight: style.fontWeight,
    color: style.textColor,
    lineHeight: 1.2,
    textAlign: "center",
    textTransform: style.allCaps ? "uppercase" : "none",
    // Outline matches libass: `Outline: w` extends w px outward, while CSS
    // text-stroke is centered on the glyph edge, hence the 2x width.
    ...(hasBox || style.strokeWidth === 0
      ? {}
      : {
          WebkitTextStroke: `${style.strokeWidth * 2 * scale}px ${style.strokeColor}`,
          paintOrder: "stroke fill",
        }),
    ...(!hasBox && style.shadow
      ? { textShadow: `0 ${3 * scale}px ${10 * scale}px rgba(0,0,0,0.85)` }
      : {}),
    ...(hasBox
      ? {
          backgroundColor: hexToRgba(style.backgroundColor as string, style.backgroundOpacity),
          padding: `${10 * scale}px ${18 * scale}px`,
          borderRadius: 8 * scale,
          boxDecorationBreak: "clone" as const,
          WebkitBoxDecorationBreak: "clone" as const,
        }
      : {}),
  };

  const activeWordIndex =
    style.highlightColor && active.words ? findActiveWordIndex(active, currentTime) : -1;

  return (
    <div style={containerStyle}>
      <span style={textStyle}>
        {activeWordIndex >= 0 && active.words ? (
          active.words.map((w, i) => (
            <span
              key={i}
              style={i === activeWordIndex ? { color: style.highlightColor ?? undefined } : undefined}
            >
              {w.word}
              {i < active.words!.length - 1 ? " " : ""}
            </span>
          ))
        ) : (
          active.text
        )}
      </span>
    </div>
  );
}

function findActiveCaption(captions: Caption[], time: number): Caption | null {
  // Later captions win on overlap, matching how ASS layers render.
  let found: Caption | null = null;
  for (const cap of captions) {
    if (time >= cap.startTime && time < cap.endTime) found = cap;
  }
  return found;
}

/**
 * Mirrors the export's word-frame logic (lib/export/ass.ts): frame k runs
 * from word[k-1].end to word[k].end, so exactly one word is active at a time.
 */
function findActiveWordIndex(caption: Caption, time: number): number {
  const words = caption.words;
  if (!words || words.length === 0) return -1;
  for (let k = 0; k < words.length; k++) {
    const start = k === 0 ? caption.startTime : words[k - 1].endTime;
    const end = k === words.length - 1 ? caption.endTime : words[k].endTime;
    if (time >= start && time < end) return k;
  }
  return words.length - 1;
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
