import { CONVERT_CATEGORIES, type ConvertCategory } from "../../route";
import {
  type CategoryOption,
  CategorySelect,
} from "../Category/CategorySelect";
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from "../Keypad/convert";
import styles from "./ConvertPanel.module.css";
import { UnitPanel } from "./UnitPanel";

/** カテゴリの選択肢。**日英を併記する**(U-0 §9 の【変更 2026-08-20】)。
 * 綴りの表は `Keypad/convert.ts` が持つ——ここで写すと 3 つ目の写しになる。 */
const OPTIONS: readonly CategoryOption[] = CONVERT_CATEGORIES.map((id) => ({
  value: id,
  ja: CATEGORY_LABELS[id],
  en: CATEGORY_LABELS_EN[id],
}));

function isCategory(text: string | null): text is ConvertCategory {
  return (CONVERT_CATEGORIES as readonly string[]).includes(text ?? "");
}

/**
 * 単位換算の器(ScalePanel と同じ形)。**カテゴリを選ぶだけで、計算も入力も
 * 持たない**——盤面は `UnitPanel` 1 つを 7 カテゴリで共有する。
 */
export function ConvertPanel({ category }: { category: string | null }) {
  // route が既定へ倒しているので null は来ないが、型の上では来る。
  const current: ConvertCategory = isCategory(category) ? category : "length";

  return (
    <div className={styles.convert}>
      <CategorySelect
        options={OPTIONS}
        value={current}
        onChange={(value) => {
          window.location.hash = `#convert/${value}`;
        }}
      />
      {/* **カテゴリが変わったら盤面は作り直す。** 同じ部品を使い回すので、
          key を与えないと単位も打ちかけの値も前のカテゴリのまま残る
          ——長さの `km` を選んだまま温度の面に入る、という壊れ方をする。 */}
      <UnitPanel key={current} category={current} />
    </div>
  );
}
