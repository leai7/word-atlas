import { ArrowRight, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAtlas } from "../atlas/context";
import { play, stopAudio } from "../lib/audio";
import { burst } from "../lib/burst";
import { splitPair } from "../lib/text";
import { cue } from "../lib/sound";
import { normalizeAnswer } from "../store/chunks";
import { advance, answerChunk, gradeFor } from "../store/session";
import { useStore, type ActiveSession, type Step } from "../store/store";

/** Your own sentence with the chunk blanked out; type the chunk back. */
export function ChunkQuiz({ step, session }: { step: Step & { kind: "chunk" }; session: ActiveSession }) {
  const atlas = useAtlas();
  const sentence = useStore((s) => s.progress.sentences.find((x) => x.id === step.id));
  const settings = useStore((s) => s.settings);
  const pending = session.pending;
  const [value, setValue] = useState("");
  const [hints, setHints] = useState(0);
  const started = useRef(performance.now());
  const input = useRef<HTMLInputElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const elapsed = () => (performance.now() - started.current) / 1000;

  useEffect(() => {
    if (pending) nextBtn.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
  }, [pending]);

  const next = () => {
    stopAudio();
    advance(elapsed());
  };

  // The sentence was deleted after this journey was planned.
  if (!sentence)
    return (
      <div className="quiz quiz-chunk">
        <p className="muted">这个造句已删除。</p>
        <button className="btn btn-primary" onClick={next}>
          继续 <ArrowRight size={18} />
        </button>
      </div>
    );

  const word = atlas.byId.get(sentence.wordId);
  const chunk = splitPair(sentence.chunk);
  const at = sentence.text.indexOf(sentence.blank);
  const before = sentence.text.slice(0, at);
  const after = sentence.text.slice(at + sentence.blank.length);
  const slots = sentence.blank.split(/\s+/).map((w) => "＿".repeat(Math.min(6, Math.max(2, Math.ceil(w.length / 2)))));

  const submit = () => {
    if (pending || !value.trim()) return;
    const correct = normalizeAnswer(value) === normalizeAnswer(sentence.blank);
    if (correct) {
      const r = input.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + r.height / 2);
    }
    if (settings.sfx) void cue(correct ? "correct" : "wrong");
    answerChunk(step, correct, gradeFor("spell", correct, elapsed() * 1000, hints > 0), value);
    void play(null, sentence.text, settings.accent);
  };

  const hint = () => {
    const target = sentence.blank;
    let k = 0;
    while (k < target.length && k < value.length && value[k].toLowerCase() === target[k].toLowerCase()) k++;
    let end = k + 1;
    while (end < target.length && !/[A-Za-z0-9]/.test(target[end - 1])) end++;
    setValue(target.slice(0, Math.min(end, target.length)));
    setHints((h) => h + 1);
    input.current?.focus();
  };

  return (
    <div className={`quiz quiz-chunk ${pending ? (pending.correct ? "is-right" : "is-wrong") : ""}`}>
      <p className="stage-label">
        <span className={`dot ${step.retry ? "dot-retry" : "dot-review"}`} />
        {step.retry ? "再见一面 · " : ""}你的造句 · 填回搭配
      </p>

      <section className="prompt chunk-prompt">
        <p className="cloze" lang="en">
          {before}
          <span className="blank">{pending ? sentence.blank : slots.join(" ")}</span>
          {after}
        </p>
        <p className="chunk-hint">
          搭配：<b>{chunk.zh || "（无中文）"}</b>
          {word && <span> · {word.word}</span>}
        </p>
        {sentence.zh && <p className="cloze-zh">{sentence.zh}</p>}
      </section>

      {!pending && (
        <form
          className="chunk-answer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            lang="en"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="写出挖空的部分"
            aria-label="写出挖空的部分"
          />
          <div className="chunk-actions">
            <button type="button" className="btn btn-ghost" onClick={hint} disabled={normalizeAnswer(value) === normalizeAnswer(sentence.blank)}>
              <Lightbulb size={16} /> 提示一个字母
            </button>
            <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
              确定
            </button>
          </div>
        </form>
      )}

      {pending && (
        <div className={`feedback ${pending.correct ? "is-right" : "is-wrong"}`} role="status">
          <div className="feedback-inner">
            <div className="feedback-text">
              <p className="feedback-verdict">{pending.correct ? "答对了" : "没关系，记住它"}</p>
              <p className="feedback-word">
                <b lang="en">{sentence.blank}</b>
              </p>
              {!pending.correct && (
                <p className="feedback-zh">
                  你写的：<span lang="en">{pending.value}</span>
                </p>
              )}
              <p className="feedback-zh">
                <span lang="en">{chunk.en}</span> {chunk.zh}
              </p>
            </div>
            <button ref={nextBtn} className={`btn btn-xl ${pending.correct ? "btn-sage" : "btn-terra"}`} onClick={next}>
              继续 <ArrowRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
