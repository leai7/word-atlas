import { Bookmark, BookmarkCheck, CircleCheck, Lightbulb, ListChecks, ListPlus, PenLine, Plus, Share2, X } from "lucide-react";
import { useState } from "react";
import type { Entry, WordRef } from "../atlas/types";
import { useAtlas } from "../atlas/context";
import { isCustom } from "../atlas/custom";
import { splitHighlight, splitPair } from "../lib/text";
import { formatInterval, isMastered } from "../store/srs";
import { pickWords, skipKnown } from "../store/session";
import { addCollocation, dequeue, removeCollocation, toggleBookmark, unmarkKnown, useStore } from "../store/store";
import { Illustration } from "./Illustration";
import { WordSentences, type Compose } from "./Sentences";
import { Speak } from "./Speak";
import { shareWord } from "./share";
import { openWord } from "../lib/router";

/** More than six words or sentence punctuation: probably a sentence, not a collocation. */
const looksLikeSentence = (s: string) => s.trim().split(/\s+/).filter(Boolean).length > 6 || /[.!?;,]\s*\S|[.!?]$/.test(s.trim());

export function Highlight({ text, word }: { text: string; word: string }) {
  const parts = splitHighlight(text, word);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark>{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

export function Pronounce({ entry, refw }: { entry: Entry; refw: WordRef | Entry }) {
  const atlas = useAtlas();
  const accent = useStore((s) => s.settings.accent);
  const both = entry.uk && entry.us && entry.uk !== entry.us;
  const items: ["uk" | "us", string, string][] = both
    ? [["uk", "英", entry.uk], ["us", "美", entry.us]]
    : [[accent, accent === "uk" ? "英" : "美", entry.uk || entry.us]];
  return (
    <div className="pron">
      {(accent === "us" ? [...items].reverse() : items).map(([acc, label, ipa]) => (
        <Speak
          key={acc}
          url={atlas.audio(refw, acc)}
          text={entry.w}
          accent={acc}
          size="sm"
          label={
            <>
              <em>{label}</em>
              {ipa && <span className="ipa">{ipa}</span>}
            </>
          }
        />
      ))}
    </div>
  );
}

export function EntryView({ entry, mode = "detail", eager = true }: { entry: Entry; mode?: "detail" | "intro" | "reveal"; eager?: boolean }) {
  const atlas = useAtlas();
  const ref = atlas.byId.get(entry.id);
  const card = useStore((s) => s.progress.cards[entry.id]);
  const saved = useStore((s) => s.progress.bookmarks.includes(entry.id));
  const queued = useStore((s) => s.progress.queue.includes(entry.id));
  const known = useStore((s) => s.progress.known.includes(entry.id));
  const [compose, setCompose] = useState<Compose>(null);
  const extra = useStore((s) => s.progress.extraCol[entry.id]);
  const sentences = useStore((s) => s.progress.sentences);
  const [adding, setAdding] = useState(false);
  const [colEn, setColEn] = useState("");
  const [colZh, setColZh] = useState("");
  const mine = (extra ?? []).filter((c) => !entry.col.includes(c));
  const cols = [...entry.col, ...mine];
  const editable = mode !== "reveal";
  const saveCol = () => {
    const en = colEn.trim().replace(/[｜|]/g, " ");
    if (!en) return;
    if (cols.some((c) => splitPair(c).en.toLowerCase() === en.toLowerCase())) return window.alert("这个搭配已经在列表里了。");
    // A whole sentence typed here turns every later review into copying the sentence.
    if (looksLikeSentence(en) && !window.confirm("这看起来像一个句子。搭配通常是 2–5 个词的词组（例如 behind schedule）；要造句请点搭配卡片下方的「造句」。\n\n仍要把它新增为搭配吗？")) return;
    const zh = colZh.trim().replace(/[｜|]/g, " ");
    addCollocation(entry.id, zh ? `${en}｜${zh}` : en);
    setColEn("");
    setColZh("");
    setAdding(false);
  };
  const dropCol = (c: string) => {
    const used = sentences.some((x) => x.wordId === entry.id && x.chunk === c);
    if (window.confirm(used ? "删除这个自订搭配？用它写的造句会保留，复习照常。" : "删除这个自订搭配？")) removeCollocation(entry.id, c);
  };
  const accent = useStore((s) => s.settings.accent);
  const topicIdx = atlas.topics.findIndex((t) => t[0] === entry.topic);
  const topic = atlas.topics[topicIdx];
  const exUrls = [atlas.audio(entry, "ex"), atlas.audio(entry, "ex2")];
  const famLinks = entry.fam.map((f) => {
    const w = f.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
    const hit = atlas.words.find((x) => x.word.toLowerCase() === w);
    return { label: f, id: hit?.id };
  });
  const status = card ? (isMastered(card) ? "已掌握" : "学习中") : known ? "已认识" : null;

  return (
    <article className={`entry entry-${mode}`}>
      <div className="entry-art">
        <Illustration src={atlas.img(entry)} word={entry.w} topic={topicIdx} eager={eager} alt={`${entry.w} 插画`} />
      </div>
      <div className="entry-body">
        <header className="entry-head">
          <div className="entry-tags">
            <span className={`chip chip-level lv-${entry.cefr}`}>{entry.cefr}</span>
            {topic && <span className="chip">{topic[1]}</span>}
            {isCustom(entry.id) && <span className="chip">自订</span>}
            {status && <span className={`chip chip-status ${status === "已掌握" ? "is-done" : ""}`}>{status}</span>}
          </div>
          {mode === "detail" && (
            <div className="entry-actions">
              {!card && (
                <button
                  className={`icon-btn ${known ? "is-on" : ""}`}
                  onClick={() => (known ? unmarkKnown(entry.id) : skipKnown(atlas, entry.id))}
                  aria-pressed={known}
                  aria-label={known ? "取消“已认识”" : "我认识这个词"}
                  title={known ? "取消“已认识”，以后可能再安排它" : "我认识这个词：以后不再安排它为新词"}
                >
                  <CircleCheck size={19} />
                </button>
              )}
              {!card && (
                <button className={`icon-btn ${queued ? "is-on" : ""}`} onClick={() => (queued ? dequeue([entry.id]) : pickWords(atlas, [entry.id]))} aria-pressed={queued} aria-label={queued ? "移出待学清单" : "加入待学清单"} title={queued ? "移出待学清单" : "加入待学清单：在每日名额内优先学习"}>
                  {queued ? <ListChecks size={19} /> : <ListPlus size={19} />}
                </button>
              )}
              <button className={`icon-btn ${saved ? "is-on" : ""}`} onClick={() => toggleBookmark(entry.id)} aria-pressed={saved} aria-label={saved ? "取消收藏" : "收藏"} title={saved ? "取消收藏" : "收藏"}>
                {saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
              </button>
              <button className="icon-btn" onClick={() => shareWord(atlas, entry)} aria-label="生成分享卡片" title="生成分享卡片">
                <Share2 size={19} />
              </button>
            </div>
          )}
        </header>
        {ref && !isCustom(ref.id) && (
          <p className="specimen">
            № {String(ref.order + 1).padStart(4, "0")}
            <i />
            Word Atlas
          </p>
        )}
        <h2 className="headword" lang="en">
          {entry.w}
        </h2>
        <Pronounce entry={entry} refw={ref ?? entry} />

        <ol className="senses">
          {entry.senses.map((s, i) => (
            <li key={i}>
              <span className="pos">{s.pos}</span>
              <span className="zh">{s.zh}</span>
              {s.en && (
                <span className="en" lang="en">
                  {s.en}
                </span>
              )}
            </li>
          ))}
        </ol>

        {entry.ex.length > 0 && (
          <section className="block">
            <h3 className="eyebrow">例句</h3>
            <ul className="examples">
              {entry.ex.map((x, i) => (
                <li key={i}>
                  {entry.ex.length > 1 && <span className={`ex-tag ${i ? "is-ielts" : ""}`}>{i ? "雅思语境" : "日常"}</span>}
                  <p className="ex-en" lang="en">
                    <Highlight text={x.en} word={entry.w} />
                    <Speak url={exUrls[i] ?? null} text={x.en} accent={i === 1 && exUrls[1] ? "us" : accent} size="sm" className="ex-speak" />
                  </p>
                  <p className="ex-zh">{x.zh}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(cols.length > 0 || editable) && (
          <section className="block">
            <h3 className="eyebrow">常用搭配</h3>
            <ul className="collocations">
              {cols.map((c) => {
                const { en, zh } = splitPair(c);
                const own = mine.includes(c);
                return (
                  <li key={c} className={own ? "is-own" : ""}>
                    <span lang="en">{en}</span>
                    {zh && <small>{zh}</small>}
                    {own && (
                      <span className="col-own">
                        自订
                        {editable && (
                          <button onClick={() => dropCol(c)} aria-label={`删除搭配 ${en}`} title="删除这个自订搭配">
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    )}
                    {editable && (
                      <button className="col-write" onClick={() => setCompose({ chunk: c })} aria-label={`用 ${en} 造句`} title="用这个搭配造句">
                        <PenLine size={14} /> 造句
                      </button>
                    )}
                  </li>
                );
              })}
              {editable && !adding && (
                <li className="col-add">
                  <button onClick={() => setAdding(true)}>
                    <Plus size={15} /> 新增搭配
                  </button>
                </li>
              )}
            </ul>
            {adding && (
              <form
                className="sentence-form col-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCol();
                }}
              >
                {looksLikeSentence(colEn) && <p className="cf-warn">这看起来像句子。这里填词组；造句请点搭配卡片下方的「造句」。</p>}
                <label>
                  <span>英文搭配</span>
                  <input value={colEn} onChange={(e) => setColEn(e.target.value)} lang="en" autoFocus autoCapitalize="none" spellCheck={false} maxLength={120} placeholder={`例如：${entry.w} the idea of …`} />
                </label>
                <label>
                  <span>中文（选填）</span>
                  <input value={colZh} onChange={(e) => setColZh(e.target.value)} maxLength={80} />
                </label>
                <div className="cf-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!colEn.trim()}>
                    新增
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* Sentences can be written on the word page and while meeting a word for the first time. */}
        {mode !== "reveal" && <WordSentences entry={entry} compose={compose} setCompose={setCompose} />}

        {(famLinks.length > 0 || entry.syn.length > 0 || entry.ant.length > 0) && (
          <section className="block relations">
            {famLinks.length > 0 && (
              <div>
                <h3 className="eyebrow">词族</h3>
                <p>
                  {famLinks.map((f) =>
                    f.id && mode === "detail" ? (
                      <button key={f.label} className="link" onClick={() => openWord(f.id!)}>
                        {f.label}
                      </button>
                    ) : (
                      <span key={f.label}>{f.label}</span>
                    ),
                  )}
                </p>
              </div>
            )}
            {entry.syn.length > 0 && (
              <div>
                <h3 className="eyebrow">近义</h3>
                <p>{entry.syn.map((s) => <span key={s}>{s}</span>)}</p>
              </div>
            )}
            {entry.ant.length > 0 && (
              <div>
                <h3 className="eyebrow">反义</h3>
                <p>{entry.ant.map((s) => <span key={s}>{s}</span>)}</p>
              </div>
            )}
          </section>
        )}

        {entry.tip && (
          <aside className="tip">
            <Lightbulb size={17} strokeWidth={1.8} />
            <p>{entry.tip}</p>
          </aside>
        )}

        {entry.note && <p className="usage-note">用法提醒：{entry.note}</p>}

        {mode === "detail" && card && (
          <p className="memory-note">
            {card.due <= Date.now() ? "现在可以复习" : `下次复习 ${formatInterval(card.due - Date.now())}后`} · 记忆稳定度 {card.s < 1 ? "<1" : Math.round(card.s)} 天 · 已复习 {card.reps} 次
          </p>
        )}
      </div>
    </article>
  );
}
