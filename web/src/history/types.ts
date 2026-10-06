/**
 * 保存する履歴の型と、取り得る値の列挙。
 *
 * **React を import しない**(CLAUDE.md の境界)。localStorage も掴まない
 * ——掴むのは呼び出し側(`web/src/ui/storage.ts`)だけである。
 */

import { ANGLE_MODES } from "../calc";

/**
 * 1 件の履歴。**打鍵中の値は含まない**——`=` で確定した後の 1 件だけを積む。
 */
export interface HistoryEntry {
  /** 打った通りの式。core の spell が綴る。 */
  expression: string;
  /** 表示文字列の答。 */
  answer: string;
  /**
   * **その計算を描いた角度モード。** **いまのモードではない**し、
   * **`=` の瞬間のモードでもない**（2026-10-03 に直した。出荷済みの欠陥）。
   *
   * **1 つの計算が両方のモードを使えるので、組み合わせも入る**
   * ——`30 sin`【DRG】`+ 30 sin =` は **`"Deg/Rad"`**（**使った順、重複は畳む**。
   * 利用者の裁定 2026-10-03）。**取り得る値は `ALLOWED.angle` の 4 つだけ。**
   */
  angle: EntryAngle;
  /**
   * エラーで終わったか。**一覧の行の色(`data-error`)だけに効く**——押せる
   * かどうかは `History` コンポーネントの `canRecall` prop が別に判定する
   * (`web/src/ui/History/History.tsx`)。この 2 つは別の事実であり混ぜない:
   * `canRecall` が false になる理由はエラー以外にもある(答の綴りをキー列に
   * 写せない計算)が、色が付くのは `error` が true の行だけである。
   * **答の文字列で判定しない**: `"Math ERROR"` という綴りに依存すると、
   * 表示の文言を変えた日に静かに壊れる。
   */
  error: boolean;
  /**
   * **`=` の行に付けた角度の印**（`"DEG"` / `"RAD"` / 付けなかった行は `""`）。1.2.2 から。
   * **呼び戻した行が同じ印を出すために残す**（`2026-10-06-recall-trail-design.md` §2.2 案 a）
   * ——**`angle` からは「印を付けなかった」を復元できない**（`angle` は常に入っている）。
   * **持たない件（1.2.2 より前）は、呼び戻す側が `angle` の大文字で補う。**
   */
  mark?: string;
}

export const HISTORY_KEY = "calcarc.history";

/** 貯める上限。溢れたら末尾(古いもの)から捨てる。 */
export const HISTORY_LIMIT = 50;

/** localStorage と同じ形。テストから素のオブジェクトを渡せるようにする。 */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * **1 件が持てる角度モードの綴り。** **単独の 2 つと、混在の 2 つ**
 * （**使った順**なので `"Deg/Rad"` と `"Rad/Deg"` は別物）。
 *
 * **ここを広げずに混在を書くと、その件は読み戻しで黙って消える**
 * ——`parseEntry` が白リストで落とすからである（**2026-10-03 に実測**:
 * `angle: "Deg/Rad"` を含む 2 件を書いて、読み戻せたのは 1 件）。
 * **欄に書けたことは、残ったことではない。**
 */
export const ENTRY_ANGLES = [
  ...ANGLE_MODES,
  "Deg/Rad",
  "Rad/Deg",
] as const satisfies readonly string[];

/** 1 件の `angle` 欄が取り得る綴り。 */
export type EntryAngle = (typeof ENTRY_ANGLES)[number];

/** 検証に使う白リスト。**型ではなく取り得る値**で見る(settings と同じ考え方)。 */
export const ALLOWED = {
  angle: ENTRY_ANGLES,
} as const;
