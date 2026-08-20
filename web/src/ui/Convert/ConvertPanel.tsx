import { CONVERT_CATEGORIES, type ConvertCategory } from "../../route";
import { CATEGORY_LABELS } from "../Keypad/convert";
import styles from "./ConvertPanel.module.css";
import { UnitPanel } from "./UnitPanel";

function isCategory(text: string | null): text is ConvertCategory {
  return (CONVERT_CATEGORIES as readonly string[]).includes(text ?? "");
}

/**
 * 単位換算の器(ScalePanel と同じ形)。**カテゴリを選ぶだけで、計算も入力も
 * 持たない**——盤面は `UnitPanel` 1 つを 3 カテゴリで共有する。
 */
export function ConvertPanel({ category }: { category: string | null }) {
  // route が既定へ倒しているので null は来ないが、型の上では来る。
  const current: ConvertCategory = isCategory(category) ? category : "length";

  return (
    <div className={styles.convert}>
      {/* **リンクではなく select である**(設計書 §4.1)——縦を 1 行しか
          使わないため。hash を書き換えるだけで、画面はハッシュの購読が
          差し替える(U-0 §3)。 */}
      <select
        className={styles.category}
        aria-label="計算の種類"
        value={current}
        onChange={(e) => {
          window.location.hash = `#convert/${e.target.value}`;
        }}
      >
        {CONVERT_CATEGORIES.map((id) => (
          <option key={id} value={id}>
            {CATEGORY_LABELS[id]}
          </option>
        ))}
      </select>
      {/* **カテゴリが変わったら盤面は作り直す。** 同じ部品を使い回すので、
          key を与えないと単位も打ちかけの値も前のカテゴリのまま残る
          ——長さの `km` を選んだまま温度の面に入る、という壊れ方をする。 */}
      <UnitPanel key={current} category={current} />
    </div>
  );
}
