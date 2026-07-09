import type { CaptionStyle } from "@/types";

/**
 * Caption style presets. Font names must exist both as CSS fonts (preview)
 * and as installed system fonts (FFmpeg/libass export) — stick to
 * Windows/macOS-safe families.
 */

export const DEFAULT_STYLE: CaptionStyle = {
  fontFamily: "Arial",
  fontSize: 72,
  fontWeight: 900,
  textColor: "#FFFFFF",
  backgroundColor: null,
  backgroundOpacity: 0.75,
  strokeColor: "#000000",
  strokeWidth: 6,
  shadow: true,
  position: "lower",
  allCaps: false,
  highlightColor: null,
  emphasisColor: "#FFD400",
};

export interface CaptionPreset {
  id: string;
  name: string;
  style: CaptionStyle;
}

const base = DEFAULT_STYLE;

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "clean-white",
    name: "Clean White",
    style: {
      ...base,
      fontFamily: "Segoe UI",
      fontSize: 62,
      fontWeight: 700,
      strokeWidth: 0,
      shadow: true,
      position: "bottom",
      highlightColor: null,
      emphasisColor: null,
    },
  },
  {
    id: "tiktok-bold",
    name: "TikTok Bold",
    style: {
      ...base,
      fontFamily: "Arial",
      fontSize: 72,
      fontWeight: 900,
      strokeWidth: 6,
      position: "lower",
      highlightColor: "#25F4EE",
      emphasisColor: "#FE2C55",
    },
  },
  {
    id: "hormozi",
    name: "Hormozi Style",
    style: {
      ...base,
      fontFamily: "Arial Black",
      fontSize: 78,
      fontWeight: 900,
      strokeWidth: 8,
      position: "center",
      allCaps: true,
      highlightColor: "#00FF44",
      emphasisColor: "#FFD400",
    },
  },
  {
    id: "mrbeast",
    name: "MrBeast Style",
    style: {
      ...base,
      fontFamily: "Arial Black",
      fontSize: 84,
      fontWeight: 900,
      strokeWidth: 10,
      position: "center",
      allCaps: true,
      highlightColor: "#FFD400",
      emphasisColor: "#FF3355",
    },
  },
  {
    id: "podcast-pro",
    name: "Podcast Pro",
    style: {
      ...base,
      fontFamily: "Verdana",
      fontSize: 60,
      fontWeight: 700,
      backgroundColor: "#000000",
      backgroundOpacity: 0.72,
      strokeWidth: 0,
      shadow: false,
      position: "lower",
      highlightColor: "#FFD400",
      emphasisColor: null,
    },
  },
  {
    id: "sports-hype",
    name: "Sports Hype",
    style: {
      ...base,
      fontFamily: "Impact",
      fontSize: 82,
      fontWeight: 700,
      textColor: "#FFF200",
      strokeColor: "#111111",
      strokeWidth: 8,
      position: "lower",
      allCaps: true,
      highlightColor: "#FFFFFF",
      emphasisColor: "#FF3300",
    },
  },
  {
    id: "meme-subtitle",
    name: "Meme Subtitle",
    style: {
      ...base,
      fontFamily: "Impact",
      fontSize: 78,
      fontWeight: 700,
      strokeWidth: 8,
      shadow: false,
      position: "center",
      allCaps: true,
      highlightColor: null,
      emphasisColor: null,
    },
  },
  {
    id: "minimal-creator",
    name: "Minimal Creator",
    style: {
      ...base,
      fontFamily: "Trebuchet MS",
      fontSize: 56,
      fontWeight: 600,
      strokeWidth: 0,
      shadow: true,
      position: "bottom",
      allCaps: false,
      highlightColor: null,
      emphasisColor: "#7CFFCB",
    },
  },
  {
    id: "yellow-highlight",
    name: "Yellow Highlight",
    style: {
      ...base,
      fontFamily: "Arial",
      fontSize: 68,
      fontWeight: 900,
      backgroundColor: "#FFD400",
      backgroundOpacity: 0.95,
      textColor: "#111111",
      strokeWidth: 0,
      shadow: false,
      position: "lower",
      highlightColor: null,
      emphasisColor: null,
    },
  },
  {
    id: "red-flag-words",
    name: "Red Flag Words",
    style: {
      ...base,
      fontFamily: "Arial",
      fontSize: 70,
      fontWeight: 900,
      strokeWidth: 6,
      position: "lower",
      highlightColor: "#FFFFFF",
      emphasisColor: "#FF2E2E",
    },
  },
];
