// エラー分類の共有は境界違反ではない: 設計書 §1 が「エラー分類
// (CalcError)」を各モジュールの共有項目として明示している。ここで import
// するのは型だけ(値・ロジックは持ち込まない)。
import type { CalcErrorCode } from "../calc/types";

/**
 * 為替換算のトークン(U-4 設計書 §3.1)。
 *
 * **Rust の `Currency::ALL` と二重管理である。** ずれると未知のトークンは
 * 黙って `SyntaxError` になり、ずれが静かに沈む——
 * `crates/calcarc-wasm/tests/token_parity.rs` が機械で突き合わせる。
 *
 * **並びも契約である。** `currency_units()` が返す順がそのまま盤面の通貨面の
 * 並びになるので、この配列は `Currency::ALL` と同じ順に保つ(検査も順序込み)。
 * 綴りは `crates/calcarc-core/src/convert/currency.rs` の `token()` の実物から
 * 起こしてある(spec §3.1 の表を左列 → 右列に読んだ順:
 * `jpy krw vnd usd eur gbp chf cny thb sgd hkd twd aud cad inr brl`)。
 *
 * **綴りは ASCII の小文字**(ISO 4217 コードを小文字に倒したもの)。画面のラベルは別に持つ。
 */
export const CURRENCY_TOKENS = [
  "jpy",
  "krw",
  "vnd",
  "usd",
  "eur",
  "gbp",
  "chf",
  "cny",
  "thb",
  "sgd",
  "hkd",
  "twd",
  "aud",
  "cad",
  "inr",
  "brl",
] as const;

export type CurrencyToken = (typeof CURRENCY_TOKENS)[number];

/**
 * calcarc-wasm の `convert_currency()` に対応。
 *
 * `convert/types.ts` の `ConvertResult` と同じ形——`from` の通貨トークンが
 * 未知の場合も、`to` が未知の場合も、レート文字列が読めない場合も
 * すべて `SyntaxError` に落ちる(WASM 境界が `Currency::from_token` で
 * 両方を復元してから core を呼ぶ。core 自身は `from` を取らない)。
 */
export interface CurrencyConvertResult {
  text: string | null;
  error: Extract<
    CalcErrorCode,
    "DivisionByZero" | "Overflow" | "SyntaxError"
  > | null;
}

/** calcarc-wasm の `currency_units()` に対応。**並びは盤面の通貨面の並びである。** */
export interface CurrencyUnitsResult {
  units: CurrencyToken[];
}

/**
 * 為替レート 1 組(U-4 設計書 §2.1)。
 *
 * **`rates` の値は `number` ではなく `string`。** 10 進の文字列のままなら
 * 厳密な有理数にできるが、`number` を経由するとそこで誤差が入る
 * (JSON の数値をパースする時点で `f64` になるので、受け取った生の文字列を保つ)。
 *
 * `calcarc-core` へ渡すときも、この文字列をそのまま `from_rate` / `to_rate`
 * として渡す——ここで `parseFloat` して文字列に戻す、は駄目である
 * (`f64` を通したのと同じで、spec §3 が禁じていることそのものになる)。
 */
export interface CurrencyRateSet {
  /** 例 "EUR"。プロバイダに要求した基準通貨。 */
  baseCurrency: string;
  /** レートの日付。"2026-08-14" の形。 */
  date: string;
  /** 取得時刻(ISO 8601)。プロバイダの応答にはなく、取得側が打つ。 */
  fetchedAt: string;
  /** 通貨トークン(大文字の ISO コード) → 10 進文字列。 */
  rates: Record<string, string>;
  /** 出どころの識別子。 */
  provider: string;
}

/** 為替レートの取得元(U-4 設計書 §2.1)。実装は `currency/provider.ts` に置く。 */
export interface CurrencyProvider {
  getLatestRates(): Promise<CurrencyRateSet>;
}
