//! 印つきの状態の往復(1.2.3 設計書 §6.4)の **native 版**。
//!
//! ブラウザ版(`exact_state.rs`)は `wasm-pack test` でしか回らず、手元では動かない。
//! こちらは同じ主張を **serde_json** で言う——**直列化の形(`q` が文字列 `"num/den"`)は
//! `#[serde(with = …)]` が決めるので、JSON でも serde_wasm_bindgen でも同じ**である。
//! **serde_wasm_bindgen 固有の経路(BigInt・`serialize_missing_as_null`)は見ない**——
//! そちらはブラウザ版の持ち分。
#![cfg(not(target_arch = "wasm32"))]

use calcarc_core::{EngineState, Key, reduce, render};

fn state_after(keys: &[&str]) -> EngineState {
    let mut state = EngineState::initial();
    for key in keys {
        state = reduce(&state, Key::from_token(key).expect("unknown key")).0;
    }
    state
}

#[test]
fn a_marked_state_comes_back_as_the_same_state() {
    for keys in [
        &["pi", "mul", "2", "eq"][..],
        &["1", "exp", "3", "0", "div", "3", "eq"],
    ] {
        let state = state_after(keys);
        assert!(state.current.exact.is_some(), "{keys:?}");
        let json = serde_json::to_value(&state).unwrap();
        let back: EngineState = serde_json::from_value(json).unwrap();
        assert_eq!(back, state, "{keys:?}");
    }
}

#[test]
fn the_mark_crosses_as_a_string() {
    let state = state_after(&["1", "exp", "3", "0", "div", "3", "eq"]);
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(
        json["current"]["exact"]["q"],
        serde_json::json!("1000000000000000000000000000000/3")
    );
}

#[test]
fn a_round_tripped_marked_state_keeps_its_display() {
    // `reduce_key` の黙った初期化を起こさない形であること(§6.4)。往復した状態に
    // 表示だけのキーを 1 回通して、`0` に戻っていないことを見る。
    let state = state_after(&["pi", "mul", "2", "eq"]);
    let back: EngineState = serde_json::from_value(serde_json::to_value(&state).unwrap()).unwrap();
    let (next, shown) = reduce(&back, Key::AngleToggle);
    assert_eq!(shown.main, "6.283185307");
    assert_eq!(render(&next).main, "6.283185307");
}
