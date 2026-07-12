import type { ExportPreset, ExportPresetId } from "@/types";

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "tiktok",
    name: "TikTok / Reels / Shorts",
    description: "1080×1920 vertical · 30fps · high quality",
    width: 1080,
    height: 1920,
    canvasWidth: 1080,
    canvasHeight: 1920,
    fps: 30,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "tiktok-60",
    name: "Smooth 60fps",
    description: "1080×1920 vertical · 60fps · gameplay & sports",
    width: 1080,
    height: 1920,
    canvasWidth: 1080,
    canvasHeight: 1920,
    fps: 60,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "square",
    name: "Instagram Square",
    description: "1080×1080 square · 30fps · feed posts",
    width: 1080,
    height: 1080,
    canvasWidth: 1080,
    canvasHeight: 1080,
    fps: 30,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "landscape",
    name: "Landscape / YouTube",
    description: "1920×1080 horizontal · 30fps",
    width: 1920,
    height: 1080,
    canvasWidth: 1920,
    canvasHeight: 1080,
    fps: 30,
    crf: 19,
    x264Preset: "veryfast",
  },
  {
    id: "draft",
    name: "Quick draft",
    description: "720×1280 vertical · 30fps · fastest render",
    width: 720,
    height: 1280,
    canvasWidth: 1080,
    canvasHeight: 1920,
    fps: 30,
    crf: 26,
    x264Preset: "ultrafast",
  },
];

export function getExportPreset(id: ExportPresetId | undefined): ExportPreset {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? EXPORT_PRESETS[0];
}
