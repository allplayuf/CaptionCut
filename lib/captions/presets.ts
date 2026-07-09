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
};

export interface CaptionPreset {
  id: string;
  name: string;
  style: CaptionStyle;
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "tiktok-bold",
    name: "TikTok Bold",
    style: {
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
      highlightColor: "#25F4EE",
    },
  },
  {
    id: "mrbeast",
    name: "MrBeast Style",
    style: {
      fontFamily: "Arial Black",
      fontSize: 84,
      fontWeight: 900,
      textColor: "#FFFFFF",
      backgroundColor: null,
      backgroundOpacity: 0.75,
      strokeColor: "#000000",
      strokeWidth: 10,
      shadow: true,
      position: "center",
      allCaps: true,
      highlightColor: "#FFD400",
    },
  },
  {
    id: "clean-minimal",
    name: "Clean Minimal",
    style: {
      fontFamily: "Segoe UI",
      fontSize: 60,
      fontWeight: 600,
      textColor: "#FFFFFF",
      backgroundColor: null,
      backgroundOpacity: 0.75,
      strokeColor: "#000000",
      strokeWidth: 0,
      shadow: true,
      position: "bottom",
      allCaps: false,
      highlightColor: null,
    },
  },
  {
    id: "podcast-clip",
    name: "Podcast Clip",
    style: {
      fontFamily: "Verdana",
      fontSize: 62,
      fontWeight: 700,
      textColor: "#FFFFFF",
      backgroundColor: "#000000",
      backgroundOpacity: 0.75,
      strokeColor: "#000000",
      strokeWidth: 0,
      shadow: false,
      position: "lower",
      allCaps: false,
      highlightColor: "#FFD400",
    },
  },
  {
    id: "meme",
    name: "Meme Style",
    style: {
      fontFamily: "Impact",
      fontSize: 82,
      fontWeight: 700,
      textColor: "#FFFFFF",
      backgroundColor: null,
      backgroundOpacity: 0.75,
      strokeColor: "#000000",
      strokeWidth: 8,
      shadow: false,
      position: "center",
      allCaps: true,
      highlightColor: null,
    },
  },
];
