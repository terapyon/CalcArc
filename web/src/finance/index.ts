/**
 * calcarc-wasm の薄いラッパー(Finance の複利)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。計算も持たない —— 型変換と初期化だけ。
 *
 * **いまは呼び出し元が無い。** F1 の spec は計算コアと検証を主戦場と定め、
 * 盤面は別 spec に送っている(設計書 §10/§14-8)。境界をここまで作って
 * おくのは、UI の spec が計算に触らず盤面だけに集中できるようにするため。
 */

import init, { compound_grow } from "../wasm/calcarc_wasm.js";
import type { CompoundResult, PeriodsPerYear } from "./types";

export type {
  CompoundErrorCode,
  CompoundResult,
  PeriodsPerYear,
} from "./types";
export { PERIODS_PER_YEAR } from "./types";

export interface FinanceCalc {
  /**
   * 複利で増やす。**一括は `deposit` を "0"、積立は `principal` を "0"**
   * にする —— 一括は積立ループの退化である(設計書 §2)。
   *
   * 金額は文字列で渡す(円は JS の number を超えうる)。積立は期末、
   * 換算は名目、丸めは各期切り捨て(numerical-policy)。
   */
  grow(
    principal: string,
    deposit: string,
    rate: string,
    periodsPerYear: PeriodsPerYear,
    periods: number,
    tax: boolean,
  ): CompoundResult;
}

let ready: Promise<FinanceCalc> | null = null;

/**
 * WASM を読み込んで FinanceCalc を返す。複数回呼んでも初期化は 1 度だけ。
 *
 * calc/ や finance/loan/ も init() を呼ぶが、生成された __wbg_init は
 * モジュール変数 wasm が設定済みなら即座に return する(二重初期化しない)。
 */
export function initFinance(): Promise<FinanceCalc> {
  ready ??= init()
    .then(
      (): FinanceCalc => ({
        grow: (principal, deposit, rate, periodsPerYear, periods, tax) =>
          compound_grow(
            principal,
            deposit,
            rate,
            periodsPerYear,
            periods,
            tax,
          ) as CompoundResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
