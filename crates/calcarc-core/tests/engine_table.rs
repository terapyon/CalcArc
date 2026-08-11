//! 電卓の挙動仕様。キー列を打鍵したときのメイン表示を固定する。
//!
//! このファイルの各行が仕様そのものである。挙動を変えるときは
//! まずここを変えること。

use calcarc_core::engine::display::{DisplayState, display};
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::EngineState;

/// キー列を打鍵した結果の表示を返す。
fn run(keys: &[&str]) -> DisplayState {
    let mut state = EngineState::initial();
    for token in keys {
        let key = Key::from_token(token).unwrap_or_else(|| panic!("unknown key: {token}"));
        state = reduce(&state, key).0;
    }
    display(&state)
}

fn main_of(keys: &[&str]) -> String {
    run(keys).main
}

#[test]
fn starts_at_zero() {
    assert_eq!(main_of(&[]), "0");
}

#[test]
fn accumulates_digits() {
    assert_eq!(main_of(&["3"]), "3");
    assert_eq!(main_of(&["1", "2", "3"]), "123");
}

#[test]
fn replaces_a_leading_zero() {
    assert_eq!(main_of(&["0", "5"]), "5");
    assert_eq!(main_of(&["0"]), "0");
}

#[test]
fn accepts_a_decimal_point() {
    assert_eq!(main_of(&["3", "dot", "1"]), "3.1");
    assert_eq!(main_of(&["dot", "5"]), "0.5");
}

#[test]
fn a_second_decimal_point_is_a_syntax_error() {
    assert_eq!(main_of(&["3", "dot", "dot"]), "Math ERROR");
}

#[test]
fn j_starts_an_imaginary_entry() {
    assert_eq!(main_of(&["j", "4"]), "j4");
    assert_eq!(main_of(&["j"]), "j");
}

#[test]
fn del_removes_the_last_character() {
    assert_eq!(main_of(&["3", "1", "del"]), "3");
    assert_eq!(main_of(&["3", "del"]), "0");
}

#[test]
fn ac_clears_everything() {
    assert_eq!(main_of(&["3", "1", "ac"]), "0");
}

#[test]
fn ac_recovers_from_an_error() {
    assert_eq!(main_of(&["3", "dot", "dot", "ac"]), "0");
}

#[test]
fn keys_other_than_ac_are_ignored_while_in_error() {
    assert_eq!(main_of(&["3", "dot", "dot", "5"]), "Math ERROR");
}
