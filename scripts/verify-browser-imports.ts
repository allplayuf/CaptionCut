import assert from "node:assert/strict";
import {
  filenameFromDisposition,
  parseSharedDriveFile,
  sharedDriveDownloadUrl,
} from "../lib/googleDrive/shared";
import { wordsFromWhisperResult } from "../lib/transcription/browserWhisper";

const standard = parseSharedDriveFile(
  "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_012345/view?usp=sharing"
);
assert.deepEqual(standard, {
  fileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz_012345",
});

const resourceKey = parseSharedDriveFile(
  "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz_012345&resourcekey=0-example_KEY"
);
assert.deepEqual(resourceKey, {
  fileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz_012345",
  resourceKey: "0-example_KEY",
});
assert.equal(
  sharedDriveDownloadUrl(resourceKey!).hostname,
  "drive.usercontent.google.com",
  "shared imports must always download from the fixed Google host"
);
assert.equal(
  sharedDriveDownloadUrl(resourceKey!).searchParams.get("resourcekey"),
  "0-example_KEY"
);

assert.equal(
  parseSharedDriveFile("https://example.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_012345"),
  null,
  "lookalike hosts must be rejected"
);
assert.equal(
  parseSharedDriveFile("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz_012345"),
  null,
  "folder links are not media files"
);
assert.equal(
  filenameFromDisposition("attachment; filename*=UTF-8''My%20video%20%C3%A5.mp4"),
  "My video å.mp4"
);
assert.equal(
  filenameFromDisposition('attachment; filename="../../unsafe.mov"'),
  ".._.._unsafe.mov"
);

const words = wordsFromWhisperResult({
  text: "Caption timing works",
  chunks: [{ text: " Caption timing works", timestamp: [1, 4] }],
});
assert.deepEqual(
  words.map((word) => word.word),
  ["Caption", "timing", "works"]
);
assert.equal(words[0].startTime, 1);
assert.equal(words.at(-1)?.endTime, 4);
for (let index = 1; index < words.length; index++) {
  assert(words[index].startTime >= words[index - 1].endTime);
}

console.log(
  "Browser import checks passed: keyless Drive links are constrained and segment timestamps produce usable word timing."
);
