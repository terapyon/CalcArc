//! calcarc-core を WebAssembly から使うための adapter。
//!
//! 計算ロジックを持たない。責務は型変換と export のみ(base-spec §6.2)。
//! JavaScript 例外を投げない。計算エラーは戻り値の一部である(base-spec §27)。

use calcarc_core::engine::display::{DisplayState, display};
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::EngineState;
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

/// 開発時に panic を可視化するためのフック以外では、panic は起きない想定。
/// 万一シリアライズに失敗したら null を返し、呼び出し側が初期化し直す。
fn to_js(step: &Step) -> JsValue {
    // None を undefined ではなく null にする。TypeScript 側の型は
    // `X | null` を宣言しており、undefined が来ると `!== null` が
    // 常に真になって、成功した計算がすべてエラー扱いになる。
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    step.serialize(&serializer).unwrap_or(JsValue::NULL)
}

fn step_of(state: EngineState) -> Step {
    let shown = display(&state);
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
