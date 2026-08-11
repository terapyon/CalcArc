//! reduce がどんな入力に対しても panic しないことを確認する。
//!
//! UI に panic を露出させないという要求（base-spec §27）は、
//! 個別のテストケースでは保証しきれないため無作為な打鍵列で検査する。

use calcarc_core::engine::display::display;
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::{EngineState, OpToken, STATE_SCHEMA};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// 任意の打鍵列を与えても panic せず、常に表示可能な状態が返る。
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            let key = Key::ALL[i];
            let (next, shown) = reduce(&state, key);
            prop_assert!(!shown.main.is_empty());
            prop_assert_eq!(next.schema, STATE_SCHEMA);

            // 構造の健全性も見る。panic の有無だけを見ていると、
            // スタックがずれたまま Ok を返す退行を見逃す。
            // エラーが立っていない限り、被演算数の数は保留中の
            // 二項演算子の数と一致していなければならない。
            if next.error.is_none() {
                let pending_ops = next
                    .operators
                    .iter()
                    .filter(|t| matches!(t, OpToken::Op(_)))
                    .count();
                prop_assert_eq!(next.operands.len(), pending_ops);
            }

            state = next;
        }
        prop_assert!(!display(&state).main.is_empty());
    }

    /// AC はどんな状態からでも初期表示に戻す。
    #[test]
    fn ac_always_recovers(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            state = reduce(&state, Key::ALL[i]).0;
        }
        let (cleared, shown) = reduce(&state, Key::Ac);
        prop_assert!(cleared.error.is_none());
        prop_assert!(cleared.operands.is_empty());
        prop_assert!(cleared.operators.is_empty());
        // 表示形式が Polar のままなら "0 ∠ 0"、Rect なら "0"。
        prop_assert!(shown.main == "0" || shown.main == "0 ∠ 0");
    }
}

#[test]
fn a_state_with_the_wrong_schema_is_discarded() {
    let mut stale = EngineState::initial();
    stale.schema = STATE_SCHEMA + 1;
    stale.current = calcarc_core::Value::real(999.0);

    // 例外にせず、初期状態から再開する（設計書 §5）。
    let (next, shown) = reduce(&stale, Key::from_token("3").unwrap());
    assert_eq!(next.schema, STATE_SCHEMA);
    assert_eq!(shown.main, "3");
}
