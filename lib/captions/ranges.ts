import { nanoid } from "nanoid";
import type { Caption, TimeRange, WordTiming } from "@/types";

/**
 * Replace captions inside timeline ranges without throwing away words that
 * straddle a range boundary. Word-timed captions are split into their
 * surviving word groups; legacy captions without word timing are clipped.
 */
export function replaceCaptionsInsideRanges(
  existing: Caption[],
  ranges: TimeRange[],
  replacements: Caption[]
): Caption[] {
  const normalized = normalizeRanges(ranges);
  if (normalized.length === 0) {
    return [...existing, ...replacements].sort((a, b) => a.startTime - b.startTime);
  }

  const preserved = existing.flatMap((caption) => preserveOutsideRanges(caption, normalized));
  return [...preserved, ...replacements].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime
  );
}

function preserveOutsideRanges(caption: Caption, ranges: TimeRange[]): Caption[] {
  const overlaps = ranges.some(
    (range) => caption.startTime < range.end && caption.endTime > range.start
  );
  if (!overlaps) return [caption];

  const outside = subtractRanges(
    { start: caption.startTime, end: caption.endTime },
    ranges
  );
  if (outside.length === 0) return [];

  if (!caption.words?.length) {
    return outside
      .filter((range) => range.end - range.start >= 0.02)
      .map((range, index) => ({
        ...caption,
        id: index === 0 ? caption.id : nanoid(8),
        startTime: range.start,
        endTime: range.end,
      }));
  }

  const pieces: Caption[] = [];
  for (const range of outside) {
    const words = caption.words.filter((word) => {
      const midpoint = (word.startTime + word.endTime) / 2;
      return midpoint >= range.start && midpoint < range.end;
    });
    if (words.length === 0) continue;
    pieces.push({
      ...caption,
      id: pieces.length === 0 ? caption.id : nanoid(8),
      startTime: Math.max(range.start, words[0].startTime),
      endTime: Math.min(range.end, words[words.length - 1].endTime),
      text: words.map((word) => word.word).join(" "),
      words,
      confidence: meanConfidence(words),
    });
  }
  return pieces.filter((piece) => piece.endTime - piece.startTime >= 0.02);
}

function subtractRanges(base: TimeRange, ranges: TimeRange[]): TimeRange[] {
  let cursor = base.start;
  const result: TimeRange[] = [];
  for (const range of ranges) {
    if (range.end <= cursor || range.start >= base.end) continue;
    if (range.start > cursor) {
      result.push({ start: cursor, end: Math.min(base.end, range.start) });
    }
    cursor = Math.max(cursor, range.end);
    if (cursor >= base.end) break;
  }
  if (cursor < base.end) result.push({ start: cursor, end: base.end });
  return result;
}

function normalizeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .map((range) => ({ start: Math.max(0, range.start), end: Math.max(0, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function meanConfidence(words: WordTiming[]): number | undefined {
  const values = words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}
