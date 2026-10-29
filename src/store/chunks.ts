import type { CardState } from "./srs";

/**
 * A sentence the learner wrote around one of a word's collocations (a "chunk").
 * Reviews show the sentence with the chunk blanked out and ask for it back.
 */
export interface Sentence {
  id: string;
  wordId: string;
  /** The collocation it practises, "english｜中文" as listed on the word. */
  chunk: string;
  text: string;
  /** The part of `text` that is blanked in reviews, usually the chunk as it appears in the sentence. */
  blank: string;
  /** Optional translation of the whole sentence. */
  zh: string;
  /** Memory state once reviewed; until then it is first due at `next`. */
  card: CardState | null;
  next: number;
  added: number;
}

/** Words in a dictionary chunk that stand for "any noun" etc., not literal text. */
const FILLERS = new Set(["sth", "sb", "someone", "somebody", "something", "one's", "oneself", "a", "an", "the", "of", "to"]);

const stem = (w: string) => w.slice(0, Math.max(3, w.length - 2));

/**
 * Best guess for the stretch of the sentence that carries the chunk, allowing for
 * inflections ("abandon a plan" → "abandoned the plan"). Falls back to the headword alone.
 */
export function guessBlank(text: string, chunkEn: string, headword: string) {
  const words = [...text.matchAll(/[A-Za-z][A-Za-z'-]*/g)].map((m) => ({ w: m[0].toLowerCase(), at: m.index!, end: m.index! + m[0].length }));
  const keys = chunkEn
    .toLowerCase()
    .split(/[\s/]+/)
    .map((k) => k.replace(/[^a-z'-]/g, ""))
    .filter((k) => k && !FILLERS.has(k));
  for (let i = 0; i < words.length && keys.length; i++) {
    if (!words[i].w.startsWith(stem(keys[0]))) continue;
    let j = i;
    let k = 1;
    for (let look = i + 1; look < words.length && k < keys.length && look - j <= 4; look++) {
      if (words[look].w.startsWith(stem(keys[k]))) {
        j = look;
        k++;
      }
    }
    if (k === keys.length) return text.slice(words[i].at, words[j].end);
  }
  const head = words.find((x) => x.w.startsWith(stem(headword.toLowerCase())));
  return head ? text.slice(head.at, head.end) : "";
}

export const normalizeAnswer = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sentenceDue = (s: Sentence) => s.card?.due ?? s.next;

export function dueSentences(list: Sentence[], now = Date.now()) {
  return list
    .filter((s) => sentenceDue(s) <= now)
    .sort((a, b) => sentenceDue(a) - sentenceDue(b))
    .map((s) => s.id);
}

/** New sentences first come back the next morning. */
export function firstDue(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 4);
  return d.getTime();
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function sanitizeSentences(v: unknown, validCard: (c: unknown) => c is CardState): Sentence[] {
  if (!Array.isArray(v)) return [];
  const out: Sentence[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = str(r.id, 40);
    const text = str(r.text, 600).trim();
    const blank = str(r.blank, 200).trim();
    if (!id || seen.has(id) || !text || !blank || !text.includes(blank) || !str(r.wordId, 80) || !str(r.chunk, 200)) continue;
    seen.add(id);
    out.push({
      id,
      wordId: str(r.wordId, 80),
      chunk: str(r.chunk, 200),
      text,
      blank,
      zh: str(r.zh, 600).trim(),
      card: validCard(r.card) ? r.card : null,
      next: num(r.next) ? (r.next as number) : 0,
      added: num(r.added) ? (r.added as number) : 0,
    });
  }
  return out.slice(0, 10000);
}
