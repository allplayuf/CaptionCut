import type { ExportPreset, ExportPresetId } from "@/types";

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "tiktok",
    name: "TikTok / Reels / Shorts",
    description: "1080×1920 · 30fps · high quality",
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "tiktok-60",
    name: "Smooth 60fps",
    description: "1080×1920 · 60fps · gameplay & sports",
    width: 1080,
    height: 1920,
    fps: 60,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "draft",
    name: "Quick draft",
    description: "720×1280 · 30fps · fastest render",
    width: 720,
    height: 1280,
    fps: 30,
    crf: 26,
    x264Preset: "ultrafast",
  },
];

export function getExportPreset(id: ExportPresetId | undefined): ExportPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0];
}
