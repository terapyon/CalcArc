use serde::{Deserialize, Serialize};

use crate::numeric::format::{format_real, format_real_eng, try_format_polar};
use crate::{AngleMode, CalcError, EngineState, Value};

use super::state::{BinOp, DisplayForm, Notation, OpToken};

/// エラー時にメイン表示に出す文字列。
pub const ERROR_TEXT: &str = "Math ERROR";

/// 状態から導出される表示内容。状態の一部ではない。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayState {
    /// 保留中の式(設計書 §4)。保留が無いあいだは空。
    pub echo: String,
    pub main: String,
    pub angle: AngleMode,
    pub form: DisplayForm,
    pub notation: Notation,
    pub pending_op: Option<BinOp>,
    pub pending_depth: usize,
    pub error: Option<CalcError>,
}

/// 表示は状態の純粋な関数である。
///
/// 丸めはここでしか起きない。`EngineState` に書き戻さないため、
/// 表示された値が次の計算の入力になることはない（base-spec §26）。
pub fn render(state: &EngineState) -> DisplayState {
    // 極形式の半径が溢れることがある。hypot は engine の finalize() を
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
        // 入力中は打鍵した通りに見せる(設計書 §3.2)。ENG を掛けるのは
        // 確定した値だけで、buffer.text() はここを経由しない。
        buffer.text()
    } else {
        match state.form {
            DisplayForm::Rect => format_rect_notated(state.current, state.notation),
            DisplayForm::Polar => {
                try_format_polar_notated(state.current, state.angle, state.notation)
                    .unwrap_or_else(|| ERROR_TEXT.to_string())
            }
        }
    };

    DisplayState {
        echo: if has_error {
            // エラー中は保留を伏せる。pending_op と同じ扱い。
            String::new()
        } else {
            echo_of(state)
        },
        main,
        angle: state.angle,
        form: state.form,
        notation: state.notation,
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

/// 実数 1 つを記法に従って文字列にする。
fn real_notated(x: f64, notation: Notation) -> String {
    match notation {
        Notation::Normal => format_real(x),
        Notation::Eng => format_real_eng(x),
    }
}

/// 直交形式で表示する。ENG が入っていれば実部・虚部それぞれに掛ける
/// (設計書 §6)。`format_rect` と形は同じで、実数の書式だけ差し替える。
fn format_rect_notated(v: Value, notation: Notation) -> String {
    if v.is_real() {
        return real_notated(v.re, notation);
    }
    let im = real_notated(v.im.abs(), notation);
    if v.re == 0.0 {
        let sign = if v.im < 0.0 { "-" } else { "" };
        return format!("{sign}j{im}");
    }
    let sign = if v.im < 0.0 { "-" } else { "+" };
    format!("{}{sign}j{im}", real_notated(v.re, notation))
}

/// 極形式で表示する。半径が有限でなければ None を返す。
///
/// **角度には ENG を掛けない**(設計書 §6、裁定 7)——半径にだけ通す。
fn try_format_polar_notated(v: Value, mode: AngleMode, notation: Notation) -> Option<String> {
    let p = v.to_polar();
    if !p.r.is_finite() {
        return None;
    }
    Some(format!(
        "{} ∠ {}",
        real_notated(p.r, notation),
        format_real(mode.angle_of(p.theta_rad))
    ))
}

/// 保留中の式を組み立てる(設計書 §4)。
///
/// 打鍵履歴ではなく**スタックの形**を見せる。後置関数は押した瞬間に値へ
/// 畳まれ(`30 sin` は `0.5`)、優先順位でも畳まれる(`2 × 3 +` は `6 +`)。
/// 打った通りを見せるには状態に履歴が要る——それは要望が残ったときの
/// 別の設計であり、ここでは導出できる範囲に留める。
fn echo_of(state: &EngineState) -> String {
    if state.operators.is_empty() {
        // 保留が無いなら main が値を見せている。二重に出さない。
        return String::new();
    }
    let mut parts: Vec<String> = Vec::new();
    let mut operands = state.operands.iter();
    for token in &state.operators {
        match token {
            OpToken::Op(op) => {
                // 二項演算子の左側にはオペランドが 1 つ立っている。
                if let Some(value) = operands.next() {
                    // echo も main と同じ画面に出る。ENG が main に掛かって
                    // いるのに echo だけ通常表記だと、表記が食い違って見える
                    // (設計書 §6。修正: 最終レビューで発覚)。
                    parts.push(format_rect_notated(*value, state.notation));
                }
                parts.push(op_symbol(*op).to_string());
            }
            // 開き括弧はオペランドを消費しない。
            OpToken::OpenParen => parts.push("(".to_string()),
        }
    }
    // まだ演算子が来ていないオペランドと、入力中の値。
    for value in operands {
        parts.push(format_rect_notated(*value, state.notation));
    }
    if let Some(buffer) = &state.buffer {
        parts.push(buffer.text());
    }
    parts.join(" ")
}

/// 演算子の記号。UI が `pending_op` を記号にしているのと同じ対応。
fn op_symbol(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "−",
        BinOp::Mul => "×",
        BinOp::Div => "÷",
        BinOp::Pow => "^",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
