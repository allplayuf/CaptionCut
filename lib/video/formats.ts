import type { AspectRatioId, ExportPresetId } from "@/types";

/**
 * Editing formats. The preview composites on the format's canvas; overlay
 * coordinates stay in the 1080x1920 reference system and are scaled onto the
 * canvas exactly like the exporter does (x by width/1080, y by height/1920),
 * so the preview matches the burn-in for every format.
 */

export interface FormatSpec {
  id: AspectRatioId;
  label: string;
  /** Composition canvas the preview lays out on. */
  width: number;
  height: number;
  /** Export preset preselected for this format. */
  presetId: ExportPresetId;
}

export const FORMATS: Record<AspectRatioId, FormatSpec> = {
  "9:16": { id: "9:16", label: "9:16", width: 1080, height: 1920, presetId: "tiktok" },
  "1:1": { id: "1:1", label: "1:1", width: 1080, height: 1080, presetId: "square" },
  "16:9": { id: "16:9", label: "16:9", width: 1920, height: 1080, presetId: "landscape" },
};

export const FORMAT_IDS: AspectRatioId[] = ["9:16", "1:1", "16:9"];
