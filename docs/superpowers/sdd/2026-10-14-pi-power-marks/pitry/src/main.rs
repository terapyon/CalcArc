//! 1 行に 1 本のキー列（空白区切りの綴り）を標準入力から読み、`EngineState::initial()` から
//! `reduce` で歩いて、`キー列 \t 表示 \t re \t im \t エラー` を 1 行ずつ印字する。
//! この木の `crates/calcarc-core` を読む（`Cargo.toml` の `path`）。
use calcarc_core::{EngineState, Key, reduce, render};

fn main() {
    for line in std::io::stdin().lines() {
        let Ok(keys) = line else { break };
        if keys.trim().is_empty() {
            continue;
        }
        let mut state = EngineState::initial();
        for token in keys.split_whitespace() {
            let Some(key) = Key::from_token(token) else {
                eprintln!("unknown key {token:?} in {keys:?}");
                std::process::exit(2);
            };
            state = reduce(&state, key).0;
        }
        let shown = render(&state);
        println!(
            "{keys}\t{}\t{:?}\t{:?}\t{:?}",
            shown.main, state.current.value.re, state.current.value.im, shown.error
        );
    }
}
