/**
 * calcarc-wasm の薄いラッパー(Data Scale)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。
 */

import init, { data_scale } from "../wasm/calcarc_wasm.js";
import type { DataScaleResult, DataTypeToken } from "./types";

export type { DataScaleResult, DataTypeToken } from "./types";
export { DATA_TYPE_TOKENS } from "./types";

export interface DataScaleCalc {
  compute(
    count: string,
    dimensions: string,
    dtype: DataTypeToken,
  ): DataScaleResult;
}

let ready: Promise<DataScaleCalc> | null = null;

/**
 * WASM を読み込んで DataScaleCalc を返す。複数回呼んでも初期化は 1 度だけ。
 *
 * calc/ 側とこちらの両方が init() を呼ぶが、生成された __wbg_init は
 * モジュール変数 wasm が設定済みなら即座に return する(二重初期化しない)。
 */
export function initDataScale(): Promise<DataScaleCalc> {
  ready ??= init()
    .then(
      (): DataScaleCalc => ({
        compute: (count, dimensions, dtype) =>
          data_scale(count, dimensions, dtype) as DataScaleResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
