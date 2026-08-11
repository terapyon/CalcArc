// エラー分類の共有は境界違反ではない: 設計書 §1 が「エラー分類
// (CalcError)」を Scientific と Data Scale の共有項目として明示している。
// ここで import するのは型だけ(値・ロジックは持ち込まない)。narrowing の
// 根拠は data_scale の WASM 境界がこの 2 つしか返さないこと
// (lib.rs の DataScaleResult::error、calcarc-core の Overflow/SyntaxError)。
import type { CalcErrorCode } from "../calc/types";

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

/** calcarc-wasm の DataScaleResult に対応。 */
export interface DataScaleResult {
  bytes: string | null;
  bytesGrouped: string | null;
  decimal: string | null;
  binary: string | null;
  error: Extract<CalcErrorCode, "Overflow" | "SyntaxError"> | null;
}
