"use client";

import { useEffect, useRef } from "react";
import { useEditorStore, type EditorState } from "@/hooks/useEditorStore";

/**
 * The playback loop advances `currentTime` about 60 times a second. Reading it
 * with a plain `useEditorStore((s) => s.currentTime)` selector re-renders the
 * subscriber on every one of those frames — with ten subscribers that meant the
 * whole editor (preview, timeline, overlays, open panel) re-rendered per frame,
 * which is what made captions and scrubbing feel laggy.
 *
 * These helpers hand out the playhead without that cost:
 *
 *   usePlayheadFrame — 60fps DOM writes with zero React renders
 *   useCoarseTime    — a deliberately low-rate clock for text readouts
 *
 * Anything that needs the time only inside an event handler should skip
 * subscribing entirely and read `useEditorStore.getState().currentTime`.
 *
 * A component that renders different *content* as the playhead moves (the
 * active caption, the visible overlay clips) doesn't need anything from here:
 * select the derived value itself — an id, an index, a shallow-compared array —
 * so zustand's own equality check absorbs the frames where nothing changed.
 */

/**
 * Run `write` on every store change without re-rendering the caller. `write`
 * receives the live playhead plus the state it came from, and must only touch
 * refs and DOM — never React state.
 */
export function usePlayheadFrame(
  write: (time: number, state: EditorState) => void
): void {
  const latest = useRef(write);

  // Re-apply after every render, not just on store changes. `write` usually
  // closes over caller state too — the clip list, the canvas scale — and an
  // edit that changes those may not be followed by another store update, so
  // without this the DOM would keep painting the previous render's values.
  useEffect(() => {
    latest.current = write;
    const state = useEditorStore.getState();
    write(state.currentTime, state);
  });

  useEffect(
    () => useEditorStore.subscribe((state) => latest.current(state.currentTime, state)),
    []
  );
}

/**
 * The playhead quantized to `updatesPerSecond`, so time readouts re-render a
 * few times a second instead of sixty. The default is fast enough that a
 * mm:ss.cc display never looks stuck.
 */
export function useCoarseTime(updatesPerSecond = 10): number {
  return useEditorStore(
    (s) => Math.round(s.currentTime * updatesPerSecond) / updatesPerSecond
  );
}
