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
