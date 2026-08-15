/**
 * calcarc-wasm の薄いラッパー（式の評価）。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を import しては
 * ならない。**計算も単位表も持たない** —— 型変換と初期化だけである
 * (設計書 訂正 2: 単位を解釈するのはコア)。
 */

import init, { expr_integer, expr_percent } from "../wasm/calcarc_wasm.js";
import type { ExprResult, UnitSetName } from "./types";

export type { ExprErrorCode, ExprResult, UnitSetName } from "./types";

export interface ExprCalc {
  /**
   * 式を整数へ着地させる。`maximum` は項目の上限（10 進文字列）。
   *
   * 打った通りの文字列をそのまま渡す（`3000万+50万` など）。**単位の展開は
   * しない** —— コアが解釈する。
   */
  integer(text: string, maximum: string, unitSet: UnitSetName): ExprResult;
  /** 式を年利のパーセント文字列へ着地させる（小数 4 桁まで）。 */
  percent(text: string): ExprResult;
}

let ready: Promise<ExprCalc> | null = null;

export function initExpr(): Promise<ExprCalc> {
  ready ??= init()
    .then(
      (): ExprCalc => ({
        integer: (text, maximum, unitSet) =>
          expr_integer(text, maximum, unitSet) as ExprResult,
        percent: (text) => expr_percent(text) as ExprResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
