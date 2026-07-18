import assert from "node:assert/strict";
import type { Caption, TimelineClip, WordTiming } from "../types";
import { findFastInterviewAnswers } from "../lib/autoEdit/fastInterview";

let cursor = 0;
const captions: Caption[] = [];

function line(text: string, pauseAfter = 0.25) {
  const parts = text.split(/\s+/);
  const words: WordTiming[] = parts.map((word) => {
    const timing = { word, startTime: cursor, endTime: cursor + 0.24 };
    cursor += 0.28;
    return timing;
  });
  captions.push({
    id: `caption-${captions.length}`,
    text,
    startTime: words[0].startTime,
    endTime: words[words.length - 1].endTime,
    words,
  });
  cursor += pauseAfter;
}

line("Who will win the World Cup?");
line("Spain.", 0.45);
line("Who will win the World Cup?");
line("Argentina.", 0.45);
line("Who will win the World Cup?");
line("Spain.", 0.45);
line("Brazil is also dangerous.");

const clips: TimelineClip[] = [
  {
    id: "interviews",
    type: "video",
    assetId: "source",
    startTime: 0,
    endTime: cursor,
    sourceStart: 0,
    sourceEnd: cursor,
  },
];

const unique = findFastInterviewAnswers({
  captions,
  question: "Who will win the World Cup?",
  acceptedAnswers: ["Spain", "Argentina"],
  clips,
  dedupeAnswers: true,
});

assert.equal(unique.questionOccurrences, 3, "every repeated question should be detected");
assert.deepEqual(
  unique.answers.map((answer) => answer.matchedAnswer),
  ["Spain", "Argentina"],
  "only one clean clip per accepted answer should remain"
);
assert.equal(unique.ignoredDuplicates, 1, "the second Spain response should be marked as a duplicate");
assert.ok(
  unique.answers.every((answer) => !answer.text.toLowerCase().includes("world cup")),
  "spoken questions must not leak into answer ranges"
);

const allResponses = findFastInterviewAnswers({
  captions,
  question: "Who will win the World Cup?",
  clips,
  dedupeAnswers: false,
});
assert.equal(allResponses.answers.length, 3, "turning dedupe off should keep every response");

const keywordFallback = findFastInterviewAnswers({
  captions: captions.slice(-1),
  question: "A question Whisper did not catch",
  acceptedAnswers: ["Brazil"],
  clips,
});
assert.equal(keywordFallback.questionOccurrences, 0, "fallback should not invent a question match");
assert.equal(keywordFallback.answers[0]?.matchedAnswer, "Brazil", "answer choices should work as fallback anchors");

console.log("Fast interview checks passed: questions removed, choices filtered, duplicates skipped, fallback anchored.");
