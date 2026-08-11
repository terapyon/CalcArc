pub mod display;
pub mod key;
pub mod state;

// 関数 `display` は再エクスポートしない。モジュール名と衝突して
// 呼び出し側の import が曖昧になるため、`engine::display::display` で使う。
pub use display::DisplayState;

use crate::complex::arith::{add, div, mul, sub};
use crate::complex::value::Value;
use crate::error::CalcError;
use crate::error::CalcResult;
use key::Key;
use state::{BinOp, Buffer, EngineState, OpToken};

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

fn apply_binop(op: BinOp, lhs: Value, rhs: Value) -> CalcResult<Value> {
    match op {
        BinOp::Add => add(lhs, rhs),
        BinOp::Sub => sub(lhs, rhs),
        BinOp::Mul => mul(lhs, rhs),
        BinOp::Div => div(lhs, rhs),
    }
}

/// 入力中のバッファを確定して `current` に移す。
fn commit_entry(state: &mut EngineState) {
    if let Some(buffer) = state.buffer.take() {
        state.current = buffer.value();
    }
}

/// 演算子スタックの先頭 1 つを適用する。
fn reduce_top(state: &mut EngineState) -> CalcResult<()> {
    let op = match state.operators.pop() {
        Some(OpToken::Op(op)) => op,
        _ => return Err(CalcError::SyntaxError),
    };
    let rhs = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    let lhs = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    state.operands.push(apply_binop(op, lhs, rhs)?);
    Ok(())
}

/// 二項演算子が押されたときの遷移。
///
/// 同じか高い優先順位の演算子が保留されていれば先に畳む。これにより
/// `2 + 3 +` の時点で 5 が表示され、`2 + 3 ×` では畳まれない。
fn push_binop(state: &mut EngineState, op: BinOp) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    // `state.operators.last()` の借用を while の条件式で終わらせてから
    // `reduce_top(&mut state)` を呼ぶ。matches! の中に閉じ込めるのがその手段。
    while matches!(
        state.operators.last(),
        Some(OpToken::Op(top)) if top.precedence() >= op.precedence()
    ) {
        reduce_top(state)?;
    }
    state.operators.push(OpToken::Op(op));
    state.current = *state.operands.last().ok_or(CalcError::SyntaxError)?;
    Ok(())
}

/// `=` が押されたときの遷移。保留中のものをすべて畳む。
fn finish(state: &mut EngineState) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    // OpToken は Copy なので copied() で借用を切ってから分岐する。
    while let Some(top) = state.operators.last().copied() {
        match top {
            OpToken::Op(_) => reduce_top(state)?,
            // 閉じ忘れた括弧は自動的に閉じる。
            OpToken::OpenParen => {
                state.operators.pop();
            }
        }
    }
    state.current = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    state.operands.clear();
    Ok(())
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
        Key::Add => push_binop(state, BinOp::Add)?,
        Key::Sub => push_binop(state, BinOp::Sub)?,
        Key::Mul => push_binop(state, BinOp::Mul)?,
        Key::Div => push_binop(state, BinOp::Div)?,
        Key::Eq => finish(state)?,
        // 残りのキーは Task 8 以降で実装する。
        _ => {}
    }
    Ok(())
}
