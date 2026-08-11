pub mod display;
pub mod key;
pub mod state;

// 関数 `display` は再エクスポートしない。モジュール名と衝突して
// 呼び出し側の import が曖昧になるため、`engine::display::display` で使う。
pub use display::DisplayState;

use crate::error::CalcResult;
use key::Key;
use state::{Buffer, EngineState};

/// 電卓の唯一の遷移関数。
///
/// 状態を持たず、渡された状態から新しい状態を作って返す。決して panic せず、
/// エラーは戻り値の状態に載る（設計書 D7、base-spec §27）。
pub fn reduce(state: &EngineState, key: Key) -> (EngineState, DisplayState) {
    let mut next = if state.is_valid() {
        state.clone()
    } else {
        // スキーマ不一致の状態を渡された場合は初期状態から始める。
        EngineState::initial()
    };

    if key == Key::Ac {
        next = next.cleared();
    } else if next.error.is_some() {
        // エラー中は AC 以外を受け付けない。
    } else if let Err(err) = apply(&mut next, key) {
        next.error = Some(err);
    }

    let shown = display::display(&next);
    (next, shown)
}

/// キー 1 つ分の遷移。Err を返した場合、呼び出し側がエラー状態にする。
fn apply(state: &mut EngineState, key: Key) -> CalcResult<()> {
    match key {
        Key::Digit(d) => {
            state
                .buffer
                .get_or_insert_with(Buffer::default)
                .push_digit(d);
        }
        Key::Dot => {
            state
                .buffer
                .get_or_insert_with(Buffer::default)
                .push_dot()?;
        }
        Key::J => {
            // j は常に新しい虚部入力を開始する。
            state.buffer = Some(Buffer::imaginary());
        }
        Key::Del => {
            if let Some(buffer) = &mut state.buffer
                && buffer.pop()
            {
                state.buffer = None;
            }
        }
        // 残りのキーは Task 7 以降で実装する。
        _ => {}
    }
    Ok(())
}
