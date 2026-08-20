// エラー分類の共有は境界違反ではない: 設計書 §1 が「エラー分類
// (CalcError)」を各モジュールの共有項目として明示している。ここで import
// するのは型だけ(値・ロジックは持ち込まない)。
import type { CalcErrorCode } from "../calc/types";

/**
 * 単位換算のトークン。
 *
 * **Rust の `Category::ALL` / `Unit::ALL` と二重管理である。** ずれると未知の
 * トークンは黙って `SyntaxError` になり、ずれが静かに沈む——
 * `crates/calcarc-wasm/tests/token_parity.rs` が機械で突き合わせる。
 *
 * **並びも契約である。** `convert_units()` が返す順がそのまま盤面の単位面の
 * 並びになるので、この配列は `Unit::ALL` と同じ順に保つ(検査も順序込み)。
 *
 * **綴りは ASCII の小文字**(`um` `k` `degc` `degf`)。画面のラベルは別に持つ
 * ——`µ` は U+00B5 と U+03BC の 2 通りがあり、同じに見えて一致しない。
 */
export const CONVERT_CATEGORY_TOKENS = [
  "length",
  "mass",
  "temperature",
  "area",
  "volume",
  "speed",
  "data-size",
] as const;

export type ConvertCategoryToken = (typeof CONVERT_CATEGORY_TOKENS)[number];

/**
 * calcarc-core の convert::Unit に対応するトークン
 * (長さ → 質量 → 温度 → 面積 → 体積 → 速さ → データ量の順)。
 */
export const CONVERT_UNIT_TOKENS = [
  "nm",
  "um",
  "mm",
  "cm",
  "m",
  "km",
  "in",
  "ft",
  "yd",
  "mi",
  "nmi",
  "mg",
  "g",
  "kg",
  "t",
  "lb",
  "oz",
  "st",
  "k",
  "degc",
  "degf",
  "mm2",
  "cm2",
  "m2",
  "km2",
  "ha",
  "in2",
  "ft2",
  "yd2",
  "ac",
  "tsubo",
  "jo",
  "ml",
  "cl",
  "dl",
  "l",
  "m3",
  "gal_us",
  "gal_imp",
  "floz_us",
  "floz_imp",
  "pt_us",
  "pt_imp",
  "qt_us",
  "qt_imp",
  "cup_us",
  "cup_jp",
  "mps",
  "kmh",
  "mph",
  "kn",
  "bit",
  "byte",
  "kb",
  "mb",
  "gb",
  "tb",
  "pb",
  "kib",
  "mib",
  "gib",
  "tib",
  "pib",
] as const;

export type ConvertUnitToken = (typeof CONVERT_UNIT_TOKENS)[number];

/**
 * calcarc-wasm の `convert()` に対応。
 *
 * narrowing の根拠は、この経路で `CalcError` を作る 4 か所が上の 3 種しか作らないこと
 * ——`expr/parse.rs`・`expr/rational.rs`・`convert/format.rs` と、**`convert/mod.rs` 自身**
 * (カテゴリ不一致の入口検査が `SyntaxError` を作る)。`TrigPole` と `DomainError` は
 * リポジトリ全体で `error.rs` の enum 定義以外に一度も構築されていない。
 */
export interface ConvertResult {
  text: string | null;
  error: Extract<
    CalcErrorCode,
    "DivisionByZero" | "Overflow" | "SyntaxError"
  > | null;
}

/** calcarc-wasm の `convert_units()` に対応。**並びは盤面の並びである。** */
export interface ConvertUnitsResult {
  units: ConvertUnitToken[] | null;
  error: Extract<CalcErrorCode, "SyntaxError"> | null;
}
