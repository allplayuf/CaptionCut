import type { Caption, TimelineClip } from "@/types";
import { analyzeTranscript, normalizeWord, type TranscriptWord } from "@/lib/autoEdit/analyzeTranscript";
import { round3 } from "@/lib/timeline/tracks";

export interface FastInterviewAnswer {
  id: string;
  start: number;
  end: number;
  text: string;
  /** The user-supplied choice found in this answer, e.g. "Spain". */
  matchedAnswer?: string;
  sourceClipId?: string;
  confidence: number;
}

export interface FastInterviewResult {
  answers: FastInterviewAnswer[];
  questionOccurrences: number;
  ignoredDuplicates: number;
  ignoredNonMatching: number;
}

export interface FastInterviewOptions {
  captions: Caption[];
  question: string;
  /** Optional accepted answers. Empty means keep every response to the question. */
  acceptedAnswers?: string[];
  clips?: TimelineClip[];
  dedupeAnswers?: boolean;
  maxAnswerSeconds?: number;
}

interface QuestionMatch {
  start: number;
  end: number;
  score: number;
  sourceClipId?: string;
}

interface TimedWord extends TranscriptWord {
  sourceClipId?: string;
}

interface AcceptedAnswer {
  label: string;
  tokens: string[];
}

/**
 * Find the short response after every repetition of one interview question.
 * The spoken question itself is intentionally never included in a keep range.
 * When accepted answers are supplied, only those responses are returned.
 */
export function findFastInterviewAnswers(options: FastInterviewOptions): FastInterviewResult {
  const transcript = analyzeTranscript(options.captions);
  const words: TimedWord[] = transcript.words
    .filter((word) => word.norm.length > 0)
    .map((word) => ({ ...word, sourceClipId: clipAt(options.clips, midpoint(word))?.id }));
  const questionTokens = tokenize(options.question);
  const accepted = (options.acceptedAnswers ?? [])
    .map((label) => ({ label: label.trim(), tokens: tokenize(label) }))
    .filter((answer) => answer.label.length > 0 && answer.tokens.length > 0);

  if (words.length === 0 || questionTokens.length === 0) {
    return { answers: [], questionOccurrences: 0, ignoredDuplicates: 0, ignoredNonMatching: 0 };
  }

  const questions = findQuestions(words, questionTokens);
  const maxAnswerSeconds = clamp(options.maxAnswerSeconds ?? 3.2, 0.8, 8);
  const rawAnswers: FastInterviewAnswer[] = [];
  let ignoredNonMatching = 0;

  questions.forEach((question, index) => {
    const nextQuestionStart = questions[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const clipEnd = question.sourceClipId
      ? options.clips?.find((clip) => clip.id === question.sourceClipId)?.endTime
      : undefined;
    const hardEnd = Math.min(
      nextQuestionStart - 0.04,
      clipEnd ?? Number.POSITIVE_INFINITY,
      question.end + maxAnswerSeconds + 1.2
    );
    const responseWords = collectResponseWords(words, question, hardEnd, maxAnswerSeconds);
    if (responseWords.length === 0) {
      ignoredNonMatching += accepted.length > 0 ? 1 : 0;
      return;
    }

    const match = accepted.length > 0 ? findAcceptedAnswer(responseWords, accepted) : undefined;
    if (accepted.length > 0 && !match) {
      ignoredNonMatching++;
      return;
    }
    rawAnswers.push(toAnswer(responseWords, question, hardEnd, match));
  });

  // If Whisper missed the repeated question but the creator supplied exact
  // answer choices, the choices are still useful anchors for a rapid cut.
  if (questions.length === 0 && accepted.length > 0) {
    rawAnswers.push(...answersAroundKeywords(words, accepted, options.clips, maxAnswerSeconds));
  }

  const deduped = dedupe(rawAnswers, options.dedupeAnswers !== false);
  return {
    answers: deduped.answers,
    questionOccurrences: questions.length,
    ignoredDuplicates: deduped.ignored,
    ignoredNonMatching,
  };
}

function findQuestions(words: TimedWord[], questionTokens: string[]): QuestionMatch[] {
  const minLength = Math.max(1, questionTokens.length - 2);
  const maxLength = questionTokens.length + 3;
  const significant = questionTokens.filter((token) => !QUESTION_STOP_WORDS.has(token));
  const candidates: QuestionMatch[] = [];

  for (let start = 0; start < words.length; start++) {
    for (let length = minLength; length <= maxLength && start + length <= words.length; length++) {
      const window = words.slice(start, start + length);
      if (window[window.length - 1].endTime - window[0].startTime > 7) break;
      if (window.some((word) => word.sourceClipId !== window[0].sourceClipId)) break;

      const windowTokens = window.map((word) => word.norm);
      const orderedCoverage = lcsLength(questionTokens, windowTokens) / questionTokens.length;
      const significantCoverage = tokenCoverage(significant, windowTokens);
      const lengthFit = Math.max(0, 1 - Math.abs(length - questionTokens.length) / (questionTokens.length + 2));
      const score = orderedCoverage * 0.68 + significantCoverage * 0.24 + lengthFit * 0.08;
      const threshold = questionTokens.length <= 2 ? 0.86 : 0.67;
      if (score < threshold || orderedCoverage < 0.58) continue;

      candidates.push({
        start: window[0].startTime,
        end: window[window.length - 1].endTime,
        score,
        sourceClipId: window[0].sourceClipId,
      });
    }
  }

  // Non-maximum suppression leaves one tight span per repeated question.
  const selected: QuestionMatch[] = [];
  for (const candidate of candidates.sort((a, b) => {
    const score = b.score - a.score;
    if (Math.abs(score) > 0.0001) return score;
    return (a.end - a.start) - (b.end - b.start);
  })) {
    if (selected.some((item) => overlapRatio(item, candidate) > 0.35)) continue;
    selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function collectResponseWords(
  words: TimedWord[],
  question: QuestionMatch,
  hardEnd: number,
  maxAnswerSeconds: number
): TimedWord[] {
  const after = words.filter(
    (word) =>
      word.startTime >= question.end - 0.015 &&
      word.startTime < hardEnd &&
      (!question.sourceClipId || word.sourceClipId === question.sourceClipId)
  );
  if (after.length === 0) return [];

  // A fuzzy question window can stop one small word early. Drop that tail
  // only when it is glued to the detected question; never eat an answer.
  while (
    after.length > 1 &&
    after[0].startTime - question.end < 0.12 &&
    QUESTION_STOP_WORDS.has(after[0].norm)
  ) {
    after.shift();
  }

  const response: TimedWord[] = [];
  for (const word of after) {
    if (response.length > 0) {
      const previous = response[response.length - 1];
      if (word.startTime - previous.endTime > 0.78) break;
      if (word.endTime - response[0].startTime > maxAnswerSeconds) break;
    }
    response.push(word);
    if (response.length > 0 && /[.!?]["')\]]?$/.test(word.word)) break;
  }
  return response;
}

function toAnswer(
  words: TimedWord[],
  question: QuestionMatch,
  hardEnd: number,
  match?: AcceptedAnswer
): FastInterviewAnswer {
  const first = words[0];
  const last = words[words.length - 1];
  const start = Math.max(question.end, first.startTime - 0.1);
  const end = Math.min(hardEnd, last.endTime + 0.18);
  return {
    id: `answer-${Math.round(start * 1000)}-${Math.round(end * 1000)}`,
    start: round3(start),
    end: round3(Math.max(start + 0.12, end)),
    text: words.map((word) => word.word).join(" "),
    matchedAnswer: match?.label,
    sourceClipId: first.sourceClipId,
    confidence: round3(Math.min(1, question.score + (match ? 0.08 : 0))),
  };
}

function answersAroundKeywords(
  words: TimedWord[],
  accepted: AcceptedAnswer[],
  clips: TimelineClip[] | undefined,
  maxAnswerSeconds: number
): FastInterviewAnswer[] {
  const answers: FastInterviewAnswer[] = [];
  for (let index = 0; index < words.length; index++) {
    const match = accepted.find((answer) => phraseAt(words, index, answer.tokens));
    if (!match) continue;
    const anchor = words[index];
    const clip = clipAt(clips, midpoint(anchor));
    const lower = Math.max(clip?.startTime ?? 0, anchor.startTime - Math.min(0.55, maxAnswerSeconds * 0.25));
    const upper = Math.min(
      clip?.endTime ?? Number.POSITIVE_INFINITY,
      anchor.startTime + Math.min(1.2, maxAnswerSeconds)
    );
    const context = words.filter(
      (word) =>
        word.endTime > lower &&
        word.startTime < upper &&
        (!clip || word.sourceClipId === clip.id)
    );
    if (context.length === 0) continue;
    const first = context[0];
    const last = context[context.length - 1];
    answers.push({
      id: `answer-${Math.round(first.startTime * 1000)}-${Math.round(last.endTime * 1000)}`,
      start: round3(Math.max(clip?.startTime ?? 0, first.startTime - 0.08)),
      end: round3(Math.min(clip?.endTime ?? Number.POSITIVE_INFINITY, last.endTime + 0.16)),
      text: context.map((word) => word.word).join(" "),
      matchedAnswer: match.label,
      sourceClipId: clip?.id,
      confidence: 0.72,
    });
    index += match.tokens.length - 1;
  }
  return answers;
}

function dedupe(
  answers: FastInterviewAnswer[],
  enabled: boolean
): { answers: FastInterviewAnswer[]; ignored: number } {
  if (!enabled) return { answers, ignored: 0 };
  const kept: FastInterviewAnswer[] = [];
  const keys = new Set<string>();
  let ignored = 0;
  for (const answer of answers) {
    const key = answer.matchedAnswer
      ? `choice:${tokenize(answer.matchedAnswer).join(" ")}`
      : `answer:${tokenize(answer.text).filter((token) => !ANSWER_STOP_WORDS.has(token)).join(" ")}`;
    const looksRepeated =
      keys.has(key) ||
      kept.some((item) => !answer.matchedAnswer && answerSimilarity(item.text, answer.text) >= 0.82);
    if (looksRepeated) {
      ignored++;
      continue;
    }
    keys.add(key);
    kept.push(answer);
  }
  return { answers: kept, ignored };
}

function findAcceptedAnswer(words: TimedWord[], accepted: AcceptedAnswer[]): AcceptedAnswer | undefined {
  for (let index = 0; index < words.length; index++) {
    const found = accepted.find((answer) => phraseAt(words, index, answer.tokens));
    if (found) return found;
  }
  return undefined;
}

function phraseAt(words: TimedWord[], start: number, phrase: string[]): boolean {
  return phrase.every((token, offset) => words[start + offset]?.norm === token);
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

function lcsLength(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return row[b.length];
}

function tokenCoverage(needles: string[], haystack: string[]): number {
  if (needles.length === 0) return 1;
  const unique = [...new Set(needles)];
  const found = new Set(haystack);
  return unique.filter((token) => found.has(token)).length / unique.length;
}

function answerSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a).filter((token) => !ANSWER_STOP_WORDS.has(token)));
  const right = new Set(tokenize(b).filter((token) => !ANSWER_STOP_WORDS.has(token)));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function overlapRatio(a: QuestionMatch, b: QuestionMatch): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return overlap / Math.max(0.01, Math.min(a.end - a.start, b.end - b.start));
}

function midpoint(word: TranscriptWord): number {
  return (word.startTime + word.endTime) / 2;
}

function clipAt(clips: TimelineClip[] | undefined, time: number): TimelineClip | undefined {
  return clips?.find((clip) => time >= clip.startTime - 0.002 && time <= clip.endTime + 0.002);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const QUESTION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "do", "does", "is", "of", "or", "the", "to", "what", "which", "who", "will",
  "vad", "vem", "vilken", "vilka", "kommer", "att", "och", "är", "det", "som",
]);

const ANSWER_STOP_WORDS = new Set([
  ...QUESTION_STOP_WORDS,
  "i", "it", "my", "think", "probably", "maybe", "jag", "tror", "nog", "kanske",
]);
