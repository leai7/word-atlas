import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useAtlas } from "../atlas/context";
import { openWord } from "../lib/router";
import { sentenceDue } from "../store/chunks";
import { removeSentence, useStore } from "../store/store";
import { Marked, nextReview } from "../ui/Sentences";

/** Every sentence the learner wrote, soonest review first. Writing and editing happen on the word page. */
export function MySentences() {
  const atlas = useAtlas();
  const sentences = useStore((s) => s.progress.sentences);
  const list = useMemo(() => [...sentences].sort((a, b) => sentenceDue(a) - sentenceDue(b)), [sentences]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3 className="eyebrow">我的造句 · {sentences.length}</h3>
      </div>
      {list.length ? (
        <ul className="sentence-list">
          {list.map((s) => {
            const w = atlas.byId.get(s.wordId);
            return (
              <li key={s.id}>
                <p lang="en">
                  <Marked s={s} />
                </p>
                <small>
                  {w && (
                    <button className="link" onClick={() => openWord(w.id)}>
                      {w.word}
                    </button>
                  )}{" "}
                  · {nextReview(s)}
                </small>
                <span className="sentence-actions">
                  <button className="icon-btn" onClick={() => window.confirm("删除这个造句？它的复习记录也会删除。") && removeSentence(s.id)} aria-label="删除造句" title="删除">
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">在单词页的「常用搭配」点「造句」，写下你自己的句子。到期时会出现在每日旅程里，挖空搭配让你填回去。</p>
      )}
    </section>
  );
}
