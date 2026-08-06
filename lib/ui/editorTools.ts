/**
 * The editor's tools.
 *
 * The first five are the rail; everything else lives behind "More". The split
 * is deliberate — "montage" is the one that finishes a video on its own, so it
 * leads and is the default. The advanced auto-edit surfaces ("smart" for
 * interviews and first-pass trimming, "sequence" for hand-ordering shots) sit
 * behind More because they ask questions before they produce anything.
 */
export type EditorTool =
  | "montage"
  | "media"
  | "captions"
  | "style"
  | "effects"
  | "cut"
  | "adjust"
  | "smart"
  | "sequence"
  | "more";

/** Tools reachable only through the More panel. */
export const SECONDARY_TOOLS = ["cut", "adjust", "smart", "sequence"] as const;

export function isSecondaryTool(tool: EditorTool): boolean {
  return (SECONDARY_TOOLS as readonly string[]).includes(tool);
}
