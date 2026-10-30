import { Mic } from "lucide-react";
import { markShakyPronunciation } from "../store/session";

/** Knew the word but not how to say it: shorter interval and a spot on the pronunciation list. */
export function ShakyButton({ wordId, shaky, correct }: { wordId: string; shaky: boolean; correct: boolean }) {
  return (
    <button className="link feedback-shaky" onClick={() => markShakyPronunciation(wordId)} disabled={shaky} title={correct ? "这题改记为「困难」，提早复习，并加入发音练习" : "加入发音练习"}>
      <Mic size={14} /> {shaky ? "已加入发音练习" : "发音不熟"}
    </button>
  );
}
