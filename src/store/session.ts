import type { Atlas, WordRef } from "../atlas/types";
import { MEDIA } from "../atlas/types";
import { hashSeed, normalize, shuffle } from "../lib/text";
import { isMastered, review, Rating, type Grade } from "./srs";
import { dueSentences, sentenceDue, type Sentence } from "./chunks";
import { bumpDay, dayKey, store, type ActiveSession, type Progress, type QuizKind, type Settings, type Step } from "./store";

export function dueIds(p: Progress, now = Date.now()) {
  return Object.entries(p.cards)
    .filter(([, c]) => c.due <= now)
    .sort((a, b) => a[1].due - b[1].due)
    .map(([id]) => id);
}

export function newToday(p: Progress) {
  return p.days[dayKey()]?.n ?? 0;
}

/** Words from the learner's own list that are still unseen, in the order they were added. */
export function queuedNew(atlas: Atlas, p: Progress) {
  return p.queue.filter((id) => atlas.byId.has(id) && !p.cards[id]);
}

/**
 * Next unseen words within today's allowance: the learner's own picks first,
 * then the learning path from their starting level fills the rest.
 * Words marked as known and anything in `skip` are left out.
 */
export function nextNew(atlas: Atlas, p: Progress, settings: Settings, count: number, skip: string[] = []) {
  const out: string[] = queuedNew(atlas, p).filter((id) => !skip.includes(id)).slice(0, count);
  const known = new Set(p.known);
  const pass = (from: number) => {
    for (const w of atlas.words) {
      if (out.length >= count) return;
      if (w.cefr < from || p.cards[w.id] || known.has(w.id) || out.includes(w.id) || skip.includes(w.id)) continue;
      out.push(w.id);
    }
  };
  pass(settings.startLevel);
  if (out.length < count) pass(0);
  return out;
}

/** IELTS band → highest CEFR level to cover (A1 = 0 … C2 = 5). A common rough mapping, not an official requirement. */
export function bandTop(band: number) {
  return band >= 8.5 ? 5 : band >= 7 ? 4 : band >= 5.5 ? 3 : 2;
}

/** The last days before the exam are kept for review only. */
export const REVIEW_DAYS = 3;
const MAX_DAILY = 60;

/**
 * Daily new words needed to cover the target band's words before the exam.
 * Today's new words are counted back in, so the number stays put while you learn.
 */
export function examPlan(atlas: Atlas, p: Progress, s: Settings, now = new Date()) {
  if (!s.examDate) return null;
  const [y, m, d] = s.examDate.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const left = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
  const top = Math.max(bandTop(s.targetBand), s.startLevel);
  const known = new Set(p.known);
  let scope = 0;
  let unseen = 0;
  for (const w of atlas.words) {
    if (w.cefr < s.startLevel || w.cefr > top) continue;
    scope++;
    if (!p.cards[w.id] && !known.has(w.id)) unseen++;
  }
  const learnDays = Math.max(0, left - REVIEW_DAYS);
  const need = learnDays && unseen ? Math.ceil((unseen + newToday(p)) / learnDays) : 0;
  return { left, top, scope, unseen, learnDays, need, daily: Math.min(MAX_DAILY, need), behind: need > MAX_DAILY };
}

/** Today's new-word allowance: the exam plan's number when it is on, otherwise the fixed setting. */
export function dailyLimit(atlas: Atlas, p: Progress, s: Settings) {
  const plan = s.planAuto ? examPlan(atlas, p, s) : null;
  return plan && plan.left >= 0 ? plan.daily : s.dailyNew;
}

/**
 * Reviews for today. A word you wrote sentences for is reviewed through one of them
 * instead of a word question, and each word comes up at most once a journey.
 */
export function todayPlan(atlas: Atlas, p: Progress, s: Settings) {
  const newLeft = Math.max(0, dailyLimit(atlas, p, s) - newToday(p));
  const fresh = nextNew(atlas, p, s, newLeft);
  const picked = fresh.filter((id) => p.queue.includes(id)).length;
  const byWord = new Map<string, Sentence[]>();
  for (const x of p.sentences) if (atlas.byId.has(x.wordId)) byWord.set(x.wordId, [...(byWord.get(x.wordId) ?? []), x]);
  const used = new Set(fresh); // words met as new today are not also reviewed
  const chunks: string[] = [];
  const take = (x: Sentence) => {
    chunks.push(x.id);
    used.add(x.wordId);
  };
  const sentenceById = new Map(p.sentences.map((x) => [x.id, x]));
  for (const id of dueSentences(p.sentences)) {
    const x = sentenceById.get(id)!;
    if (atlas.byId.has(x.wordId) && !used.has(x.wordId)) take(x);
  }
  const due: string[] = [];
  for (const id of dueIds(p)) {
    if (!atlas.byId.has(id) || used.has(id)) continue;
    const mine = byWord.get(id);
    if (mine) take(mine.reduce((a, b) => (sentenceDue(b) < sentenceDue(a) ? b : a)));
    else due.push(id);
  }
  return { due, fresh, picked, chunks, minutes: Math.max(1, Math.round(due.length * 0.25 + chunks.length * 0.4 + fresh.length * 0.9)) };
}

/** The picture question needs both a picture and an example sentence to blank out. */
const canPicture = (ref: WordRef) => !!(ref.media & MEDIA.img) && !!(ref.media & MEDIA.ex);

function quizKind(ref: WordRef, p: Progress, s: Settings, salt: number): QuizKind {
  const c = p.cards[ref.id];
  const hasImg = canPicture(ref);
  const roll = hashSeed(ref.id + salt) % 100;
  if (!c || c.s < 2) {
    if (hasImg && roll < 45) return "picture";
    return roll < 80 ? "meaning" : "listen";
  }
  if (s.spell && (c.s >= 4 || roll < 35)) return roll < 75 ? "spell" : hasImg ? "picture" : "listen";
  return roll < 50 ? "listen" : hasImg ? "picture" : "meaning";
}

/** Distractors that look plausible: same level, similar spelling or length, different meaning. */
export function distractors(atlas: Atlas, ref: WordRef, kind: QuizKind, seed: number) {
  const target = normalize(ref.word);
  const zhCore = ref.zh.replace(/^[a-z.]+\s*/, "").split(/[；;，,]/)[0];
  const scored: [number, WordRef][] = [];
  const pool = atlas.words;
  const start = Math.max(0, ref.order - 400);
  for (let i = start; i < Math.min(pool.length, ref.order + 400); i++) {
    const w = pool[i];
    if (w.id === ref.id || normalize(w.word) === target) continue;
    if (zhCore && w.zh.includes(zhCore)) continue;
    let score = hashSeed(w.id + seed) % 100;
    if (kind === "listen" || kind === "picture") {
      if (w.word[0]?.toLowerCase() === target[0]) score += 120;
      score += Math.max(0, 60 - Math.abs(w.word.length - target.length) * 20);
    } else {
      if (w.cefr === ref.cefr) score += 40;
      if (w.zh.split(" ")[0] === ref.zh.split(" ")[0]) score += 60; // same part of speech
    }
    scored.push([score, w]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const [, w] of scored) {
    const key = kind === "meaning" ? w.zh : normalize(w.word);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(w.id);
    if (picks.length === 3) break;
  }
  return shuffle([ref.id, ...picks], seed);
}

export function buildSession(atlas: Atlas, p: Progress, s: Settings, opts?: { ids?: string[]; reviewOnly?: boolean }): ActiveSession {
  const seed = Date.now();
  const plan = todayPlan(atlas, p, s);
  const reviewIds = opts?.ids ? opts.ids.filter((id) => p.cards[id]) : plan.due.slice(0, 120);
  const newIds = opts?.ids ? opts.ids.filter((id) => !p.cards[id]) : opts?.reviewOnly ? [] : plan.fresh;
  const chunkIds = opts?.ids ? [] : plan.chunks.slice(0, 40);
  // Word reviews first while attention is fresh, then your own sentences, then new words in small groups.
  const steps: Step[] = reviewIds.map((id, i) => quizStep(atlas, p, s, id, seed + i));
  steps.push(...shuffle(chunkIds, seed).map((id): Step => ({ id, kind: "chunk" })));
  steps.push(...newWordSteps(atlas, p, s, newIds, seed));
  return { id: `s${seed}`, started: seed, steps, index: 0, graded: {}, newIds, reviewIds, chunkIds };
}

function quizStep(atlas: Atlas, p: Progress, s: Settings, id: string, salt: number): Step {
  const ref = atlas.byId.get(id)!;
  const kind = quizKind(ref, p, s, salt);
  return { id, kind, options: kind === "spell" ? undefined : distractors(atlas, ref, kind, salt) };
}

/** Groups of five; a last group of one or two joins the one before, so no word is asked right after meeting it alone. */
function groupsOfFive(ids: string[]) {
  const out: string[][] = [];
  for (let g = 0; g < ids.length; g += 5) out.push(ids.slice(g, g + 5));
  if (out.length > 1 && out[out.length - 1].length <= 2) out[out.length - 2].push(...out.pop()!);
  return out;
}

/**
 * Meet five, then recall those five in a different order.
 * `carry` are words already met whose recall is still ahead; they join the first recall round.
 */
function newWordSteps(atlas: Atlas, p: Progress, s: Settings, ids: string[], seed: number, carry: string[] = []) {
  const steps: Step[] = [];
  const groups = groupsOfFive(ids);
  if (!groups.length && carry.length) groups.push([]);
  groups.forEach((group, g) => {
    group.forEach((id) => steps.push({ id, kind: "intro" }));
    const recall = g === 0 ? [...carry, ...group] : group;
    shuffle(recall, seed + g).forEach((id, i) => steps.push(quizStep(atlas, p, s, id, seed + 1000 + g * 10 + i)));
  });
  return steps;
}

const activeSession = (p: Progress) => (p.session && !p.session.finished && p.session.index < p.session.steps.length ? p.session : null);

/** New words of a journey that have not been shown yet (their first card is still ahead). */
export function unmetNew(s: ActiveSession) {
  return s.newIds.filter((id) => !(id in s.graded) && s.steps.findIndex((x) => x.id === id) > s.index);
}

/** Take words out of a journey from the current step on, keeping everything already done. */
function withoutWords(s: ActiveSession, ids: string[]): ActiveSession {
  const drop = new Set(ids);
  const steps = [...s.steps.slice(0, s.index), ...s.steps.slice(s.index).filter((x) => !drop.has(x.id))];
  return { ...s, steps, newIds: s.newIds.filter((id) => !drop.has(id)) };
}

/**
 * Add new words to a journey in progress and regroup every new word still ahead, so the
 * meet-five-then-recall rhythm holds instead of a lone word being asked straight after its card.
 * `shownCurrent`: the step at `index` is on screen (so counts as done for grouping).
 */
function withWords(atlas: Atlas, p: Progress, settings: Settings, s: ActiveSession, ids: string[], shownCurrent = true): ActiveSession {
  if (!ids.length) return s;
  const cut = Math.min(s.steps.length, s.index + (shownCurrent ? 1 : 0));
  const head = s.steps.slice(0, cut);
  const pending = s.newIds.filter((id) => !(id in s.graded));
  const met = pending.filter((id) => head.some((x) => x.id === id && x.kind === "intro"));
  const unmet = pending.filter((id) => !met.includes(id));
  const regrouped = new Set(pending);
  // Reviews, sentences and retries ahead stay as they are; first-time steps of pending new words are rebuilt.
  const others = s.steps.slice(cut).filter((x) => !regrouped.has(x.id) || ("retry" in x && x.retry));
  const rebuilt = newWordSteps(atlas, p, settings, [...unmet, ...ids], Date.now(), met);
  return { ...s, newIds: [...s.newIds, ...ids], steps: [...head, ...others, ...rebuilt] };
}

const settle = (s: ActiveSession): ActiveSession => (s.index >= s.steps.length ? { ...s, pending: undefined, finished: Date.now() } : s);

/**
 * Add words to the learner's list. Within today's allowance they are learned today:
 * a journey in progress gives them the places of system words not shown yet.
 * Picks beyond the allowance wait for the next day.
 * Returns how many of the new picks land in today's learning.
 */
export function pickWords(atlas: Atlas, ids: string[]) {
  const before = store.get().progress;
  const fresh = [...new Set(ids)].filter((id) => atlas.byId.has(id) && !before.cards[id]);
  store.progress((p) => ({ ...p, queue: [...new Set([...p.queue, ...ids])].slice(0, 2000), known: p.known.filter((x) => !fresh.includes(x)) }));
  const { progress, settings } = store.get();
  const sess = activeSession(progress);
  if (!sess) {
    const today = todayPlan(atlas, progress, settings).fresh;
    return fresh.filter((id) => today.includes(id)).length;
  }
  const add = fresh.filter((id) => !sess.newIds.includes(id) && !sess.reviewIds.includes(id));
  const inSession = fresh.length - add.length;
  // Room left today, counting new words of this journey not answered yet.
  const pendingNew = sess.newIds.filter((id) => !(id in sess.graded)).length;
  const room = Math.max(0, dailyLimit(atlas, progress, settings) - newToday(progress) - pendingNew);
  const swappable = unmetNew(sess).filter((id) => !progress.queue.includes(id));
  const take = Math.min(add.length, room + swappable.length);
  const swap = swappable.slice(swappable.length - Math.max(0, take - room));
  const next = withWords(atlas, progress, settings, withoutWords(sess, swap), add.slice(0, take));
  store.progress((p) => ({ ...p, session: next }));
  return inSession + take;
}

/** The learner already knows this word: never offer it as new again. */
export function skipKnown(atlas: Atlas, id: string) {
  dropNew(atlas, id, true);
}

/**
 * Take a word out of today's new words (and out of the learner's list).
 * In a journey it leaves from the current step on, and the next word in line takes its place.
 */
export function dropNew(atlas: Atlas, id: string, known = false) {
  store.progress((p) => ({ ...p, known: known ? [...new Set([...p.known, id])] : p.known, queue: p.queue.filter((x) => x !== id) }));
  const { progress, settings } = store.get();
  const sess = activeSession(progress);
  if (!sess || !sess.newIds.includes(id) || id in sess.graded) return;
  const rest = withoutWords(sess, [id]);
  const swap = nextNew(atlas, progress, settings, 1, [...rest.newIds, ...rest.reviewIds]);
  store.progress((p) => ({ ...p, session: settle(withWords(atlas, progress, settings, rest, swap, false)) }));
}

export function gradeFor(kind: QuizKind, correct: boolean, ms: number, hinted: boolean): Grade {
  if (!correct) return Rating.Again;
  if (hinted) return Rating.Hard;
  const slow = kind === "spell" ? 20000 : 9000;
  const fast = kind === "spell" ? 6000 : 2500;
  if (ms > slow) return Rating.Hard;
  if (ms < fast && kind === "spell") return Rating.Easy;
  return Rating.Good;
}

/** Apply an answer. Only the first attempt for a word in a session updates memory and stats. */
export function answer(atlas: Atlas, step: Step & { kind: QuizKind }, correct: boolean, grade: Grade, value: string) {
  const { settings } = store.get();
  store.progress((p) => {
    const sess = p.session;
    if (!sess) return p;
    let next: Progress = { ...p, session: { ...sess, pending: { correct, value } } };
    const first = !(step.id in sess.graded) && !step.retry;
    if (first) {
      next = {
        ...next,
        cards: { ...next.cards, [step.id]: review(p.cards[step.id], grade, Date.now(), settings.retention) },
        session: { ...next.session!, graded: { ...sess.graded, [step.id]: grade } },
        mistakes: correct ? next.mistakes : [step.id, ...next.mistakes.filter((x) => x !== step.id)].slice(0, 300),
        queue: next.queue.filter((x) => x !== step.id),
      };
      next = bumpDay(next, { r: 1, c: correct ? 1 : 0, n: sess.newIds.includes(step.id) ? 1 : 0 });
    }
    if (!correct) {
      // Practise it again a few steps later in another format; never re-graded.
      const steps = [...next.session!.steps];
      const retries = steps.filter((x) => x.id === step.id && "retry" in x && x.retry).length;
      if (retries < 2) {
        const ref = atlas.byId.get(step.id)!;
        const kind: QuizKind = step.kind === "meaning" ? (canPicture(ref) ? "picture" : "listen") : "meaning";
        const at = Math.min(steps.length, sess.index + 4);
        steps.splice(at, 0, { id: step.id, kind, retry: true, options: distractors(atlas, ref, kind, Date.now()) });
        next = { ...next, session: { ...next.session!, steps } };
      }
    }
    return next;
  });
}

/** Move to the next step; `seconds` is time spent on this step, capped so idle tabs don't inflate stats. */
export function advance(seconds: number) {
  store.progress((p) => {
    const s = p.session;
    if (!s) return p;
    const index = s.index + 1;
    const finished = index >= s.steps.length ? Date.now() : undefined;
    const next = bumpDay(p, { t: Math.max(0, Math.min(90, Math.round(seconds))) });
    return { ...next, session: { ...s, index, pending: undefined, finished } };
  });
}

export function sessionStats(s: ActiveSession) {
  const graded = Object.values(s.graded);
  const correct = graded.filter((g) => g !== Rating.Again).length;
  return { total: graded.length, correct, accuracy: graded.length ? Math.round((correct / graded.length) * 100) : 0 };
}

export const masteredCount = (p: Progress) => Object.values(p.cards).filter(isMastered).length;

/**
 * Grade a sentence review. It also counts as a review of its word.
 * Like words, only the first attempt counts; a miss comes back a few steps later.
 */
export function answerChunk(step: Step & { kind: "chunk" }, correct: boolean, grade: Grade, value: string) {
  const { settings } = store.get();
  store.progress((p) => {
    const sess = p.session;
    if (!sess) return p;
    let next: Progress = { ...p, session: { ...sess, pending: { correct, value } } };
    if (!(step.id in sess.graded) && !step.retry) {
      const now = Date.now();
      const wordId = p.sentences.find((x) => x.id === step.id)?.wordId;
      const word = wordId ? p.cards[wordId] : undefined;
      next = {
        ...next,
        sentences: next.sentences.map((x) => (x.id === step.id ? { ...x, card: review(x.card ?? undefined, grade, now, settings.retention) } : x)),
        cards: word && wordId ? { ...next.cards, [wordId]: review(word, grade, now, settings.retention) } : next.cards,
        mistakes: correct || !wordId ? next.mistakes : [wordId, ...next.mistakes.filter((x) => x !== wordId)].slice(0, 300),
        session: { ...next.session!, graded: { ...sess.graded, [step.id]: grade } },
      };
      next = bumpDay(next, { r: 1, c: correct ? 1 : 0 });
    }
    if (!correct) {
      const steps = [...next.session!.steps];
      if (steps.filter((x) => x.id === step.id && "retry" in x && x.retry).length < 2) {
        steps.splice(Math.min(steps.length, sess.index + 4), 0, { id: step.id, kind: "chunk", retry: true });
        next = { ...next, session: { ...next.session!, steps } };
      }
    }
    return next;
  });
}
