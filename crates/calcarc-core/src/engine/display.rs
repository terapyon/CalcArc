use serde::{Deserialize, Serialize};

use crate::error::CalcError;
use crate::numeric::angle::AngleMode;
use crate::numeric::format::{format_polar, format_rect};

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
    let main = if state.error.is_some() {
        ERROR_TEXT.to_string()
    } else if let Some(buffer) = &state.buffer {
        buffer.text()
    } else {
        match state.form {
            DisplayForm::Rect => format_rect(state.current),
            DisplayForm::Polar => format_polar(state.current, state.angle),
        }
    };

    DisplayState {
        main,
        angle: state.angle,
        form: state.form,
        pending_op: state.operators.iter().rev().find_map(|t| match t {
            OpToken::Op(op) => Some(*op),
            OpToken::OpenParen => None,
        }),
        pending_depth: state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::OpenParen))
            .count(),
        error: state.error,
    }
}
