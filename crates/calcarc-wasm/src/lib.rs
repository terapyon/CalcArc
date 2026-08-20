//! calcarc-core を WebAssembly から使うための adapter。
//!
//! 計算ロジックを持たない。責務は型変換と export のみ(base-spec §6.2)。
//! JavaScript 例外を投げない。計算エラーは戻り値の一部である(base-spec §27)。

// **関数名 `convert` はモジュール名 `convert` と衝突する**(境界の関数名は
// 設計書 §5 が決めている)。別名で入れて、モジュールは `convert_core::` で呼ぶ。
use calcarc_core::convert as convert_core;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::llm::{self, Precision};
use calcarc_core::data_scale::transfer::{self, BandwidthUnit, DurationUnit};
use calcarc_core::data_scale::{self, DataType};
use calcarc_core::expr;
use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward, inverse, parse_yen};
use calcarc_core::finance::{compound, compound_inverse, tax};
use calcarc_core::{CalcError, CalcResult, DisplayState, EngineState, Key, reduce, render};
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
fn to_js_value<T: Serialize>(value: &T) -> JsValue {
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
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoanForwardResult {
    monthly_payment: Option<String>,
    total_payment: Option<String>,
    total_interest: Option<String>,
    final_payment: Option<String>,
    rows_paid: Option<u32>,
    error: Option<CalcError>,
}

/// 借入可能額逆算の結果。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoanPrincipalResult {
    principal: Option<String>,
    total_payment: Option<String>,
    total_interest: Option<String>,
    final_payment: Option<String>,
    rows_paid: Option<u32>,
    error: Option<CalcError>,
}

/// 期間逆算の結果。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoanTermResult {
    months: Option<u32>,
    total_payment: Option<String>,
    total_interest: Option<String>,
    final_payment: Option<String>,
    error: Option<CalcError>,
}

/// ボーナス併用の正算の結果。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoanBonusForwardResult {
    monthly_payment: Option<String>,
    bonus_payment: Option<String>,
    bonus_rows: Option<u32>,
    total_payment: Option<String>,
    total_interest: Option<String>,
    monthly_final_payment: Option<String>,
    bonus_final_payment: Option<String>,
    error: Option<CalcError>,
}

/// ボーナス併用の借入可能額逆算の結果。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoanBonusPrincipalResult {
    monthly_principal: Option<String>,
    bonus_principal: Option<String>,
    total_principal: Option<String>,
    total_payment: Option<String>,
    total_interest: Option<String>,
    error: Option<CalcError>,
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
    let result = match outcome {
        Ok(r) => LoanForwardResult {
            monthly_payment: Some(r.monthly_payment.to_string()),
            total_payment: Some(r.total_payment.to_string()),
            total_interest: Some(r.total_interest.to_string()),
            final_payment: Some(r.final_payment.to_string()),
            rows_paid: Some(r.rows_paid),
            error: None,
        },
        Err(e) => LoanForwardResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// 借入可能額(月額から)。
#[wasm_bindgen]
pub fn loan_principal(payment: &str, rate: &str, months: u32) -> JsValue {
    let outcome: CalcResult<_> =
        (|| inverse::principal_for(parse_yen(payment)?, &Rate::from_percent(rate)?, months))();
    let result = match outcome {
        Ok(r) => LoanPrincipalResult {
            principal: Some(r.principal.to_string()),
            total_payment: Some(r.total_payment.to_string()),
            total_interest: Some(r.total_interest.to_string()),
            final_payment: Some(r.final_payment.to_string()),
            rows_paid: Some(r.rows_paid),
            error: None,
        },
        Err(e) => LoanPrincipalResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
    let result = match outcome {
        Ok(r) => LoanTermResult {
            months: Some(r.n),
            total_payment: Some(r.total_payment.to_string()),
            total_interest: Some(r.total_interest.to_string()),
            final_payment: Some(r.final_payment.to_string()),
            error: None,
        },
        Err(e) => LoanTermResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
    let result = match outcome {
        Ok(r) => LoanBonusForwardResult {
            monthly_payment: Some(r.monthly_payment.to_string()),
            bonus_payment: Some(r.bonus_payment.to_string()),
            bonus_rows: Some(r.bonus_rows),
            total_payment: Some(r.total_payment.to_string()),
            total_interest: Some(r.total_interest.to_string()),
            monthly_final_payment: Some(r.monthly_final_payment.to_string()),
            bonus_final_payment: Some(r.bonus_final_payment.to_string()),
            error: None,
        },
        Err(e) => LoanBonusForwardResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
    let result = match outcome {
        Ok(r) => LoanBonusPrincipalResult {
            monthly_principal: Some(r.monthly_principal.to_string()),
            bonus_principal: Some(r.bonus_principal.to_string()),
            total_principal: Some(r.total_principal.to_string()),
            total_payment: Some(r.total_payment.to_string()),
            total_interest: Some(r.total_interest.to_string()),
            error: None,
        },
        Err(e) => LoanBonusPrincipalResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// 複利・積立の結果。TypeScript 側の `CompoundResult` に対応する。
///
/// 税の 3 項目は `tax` が偽なら `null` になる。**既定はタックスフリー**
/// (NISA 前提。設計書 §6)。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompoundResult {
    final_balance: Option<String>,
    principal_total: Option<String>,
    interest: Option<String>,
    national_tax: Option<String>,
    local_tax: Option<String>,
    net: Option<String>,
    error: Option<CalcError>,
}

/// 逆算の結果。**答(`deposit` か `periods`)と、その答における全体像**。
///
/// `CompoundResult` と分けてあるのは、`compound_grow` の出力に常に `null` の
/// `deposit` / `periods` が混ざるのを避けるためである。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompoundInverseResult {
    /// 必要積立額。`compound_periods_for` では入力そのまま。
    deposit: Option<String>,
    /// 必要期数。`compound_deposit_for` では入力そのまま。
    periods: Option<String>,
    final_balance: Option<String>,
    principal_total: Option<String>,
    interest: Option<String>,
    national_tax: Option<String>,
    local_tax: Option<String>,
    net: Option<String>,
    error: Option<CalcError>,
}

/// `Solution` を境界の形に詰める。**税 OFF のとき税の 3 項目は `None`**
/// ——`compound_grow` が同じ扱いなので、TS 側の読み方を揃える。
fn inverse_result(s: compound_inverse::Solution, taxed: bool) -> CompoundInverseResult {
    CompoundInverseResult {
        deposit: Some(s.deposit.to_string()),
        periods: Some(s.periods.to_string()),
        final_balance: Some(s.growth.final_balance.to_string()),
        principal_total: Some(s.growth.principal_total.to_string()),
        interest: Some(s.growth.interest.to_string()),
        national_tax: taxed.then(|| s.national_tax.to_string()),
        local_tax: taxed.then(|| s.local_tax.to_string()),
        net: taxed.then(|| s.net.to_string()),
        error: None,
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
    let result = match outcome {
        Ok((growth, taxes)) => {
            let (national, local) = match taxes {
                Some((n, l)) => (Some(n), Some(l)),
                None => (None, None),
            };
            CompoundResult {
                final_balance: Some(growth.final_balance.to_string()),
                principal_total: Some(growth.principal_total.to_string()),
                interest: Some(growth.interest.to_string()),
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
                error: None,
            }
        }
        Err(e) => CompoundResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
    let result = match outcome {
        Ok(s) => inverse_result(s, tax),
        Err(e) => CompoundInverseResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
    let result = match outcome {
        Ok(s) => inverse_result(s, tax),
        Err(e) => CompoundInverseResult {
            error: Some(e),
            ..Default::default()
        },
    };
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
