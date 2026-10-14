//! 1 行に 1 本のキー列（空白区切りの綴り）を標準入力から読み、`EngineState::initial()` から
//! `reduce` で歩いて、`キー列 \t 表示 \t re \t im \t エラー` を 1 行ずつ印字する。
//!
//! 1.2.5 の設計書（`docs/superpowers/specs/2026-10-14-pi-power-marks-design.md`）§0 の数を
//! 取る道具。手順は `docs/superpowers/sdd/2026-10-14-pi-power-marks/README.md`。
//!
//! ```bash
//! cargo run -p calcarc-core --release --example pitry < keys.txt
//! ```
#![deny(clippy::unwrap_used, clippy::expect_used)]

use calcarc_core::{EngineState, Key, reduce, render};
use std::process::ExitCode;

fn main() -> ExitCode {
    for line in std::io::stdin().lines() {
        let Ok(keys) = line else {
            return ExitCode::FAILURE;
        };
        if keys.trim().is_empty() {
            continue;
        }
        let mut state = EngineState::initial();
        for token in keys.split_whitespace() {
            let Some(key) = Key::from_token(token) else {
                eprintln!("unknown key {token:?} in {keys:?}");
                return ExitCode::FAILURE;
            };
            state = reduce(&state, key).0;
        }
        let shown = render(&state);
        println!(
            "{keys}\t{}\t{:?}\t{:?}\t{:?}",
            shown.main, state.current.value.re, state.current.value.im, shown.error
        );
    }
    ExitCode::SUCCESS
}
