import type { HookCandidate } from "@/types";
import { round3 } from "@/lib/timeline/tracks";
import type { Sentence, Transcript } from "./analyzeTranscript";

/**
 * Hook detection: score every sentence for "would this stop a scroll?".
 * Pure lexical heuristics over the real transcript — no API required.
 */

const EMOTIONAL = new Set([
  "hate", "love", "scared", "terrified", "amazing", "insane", "crazy", "wild",
  "unbelievable", "heartbroken", "furious", "obsessed", "embarrassing", "painful",
  "hardest", "worst", "best", "favorite", "brutal", "beautiful", "alone", "lonely",
  // Swedish
  "älskar", "hatar", "rädd", "galet", "sjukt", "otroligt", "ensam", "jobbigt", "värsta", "bästa",
]);

const CURIOSITY = new Set([
  "secret", "truth", "nobody", "never", "hidden", "actually", "really",
  "surprising", "weird", "strange", "wait", "discovered", "realized", "found",
  "hemlighet", "sanningen", "ingen", "aldrig", "egentligen", "konstigt", "upptäckte", "insåg",
]);

const CONFLICT = new Set([
  "wrong", "stop", "quit", "problem", "mistake", "fail", "failed", "fight",
  "against", "hate", "broke", "lost", "impossible", "cant", "can't", "won't",
  "fel", "sluta", "slutade", "problem", "misstag", "misslyckades", "omöjligt", "förlorade",
]);

const OPINION_STARTERS = [
  "this is why", "the reason", "nobody talks about", "everyone gets this wrong",
  "unpopular opinion", "the hardest part", "the best part", "the worst part",
  "i didn't know", "i didn't expect", "det här är varför", "det svåraste",
];

const RELATABLE = new Set([
  "you", "your", "everyone", "everybody", "people", "we", "us",
  "du", "din", "ditt", "alla", "folk", "vi", "oss",
]);

export function detectHooks(transcript: Transcript, limit = 5): HookCandidate[] {
  const scored = transcript.sentences
    .filter((s) => s.words.length >= 3 && s.endTime - s.startTime >= 0.8)
    .map((s) => scoreSentence(s));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scoreSentence(sentence: Sentence): HookCandidate {
  const reasons: string[] = [];
  let score = 0;

  const norms = sentence.words.map((w) => w.norm);
  const text = sentence.text;
  const lower = text.toLowerCase();
  const wordCount = norms.length;

  const hits = (set: Set<string>) => norms.filter((n) => set.has(n)).length;

  const emotional = hits(EMOTIONAL);
  if (emotional > 0) {
    score += emotional * 2.2;
    reasons.push("emotional language");
  }
  const curiosity = hits(CURIOSITY);
  if (curiosity > 0) {
    score += curiosity * 2.4;
    reasons.push("sparks curiosity");
  }
  const conflict = hits(CONFLICT);
  if (conflict > 0) {
    score += conflict * 2.0;
    reasons.push("conflict / stakes");
  }
  if (hits(RELATABLE) > 0) {
    score += 1.2;
    reasons.push("speaks to the viewer");
  }
  if (/\?/.test(text)) {
    score += 1.8;
    reasons.push("asks a question");
  }
  if (/\d/.test(text)) {
    score += 1.0;
    reasons.push("concrete number");
  }
  if (OPINION_STARTERS.some((p) => lower.includes(p))) {
    score += 3.0;
    reasons.push("strong opinion framing");
  }
  // Negations & absolutes read as surprising claims.
  if (/\b(nobody|never|no one|always|everyone|ingen|aldrig|alla)\b/i.test(lower)) {
    score += 1.6;
    reasons.push("absolute claim");
  }

  // Shortness & clarity: 4–12 words is the sweet spot.
  if (wordCount >= 4 && wordCount <= 12) {
    score += 2.0;
    reasons.push("short and punchy");
  } else if (wordCount > 20) {
    score -= 1.5;
  }

  // Slight preference for lines that don't start mid-thought.
  if (/^(and|but|so|because|och|men|så|för)\b/i.test(lower)) score -= 0.8;

  return {
    text,
    startTime: round3(sentence.startTime),
    endTime: round3(sentence.endTime),
    score: Math.round(score * 10) / 10,
    reasons,
  };
}
