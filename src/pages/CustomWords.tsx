import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAtlas } from "../atlas/context";
import { customId, deletePicture, parseCollocations, savePicture, usePictures, type CustomWord } from "../atlas/custom";
import { openWord } from "../lib/router";
import { pickWords } from "../store/session";
import { removeCustom, saveCustom, useStore } from "../store/store";
import { toast } from "../ui/Toast";

const POS = ["", "n.", "v.", "adj.", "adv.", "prep.", "conj.", "pron.", "phr."];

interface Draft {
  word: string;
  pos: string;
  zh: string;
  ipa: string;
  exEn: string;
  exZh: string;
  col: string;
  cefr: number;
  topic: number;
  today: boolean;
  /** New picture to store, or "remove" to drop the current one. */
  picture: File | "remove" | null;
}

const blank = (topic: number, cefr: number): Draft => ({ word: "", pos: "", zh: "", ipa: "", exEn: "", exZh: "", col: "", cefr, topic, today: true, picture: null });

const fromWord = (c: CustomWord): Draft => ({
  word: c.word,
  pos: c.pos,
  zh: c.zh,
  ipa: c.ipa,
  exEn: c.ex?.en ?? "",
  exZh: c.ex?.zh ?? "",
  col: c.col.map((x) => x.replace("｜", " ")).join("\n"),
  cefr: c.cefr,
  topic: c.topic,
  today: false,
  picture: null,
});

export function CustomWords() {
  const atlas = useAtlas();
  const custom = useStore((s) => s.progress.custom);
  const startLevel = useStore((s) => s.settings.startLevel);
  const pictures = usePictures();
  const daily = Math.max(0, atlas.topics.findIndex((t) => t[0] === "daily"));
  /** null: closed; "": adding; id: editing that word. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank(daily, startLevel));
  const [busy, setBusy] = useState(false);
  const [pendingPick, setPendingPick] = useState<string | null>(null);

  // A new word reaches the atlas on the next render; queue it for today once it is there.
  useEffect(() => {
    if (pendingPick && atlas.byId.has(pendingPick)) {
      pickWords(atlas, [pendingPick]);
      setPendingPick(null);
    }
  }, [atlas, pendingPick]);

  const preview = useMemo(() => (draft.picture instanceof File ? URL.createObjectURL(draft.picture) : null), [draft.picture]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const current = editing ? pictures.get(editing) : undefined;
  const shownPicture = preview ?? (draft.picture === "remove" ? undefined : current);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const open = (c?: CustomWord) => {
    setDraft(c ? fromWord(c) : blank(daily, startLevel));
    setEditing(c ? c.id : "");
  };

  const word = draft.word.trim();
  const clash = useMemo(() => {
    if (!word) return null;
    const lower = word.toLowerCase();
    const built = atlas.words.find((w) => w.word.toLowerCase() === lower);
    if (built) return { id: built.id, custom: false };
    const own = custom.find((c) => c.word.toLowerCase() === lower && c.id !== editing);
    return own ? { id: own.id, custom: true } : null;
  }, [word, atlas, custom, editing]);

  const save = async () => {
    if (!word || !draft.zh.trim() || clash || busy) return;
    setBusy(true);
    try {
      const prev = editing ? custom.find((c) => c.id === editing) : undefined;
      const id = prev?.id ?? customId(word, (x) => atlas.byId.has(x));
      if (draft.picture instanceof File) await savePicture(id, draft.picture);
      else if (draft.picture === "remove") await deletePicture(id);
      saveCustom({
        id,
        word,
        pos: draft.pos,
        zh: draft.zh.trim(),
        ipa: draft.ipa.trim(),
        ex: draft.exEn.trim() ? { en: draft.exEn.trim(), zh: draft.exZh.trim() } : null,
        col: parseCollocations(draft.col),
        cefr: draft.cefr,
        topic: draft.topic,
        added: prev?.added ?? Date.now(),
      });
      if (!prev && draft.today) setPendingPick(id);
      toast(prev ? `已更新 ${word}` : `已新增 ${word}${draft.today ? "，加入今天的新词" : ""}`, "ok");
      setEditing(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "warn");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CustomWord) => {
    if (!window.confirm(`删除「${c.word}」？它的学习记录也会一起删除。`)) return;
    removeCustom(c.id);
    await deletePicture(c.id);
    if (editing === c.id) setEditing(null);
  };

  return (
    <section className="panel custom-panel">
      <div className="panel-head">
        <h3 className="eyebrow">自订单词 · {custom.length}</h3>
        {editing === null && (
          <button className="btn btn-ghost" onClick={() => open()}>
            <Plus size={16} /> 新增单词
          </button>
        )}
      </div>
      <p className="muted">词库里没有的词可以自己加，发音用设备的朗读。插图可以之后再补。</p>

      {editing !== null && (
        <form
          className="custom-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="cf-word">
            <span>英文单词 *</span>
            <input value={draft.word} onChange={(e) => set({ word: e.target.value })} lang="en" autoCapitalize="none" autoComplete="off" spellCheck={false} autoFocus required maxLength={80} />
          </label>
          {clash && (
            <p className="cf-warn">
              {clash.custom ? "你已经加过这个词。" : "词库里已有这个词，直接在单词页加入待学即可。"}
              <button type="button" className="link" onClick={() => openWord(clash.id)}>
                查看
              </button>
            </p>
          )}
          <label>
            <span>词性</span>
            <select value={draft.pos} onChange={(e) => set({ pos: e.target.value })}>
              {POS.map((p) => (
                <option key={p} value={p}>
                  {p || "不填"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>音标</span>
            <input value={draft.ipa} onChange={(e) => set({ ipa: e.target.value })} placeholder="/ˈeksəmpl/（选填）" maxLength={80} />
          </label>
          <label className="cf-wide">
            <span>中文意思 *</span>
            <input value={draft.zh} onChange={(e) => set({ zh: e.target.value })} required maxLength={300} placeholder="多个意思用；分隔" />
          </label>
          <label className="cf-wide">
            <span>例句（选填）</span>
            <input value={draft.exEn} onChange={(e) => set({ exEn: e.target.value })} lang="en" placeholder="英文例句" maxLength={500} />
          </label>
          {draft.exEn.trim() && (
            <label className="cf-wide">
              <span>例句中文</span>
              <input value={draft.exZh} onChange={(e) => set({ exZh: e.target.value })} maxLength={500} />
            </label>
          )}
          <label className="cf-wide">
            <span>常用搭配（选填，每行一个，可直接从字典粘贴）</span>
            <textarea value={draft.col} onChange={(e) => set({ col: e.target.value })} rows={3} lang="en" placeholder={"give up 放弃\nmake up for 弥补"} />
          </label>
          <label>
            <span>级别</span>
            <select value={draft.cefr} onChange={(e) => set({ cefr: Number(e.target.value) })}>
              {atlas.cefr.map((l, i) => (
                <option key={l} value={i}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>话题</span>
            <select value={draft.topic} onChange={(e) => set({ topic: Number(e.target.value) })}>
              {atlas.topics.map(([key, name], i) => (
                <option key={key} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="cf-wide cf-picture">
            <span>插图（选填）</span>
            <div>
              {shownPicture ? <img src={shownPicture} alt="插图预览" /> : <span className="cf-empty">还没有插图</span>}
              <label className="btn btn-ghost">
                <ImagePlus size={16} /> {shownPicture ? "更换" : "上传"}
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && set({ picture: e.target.files[0] })} />
              </label>
              {shownPicture && (
                <button type="button" className="link" onClick={() => set({ picture: current ? "remove" : null })}>
                  移除
                </button>
              )}
            </div>
            {shownPicture && !draft.exEn.trim() && <small>有例句时，插图还会用来出「看图补句」题。</small>}
          </div>
          {editing === "" && (
            <label className="cf-wide cf-check">
              <input type="checkbox" checked={draft.today} onChange={(e) => set({ today: e.target.checked })} />
              <span>加入今天的新词（算在每日名额内）</span>
            </label>
          )}
          <div className="cf-wide cf-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={!word || !draft.zh.trim() || !!clash || busy}>
              {editing ? "保存修改" : "新增"}
            </button>
          </div>
        </form>
      )}

      {custom.length > 0 && (
        <ul className="custom-list">
          {[...custom].reverse().map((c) => (
            <li key={c.id}>
              {pictures.get(c.id) ? <img src={pictures.get(c.id)} alt="" /> : <span className="custom-noimg" />}
              <button className="custom-word" onClick={() => openWord(c.id)}>
                <b lang="en">{c.word}</b>
                <small>
                  {c.pos} {c.zh}
                </small>
              </button>
              <button className="icon-btn" onClick={() => open(c)} aria-label={`编辑 ${c.word}`} title="编辑">
                <Pencil size={16} />
              </button>
              <button className="icon-btn" onClick={() => void remove(c)} aria-label={`删除 ${c.word}`} title="删除">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
