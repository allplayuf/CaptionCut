import type { Caption } from "@/types";
import { normalizeWord } from "@/lib/autoEdit/analyzeTranscript";

/**
 * Caption text intelligence: punctuation cleanup, filler stripping (text
 * only — the audio stays), common Whisper mistake fixes and automatic
 * emphasis of the words that carry the sentence.
 */

const TEXT_FILLERS = new Set([
  "um", "uh", "uhm", "umm", "uhh", "erm", "ehm",
  "öh", "öhm", "asså",
]);

/** Frequent Whisper transcription slips worth auto-correcting. */
const WHISPER_FIXES: Array<[RegExp, string]> = [
  [/\bi'm gonna\b/gi, "I'm gonna"],
  [/\bim\b/g, "I'm"],
  [/\bi\b/g, "I"],
  [/\bdont\b/gi, "don't"],
  [/\bcant\b/gi, "can't"],
  [/\bwont\b/gi, "won't"],
  [/\bdidnt\b/gi, "didn't"],
  [/\bthats\b/gi, "that's"],
  [/\bits a\b/g, "it's a"],
  [/\byoure\b/gi, "you're"],
  [/\btheyre\b/gi, "they're"],
  [/ +([,.!?])/g, "$1"],
  [/([,.!?]){2,}/g, "$1"],
];

/** Words that deserve emphasis (bold/color) when they appear. */
const EMPHASIS_WORDS = new Set([
  "never", "always", "nobody", "everyone", "insane", "crazy", "best", "worst",
  "hardest", "free", "secret", "wrong", "stop", "huge", "massive", "impossible",
  "amazing", "love", "hate", "real", "truth", "actually", "important",
  "aldrig", "alltid", "ingen", "alla", "sjukt", "galet", "bästa", "värsta",
  "gratis", "hemlighet", "fel", "sluta", "viktigt", "sanningen",
]);

/** Strip spoken fillers from display text and tidy punctuation/spacing. */
export function cleanCaptionText(text: string): string {
  let out = text
    .split(/\s+/)
    .filter((w) => !TEXT_FILLERS.has(normalizeWord(w)))
    .join(" ");
  for (const [pattern, replacement] of WHISPER_FIXES) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > 0 ? out : text.trim();
}

/** Indexes (into caption.words / whitespace-split text) worth emphasizing. */
export function findEmphasisWordIndexes(caption: Caption): number[] {
  const words = caption.words?.map((w) => w.word) ?? caption.text.trim().split(/\s+/);
  const indexes: number[] = [];
  words.forEach((word, i) => {
    const norm = normalizeWord(word);
    if (EMPHASIS_WORDS.has(norm) || /^\d+([.,]\d+)?%?$/.test(norm)) indexes.push(i);
  });
  // At most 2 emphasized words per caption keeps it punchy.
  return indexes.slice(0, 2);
}

/**
 * Apply cleanup + auto-emphasis to a caption list (non-destructive ids).
 * Filler words are removed from the text; word timings are kept when the
 * word survives, so highlighting stays accurate.
 */
export function cleanCaptions(captions: Caption[]): Caption[] {
  return captions.map((cap) => {
    if (!cap.words || cap.words.length === 0) {
      const text = cleanCaptionText(cap.text);
      return { ...cap, text };
    }
    let words = cap.words.filter((w) => !TEXT_FILLERS.has(normalizeWord(w.word)));
    if (words.length === 0) words = cap.words;
    let text = words.map((w) => w.word).join(" ");
    for (const [pattern, replacement] of WHISPER_FIXES) text = text.replace(pattern, replacement);
    const fixedParts = text.replace(/\s+/g, " ").trim().split(" ");
    // Word count is preserved by the fixes (word-internal only), so re-zip.
    const rezipped =
      fixedParts.length === words.length
        ? words.map((w, i) => ({ ...w, word: fixedParts[i] }))
        : words;
    const emphasis = new Set(findEmphasisWordIndexes({ ...cap, words: rezipped, text }));
    return {
      ...cap,
      text: rezipped.map((w) => w.word).join(" "),
      words: rezipped.map((w, i) => ({ ...w, emphasis: emphasis.has(i) ? true : undefined })),
    };
  });
}
