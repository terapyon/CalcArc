/**
 * calcarc-wasm の薄いラッパー(Finance の複利)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。計算も持たない —— 型変換と初期化だけ。
 *
 * 呼び出し元は `web/src/ui/Finance/FinancePanel.tsx`(import・`initFinance`・
 * `grow` の呼び出し)。
 */

import init, {
  compound_deposit_for,
  compound_grow,
  compound_periods_for,
} from "../wasm/calcarc_wasm.js";
import type {
  CompoundInverseResult,
  CompoundResult,
  PeriodsPerYear,
} from "./types";

export type {
  CompoundErrorCode,
  CompoundInverseResult,
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

  /**
   * 目標額から必要な積立額を求める。**目標を下回らない最小**を返す。
   * 税 ON のとき `target` は手取りと比べられる。
   */
  depositFor(
    principal: string,
    target: string,
    rate: string,
    periodsPerYear: PeriodsPerYear,
    periods: number,
    tax: boolean,
  ): CompoundInverseResult;

  /**
   * 目標額から必要な期数を求める。**最初に届いた期**を返す。
   *
   * **その次の期が目標を下回ることがある**——手取りは期数について単調でない
   * (numerical-policy)。仕様であって不具合ではない。
   */
  periodsFor(
    principal: string,
    deposit: string,
    target: string,
    rate: string,
    periodsPerYear: PeriodsPerYear,
    tax: boolean,
  ): CompoundInverseResult;
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
        depositFor: (principal, target, rate, periodsPerYear, periods, tax) =>
          compound_deposit_for(
            principal,
            target,
            rate,
            periodsPerYear,
            periods,
            tax,
          ) as CompoundInverseResult,
        periodsFor: (principal, deposit, target, rate, periodsPerYear, tax) =>
          compound_periods_for(
            principal,
            deposit,
            target,
            rate,
            periodsPerYear,
            tax,
          ) as CompoundInverseResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
