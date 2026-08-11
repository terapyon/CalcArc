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

#[test]
fn adds_two_numbers() {
    assert_eq!(main_of(&["3", "add", "4", "eq"]), "7");
}

#[test]
fn shows_the_left_operand_while_an_operator_is_pending() {
    assert_eq!(main_of(&["3", "add"]), "3");
}

#[test]
fn respects_operator_precedence() {
    // CASIO の代数方式。左から順の 20 ではない（設計書 D9）。
    assert_eq!(main_of(&["2", "add", "3", "mul", "4", "eq"]), "14");
}

#[test]
fn reduces_same_precedence_left_to_right() {
    // 2 つ目の + を押した時点で 2+3 が確定して 5 が表示される。
    assert_eq!(main_of(&["2", "add", "3", "add"]), "5");
    assert_eq!(main_of(&["2", "add", "3", "add", "4", "eq"]), "9");
}

#[test]
fn subtracts_and_divides() {
    assert_eq!(main_of(&["1", "0", "sub", "4", "eq"]), "6");
    assert_eq!(main_of(&["7", "div", "2", "eq"]), "3.5");
}

#[test]
fn builds_a_complex_number() {
    // 本スライスの目標入力。
    assert_eq!(main_of(&["3", "add", "j", "4", "eq"]), "3+j4");
}

#[test]
fn multiplies_a_complex_number_by_a_real() {
    // = で 3+j4 が確定したあと、その値がそのまま次の演算に入る。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "mul", "2", "eq"]),
        "6+j8"
    );
}

#[test]
fn an_operator_folds_the_pending_product_before_the_next_term_is_typed() {
    // 3+j4 = × 1 + j2 = は (3+j4)×(1+j2) にならない。
    // + を押した時点で優先順位の高い × が畳まれ、(3+j4)×1 が確定してから
    // j2 が足されるので 3+j6 になる。CASIO の代数方式として正しい挙動で、
    // 2 つの複素数の積を書くには括弧が要る（Task 8 で扱う）。
    assert_eq!(
        main_of(&[
            "3", "add", "j", "4", "eq", "mul", "1", "add", "j", "2", "eq"
        ]),
        "3+j6"
    );
}

#[test]
fn j_alone_means_one_times_j() {
    // j の直後に数字がなければ j1 と解釈する。format_rect は虚部の
    // 絶対値をそのまま整形するので "3+j1" になる（"3+j" ではない）。
    assert_eq!(main_of(&["3", "add", "j", "eq"]), "3+j1");
}

#[test]
fn division_by_zero_is_an_error() {
    assert_eq!(main_of(&["1", "div", "0", "eq"]), "Math ERROR");
}

#[test]
fn equals_without_an_operator_keeps_the_entry() {
    assert_eq!(main_of(&["3", "eq"]), "3");
}

#[test]
fn reports_the_pending_operator() {
    use calcarc_core::engine::state::BinOp;
    assert_eq!(run(&["3", "add"]).pending_op, Some(BinOp::Add));
    assert_eq!(run(&["3", "add", "4", "eq"]).pending_op, None);
}
