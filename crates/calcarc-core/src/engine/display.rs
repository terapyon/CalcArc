use serde::{Deserialize, Serialize};

use crate::numeric::format::{format_rect, try_format_polar};
use crate::{AngleMode, CalcError, EngineState};

use super::state::{BinOp, DisplayForm, OpToken};

/// エラー時にメイン表示に出す文字列。
pub const ERROR_TEXT: &str = "Math ERROR";

/// 状態から導出される表示内容。状態の一部ではない。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayState {
    pub main: String,
    pub angle: AngleMode,
    pub form: DisplayForm,
    pub pending_op: Option<BinOp>,
    pub pending_depth: usize,
    pub error: Option<CalcError>,
}

/// 表示は状態の純粋な関数である。
///
/// 丸めはここでしか起きない。`EngineState` に書き戻さないため、
/// 表示された値が次の計算の入力になることはない（base-spec §26）。
pub fn render(state: &EngineState) -> DisplayState {
    // 極形式の半径が溢れることがある。hypot は engine の finite() を
    // 通らないので、ここで初めて分かる。値そのものは直交形式では
    // 表示できるので、engine の状態はエラーにしない。▸∠ で戻れる。
    let polar_overflow = state.error.is_none()
        && state.buffer.is_none()
        && state.form == DisplayForm::Polar
        && try_format_polar(state.current, state.angle).is_none();

    let error = state.error.or(if polar_overflow {
        Some(CalcError::Overflow)
    } else {
        None
    });
    let has_error = error.is_some();

    let main = if has_error {
        ERROR_TEXT.to_string()
    } else if let Some(buffer) = &state.buffer {
        buffer.text()
    } else {
        match state.form {
            DisplayForm::Rect => format_rect(state.current),
            DisplayForm::Polar => try_format_polar(state.current, state.angle)
                .unwrap_or_else(|| ERROR_TEXT.to_string()),
        }
    };

    DisplayState {
        main,
        angle: state.angle,
        form: state.form,
        // エラー中は保留状態を伏せる。スタックには途中の演算子が
        // 残っているが、それを見せても利用者にできることはない。
        pending_op: if has_error {
            None
        } else {
            state.operators.iter().rev().find_map(|t| match t {
                OpToken::Op(op) => Some(*op),
                OpToken::OpenParen => None,
            })
        },
        pending_depth: if has_error {
            0
        } else {
            state
                .operators
                .iter()
                .filter(|t| matches!(t, OpToken::OpenParen))
                .count()
        },
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::complex::value::Value;

    #[test]
    fn a_polar_overflow_reports_an_error_consistently() {
        // hypot(f64::MAX, f64::MAX) は f64 の範囲を超える。値そのものは
        // 有限で engine の状態はエラーではないが、表示できない以上、
        // 表示された DisplayState は自己矛盾してはいけない。
        let mut state = EngineState::initial();
        state.current = Value::new(f64::MAX, f64::MAX);
        state.form = DisplayForm::Polar;

        let shown = render(&state);

        assert_eq!(shown.main, ERROR_TEXT);
        assert_eq!(shown.error, Some(CalcError::Overflow));
        assert!(shown.pending_op.is_none());
        assert_eq!(shown.pending_depth, 0);
    }
}
