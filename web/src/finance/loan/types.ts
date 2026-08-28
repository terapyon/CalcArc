// エラー分類の共有は境界違反ではない: 設計書 §9 が「エラー分類(CalcError)」を
// モジュール間の共有項目として明示している。import するのは型だけで、値も
// ロジックも持ち込まない。narrowing の根拠は loan の WASM 境界がこの 2 つしか
// 返さないこと(lib.rs の Loan*Result::error、calcarc-core の
// Overflow/SyntaxError)。
import type { CalcErrorCode, Outcome } from "../../calc/types";

export type LoanErrorCode = Extract<CalcErrorCode, "Overflow" | "SyntaxError">;

/** 何を求めるか(設計書 §8 のモードセレクタ)。 */
export const LOAN_MODES = ["payment", "principal", "term"] as const;

export type LoanMode = (typeof LOAN_MODES)[number];

/** 正算(月額を求める)。金額はすべて文字列 —— 円は JS の number を超えうる。 */
export interface LoanForwardResult {
  monthlyPayment: string | null;
  totalPayment: string | null;
  totalInterest: string | null;
  finalPayment: string | null;
  rowsPaid: number | null;
  error: LoanErrorCode | null;
}

/** 借入可能額逆算。 */
export interface LoanPrincipalResult {
  principal: string | null;
  totalPayment: string | null;
  totalInterest: string | null;
  finalPayment: string | null;
  rowsPaid: number | null;
  error: LoanErrorCode | null;
}

/** 期間逆算。回数だけは数値(月数は JS の number に収まる)。 */
export interface LoanTermResult {
  months: number | null;
  totalPayment: string | null;
  totalInterest: string | null;
  finalPayment: string | null;
  error: LoanErrorCode | null;
}

/** ボーナス併用の正算。 */
export type LoanBonusForwardResult = Outcome<
  {
    monthlyPayment: string;
    bonusPayment: string;
    bonusRows: number;
    totalPayment: string;
    totalInterest: string;
    monthlyFinalPayment: string;
    bonusFinalPayment: string;
  },
  LoanErrorCode
>;

/** ボーナス併用の借入可能額逆算。 */
export interface LoanBonusPrincipalResult {
  monthlyPrincipal: string | null;
  bonusPrincipal: string | null;
  totalPrincipal: string | null;
  totalPayment: string | null;
  totalInterest: string | null;
  error: LoanErrorCode | null;
}
