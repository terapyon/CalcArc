/**
 * 保存する履歴の型と、取り得る値の列挙。
 *
 * **React を import しない**(CLAUDE.md の境界)。localStorage も掴まない
 * ——掴むのは呼び出し側(後続タスクが用意する Storage)だけである。
 */

import { ANGLE_MODES, type AngleMode } from "../calc";

/**
 * 1 件の履歴。**打鍵中の値は含まない**——`=` で確定した後の 1 件だけを積む。
 */
export interface HistoryEntry {
  /** 打った通りの式。core の spell が綴る。 */
  expression: string;
  /** 表示文字列の答。 */
  answer: string;
  /** その計算のときの角度モード。**いまのモードではない。** */
  angle: AngleMode;
  /**
   * エラーで終わったか。**一覧には出さない**——効くのは「押せるか」だけ
   * である。**答の文字列で判定しない**: `"Math ERROR"` という綴りに依存
   * すると、表示の文言を変えた日に静かに壊れる。
   */
  error: boolean;
}

export const HISTORY_KEY = "calcarc.history";

/** 貯める上限。溢れたら末尾(古いもの)から捨てる。 */
export const HISTORY_LIMIT = 50;

/** localStorage と同じ形。テストから素のオブジェクトを渡せるようにする。 */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 検証に使う白リスト。**型ではなく取り得る値**で見る(settings と同じ考え方)。 */
export const ALLOWED = {
  angle: ANGLE_MODES,
} as const;
