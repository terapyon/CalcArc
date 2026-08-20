/**
 * calcarc-wasm の薄いラッパー(Convert)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。**計算は 1 行も持たない**——係数も丸めも
 * calcarc-core の convert が持ち、ここは境界を渡すだけである。
 */

import type { CurrencyConvertResult } from "../currency/types";
import init, {
  convert,
  convert_currency,
  convert_units,
} from "../wasm/calcarc_wasm.js";
import type {
  ConvertCategoryToken,
  ConvertResult,
  ConvertUnitsResult,
} from "./types";

export type {
  ConvertCategoryId,
  ConvertCategoryToken,
  ConvertResult,
  ConvertUnitsResult,
  ConvertUnitToken,
} from "./types";
export {
  CONVERT_CATEGORY_IDS,
  CONVERT_CATEGORY_TOKENS,
  CONVERT_UNIT_TOKENS,
  isCurrencyCategory,
} from "./types";

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
  /**
   * 為替換算(U-4 spec §3)。**レートは 10 進の文字列のまま渡す**
   * ——`number` を経由した時点で誤差が入る(spec §2.1)。
   *
   * **`category` を取らない。** 通貨は core の `Category` ではなく、
   * 換算に効くのは `to` とレート 2 つだけである(`convert_currency` の
   * doc コメント)。`from` は「知らない通貨を黙って通さない」ための検査で
   * ある。
   *
   * **ここに置いたのは、WASM の初期化を 1 本に保つためである**
   * ——盤面は Convert の 8 番目のカテゴリとしてこれを呼ぶので、
   * `initConvert()` とは別の初期化 Promise をもう 1 本持つ理由が無い。
   * **取得(`currency/provider.ts`)と保存(`currency/cache.ts`)は
   * 別の層である**——あちらは I/O で、ここは計算の境界である。
   */
  convertCurrency(
    value: string,
    from: string,
    to: string,
    fromRate: string,
    toRate: string,
  ): CurrencyConvertResult;
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
        convertCurrency: (value, from, to, fromRate, toRate) =>
          convert_currency(
            value,
            from,
            to,
            fromRate,
            toRate,
          ) as CurrencyConvertResult,
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
