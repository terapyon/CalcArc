// エラー分類の共有は境界違反ではない: 設計書 §9 が「エラー分類(CalcError)」を
// モジュール間の共有項目として明示している。import するのは型だけで、値も
// ロジックも持ち込まない。narrowing の根拠は compound の WASM 境界がこの 2 つ
// しか返さないこと(lib.rs の CompoundResult::error、calcarc-core の
// Overflow/SyntaxError)。
import type { CalcErrorCode } from "../calc/types";

export type CompoundErrorCode = Extract<
  CalcErrorCode,
  "Overflow" | "SyntaxError"
>;

/** 複利の周期。年・半年・月だけを持つ(numerical-policy)。 */
export const PERIODS_PER_YEAR = [1, 2, 12] as const;

export type PeriodsPerYear = (typeof PERIODS_PER_YEAR)[number];

/**
 * 複利・積立の結果。金額はすべて文字列 —— 円は JS の number を超えうる。
 *
 * 税の 3 項目は、税を求めなかったとき `null` になる。**既定はタックス
 * フリー**(NISA 前提。設計書 §6)。
 */
export interface CompoundResult {
  /** 満期の残高(元利合計)。 */
  finalBalance: string | null;
  /** 自分で入れた合計(元本 + 積立額×期数)。 */
  principalTotal: string | null;
  /** 運用で増えたぶん。 */
  interest: string | null;
  nationalTax: string | null;
  localTax: string | null;
  /** 税引後の受取額。 */
  net: string | null;
  error: CompoundErrorCode | null;
}
