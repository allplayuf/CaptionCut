/** Core shared types for CaptionCut. */

/** Word-level timing inside a caption chunk. Times are in seconds on the timeline. */
export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

/** One TikTok-style caption chunk (3–7 punchy words). */
export interface Caption {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: WordTiming[];
}

/** An uploaded source video, stored server-side under data/media. */
export interface MediaAsset {
  id: string;
  /** Filename on disk (id + original extension). */
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/** A segment of a source video placed on the timeline. Order in the array = timeline order. */
export interface Clip {
  id: string;
  mediaId: string;
  /** In-point in the source video, seconds. */
  sourceStart: number;
  /** Out-point in the source video, seconds. */
  sourceEnd: number;
}

export type CaptionPosition = "center" | "lower" | "bottom";

/**
 * Caption styling. All pixel values are relative to the 1080x1920 export canvas;
 * the preview scales them down so preview and export match.
 */
export interface CaptionStyle {
  /** Windows/web-safe font name used by both CSS preview and ASS export. */
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 600 | 700 | 900;
  textColor: string;
  /** null = no background box. */
  backgroundColor: string | null;
  backgroundOpacity: number;
  strokeColor: string;
  /** 0 = no stroke. Ignored when backgroundColor is set (box replaces outline). */
  strokeWidth: number;
  shadow: boolean;
  position: CaptionPosition;
  allCaps: boolean;
  /** Highlight color for the currently spoken word (requires word timestamps). null = off. */
  highlightColor: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: MediaAsset[];
  clips: Clip[];
  captions: Caption[];
  style: CaptionStyle;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  clipCount: number;
}

export type ExportStatus = "processing" | "done" | "error";

export interface ExportJobState {
  id: string;
  status: ExportStatus;
  /** 0..1 */
  progress: number;
  error?: string;
}

export type TranscriptionLanguage = "auto" | "en" | "sv";
