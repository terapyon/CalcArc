// エラー分類の共有は境界違反ではない: 設計書 §9 が「エラー分類(CalcError)」を
// モジュール間の共有項目として明示している。import するのは型だけ。
import type { CalcErrorCode, Outcome } from "../calc/types";

export type ExprErrorCode = Extract<
  CalcErrorCode,
  "Overflow" | "SyntaxError" | "DivisionByZero"
>;

/**
 * どの単位表で式を読むか。**名前だけを渡す**——表そのもの（scale の数値）は
 * コアが持つ（設計書 訂正 2）。ここで scale を持つと、単位表が 2 つの言語に
 * 散って二重管理になる。
 */
export type UnitSetName =
  | "yen"
  | "count"
  | "months"
  | "none"
  // `B` = 10⁹ / `M` = 10⁶(LLM のパラメータ数、コアの UnitSet::Params。
  // コア・WASM は Task 5 で足したが、TS の型はここが初めての消費者)。
  | "params"
  | `periods:${1 | 2 | 12}`;

/** 式の評価結果。値は文字列 —— 円も件数も JS の number を超えうる。 */
export type ExprResult = Outcome<{ value: string }, ExprErrorCode>;
