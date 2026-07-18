import assert from "node:assert/strict";
import type { AudioAnalysis, MediaAnalysis, MediaAsset, Track } from "../types";
import { suggestAudioSync } from "../lib/audio/sync";
import { buildTimelineSignals } from "../lib/autoEdit/signals";

function audioAnalysis(energy: number[], rate = 10): AudioAnalysis {
  return {
    rate,
    energy,
    loudness: -16,
    bpm: null,
    beatConfidence: 0,
    beats: [],
  };
}

function mediaAnalysis(id: string, audio: AudioAnalysis): MediaAnalysis {
  return {
    version: 1,
    assetId: id,
    duration: audio.energy.length / audio.rate,
    audio,
    video: null,
  };
}

const cameraEnergy = new Array<number>(100).fill(0).map((_, index) =>
  0.08 +
  0.9 * Math.exp(-((index - 22) ** 2) / 8) +
  0.65 * Math.exp(-((index - 51) ** 2) / 18) +
  0.8 * Math.exp(-((index - 77) ** 2) / 10)
);
// The external recorder started 0.5s later: the same event appears 0.5s
// earlier in its own source time, so audioTime = videoTime - 0.5.
const separateEnergy = cameraEnergy.slice(5).concat(new Array<number>(5).fill(0.08));

const camera = mediaAnalysis("video1", audioAnalysis(cameraEnergy));
const separate = mediaAnalysis("audio1", audioAnalysis(separateEnergy));
const suggestion = suggestAudioSync(camera, separate);
assert(suggestion, "waveform sync should find a match");
assert(
  Math.abs(suggestion.offsetSeconds - 0.5) <= 0.11,
  `expected +0.5s delay, got ${suggestion.offsetSeconds}s`
);
assert(suggestion.confidence > 0.45, "synthetic match should have useful confidence");

// The inverse alignment must keep the same sign convention: this recorder
// started before the camera, so its sound needs to advance by 0.5 seconds.
const earlySeparateEnergy = new Array<number>(5)
  .fill(0.08)
  .concat(cameraEnergy.slice(0, -5));
const earlySuggestion = suggestAudioSync(
  camera,
  mediaAnalysis("audio-early", audioAnalysis(earlySeparateEnergy))
);
assert(earlySuggestion, "waveform sync should find an inverse match");
assert(
  Math.abs(earlySuggestion.offsetSeconds + 0.5) <= 0.11,
  `expected -0.5s advance, got ${earlySuggestion.offsetSeconds}s`
);

const videoAsset: MediaAsset = {
  id: "video1",
  filename: "video1.mp4",
  originalName: "match-01.mp4",
  mimeType: "video/mp4",
  size: 100,
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  kind: "video",
  linkedAudio: {
    audioAssetId: "audio1",
    offsetSeconds: 0.5,
    muteCameraAudio: true,
    syncMethod: "waveform",
    confidence: suggestion.confidence,
  },
};
const separateAsset: MediaAsset = {
  id: "audio1",
  filename: "audio1.wav",
  originalName: "match-01-audio.wav",
  mimeType: "audio/wav",
  size: 100,
  duration: 10,
  width: 0,
  height: 0,
  fps: 0,
  hasAudio: true,
  kind: "audio",
};
const tracks: Track[] = [
  {
    id: "video-track",
    type: "video",
    name: "Video",
    locked: false,
    muted: false,
    hidden: false,
    clips: [
      {
        id: "clip1",
        type: "video",
        assetId: "video1",
        startTime: 0,
        endTime: 10,
        sourceStart: 0,
        sourceEnd: 10,
      },
    ],
  },
];

const signals = buildTimelineSignals(
  tracks,
  [videoAsset, separateAsset],
  { video1: camera, audio1: separate },
  { beatSyncEnabled: true }
);
assert(signals, "linked audio should produce timeline signals");
assert(signals.hasAudio, "linked audio should mark the timeline audible");
// Separate source index 17 maps to video/timeline index 22 through +0.5s.
assert(signals.energy[22] > 0.5, "linked energy should be source-offset onto the video timeline");

// A shorter recorder must become silent after its last sample. Repeating its
// final energy bin would make auto-edit react to sound that preview/export pad
// with silence.
const shortAudio = mediaAnalysis("short-audio", audioAnalysis([0.2, 0.3, 0.4, 1]));
const shortVideo: MediaAsset = {
  ...videoAsset,
  id: "short-video",
  duration: 2,
  linkedAudio: {
    audioAssetId: "short-audio",
    offsetSeconds: 0,
    muteCameraAudio: true,
    syncMethod: "starts",
  },
};
const shortAudioAsset: MediaAsset = {
  ...separateAsset,
  id: "short-audio",
  duration: 0.4,
};
const shortTracks: Track[] = [
  {
    ...tracks[0],
    clips: [
      {
        ...tracks[0].clips[0],
        assetId: "short-video",
        endTime: 2,
        sourceEnd: 2,
      },
    ],
  },
];
const shortSignals = buildTimelineSignals(
  shortTracks,
  [shortVideo, shortAudioAsset],
  { "short-audio": shortAudio },
  { beatSyncEnabled: true }
);
assert(shortSignals, "short linked audio should still produce signals");
assert(shortSignals.energy[3] > 0.5, "the short recorder's last real bin should be mapped");
assert.equal(shortSignals.energy[4], 0, "linked audio should be silent immediately after its end");
assert.equal(shortSignals.energy[15], 0, "linked audio silence should extend through the clip");

console.log("Drive audio pairing checks passed.");
