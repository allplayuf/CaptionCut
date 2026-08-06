"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CaptionStyle } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { usePlayheadFrame } from "@/lib/ui/playhead";
import { FORMATS } from "@/lib/video/formats";
import { captionPreviewFontFamily } from "@/lib/captions/fonts";
import { activeCaptionIndex, activeWordIndex } from "@/lib/captions/active";
import { captionAnimationAt, captionWordScale } from "@/lib/captions/animation";

/**
 * Renders the active caption over the preview using the same geometry as the
 * ASS export: style values live on the 1080x1920 reference canvas and scale
 * onto the current format's canvas (x by width/1080, y and font sizes by
 * height/1920), so what you see is what gets burned in — for every format.
 *
 * It deliberately never subscribes to `currentTime`. The playhead moves ~60
 * times a second but the caption on screen changes a couple of times a second,
 * so the store selectors below resolve straight to the caption index and the
 * spoken-word index: zustand compares those numbers and skips every frame that
 * would have re-rendered identical text.
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
  const selectedCaptionId = useEditorStore((s) => s.selectedCaptionId);
  // Derived indices, not the raw playhead — see the note above.
  const captionIndex = useEditorStore((s) => activeCaptionIndex(s.captions, s.currentTime));
  const activeWordIdx = useEditorStore((s) => {
    // Word position only changes what's drawn when it recolors a word or gives
    // it the animation's scale beat. Otherwise don't wake the component at all.
    const animated = captionWordScale(s.style.animation ?? "none") > 1;
    if (!s.style.highlightColor && !animated) return -1;
    const index = activeCaptionIndex(s.captions, s.currentTime);
    return index === -1 ? -1 : activeWordIndex(s.captions[index], s.currentTime);
  });
  /** Live position while the caption is being dragged between slots. */
  const [dragPosition, setDragPosition] = useState<CaptionStyle["position"] | null>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const active = captionIndex === -1 ? null : captions[captionIndex];
  const animation = style.animation ?? "none";
  const captionStart = active?.startTime ?? 0;

  /**
   * The entrance runs off the playhead rather than a CSS animation, so it is
   * correct when scrubbing or paused and evaluates the very same keyframes the
   * exporter turns into libass `\t` transforms. Writing it straight to the node
   * also keeps the whole entrance free of React renders.
   */
  usePlayheadFrame((time) => {
    const el = textRef.current;
    if (!el) return;
    const at = captionAnimationAt(animation, time - captionStart);
    el.style.transform = `scale(${at.scale.toFixed(4)})`;
    el.style.opacity = at.opacity.toFixed(3);
  });

  if (!active) return null;

  // Mirrors buildAss(): horizontal by width, vertical + fonts by height.
  const canvas = FORMATS[format];
  const xScale = (canvas.width / 1080) * scale;
  const yScale = (canvas.height / 1920) * scale;

  const position = dragPosition ?? style.position;
  const isCenter = position === "center";
  const bottomMargin = POSITION_BOTTOM_MARGIN[position] * yScale;
  const selected = selectedCaptionId === active.id;

  /** Drag the caption vertically; it snaps between the three ASS-safe slots. */
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    useEditorStore.getState().selectCaption(active.id);
    const frameEl = (e.currentTarget as HTMLElement).closest("[data-preview-frame]");
    const rect = frameEl?.getBoundingClientRect();
    if (!rect) return;
    let last: CaptionStyle["position"] | null = null;
    const slotFor = (clientY: number): CaptionStyle["position"] => {
      const frac = (clientY - rect.top) / rect.height;
      return frac < 0.62 ? "center" : frac < 0.8 ? "lower" : "bottom";
    };
    const move = (ev: PointerEvent) => {
      last = slotFor(ev.clientY);
      setDragPosition(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragPosition(null);
      const s = useEditorStore.getState();
      if (last && last !== s.style.position) s.setStyle({ position: last });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
    fontFamily: captionPreviewFontFamily(style.fontFamily),
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

  const hasEmphasis = active.words?.some((w) => w.emphasis) ?? false;
  const wordScale = captionWordScale(animation);

  return (
    <div style={containerStyle}>
      <span
        ref={textRef}
        style={{
          ...textStyle,
          pointerEvents: "auto",
          cursor: dragPosition ? "grabbing" : "grab",
          outline: selected || dragPosition ? "1.5px dashed rgba(255,255,255,0.6)" : undefined,
          outlineOffset: 4,
          // libass scales the line about its alignment anchor: the baseline for
          // bottom-anchored captions, the middle for centered ones.
          transformOrigin: isCenter ? "center center" : "center bottom",
        }}
        onPointerDown={onPointerDown}
        title="Drag up/down to move captions between the safe positions"
      >
        {active.words && (activeWordIdx >= 0 || hasEmphasis) ? (
          active.words.map((w, i) => {
            const wordStyle: CSSProperties = {};
            if (w.emphasis) {
              wordStyle.fontWeight = 900;
              if (style.emphasisColor) wordStyle.color = style.emphasisColor;
            }
            // Spoken-word highlight wins over emphasis color.
            if (i === activeWordIdx && style.highlightColor) {
              wordStyle.color = style.highlightColor;
            }
            // The scale beat is applied as font-size, not a transform: ASS's
            // \fscx widens the glyph's advance too, so the line has to reflow
            // here the same way it does in the burn-in.
            if (i === activeWordIdx && wordScale > 1) {
              wordStyle.fontSize = style.fontSize * yScale * wordScale;
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

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
