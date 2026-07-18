import type { EditRecipe, TimeRange } from "@/types";
import { round3 } from "@/lib/timeline/tracks";

interface SegmentMap {
  index: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/**
 * Rebuild a generated recipe after the user rejects or reorders suggested
 * moments in the draft-review step. Recipe effects use final-timeline times,
 * so they need to move with their owning moment instead of staying behind at
 * stale timestamps.
 */
export function reviseEditRecipe(recipe: EditRecipe, requestedOrder: number[]): EditRecipe {
  const order = [...new Set(requestedOrder)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < recipe.keptRanges.length
  );

  const oldStarts: number[] = [];
  let oldCursor = 0;
  recipe.keptRanges.forEach((range, index) => {
    oldStarts.push(oldCursor);
    oldCursor += outputDuration(range, recipe.rangeSpeeds?.[index]);
  });

  const maps: SegmentMap[] = [];
  let newCursor = 0;
  for (const index of order) {
    const duration = outputDuration(recipe.keptRanges[index], recipe.rangeSpeeds?.[index]);
    maps.push({
      index,
      oldStart: oldStarts[index],
      oldEnd: oldStarts[index] + duration,
      newStart: newCursor,
      newEnd: newCursor + duration,
    });
    newCursor += duration;
  }

  const mapRange = (range: TimeRange): TimeRange | null => {
    const midpoint = (range.start + range.end) / 2;
    const owner = maps.find(
      (map) => midpoint >= map.oldStart - 0.001 && midpoint <= map.oldEnd + 0.001
    );
    if (!owner) return null;
    const start = owner.newStart + Math.max(0, range.start - owner.oldStart);
    const end = owner.newStart + Math.min(owner.oldEnd - owner.oldStart, range.end - owner.oldStart);
    if (end - start < 0.03) return null;
    return { start: round3(start), end: round3(end) };
  };

  const mapPoint = (time: number): number | null => {
    const owner = maps.find(
      (map) => time >= map.oldStart - 0.001 && time <= map.oldEnd + 0.001
    );
    return owner ? round3(owner.newStart + Math.max(0, time - owner.oldStart)) : null;
  };

  const zooms = recipe.zooms.flatMap((zoom) => {
    const range = mapRange(zoom);
    return range ? [{ ...zoom, ...range }] : [];
  });
  const flashes = recipe.flashes?.flatMap((flash) => {
    const range = mapRange(flash);
    return range ? [range] : [];
  });
  const overlays = recipe.overlays.flatMap((overlay) => {
    const range = mapRange(overlay);
    return range ? [{ ...overlay, ...range }] : [];
  });
  const brollPlacements = recipe.brollPlacements?.flatMap((placement) => {
    const range = mapRange(placement);
    if (!range) return [];
    const duration = range.end - range.start;
    return [{
      ...placement,
      ...range,
      sourceEnd: round3(Math.min(placement.sourceEnd, placement.sourceStart + duration)),
    }];
  });
  const highlights = recipe.highlights?.flatMap((highlight) => {
    const range = mapRange(highlight);
    const time = mapPoint(highlight.time);
    return range && time !== null ? [{ ...highlight, ...range, time }] : [];
  });
  const brollSuggestions = recipe.brollSuggestions.flatMap((suggestion) => {
    const time = mapPoint(suggestion.time);
    return time === null ? [] : [{ ...suggestion, time }];
  });

  return {
    ...recipe,
    keptRanges: order.map((index) => recipe.keptRanges[index]),
    rangeSpeeds: recipe.rangeSpeeds
      ? order.map((index) => recipe.rangeSpeeds?.[index])
      : undefined,
    zooms,
    flashes,
    overlays,
    brollPlacements,
    highlights,
    brollSuggestions,
    reasoningSummary:
      `${order.length} reviewed moment${order.length === 1 ? "" : "s"} · ` +
      `${Math.round(newCursor)}s ${String(recipe.style).replaceAll("-", " ")} edit.`,
  };
}

function outputDuration(range: TimeRange, speed?: number): number {
  const safeSpeed = speed && speed > 0 ? speed : 1;
  return Math.max(0, range.end - range.start) / safeSpeed;
}
