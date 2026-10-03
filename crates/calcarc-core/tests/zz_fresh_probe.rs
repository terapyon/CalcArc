//! 一時の測り（消す）。「画面の値は前の答えのままか」を状態から導けるか。
use calcarc_core::{EngineState, Key, reduce, render};

fn after(tokens: &[&str]) -> EngineState {
    let mut state = EngineState::initial();
    for t in tokens {
        state = reduce(&state, Key::from_token(t).unwrap()).0;
    }
    state
}

#[test]
fn probe() {
    let cases: &[(&str, &[&str])] = &[
        ("初期", &[]),
        ("33 =", &["3", "3", "eq"]),
        ("33 = 3", &["3", "3", "eq", "3"]),
        ("33 = 3 DEL", &["3", "3", "eq", "3", "del"]),
        ("33 = 3 DEL DEL", &["3", "3", "eq", "3", "del", "del"]),
        ("33 = 33", &["3", "3", "eq", "3", "3"]),
        ("33 = + ", &["3", "3", "eq", "add"]),
        ("33 = 3 +", &["3", "3", "eq", "3", "add"]),
        ("33 = . DEL", &["3", "3", "eq", "dot", "del"]),
        ("33 = √", &["3", "3", "eq", "sqrt"]),
        ("3 +", &["3", "add"]),
    ];
    for (name, tokens) in cases {
        let s = after(tokens);
        println!(
            "FRESH {:<16} buffer={:<6} operands={} operators={} op_pending={:<5} on_hand={:<5} main={}",
            name,
            format!("{}", s.buffer.is_some()),
            s.operands.len(),
            s.operators.len(),
            s.operator_pending,
            s.on_hand,
            render(&s).main
        );
    }
}
