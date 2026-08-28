//! calcarc-core を WebAssembly から使うための adapter。
//!
//! 計算ロジックを持たない。責務は型変換と export のみ(base-spec §6.2)。
//! JavaScript 例外を投げない。計算エラーは戻り値の一部である(base-spec §27)。

// **関数名 `convert` はモジュール名 `convert` と衝突する**(境界の関数名は
// 設計書 §5 が決めている)。別名で入れて、モジュールは `convert_core::` で呼ぶ。
use calcarc_core::convert as convert_core;
use calcarc_core::convert::currency;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::llm::{self, Precision};
use calcarc_core::data_scale::transfer::{self, BandwidthUnit, DurationUnit};
use calcarc_core::data_scale::{self, DataType};
use calcarc_core::expr;
use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward, inverse, parse_yen};
use calcarc_core::finance::{compound, compound_inverse, tax};
use calcarc_core::{CalcError, CalcResult, DisplayState, EngineState, Key, reduce, render};
mod outcome;
use outcome::Outcome;

use serde::Serialize;
use wasm_bindgen::prelude::*;

/// 1 回の遷移の結果。TypeScript 側の `Step` に対応する。
#[derive(Serialize)]
struct Step {
    state: EngineState,
    display: DisplayState,
}

#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// serde_wasm_bindgen のシリアライザ生成点を一本化する。
///
/// None を undefined ではなく null にする。TypeScript 側の型は `X | null`
/// を宣言しており、undefined が来ると `!== null` が常に真になって、
/// 成功した計算がすべてエラー扱いになる。
///
/// 開発時に panic を可視化するためのフック以外では、panic は起きない想定。
/// 万一シリアライズに失敗したら null を返し、呼び出し側が初期化し直す。
/// **`pub(crate)` なのは、`outcome.rs` のテストが**本番の経路そのもの**を
/// 通すためである。** テストの中で `Serializer` を組み直すこともできるが、
/// それは「同じ設定で組んだ別のシリアライザ」を測ることになり、
/// ここの `serialize_missing_as_null(true)` が動いても気づけない。
/// crate の外へは出ない(`pub` ではない)ので、公開面は広がらない。
pub(crate) fn to_js_value<T: Serialize>(value: &T) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    value.serialize(&serializer).unwrap_or(JsValue::NULL)
}

fn to_js(step: &Step) -> JsValue {
    to_js_value(step)
}

fn step_of(state: EngineState) -> Step {
    let shown = render(&state);
    Step {
        state,
        display: shown,
    }
}

#[wasm_bindgen]
pub fn initial_state() -> JsValue {
    to_js(&step_of(EngineState::initial()))
}

/// キーを 1 つ適用する。
///
/// 渡された状態が読めない、あるいはスキーマが合わない場合は
/// 初期状態から始める。未知のキートークンは無視して現状を返す。
/// どちらの場合も例外にしない。
#[wasm_bindgen(js_name = reduce)]
pub fn reduce_key(state: JsValue, key: &str) -> JsValue {
    // スキーマ不一致の扱いは reduce() が持つ。ここで判断すると
    // 同じ方針が二か所に増えて、いずれ食い違う。
    let current = serde_wasm_bindgen::from_value::<EngineState>(state)
        .unwrap_or_else(|_| EngineState::initial());

    let Some(parsed) = Key::from_token(key) else {
        return to_js(&step_of(current));
    };

    let (next, shown) = reduce(&current, parsed);
    to_js(&Step {
        state: next,
        display: shown,
    })
}

#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Data Scale の 1 回の計算結果。TypeScript 側の `DataScaleResult` に対応する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataScaleResult {
    bytes: Option<String>,
    bytes_grouped: Option<String>,
    decimal: Option<String>,
    binary: Option<String>,
    error: Option<calcarc_core::CalcError>,
}

/// count × dimensions × dtype を計算する。純関数で、状態を持たない。
///
/// Scientific の reduce と違いキーストローク状態機械ではないので、
/// 状態の受け渡しをしない(設計書 §4)。入出力が文字列なのは、JS の
/// number が 2^53 を超えると u128 の定義域を境界で殺すため。
/// 例外は投げない。エラーは戻り値の一部である。
#[wasm_bindgen]
pub fn data_scale(count: &str, dimensions: &str, dtype: &str) -> JsValue {
    let outcome = data_scale::parse_count(count)
        .and_then(|c| Ok((c, data_scale::parse_count(dimensions)?)))
        .and_then(|(c, d)| {
            let t = DataType::from_token(dtype).ok_or(calcarc_core::CalcError::SyntaxError)?;
            data_scale::size_in_bytes(c, d, t)
        });
    let result = match outcome {
        Ok(bytes) => DataScaleResult {
            bytes: Some(bytes.to_string()),
            bytes_grouped: Some(group_digits(bytes)),
            decimal: format_decimal(bytes),
            binary: format_binary(bytes),
            error: None,
        },
        Err(e) => DataScaleResult {
            bytes: None,
            bytes_grouped: None,
            decimal: None,
            binary: None,
            error: Some(e),
        },
    };
    to_js_value(&result)
}

/// バイト数 1 つぶんの表示 4 点。**LLM は 3 組を返す**ので、DataScaleResult を
/// そのまま 3 つ並べるのではなく、組を型にした(spec §6)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ByteLines {
    bytes: String,
    bytes_grouped: String,
    decimal: Option<String>,
    binary: Option<String>,
}

impl ByteLines {
    fn of(bytes: u128) -> ByteLines {
        ByteLines {
            bytes: bytes.to_string(),
            bytes_grouped: group_digits(bytes),
            decimal: format_decimal(bytes),
            binary: format_binary(bytes),
        }
    }
}

/// LLM の 1 回の見積り。TypeScript 側の `LlmResult` に対応する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmResult {
    weight: Option<ByteLines>,
    kv: Option<ByteLines>,
    total: Option<ByteLines>,
    error: Option<calcarc_core::CalcError>,
}

/// 重み ＋ KV cache を見積もる。純関数で、状態を持たない。
///
/// 入出力が文字列なのは data_scale と同じ理由(JS の number は 2^53 を超えると
/// u128 の定義域を境界で殺す)。**例外は投げない。**
#[wasm_bindgen]
pub fn llm_memory(
    parameters: &str,
    weight_precision: &str,
    layers: &str,
    kv_heads: &str,
    head_dim: &str,
    context_length: &str,
    kv_precision: &str,
) -> JsValue {
    let outcome = (|| {
        let parameters = data_scale::parse_count(parameters)?;
        let layers = data_scale::parse_count(layers)?;
        let kv_heads = data_scale::parse_count(kv_heads)?;
        let head_dim = data_scale::parse_count(head_dim)?;
        let context_length = data_scale::parse_count(context_length)?;
        let weight = Precision::from_token(weight_precision).ok_or(CalcError::SyntaxError)?;
        let kv = Precision::from_token(kv_precision).ok_or(CalcError::SyntaxError)?;
        llm::memory(
            parameters,
            weight,
            layers,
            kv_heads,
            head_dim,
            context_length,
            kv,
        )
    })();
    let result = match outcome {
        Ok(m) => LlmResult {
            weight: Some(ByteLines::of(m.weight_bytes)),
            kv: Some(ByteLines::of(m.kv_bytes)),
            total: Some(ByteLines::of(m.total_bytes)),
            error: None,
        },
        Err(e) => LlmResult {
            weight: None,
            kv: None,
            total: None,
            error: Some(e),
        },
    };
    to_js_value(&result)
}

/// 帯域幅 × 時間 → バイト数。**戻り値の形は data_scale と同じ**(spec §6)
/// ——同じ 4 点なので、TypeScript 側も同じ型で受ける。
#[wasm_bindgen]
pub fn data_transfer(
    bandwidth: &str,
    bandwidth_unit: &str,
    duration: &str,
    duration_unit: &str,
) -> JsValue {
    let outcome = (|| {
        let bandwidth_value = data_scale::parse_count(bandwidth)?;
        let duration_value = data_scale::parse_count(duration)?;
        let unit = BandwidthUnit::from_token(bandwidth_unit).ok_or(CalcError::SyntaxError)?;
        let per = DurationUnit::from_token(duration_unit).ok_or(CalcError::SyntaxError)?;
        transfer::transferred_bytes(bandwidth_value, unit, duration_value, per)
    })();
    let result = match outcome {
        Ok(bytes) => DataScaleResult {
            bytes: Some(bytes.to_string()),
            bytes_grouped: Some(group_digits(bytes)),
            decimal: format_decimal(bytes),
            binary: format_binary(bytes),
            error: None,
        },
        Err(e) => DataScaleResult {
            bytes: None,
            bytes_grouped: None,
            decimal: None,
            binary: None,
            error: Some(e),
        },
    };
    to_js_value(&result)
}

// ---- Loan(base-spec §20〜§21、設計書 §9)-------------------------------
//
// data_scale と同じ**純関数**だが、モードで引数が違うので **1 本の文字列
// mode で分岐させず、モードごとに 1 本ずつ export する**(TypeScript 側の型が
// 素直になる。境界に分岐を持ち込むと、モードと引数の対応が型から消える)。
// 金額はすべて文字列で往復する(円は JS の number の 2^53 を超えうる)。
// 例外は投げない。エラーは戻り値の一部である。

/// 正算(月額を求める)の結果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoanForward {
    monthly_payment: String,
    total_payment: String,
    total_interest: String,
    final_payment: String,
    rows_paid: u32,
}

/// 借入可能額逆算の結果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoanPrincipal {
    principal: String,
    total_payment: String,
    total_interest: String,
    final_payment: String,
    rows_paid: u32,
}

/// 期間逆算の結果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoanTerm {
    months: u32,
    total_payment: String,
    total_interest: String,
    final_payment: String,
}

/// ボーナス併用の正算の結果。**`Outcome` の payload なので `Option` を持たない。**
///
/// **`Default` も持たない。** 全フィールドが必須になったので、
/// 「空の結果」という状態がそもそも無い——以前はそれが失敗側の
/// `..Default::default()` に使われていた。
#[derive(Serialize)]
// **外すと `monthly_payment` のまま出る**(設計書 §4)。enum 側の `rename_all` は
// tag の値しか決めない。`tests/boundary_shape.rs` が見張る。
#[serde(rename_all = "camelCase")]
struct LoanBonusForward {
    monthly_payment: String,
    bonus_payment: String,
    bonus_rows: u32,
    total_payment: String,
    total_interest: String,
    monthly_final_payment: String,
    bonus_final_payment: String,
}

/// ボーナス併用の借入可能額逆算の結果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoanBonusPrincipal {
    monthly_principal: String,
    bonus_principal: String,
    total_principal: String,
    total_payment: String,
    total_interest: String,
}

/// 元利均等の正算。`residual` は残価(既定は "0")。
#[wasm_bindgen]
pub fn loan_forward(principal: &str, rate: &str, months: u32, residual: &str) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        forward::compute(
            parse_yen(principal)?,
            &Rate::from_percent(rate)?,
            months,
            parse_yen(residual)?,
        )
    })();
    let result: Outcome<LoanForward> = outcome
        .map(|r| LoanForward {
            monthly_payment: r.monthly_payment.to_string(),
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
            final_payment: r.final_payment.to_string(),
            rows_paid: r.rows_paid,
        })
        .into();
    to_js_value(&result)
}

/// 借入可能額(月額から)。
#[wasm_bindgen]
pub fn loan_principal(payment: &str, rate: &str, months: u32) -> JsValue {
    let outcome: CalcResult<_> =
        (|| inverse::principal_for(parse_yen(payment)?, &Rate::from_percent(rate)?, months))();
    let result: Outcome<LoanPrincipal> = outcome
        .map(|r| LoanPrincipal {
            principal: r.principal.to_string(),
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
            final_payment: r.final_payment.to_string(),
            rows_paid: r.rows_paid,
        })
        .into();
    to_js_value(&result)
}

/// 期間(月額から)。
#[wasm_bindgen]
pub fn loan_term(principal: &str, rate: &str, payment: &str) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        inverse::term_for(
            parse_yen(principal)?,
            &Rate::from_percent(rate)?,
            parse_yen(payment)?,
        )
    })();
    let result: Outcome<LoanTerm> = outcome
        .map(|r| LoanTerm {
            months: r.n,
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
            final_payment: r.final_payment.to_string(),
        })
        .into();
    to_js_value(&result)
}

/// ボーナス併用の正算。
#[wasm_bindgen]
pub fn loan_bonus_forward(
    principal: &str,
    bonus_principal: &str,
    rate: &str,
    months: u32,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        bonus::compute_forward(
            parse_yen(principal)?,
            parse_yen(bonus_principal)?,
            &Rate::from_percent(rate)?,
            months,
        )
    })();
    // **`match` が消えた。** 潰していたのはここで、`CalcResult` は既に 2 択だった。
    let result: Outcome<LoanBonusForward> = outcome
        .map(|r| LoanBonusForward {
            monthly_payment: r.monthly_payment.to_string(),
            bonus_payment: r.bonus_payment.to_string(),
            bonus_rows: r.bonus_rows,
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
            monthly_final_payment: r.monthly_final_payment.to_string(),
            bonus_final_payment: r.bonus_final_payment.to_string(),
        })
        .into();
    to_js_value(&result)
}

/// ボーナス併用の借入可能額逆算。
#[wasm_bindgen]
pub fn loan_bonus_principal(
    monthly_payment: &str,
    bonus_payment: &str,
    rate: &str,
    months: u32,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        bonus::principal_for(
            parse_yen(monthly_payment)?,
            parse_yen(bonus_payment)?,
            &Rate::from_percent(rate)?,
            months,
        )
    })();
    let result: Outcome<LoanBonusPrincipal> = outcome
        .map(|r| LoanBonusPrincipal {
            monthly_principal: r.monthly_principal.to_string(),
            bonus_principal: r.bonus_principal.to_string(),
            total_principal: r.total_principal.to_string(),
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
        })
        .into();
    to_js_value(&result)
}

/// 複利・積立の結果。TypeScript 側の `CompoundResult` に対応する。
///
/// 税の 3 項目は `tax` が偽なら `null` になる。**既定はタックスフリー**
/// (NISA 前提。設計書 §6)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Compound {
    final_balance: String,
    principal_total: String,
    interest: String,
    /// **税 OFF のときは無い。潰しのための `Option` ではなく、本当に任意である**
    /// (設計書 §3)。税を引かない計算では「国税」という値が存在しない。
    national_tax: Option<String>,
    local_tax: Option<String>,
    /// 税引後の受取額。上の 2 つと同じ理由で任意である。
    net: Option<String>,
}

/// 逆算の結果。**答(`deposit` か `periods`)と、その答における全体像**。
///
/// `CompoundResult` と分けてあるのは、`compound_grow` の出力に常に `null` の
/// `deposit` / `periods` が混ざるのを避けるためである。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompoundInverse {
    /// 必要積立額。`compound_periods_for` では入力そのまま。
    deposit: String,
    /// 必要期数。`compound_deposit_for` では入力そのまま。
    periods: String,
    final_balance: String,
    principal_total: String,
    interest: String,
    /// **税 OFF のときは無い。潰しのための `Option` ではなく、本当に任意である**
    /// (設計書 §3)。`Compound` と同じ扱いにしてある。
    national_tax: Option<String>,
    local_tax: Option<String>,
    net: Option<String>,
}

/// `Solution` を境界の形に詰める。**税 OFF のとき税の 3 項目は `None`**
/// ——`compound_grow` が同じ扱いなので、TS 側の読み方を揃える。
fn inverse_result(s: compound_inverse::Solution, taxed: bool) -> CompoundInverse {
    CompoundInverse {
        deposit: s.deposit.to_string(),
        periods: s.periods.to_string(),
        final_balance: s.growth.final_balance.to_string(),
        principal_total: s.growth.principal_total.to_string(),
        interest: s.growth.interest.to_string(),
        national_tax: taxed.then(|| s.national_tax.to_string()),
        local_tax: taxed.then(|| s.local_tax.to_string()),
        net: taxed.then(|| s.net.to_string()),
    }
}

/// 複利で増やす。一括は `deposit` を "0"、積立は `principal` を "0" にする。
///
/// `periods_per_year` は 1・2・12 のみ(年・半年・月)。それ以外は
/// SyntaxError を戻り値で返す——境界は例外を投げない。
#[wasm_bindgen]
pub fn compound_grow(
    principal: &str,
    deposit: &str,
    rate: &str,
    periods_per_year: u32,
    periods: u32,
    tax: bool,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        let rate = Rate::from_annual_percent(rate, periods_per_year)?;
        let growth = compound::grow(parse_yen(principal)?, parse_yen(deposit)?, &rate, periods)?;
        let taxes = if tax {
            Some(tax::withholding(growth.interest)?)
        } else {
            None
        };
        Ok((growth, taxes))
    })();
    let result: Outcome<Compound> = outcome
        .map(|(growth, taxes)| {
            let (national, local) = match taxes {
                Some((n, l)) => (Some(n), Some(l)),
                None => (None, None),
            };
            Compound {
                final_balance: growth.final_balance.to_string(),
                principal_total: growth.principal_total.to_string(),
                interest: growth.interest.to_string(),
                national_tax: national.map(|v| v.to_string()),
                local_tax: local.map(|v| v.to_string()),
                net: match (national, local) {
                    (Some(n), Some(l)) => growth
                        .final_balance
                        .checked_sub(n)
                        .and_then(|v| v.checked_sub(l))
                        .map(|v| v.to_string()),
                    _ => None,
                },
            }
        })
        .into();
    to_js_value(&result)
}

/// 目標額から必要な積立額を求める。**目標を下回らない最小**(設計書 §1 の裁定 4)。
///
/// 税 ON のとき `target` は**手取り**と比べられる(設計書 §2)。
#[wasm_bindgen]
pub fn compound_deposit_for(
    principal: &str,
    target: &str,
    rate: &str,
    periods_per_year: u32,
    periods: u32,
    tax: bool,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        let rate = Rate::from_annual_percent(rate, periods_per_year)?;
        compound_inverse::deposit_for(
            parse_yen(principal)?,
            &rate,
            periods,
            parse_yen(target)?,
            tax,
        )
    })();
    let result: Outcome<CompoundInverse> = outcome.map(|s| inverse_result(s, tax)).into();
    to_js_value(&result)
}

/// 目標額から必要な期数を求める。**最初に届いた期**を返す。
///
/// **その次の期が目標を下回ることがある**——手取りは期数について単調でない
/// (numerical-policy)。仕様であって不具合ではない。
#[wasm_bindgen]
pub fn compound_periods_for(
    principal: &str,
    deposit: &str,
    target: &str,
    rate: &str,
    periods_per_year: u32,
    tax: bool,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        let rate = Rate::from_annual_percent(rate, periods_per_year)?;
        compound_inverse::periods_for(
            parse_yen(principal)?,
            parse_yen(deposit)?,
            &rate,
            parse_yen(target)?,
            tax,
        )
    })();
    let result: Outcome<CompoundInverse> = outcome.map(|s| inverse_result(s, tax)).into();
    to_js_value(&result)
}

/// 式の評価結果。TypeScript 側の `ExprResult` に対応する。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExprResult {
    value: Option<String>,
    error: Option<CalcError>,
}

fn to_expr_result(outcome: CalcResult<String>) -> JsValue {
    let result = match outcome {
        Ok(value) => ExprResult {
            value: Some(value),
            error: None,
        },
        Err(e) => ExprResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// 式を整数へ着地させる。`maximum` は項目の上限(10 進文字列)。
///
/// `unit_set` は単位表の名前(`yen` / `count` / `months` / `periods:<n>` /
/// `none`)。**表そのものは渡さない**——渡す形にすると呼ぶ側が scale を持ち、
/// 単位表が 2 つの言語に散る(設計書 訂正 2)。
#[wasm_bindgen]
pub fn expr_integer(text: &str, maximum: &str, unit_set: &str) -> JsValue {
    let outcome: CalcResult<String> = (|| {
        let maximum: u128 = maximum.parse().map_err(|_| CalcError::SyntaxError)?;
        let units = expr::unit_set_from_str(unit_set)?;
        Ok(expr::evaluate_to_integer(text, maximum, units)?.to_string())
    })();
    to_expr_result(outcome)
}

/// 式を年利のパーセント文字列へ着地させる。単位は取らない。
#[wasm_bindgen]
pub fn expr_percent(text: &str) -> JsValue {
    to_expr_result(expr::evaluate_to_percent(text))
}

/// 単位換算の結果。TypeScript 側の `ConvertResult` に対応する。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConvertResult {
    text: Option<String>,
    error: Option<CalcError>,
}

/// カテゴリの単位一覧。TypeScript 側の `ConvertUnitsResult` に対応する。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConvertUnitsResult {
    units: Option<Vec<String>>,
    error: Option<CalcError>,
}

/// 単位換算(U-1 設計書 §5)。**例外を投げない。**
///
/// 値は式でよい(§4.3)。単位もカテゴリも文字列トークンで受け、知らない綴りは
/// 戻り値の `SyntaxError` になる——境界で黙って無視しない。
#[wasm_bindgen]
pub fn convert(value: &str, category: &str, from: &str, to: &str) -> JsValue {
    let outcome: CalcResult<String> = (|| {
        let category =
            convert_core::Category::from_token(category).ok_or(CalcError::SyntaxError)?;
        let from = convert_core::Unit::from_token(from).ok_or(CalcError::SyntaxError)?;
        let to = convert_core::Unit::from_token(to).ok_or(CalcError::SyntaxError)?;
        convert_core::format::format_rational(convert_core::convert(value, category, from, to)?)
    })();
    let result = match outcome {
        Ok(text) => ConvertResult {
            text: Some(text),
            error: None,
        },
        Err(e) => ConvertResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// カテゴリの単位トークンを **`Category::units()` の並びのまま**返す。
///
/// **盤面はこの順に並べる**(設計書 §4.1)。並びをコアが持つのは、単位を足した
/// ときに表と画面の 2 か所を直さずに済ませるためである。
#[wasm_bindgen]
pub fn convert_units(category: &str) -> JsValue {
    let result = match convert_core::Category::from_token(category) {
        Some(category) => ConvertUnitsResult {
            units: Some(
                category
                    .units()
                    .iter()
                    .map(|unit| unit.token().to_owned())
                    .collect(),
            ),
            error: None,
        },
        None => ConvertUnitsResult {
            error: Some(CalcError::SyntaxError),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

// ---- Currency(U-4 設計書 §3) -------------------------------------------
//
// 通貨も「factor が動的な単位」で、`convert` と同じ ConvertResult の形で
// 返す(U-4 計画 Task 4)。ここが `convert` と違うのは、`calcarc-core` の
// `convert_currency` が `from` の通貨を引数に取らないこと——換算に効くのは
// `from_rate` のほうで、桁を決めるのは着地する `to` だけだからである
// (`currency.rs` のコメント参照)。
//
// **だから WASM 側が `from` トークンも `Currency::from_token` で復元し、
// 知らないトークンなら `SyntaxError` を返す。** これを怠ると、`from` に
// 何を渡しても素通りしてしまう(golden の `100 usd → xyz` 型のケースは
// `to` 側でしか検査されていないので、`from` 側の検査はここで初めて効く)。

/// 為替換算(U-4 設計書 §3)。**例外を投げない。**
///
/// 値もレートも 10 進の文字列で受ける(`f64` を経由しない)。`from` は
/// 換算の算術には使わない(桁を決めるのも基準通貨を経由する式に効くのも
/// `to` と `from_rate` だけ)が、**知らない通貨トークンを黙って通さないために
/// ここで復元する**。
#[wasm_bindgen]
pub fn convert_currency(
    value: &str,
    from: &str,
    to: &str,
    from_rate: &str,
    to_rate: &str,
) -> JsValue {
    let outcome: CalcResult<String> = (|| {
        // **結果を捨てても、この行自体が検査である。** `from` が知らない
        // トークンなら、ここで SyntaxError になって関数を抜ける。
        //
        // **検査になっているのは `?` であって束縛名ではない。** ここには
        // 「`_` に束ねて握り潰すと `from` は何を渡しても通ってしまう」と
        // 書いてあったが、**誤りだった**——`let _ = ...?;` と書いても `?` が
        // 先に効いて早期 return する。`_from` と `_` の差は drop の時期だけで、
        // 検査力は同じである。**この行から `?` を落としたときだけ素通りする。**
        let _from = currency::Currency::from_token(from).ok_or(CalcError::SyntaxError)?;
        let to = currency::Currency::from_token(to).ok_or(CalcError::SyntaxError)?;
        currency::convert_currency(value, to, from_rate, to_rate)
    })();
    let result = match outcome {
        Ok(text) => ConvertResult {
            text: Some(text),
            error: None,
        },
        Err(e) => ConvertResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// 通貨トークンの一覧。TypeScript 側の `CurrencyUnitsResult` に対応する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrencyUnitsResult {
    units: Vec<String>,
}

/// 固定 16 通貨のトークンを **`Currency::ALL` の並びのまま**返す。
///
/// **盤面はこの順に並べる**(`web/src/currency/types.ts` の `CURRENCY_TOKENS` と
/// `token_parity.rs` が順序込みで一致を見る)。エラーを返す枝が無いのは、
/// この関数が引数を取らず、16 通貨の並びが常に定義済みだからである。
#[wasm_bindgen]
pub fn currency_units() -> JsValue {
    let units = currency::Currency::ALL
        .iter()
        .map(|c| c.token().to_owned())
        .collect();
    to_js_value(&CurrencyUnitsResult { units })
}
