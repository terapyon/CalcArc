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
    let code = get(&result, "code");
    assert_eq!(code.as_string().as_deref(), Some("Overflow"));
    // **失敗の枝に payload の鍵は無い**(設計書 §0)。潰していた頃は
    // `bytes: null` が並んでいたが、いまは鍵ごと出ない。
    let bytes = get(&result, "bytes");
    assert!(bytes.is_undefined(), "失敗に payload の鍵は出ない");
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
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
}

#[wasm_bindgen_test]
fn the_llm_headline_crosses_the_boundary() {
    let value = calcarc_wasm::llm_memory("27000000000", "int4", "62", "16", "128", "8192", "fp16");
    let total = get(&value, "total");
    assert_eq!(
        get(&total, "bytesGrouped").as_string().as_deref(),
        Some("17,660,749,568")
    );
    assert_eq!(
        get(&total, "decimal").as_string().as_deref(),
        Some("17.7 GB")
    );
}

#[wasm_bindgen_test]
fn a_transfer_error_is_a_value_not_an_exception() {
    let value = calcarc_wasm::data_transfer("1", "tbps", "1", "second");
    assert_eq!(
        get(&value, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
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
    // **成功に `error` の欄は無い**(設計書 §0)。**在るのは `kind` である。**
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
    assert!(
        get(&result, "error").is_undefined(),
        "成功に error は出ない"
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
    assert_eq!(get(&inverted, "kind").as_string().as_deref(), Some("ok"));
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
    // 残価 ≥ 元本 は SyntaxError。**例外ではなく戻り値で返る**(base-spec §27)。
    let result = calcarc_wasm::loan_forward("1000000", "1.5", 12, "1000000");
    // **失敗は `code` で名乗る。** 潰していた頃は `error` だった。
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("error"));
    assert_eq!(
        get(&result, "code").as_string().as_deref(),
        Some("SyntaxError")
    );

    // **【契約の変更 2026-08-28】失敗に payload の欄は 1 つも無い。**
    //
    // ここには「金額の欄は undefined ではなく null」と書いてあった
    // ——潰した形では失敗にも 5 つの欄が並び、`serialize_missing_as_null(true)`
    // が `undefined` を `null` に均していた。TS が `X | null` と宣言していたので、
    // `undefined` が来ると `!== null` が常に真になり、**失敗が成功として読まれた**
    // からである。
    //
    // **2 択にした結果、その心配ごと自体が消えた。** 失敗の枝に欄が無いので、
    // 「欄はあるが中身が無い」という状態を作らない。**`kind` を見ずに payload を
    // 読むコードは、TS の型が書かせない。**
    assert!(
        get(&result, "monthlyPayment").is_undefined(),
        "失敗に payload の欄は無い"
    );
    assert!(get(&result, "rowsPaid").is_undefined());

    // 1 回払いで P + 利息があふれる入力は Overflow。
    let overflowed = calcarc_wasm::loan_forward("18446744073709551615", "1.5", 1, "0");
    assert_eq!(
        get(&overflowed, "code").as_string().as_deref(),
        Some("Overflow")
    );
    // 金利文字列が読めないのも戻り値のエラー。
    let bad_rate = calcarc_wasm::loan_term("1000000", "abc", "50000");
    assert_eq!(
        get(&bad_rate, "code").as_string().as_deref(),
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
    assert_eq!(main_text(&step), "3j");
    assert_eq!(
        get(&get(&step, "display"), "echo").as_string().as_deref(),
        Some("3j +")
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
    // 税を求めなければ 3 項目は null(undefined ではない)——**本当に任意**な
    // フィールドなので、Outcome 化しても `Option` のまま残っている(設計書 §3)。
    assert!(get(&result, "nationalTax").is_null());
    assert!(get(&result, "localTax").is_null());
    assert!(get(&result, "net").is_null());
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
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
        get(&overflowed, "code").as_string().as_deref(),
        Some("Overflow")
    );
    assert!(get(&overflowed, "finalBalance").is_undefined());
    // 四半期複利は持たない。境界も例外を投げず SyntaxError を返す。
    let bad_period = calcarc_wasm::compound_grow("1000000", "0", "1", 4, 10, false);
    assert_eq!(
        get(&bad_period, "code").as_string().as_deref(),
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
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
}

#[wasm_bindgen_test]
fn compound_periods_for_crosses_the_boundary() {
    // 必須ケース #4(設計書 §7)。税 ON なので target は手取りと比べる。
    let result = calcarc_wasm::compound_periods_for("999", "0", "1016", "1.5", 12, true);
    assert_eq!(get(&result, "periods").as_string().as_deref(), Some("19"));
    assert_eq!(get(&result, "net").as_string().as_deref(), Some("1016"));
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
}

#[wasm_bindgen_test]
fn compound_inverse_errors_are_returned_not_thrown() {
    // 目標 0 は SyntaxError。境界は例外を投げず、戻り値の error に出す。
    let result = calcarc_wasm::compound_deposit_for("0", "0", "3", 12, 240, false);
    assert_eq!(
        get(&result, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
    // 失敗の枝に payload の鍵は**無い**(null ではなく undefined)。
    assert!(get(&result, "deposit").is_undefined());
}

#[wasm_bindgen_test]
fn compound_periods_inverse_errors_are_returned_not_thrown() {
    // 対称ケース: compound_periods_for も目標 0 で同じ形の SyntaxError になる
    // ことを、例外を投げないまま確かめる(compound_deposit_for 側にしか
    // 無かった検査を揃える)。
    let result = calcarc_wasm::compound_periods_for("1000000", "0", "0", "3", 12, false);
    assert_eq!(
        get(&result, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
    assert!(get(&result, "periods").is_undefined());
}

#[wasm_bindgen_test]
fn expressions_cross_the_boundary() {
    // 丸めは着地の 1 回だけ。各演算で丸めるなら 999999 になる。
    let result = calcarc_wasm::expr_integer("1000000/3*3", "18446744073709551615", "yen");
    assert_eq!(
        get(&result, "value").as_string().as_deref(),
        Some("1000000")
    );
    assert_eq!(get(&result, "kind").as_string().as_deref(), Some("ok"));
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
        get(&unknown, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn expression_errors_are_returned_not_thrown() {
    let zero = calcarc_wasm::expr_integer("100/0", "18446744073709551615", "yen");
    assert_eq!(
        get(&zero, "code").as_string().as_deref(),
        Some("DivisionByZero")
    );
    // **失敗の枝に payload の鍵は無い**(設計書 §0)。潰していた頃は
    // `value: null` が並んでいたが、いまは鍵ごと出ない。
    assert!(get(&zero, "value").is_undefined(), "失敗に value は出ない");
    // 中間オーバーフロー(数学的には戻るが仕様としてエラー)。
    let huge = "170141183460469231731687303715884105727";
    let middle = calcarc_wasm::expr_integer(
        &format!("{huge}*2/2"),
        "340282366920938463463374607431768211455",
        "count",
    );
    assert_eq!(
        get(&middle, "code").as_string().as_deref(),
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
        get(&refused, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn a_conversion_crosses_the_boundary_as_text() {
    // 100 km = 100000 / 1609.344 mi。有理数のまま計算し、表示で 10 桁に丸める。
    let value = calcarc_wasm::convert("100", "length", "km", "mi");
    assert_eq!(
        get(&value, "text").as_string().as_deref(),
        Some("62.13711922")
    );
    // **成功に `error` の欄は無い。在るのは `kind` である**(設計書 §0)。
    assert_eq!(get(&value, "kind").as_string().as_deref(), Some("ok"));
}

#[wasm_bindgen_test]
fn the_temperature_fixed_point_crosses_the_boundary() {
    // −40 は factor と offset の両方が同時に効く唯一の点(設計書 §6)。
    // 単項マイナスは構文解析器に無く、convert の入口が担う。
    let value = calcarc_wasm::convert("-40", "temperature", "degc", "degf");
    assert_eq!(get(&value, "text").as_string().as_deref(), Some("-40"));
}

#[wasm_bindgen_test]
fn an_unknown_unit_is_an_error_in_the_return_value_not_an_exception() {
    let value = calcarc_wasm::convert("1", "length", "km", "furlong");
    assert_eq!(
        get(&value, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
    // **失敗の枝に payload の鍵は無い**(設計書 §0)。
    assert!(get(&value, "text").is_undefined());
    // カテゴリをまたぐ組み合わせも同じ扱い(例外ではなく戻り値)。
    let crossed = calcarc_wasm::convert("1", "length", "km", "kg");
    assert_eq!(
        get(&crossed, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
}

#[wasm_bindgen_test]
fn the_unit_list_comes_back_in_the_order_the_panel_shows() {
    let value = calcarc_wasm::convert_units("length");
    let units = js_sys::Array::from(&get(&value, "units"));
    assert_eq!(units.length(), 11);
    assert_eq!(units.get(0).as_string().as_deref(), Some("nm"));
    assert_eq!(units.get(10).as_string().as_deref(), Some("nmi"));
    assert_eq!(get(&value, "kind").as_string().as_deref(), Some("ok"));
    // 温度は 3 件。カテゴリごとに切り出されている。
    let temperature =
        js_sys::Array::from(&get(&calcarc_wasm::convert_units("temperature"), "units"));
    assert_eq!(temperature.length(), 3);
    assert_eq!(temperature.get(0).as_string().as_deref(), Some("k"));
    // 知らないカテゴリは例外ではなく戻り値のエラー。
    let unknown = calcarc_wasm::convert_units("furlongs");
    assert_eq!(
        get(&unknown, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
    assert!(get(&unknown, "units").is_undefined());
}

#[wasm_bindgen_test]
fn a_currency_conversion_crosses_the_boundary_as_text() {
    // 100 USD → JPY(golden `currency/100usdtojpy@1.0855-168.5` と同一)。
    let value = calcarc_wasm::convert_currency("100", "usd", "jpy", "1.0855", "168.5");
    assert_eq!(get(&value, "text").as_string().as_deref(), Some("15,523"));
    // **成功に `error` の欄は無い。在るのは `kind` である**(設計書 §0)。
    assert_eq!(get(&value, "kind").as_string().as_deref(), Some("ok"));
}

#[wasm_bindgen_test]
fn an_unknown_from_currency_is_a_syntax_error_not_a_pass_through() {
    // **申し送りの核心**: core の `convert_currency` は `from` を取らないので、
    // WASM 境界がここで `Currency::from_token` を通さないと、`from` に何を
    // 渡しても素通りしてしまう(`to` と `from_rate` だけで答が出るため)。
    let value = calcarc_wasm::convert_currency("100", "xyz", "jpy", "1.0855", "168.5");
    assert_eq!(
        get(&value, "code").as_string().as_deref(),
        Some("SyntaxError"),
        "an unknown `from` token must not be allowed through"
    );
    // **失敗の枝に payload の鍵は無い**(設計書 §0)。
    assert!(get(&value, "text").is_undefined());
}

#[wasm_bindgen_test]
fn an_unknown_to_currency_is_also_a_syntax_error() {
    let value = calcarc_wasm::convert_currency("100", "usd", "xyz", "1.0855", "168.5");
    assert_eq!(
        get(&value, "code").as_string().as_deref(),
        Some("SyntaxError")
    );
    assert!(get(&value, "text").is_undefined());
}

#[wasm_bindgen_test]
fn a_zero_from_rate_is_a_division_by_zero_not_an_exception() {
    let value = calcarc_wasm::convert_currency("100", "usd", "jpy", "0", "168.5");
    assert_eq!(
        get(&value, "code").as_string().as_deref(),
        Some("DivisionByZero")
    );
    assert!(get(&value, "text").is_undefined());
}

#[wasm_bindgen_test]
fn the_currency_list_comes_back_in_currency_all_order() {
    let value = calcarc_wasm::currency_units();
    let units = js_sys::Array::from(&get(&value, "units"));
    assert_eq!(units.length(), 16);
    assert_eq!(units.get(0).as_string().as_deref(), Some("jpy"));
    assert_eq!(units.get(1).as_string().as_deref(), Some("krw"));
    assert_eq!(units.get(2).as_string().as_deref(), Some("vnd"));
    assert_eq!(units.get(15).as_string().as_deref(), Some("brl"));
}

#[wasm_bindgen_test]
fn the_bonus_forward_answers_in_two_shapes() {
    // **成功と失敗が別の形になる**(設計書 §0)。潰した形では、成功にも
    // `"error":null` が並び、失敗にも 7 つの `null` が並んでいた。
    let ok = calcarc_wasm::loan_bonus_forward("30000000", "5000000", "1.5", 420);
    let json = String::from(js_sys::JSON::stringify(&ok).unwrap());
    assert!(
        json.starts_with(r#"{"kind":"ok","monthlyPayment":"#),
        "{json}"
    );
    assert!(!json.contains("null"), "成功に null は出ない: {json}");

    // 金利の綴りが壊れていれば SyntaxError。**payload は 1 つも出ない。**
    let err = calcarc_wasm::loan_bonus_forward("30000000", "5000000", "x", 420);
    let json = String::from(js_sys::JSON::stringify(&err).unwrap());
    assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
}

#[wasm_bindgen_test]
fn the_loan_family_answers_in_two_shapes() {
    // 段階 1 の `loan_bonus_forward` と同じ形が、残り 4 つにも掛かる。
    let ok = [
        calcarc_wasm::loan_forward("30000000", "1.5", 420, "0"),
        calcarc_wasm::loan_principal("85000", "1.5", 420),
        calcarc_wasm::loan_term("30000000", "1.5", "85000"),
        calcarc_wasm::loan_bonus_principal("80000", "100000", "1.5", 420),
    ];
    for value in &ok {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","#), "{json}");
        assert!(!json.contains("null"), "成功に null は出ない: {json}");
    }

    // 金利の綴りが壊れていれば、4 つとも同じ形で断る。
    let err = [
        calcarc_wasm::loan_forward("30000000", "x", 420, "0"),
        calcarc_wasm::loan_principal("85000", "x", 420),
        calcarc_wasm::loan_term("30000000", "x", "85000"),
        calcarc_wasm::loan_bonus_principal("80000", "100000", "x", 420),
    ];
    for value in &err {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
    }
}

#[wasm_bindgen_test]
fn the_compound_family_answers_in_two_shapes() {
    // **税ありなら null は 1 つも出ない。**
    let ok = [
        // (principal, deposit, rate, periods/year, periods, tax)
        calcarc_wasm::compound_grow("1000000", "0", "1", 12, 60, true),
        // (principal, target, rate, periods/year, periods, tax)
        calcarc_wasm::compound_deposit_for("0", "1000000", "1", 12, 60, true),
        // (principal, deposit, target, rate, periods/year, tax)
        calcarc_wasm::compound_periods_for("0", "10000", "1000000", "1", 12, true),
    ];
    for value in &ok {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","#), "{json}");
        assert!(
            !json.contains("null"),
            "税ありの成功に null は出ない: {json}"
        );
    }

    // **税なしのときだけ、税の 3 項目が null になる**——これは「失敗したから
    // 無い」ではなく**本当に任意**である(設計書 §3)。潰しの `Option` と
    // 区別が付くように、**どれが null になるかを名指しで固定する。**
    let untaxed = calcarc_wasm::compound_grow("1000000", "0", "1", 12, 60, false);
    let json = String::from(js_sys::JSON::stringify(&untaxed).unwrap());
    assert!(json.starts_with(r#"{"kind":"ok","#), "{json}");
    for (key, null) in [
        ("finalBalance", false),
        ("principalTotal", false),
        ("interest", false),
        ("nationalTax", true),
        ("localTax", true),
        ("net", true),
    ] {
        assert_eq!(
            get(&untaxed, key).is_null(),
            null,
            "{key} の任意性が違う: {json}"
        );
    }
    // 期数 0 は SyntaxError(コアの定義域)。
    let err = calcarc_wasm::compound_grow("1000000", "0", "1", 12, 0, false);
    let json = String::from(js_sys::JSON::stringify(&err).unwrap());
    assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
}

#[wasm_bindgen_test]
fn the_data_scale_family_answers_in_two_shapes() {
    // `data_scale` と `data_transfer` は**同じ形**を返す(spec §6)。
    // 大きい値を選ぶと `decimal` も `binary` も埋まる。
    let ok = [
        // (count, dimensions, dtype)
        calcarc_wasm::data_scale("1000000", "1024", "float32"),
        // (bandwidth, unit, duration, unit)
        calcarc_wasm::data_transfer("100", "mbps", "3", "hour"),
    ];
    for value in &ok {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","bytes":"#), "{json}");
        assert!(!json.contains("null"), "成功に null は出ない: {json}");
    }

    // **`decimal` と `binary` は本当に任意である**(設計書 §3)——1000 bytes
    // 未満に 10 進の単位は無く、1024 bytes 未満に 2 進の単位は無い
    // (`format.rs`)。**境目が別々なので、片方だけ埋まる帯がある。**
    for (count, decimal, binary) in [
        ("1", false, false),
        // 1000..1023 の帯: 10 進だけ単位が付く
        ("1000", true, false),
        ("1024", true, true),
    ] {
        let value = calcarc_wasm::data_scale(count, "1", "int8");
        let json = String::from(js_sys::JSON::stringify(&value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","#), "{json}");
        assert_eq!(
            !get(&value, "decimal").is_null(),
            decimal,
            "{count} bytes の decimal: {json}"
        );
        assert_eq!(
            !get(&value, "binary").is_null(),
            binary,
            "{count} bytes の binary: {json}"
        );
        // **こちらは任意ではない。** 潰しの `Option` が戻ったら落ちる。
        assert!(!get(&value, "bytes").is_null(), "{json}");
        assert!(!get(&value, "bytesGrouped").is_null(), "{json}");
    }

    // dtype の綴りが壊れていれば SyntaxError。**payload は 1 つも出ない。**
    let err = [
        calcarc_wasm::data_scale("1000", "1", "x"),
        calcarc_wasm::data_transfer("100", "x", "3", "hour"),
    ];
    for value in &err {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
    }
}

#[wasm_bindgen_test]
fn the_llm_estimate_answers_in_two_shapes() {
    // 27B・int4・fp16 KV。**3 組とも単位が付く大きさ**なので、成功の JSON に
    // null は 1 つも出ない。
    let ok = calcarc_wasm::llm_memory("27000000000", "int4", "62", "16", "128", "8192", "fp16");
    let json = String::from(js_sys::JSON::stringify(&ok).unwrap());
    assert!(json.starts_with(r#"{"kind":"ok","weight":"#), "{json}");
    assert!(!json.contains("null"), "成功に null は出ない: {json}");
    // **入れ子の中まで綴りを見る。** 外側だけ見ていると、組の中の
    // `bytes_grouped` を取り逃がす。
    assert!(!json.contains('_'), "snake_case が漏れている: {json}");

    // 精度の綴りが壊れていれば SyntaxError。**3 組とも出ない。**
    let err = calcarc_wasm::llm_memory("27000000000", "x", "62", "16", "128", "8192", "fp16");
    let json = String::from(js_sys::JSON::stringify(&err).unwrap());
    assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
}

#[wasm_bindgen_test]
fn the_expression_evaluator_answers_in_two_shapes() {
    // **payload が 1 つでも構造体で包む。** 内部タグ付きは payload が map に
    // なる形しか直列化できない——素の文字列を包むと実行時に失敗する。
    let ok = [
        calcarc_wasm::expr_integer("1億6000万-500万", "18446744073709551615", "yen"),
        calcarc_wasm::expr_percent("1.5"),
    ];
    for value in &ok {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","value":"#), "{json}");
        assert!(!json.contains("null"), "成功に null は出ない: {json}");
    }

    // **3 種類とも別々の綴りで返る**(TS の `ExprErrorCode` は 3 つ挙げている)。
    for (text, code) in [
        ("1/0", "DivisionByZero"),
        ("1+", "SyntaxError"),
        ("99999999999999999999", "Overflow"),
    ] {
        let err = calcarc_wasm::expr_integer(text, "18446744073709551615", "yen");
        let json = String::from(js_sys::JSON::stringify(&err).unwrap());
        assert_eq!(json, format!(r#"{{"kind":"error","code":"{code}"}}"#));
    }
}

#[wasm_bindgen_test]
fn the_conversion_family_answers_in_two_shapes() {
    // 単位換算・為替・単位一覧の 3 本。**一覧だけ payload が配列**である。
    let ok = [
        calcarc_wasm::convert("100", "length", "km", "mi"),
        calcarc_wasm::convert_currency("100", "usd", "jpy", "1.0855", "168.5"),
    ];
    for value in &ok {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert!(json.starts_with(r#"{"kind":"ok","text":"#), "{json}");
        assert!(!json.contains("null"), "成功に null は出ない: {json}");
    }
    let units = calcarc_wasm::convert_units("temperature");
    let json = String::from(js_sys::JSON::stringify(&units).unwrap());
    assert_eq!(json, r#"{"kind":"ok","units":["k","degc","degf"]}"#);

    // 知らない綴りは 3 本とも同じ形で断る。**payload は 1 つも出ない。**
    let err = [
        calcarc_wasm::convert("1", "length", "km", "furlong"),
        calcarc_wasm::convert_currency("100", "xyz", "jpy", "1.0855", "168.5"),
        calcarc_wasm::convert_units("furlongs"),
    ];
    for value in &err {
        let json = String::from(js_sys::JSON::stringify(value).unwrap());
        assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
    }
}

#[wasm_bindgen_test]
fn spell_keys_joins_the_way_the_table_says() {
    let out = calcarc_wasm::spell_keys(vec!["3".into(), "0".into(), "sin".into()]);
    assert_eq!(out, "30 sin");
}

#[wasm_bindgen_test]
fn spell_keys_ignores_tokens_it_does_not_know() {
    // **境界は例外を投げない。** 知らないトークンは黙って飛ばす。
    let out = calcarc_wasm::spell_keys(vec!["3".into(), "nonsense".into(), "sin".into()]);
    assert_eq!(out, "3 sin");
}
