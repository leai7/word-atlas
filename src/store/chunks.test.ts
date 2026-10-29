import assert from "node:assert/strict";
import { test } from "node:test";
import { dueSentences, guessBlank, normalizeAnswer, sanitizeSentences, type Sentence } from "./chunks";

test("the blank follows the chunk through inflections and fillers", () => {
  assert.equal(guessBlank("I decided to abandon the plan after it failed.", "abandon a plan", "abandon"), "abandon the plan");
  assert.equal(guessBlank("She abandoned her old plans last year.", "abandon a plan", "abandon"), "abandoned her old plans");
  assert.equal(guessBlank("We finally give up on it.", "give up sth", "give"), "give up");
  // Irregular forms come from the table.
  assert.equal(guessBlank("We finally gave up on it.", "give up sth", "give"), "gave up");
  assert.equal(guessBlank("She has taken part in many debates.", "take part in", "take"), "taken part in");
  assert.equal(guessBlank("He went abroad last year.", "go abroad", "go"), "went abroad");
  assert.equal(guessBlank("Their children grew up in Paris.", "grow up", "grow"), "grew up");
  // No match for the whole chunk: fall back to the headword.
  assert.equal(guessBlank("They abandoned ship.", "abandon a plan", "abandon"), "abandoned");
  assert.equal(guessBlank("Nothing here.", "abandon a plan", "abandon"), "");
});

test("answers compare without case, curly quotes or punctuation", () => {
  assert.equal(normalizeAnswer("  Gave   UP! "), normalizeAnswer("gave up"));
  assert.equal(normalizeAnswer("one’s"), "one's");
});

const s = (id: string, due: number, card = false): Sentence => ({
  id,
  wordId: "w",
  chunk: "a｜甲",
  text: "a b",
  blank: "a",
  zh: "",
  card: card ? { due, s: 1, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, seen: 1 } : null,
  next: due,
  added: 0,
});

test("due sentences come soonest first; reviewed ones follow their card", () => {
  const list = [s("late", 50), s("soon", 10), s("future", 1e15), { ...s("carded", 1e15, true), card: { ...s("x", 5, true).card! } }];
  assert.deepEqual(dueSentences(list, 100), ["carded", "soon", "late"]);
});

test("stored sentences need a blank that is really in the text", () => {
  const ok = (_c: unknown): _c is never => false;
  assert.equal(sanitizeSentences([{ ...s("a", 1), blank: "zzz" }, s("b", 1)], ok).length, 1);
});
