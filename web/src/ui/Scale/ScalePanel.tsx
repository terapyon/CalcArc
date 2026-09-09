import { SCALE_CATEGORIES, type ScaleCategory } from "../../route";
import {
  type CategoryOption,
  CategorySelect,
} from "../Category/CategorySelect";
import { DataScalePanel } from "../DataScale/DataScalePanel";
import { LlmPanel } from "../Llm/LlmPanel";
import { TransferPanel } from "../Transfer/TransferPanel";
import styles from "./ScalePanel.module.css";

/** カテゴリの表示名。**`Record` にするのは、カテゴリが増えたときに
 * ここを埋め忘れると型が落ちるからである**(Nav の MODULES と同じ流儀)。
 *
 * **日英を併記する**(U-0 §9 の【変更 2026-08-20】)。英語名は spec の
 * 呼び名をそのまま使う——`Data Scale` は U-0 §1-3 の「着地は
 * `Scale > Data Scale`」、`Data Transfer` は S-0 の題と §3.5 である。
 *
 * **`データ量` は Convert の `data-size` と同じ文字列である**(あちらは
 * 単位どうしの換算、こちらは規模の計算。U-2 §2)。**英語のほうが両者を
 * 分ける**——`データ量 Data Scale` と `データ量 Data Size`。 */
export const LABELS: Record<ScaleCategory, { ja: string; en: string }> = {
  "data-scale": { ja: "データ量", en: "Data Scale" },
  llm: { ja: "LLM のメモリ", en: "LLM Memory" },
  transfer: { ja: "データ転送", en: "Data Transfer" },
};

const OPTIONS: readonly CategoryOption[] = SCALE_CATEGORIES.map((id) => ({
  value: id,
  ...LABELS[id],
}));

function isCategory(text: string | null): text is ScaleCategory {
  return (SCALE_CATEGORIES as readonly string[]).includes(text ?? "");
}

export function ScalePanel({ category }: { category: string | null }) {
  // route が既定へ倒しているので null は来ないが、型の上では来る。
  const current: ScaleCategory = isCategory(category) ? category : "data-scale";

  return (
    <div className={styles.scale}>
      <CategorySelect
        options={OPTIONS}
        value={current}
        onChange={(value) => {
          window.location.hash = `#scale/${value}`;
        }}
      />
      {current === "data-scale" && <DataScalePanel />}
      {current === "llm" && <LlmPanel />}
      {current === "transfer" && <TransferPanel />}
    </div>
  );
}
