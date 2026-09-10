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
 *   `"manual"` はマニュアルの PDF にだけ入る写真(置かない。§3)
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
];
