import assert from "node:assert/strict";
import { test } from "node:test";
import type { Atlas, WordRef } from "../atlas/types";
import type { CardState } from "./srs";
import { nextNew, todayPlan } from "./session";
import { defaultSettings, emptyProgress } from "./store";

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

test("picked words count toward the daily limit", () => {
  const p = { ...emptyProgress("x"), queue: ["b3", "b2", "b1"] };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 2), ["b3", "b2"]);
  const plan = todayPlan(atlas, p, { ...defaultSettings, dailyNew: 5 });
  assert.equal(plan.fresh.length, 5);
  assert.equal(plan.picked, 3);
});

test("learned or unknown picks are skipped", () => {
  const p = { ...emptyProgress("x"), queue: ["gone", "a1", "b2"], cards: { a1: card } };
  assert.deepEqual(nextNew(atlas, p, defaultSettings, 3), ["b2", "a2", "a3"]);
});
