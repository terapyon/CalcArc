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
use crate::scientific;
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
    } else {
        let was_pending = next.operator_pending;
        // DEL が何も消さないかどうかは、適用の前に見ておく必要がある。
        // 消さなかったなら「直前が二項演算子だった」という事実は残る。
        let del_changes_nothing =
            next.buffer.is_none() && !matches!(next.operators.last(), Some(OpToken::OpenParen));

        if let Err(err) = apply(&mut next, key) {
            next.error = Some(err);
        }
        next.operator_pending = next.error.is_none()
            && match key {
                Key::Add | Key::Sub | Key::Mul | Key::Div => true,
                // 表示だけを変えるキーは「直前が演算子だった」事実を消さない。
                // 消さないと 3 + DRG + が差し替えではなく累算になる。
                Key::AngleToggle | Key::PolarToggle => was_pending,
                // 何も消さなかった DEL も同じ。
                Key::Del if del_changes_nothing => was_pending,
                _ => false,
            };
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
    // 演算子を続けて押したときは、直前の演算子を差し替える。押し直しは
    // 打ち間違いの訂正であって、もう一度計算しろという意味ではない。
    // 差し替えないと accumulator 自身が右辺として積まれ、3 + + 4 = が
    // 10 になる。
    if state.operator_pending
        && let Some(last) = state.operators.last_mut()
    {
        *last = OpToken::Op(op);
        return Ok(());
    }
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

/// DEL の 1 回分。数字 → `j` マーカー → 閉じられていない開き括弧の順に、
/// ひとつだけ消す。どれも無ければ何もしない（設計書 I7）。
///
/// 演算子は消さない。消せるようにすると、確定済みの入力を復元する必要が
/// 生じて undo になる。undo は状態に履歴スタックを要求し、EngineState が
/// 毎打鍵で WASM 境界を往復する設計（D7）に正面から効く。
fn delete_one(state: &mut EngineState) {
    if let Some(buffer) = &mut state.buffer {
        // 1 段目と 2 段目は Buffer::pop が担う。数字が残っていれば末尾を
        // 消し、数字が尽きていれば j ごとバッファを捨てる。
        if buffer.pop() {
            state.buffer = None;
        }
        return;
    }
    // 3 段目。演算子が保留されていれば last は Op なので、この分岐には
    // 入らない。括弧を演算子の下から抜くことはない。
    if matches!(state.operators.last(), Some(OpToken::OpenParen)) {
        state.operators.pop();
    }
}

/// `(` が押されたときの遷移。
///
/// 新しい被演算数の文脈を開く。入力途中の数値があっても破棄する。
/// `3 (` のような打鍵は意味を持たないため、暗黙の乗算にはしない。
fn open_paren(state: &mut EngineState) {
    state.buffer = None;
    state.current = Value::ZERO;
    state.operators.push(OpToken::OpenParen);
}

/// `)` が押されたときの遷移。対応する `(` まで畳む。
fn close_paren(state: &mut EngineState) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    loop {
        // copied() で借用を切らないと、分岐の中で state を可変借用できない。
        match state.operators.last().copied() {
            Some(OpToken::Op(_)) => reduce_top(state)?,
            Some(OpToken::OpenParen) => {
                state.operators.pop();
                break;
            }
            None => return Err(CalcError::SyntaxError),
        }
    }
    state.current = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    Ok(())
}

/// 後置関数の遷移。入力中の値を確定してから、その値に即座に適用する。
///
/// 式には積まれない。`30` `sin` は打鍵した瞬間に 0.5 になる（設計書 D6）。
fn apply_unary<F>(state: &mut EngineState, f: F) -> CalcResult<()>
where
    F: FnOnce(Value) -> CalcResult<Value>,
{
    commit_entry(state);
    state.current = f(state.current)?;
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
        Key::Del => delete_one(state),
        Key::Add => push_binop(state, BinOp::Add)?,
        Key::Sub => push_binop(state, BinOp::Sub)?,
        Key::Mul => push_binop(state, BinOp::Mul)?,
        Key::Div => push_binop(state, BinOp::Div)?,
        Key::Eq => finish(state)?,
        Key::LParen => open_paren(state),
        Key::RParen => close_paren(state)?,
        Key::Sqrt => apply_unary(state, scientific::sqrt)?,
        Key::Sqr => apply_unary(state, scientific::sqr)?,
        Key::Neg => apply_unary(state, |v| Ok(scientific::neg(v)))?,
        Key::Sin => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::sin(v, mode))?;
        }
        Key::Cos => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::cos(v, mode))?;
        }
        Key::Tan => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::tan(v, mode))?;
        }
        Key::Pi => {
            state.buffer = None;
            state.current = Value::real(std::f64::consts::PI);
        }
        Key::AngleToggle => {
            // 保持している値は変えない。表示と以後の三角関数にだけ効く。
            state.angle = state.angle.toggled();
        }
        Key::PolarToggle => {
            // 表示形式だけを入れ替える。current には触れない。
            // これがあるから丸めた値が次の計算に流れ込まない。
            state.form = state.form.toggled();
        }
        // AC は reduce 側で処理済みなので、ここでは何もしない。
        // 網羅性のために腕だけ置く。
        Key::Ac => {}
    }
    Ok(())
}
