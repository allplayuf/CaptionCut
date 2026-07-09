"use client";

/**
 * TikTok UI safe-zone guides (values in 1080x1920 pixels):
 *  - top bar: search / LIVE / For You tabs
 *  - right rail: like / comment / share / profile buttons
 *  - bottom strip: username, caption text and music ticker
 * Captions placed by CaptionCut's presets stay clear of these areas.
 */
export default function SafeZoneOverlay({ scale }: { scale: number }) {
  const zone = "absolute border border-dashed border-rose-400/50 bg-rose-500/10";
  const label =
    "absolute text-[9px] font-semibold uppercase tracking-wider text-rose-300/80";

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* top system/tabs area */}
      <div className={zone} style={{ top: 0, left: 0, right: 0, height: 180 * scale }}>
        <span className={label} style={{ left: 8, bottom: 4 }}>
          top UI
        </span>
      </div>
      {/* right engagement rail */}
      <div
        className={zone}
        style={{ right: 0, width: 160 * scale, top: 850 * scale, height: 650 * scale }}
      >
        <span className={label} style={{ left: 6, top: 6 }}>
          buttons
        </span>
      </div>
      {/* bottom caption/music area */}
      <div className={zone} style={{ bottom: 0, left: 0, right: 0, height: 300 * scale }}>
        <span className={label} style={{ left: 8, top: 4 }}>
          caption & music
        </span>
      </div>
    </div>
  );
}
