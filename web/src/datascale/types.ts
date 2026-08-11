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
  error: "Overflow" | "SyntaxError" | null;
}
