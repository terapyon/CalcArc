//! 印つきの状態が WASM 境界を往復すること(1.2.3 設計書 §6.4)を、**ブラウザで**確かめる。
//!
//! **本番の経路そのものを通す**——`initial_state` / `reduce` が返す `Step`(中で
//! `to_js_value` が直列化する)から `state` を抜き、`serde_wasm_bindgen::from_value` で
//! 戻す。`reduce_key` が状態を読み損ねると**黙って初期状態に戻る**(`lib.rs` の
//! `unwrap_or_else(|_| EngineState::initial())`)ので、往復と表示の両方で見る。
//!
//! 手元では回らない(`wasm-pack test` は CI)。**同じ主張の native 版**は
//! `exact_state_native.rs`(serde_json で往復する)。
//!
//! Run: wasm-pack test --headless --chrome crates/calcarc-wasm
#![cfg(target_arch = "wasm32")]

use calcarc_core::{EngineState, Key, reduce};
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

/// 同じ打鍵列を native の `reduce` で回した状態(比べる相手)。
fn native(keys: &[&str]) -> EngineState {
    let mut state = EngineState::initial();
    for key in keys {
        state = reduce(&state, Key::from_token(key).expect("unknown key")).0;
    }
    state
}

#[wasm_bindgen_test]
fn a_marked_state_comes_back_as_the_same_state() {
    for keys in [
        &["pi", "mul", "2", "eq"][..],
        &["1", "exp", "3", "0", "div", "3", "eq"],
    ] {
        let step = press(calcarc_wasm::initial_state(), keys);
        let back: EngineState = serde_wasm_bindgen::from_value(get(&step, "state"))
            .unwrap_or_else(|e| panic!("{keys:?} の状態が戻らない: {e}"));
        let expected = native(keys);
        // **印が付いていることを先に言う**——両方 None なら往復は何も確かめない。
        assert!(expected.current.exact.is_some(), "{keys:?}");
        assert_eq!(back, expected, "{keys:?}");
    }
}

#[wasm_bindgen_test]
fn the_mark_crosses_as_a_string_not_a_bigint() {
    // 10^30 / 3 は 2^53 を超える。数で渡すと BigInt になる(§6.1)。
    let step = press(
        calcarc_wasm::initial_state(),
        &["1", "exp", "3", "0", "div", "3", "eq"],
    );
    let q = get(&get(&get(&get(&step, "state"), "current"), "exact"), "q");
    assert_eq!(
        q.as_string().as_deref(),
        Some("1000000000000000000000000000000/3")
    );
}

#[wasm_bindgen_test]
fn reduce_key_does_not_silently_reset_a_marked_state() {
    // 初期化されていれば `0` が出る(§6.4)。表示だけのキーを 1 回通す。
    let step = press(calcarc_wasm::initial_state(), &["pi", "mul", "2", "eq"]);
    assert_eq!(main_text(&step), "6.283185307");
    let step = press(step, &["angle_toggle"]);
    assert_eq!(main_text(&step), "6.283185307");
}
