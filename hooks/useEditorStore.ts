"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  Caption,
  CaptionStyle,
  ClipEffect,
  EditRecipe,
  MediaAsset,
  Project,
  TimeRange,
  TimelineClip,
  Track,
  TrackType,
  WordTiming,
} from "@/types";
import { DEFAULT_STYLE } from "@/lib/captions/presets";
import { cleanCaptions } from "@/lib/captions/clean";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import {
  assetKind,
  createDefaultTracks,
  mainClips,
  mainVideoTrack,
  makeMainClip,
  migrateTracks,
  placeWithoutOverlap,
  rearrangeMainTrack,
  remapCaptions,
  remapOverlayTracks,
  rippleMainTrack,
  round3,
  tracksDuration,
} from "@/lib/timeline/tracks";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
}

/** Everything undo/redo restores. */
interface HistoryEntry {
  tracks: Track[];
  captions: Caption[];
  style: CaptionStyle;
  projectName: string;
}

const HISTORY_LIMIT = 100;
const MIN_CLIP = 0.15;

interface EditorState {
  // project
  projectId: string;
  projectName: string;
  createdAt: number;
  media: MediaAsset[];
  tracks: Track[];
  captions: Caption[];
  style: CaptionStyle;
  editRecipe: EditRecipe | null;
  /** Bumped on every content edit; drives autosave. */
  revision: number;

  // history
  past: HistoryEntry[];
  future: HistoryEntry[];

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

  // project actions
  resetToNewProject: () => void;
  loadProject: (project: Project) => void;
  setProjectName: (name: string) => void;

  // history
  undo: () => void;
  redo: () => void;

  // media / clips
  addMedia: (asset: MediaAsset) => void;
  addClipFromMedia: (mediaId: string) => void;
  addMediaToTrack: (mediaId: string, trackType: TrackType, atTime?: number) => void;
  deleteClip: (clipId: string) => void;
  moveClip: (clipId: string, direction: -1 | 1) => void;
  moveTimelineClip: (clipId: string, newStart: number) => void;
  trimTimelineClip: (clipId: string, edge: "start" | "end", newTime: number) => void;
  splitAtPlayhead: () => void;
  updateTimelineClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  addTextClip: (text: string, atTime?: number, duration?: number) => void;
  addStickerClip: (emoji: string, atTime?: number) => void;
  addZoomClip: (atTime: number, duration: number, effect: ClipEffect) => void;

  // tracks
  toggleTrackLocked: (trackId: string) => void;
  toggleTrackMuted: (trackId: string) => void;
  toggleTrackHidden: (trackId: string) => void;

  // captions
  setCaptions: (captions: Caption[]) => void;
  updateCaptionText: (id: string, text: string) => void;
  updateCaptionTiming: (id: string, startTime: number, endTime: number) => void;
  deleteCaption: (id: string) => void;
  addCaptionAtPlayhead: () => void;
  mergeCaptionWithNext: (id: string) => void;
  splitCaption: (id: string) => void;
  shiftAllCaptions: (delta: number) => void;
  searchReplaceCaptions: (find: string, replace: string) => number;

  // auto edit
  applyRearrange: (keptRanges: TimeRange[], summary?: string) => void;
  applyEditRecipe: (recipe: EditRecipe) => void;
  cleanAllCaptions: () => void;
  setEditRecipe: (recipe: EditRecipe | null) => void;

  // style
  setStyle: (patch: Partial<CaptionStyle>) => void;
  applyPreset: (style: CaptionStyle) => void;

  // playback / ui
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

export const useEditorStore = create<EditorState>((set, get) => {
  const snapshotOf = (s: EditorState): HistoryEntry => ({
    tracks: s.tracks,
    captions: s.captions,
    style: s.style,
    projectName: s.projectName,
  });

  /** Apply a content mutation, recording history. Return {} from fn to bail. */
  const commit = (fn: (s: EditorState) => Partial<EditorState>) =>
    set((s) => {
      const patch = fn(s);
      if (Object.keys(patch).length === 0) return s;
      return {
        ...patch,
        past: [...s.past, snapshotOf(s)].slice(-HISTORY_LIMIT),
        future: [],
        revision: s.revision + 1,
      };
    });

  /** Locate a clip and its track anywhere on the timeline. */
  const locate = (
    tracks: Track[],
    clipId: string
  ): { track: Track; clip: TimelineClip; trackIndex: number; clipIndex: number } | null => {
    for (let ti = 0; ti < tracks.length; ti++) {
      const ci = tracks[ti].clips.findIndex((c) => c.id === clipId);
      if (ci >= 0) return { track: tracks[ti], clip: tracks[ti].clips[ci], trackIndex: ti, clipIndex: ci };
    }
    return null;
  };

  const replaceTrack = (tracks: Track[], index: number, track: Track): Track[] => {
    const next = [...tracks];
    next[index] = track;
    return next;
  };

  const guardLocked = (track: Track): boolean => {
    if (track.locked) {
      get().addToast("info", `"${track.name}" track is locked.`);
      return true;
    }
    return false;
  };

  return {
    projectId: nanoid(10),
    projectName: "Untitled project",
    createdAt: Date.now(),
    media: [],
    tracks: createDefaultTracks(),
    captions: [],
    style: { ...DEFAULT_STYLE },
    editRecipe: null,
    revision: 0,

    past: [],
    future: [],

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
        tracks: createDefaultTracks(),
        captions: [],
        style: { ...DEFAULT_STYLE },
        editRecipe: null,
        revision: 0,
        past: [],
        future: [],
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
        tracks: migrateTracks(project),
        captions: project.captions ?? [],
        style: { ...DEFAULT_STYLE, ...project.style },
        editRecipe: project.editRecipe ?? null,
        revision: 0,
        past: [],
        future: [],
        currentTime: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedCaptionId: null,
      }),

    setProjectName: (name) => commit(() => ({ projectName: name })),

    undo: () =>
      set((s) => {
        const entry = s.past[s.past.length - 1];
        if (!entry) return s;
        return {
          ...entry,
          past: s.past.slice(0, -1),
          future: [snapshotOf(s), ...s.future].slice(0, HISTORY_LIMIT),
          revision: s.revision + 1,
          selectedClipId: null,
          selectedCaptionId: null,
        };
      }),

    redo: () =>
      set((s) => {
        const entry = s.future[0];
        if (!entry) return s;
        return {
          ...entry,
          past: [...s.past, snapshotOf(s)].slice(-HISTORY_LIMIT),
          future: s.future.slice(1),
          revision: s.revision + 1,
          selectedClipId: null,
          selectedCaptionId: null,
        };
      }),

    /* ---------------- media & clips ---------------- */

    addMedia: (asset) =>
      commit((s) => {
        const kind = assetKind(asset);
        const media = [...s.media, asset];
        if (kind !== "video") return { media };
        // Videos land on the main track immediately.
        const vi = s.tracks.findIndex((t) => t.type === "video");
        const video = s.tracks[vi];
        const clip = makeMainClip(asset);
        return {
          media,
          tracks: replaceTrack(s.tracks, vi, rippleMainTrack({ ...video, clips: [...video.clips, clip] })),
          selectedClipId: clip.id,
        };
      }),

    addClipFromMedia: (mediaId) =>
      commit((s) => {
        const asset = s.media.find((m) => m.id === mediaId);
        if (!asset || assetKind(asset) !== "video") return {};
        const vi = s.tracks.findIndex((t) => t.type === "video");
        const video = s.tracks[vi];
        if (guardLocked(video)) return {};
        const clip = makeMainClip(asset);
        return {
          tracks: replaceTrack(s.tracks, vi, rippleMainTrack({ ...video, clips: [...video.clips, clip] })),
          selectedClipId: clip.id,
        };
      }),

    addMediaToTrack: (mediaId, trackType, atTime) =>
      commit((s) => {
        const asset = s.media.find((m) => m.id === mediaId);
        if (!asset) return {};
        if (trackType === "video") return {}; // use addClipFromMedia
        const ti = s.tracks.findIndex((t) => t.type === trackType);
        if (ti < 0) return {};
        const track = s.tracks[ti];
        if (guardLocked(track)) return {};

        const kind = assetKind(asset);
        const projectDur = tracksDuration(s.tracks);
        const start = round3(Math.max(0, atTime ?? s.currentTime));
        const defaultDur =
          kind === "image" ? 4 : Math.max(0.5, asset.duration);
        const maxEnd = projectDur > 0 ? projectDur : start + defaultDur;
        const end = round3(Math.min(start + defaultDur, Math.max(maxEnd, start + 0.5)));

        let clip: TimelineClip = {
          id: nanoid(8),
          type: trackType,
          assetId: asset.id,
          startTime: start,
          endTime: end,
          sourceStart: kind === "image" ? undefined : 0,
          sourceEnd: kind === "image" ? undefined : round3(Math.min(asset.duration, end - start)),
          volume: trackType === "music" ? 0.15 : trackType === "broll" ? 0 : 1,
          fadeIn: trackType === "music" ? 0.8 : undefined,
          fadeOut: trackType === "music" ? 0.8 : undefined,
          transform:
            trackType === "image" ? { x: 0, y: 0, scale: 0.8, rotation: 0, opacity: 1 } : undefined,
        };
        clip = placeWithoutOverlap(track, clip);
        return {
          tracks: replaceTrack(s.tracks, ti, { ...track, clips: [...track.clips, clip] }),
          selectedClipId: clip.id,
        };
      }),

    deleteClip: (clipId) =>
      commit((s) => {
        const loc = locate(s.tracks, clipId);
        if (!loc || guardLocked(loc.track)) return {};
        const clips = loc.track.clips.filter((c) => c.id !== clipId);
        let track = { ...loc.track, clips };
        if (track.type === "video") track = rippleMainTrack(track);
        return {
          tracks: replaceTrack(s.tracks, loc.trackIndex, track),
          selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
        };
      }),

    moveClip: (clipId, direction) =>
      commit((s) => {
        const loc = locate(s.tracks, clipId);
        if (!loc || loc.track.type !== "video" || guardLocked(loc.track)) return {};
        const target = loc.clipIndex + direction;
        if (target < 0 || target >= loc.track.clips.length) return {};
        const clips = [...loc.track.clips];
        [clips[loc.clipIndex], clips[target]] = [clips[target], clips[loc.clipIndex]];
        return {
          tracks: replaceTrack(s.tracks, loc.trackIndex, rippleMainTrack({ ...loc.track, clips })),
        };
      }),

    moveTimelineClip: (clipId, newStart) =>
      commit((s) => {
        const loc = locate(s.tracks, clipId);
        if (!loc || guardLocked(loc.track)) return {};
        if (loc.track.type === "video") return {}; // main track is ripple-ordered
        const dur = loc.clip.endTime - loc.clip.startTime;
        const start = round3(Math.max(0, newStart));
        const moved = { ...loc.clip, startTime: start, endTime: round3(start + dur) };
        const placed = placeWithoutOverlap(loc.track, moved);
        const clips = loc.track.clips.map((c) => (c.id === clipId ? placed : c));
        return { tracks: replaceTrack(s.tracks, loc.trackIndex, { ...loc.track, clips }) };
      }),

    trimTimelineClip: (clipId, edge, newTime) =>
      commit((s) => {
        const loc = locate(s.tracks, clipId);
        if (!loc || guardLocked(loc.track)) return {};
        const { clip, track } = loc;
        const asset = clip.assetId ? s.media.find((m) => m.id === clip.assetId) : undefined;
        const hasSource = clip.sourceStart !== undefined && clip.sourceEnd !== undefined;

        let next: TimelineClip;
        if (track.type === "video") {
          // Main track: trimming adjusts source in/out; ripple re-layout follows.
          const sourceStart = clip.sourceStart ?? 0;
          const sourceEnd = clip.sourceEnd ?? 0;
          const delta = newTime - (edge === "start" ? clip.startTime : clip.endTime);
          if (edge === "start") {
            const ns = Math.max(0, Math.min(sourceStart + delta, sourceEnd - MIN_CLIP));
            next = { ...clip, sourceStart: round3(ns) };
          } else {
            const maxEnd = asset?.duration ?? sourceEnd;
            const ne = Math.min(maxEnd, Math.max(sourceEnd + delta, sourceStart + MIN_CLIP));
            next = { ...clip, sourceEnd: round3(ne) };
          }
          const clips = track.clips.map((c) => (c.id === clipId ? next : c));
          return {
            tracks: replaceTrack(s.tracks, loc.trackIndex, rippleMainTrack({ ...track, clips })),
          };
        }

        // Free tracks: trim timeline edges (and source edges for A/V media).
        if (edge === "start") {
          const start = round3(Math.max(0, Math.min(newTime, clip.endTime - MIN_CLIP)));
          next = { ...clip, startTime: start };
          if (hasSource) {
            const shift = start - clip.startTime;
            next.sourceStart = round3(
              Math.max(0, Math.min((clip.sourceStart ?? 0) + shift, (clip.sourceEnd ?? 0) - MIN_CLIP))
            );
          }
        } else {
          let end = round3(Math.max(newTime, clip.startTime + MIN_CLIP));
          if (hasSource && asset) {
            const maxDur = (asset.duration || Infinity) - (clip.sourceStart ?? 0);
            end = Math.min(end, round3(clip.startTime + maxDur));
          }
          next = { ...clip, endTime: end };
          if (hasSource) {
            next.sourceEnd = round3((clip.sourceStart ?? 0) + (end - next.startTime));
          }
        }
        // Don't run into neighbors.
        const neighbors = track.clips.filter((c) => c.id !== clipId);
        for (const other of neighbors) {
          if (next.startTime < other.endTime && next.endTime > other.startTime) return {};
        }
        const clips = track.clips.map((c) => (c.id === clipId ? next : c));
        return { tracks: replaceTrack(s.tracks, loc.trackIndex, { ...track, clips }) };
      }),

    splitAtPlayhead: () => {
      const s = get();
      const time = s.currentTime;

      // Prefer splitting the selected clip's track; default to the main track.
      const loc = s.selectedClipId ? locate(s.tracks, s.selectedClipId) : null;
      const targetTrack =
        loc && time > loc.clip.startTime && time < loc.clip.endTime ? loc.track : mainVideoTrack(s.tracks);

      commit((st) => {
        const ti = st.tracks.findIndex((t) => t.id === targetTrack.id);
        if (ti < 0) return {};
        const track = st.tracks[ti];
        if (guardLocked(track)) return {};
        const clip = track.clips.find((c) => time > c.startTime + MIN_CLIP && time < c.endTime - MIN_CLIP);
        if (!clip) {
          get().addToast("info", "Move the playhead inside a clip to split it.");
          return {};
        }
        const offset = time - clip.startTime;
        const hasSource = clip.sourceStart !== undefined;
        const splitSource = hasSource ? (clip.sourceStart ?? 0) + offset : undefined;

        const left: TimelineClip = {
          ...clip,
          id: nanoid(8),
          endTime: round3(time),
          sourceEnd: hasSource ? round3(splitSource!) : clip.sourceEnd,
        };
        const right: TimelineClip = {
          ...clip,
          id: nanoid(8),
          startTime: round3(time),
          sourceStart: hasSource ? round3(splitSource!) : clip.sourceStart,
        };
        const idx = track.clips.findIndex((c) => c.id === clip.id);
        const clips = [...track.clips];
        clips.splice(idx, 1, left, right);
        let nextTrack: Track = { ...track, clips };
        if (nextTrack.type === "video") nextTrack = rippleMainTrack(nextTrack);
        return {
          tracks: replaceTrack(st.tracks, ti, nextTrack),
          selectedClipId: right.id,
        };
      });
    },

    updateTimelineClip: (clipId, patch) =>
      commit((s) => {
        const loc = locate(s.tracks, clipId);
        if (!loc || guardLocked(loc.track)) return {};
        const clips = loc.track.clips.map((c) => (c.id === clipId ? { ...c, ...patch, id: c.id } : c));
        let track: Track = { ...loc.track, clips };
        if (track.type === "video") track = rippleMainTrack(track);
        return { tracks: replaceTrack(s.tracks, loc.trackIndex, track) };
      }),

    addTextClip: (text, atTime, duration = 3) =>
      commit((s) => {
        const ti = s.tracks.findIndex((t) => t.type === "text");
        if (ti < 0) return {};
        const track = s.tracks[ti];
        if (guardLocked(track)) return {};
        const start = round3(Math.max(0, atTime ?? s.currentTime));
        const clip = placeWithoutOverlap(track, {
          id: nanoid(8),
          type: "text",
          text,
          startTime: start,
          endTime: round3(start + duration),
          transform: { x: 0, y: -520, scale: 1, rotation: 0, opacity: 1 },
          style: {
            fontFamily: "Arial",
            fontSize: 64,
            fontWeight: 900,
            color: "#FFFFFF",
            strokeColor: "#000000",
            strokeWidth: 5,
            backgroundColor: null,
          },
        });
        return {
          tracks: replaceTrack(s.tracks, ti, { ...track, clips: [...track.clips, clip] }),
          selectedClipId: clip.id,
        };
      }),

    addStickerClip: (emoji, atTime) =>
      commit((s) => {
        const ti = s.tracks.findIndex((t) => t.type === "sticker");
        if (ti < 0) return {};
        const track = s.tracks[ti];
        if (guardLocked(track)) return {};
        const start = round3(Math.max(0, atTime ?? s.currentTime));
        const clip = placeWithoutOverlap(track, {
          id: nanoid(8),
          type: "sticker",
          text: emoji,
          startTime: start,
          endTime: round3(start + 2),
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
          style: { fontSize: 160 } as TimelineClip["style"],
        });
        return {
          tracks: replaceTrack(s.tracks, ti, { ...track, clips: [...track.clips, clip] }),
          selectedClipId: clip.id,
        };
      }),

    addZoomClip: (atTime, duration, effect) =>
      commit((s) => {
        const ti = s.tracks.findIndex((t) => t.type === "effects");
        if (ti < 0) return {};
        const track = s.tracks[ti];
        if (guardLocked(track)) return {};
        const clip = placeWithoutOverlap(track, {
          id: nanoid(8),
          type: "effects",
          startTime: round3(atTime),
          endTime: round3(atTime + duration),
          effect,
        });
        return {
          tracks: replaceTrack(s.tracks, ti, { ...track, clips: [...track.clips, clip] }),
          selectedClipId: clip.id,
        };
      }),

    /* ---------------- tracks ---------------- */

    toggleTrackLocked: (trackId) =>
      commit((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
      })),
    toggleTrackMuted: (trackId) =>
      commit((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
      })),
    toggleTrackHidden: (trackId) =>
      commit((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, hidden: !t.hidden } : t)),
      })),

    /* ---------------- captions ---------------- */

    setCaptions: (captions) => commit(() => ({ captions, selectedCaptionId: null })),

    updateCaptionText: (id, text) =>
      commit((s) => ({
        captions: s.captions.map((c) => (c.id === id ? { ...c, text, words: remapWords(c, text) } : c)),
      })),

    updateCaptionTiming: (id, startTime, endTime) =>
      commit((s) => ({
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
      })),

    deleteCaption: (id) =>
      commit((s) => ({
        captions: s.captions.filter((c) => c.id !== id),
        selectedCaptionId: s.selectedCaptionId === id ? null : s.selectedCaptionId,
      })),

    addCaptionAtPlayhead: () => {
      const s = get();
      const duration = tracksDuration(s.tracks);
      if (duration <= 0) {
        get().addToast("info", "Add a video to the timeline first.");
        return;
      }
      const start = Math.min(s.currentTime, Math.max(0, duration - 0.5));
      const caption: Caption = {
        id: nanoid(8),
        startTime: round3(start),
        endTime: round3(Math.min(duration, start + 2)),
        text: "New caption",
      };
      commit((st) => ({
        captions: [...st.captions, caption].sort((a, b) => a.startTime - b.startTime),
        selectedCaptionId: caption.id,
      }));
    },

    mergeCaptionWithNext: (id) =>
      commit((s) => {
        const sorted = [...s.captions].sort((a, b) => a.startTime - b.startTime);
        const i = sorted.findIndex((c) => c.id === id);
        if (i < 0 || i >= sorted.length - 1) return {};
        const a = sorted[i];
        const b = sorted[i + 1];
        const words =
          a.words && b.words ? [...a.words, ...b.words] : undefined;
        const merged: Caption = {
          ...a,
          endTime: b.endTime,
          text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
          words,
        };
        sorted.splice(i, 2, merged);
        return { captions: sorted, selectedCaptionId: merged.id };
      }),

    splitCaption: (id) =>
      commit((s) => {
        const sorted = [...s.captions].sort((a, b) => a.startTime - b.startTime);
        const i = sorted.findIndex((c) => c.id === id);
        if (i < 0) return {};
        const cap = sorted[i];
        const words =
          cap.words && cap.words.length >= 2
            ? cap.words
            : cap.text
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((word, wi, arr) => {
                  const per = (cap.endTime - cap.startTime) / arr.length;
                  return {
                    word,
                    startTime: cap.startTime + wi * per,
                    endTime: cap.startTime + (wi + 1) * per,
                  };
                });
        if (words.length < 2) return {};
        const mid = Math.ceil(words.length / 2);
        const first = words.slice(0, mid);
        const second = words.slice(mid);
        const hadWords = Boolean(cap.words);
        const left: Caption = {
          ...cap,
          endTime: round3(second[0].startTime),
          text: first.map((w) => w.word).join(" "),
          words: hadWords ? first : undefined,
        };
        const right: Caption = {
          ...cap,
          id: nanoid(8),
          startTime: round3(second[0].startTime),
          text: second.map((w) => w.word).join(" "),
          words: hadWords ? second : undefined,
        };
        sorted.splice(i, 1, left, right);
        return { captions: sorted, selectedCaptionId: left.id };
      }),

    shiftAllCaptions: (delta) =>
      commit((s) => ({
        captions: s.captions.map((c) => ({
          ...c,
          startTime: round3(Math.max(0, c.startTime + delta)),
          endTime: round3(Math.max(0.1, c.endTime + delta)),
          words: c.words?.map((w) => ({
            ...w,
            startTime: round3(Math.max(0, w.startTime + delta)),
            endTime: round3(Math.max(0, w.endTime + delta)),
          })),
        })),
      })),

    searchReplaceCaptions: (find, replace) => {
      if (!find) return 0;
      let count = 0;
      const pattern = new RegExp(escapeRegExp(find), "gi");
      commit((s) => {
        const captions = s.captions.map((c) => {
          const matches = c.text.match(pattern);
          if (!matches) return c;
          count += matches.length;
          const text = c.text.replace(pattern, replace);
          return { ...c, text, words: remapWords(c, text) };
        });
        if (count === 0) return {};
        return { captions };
      });
      return count;
    },

    /* ---------------- auto edit ---------------- */

    applyRearrange: (keptRanges, summary) => {
      commit((s) => {
        const vi = s.tracks.findIndex((t) => t.type === "video");
        if (vi < 0) return {};
        const newMain = rearrangeMainTrack(s.tracks[vi], keptRanges);
        if (newMain.clips.length === 0) {
          get().addToast("error", "That edit would remove the whole video — skipped.");
          return {};
        }
        const tracks = remapOverlayTracks(s.tracks, keptRanges);
        tracks[vi] = newMain;
        return {
          tracks,
          captions: remapCaptions(s.captions, keptRanges),
          currentTime: 0,
          selectedClipId: null,
          selectedCaptionId: null,
        };
      });
      if (summary) get().addToast("success", summary);
    },

    applyEditRecipe: (recipe) => {
      commit((s) => {
        const result = applyEditRecipeToTimeline(s.tracks, s.captions, recipe);
        if (!result) {
          get().addToast("error", "Auto edit produced an empty timeline — skipped.");
          return {};
        }
        return {
          tracks: result.tracks,
          captions: result.captions,
          editRecipe: recipe,
          currentTime: 0,
          isPlaying: false,
          selectedClipId: null,
          selectedCaptionId: null,
        };
      });
      get().addToast("success", recipe.reasoningSummary);
    },

    cleanAllCaptions: () =>
      commit((s) => {
        if (s.captions.length === 0) return {};
        return { captions: cleanCaptions(s.captions) };
      }),

    setEditRecipe: (recipe) => set({ editRecipe: recipe }),

    /* ---------------- style / playback / ui ---------------- */

    setStyle: (patch) => commit((s) => ({ style: { ...s.style, ...patch } })),
    applyPreset: (style) => commit(() => ({ style: { ...style } })),

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
  };
});

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Assemble the current editor state into a serializable Project. */
export function buildProjectSnapshot(state: {
  projectId: string;
  projectName: string;
  createdAt: number;
  media: MediaAsset[];
  tracks: Track[];
  captions: Caption[];
  style: CaptionStyle;
  editRecipe: EditRecipe | null;
}): Project {
  return {
    id: state.projectId,
    name: state.projectName,
    createdAt: state.createdAt,
    updatedAt: Date.now(),
    media: state.media,
    // Legacy mirror of the main track so older tooling keeps working.
    clips: mainClips(state.tracks),
    tracks: state.tracks,
    captions: state.captions,
    style: state.style,
    editRecipe: state.editRecipe ?? undefined,
  };
}

/** Legacy-shaped main-track clips for preview/export/transcription payloads. */
export function selectMainClips(state: { tracks: Track[] }) {
  return mainClips(state.tracks);
}

/** Seek helper for keyboard shortcuts: 1 frame (fine) or 1 second per press. */
export function stepFrame(direction: -1 | 1, fine: boolean) {
  const s = useEditorStore.getState();
  const step = fine ? 1 / 30 : 1;
  s.setPlaying(false);
  const duration = tracksDuration(s.tracks);
  s.setCurrentTime(Math.min(duration, Math.max(0, s.currentTime + direction * step)));
}
