//! reduce がどんな入力に対しても panic しないことを確認する。
//!
//! UI に panic を露出させないという要求（base-spec §27）は、
//! 個別のテストケースでは保証しきれないため無作為な打鍵列で検査する。

use calcarc_core::engine::display::display;
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::{EngineState, STATE_SCHEMA};
use proptest::prelude::*;

const TOKENS: &[&str] = &[
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "dot",
    "pi",
    "add",
    "sub",
    "mul",
    "div",
    "eq",
    "lparen",
    "rparen",
    "j",
    "polar_toggle",
    "sqrt",
    "sqr",
    "sin",
    "cos",
    "tan",
    "neg",
    "ac",
    "del",
    "angle_toggle",
];

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// 任意の打鍵列を与えても panic せず、常に表示可能な状態が返る。
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..TOKENS.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            let key = Key::from_token(TOKENS[i]).expect("token table is out of sync");
            let (next, shown) = reduce(&state, key);
            prop_assert!(!shown.main.is_empty());
            prop_assert_eq!(next.schema, STATE_SCHEMA);
            state = next;
        }
        prop_assert!(!display(&state).main.is_empty());
    }

    /// AC はどんな状態からでも初期表示に戻す。
    #[test]
    fn ac_always_recovers(indices in prop::collection::vec(0usize..TOKENS.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            state = reduce(&state, Key::from_token(TOKENS[i]).unwrap()).0;
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
