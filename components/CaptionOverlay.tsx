"use client";

import type { CSSProperties } from "react";
import type { Caption, CaptionStyle } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { FORMATS } from "@/lib/video/formats";

/**
 * Renders the active caption over the preview using the same geometry as the
 * ASS export: style values live on the 1080x1920 reference canvas and scale
 * onto the current format's canvas (x by width/1080, y and font sizes by
 * height/1920), so what you see is what gets burned in — for every format.
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
  const format = useEditorStore((s) => s.format);
  const currentTime = useEditorStore((s) => s.currentTime);

  const active = findActiveCaption(captions, currentTime);
  if (!active) return null;

  // Mirrors buildAss(): horizontal by width, vertical + fonts by height.
  const canvas = FORMATS[format];
  const xScale = (canvas.width / 1080) * scale;
  const yScale = (canvas.height / 1920) * scale;

  const isCenter = style.position === "center";
  const bottomMargin = POSITION_BOTTOM_MARGIN[style.position] * yScale;

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: 70 * xScale,
    right: 70 * xScale,
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
    fontSize: style.fontSize * yScale,
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
          WebkitTextStroke: `${style.strokeWidth * 2 * yScale}px ${style.strokeColor}`,
          paintOrder: "stroke fill",
        }),
    ...(!hasBox && style.shadow
      ? { textShadow: `0 ${3 * yScale}px ${10 * yScale}px rgba(0,0,0,0.85)` }
      : {}),
    ...(hasBox
      ? {
          backgroundColor: hexToRgba(style.backgroundColor as string, style.backgroundOpacity),
          padding: `${10 * yScale}px ${18 * yScale}px`,
          borderRadius: 8 * yScale,
          boxDecorationBreak: "clone" as const,
          WebkitBoxDecorationBreak: "clone" as const,
        }
      : {}),
  };

  const activeWordIndex =
    style.highlightColor && active.words ? findActiveWordIndex(active, currentTime) : -1;
  const hasEmphasis = active.words?.some((w) => w.emphasis) ?? false;

  return (
    <div style={containerStyle}>
      <span style={textStyle}>
        {active.words && (activeWordIndex >= 0 || hasEmphasis) ? (
          active.words.map((w, i) => {
            const wordStyle: CSSProperties = {};
            if (w.emphasis) {
              wordStyle.fontWeight = 900;
              if (style.emphasisColor) wordStyle.color = style.emphasisColor;
            }
            // Spoken-word highlight wins over emphasis color.
            if (i === activeWordIndex && style.highlightColor) {
              wordStyle.color = style.highlightColor;
            }
            return (
              <span key={i} style={wordStyle}>
                {w.word}
                {i < active.words!.length - 1 ? " " : ""}
              </span>
            );
          })
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
