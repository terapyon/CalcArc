//! ブラウザ上で WASM 境界が実際に動くことを確認する(Layer 5)。
//!
//! Run: wasm-pack test --headless --chrome crates/calcarc-wasm

#![cfg(target_arch = "wasm32")]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(value: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(value, &JsValue::from_str(key))
        .unwrap_or_else(|_| panic!("missing field {key}"))
}

fn main_text(step: &JsValue) -> String {
    get(&get(step, "display"), "main")
        .as_string()
        .expect("main should be a string")
}

fn press(step: JsValue, keys: &[&str]) -> JsValue {
    let mut current = step;
    for key in keys {
        current = calcarc_wasm::reduce_key(get(&current, "state"), key);
    }
    current
}

#[wasm_bindgen_test]
fn starts_at_zero() {
    assert_eq!(main_text(&calcarc_wasm::initial_state()), "0");
}

#[wasm_bindgen_test]
fn the_headline_case_crosses_the_boundary() {
    let step = press(
        calcarc_wasm::initial_state(),
        &["3", "add", "j", "4", "eq", "polar_toggle"],
    );
    assert_eq!(main_text(&step), "5 ∠ 53.13010235");
}

#[wasm_bindgen_test]
fn an_unknown_key_is_ignored() {
    let step = press(calcarc_wasm::initial_state(), &["3", "nonsense"]);
    assert_eq!(main_text(&step), "3");
}

#[wasm_bindgen_test]
fn an_unusable_state_falls_back_to_the_initial_one() {
    // localStorage の破損などを模す。例外にはせず初期状態から再開する。
    let step = calcarc_wasm::reduce_key(JsValue::from_str("garbage"), "3");
    assert_eq!(main_text(&step), "3");
}

#[wasm_bindgen_test]
fn a_successful_display_reports_error_as_null_not_undefined() {
    // TypeScript 側の型は `error: CalcErrorCode | null` を宣言している。
    // serde の既定は None を undefined にシリアライズするため、
    // `display.error !== null` は成功時にも真になってしまう。
    let step = calcarc_wasm::initial_state();
    let error = get(&get(&step, "display"), "error");
    assert!(error.is_null(), "expected null, got {error:?}");
}

#[wasm_bindgen_test]
fn errors_are_returned_not_thrown() {
    let step = press(calcarc_wasm::initial_state(), &["1", "div", "0", "eq"]);
    assert_eq!(main_text(&step), "Math ERROR");
    assert_eq!(
        get(&get(&step, "display"), "error").as_string().as_deref(),
        Some("DivisionByZero")
    );
}

#[wasm_bindgen_test]
fn data_scale_crosses_the_boundary() {
    // 基準例。値はすべて文字列で往復する。
    let result = calcarc_wasm::data_scale("100000000", "768", "float32");
    let bytes = get(&result, "bytes");
    assert_eq!(bytes.as_string().as_deref(), Some("307200000000"));
    let decimal = get(&result, "decimal");
    assert_eq!(decimal.as_string().as_deref(), Some("307.2 GB"));
    // group_digits の消費経路。桁区切りが往復することを確かめる。
    let bytes_grouped = get(&result, "bytesGrouped");
    assert_eq!(
        bytes_grouped.as_string().as_deref(),
        Some("307,200,000,000")
    );
}

#[wasm_bindgen_test]
fn data_scale_survives_values_beyond_js_numbers() {
    // 2^127 - 1。JS の number では表現できない桁が文字列で往復する。
    let result = calcarc_wasm::data_scale("170141183460469231731687303715884105727", "1", "uint8");
    let bytes = get(&result, "bytes");
    assert_eq!(
        bytes.as_string().as_deref(),
        Some("170141183460469231731687303715884105727")
    );
}

#[wasm_bindgen_test]
fn data_scale_errors_are_returned_not_thrown() {
    let result = calcarc_wasm::data_scale("170141183460469231731687303715884105728", "2", "uint8");
    let error = get(&result, "error");
    assert_eq!(error.as_string().as_deref(), Some("Overflow"));
    let bytes = get(&result, "bytes");
    assert!(bytes.is_null(), "error results carry null, not undefined");
}

#[wasm_bindgen_test]
fn data_scale_sub_unit_success_carries_null_lines() {
    // 999 bytes: 成功だが最小単位未満なので単位行は無い。
    // undefined ではなく null で渡ること(TypeScript 側は `X | null` を宣言
    // しており、undefined だと null チェックがすり抜ける)。
    let result = calcarc_wasm::data_scale("999", "1", "uint8");
    let bytes = get(&result, "bytes");
    assert_eq!(bytes.as_string().as_deref(), Some("999"));
    let decimal = get(&result, "decimal");
    assert!(decimal.is_null(), "decimal must be null, not undefined");
    let binary = get(&result, "binary");
    assert!(binary.is_null(), "binary must be null, not undefined");
    let error = get(&result, "error");
    assert!(error.is_null());
}

#[wasm_bindgen_test]
fn loan_forward_crosses_the_boundary() {
    // 住宅基準例。golden(finance.json)と同じ値が境界を越えて出る。
    let result = calcarc_wasm::loan_forward("30000000", "1.5", 420, "0");
    assert_eq!(
        get(&result, "monthlyPayment").as_string().as_deref(),
        Some("91855")
    );
    assert_eq!(
        get(&result, "finalPayment").as_string().as_deref(),
        Some("91762")
    );
    assert_eq!(get(&result, "rowsPaid").as_f64(), Some(420.0));
    assert!(
        get(&result, "error").is_null(),
        "success carries null error"
    );
}

#[wasm_bindgen_test]
fn loan_term_and_principal_cross_the_boundary() {
    // 借入可能額 → その元本で期間逆算 → 同じ回数に戻る(境界越しの往復)。
    let borrowed = calcarc_wasm::loan_principal("85000", "1.5", 420);
    let principal = get(&borrowed, "principal")
        .as_string()
        .expect("principal is a string");
    assert_eq!(principal, "27761211");
    let term = calcarc_wasm::loan_term(&principal, "1.5", "85000");
    assert_eq!(get(&term, "months").as_f64(), Some(420.0));
}

#[wasm_bindgen_test]
fn loan_bonus_crosses_the_boundary() {
    let result = calcarc_wasm::loan_bonus_forward("30000000", "6000000", "1.5", 420);
    assert_eq!(get(&result, "bonusRows").as_f64(), Some(70.0));
    assert!(get(&result, "bonusPayment").as_string().is_some());
    let inverted = calcarc_wasm::loan_bonus_principal("80000", "100000", "1.5", 420);
    assert!(get(&inverted, "totalPrincipal").as_string().is_some());
    assert!(get(&inverted, "error").is_null());
}

#[wasm_bindgen_test]
fn loan_survives_values_beyond_js_numbers() {
    // u64 域(2^64 − 1)は JS の number では表せない。文字列で往復する。
    let result = calcarc_wasm::loan_forward("18446744073709551615", "0", 600, "0");
    assert_eq!(
        get(&result, "monthlyPayment").as_string().as_deref(),
        Some("30744573456182586")
    );
    assert_eq!(
        get(&result, "totalPayment").as_string().as_deref(),
        Some("18446744073709551615")
    );
}

#[wasm_bindgen_test]
fn loan_errors_are_returned_not_thrown() {
    // 残価 ≥ 元本 は SyntaxError。金額の欄は undefined ではなく null。
    let result = calcarc_wasm::loan_forward("1000000", "1.5", 12, "1000000");
    assert_eq!(
        get(&result, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
    let monthly = get(&result, "monthlyPayment");
    assert!(monthly.is_null(), "error results carry null, not undefined");
    assert!(get(&result, "rowsPaid").is_null());
    // 1 回払いで P + 利息があふれる入力は Overflow。
    let overflowed = calcarc_wasm::loan_forward("18446744073709551615", "1.5", 1, "0");
    assert_eq!(
        get(&overflowed, "error").as_string().as_deref(),
        Some("Overflow")
    );
    // 金利文字列が読めないのも戻り値のエラー。
    let bad_rate = calcarc_wasm::loan_term("1000000", "abc", "50000");
    assert_eq!(
        get(&bad_rate, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn the_new_entry_keys_cross_the_boundary() {
    // 1.5 Exp 3 = 1500。指数は境界を越えても指数のまま届く。
    // 3 桁カンマは既定の表示である(numerical-policy)。1500 は "1,500" と出る。
    let step = press(
        calcarc_wasm::initial_state(),
        &["1", "dot", "5", "exp", "3", "eq"],
    );
    assert_eq!(main_text(&step), "1,500");
    // 000 は 1 打鍵で 3 文字。eq 前なので入力エコーのまま
    // (buffer.text() は format_real を通らない。カンマは付かない)。
    let step = press(calcarc_wasm::initial_state(), &["1", "zeros3"]);
    assert_eq!(main_text(&step), "1000");
    // 後置 j とエコー行も境界を越える。
    let step = press(calcarc_wasm::initial_state(), &["3", "j", "add"]);
    assert_eq!(main_text(&step), "j3");
    assert_eq!(
        get(&get(&step, "display"), "echo").as_string().as_deref(),
        Some("j3 +")
    );
}

#[wasm_bindgen_test]
fn compound_crosses_the_boundary() {
    // 種①: 100 万・年 1%・5 年・半年複利。golden(finance.json)と同じ
    // 1,051,136 が境界を越えて出る——丸めない方式なら 1,051,140 になる。
    let result = calcarc_wasm::compound_grow("1000000", "0", "1", 2, 10, false);
    assert_eq!(
        get(&result, "finalBalance").as_string().as_deref(),
        Some("1051136")
    );
    assert_eq!(
        get(&result, "interest").as_string().as_deref(),
        Some("51136")
    );
    // 税を求めなければ 3 項目は null(undefined ではない)。
    assert!(get(&result, "nationalTax").is_null());
    assert!(get(&result, "localTax").is_null());
    assert!(get(&result, "net").is_null());
    assert!(get(&result, "error").is_null());
}

#[wasm_bindgen_test]
fn compound_tax_crosses_the_boundary() {
    // 国税と地方税は別々に切り捨てる。合算 20.315% なら 7,832 になる。
    let result = calcarc_wasm::compound_grow("1000000", "0", "1", 2, 10, true);
    assert_eq!(
        get(&result, "nationalTax").as_string().as_deref(),
        Some("7831")
    );
    assert_eq!(
        get(&result, "localTax").as_string().as_deref(),
        Some("2556")
    );
    assert_eq!(get(&result, "net").as_string().as_deref(), Some("1040749"));
}

#[wasm_bindgen_test]
fn compound_survives_values_beyond_js_numbers() {
    // 積立 20 年ぶん。2^53 は超えないが、金額が文字列で往復することを
    // 固定する(ローン側と同じ流儀)。
    let result = calcarc_wasm::compound_grow("0", "30000", "3", 12, 240, false);
    assert_eq!(
        get(&result, "finalBalance").as_string().as_deref(),
        Some("9848906")
    );
    assert_eq!(
        get(&result, "principalTotal").as_string().as_deref(),
        Some("7200000")
    );
}

#[wasm_bindgen_test]
fn compound_errors_are_returned_not_thrown() {
    // 単調増加なので u64 を超えうる——ローンには無かった経路。
    let overflowed = calcarc_wasm::compound_grow("18446744073709551615", "0", "100", 12, 12, false);
    assert_eq!(
        get(&overflowed, "error").as_string().as_deref(),
        Some("Overflow")
    );
    assert!(get(&overflowed, "finalBalance").is_null());
    // 四半期複利は持たない。境界も例外を投げず SyntaxError を返す。
    let bad_period = calcarc_wasm::compound_grow("1000000", "0", "1", 4, 10, false);
    assert_eq!(
        get(&bad_period, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn compound_deposit_for_crosses_the_boundary() {
    // 必須ケース #1(設計書 §7・golden と同じ)。目標を下回らない最小の積立額。
    let result = calcarc_wasm::compound_deposit_for("0", "10000000", "3", 12, 240, false);
    assert_eq!(
        get(&result, "deposit").as_string().as_deref(),
        Some("30461")
    );
    assert_eq!(
        get(&result, "finalBalance").as_string().as_deref(),
        Some("10000251")
    );
    assert!(get(&result, "nationalTax").is_null());
    assert!(get(&result, "error").is_null());
}

#[wasm_bindgen_test]
fn compound_periods_for_crosses_the_boundary() {
    // 必須ケース #4(設計書 §7)。税 ON なので target は手取りと比べる。
    let result = calcarc_wasm::compound_periods_for("999", "0", "1016", "1.5", 12, true);
    assert_eq!(get(&result, "periods").as_string().as_deref(), Some("19"));
    assert_eq!(get(&result, "net").as_string().as_deref(), Some("1016"));
    assert!(get(&result, "error").is_null());
}

#[wasm_bindgen_test]
fn compound_inverse_errors_are_returned_not_thrown() {
    // 目標 0 は SyntaxError。境界は例外を投げず、戻り値の error に出す。
    let result = calcarc_wasm::compound_deposit_for("0", "0", "3", 12, 240, false);
    assert_eq!(
        get(&result, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
    assert!(get(&result, "deposit").is_null());
}

#[wasm_bindgen_test]
fn compound_periods_inverse_errors_are_returned_not_thrown() {
    // 対称ケース: compound_periods_for も目標 0 で同じ形の SyntaxError になる
    // ことを、例外を投げないまま確かめる(compound_deposit_for 側にしか
    // 無かった検査を揃える)。
    let result = calcarc_wasm::compound_periods_for("1000000", "0", "0", "3", 12, false);
    assert_eq!(
        get(&result, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
    assert!(get(&result, "periods").is_null());
}

#[wasm_bindgen_test]
fn expressions_cross_the_boundary() {
    // 丸めは着地の 1 回だけ。各演算で丸めるなら 999999 になる。
    let result = calcarc_wasm::expr_integer("1000000/3*3", "18446744073709551615", "yen");
    assert_eq!(
        get(&result, "value").as_string().as_deref(),
        Some("1000000")
    );
    assert!(get(&result, "error").is_null());
    // **単位はコアが解釈する**(設計書 訂正 2)。UI は展開しない。
    let with_units = calcarc_wasm::expr_integer("1億6000万-500万", "18446744073709551615", "yen");
    assert_eq!(
        get(&with_units, "value").as_string().as_deref(),
        Some("155000000")
    );
}

#[wasm_bindgen_test]
fn the_unit_table_is_chosen_by_name() {
    // 表そのものは渡さない。名前だけで選ぶ。
    for (name, expected) in [
        ("periods:12", "120"),
        ("periods:2", "20"),
        ("periods:1", "10"),
    ] {
        let result = calcarc_wasm::expr_integer("10年", "1200", name);
        assert_eq!(
            get(&result, "value").as_string().as_deref(),
            Some(expected),
            "{name}"
        );
    }
    // 知らない名前は例外ではなく戻り値のエラー。
    let unknown = calcarc_wasm::expr_integer("10年", "1200", "periods:4");
    assert_eq!(
        get(&unknown, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn expression_errors_are_returned_not_thrown() {
    let zero = calcarc_wasm::expr_integer("100/0", "18446744073709551615", "yen");
    assert_eq!(
        get(&zero, "error").as_string().as_deref(),
        Some("DivisionByZero")
    );
    assert!(
        get(&zero, "value").is_null(),
        "error carries null, not undefined"
    );
    // 中間オーバーフロー(数学的には戻るが仕様としてエラー)。
    let huge = "170141183460469231731687303715884105727";
    let middle = calcarc_wasm::expr_integer(
        &format!("{huge}*2/2"),
        "340282366920938463463374607431768211455",
        "count",
    );
    assert_eq!(
        get(&middle, "error").as_string().as_deref(),
        Some("Overflow")
    );
}

#[wasm_bindgen_test]
fn the_percent_landing_crosses_the_boundary() {
    let ok = calcarc_wasm::expr_percent("1.5+0.25");
    assert_eq!(get(&ok, "value").as_string().as_deref(), Some("1.75"));
    // 4 桁で表せない値は拒む(Rate の入口と同じ線)。
    let refused = calcarc_wasm::expr_percent("1/3");
    assert_eq!(
        get(&refused, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
}
