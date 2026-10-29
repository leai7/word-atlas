import assert from "node:assert/strict";
import { test } from "node:test";
import { customId, parseCollocations, sanitizeCustom, withCustom, type CustomWord } from "./custom";
import type { Atlas, WordRef } from "./types";
import { MEDIA } from "./types";

test("collocations pasted from a dictionary become english｜中文 pairs", () => {
  assert.deepEqual(parseCollocations("give up 放弃\n• make up for｜弥补\n1. call off\n\n give up 放弃"), ["give up｜放弃", "make up for｜弥补", "call off"]);
});

test("custom ids are readable and never collide", () => {
  const taken = new Set(["u-ice-cream"]);
  assert.equal(customId("Ice Cream", (id) => taken.has(id)), "u-ice-cream-2");
  assert.equal(customId("serendipity", () => false), "u-serendipity");
});

test("stored custom words are validated", () => {
  const list = sanitizeCustom([{ id: "u-a", word: "a", zh: "甲", ex: { en: "", zh: "x" } }, { id: "nope", word: "b", zh: "乙" }, { id: "u-c", word: "", zh: "丙" }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].ex, null);
  assert.equal(list[0].cefr, 3);
});

test("custom words join the atlas without touching the learning path", async () => {
  const base: WordRef = { id: "apple", word: "apple", zh: "n. 苹果", ipa: "", cefr: 0, topic: 0, media: MEDIA.img | MEDIA.ex, order: 0 };
  const atlas = {
    words: [base],
    custom: [],
    byId: new Map([["apple", base]]),
    topics: [["daily", "日常"]],
    cefr: ["A1", "A2", "B1", "B2", "C1", "C2"],
    peek: () => undefined,
    entry: () => Promise.reject(new Error("no")),
    img: () => "/apple.webp",
    audio: () => "/apple.mp3",
  } as unknown as Atlas;
  const word: CustomWord = { id: "u-quokka", word: "quokka", pos: "n.", zh: "短尾矮袋鼠", ipa: "", ex: null, col: [], cefr: 2, topic: 0, added: 1 };
  const merged = withCustom(atlas, [word], new Map([["u-quokka", "blob:x"]]));
  assert.equal(merged.words.length, 1);
  assert.equal(merged.custom[0].order, 1);
  assert.equal(merged.byId.get("u-quokka")?.zh, "n. 短尾矮袋鼠");
  assert.equal((await merged.entry("u-quokka")).senses[0].zh, "短尾矮袋鼠");
  assert.equal(merged.img(merged.custom[0]), "blob:x");
  assert.equal(merged.audio(merged.custom[0], "uk"), null);
  // A picture without an example sentence can't make a picture question.
  assert.equal(merged.custom[0].media & MEDIA.ex, 0);
});
