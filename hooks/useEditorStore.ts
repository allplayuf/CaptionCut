"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  Caption,
  CaptionStyle,
  Clip,
  MediaAsset,
  Project,
  WordTiming,
} from "@/types";
import { DEFAULT_STYLE } from "@/lib/captions/presets";
import { clipDuration, timelineToSource, totalDuration } from "@/lib/video/timeline";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
}

interface EditorState {
  // project
  projectId: string;
  projectName: string;
  createdAt: number;
  media: MediaAsset[];
  clips: Clip[];
  captions: Caption[];
  style: CaptionStyle;
  /** Bumped on every content edit; drives autosave. */
  revision: number;

  // playback
  currentTime: number;
  isPlaying: boolean;

  // ui
  selectedClipId: string | null;
  selectedCaptionId: string | null;
  showSafeZones: boolean;
  isTranscribing: boolean;
  /** Decoded waveform peaks per media id; null = decode failed (placeholder shown). */
  waveforms: Record<string, number[] | null>;
  toasts: Toast[];

  // actions
  resetToNewProject: () => void;
  loadProject: (project: Project) => void;
  setProjectName: (name: string) => void;

  addMedia: (asset: MediaAsset) => void;
  addClipFromMedia: (mediaId: string) => void;
  deleteClip: (clipId: string) => void;
  moveClip: (clipId: string, direction: -1 | 1) => void;
  trimClip: (clipId: string, patch: { sourceStart?: number; sourceEnd?: number }) => void;
  splitAtPlayhead: () => void;

  setCaptions: (captions: Caption[]) => void;
  updateCaptionText: (id: string, text: string) => void;
  updateCaptionTiming: (id: string, startTime: number, endTime: number) => void;
  deleteCaption: (id: string) => void;
  addCaptionAtPlayhead: () => void;

  setStyle: (patch: Partial<CaptionStyle>) => void;
  applyPreset: (style: CaptionStyle) => void;

  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  selectClip: (id: string | null) => void;
  selectCaption: (id: string | null) => void;
  toggleSafeZones: () => void;
  setTranscribing: (value: boolean) => void;
  setWaveform: (mediaId: string, peaks: number[] | null) => void;

  addToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: nanoid(10),
  projectName: "Untitled project",
  createdAt: Date.now(),
  media: [],
  clips: [],
  captions: [],
  style: { ...DEFAULT_STYLE },
  revision: 0,

  currentTime: 0,
  isPlaying: false,

  selectedClipId: null,
  selectedCaptionId: null,
  showSafeZones: true,
  isTranscribing: false,
  waveforms: {},
  toasts: [],

  resetToNewProject: () =>
    set({
      projectId: nanoid(10),
      projectName: "Untitled project",
      createdAt: Date.now(),
      media: [],
      clips: [],
      captions: [],
      style: { ...DEFAULT_STYLE },
      revision: 0,
      currentTime: 0,
      isPlaying: false,
      selectedClipId: null,
      selectedCaptionId: null,
    }),

  loadProject: (project) =>
    set({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      media: project.media ?? [],
      clips: project.clips ?? [],
      captions: project.captions ?? [],
      style: { ...DEFAULT_STYLE, ...project.style },
      revision: 0,
      currentTime: 0,
      isPlaying: false,
      selectedClipId: null,
      selectedCaptionId: null,
    }),

  setProjectName: (name) => set((s) => ({ projectName: name, revision: s.revision + 1 })),

  addMedia: (asset) =>
    set((s) => {
      const clip: Clip = {
        id: nanoid(8),
        mediaId: asset.id,
        sourceStart: 0,
        sourceEnd: asset.duration,
      };
      return {
        media: [...s.media, asset],
        clips: [...s.clips, clip],
        selectedClipId: clip.id,
        revision: s.revision + 1,
      };
    }),

  addClipFromMedia: (mediaId) =>
    set((s) => {
      const asset = s.media.find((m) => m.id === mediaId);
      if (!asset) return s;
      const clip: Clip = {
        id: nanoid(8),
        mediaId,
        sourceStart: 0,
        sourceEnd: asset.duration,
      };
      return { clips: [...s.clips, clip], selectedClipId: clip.id, revision: s.revision + 1 };
    }),

  deleteClip: (clipId) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== clipId),
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
      revision: s.revision + 1,
    })),

  moveClip: (clipId, direction) =>
    set((s) => {
      const index = s.clips.findIndex((c) => c.id === clipId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= s.clips.length) return s;
      const clips = [...s.clips];
      [clips[index], clips[target]] = [clips[target], clips[index]];
      return { clips, revision: s.revision + 1 };
    }),

  trimClip: (clipId, patch) =>
    set((s) => {
      const clips = s.clips.map((c) => {
        if (c.id !== clipId) return c;
        const asset = s.media.find((m) => m.id === c.mediaId);
        const maxEnd = asset?.duration ?? c.sourceEnd;
        let sourceStart = patch.sourceStart ?? c.sourceStart;
        let sourceEnd = patch.sourceEnd ?? c.sourceEnd;
        sourceStart = Math.max(0, Math.min(sourceStart, sourceEnd - 0.2));
        sourceEnd = Math.min(maxEnd, Math.max(sourceEnd, sourceStart + 0.2));
        return { ...c, sourceStart, sourceEnd };
      });
      return { clips, revision: s.revision + 1 };
    }),

  splitAtPlayhead: () => {
    const s = get();
    const pos = timelineToSource(s.clips, s.currentTime);
    if (!pos) return;
    const { clip, clipIndex, clipTimelineStart } = pos;
    const offset = s.currentTime - clipTimelineStart;
    // Don't create sub-0.2s slivers.
    if (offset < 0.2 || offset > clipDuration(clip) - 0.2) {
      get().addToast("info", "Move the playhead inside a clip to split it.");
      return;
    }
    const splitPoint = clip.sourceStart + offset;
    const left: Clip = { ...clip, id: nanoid(8), sourceEnd: splitPoint };
    const right: Clip = { ...clip, id: nanoid(8), sourceStart: splitPoint };
    const clips = [...s.clips];
    clips.splice(clipIndex, 1, left, right);
    set({ clips, selectedClipId: right.id, revision: s.revision + 1 });
  },

  setCaptions: (captions) =>
    set((s) => ({ captions, selectedCaptionId: null, revision: s.revision + 1 })),

  updateCaptionText: (id, text) =>
    set((s) => ({
      captions: s.captions.map((c) =>
        c.id === id ? { ...c, text, words: remapWords(c, text) } : c
      ),
      revision: s.revision + 1,
    })),

  updateCaptionTiming: (id, startTime, endTime) =>
    set((s) => ({
      captions: s.captions
        .map((c) => {
          if (c.id !== id) return c;
          const start = Math.max(0, Math.min(startTime, endTime - 0.1));
          const end = Math.max(start + 0.1, endTime);
          return {
            ...c,
            startTime: start,
            endTime: end,
            words: retimeWords(c.words, c.startTime, c.endTime, start, end),
          };
        })
        .sort((a, b) => a.startTime - b.startTime),
      revision: s.revision + 1,
    })),

  deleteCaption: (id) =>
    set((s) => ({
      captions: s.captions.filter((c) => c.id !== id),
      selectedCaptionId: s.selectedCaptionId === id ? null : s.selectedCaptionId,
      revision: s.revision + 1,
    })),

  addCaptionAtPlayhead: () => {
    const s = get();
    const duration = totalDuration(s.clips);
    if (duration <= 0) {
      get().addToast("info", "Add a video to the timeline first.");
      return;
    }
    const start = Math.min(s.currentTime, Math.max(0, duration - 0.5));
    const caption: Caption = {
      id: nanoid(8),
      startTime: Math.round(start * 1000) / 1000,
      endTime: Math.round(Math.min(duration, start + 2) * 1000) / 1000,
      text: "New caption",
    };
    set({
      captions: [...s.captions, caption].sort((a, b) => a.startTime - b.startTime),
      selectedCaptionId: caption.id,
      revision: s.revision + 1,
    });
  },

  setStyle: (patch) =>
    set((s) => ({ style: { ...s.style, ...patch }, revision: s.revision + 1 })),

  applyPreset: (style) => set((s) => ({ style: { ...style }, revision: s.revision + 1 })),

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  selectClip: (id) => set({ selectedClipId: id }),
  selectCaption: (id) => set({ selectedCaptionId: id }),
  toggleSafeZones: () => set((s) => ({ showSafeZones: !s.showSafeZones })),
  setTranscribing: (value) => set({ isTranscribing: value }),
  setWaveform: (mediaId, peaks) =>
    set((s) => ({ waveforms: { ...s.waveforms, [mediaId]: peaks } })),

  addToast: (kind, message) => {
    const id = nanoid(6);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Keep word-level highlight timings usable after a text edit: if the word
 * count is unchanged, keep the original timings; otherwise redistribute the
 * caption's duration evenly across the new words.
 */
function remapWords(caption: Caption, newText: string): WordTiming[] | undefined {
  if (!caption.words) return undefined;
  const newWords = newText.trim().split(/\s+/).filter(Boolean);
  if (newWords.length === 0) return undefined;
  if (newWords.length === caption.words.length) {
    return caption.words.map((w, i) => ({ ...w, word: newWords[i] }));
  }
  const dur = caption.endTime - caption.startTime;
  const per = dur / newWords.length;
  return newWords.map((word, i) => ({
    word,
    startTime: caption.startTime + i * per,
    endTime: caption.startTime + (i + 1) * per,
  }));
}

/** Linearly rescale word timings into a caption's new time range. */
function retimeWords(
  words: WordTiming[] | undefined,
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number
): WordTiming[] | undefined {
  if (!words) return undefined;
  const oldDur = Math.max(0.001, oldEnd - oldStart);
  const scale = (newEnd - newStart) / oldDur;
  return words.map((w) => ({
    ...w,
    startTime: newStart + (w.startTime - oldStart) * scale,
    endTime: newStart + (w.endTime - oldStart) * scale,
  }));
}

/** Assemble the current editor state into a serializable Project. */
export function buildProjectSnapshot(state: EditorState): Project {
  return {
    id: state.projectId,
    name: state.projectName,
    createdAt: state.createdAt,
    updatedAt: Date.now(),
    media: state.media,
    clips: state.clips,
    captions: state.captions,
    style: state.style,
  };
}
