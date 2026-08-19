import { SCALE_CATEGORIES, type ScaleCategory } from "../../route";
import { DataScalePanel } from "../DataScale/DataScalePanel";
import { LlmPanel } from "../Llm/LlmPanel";
import { TransferPanel } from "../Transfer/TransferPanel";
import styles from "./ScalePanel.module.css";

/** カテゴリの表示名。**`Record` にするのは、カテゴリが増えたときに
 * ここを埋め忘れると型が落ちるからである**(Nav の MODULES と同じ流儀)。 */
const LABELS: Record<ScaleCategory, string> = {
  "data-scale": "データ量",
  llm: "LLM のメモリ",
  transfer: "データ転送",
};

function isCategory(text: string | null): text is ScaleCategory {
  return (SCALE_CATEGORIES as readonly string[]).includes(text ?? "");
}

export function ScalePanel({ category }: { category: string | null }) {
  // route が既定へ倒しているので null は来ないが、型の上では来る。
  const current: ScaleCategory = isCategory(category) ? category : "data-scale";

  return (
    <div className={styles.scale}>
      {/* **リンクではなく select である**(spec §4.1)——縦を 1 行しか
          使わないため。hash を書き換えるだけで、画面はハッシュの購読が
          差し替える(U-0 §3)。 */}
      <select
        className={styles.category}
        aria-label="計算の種類"
        value={current}
        onChange={(e) => {
          window.location.hash = `#scale/${e.target.value}`;
        }}
      >
        {SCALE_CATEGORIES.map((id) => (
          <option key={id} value={id}>
            {LABELS[id]}
          </option>
        ))}
      </select>
      {current === "data-scale" && <DataScalePanel />}
      {current === "llm" && <LlmPanel />}
      {current === "transfer" && <TransferPanel />}
    </div>
  );
}
