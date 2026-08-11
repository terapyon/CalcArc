use serde::{Deserialize, Serialize};

use crate::error::CalcError;
use crate::numeric::angle::AngleMode;
use crate::numeric::format::{format_rect, try_format_polar};

use super::state::{BinOp, DisplayForm, EngineState, OpToken};

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
pub fn display(state: &EngineState) -> DisplayState {
    let has_error = state.error.is_some();
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
        error: state.error,
    }
}
