import { Download, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { useAtlas } from "../atlas/context";
import { dailyLimit, examPlan, REVIEW_DAYS } from "../store/session";
import { isMastered } from "../store/srs";
import { dayKey, exportBackup, importBackup, resetProgress, store, useStore, type Settings } from "../store/store";
import { toast } from "../ui/Toast";
import { exportPictures, importPictures } from "../atlas/custom";
import { CustomWords } from "./CustomWords";
import { streakOf } from "./Today";

export function Me({ privateAvailable }: { privateAvailable: boolean }) {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const saveError = useStore((s) => s.saveError);
  const file = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const cards = Object.values(progress.cards);
    const days = Object.values(progress.days);
    const r = days.reduce((n, d) => n + d.r, 0);
    const c = days.reduce((n, d) => n + d.c, 0);
    const t = days.reduce((n, d) => n + d.t, 0);
    const now = Date.now();
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() + i);
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      return cards.filter((x) => (i === 0 ? x.due <= end.getTime() : x.due >= start.getTime() && x.due <= end.getTime())).length;
    });
    void now;
    return { learned: cards.length, mastered: cards.filter(isMastered).length, reviews: r, accuracy: r ? Math.round((c / r) * 100) : 0, minutes: Math.round(t / 60), forecast };
  }, [progress]);

  const set = (patch: Partial<Settings>) => store.settings(patch);
  const auto = settings.planAuto && !!settings.examDate;
  const limit = dailyLimit(atlas, progress, settings);
  const download = async () => {
    const media = await exportPictures(progress.custom.map((c) => c.id));
    const blob = new Blob([exportBackup(media)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `word-atlas-backup-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const restore = async (f: File) => {
    if (f.size > 30 * 1024 * 1024) return toast("文件太大，不像是学习备份。", "warn");
    const r = importBackup(await f.text());
    if (r.ok) await importPictures(r.media).catch(() => 0);
    toast(r.ok ? `已恢复 ${r.cards} 个词的记忆` : r.error, r.ok ? "ok" : "warn");
  };
  const maxF = Math.max(1, ...stats.forecast);

  return (
    <div className="page me">
      <header className="page-head">
        <p className="eyebrow">我的</p>
        <h1 className="display">你的星空</h1>
      </header>

      <section className="stat-strip">
        <div>
          <dt>连续学习</dt>
          <dd>
            {streakOf(progress.days)}
            <small>天</small>
          </dd>
        </div>
        <div>
          <dt>已点亮</dt>
          <dd>{stats.learned.toLocaleString()}</dd>
        </div>
        <div>
          <dt>长期记住</dt>
          <dd>{stats.mastered.toLocaleString()}</dd>
        </div>
        <div>
          <dt>首次正确率</dt>
          <dd>
            {stats.accuracy}
            <small>%</small>
          </dd>
        </div>
        <div>
          <dt>学习时长</dt>
          <dd>
            {stats.minutes}
            <small>分钟</small>
          </dd>
        </div>
      </section>

      <div className="me-grid">
        <section className="panel">
          <h3 className="eyebrow">过去 20 周</h3>
          <Heatmap days={progress.days} />
          <p className="muted">一格是一天，颜色越深，那天答得越多。「长期记住」指记忆稳定度超过 21 天。</p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">未来 7 天的复习量</h3>
          <ol className="forecast">
            {stats.forecast.map((n, i) => (
              <li key={i}>
                <span style={{ height: `${(n / maxF) * 100}%` }} />
                <b>{n}</b>
                <small>{i === 0 ? "今天" : i === 1 ? "明天" : `+${i}`}</small>
              </li>
            ))}
          </ol>
        </section>

        <CustomWords />

        <section className="panel settings">
          <h3 className="eyebrow">学习设置</h3>
          <Field label="雅思考试日期" hint="设置后可按日期估算每日新词量。日期未定可以留空。">
            <div className="exam-date">
              <input type="date" value={settings.examDate} min={dayKey()} onChange={(e) => set({ examDate: e.target.value })} aria-label="考试日期" />
              {settings.examDate && (
                <button className="link" onClick={() => set({ examDate: "", planAuto: false })}>
                  清除
                </button>
              )}
            </div>
          </Field>
          {settings.examDate && (
            <>
              <Field label="目标分数" hint="决定计划要覆盖到哪个难度的词。">
                <div className="segmented">
                  {[5.5, 6, 6.5, 7, 7.5, 8, 8.5].map((n) => (
                    <button key={n} className={settings.targetBand === n ? "is-on" : ""} onClick={() => set({ targetBand: n })}>
                      {n.toFixed(1)}
                    </button>
                  ))}
                </div>
              </Field>
              <ExamSummary />
              <Toggle label="按考试计划自动安排每日新词" on={settings.planAuto} set={(v) => set({ planAuto: v })} />
            </>
          )}
          <Field
            label="每日新词"
            hint={auto ? `已由考试计划安排：今天 ${limit} 个。关掉自动安排后可手动设置。` : "复习不设上限，算法只安排快要遗忘的词。"}
            className={auto ? "is-off" : ""}
          >
            <div className="segmented">
              {[5, 10, 15, 20, 30].map((n) => (
                <button key={n} className={settings.dailyNew === n ? "is-on" : ""} onClick={() => set({ dailyNew: n })}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="从哪个难度开始" hint="跳过已经熟悉的低级别词。">
            <div className="segmented">
              {atlas.cefr.map((l, i) => (
                <button key={l} className={settings.startLevel === i ? "is-on" : ""} onClick={() => set({ startLevel: i })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="目标记忆率" hint="越高复习越频繁。90% 是大多数人的甜点。">
            <div className="segmented">
              {[0.85, 0.9, 0.95].map((n) => (
                <button key={n} className={settings.retention === n ? "is-on" : ""} onClick={() => set({ retention: n })}>
                  {Math.round(n * 100)}%
                </button>
              ))}
            </div>
          </Field>
          <Field label="发音">
            <div className="segmented">
              <button className={settings.accent === "uk" ? "is-on" : ""} onClick={() => set({ accent: "uk" })}>
                英式
              </button>
              <button className={settings.accent === "us" ? "is-on" : ""} onClick={() => set({ accent: "us" })}>
                美式
              </button>
            </div>
          </Field>
          <Field label="外观">
            <div className="segmented">
              {(
                [
                  ["system", "跟随系统"],
                  ["light", "浅色"],
                  ["dark", "深色"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={settings.theme === k ? "is-on" : ""} onClick={() => set({ theme: k })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Toggle label="自动播放发音" on={settings.autoplay} set={(v) => set({ autoplay: v })} />
          <Toggle label="界面音效" on={settings.sfx} set={(v) => set({ sfx: v })} />
          <Toggle label="开屏动画（每天一次）" on={settings.splash} set={(v) => set({ splash: v })} />
          <Toggle label="复习时加入拼写题" on={settings.spell} set={(v) => set({ spell: v })} />
          {privateAvailable && (
            <Field label="词库" hint="私人词库只在本机开发服务器中可用，不会被打包发布。">
              <div className="segmented">
                <button className={settings.dataset === "open" ? "is-on" : ""} onClick={() => set({ dataset: "open" })}>
                  开放图鉴
                </button>
                <button className={settings.dataset === "private" ? "is-on" : ""} onClick={() => set({ dataset: "private" })}>
                  私人 8000
                </button>
              </div>
            </Field>
          )}
        </section>

        <section className="panel">
          <h3 className="eyebrow">数据</h3>
          <p className="muted">进度只存在这台设备的浏览器里：没有账号，没有服务器。换设备时，导出备份再导入即可。</p>
          {saveError && <p className="warn-text">浏览器拒绝保存（可能是隐私模式或空间已满）。请尽快导出备份。</p>}
          <div className="data-actions">
            <button className="btn btn-ghost" onClick={download}>
              <Download size={18} /> 导出备份
            </button>
            <button className="btn btn-ghost" onClick={() => file.current?.click()}>
              <Upload size={18} /> 导入备份
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0]).finally(() => (e.target.value = ""))} />
            <button
              className="btn btn-ghost btn-danger"
              onClick={() => {
                if (confirm("确定清空这个词库的全部学习记录？此操作无法撤销，建议先导出备份。")) {
                  resetProgress();
                  toast("学习记录已清空");
                }
              }}
            >
              <RotateCcw size={18} /> 清空记录
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ExamSummary() {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const plan = examPlan(atlas, progress, settings);
  if (!plan) return null;
  const range = `${atlas.cefr[settings.startLevel]}–${atlas.cefr[plan.top]}`;
  let body: React.ReactNode;
  if (plan.left < 0) body = "考试日期已过，可以更新或清除。";
  else if (plan.left === 0) body = "今天就是考试日，不再安排新词。祝你顺利！";
  else if (plan.unseen === 0) body = `目标范围（${range}）内的 ${plan.scope.toLocaleString()} 个词都学过了，接下来专心复习。`;
  else if (plan.learnDays === 0) body = `距考试 ${plan.left} 天，最后 ${REVIEW_DAYS} 天只复习，不再安排新词。`;
  else
    body = (
      <>
        目标 {settings.targetBand.toFixed(1)} 分需要 {range} 的 {plan.scope.toLocaleString()} 个词，还有 {plan.unseen.toLocaleString()} 个没学。距考试 {plan.left} 天（最后 {REVIEW_DAYS} 天只复习），每天约 <b>{plan.need}</b> 个新词。
        {plan.behind && " 超过每天 60 个的上限，建议调高学习起点或调低目标分数。"}
      </>
    );
  return (
    <p className="exam-plan">
      {body}
      <small>按 CEFR 与雅思分数的常见对应粗略估算，不代表达到目标分数。</small>
    </p>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`field ${className ?? ""}`}>
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="field toggle">
      <b>{label}</b>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Heatmap({ days }: { days: Record<string, { r: number }> }) {
  const weeks = 20;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (weeks * 7 - 1) - end.getDay());
  const cells: { k: string; v: number; future: boolean }[] = [];
  const d = new Date(start);
  for (let i = 0; i < (weeks + 1) * 7; i++) {
    const k = dayKey(d);
    cells.push({ k, v: days[k]?.r ?? 0, future: d > end });
    d.setDate(d.getDate() + 1);
  }
  const lvl = (v: number) => (v === 0 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4);
  return (
    <div className="heatmap" role="img" aria-label="学习热力图">
      {cells.map((c) => (
        <span key={c.k} className={`h${c.future ? "x" : lvl(c.v)}`} title={`${c.k} · ${c.v} 题`} />
      ))}
    </div>
  );
}
