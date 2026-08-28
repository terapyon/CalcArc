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
export type LoanForwardResult = Outcome<
  {
    monthlyPayment: string;
    totalPayment: string;
    totalInterest: string;
    finalPayment: string;
    rowsPaid: number;
  },
  LoanErrorCode
>;

/** 借入可能額逆算。 */
export type LoanPrincipalResult = Outcome<
  {
    principal: string;
    totalPayment: string;
    totalInterest: string;
    finalPayment: string;
    rowsPaid: number;
  },
  LoanErrorCode
>;

/** 期間逆算。回数だけは数値(月数は JS の number に収まる)。 */
export type LoanTermResult = Outcome<
  {
    months: number;
    totalPayment: string;
    totalInterest: string;
    finalPayment: string;
  },
  LoanErrorCode
>;

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
export type LoanBonusPrincipalResult = Outcome<
  {
    monthlyPrincipal: string;
    bonusPrincipal: string;
    totalPrincipal: string;
    totalPayment: string;
    totalInterest: string;
  },
  LoanErrorCode
>;
