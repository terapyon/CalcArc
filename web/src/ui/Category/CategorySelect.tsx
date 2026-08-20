import styles from "./CategorySelect.module.css";

/**
 * カテゴリ 1 つぶんの表示。**日本語と英語を併記する**(U-0 §9 の
 * 【変更 2026-08-20】)。
 *
 * - `ja` は盤面の他の文字と同じ日本語(「変換元」「帯域幅」「層数」)
 * - `en` は Nav のタブと同じ英語(`Scientific` / `Convert` / `Scale`)
 *
 * **英語だけにしない。** `データ量` は Convert の `data-size` と Scale の
 * `data-scale` で同じ文字列になる——**併記はその衝突をほどく**
 * (`データ量 Data Size` と `データ量 Data Scale`)。
 */
export type CategoryOption = { value: string; ja: string; en: string };

/**
 * 系統の中でカテゴリを選ぶ器(U-0 §1-1)。**Scale と Convert が同じ部品を
 * 使う**——見た目が揃っている必要があり、CSS を 2 つの module に写すと
 * 片方だけが動く。
 *
 * **リンクではなく select である**(U-0 §1-1、S-0 §4.1)——縦を 1 行しか
 * 使わないため。hash を書き換えるだけで、画面はハッシュの購読が差し替える
 * (U-0 §3)。
 */
export function CategorySelect({
  options,
  value,
  onChange,
}: {
  options: readonly CategoryOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // **矢印は器の `::after` が描く。** `appearance: none` を当てると素の
    // 三角が消えるので、`currentColor` で描き直す——data URI の SVG では
    // 配色トークンに追従できない(明暗と高コントラストで 3 通りある)。
    <div className={styles.field}>
      <select
        className={styles.select}
        aria-label="計算の種類"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {`${o.ja} ${o.en}`}
          </option>
        ))}
      </select>
    </div>
  );
}
