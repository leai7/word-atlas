import assert from "node:assert/strict";
import { test } from "node:test";
import type { Atlas, WordRef } from "../atlas/types";
import type { CardState } from "./srs";
import { answerChunk, buildSession, dailyLimit, examPlan, nextNew, pickWords, REVIEW_DAYS, skipKnown, todayPlan } from "./session";
import type { Sentence } from "./chunks";
import { Rating } from "./srs";
import { defaultSettings, emptyProgress, store } from "./store";

const words: WordRef[] = ["a1", "a2", "a3", "b1", "b2", "b3"].map((id, order) => ({
  id,
  word: id,
  zh: "n. 词",
  ipa: "",
  cefr: id.startsWith("a") ? 0 : 1,
  topic: 0,
  media: 0,
  order,
}));
const atlas = { words, byId: new Map(words.map((w) => [w.id, w])) } as unknown as Atlas;
const card: CardState = { due: Date.now() + 1e9, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, seen: 1 };

test("picked words come first, the learning path fills the rest", () => {
  const p = { ...emptyProgress("x"), queue: ["b3", "b1"] };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 4), ["b3", "b1", "a1", "a2"]);
});

test("picked words count toward the daily limit; the rest wait", () => {
  const p = { ...emptyProgress("x"), queue: ["b3", "b2", "b1"] };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 2), ["b3", "b2"]);
  const plan = todayPlan(atlas, p, { ...defaultSettings, dailyNew: 5 });
  assert.deepEqual(plan.fresh, ["b3", "b2", "b1", "a1", "a2"]);
  assert.equal(plan.picked, 3);
});

test("known words are never offered", () => {
  const p = { ...emptyProgress("x"), known: ["a1", "a3"] };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 3), ["a2", "b1", "b2"]);
});

// The store saves through window timers; a stub is enough for these tests.
(globalThis as unknown as { window: object }).window = { setTimeout: () => 0, clearTimeout: () => undefined };

const startJourney = (dailyNew: number) => {
  const settings = { ...defaultSettings, dailyNew };
  store.settings(settings);
  store.progress(() => ({ ...emptyProgress("x"), session: buildSession(atlas, emptyProgress("x"), settings) }));
};

test("a pick added mid-journey takes the place of a system word not shown yet", () => {
  startJourney(3); // a1 a2 a3: intro steps 0-2, quizzes 3-5
  assert.equal(pickWords(atlas, ["b2"]), 1);
  const s = store.get().progress.session!;
  assert.deepEqual(s.newIds, ["a1", "a2", "b2"]);
  assert.ok(!s.steps.some((x) => x.id === "a3"));
  assert.ok(s.steps.some((x) => x.id === "b2" && x.kind === "intro"));
});

test("picks beyond the allowance wait when every place is already met", () => {
  startJourney(1);
  assert.equal(pickWords(atlas, ["b2"]), 0);
  assert.deepEqual(store.get().progress.session!.newIds, ["a1"]);
  assert.deepEqual(store.get().progress.queue, ["b2"]);
});

test("skipping a known word swaps in the next one", () => {
  startJourney(2); // a1 a2
  skipKnown(atlas, "a1");
  const p = store.get().progress;
  assert.deepEqual(p.session!.newIds, ["a2", "a3"]);
  assert.equal(p.session!.steps[0].id, "a2");
  assert.deepEqual(p.known, ["a1"]);
});

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("the exam plan spreads unseen target words over the days before review-only time", () => {
  // Band 5 covers A1–B1; the fixture has 6 unseen words there. 5 days left, last 3 for review → 2 learning days.
  const s = { ...defaultSettings, examDate: day(5), targetBand: 5, planAuto: true };
  const plan = examPlan(atlas, emptyProgress("x"), s)!;
  assert.equal(plan.left, 5);
  assert.equal(plan.learnDays, 5 - REVIEW_DAYS);
  assert.equal(plan.daily, 3);
  assert.equal(dailyLimit(atlas, emptyProgress("x"), s), 3);
  assert.equal(dailyLimit(atlas, emptyProgress("x"), { ...s, planAuto: false }), defaultSettings.dailyNew);
});

test("no new words in the last days before the exam", () => {
  const s = { ...defaultSettings, examDate: day(2), planAuto: true };
  assert.equal(dailyLimit(atlas, emptyProgress("x"), s), 0);
});

test("learned or unknown picks are skipped", () => {
  const p = { ...emptyProgress("x"), queue: ["gone", "a1", "b2"], cards: { a1: card } };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 3), ["b2", "a2", "a3"]);
});

const sentence = (id: string, wordId: string, next: number): Sentence => ({ id, wordId, chunk: "x｜甲", text: "x y", blank: "x", zh: "", card: null, next, added: 0 });
const dueCard: CardState = { ...card, due: 1 };

test("a word with your sentence is reviewed through the sentence, once per journey", () => {
  const p = {
    ...emptyProgress("x"),
    cards: { a1: dueCard, a2: dueCard },
    sentences: [sentence("s1", "a1", 1e15), sentence("s2", "a1", 2e15), sentence("s3", "a2", 1)],
  };
  const plan = todayPlan(atlas, p, { ...defaultSettings, dailyNew: 0 });
  assert.deepEqual(plan.due, []);
  // a2's own sentence is due; a1 is due as a word, so its soonest sentence stands in.
  assert.deepEqual(plan.chunks, ["s3", "s1"]);
});

test("answering a sentence also reviews its word", () => {
  const settings = { ...defaultSettings, dailyNew: 0 };
  const base = { ...emptyProgress("x"), cards: { a1: dueCard }, sentences: [sentence("s1", "a1", 1)] };
  store.settings(settings);
  store.progress(() => ({ ...base, session: buildSession(atlas, base, settings) }));
  answerChunk({ id: "s1", kind: "chunk" }, false, Rating.Again, "nope");
  const p = store.get().progress;
  assert.ok(p.sentences[0].card);
  assert.notEqual(p.cards.a1.due, 1);
  assert.deepEqual(p.mistakes, ["a1"]);
});

const kinds = (ids = true) => store.get().progress.session!.steps.map((x) => (ids ? `${x.id}:${x.kind === "intro" ? "i" : "q"}` : x.kind));

test("a word added mid-journey joins the next round instead of being asked right after its card", () => {
  startJourney(5); // a1..b2: five intros, five recalls
  store.progress((p) => ({ ...p, session: { ...p.session!, index: 2 } })); // a3's card is on screen
  pickWords(atlas, ["b3"]); // no room: b2 (not met yet) gives its place to b3
  const steps = kinds();
  const at = steps.indexOf("b3:i");
  // b3 is met together with b1, and recalled along with the words already met.
  assert.deepEqual(steps.slice(0, 5), ["a1:i", "a2:i", "a3:i", "b1:i", "b3:i"]);
  assert.ok(at >= 0 && steps.indexOf("b3:q") > steps.lastIndexOf("b1:i"));
  assert.equal(steps.filter((x) => x.endsWith(":q")).length, 5);
});

test("a last group of one or two joins the group before", () => {
  startJourney(6);
  assert.deepEqual(kinds(false).slice(0, 6), ["intro", "intro", "intro", "intro", "intro", "intro"]);
});
