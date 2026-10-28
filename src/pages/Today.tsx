import { ArrowRight, Flame, Keyboard, ListPlus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { prefetch, useAtlas, useEntry } from "../atlas/context";
import { go, openWord } from "../lib/router";
import { cue } from "../lib/sound";
import { hashSeed } from "../lib/text";
import { buildSession, dailyLimit, examPlan, masteredCount, pickWords, queuedNew, todayPlan } from "../store/session";
import { isMastered } from "../store/srs";
import { dayKey, dequeue, store, useStore } from "../store/store";
import { Galaxy } from "../galaxy/Galaxy";
import { Highlight, Pronounce } from "../ui/EntryView";
import { Illustration } from "../ui/Illustration";
import { Ring } from "../ui/Ring";

const BRAND = `${import.meta.env.BASE_URL}brand`;

function greeting(h: number) {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export function streakOf(days: Record<string, { r: number }>) {
  let n = 0;
  const d = new Date();
  if (!(days[dayKey(d)]?.r > 0)) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)]?.r > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function Today() {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const plan = useMemo(() => todayPlan(atlas, progress, settings), [atlas, progress, settings]);
  // Warm the first cards of today's journey so the session opens instantly.
  const firstIds = [...plan.due.slice(0, 4), ...plan.fresh.slice(0, 6)].join(",");
  useEffect(() => {
    const ids = firstIds.split(",").filter(Boolean);
    const t = window.setTimeout(() => void prefetch(atlas, ids), 800);
    return () => window.clearTimeout(t);
  }, [atlas, firstIds]);
  const now = new Date();
  const today = progress.days[dayKey()];
  const streak = streakOf(progress.days);
  const active = progress.session && !progress.session.finished ? progress.session : null;
  const total = plan.due.length + plan.fresh.length;
  const limit = dailyLimit(atlas, progress, settings);
  const exam = useMemo(() => examPlan(atlas, progress, settings), [atlas, progress, settings]);
  const goal = limit + Math.min(plan.due.length, 60);
  const doneToday = today?.r ?? 0;

  const start = (opts?: { reviewOnly?: boolean; extra?: number }) => {
    if (!active) {
      const s = buildSession(atlas, progress, opts?.extra ? { ...settings, planAuto: false, dailyNew: (today?.n ?? 0) + opts.extra } : settings, { reviewOnly: opts?.reviewOnly });
      if (!s.steps.length) return;
      store.progress((p) => ({ ...p, session: s }));
    }
    if (settings.sfx) void cue("start");
    go({ page: "learn" });
  };

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = dayKey(d);
    return { k, label: "日一二三四五六"[d.getDay()], v: progress.days[k]?.r ?? 0, today: i === 6 };
  });

  const learned = Object.keys(progress.cards).length;
  const mastered = masteredCount(progress);
  const teaser = (active ? active.newIds : plan.fresh).slice(0, 5).map((id) => atlas.byId.get(id)!).filter(Boolean);

  return (
    <div className="page today">
      <header className="greet">
        <p className="eyebrow">
          {now.getMonth() + 1}月{now.getDate()}日 · 星期{"日一二三四五六"[now.getDay()]}
        </p>
        <h1 className="display">{greeting(now.getHours())}，探索者。</h1>
        {exam && exam.left >= 0 && (
          <p className="exam-countdown">
            {exam.left === 0 ? "今天考雅思，祝你顺利！" : <>距雅思考试还有 <b>{exam.left}</b> 天 · 目标 {settings.targetBand.toFixed(1)} 分</>}
          </p>
        )}
      </header>

      <section className={`journey ${total === 0 && !active ? "is-clear" : ""}`}>
        <img className="journey-art" src={`${BRAND}/hero.webp`} alt="" fetchPriority="high" />
        <div className="journey-body">
          {active ? (
            <>
              <p className="eyebrow eyebrow-light">旅程进行中</p>
              <h2>
                还剩 <b>{active.steps.length - active.index}</b> 步
              </h2>
              <p className="journey-lede">进度已保存，随时接着走。</p>
            </>
          ) : total > 0 ? (
            <>
              <p className="eyebrow eyebrow-light">今日旅程</p>
              <h2>
                {plan.due.length > 0 && (
                  <>
                    复习 <b>{plan.due.length}</b>
                  </>
                )}
                {plan.due.length > 0 && plan.fresh.length > 0 && <i> · </i>}
                {plan.fresh.length > 0 && (
                  <>
                    新词 <b>{plan.fresh.length}</b>
                  </>
                )}
              </h2>
              <p className="journey-lede">
                约 {plan.minutes} 分钟。先温故，再知新。{plan.picked > 0 && `新词里有 ${plan.picked} 个是你指定的。`}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow eyebrow-light">今日已完成</p>
              <h2>今天的星，都亮了。</h2>
              <p className="journey-lede">记忆需要一点留白。想多走一段，也可以。</p>
            </>
          )}
          {teaser.length > 0 && (
            <div className="teaser" aria-label="今天将遇见的新词">
              {teaser.map((w, i) => (
                <Illustration key={w.id} src={atlas.img(w, "thumb")} word={w.word} topic={w.topic} className={`teaser-${i}`} />
              ))}
              <span>今天会遇见它们</span>
            </div>
          )}
          <div className="journey-actions">
            {active || total > 0 ? (
              <button className="btn btn-primary btn-xl" onClick={() => start()}>
                {active ? "继续旅程" : "开始今天的旅程"} <ArrowRight size={20} />
              </button>
            ) : (
              <button className="btn btn-primary btn-xl" onClick={() => start({ extra: 5 })}>
                再认识 5 个新词 <Sparkles size={18} />
              </button>
            )}
            {!active && plan.due.length > 0 && plan.fresh.length > 0 && (
              <button className="btn btn-glass" onClick={() => start({ reviewOnly: true })}>
                只复习
              </button>
            )}
            {!active && total === 0 && (
              <button className="btn btn-glass" onClick={() => go({ page: "practice" })}>
                <Keyboard size={18} /> 打字练习
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="today-grid">
        <WordOfDay />

        <section className="panel streak-panel">
          <div className="panel-head">
            <h3 className="eyebrow">这一周</h3>
            <span className={`streak ${streak ? "is-on" : ""}`}>
              <Flame size={16} /> 连续 {streak} 天
            </span>
          </div>
          <div className="streak-body">
            <Ring value={goal ? doneToday / goal : 0} size={112} stroke={8} tone="terra">
              <b>{doneToday}</b>
              <small>今日答题</small>
            </Ring>
            <ol className="week">
              {week.map((d) => (
                <li key={d.k} className={`${d.v ? "is-on" : ""} ${d.today ? "is-today" : ""}`} title={`${d.k}：${d.v} 题`}>
                  <span style={{ "--h": Math.min(1, d.v / 40) } as React.CSSProperties} />
                  <small>{d.label}</small>
                </li>
              ))}
            </ol>
          </div>
          <dl className="mini-stats">
            <div>
              <dt>已点亮</dt>
              <dd>{learned.toLocaleString()}</dd>
            </div>
            <div>
              <dt>已掌握</dt>
              <dd>{mastered.toLocaleString()}</dd>
            </div>
            <div>
              <dt>全部词汇</dt>
              <dd>{atlas.count.toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <QueuePanel />
        <LevelPath />
        <GalaxyPanel learned={learned} total={atlas.count} />
        <Topics />
      </div>
    </div>
  );
}

function GalaxyPanel({ learned, total }: { learned: number; total: number }) {
  const today = useStore((s) => s.progress.days[dayKey()]);
  const ids = useStore((s) => s.progress.cards);
  const todayIds = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Object.entries(ids)
      .filter(([, c]) => c.seen >= start.getTime())
      .map(([id]) => id);
  }, [ids]);
  void today;
  return (
    <section className="galaxy-panel" onClick={() => go({ page: "atlas", view: "galaxy" })} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go({ page: "atlas", view: "galaxy" })}>
      <Galaxy mode="mini" highlight={todayIds} />
      <div className="galaxy-panel-copy">
        <p className="eyebrow eyebrow-light">你的词汇星图</p>
        <h3>
          已点亮 <b>{learned.toLocaleString()}</b> 颗星
        </h3>
        <p>{learned ? `还有 ${(total - learned).toLocaleString()} 颗在等你。金色是今天新点亮的。` : `${total.toLocaleString()} 个词是 ${total.toLocaleString()} 颗星。学会一个，就点亮一颗。`}</p>
        <span className="btn btn-glass">
          进入星图 <ArrowRight size={18} />
        </span>
      </div>
    </section>
  );
}

function WordOfDay() {
  const atlas = useAtlas();
  const pick = useMemo(() => {
    const pool = atlas.words.filter((w) => w.cefr >= 2 && w.media & 1);
    const list = pool.length ? pool : atlas.words;
    return list[hashSeed(dayKey()) % list.length];
  }, [atlas]);
  const { entry } = useEntry(pick?.id);
  if (!pick) return null;
  return (
    <section className="panel wotd" onClick={() => openWord(pick.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openWord(pick.id)} aria-label={`今日一词：${pick.word}`}>
      <Illustration src={atlas.img(pick)} word={pick.word} topic={pick.topic} className="wotd-art" />
      <div className="wotd-body">
        <h3 className="eyebrow">今日一词</h3>
        <p className="wotd-word" lang="en">
          {pick.word}
        </p>
        {entry && (
          <div onClick={(e) => e.stopPropagation()}>
            <Pronounce entry={entry} refw={pick} />
          </div>
        )}
        <p className="wotd-zh">{pick.zh}</p>
        {entry?.ex[0] && (
          <p className="wotd-ex" lang="en">
            <Highlight text={entry.ex[0].en} word={entry.w} />
          </p>
        )}
      </div>
    </section>
  );
}

function LevelPath() {
  const atlas = useAtlas();
  const cards = useStore((s) => s.progress.cards);
  const start = useStore((s) => s.settings.startLevel);
  const levels = useMemo(() => {
    const out = atlas.cefr.map((name) => ({ name, total: 0, seen: 0, mastered: 0 }));
    for (const w of atlas.words) {
      const l = out[w.cefr];
      l.total++;
      const c = cards[w.id];
      if (c) {
        l.seen++;
        if (isMastered(c)) l.mastered++;
      }
    }
    return out;
  }, [atlas, cards]);
  const NAMES = ["入门", "基础", "进阶", "中高", "高级", "精通"];
  return (
    <section className="panel path-panel">
      <div className="panel-head">
        <h3 className="eyebrow">学习路线 · 从 A1 到 C2</h3>
        <span className="legend">
          <i className="lg-seen" /> 已学 <i className="lg-done" /> 已掌握
        </span>
      </div>
      <ol className="route">
        {levels.map((l, i) => {
          const seen = l.seen / Math.max(1, l.total);
          const done = l.mastered / Math.max(1, l.total);
          return (
            <li key={l.name} className={`${i === start ? "is-start" : ""} ${l.seen ? "is-on" : ""}`}>
              <button onClick={() => go({ page: "atlas", level: l.name })} aria-label={`${l.name} ${NAMES[i]}，已学 ${l.seen} / ${l.total}`}>
                <span className="station" style={{ "--seen": seen, "--done": done } as React.CSSProperties}>
                  <b>{l.name}</b>
                </span>
                <span className="station-name">{NAMES[i]}</span>
                <span className="station-count">
                  {l.seen}
                  <small>/{l.total}</small>
                </span>
                {i === start && <span className="station-flag">起点</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Topics() {
  const atlas = useAtlas();
  const counts = useMemo(() => {
    const c = new Array(atlas.topics.length).fill(0);
    atlas.words.forEach((w) => c[w.topic]++);
    return c;
  }, [atlas]);
  return (
    <section className="topics-panel">
      <div className="panel-head">
        <h3 className="eyebrow">按雅思话题探索</h3>
        <button className="link" onClick={() => go({ page: "atlas" })}>
          打开图鉴
        </button>
      </div>
      <ul className="topic-tiles">
        {atlas.topics.map(([key, name], i) => (
          <li key={key}>
            <button onClick={() => go({ page: "atlas", topic: key })}>
              <img src={`${BRAND}/topic-${key}.webp`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              <span>
                <b>{name}</b>
                <small>{counts[i]} 个词</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SEP = /[\n\r,，;；、\t]+/;

/** Split pasted text into candidate headwords; whole pieces are tried before single words so phrases still match. */
function parseWords(text: string) {
  const pieces = text.split(SEP).map((t) => t.trim().toLowerCase()).filter((t) => /[a-z]/.test(t));
  return pieces.map((t) => ({ whole: t, words: t.includes(" ") ? t.split(/\s+/).filter((x) => /[a-z]/.test(x)) : [] }));
}

function QueuePanel() {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const dailyNew = dailyLimit(atlas, progress, settings);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ added: number; learned: string[]; missing: string[] } | null>(null);
  const waiting = useMemo(() => queuedNew(atlas, progress), [atlas, progress]);
  const byWord = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of atlas.words) if (!m.has(w.word.toLowerCase())) m.set(w.word.toLowerCase(), w.id);
    return m;
  }, [atlas]);

  const add = () => {
    const ids: string[] = [];
    const learned: string[] = [];
    const missing: string[] = [];
    const take = (id: string) => (progress.cards[id] ? learned.push(atlas.byId.get(id)!.word) : ids.push(id));
    for (const { whole, words } of parseWords(text)) {
      const id = byWord.get(whole);
      if (id) take(id);
      else if (words.length) for (const w of words) byWord.has(w) ? take(byWord.get(w)!) : missing.push(w);
      else missing.push(whole);
    }
    const fresh = [...new Set(ids)].filter((id) => !progress.queue.includes(id));
    if (fresh.length) pickWords(atlas, fresh);
    setNote({ added: fresh.length, learned: [...new Set(learned)], missing: [...new Set(missing)] });
    if (!missing.length) setText("");
  };

  const shown = waiting.slice(0, 60);
  return (
    <section className="panel queue-panel">
      <div className="panel-head">
        <h3 className="eyebrow">我的待学清单</h3>
        {waiting.length > 0 && <span className="queue-count">{waiting.length} 个待学</span>}
      </div>
      <p className="queue-lede">
        加入的词当天就学，旅程进行中也会接在后面。今天的新词先学这里的，不够 {dailyNew} 个再由系统补上。也可以在单词页点 <ListPlus size={14} /> 加入。
      </p>
      <div className="queue-form">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="粘贴英文单词，用空格、逗号或换行分隔"
          aria-label="要加入待学清单的单词"
          lang="en"
          spellCheck={false}
          autoCapitalize="none"
        />
        <button className="btn btn-primary" onClick={add} disabled={!text.trim()}>
          加入清单
        </button>
      </div>
      {note && (
        <div className="queue-note" role="status">
          <p>{note.added ? `已加入 ${note.added} 个词。` : "没有新加入的词。"}</p>
          {note.learned.length > 0 && <p>已经学过，不再加入：{note.learned.join("、")}</p>}
          {note.missing.length > 0 && <p className="is-warn">词库里没有：{note.missing.join("、")}</p>}
        </div>
      )}
      {waiting.length > 0 && (
        <>
          <ul className="queue-list">
            {shown.map((id) => {
              const w = atlas.byId.get(id)!;
              return (
                <li key={id}>
                  <button className="queue-word" onClick={() => openWord(id)} lang="en" title={w.zh}>
                    {w.word}
                  </button>
                  <button className="queue-x" onClick={() => dequeue([id])} aria-label={`移出 ${w.word}`}>
                    <X size={14} />
                  </button>
                </li>
              );
            })}
            {waiting.length > shown.length && <li className="queue-more">还有 {waiting.length - shown.length} 个</li>}
          </ul>
          <div className="queue-foot">
            <small>学过的词会自动移出清单。</small>
            <button className="link" onClick={() => window.confirm("清空待学清单？已学过的进度不受影响。") && dequeue(progress.queue)}>
              清空清单
            </button>
          </div>
        </>
      )}
    </section>
  );
}
