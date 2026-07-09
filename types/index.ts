/** Core shared types for CaptionCut. */

/** Word-level timing inside a caption chunk. Times are in seconds on the timeline. */
export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
  /** Auto/manual emphasis: rendered bold + highlight color in preview and export. */
  emphasis?: boolean;
}

/** One TikTok-style caption chunk (3–7 punchy words). */
export interface Caption {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: WordTiming[];
}

export type AssetKind = "video" | "audio" | "image";

/** An uploaded source file (video, audio or image), stored under data/media. */
export interface MediaAsset {
  id: string;
  /** Filename on disk (id + original extension). */
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** Seconds; 0 for images. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Missing on legacy assets — use assetKind() from lib/timeline/tracks. */
  kind?: AssetKind;
}

/**
 * Legacy (v1) sequential clip. Still used as the wire format for the main
 * video track by the preview player, transcription and export pipeline.
 */
export interface Clip {
  id: string;
  mediaId: string;
  /** In-point in the source video, seconds. */
  sourceStart: number;
  /** Out-point in the source video, seconds. */
  sourceEnd: number;
}

/* ------------------------------------------------------------------ */
/* Multi-track timeline                                                */
/* ------------------------------------------------------------------ */

export type TrackType =
  | "video"
  | "broll"
  | "image"
  | "caption"
  | "text"
  | "sticker"
  | "music"
  | "sfx"
  | "voice"
  | "effects";

/**
 * Position/size on the 1080x1920 export canvas, anchored at the element's
 * center. x/y are offsets from canvas center; scale 1 = natural size for
 * overlays (images: width == canvas width).
 */
export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Styling for text-graphic clips. Pixel values on the 1080x1920 canvas. */
export interface TextClipStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 600 | 700 | 900;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string | null;
}

/** Visual effect applied by an effects-track clip over its time range. */
export interface ClipEffect {
  kind: "zoom" | "freeze" | "flash";
  /** Punch-in factor for zoom (1 = none, 1.15 = subtle punch). */
  zoomScale?: number;
  /** Zoom anchor as canvas fraction (0.5/0.5 = center). */
  anchorX?: number;
  anchorY?: number;
}

/** One clip on any track. Times are absolute timeline seconds. */
export interface TimelineClip {
  id: string;
  type: TrackType;
  /** MediaAsset id for video/broll/image/music/sfx/voice clips. */
  assetId?: string;
  startTime: number;
  endTime: number;
  /** Source in/out points for trimmed A/V media. */
  sourceStart?: number;
  sourceEnd?: number;
  /** Text content for text/sticker clips (sticker = emoji string). */
  text?: string;
  transform?: Partial<ClipTransform>;
  style?: Partial<TextClipStyle>;
  effect?: ClipEffect;
  /** 0..2 gain for audio-bearing clips (music/sfx/voice/broll). */
  volume?: number;
  /** Audio fade lengths, seconds. */
  fadeIn?: number;
  fadeOut?: number;
  metadata?: Record<string, unknown>;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  clips: TimelineClip[];
}

/* ------------------------------------------------------------------ */
/* Auto-edit engine                                                    */
/* ------------------------------------------------------------------ */

export type EditStyle =
  | "viral"
  | "clean"
  | "podcast"
  | "sports"
  | "storytime"
  | "educational"
  | "meme";

export interface TimeRange {
  start: number;
  end: number;
}

export interface CutInstruction extends TimeRange {
  reason: "silence" | "filler" | "repetition" | "off-topic" | "pacing";
}

export interface CaptionInstruction {
  captionId: string;
  /** Cleaned-up text (fillers stripped, punctuation fixed). */
  cleanText?: string;
  /** Words (by index) to emphasize. */
  emphasisWordIndexes?: number[];
}

export interface ZoomInstruction extends TimeRange {
  scale: number;
  reason: "emphasis" | "pattern-interrupt" | "hook";
}

export interface OverlayInstruction extends TimeRange {
  kind: "text" | "sticker";
  text: string;
  /** Canvas-center offset. */
  y?: number;
  role: "hook" | "cta" | "context";
}

export interface BrollSuggestion {
  time: number;
  keyword: string;
  reason: string;
}

export interface AudioInstruction {
  kind: "music-volume" | "duck-under-voice" | "add-music";
  value?: number;
  note: string;
}

export interface HookCandidate {
  text: string;
  startTime: number;
  endTime: number;
  score: number;
  reasons: string[];
}

export interface EditRecipe {
  id: string;
  projectId: string;
  style: EditStyle;
  /** Ranges of the ORIGINAL timeline kept, in output order (reorders allowed). */
  keptRanges: TimeRange[];
  cuts: CutInstruction[];
  captions: CaptionInstruction[];
  /** Times below are in the FINAL (post-cut) timeline. */
  zooms: ZoomInstruction[];
  overlays: OverlayInstruction[];
  brollSuggestions: BrollSuggestion[];
  audioInstructions: AudioInstruction[];
  hooks: HookCandidate[];
  exportPreset: ExportPresetId;
  reasoningSummary: string;
}

/* ------------------------------------------------------------------ */

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
  /** Color for emphasized words (auto-bolded important words). null = bold only. */
  emphasisColor?: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: MediaAsset[];
  /** Legacy v1 main-track clips; superseded by tracks (kept for old saves). */
  clips?: Clip[];
  /** v2 multi-track timeline. Absent on legacy projects (migrated on load). */
  tracks?: Track[];
  captions: Caption[];
  style: CaptionStyle;
  editRecipe?: EditRecipe;
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

export type ExportPresetId = "tiktok" | "tiktok-60" | "draft";

export interface ExportPreset {
  id: ExportPresetId;
  name: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  x264Preset: string;
}

export type TranscriptionLanguage = "auto" | "en" | "sv";
