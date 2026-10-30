import { Check, RotateCcw, Turtle, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAtlas } from "../atlas/context";
import type { Entry } from "../atlas/types";
import { play, stopAudio } from "../lib/audio";
import { cue } from "../lib/sound";
import { removePronounce, useStore } from "../store/store";
import { AmbiencePicker } from "../ui/Ambience";
import { Highlight, Pronounce } from "../ui/EntryView";
import { Illustration } from "../ui/Illustration";

/**
 * Listen and say it after the recording. The learner judges themselves: "said it right"
 * takes the word off the pronunciation list, "practise again" keeps it. Never touches reviews.
 */
export function ShadowRound({ entries, onExit, onAgain }: { entries: Entry[]; onExit: () => void; onAgain: () => void }) {
  const atlas = useAtlas();
  const settings = useStore((s) => s.settings);
  const [i, setI] = useState(0);
  const [cleared, setCleared] = useState(0);
  const e = entries[i];
  const ref = e ? atlas.byId.get(e.id) : undefined;
  const say = (rate = 1) => e && play(atlas.audio(e, settings.accent), e.w, settings.accent, rate);

  useEffect(() => {
    if (e) void say();
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopAudio(), []);

  const next = (ok: boolean) => {
    stopAudio();
    if (ok) {
      removePronounce(e.id);
      setCleared((n) => n + 1);
      if (settings.sfx) void cue("correct");
    }
    setI(i + 1);
  };

  if (!e)
    return (
      <div className="page practice">
        <section className="panel typing-done">
          <p className="eyebrow">本轮完成</p>
          <h1 className="display">
            {cleared} <small>/ {entries.length}</small>
          </h1>
          <p className="lede">{cleared ? `${cleared} 个词念对了，已移出发音练习。` : "都留在发音练习里，下次再练。"}</p>
          <div className="summary-actions">
            <button className="btn btn-ghost" onClick={onExit}>
              返回
            </button>
            <button className="btn btn-primary btn-xl" onClick={onAgain} autoFocus>
              <RotateCcw size={18} /> 再来一轮
            </button>
          </div>
        </section>
      </div>
    );

  const ex = e.ex[0];
  return (
    <div className="page practice typing">
      <header className="typing-top">
        <button className="btn btn-ghost" onClick={onExit}>
          结束
        </button>
        <AmbiencePicker />
        <div className="learn-progress">
          <span style={{ width: `${(i / entries.length) * 100}%` }} />
        </div>
        <span className="typing-meter">
          {i + 1} / {entries.length}
        </span>
      </header>
      <section className="shadow-stage">
        <Illustration src={atlas.img(e)} word={e.w} topic={ref?.topic ?? 0} eager />
        <p className="shadow-word" lang="en">
          {e.w}
        </p>
        <Pronounce entry={e} refw={ref ?? e} />
        <p>
          <span className="pos">{e.senses[0]?.pos}</span> {e.senses[0]?.zh}
        </p>
        <div className="shadow-tools">
          <button className="btn btn-ghost" onClick={() => say()}>
            <Volume2 size={16} /> 再听一遍
          </button>
          <button className="btn btn-ghost" onClick={() => say(0.7)}>
            <Turtle size={16} /> 慢速
          </button>
          {ex && (
            <button className="btn btn-ghost" onClick={() => play(atlas.audio(e, "ex"), ex.en, settings.accent)}>
              <Volume2 size={16} /> 听例句
            </button>
          )}
        </div>
        {ex && (
          <p className="shadow-ex" lang="en">
            <Highlight text={ex.en} word={e.w} />
          </p>
        )}
        <p className="muted">听完跟着念几遍，再自己判断念得对不对。</p>
        <div className="shadow-actions">
          <button className="btn btn-ghost btn-xl" onClick={() => next(false)}>
            <RotateCcw size={18} /> 再练
          </button>
          <button className="btn btn-primary btn-xl" onClick={() => next(true)}>
            <Check size={18} /> 念对了
          </button>
        </div>
      </section>
    </div>
  );
}
