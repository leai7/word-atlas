import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Entry } from "../atlas/types";
import { splitPair } from "../lib/text";
import { firstDue, guessBlank, sentenceDue, type Sentence } from "../store/chunks";
import { formatInterval } from "../store/srs";
import { removeSentence, saveSentence, useStore } from "../store/store";

/** Which collocation is being written about, and the sentence being edited if any. */
export type Compose = { chunk: string; id?: string; /** Rewrite: start from an empty sentence. */ fresh?: boolean } | null;

export function Composer({ entry, compose, onClose }: { entry: Entry; compose: NonNullable<Compose>; onClose: () => void }) {
  const editing = useStore((s) => (compose.id ? s.progress.sentences.find((x) => x.id === compose.id) : undefined));
  const chunk = splitPair(compose.chunk);
  const keep = editing && !compose.fresh;
  const [text, setText] = useState(keep ? editing.text : "");
  const [blank, setBlank] = useState(keep ? editing.blank : "");
  const [zh, setZh] = useState(keep ? editing.zh : "");
  /** Once the learner edits the blank by hand, stop guessing it. */
  const [manual, setManual] = useState(!!keep);

  useEffect(() => {
    if (!manual) setBlank(guessBlank(text, chunk.en, entry.w));
  }, [text, manual, chunk.en, entry.w]);

  const ok = text.trim() && blank.trim() && text.includes(blank.trim());
  const save = () => {
    if (!ok) return;
    const now = Date.now();
    saveSentence({
      id: editing?.id ?? `s${now.toString(36)}`,
      wordId: entry.id,
      chunk: compose.chunk,
      text: text.trim(),
      blank: blank.trim(),
      zh: zh.trim(),
      card: null,
      next: firstDue(),
      added: now,
    });
    onClose();
  };

  return (
    <form
      className="sentence-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="sentence-chunk">
        用 <b lang="en">{chunk.en}</b> {chunk.zh && <small>{chunk.zh}</small>} 造句
      </p>
      <label>
        <span>你的英文句子</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} lang="en" autoFocus maxLength={600} placeholder={`例如：I had to ${chunk.en} because …`} />
      </label>
      <label>
        <span>复习时挖空的部分（自动找出，可修改）</span>
        <input
          value={blank}
          onChange={(e) => {
            setManual(true);
            setBlank(e.target.value);
          }}
          lang="en"
          maxLength={200}
        />
      </label>
      {text.trim() && blank.trim() && !text.includes(blank.trim()) && <p className="cf-warn">挖空的部分要和句子里的文字完全一样。</p>}
      {blank.trim() && wordCount(blank) >= 5 && wordCount(blank) >= wordCount(text) * 0.7 && (
        <p className="cf-warn">挖空几乎是整句，复习时等于默写整句。搭配通常只挖 2–5 个词。</p>
      )}
      {blank.trim() && !guessBlank(blank, entry.w, entry.w) && <p className="cf-warn">挖空的部分没有包含 {entry.w}，复习时会直接看到这个词。</p>}
      <label>
        <span>中文翻译（选填，复习时当提示）</span>
        <input value={zh} onChange={(e) => setZh(e.target.value)} maxLength={600} />
      </label>
      <div className="cf-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ok}>
          {editing ? "保存修改" : "保存造句"}
        </button>
      </div>
      {editing && <small className="muted">修改句子不会影响复习排程。</small>}
    </form>
  );
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function Marked({ s }: { s: Pick<Sentence, "text" | "blank"> }) {
  const at = s.text.indexOf(s.blank);
  if (at < 0) return <>{s.text}</>;
  return (
    <>
      {s.text.slice(0, at)}
      <mark>{s.blank}</mark>
      {s.text.slice(at + s.blank.length)}
    </>
  );
}

export function nextReview(s: Sentence) {
  const ms = sentenceDue(s) - Date.now();
  return ms <= 0 ? "今天复习" : `${formatInterval(ms)}后复习`;
}

/** The learner's sentences for one word, plus the form to write or edit one. */
export function WordSentences({ entry, compose, setCompose }: { entry: Entry; compose: Compose; setCompose: (c: Compose) => void }) {
  const all = useStore((s) => s.progress.sentences);
  const mine = all.filter((x) => x.wordId === entry.id);
  if (!compose && !mine.length) return null;
  return (
    <section className="block sentences">
      <h3 className="eyebrow">我的造句</h3>
      {compose && <Composer key={`${compose.chunk}|${compose.id ?? ""}`} entry={entry} compose={compose} onClose={() => setCompose(null)} />}
      {mine.length > 0 && (
        <ul className="sentence-list">
          {mine.map((s) => (
            <li key={s.id}>
              <p lang="en">
                <Marked s={s} />
              </p>
              <small>
                {splitPair(s.chunk).en} · {nextReview(s)}
                {s.zh && ` · ${s.zh}`}
              </small>
              <span className="sentence-actions">
                <button className="icon-btn" onClick={() => setCompose({ chunk: s.chunk, id: s.id })} aria-label="编辑造句" title="编辑">
                  <Pencil size={15} />
                </button>
                <button className="icon-btn" onClick={() => window.confirm("删除这个造句？它的复习记录也会删除。") && removeSentence(s.id)} aria-label="删除造句" title="删除">
                  <Trash2 size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
