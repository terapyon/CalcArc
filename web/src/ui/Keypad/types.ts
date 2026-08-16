import type { KeyVariant } from "../Key/Key";

/** Shift の第 2 面で差し替わる内容。 */
export interface ShiftFace<T> {
  token: T | null;
  label: string;
  ariaLabel: string;
  variant: KeyVariant;
}

export interface KeyDef<T> {
  /** 押したときに送るトークン。予約スロットは null(何も送らない)。 */
  token: T | null;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
  /** Shift 面での差し替え。無ければ面によらず同じ。 */
  shift?: ShiftFace<T>;
  /** 面を切り替えるキー自身。 */
  kind?: "shift";
}

/**
 * キーパッドの 1 区画。列数と行の高さを持つ。
 *
 * Scientific は「関数列(半高・7 列)」と「メイングリッド(正方・5 列)」の
 * 2 区画で、Finance と Data Scale も同じ部品に自分のキー集合を渡す(S1 設計書 §6)。
 *
 * **トークンの型 T は呼び出し側が決める**(L 設計書 §4)。キーパッドは
 * 「押されたら T を返す」ことしか知らない——calc の語彙に縛られると、
 * UI の都合で計算コアの語彙を増やすことになる。
 */
export interface KeypadSection<T> {
  ariaLabel: string;
  columns: number;
  /**
   * 行の高さ。square = 正方、half = 半高(設計書 §4)、double = 半高の 2 倍。
   *
   * **double は 2 行のラベルを持つ行のためにある**(0.2.0 設計書 §8)。
   * 文字の大きさは half と同じで、器だけが倍になる。
   */
  height: "square" | "half" | "double";
  keys: KeyDef<T>[];
}
