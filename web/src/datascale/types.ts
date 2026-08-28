// エラー分類の共有は境界違反ではない: 設計書 §1 が「エラー分類
// (CalcError)」を Scientific と Data Scale の共有項目として明示している。
// ここで import するのは型だけ(値・ロジックは持ち込まない)。narrowing の
// 根拠は data_scale の WASM 境界がこの 2 つしか返さないこと
// (calcarc-core の Overflow/SyntaxError)。**Rust 側はこれを保証していない**
// ので、crates/calcarc-wasm/tests/boundary_shape.rs が実測で見張っている。
import type { CalcErrorCode, Outcome } from "../calc/types";

/** calcarc-core の data_scale::DataType に対応するトークン。 */
export const DATA_TYPE_TOKENS = [
  "int8",
  "uint8",
  "int16",
  "float16",
  "bfloat16",
  "int32",
  "float32",
  "int64",
  "float64",
] as const;

export type DataTypeToken = (typeof DATA_TYPE_TOKENS)[number];

export type DataScaleErrorCode = Extract<
  CalcErrorCode,
  "Overflow" | "SyntaxError"
>;

/** calcarc-wasm の `Outcome<ByteLines>` に対応。成功の payload は
 * **ByteLines そのもの**である(Rust 側で専用の構造体を畳んだ)。 */
export type DataScaleResult = Outcome<ByteLines, DataScaleErrorCode>;

/** calcarc-core の data_scale::llm::Precision に対応するトークン。 */
export const PRECISION_TOKENS = [
  "fp32",
  "fp16",
  "bf16",
  "int8",
  "int4",
] as const;

export type PrecisionToken = (typeof PRECISION_TOKENS)[number];

/** calcarc-core の data_scale::transfer::BandwidthUnit に対応するトークン。 */
export const BANDWIDTH_UNIT_TOKENS = ["bps", "kbps", "mbps", "gbps"] as const;

export type BandwidthUnitToken = (typeof BANDWIDTH_UNIT_TOKENS)[number];

/** calcarc-core の data_scale::transfer::DurationUnit に対応するトークン。 */
export const DURATION_UNIT_TOKENS = [
  "second",
  "minute",
  "hour",
  "day",
] as const;

export type DurationUnitToken = (typeof DURATION_UNIT_TOKENS)[number];

/** バイト数 1 つぶんの表示 4 点(calcarc-wasm の ByteLines)。
 *
 * **`decimal` と `binary` の `| null` は残る。** 1000 bytes 未満に 10 進の
 * 単位は無く、1024 bytes 未満に 2 進の単位は無い——**失敗したから無いのでは
 * なく、本当に任意である**(設計書 §3)。UI はその行ごと隠す。 */
export interface ByteLines {
  bytes: string;
  bytesGrouped: string;
  decimal: string | null;
  binary: string | null;
}

/** calcarc-wasm の LlmResult に対応。3 組を返す(spec §6)。 */
export interface LlmResult {
  weight: ByteLines | null;
  kv: ByteLines | null;
  total: ByteLines | null;
  error: Extract<CalcErrorCode, "Overflow" | "SyntaxError"> | null;
}

/** 転送は data_scale と**同じ形**を返す(spec §6)。別名にするのは呼ぶ側の
 * 読みやすさのためで、構造は 1 つである。 */
export type TransferResult = DataScaleResult;
