/**
 * calcarc-wasm の薄いラッパー(Convert)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。**計算は 1 行も持たない**——係数も丸めも
 * calcarc-core の convert が持ち、ここは境界を渡すだけである。
 */

import init, { convert, convert_units } from "../wasm/calcarc_wasm.js";
import type {
  ConvertCategoryToken,
  ConvertResult,
  ConvertUnitsResult,
} from "./types";

export type {
  ConvertCategoryToken,
  ConvertResult,
  ConvertUnitsResult,
  ConvertUnitToken,
} from "./types";
export { CONVERT_CATEGORY_TOKENS, CONVERT_UNIT_TOKENS } from "./types";

export interface ConvertCalc {
  /**
   * 値を `from` から `to` へ換算する。
   *
   * **`value` は式でよい**(spec §4.3)——`5*12` と打って `in` を選べば
   * `60 in` である。空・不正な式は `SyntaxError` が戻り値に入る。
   */
  convert(
    value: string,
    category: ConvertCategoryToken,
    from: string,
    to: string,
  ): ConvertResult;
  /** そのカテゴリの単位トークン。**並びがそのまま盤面の単位面の並びである。** */
  units(category: ConvertCategoryToken): ConvertUnitsResult;
}

let ready: Promise<ConvertCalc> | null = null;

/**
 * WASM を読み込んで ConvertCalc を返す。複数回呼んでも初期化は 1 度だけ。
 *
 * calc/ 側とこちらの両方が init() を呼ぶが、生成された __wbg_init は
 * モジュール変数 wasm が設定済みなら即座に return する(二重初期化しない)。
 */
export function initConvert(): Promise<ConvertCalc> {
  ready ??= init()
    .then(
      (): ConvertCalc => ({
        convert: (value, category, from, to) =>
          convert(value, category, from, to) as ConvertResult,
        units: (category) => convert_units(category) as ConvertUnitsResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由
      // ——握ると初期化に一度失敗しただけで二度と回復しなくなる。
      ready = null;
      throw cause;
    });
  return ready;
}
