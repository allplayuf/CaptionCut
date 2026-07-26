import assert from "node:assert/strict";
import type { Caption, MediaAsset, TimelineSignals } from "@/types";
import { analyzeTranscript } from "@/lib/autoEdit/analyzeTranscript";
import { applyEditRecipeToTimeline } from "@/lib/autoEdit/applyEditRecipeToTimeline";
import { detectSilence } from "@/lib/autoEdit/detectSilence";
import { generateMontageRecipe } from "@/lib/autoEdit/montage";
import { reviseEditRecipe } from "@/lib/autoEdit/reviseEditRecipe";
import { replaceCaptionsInsideRanges } from "@/lib/captions/ranges";
import {
  captionCoverageStatus,
  captionSourceSignature,
  remapCaptionCoverage,
} from "@/lib/transcription/coverage";
import {
  createDefaultTracks,
  mainClips,
  mainVideoTrack,
  makeMainClip,
  rippleMainTrack,
} from "@/lib/timeline/tracks";

const assets: MediaAsset[] = [
  makeAsset("interview"),
  makeAsset("action-one"),
  makeAsset("action-two"),
];

const tracks = createDefaultTracks();
const video = mainVideoTrack(tracks);
video.clips = assets.map((asset) => makeMainClip(asset));
tracks[tracks.indexOf(video)] = rippleMainTrack(video);
const musicTrack = tracks.find((track) => track.type === "music")!;
musicTrack.clips = [
  {
    id: "music-bed",
    type: "music",
    assetId: "music",
    startTime: 0,
    endTime: 30,
    sourceStart: 0,
    sourceEnd: 30,
    volume: 0.8,
  },
];

const clips = mainClips(tracks);
const signals = makeSignals(30);
const captions = makeInterviewCaptions();

const scopedMontage = generateMontageRecipe({
  projectId: "scope-test",
  preset: "hype",
  targetDuration: 8,
  signals,
  transcript: analyzeTranscript([]),
  captions: [],
  clips,
  includedClipIds: [clips[2].id],
  analyses: {},
  duration: 30,
  endCard: false,
  seed: 0,
});

assert.ok(scopedMontage.keptRanges.length > 0, "selected source should yield moments");
assert.ok(
  scopedMontage.keptRanges.every((range) => range.start >= 20 && range.end <= 30),
  "montage must keep the selected clip's original timeline coordinates"
);

const interview = generateMontageRecipe({
  projectId: "interview-test",
  preset: "interview",
  targetDuration: 12,
  signals,
  transcript: analyzeTranscript(captions),
  captions,
  clips,
  includedClipIds: [clips[1].id, clips[2].id],
  analyses: {},
  duration: 30,
  endCard: false,
  seed: 0,
});

assert.ok(interview.keptRanges.length > 0, "interview should keep spoken answers");
assert.ok(
  interview.keptRanges.every((range) => range.start >= 0 && range.end <= 10),
  "interview main track should contain only the speaker source"
);
assert.ok((interview.brollPlacements?.length ?? 0) > 0, "interview should realize B-roll cutaways");
assert.ok(
  interview.brollPlacements?.every((placement) =>
    placement.assetId === "action-one" || placement.assetId === "action-two"
  ),
  "cutaways should come only from sources assigned as B-roll"
);

const applied = applyEditRecipeToTimeline(tracks, captions, interview);
assert.ok(applied, "interview recipe should apply");
assert.ok(
  mainVideoTrack(applied.tracks).clips.every((clip) => clip.assetId === "interview"),
  "speaker video must remain the main interview sequence"
);
assert.equal(
  applied.tracks.find((track) => track.type === "broll")?.clips.length,
  interview.brollPlacements?.length,
  "every planned cutaway should land on the B-roll track"
);
assert.ok(
  applied.tracks.find((track) => track.type === "broll")?.clips.every((clip) => clip.volume === 0),
  "B-roll audio must be muted so interview speech continues"
);

const speechOnly = applyEditRecipeToTimeline(tracks, captions, {
  ...interview,
  brollPlacements: [],
});
assert.ok(speechOnly, "speech-only interview recipe should apply");
assert.ok(
  speechOnly.tracks
    .find((track) => track.type === "music")
    ?.clips.every((clip) => (clip.volume ?? 1) <= 0.22),
  "interview music must stay ducked even when no B-roll placement is available"
);

if (interview.keptRanges.length > 1) {
  const revised = reviseEditRecipe(interview, [1]);
  assert.equal(revised.keptRanges.length, 1, "draft review should reject moments");
  assert.ok(
    revised.brollPlacements?.every(
      (placement) => placement.start >= 0 && placement.end <= revised.keptRanges[0].end - revised.keptRanges[0].start + 0.01
    ),
    "B-roll timing should follow its answer after draft revision"
  );
}

const boundaryWords = [
  { word: "keep-before", startTime: 0.4, endTime: 0.9, confidence: 0.8 },
  { word: "replace-this", startTime: 1.1, endTime: 1.6, confidence: 0.4 },
  { word: "keep-after", startTime: 2.1, endTime: 2.6, confidence: 0.9 },
];
const boundaryResult = replaceCaptionsInsideRanges(
  [
    {
      id: "boundary",
      text: boundaryWords.map((word) => word.word).join(" "),
      startTime: 0.4,
      endTime: 2.6,
      words: boundaryWords,
      confidence: 0.7,
    },
  ],
  [{ start: 1, end: 2 }],
  [{ id: "fresh", text: "new words", startTime: 1.1, endTime: 1.8 }]
);
assert.deepEqual(
  boundaryResult.map((caption) => caption.text),
  ["keep-before", "new words", "keep-after"],
  "selected-clip captioning must preserve words on both sides of the replaced range"
);

const linkedRecorder: MediaAsset = {
  ...makeAsset("linked-recorder"),
  filename: "linked-recorder.wav",
  originalName: "linked-recorder.wav",
  mimeType: "audio/wav",
  width: 0,
  height: 0,
  fps: 0,
  kind: "audio",
};
const pairedAssets: MediaAsset[] = [
  {
    ...assets[0],
    hasAudio: false,
    linkedAudio: {
      audioAssetId: linkedRecorder.id,
      offsetSeconds: 0.5,
      muteCameraAudio: true,
      syncMethod: "manual",
    },
  },
  ...assets.slice(1),
  linkedRecorder,
];
const sourceSignature = captionSourceSignature(clips, pairedAssets);
const changedAudioSignature = captionSourceSignature(clips, [
  {
    ...pairedAssets[0],
    linkedAudio: { ...pairedAssets[0].linkedAudio!, offsetSeconds: 0.8 },
  },
  ...pairedAssets.slice(1),
]);
assert.notEqual(
  sourceSignature,
  changedAudioSignature,
  "changing linked-recorder timing must invalidate transcript coverage"
);
assert.equal(
  captionCoverageStatus(
    { sourceSignature, coveredClipIds: [clips[0].id] },
    clips,
    pairedAssets,
    [clips[0].id]
  ),
  "complete",
  "selected transcript coverage should be complete only for its recorded clip"
);
assert.equal(
  captionCoverageStatus(
    { sourceSignature, coveredClipIds: [clips[0].id] },
    clips,
    pairedAssets
  ),
  "incomplete",
  "selected transcript coverage must not masquerade as whole-timeline coverage"
);

const remappedCoverageClips = [
  {
    ...clips[0],
    id: "interview-slice",
    sourceStart: clips[0].sourceStart + 1,
    sourceEnd: clips[0].sourceEnd - 1,
  },
  { ...clips[1], id: "uncovered-action-slice", sourceEnd: clips[1].sourceEnd - 1 },
];
const remappedCoverage = remapCaptionCoverage(
  { sourceSignature, coveredClipIds: [clips[0].id] },
  clips,
  remappedCoverageClips,
  pairedAssets
);
assert.equal(
  captionCoverageStatus(
    remappedCoverage,
    remappedCoverageClips,
    pairedAssets,
    ["interview-slice"]
  ),
  "complete",
  "trimmed/reordered source ranges should keep their transcript coverage"
);
assert.equal(
  captionCoverageStatus(remappedCoverage, remappedCoverageClips, pairedAssets),
  "incomplete",
  "new clips outside covered source ranges must still require transcription"
);

const pauseTranscript = analyzeTranscript([
  { id: "first-word", text: "Hej", startTime: 0.5, endTime: 1 },
  { id: "second-word", text: "igen", startTime: 2, endTime: 2.5 },
]);
const silenceWithoutPeaks = detectSilence(
  { transcript: pauseTranscript, duration: 3 },
  "medium"
);
const silenceWithPeaks = detectSilence(
  { transcript: pauseTranscript, duration: 3, peaks: Array(30).fill(0) },
  "medium"
);
assert.deepEqual(
  silenceWithPeaks,
  silenceWithoutPeaks,
  "quiet waveform confirmation must not apply speech padding twice"
);
assert.deepEqual(
  silenceWithPeaks,
  [{ start: 1.12, end: 1.88 }],
  "silence cuts should retain one 120ms breathing margin around speech"
);

console.log(
  "Editor workflow checks passed: source scope, interview audio/B-roll, draft revision, caption boundaries, remapped transcript coverage, and silence padding."
);

function makeAsset(id: string): MediaAsset {
  return {
    id,
    filename: `${id}.mp4`,
    originalName: `${id}.mp4`,
    mimeType: "video/mp4",
    size: 1,
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    kind: "video",
  };
}

function makeSignals(duration: number): TimelineSignals {
  const rate = 10;
  const bins = duration * rate;
  const energy = new Array<number>(bins).fill(0.12);
  const motion = new Array<number>(bins).fill(0.1);
  for (const second of [12, 16, 22, 27]) {
    for (let offset = -4; offset <= 4; offset++) {
      const index = second * rate + offset;
      energy[index] = Math.max(energy[index], 0.9 - Math.abs(offset) * 0.08);
      motion[index] = Math.max(motion[index], 1 - Math.abs(offset) * 0.07);
    }
  }
  return {
    rate,
    energy,
    motion,
    sceneChanges: [10, 20],
    beats: [],
    bpm: null,
    duration,
    hasAudio: true,
  };
}

function makeInterviewCaptions(): Caption[] {
  const lines = [
    { text: "This is the secret nobody tells you.", start: 0.4, end: 3.4 },
    { text: "The hardest part is to never stop.", start: 4.2, end: 7.4 },
  ];
  return lines.map((line, index) => {
    const words = line.text.split(" ");
    const step = (line.end - line.start) / words.length;
    return {
      id: `caption-${index}`,
      text: line.text,
      startTime: line.start,
      endTime: line.end,
      words: words.map((word, wordIndex) => ({
        word,
        startTime: line.start + wordIndex * step,
        endTime: line.start + (wordIndex + 1) * step,
      })),
    };
  });
}
