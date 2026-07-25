/** Core shared types for CaptionCut. */

/** Word-level timing inside a caption chunk. Times are in seconds on the timeline. */
export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
  /** Speech-model confidence from 0..1. Cleared when the word is edited manually. */
  confidence?: number;
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
  /** Mean confidence of the timed words, 0..1. Undefined means manually edited/unavailable. */
  confidence?: number;
}

/** Which exact edited sources were transcribed to produce the current captions. */
export interface CaptionCoverage {
  /** Includes clip trims/speed and linked recorder identity/offset. */
  sourceSignature: string;
  coveredClipIds: string[];
}

export type AssetKind = "video" | "audio" | "image";

/** A user-created bin in the project media library. */
export interface MediaFolder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

/**
 * A source-level link between separately recorded video and audio files.
 * `offsetSeconds` is the delay of the audio relative to the video: positive
 * values start the audio later; negative values advance it.
 */
export interface LinkedAudioSource {
  audioAssetId: string;
  offsetSeconds: number;
  muteCameraAudio: boolean;
  syncMethod: "starts" | "waveform" | "manual";
  /** 0..1 waveform-match confidence when syncMethod is "waveform". */
  confidence?: number;
}

/** An uploaded source file (video, audio or image). */
export interface MediaAsset {
  id: string;
  /** Filename on disk (id + original extension). */
  filename: string;
  /** Durable public object URL when deployed with Vercel Blob. */
  storageUrl?: string;
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
  /** Optional project-library bin. The source file itself is unchanged. */
  folderId?: string;
  /** Separate recorder/microphone audio that follows this video source. */
  linkedAudio?: LinkedAudioSource;
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
  /** Playback rate (1 = normal). Timeline duration = source duration / speed. */
  speed?: number;
  /** Canvas framing: cover-crop (default) or letterboxed with a blurred fill. */
  fit?: ClipFit;
  /** Apply shake reduction (deshake + slight over-zoom) on export. */
  stabilize?: boolean;
}

/**
 * How a main-track clip fills the format canvas: "fill" cover-crops (default),
 * "fit" letterboxes the whole frame over a blurred copy of itself.
 */
export type ClipFit = "fill" | "fit";

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

/**
 * Visual effect applied by an effects-track clip over its time range.
 *
 * Kinds:
 *  - zoom       constant punch-in (zoomScale, anchors)
 *  - slow-zoom  ramps 1 → zoomScale across the clip (Ken Burns / subtle motion)
 *  - shake      deterministic handheld jitter (intensity 0..1)
 *  - vignette   cinematic edge darkening + slight contrast boost (strength 0..1)
 *  - impact     goal-impact combo: punch zoom + white flash + shake in one clip
 *  - freeze     hold the frame at the clip's start while the timeline runs
 *  - flash      soft white pop that decays over the clip
 */
export interface ClipEffect {
  kind: "zoom" | "slow-zoom" | "shake" | "vignette" | "impact" | "freeze" | "flash";
  /** zoom/impact: punch factor; slow-zoom: END scale of the 1→scale ramp. */
  zoomScale?: number;
  /** Zoom anchor as canvas fraction (0.5/0.5 = center). */
  anchorX?: number;
  anchorY?: number;
  /** shake/impact: jitter strength 0..1. */
  intensity?: number;
  /** vignette: darkening strength 0..1. */
  strength?: number;
  /** Motion character for animated zooms. Defaults to smooth. */
  easing?: "smooth" | "linear" | "snappy";
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
  /** Playback rate for main-track video (1 = normal, 0.85 = slow-mo ramp). */
  speed?: number;
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
  /** Main-track framing: cover-crop (default) or blurred-fill letterbox. */
  fit?: ClipFit;
  /** Main-track shake reduction: deshake on export, matched framing in preview. */
  stabilize?: boolean;
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

/** Football-montage presets (the clip-selection engine in lib/autoEdit/montage.ts). */
export type MontageStyle =
  | "hype"
  | "clean-recap"
  | "street"
  | "goals"
  | "community"
  | "interview"
  | "sponsor";

/** One-tap regenerate adjustments: nudge the next take without changing preset. */
export interface MontageModifiers {
  /** <1 = faster cuts, >1 = calmer cuts (multiplies segment length bounds). */
  pace?: number;
  /** Prefer moments of this kind when selecting (goals/action vs reactions/community). */
  favorKind?: "action" | "reaction";
  /** Dial punch-in zooms down/off for a cleaner look (multiplies zoom share). */
  effectsLevel?: number;
}

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
  reason: "emphasis" | "pattern-interrupt" | "hook" | "action" | "reaction";
  /** Punch-in anchor as canvas fraction (defaults 0.5 / 0.45). */
  anchorX?: number;
  anchorY?: number;
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

/** A concrete muted cutaway placed over interview audio on the B-roll track. */
export interface BrollPlacement extends TimeRange {
  assetId: string;
  sourceStart: number;
  sourceEnd: number;
  /** Why this cutaway was chosen; displayed in the draft review. */
  kind: "action" | "reaction";
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

/* ------------------------------------------------------------------ */
/* Media analysis (local FFmpeg signals — no API)                      */
/* ------------------------------------------------------------------ */

/** Per-asset audio analysis, sampled at `rate` Hz over the source file. */
export interface AudioAnalysis {
  rate: number;
  /** Normalized 0..1 RMS energy envelope. */
  energy: number[];
  /** Mean RMS level in dBFS (for cross-clip leveling). */
  loudness: number;
  /** Detected tempo; null when no confident musical beat exists. */
  bpm: number | null;
  /** 0..1-ish periodicity confidence behind bpm. */
  beatConfidence: number;
  /** Beat instants in source seconds (empty without confident bpm). */
  beats: number[];
}

/** Per-asset video analysis, sampled at `rate` Hz over the source file. */
export interface VideoAnalysis {
  rate: number;
  /** Normalized 0..1 frame-difference motion curve. */
  motion: number[];
  /**
   * Robust absolute motion level shared across assets (0..1). Used to stop a
   * quiet camera wobble from becoming a clip's artificial 100% action peak.
   */
  motionIntensity?: number;
  /** Hard-cut / scene-change instants in source seconds. */
  sceneChanges: number[];
  /**
   * Horizontal center of motion mass per sample (0 = left edge, 1 = right),
   * used to smart-crop horizontal footage to 9:16 without losing the action.
   * Absent on old caches (fall back to center crop).
   */
  motionCenterX?: number[];
  /** Samples/sec of motionCenterX (may differ from `rate`). */
  motionCenterRate?: number;
}

/** Cached local analysis of one media asset (data/analysis/<id>.json). */
export interface MediaAnalysis {
  version: number;
  assetId: string;
  duration: number;
  audio: AudioAnalysis | null;
  video: VideoAnalysis | null;
}

/** Analysis curves stitched into the CURRENT timeline's time domain. */
export interface TimelineSignals {
  /** Samples per second of the energy/motion curves. */
  rate: number;
  /** Normalized 0..1 audio energy across the timeline. */
  energy: number[];
  /** Normalized 0..1 motion across the timeline. */
  motion: number[];
  /** Scene changes + clip joins, timeline seconds. */
  sceneChanges: number[];
  /** Beat grid on the timeline (music track wins over footage audio). */
  beats: number[];
  bpm: number | null;
  duration: number;
  /** True when any main-track source had usable audio. */
  hasAudio: boolean;
  /**
   * Where the beat grid came from: a music track, beats in the footage audio,
   * the energy-onset fallback grid (cuts land on impacts, not a tempo), or a
   * manual BPM the user typed/tapped in.
   */
  beatSource?: "music" | "footage" | "energy" | "manual";
}

/** User-facing beat controls, persisted with the project. */
export interface BeatSettings {
  /** Manual tempo override; null/absent = use the detected grid. */
  bpmOverride?: number | null;
  /** false = auto edits ignore the beat grid entirely (default true). */
  beatSyncEnabled?: boolean;
}

/** A detected "moment worth keeping": goal, celebration, laugh, key line. */
export interface HighlightMoment {
  /** Peak instant, timeline seconds. */
  time: number;
  /** Suggested keep window around the peak. */
  start: number;
  end: number;
  score: number;
  kind: "action" | "reaction" | "speech" | "scene";
  label: string;
}

export interface EditRecipe {
  id: string;
  projectId: string;
  style: EditStyle | MontageStyle;
  /** Ranges of the ORIGINAL timeline kept, in output order (reorders allowed). */
  keptRanges: TimeRange[];
  /** Playback rate per kept range (parallel to keptRanges; 1/undefined = normal). */
  rangeSpeeds?: (number | undefined)[];
  cuts: CutInstruction[];
  captions: CaptionInstruction[];
  /** Times below are in the FINAL (post-cut) timeline. */
  zooms: ZoomInstruction[];
  /** White flash pops on the biggest moments (FINAL-timeline times). */
  flashes?: TimeRange[];
  /**
   * The song section the soundtrack should play (source seconds): the engine
   * picks the highest-energy stretch (drop/chorus) so the montage doesn't sit
   * on a quiet intro. The applier retrims the music clip to this section and
   * cuts it to the final video length.
   */
  musicCut?: { sourceStart: number; sourceEnd: number };
  overlays: OverlayInstruction[];
  /** Realized interview cutaways on the final timeline. */
  brollPlacements?: BrollPlacement[];
  brollSuggestions: BrollSuggestion[];
  audioInstructions: AudioInstruction[];
  hooks: HookCandidate[];
  /** Signal-detected highlights (FINAL-timeline times). Absent on old saves. */
  highlights?: HighlightMoment[];
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

/**
 * A named snapshot of the edit (timeline + captions + caption style) the user
 * can restore. "pre-auto-edit"/"auto-edit" pairs are written automatically
 * around every auto edit so "Reset to auto edit" always works.
 */
export interface EditVersion {
  id: string;
  name: string;
  createdAt: number;
  kind: "manual" | "auto-edit" | "pre-auto-edit";
  tracks: Track[];
  captions: Caption[];
  captionCoverage?: CaptionCoverage;
  style: CaptionStyle;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: MediaAsset[];
  /** Named bins in the non-destructive media library. */
  mediaFolders?: MediaFolder[];
  /** Legacy v1 main-track clips; superseded by tracks (kept for old saves). */
  clips?: Clip[];
  /** v2 multi-track timeline. Absent on legacy projects (migrated on load). */
  tracks?: Track[];
  captions: Caption[];
  /** Persisted so selected-only captions are never mistaken for a full transcript. */
  captionCoverage?: CaptionCoverage;
  style: CaptionStyle;
  editRecipe?: EditRecipe;
  /** Editing/preview aspect ratio. Absent on old saves (= "9:16"). */
  format?: AspectRatioId;
  /** Saved edit versions (restore points). Absent on old saves. */
  versions?: EditVersion[];
  /** Beat-sync controls (manual BPM, on/off). Absent on old saves. */
  beat?: BeatSettings;
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
  /** Durable download URL for completed cloud exports. */
  downloadUrl?: string;
}

export type ExportPresetId = "tiktok" | "tiktok-60" | "square" | "landscape" | "draft";

export interface ExportPreset {
  id: ExportPresetId;
  name: string;
  description: string;
  /** Output file dimensions. */
  width: number;
  height: number;
  /**
   * Composition canvas: captions/overlays/crops are laid out at this size,
   * then scaled to width×height (lets the 720p draft reuse the 1080 layout).
   */
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  crf: number;
  x264Preset: string;
}

export type TranscriptionLanguage = "auto" | "en" | "sv";

/** Local Whisper speed/accuracy trade-off. WHISPER_MODEL still overrides the mapped model. */
export type TranscriptionQuality = "fast" | "accurate";

/** Project aspect ratio: drives the preview canvas and the default export preset. */
export type AspectRatioId = "9:16" | "1:1" | "16:9";
