/**
 * calcarc-wasm の薄いラッパー(Loan)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。計算も持たない —— 型変換と初期化だけ。
 *
 * モードごとに関数が分かれているのは境界の設計(設計書 §9): モードで引数が
 * 違うので、1 本の関数に mode 文字列を渡す形にすると、どのモードがどの入力を
 * 要るのかが型から消える。
 */

import init, {
  loan_bonus_forward,
  loan_bonus_principal,
  loan_forward,
  loan_principal,
  loan_term,
} from "../../wasm/calcarc_wasm.js";
import type {
  LoanBonusForwardResult,
  LoanBonusPrincipalResult,
  LoanForwardResult,
  LoanPrincipalResult,
  LoanTermResult,
} from "./types";

export type {
  LoanBonusForwardResult,
  LoanBonusPrincipalResult,
  LoanErrorCode,
  LoanForwardResult,
  LoanMode,
  LoanPrincipalResult,
  LoanTermResult,
} from "./types";
export { LOAN_MODES } from "./types";

export interface LoanCalc {
  /** 月額を求める。`residual` は残価(無ければ "0")。 */
  forward(
    principal: string,
    rate: string,
    months: number,
    residual: string,
  ): LoanForwardResult;
  /** 借入可能額を求める。 */
  principal(payment: string, rate: string, months: number): LoanPrincipalResult;
  /** 期間を求める。 */
  term(principal: string, rate: string, payment: string): LoanTermResult;
  /** ボーナス併用で月額を求める。 */
  bonusForward(
    principal: string,
    bonusPrincipal: string,
    rate: string,
    months: number,
  ): LoanBonusForwardResult;
  /** ボーナス併用で借入可能額を求める。 */
  bonusPrincipal(
    monthlyPayment: string,
    bonusPayment: string,
    rate: string,
    months: number,
  ): LoanBonusPrincipalResult;
}

let ready: Promise<LoanCalc> | null = null;

/**
 * WASM を読み込んで LoanCalc を返す。複数回呼んでも初期化は 1 度だけ。
 *
 * calc/ や datascale/ も init() を呼ぶが、生成された __wbg_init は
 * モジュール変数 wasm が設定済みなら即座に return する(二重初期化しない)。
 */
export function initLoan(): Promise<LoanCalc> {
  ready ??= init()
    .then(
      (): LoanCalc => ({
        forward: (principal, rate, months, residual) =>
          loan_forward(principal, rate, months, residual) as LoanForwardResult,
        principal: (payment, rate, months) =>
          loan_principal(payment, rate, months) as LoanPrincipalResult,
        term: (principal, rate, payment) =>
          loan_term(principal, rate, payment) as LoanTermResult,
        bonusForward: (principal, bonusPrincipal, rate, months) =>
          loan_bonus_forward(
            principal,
            bonusPrincipal,
            rate,
            months,
          ) as LoanBonusForwardResult,
        bonusPrincipal: (monthlyPayment, bonusPayment, rate, months) =>
          loan_bonus_principal(
            monthlyPayment,
            bonusPayment,
            rate,
            months,
          ) as LoanBonusPrincipalResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
