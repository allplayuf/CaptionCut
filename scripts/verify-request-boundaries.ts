import assert from "node:assert/strict";
import type { ExportRequest, ZoomPayload } from "../lib/export/request";
import {
  MAX_EXPORT_BYTES,
  jsonTooLarge,
  validateExportPayload,
  validateProjectPayload,
} from "../lib/server/requestValidation";
import { DEFAULT_STYLE } from "../lib/captions/presets";
import type { MediaAsset, Project } from "../types";

const media: MediaAsset = {
  id: "media_1234",
  filename: "media_1234.mp4",
  originalName: "source.mp4",
  mimeType: "video/mp4",
  size: 1_000_000,
  duration: 5,
  width: 1080,
  height: 1920,
  fps: 30,
  hasAudio: true,
  kind: "video",
};

const validProject: Project = {
  id: "project_1234",
  name: "Boundary test",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  media: [media],
  tracks: [
    {
      id: "track_video",
      type: "video",
      name: "Video",
      locked: false,
      muted: false,
      hidden: false,
      clips: [
        {
          id: "clip_1234",
          type: "video",
          assetId: media.id,
          startTime: 0,
          endTime: 5,
          sourceStart: 0,
          sourceEnd: 5,
        },
      ],
    },
  ],
  captions: [],
  style: DEFAULT_STYLE,
};

const validExport: ExportRequest = {
  media: [media],
  clips: [
    {
      id: "clip_1234",
      mediaId: media.id,
      sourceStart: 0,
      sourceEnd: 5,
    },
  ],
  captions: [],
  style: DEFAULT_STYLE,
  presetId: "tiktok",
};

assert.equal(validateProjectPayload(validProject), null);
assert.equal(validateExportPayload(validExport), null);

assert.match(
  validateProjectPayload({ ...validProject, name: "x".repeat(81) }) ?? "",
  /80/
);
assert.match(
  validateProjectPayload({
    ...validProject,
    media: [{ ...media, storageUrl: "https://example.com/private.mp4" }],
  }) ?? "",
  /invalid media/i
);
assert.match(
  validateExportPayload({
    ...validExport,
    clips: [{ ...validExport.clips[0], sourceEnd: 1_801 }],
  }) ?? "",
  /30 minutes/
);
assert.match(
  validateExportPayload({
    ...validExport,
    zooms: Array.from(
      { length: 501 },
      (_, index): ZoomPayload => ({
        start: index * 0.001,
        end: index * 0.001 + 0.05,
        scale: 1.2,
        anchorX: 0.5,
        anchorY: 0.5,
      })
    ),
  }) ?? "",
  /too many zoom effects/
);
assert.equal(
  jsonTooLarge({ value: "x".repeat(MAX_EXPORT_BYTES) }, MAX_EXPORT_BYTES),
  true
);

console.log("Request boundary checks passed: project, media, export duration, layers and payload size.");
