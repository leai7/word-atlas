import type { Atlas, WordRef } from "../atlas/types";
import { MEDIA } from "../atlas/types";
import { hashSeed, normalize, shuffle } from "../lib/text";
import { isMastered, review, Rating, type Grade } from "./srs";
import { bumpDay, dayKey, enqueue, store, type ActiveSession, type Progress, type QuizKind, type Settings, type Step } from "./store";

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
 * Next unseen words: every word the learner picked (they are learned the day they are added),
 * then the learning path from their starting level fills up to `count`.
 */
export function nextNew(atlas: Atlas, p: Progress, settings: Settings, count: number) {
  const out: string[] = queuedNew(atlas, p);
  const pass = (from: number) => {
    for (const w of atlas.words) {
      if (out.length >= count) return;
      if (w.cefr < from || p.cards[w.id] || out.includes(w.id)) continue;
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
  let scope = 0;
  let unseen = 0;
  for (const w of atlas.words) {
    if (w.cefr < s.startLevel || w.cefr > top) continue;
    scope++;
    if (!p.cards[w.id]) unseen++;
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

export function todayPlan(atlas: Atlas, p: Progress, s: Settings) {
  const due = dueIds(p).filter((id) => atlas.byId.has(id));
  const newLeft = Math.max(0, dailyLimit(atlas, p, s) - newToday(p));
  const fresh = nextNew(atlas, p, s, newLeft);
  const picked = fresh.filter((id) => p.queue.includes(id)).length;
  return { due, fresh, picked, minutes: Math.max(1, Math.round(due.length * 0.25 + fresh.length * 0.9)) };
}

function quizKind(ref: WordRef, p: Progress, s: Settings, salt: number): QuizKind {
  const c = p.cards[ref.id];
  const hasImg = !!(ref.media & MEDIA.img);
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
  // Reviews first while attention is fresh, then new words in small groups.
  const steps: Step[] = reviewIds.map((id, i) => quizStep(atlas, p, s, id, seed + i));
  steps.push(...newWordSteps(atlas, p, s, newIds, seed));
  return { id: `s${seed}`, started: seed, steps, index: 0, graded: {}, newIds, reviewIds };
}

function quizStep(atlas: Atlas, p: Progress, s: Settings, id: string, salt: number): Step {
  const ref = atlas.byId.get(id)!;
  const kind = quizKind(ref, p, s, salt);
  return { id, kind, options: kind === "spell" ? undefined : distractors(atlas, ref, kind, salt) };
}

/** Meet five, then recall those five in a different order. */
function newWordSteps(atlas: Atlas, p: Progress, s: Settings, ids: string[], seed: number) {
  const steps: Step[] = [];
  for (let g = 0; g < ids.length; g += 5) {
    const group = ids.slice(g, g + 5);
    group.forEach((id) => steps.push({ id, kind: "intro" }));
    shuffle(group, seed + g).forEach((id, i) => steps.push(quizStep(atlas, p, s, id, seed + 1000 + g + i)));
  }
  return steps;
}

/**
 * Add words to the learner's list. They are learned today: a journey in progress
 * takes them at the end, otherwise they lead the next one.
 */
export function pickWords(atlas: Atlas, ids: string[]) {
  enqueue(ids);
  const { progress, settings } = store.get();
  const sess = progress.session;
  if (!sess || sess.finished) return;
  const add = [...new Set(ids)].filter((id) => atlas.byId.has(id) && !progress.cards[id] && !sess.newIds.includes(id) && !sess.reviewIds.includes(id));
  if (!add.length) return;
  const steps = newWordSteps(atlas, progress, settings, add, Date.now());
  store.progress((p) => (p.session ? { ...p, session: { ...p.session, newIds: [...p.session.newIds, ...add], steps: [...p.session.steps, ...steps] } } : p));
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
        const kind: QuizKind = step.kind === "meaning" ? (ref.media & MEDIA.img ? "picture" : "listen") : "meaning";
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
