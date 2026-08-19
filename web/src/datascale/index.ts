/**
 * calcarc-wasm の薄いラッパー(Data Scale)。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。
 */

import init, {
  data_scale,
  data_transfer,
  llm_memory,
} from "../wasm/calcarc_wasm.js";
import type {
  BandwidthUnitToken,
  DataScaleResult,
  DataTypeToken,
  DurationUnitToken,
  LlmResult,
  PrecisionToken,
  TransferResult,
} from "./types";

export type {
  BandwidthUnitToken,
  ByteLines,
  DataScaleResult,
  DataTypeToken,
  DurationUnitToken,
  LlmResult,
  PrecisionToken,
  TransferResult,
} from "./types";
export {
  BANDWIDTH_UNIT_TOKENS,
  DATA_TYPE_TOKENS,
  DURATION_UNIT_TOKENS,
  PRECISION_TOKENS,
} from "./types";

export interface DataScaleCalc {
  compute(
    count: string,
    dimensions: string,
    dtype: DataTypeToken,
  ): DataScaleResult;
  /** 重み ＋ KV cache。**引数はすべて 10 進の数字列**(u128 の定義域)。 */
  llm(
    parameters: string,
    weightPrecision: PrecisionToken,
    layers: string,
    kvHeads: string,
    headDim: string,
    contextLength: string,
    kvPrecision: PrecisionToken,
  ): LlmResult;
  transfer(
    bandwidth: string,
    bandwidthUnit: BandwidthUnitToken,
    duration: string,
    durationUnit: DurationUnitToken,
  ): TransferResult;
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
        llm: (
          parameters,
          weightPrecision,
          layers,
          kvHeads,
          headDim,
          contextLength,
          kvPrecision,
        ) =>
          llm_memory(
            parameters,
            weightPrecision,
            layers,
            kvHeads,
            headDim,
            contextLength,
            kvPrecision,
          ) as LlmResult,
        transfer: (bandwidth, bandwidthUnit, duration, durationUnit) =>
          data_transfer(
            bandwidth,
            bandwidthUnit,
            duration,
            durationUnit,
          ) as TransferResult,
      }),
    )
    .catch((cause: unknown) => {
      // 失敗した Promise を握ったままにしない。calc/index.ts と同じ理由。
      ready = null;
      throw cause;
    });
  return ready;
}
