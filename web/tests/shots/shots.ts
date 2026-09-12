/**
 * **撮影の台本**——何を撮るかの一覧(マニュアルの設計書
 * `docs/superpowers/specs/2026-09-10-manuals-design.md` §3)。
 *
 * **写真は、それを作った手順ごと残す。** 0.2.0 の README の写真は撮った
 * 手順がリポジトリに無く、ラベルが変わったあとも古いまま残った(同 §1)。
 * ここに書いた 1 行が 1 枚の写真になり、`pnpm shots` が撮り直す。
 *
 * **1 枚の形は変えない**——PDF を作る道具とマニュアルの `shot:` の番人が
 * この形に合わせている(計画 `docs/superpowers/plans/2026-09-10-manuals.md` T1)。
 *
 * - `name`: 写真の名前。README の写真なら `docs/images/<name>.png`
 * - `hash`: 開く画面(`#finance` など)
 * - `keys`: 開いたあとに順に押すボタン。**読み上げ名(`aria-label`)で書き、
 *   完全一致で探す**——表示の綴り(`÷`)ではなく、E2E が
 *   `getByRole("button", { name })` で使うのと同じ名前である
 * - `use`: `"readme"` は README に載せる写真(リポジトリに置く。§1)、
 *   `"manual"` はマニュアルの PDF にだけ入る写真(置かない。§3)。
 *   マニュアルの写真は追跡しない `web/manual-shots/` に書く(`images.ts`)
 *
 * **マニュアルの写真と `shot:` の印は、番人が両向きに突き合わせる**
 * (`tests/unit/manual-shots.test.ts`)——台本に無い `shot:` も、どの
 * マニュアルからも使われない `use: "manual"` も赤くなる。
 */
export interface Shot {
  name: string;
  hash: string;
  keys?: readonly string[];
  use: "readme" | "manual";
}

/**
 * **README の 3 枚はキーを押さない。** 撮り直す前の写真(0.2.0)を開いて
 * 確かめると、3 枚とも**開いた直後の画面**だった——Scientific は `0` と
 * `DEG`、Data Scale は件数を入力中、Finance は借入額を入力中。
 * 同じ状態をキー無しで撮る。
 */
export const SHOTS: readonly Shot[] = [
  { name: "scientific", hash: "#scientific", use: "readme" },
  { name: "data-scale", hash: "#scale/data-scale", use: "readme" },
  { name: "finance", hash: "#finance", use: "readme" },

  // **マニュアルの写真**(設計書 §8)。簡易の 2 章は 4 つのタブを 1 枚ずつ。
  // Convert・Scale・Finance は、項目に値を入れて答えが出たところを撮る
  // ——開いた直後の空の画面では、どこに答えが出るかが写らない。
  { name: "tab-scientific", hash: "#scientific", use: "manual" },
  {
    name: "tab-convert",
    hash: "#convert/length",
    keys: ["1", "0"],
    use: "manual",
  },
  {
    name: "tab-scale",
    hash: "#scale/data-scale",
    keys: ["1", "百万", "次元数を入力", "768"],
    use: "manual",
  },
  {
    name: "tab-finance",
    hash: "#finance",
    // loan.spec.ts の golden と同じ入力(3,000 万円・年 1.5%・420 か月)
    // を、期間だけ `35年` で打つ。
    keys: [
      "借入額を入力",
      "3",
      "0",
      "0",
      "0",
      "万",
      "年利を入力",
      "1",
      "小数点",
      "5",
      "返済期間を入力",
      "3",
      "5",
      "年",
    ],
    use: "manual",
  },
  // 詳細の 2 章(履歴)と 5 章(方式の面)。
  {
    name: "scientific-history",
    hash: "#scientific",
    keys: [
      "1",
      "足す",
      "2",
      "計算する",
      "3",
      "掛ける",
      "4",
      "計算する",
      "第2面に切り替え",
      "履歴",
    ],
    use: "manual",
  },
  {
    name: "finance-method",
    hash: "#finance",
    keys: ["複利で増やす", "複利の周期と積立の位置を選ぶ"],
    use: "manual",
  },
];
