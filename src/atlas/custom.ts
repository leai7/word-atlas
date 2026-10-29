import { useSyncExternalStore } from "react";
import type { Atlas, Entry, WordRef } from "./types";
import { MEDIA } from "./types";

/** A word the learner added themselves. Text lives with the progress; the picture lives in IndexedDB. */
export interface CustomWord {
  id: string;
  word: string;
  pos: string;
  zh: string;
  ipa: string;
  /** Optional example sentence. */
  ex: { en: string; zh: string } | null;
  /** Collocations as "english｜中文", the same shape as the atlas. */
  col: string[];
  cefr: number;
  topic: number;
  added: number;
}

export const CUSTOM_PREFIX = "u-";
export const isCustom = (id: string) => id.startsWith(CUSTOM_PREFIX);

export function customId(word: string, taken: (id: string) => boolean) {
  const slug = word.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "word";
  let id = `${CUSTOM_PREFIX}${slug}`;
  for (let n = 2; taken(id); n++) id = `${CUSTOM_PREFIX}${slug}-${n}`;
  return id;
}

/**
 * Collocations pasted from a dictionary, one per line. "give up 放弃" and "give up｜放弃"
 * both become "give up｜放弃"; a line without Chinese is kept as English only.
 */
export function parseCollocations(text: string) {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-•·*]|\d+[.)、])\s*/, "").trim();
    if (!line) continue;
    if (/[｜|]/.test(line)) {
      const [en, zh = ""] = line.split(/[｜|]/);
      out.push(zh.trim() ? `${en.trim()}｜${zh.trim()}` : en.trim());
      continue;
    }
    const m = line.match(/^(.*?[A-Za-z][^一-鿿]*?)\s*([一-鿿].*)$/);
    out.push(m ? `${m[1].trim()}｜${m[2].trim()}` : line);
  }
  return [...new Set(out)].slice(0, 30);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeCustom(v: unknown): CustomWord[] {
  if (!Array.isArray(v)) return [];
  const out: CustomWord[] = [];
  const seen = new Set<string>();
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const id = str(r.id, 80);
    const word = str(r.word, 80).trim();
    const zh = str(r.zh, 300).trim();
    if (!isCustom(id) || seen.has(id) || !word || !zh) continue;
    seen.add(id);
    const ex = r.ex && typeof r.ex === "object" ? (r.ex as Record<string, unknown>) : null;
    const exEn = ex ? str(ex.en, 500).trim() : "";
    out.push({
      id,
      word,
      pos: str(r.pos, 12).trim(),
      zh,
      ipa: str(r.ipa, 80).trim(),
      ex: exEn ? { en: exEn, zh: str(ex!.zh, 500).trim() } : null,
      col: Array.isArray(r.col) ? r.col.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 30) : [],
      cefr: typeof r.cefr === "number" && r.cefr >= 0 && r.cefr <= 5 ? Math.round(r.cefr) : 3,
      topic: typeof r.topic === "number" && r.topic >= 0 && r.topic < 100 ? Math.round(r.topic) : 0,
      added: typeof r.added === "number" ? r.added : 0,
    });
  }
  return out.slice(0, 5000);
}

/* ---------- pictures (IndexedDB) ---------- */

const DB = "word-atlas-custom";
const STORE = "img";
let urls = new Map<string, string>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function setUrl(id: string, blob: Blob | null) {
  const next = new Map(urls);
  const old = next.get(id);
  if (old) URL.revokeObjectURL(old);
  if (blob) next.set(id, URL.createObjectURL(blob));
  else next.delete(id);
  urls = next;
  emit();
}

/** Load every stored picture once at start-up. */
export async function loadPictures() {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const req = d.transaction(STORE).objectStore(STORE).openCursor();
      const next = new Map<string, string>();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) {
          urls = next;
          emit();
          return resolve();
        }
        next.set(String(c.key), URL.createObjectURL(c.value as Blob));
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* pictures are optional; words still work without them */
  }
}

/** Shrink to at most 1200px and store as WebP (JPEG where WebP encoding is unavailable). */
export async function savePicture(id: string, file: Blob) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b && b.type === "image/webp" ? resolve(b) : canvas.toBlob((j) => (j ? resolve(j) : reject(new Error("图片处理失败"))), "image/jpeg", 0.85)), "image/webp", 0.85),
  );
  await tx("readwrite", (s) => s.put(blob, id));
  setUrl(id, blob);
}

export async function deletePicture(id: string) {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    /* nothing stored */
  }
  setUrl(id, null);
}

/** Pictures as data URLs for the backup file. */
export async function exportPictures(ids: string[]) {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const blob = await tx<Blob | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
    if (!blob) continue;
    out[id] = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  }
  return out;
}

export async function importPictures(map: unknown) {
  if (!map || typeof map !== "object") return 0;
  let n = 0;
  for (const [id, data] of Object.entries(map as Record<string, unknown>)) {
    if (!isCustom(id) || typeof data !== "string" || !/^data:image\/(webp|jpeg|png);base64,/.test(data)) continue;
    const blob = await (await fetch(data)).blob();
    await tx("readwrite", (s) => s.put(blob, id));
    setUrl(id, blob);
    n++;
  }
  return n;
}

export function usePictures() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => urls,
    () => urls,
  );
}

/* ---------- merge into the atlas ---------- */

export function toEntry(c: CustomWord, atlas: Pick<Atlas, "topics" | "cefr">, hasPicture: boolean): Entry {
  return {
    id: c.id,
    w: c.word,
    uk: c.ipa,
    us: "",
    senses: [{ pos: c.pos, zh: c.zh, en: "" }],
    ex: c.ex ? [c.ex] : [],
    col: c.col,
    fam: [],
    syn: [],
    ant: [],
    tip: "",
    cefr: atlas.cefr[c.cefr] ?? "",
    topic: atlas.topics[c.topic]?.[0] ?? "",
    m: (hasPicture ? MEDIA.img : 0) | (c.ex ? MEDIA.ex : 0),
  };
}

/**
 * The atlas plus the learner's own words. Built-in words keep their order and the galaxy;
 * custom words follow them, are found by id and search, and use the device voice.
 */
export function withCustom(base: Atlas, list: CustomWord[], pictures: Map<string, string>): Atlas {
  if (!list.length) return base;
  const refs: WordRef[] = list.map((c, i) => ({
    id: c.id,
    word: c.word,
    zh: c.pos ? `${c.pos} ${c.zh}` : c.zh,
    ipa: c.ipa,
    cefr: c.cefr,
    topic: c.topic,
    media: (pictures.has(c.id) ? MEDIA.img : 0) | (c.ex ? MEDIA.ex : 0),
    order: base.words.length + i,
  }));
  const entries = new Map(list.map((c) => [c.id, toEntry(c, base, pictures.has(c.id))]));
  const byId = new Map(base.byId);
  refs.forEach((r) => byId.set(r.id, r));
  return {
    ...base,
    custom: refs,
    byId,
    peek: (id) => entries.get(id) ?? base.peek(id),
    entry: (id) => {
      const e = entries.get(id);
      return e ? Promise.resolve(e) : base.entry(id);
    },
    img: (ref, size) => (isCustom(ref.id) ? (pictures.get(ref.id) ?? null) : base.img(ref, size)),
    audio: (ref, kind) => (isCustom(ref.id) ? null : base.audio(ref, kind)),
  };
}
