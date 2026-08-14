import type { KeyToken } from "../../calc";
import type { KeyVariant } from "../Key/Key";

/** Shift の第 2 面で差し替わる内容。 */
export interface ShiftFace {
  token: KeyToken | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
}

export interface KeyDef {
  /** 押したときに送るトークン。予約スロットは null(何も送らない)。 */
  token: KeyToken | null;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
  /** Shift 面での差し替え。無ければ面によらず同じ。 */
  shift?: ShiftFace;
  /** 面を切り替えるキー自身。 */
  kind?: "shift";
}

/**
 * キーパッドの 1 区画。列数と行の高さを持つ。
 *
 * Scientific は「関数列(半高・7 列)」と「メイングリッド(正方・5 列)」の
 * 2 区画で、Loan と Data Scale も同じ部品に自分のキー集合を渡す(設計書 §6)。
 */
export interface KeypadSection {
  ariaLabel: string;
  columns: number;
  /** 行の高さ。square = 正方、half = 半高(設計書 §4)。 */
  height: "square" | "half";
  keys: KeyDef[];
}
