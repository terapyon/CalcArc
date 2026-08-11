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
fn del_on_an_imaginary_entry_keeps_the_j() {
    // 数字だけ消える。j まで消えると、続きを打った人は自分が虚部を
    // 入力しているつもりのまま実部を入力してしまう。
    assert_eq!(main_of(&["3", "add", "j", "4", "del"]), "j");
    assert_eq!(main_of(&["3", "add", "j", "4", "del", "5", "eq"]), "3+j5");
    // もう一度押すと j も消える。
    assert_eq!(main_of(&["3", "add", "j", "4", "del", "del"]), "3");
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

#[test]
fn parentheses_override_precedence() {
    assert_eq!(
        main_of(&["2", "mul", "lparen", "3", "add", "4", "rparen", "eq"]),
        "14"
    );
    assert_eq!(
        main_of(&["lparen", "2", "add", "3", "rparen", "mul", "4", "eq"]),
        "20"
    );
}

#[test]
fn nested_parentheses() {
    assert_eq!(
        main_of(&[
            "2", "mul", "lparen", "1", "add", "lparen", "3", "mul", "4", "rparen", "rparen", "eq"
        ]),
        "26"
    );
}

#[test]
fn equals_closes_unclosed_parentheses() {
    assert_eq!(
        main_of(&["2", "mul", "lparen", "3", "add", "4", "eq"]),
        "14"
    );
}

#[test]
fn an_unmatched_closing_paren_is_a_syntax_error() {
    assert_eq!(main_of(&["rparen"]), "Math ERROR");
    assert_eq!(main_of(&["3", "add", "4", "rparen"]), "Math ERROR");
}

#[test]
fn reports_the_parenthesis_depth() {
    assert_eq!(run(&["lparen", "lparen"]).pending_depth, 2);
    assert_eq!(run(&["lparen", "1", "rparen"]).pending_depth, 0);
}

#[test]
fn the_pending_operator_shown_inside_parens_is_the_enclosing_one() {
    use calcarc_core::engine::state::BinOp;
    // `3 + (` の時点で、深さは 1 で、表示する保留演算子は外側の + とする。
    // display は開き括弧を読み飛ばして直近の演算子を探すので、括弧の中に
    // 入っても「何の計算の途中か」が見えたままになる。
    let shown = run(&["3", "add", "lparen"]);
    assert_eq!(shown.pending_depth, 1);
    assert_eq!(shown.pending_op, Some(BinOp::Add));
}

#[test]
fn parentheses_carry_complex_values() {
    assert_eq!(
        main_of(&[
            "lparen", "3", "add", "j", "4", "rparen", "mul", "lparen", "1", "add", "j", "2",
            "rparen", "eq"
        ]),
        "-5+j10"
    );
}

#[test]
fn functions_apply_immediately_to_the_displayed_value() {
    // 関数は後置。式には積まれない（設計書 D6）。
    assert_eq!(main_of(&["3", "0", "sin"]), "0.5");
    assert_eq!(main_of(&["6", "0", "cos"]), "0.5");
    assert_eq!(main_of(&["4", "5", "tan"]), "1");
    assert_eq!(main_of(&["4", "sqrt"]), "2");
    assert_eq!(main_of(&["3", "sqr"]), "9");
}

#[test]
fn square_root_of_a_negative_gives_an_imaginary_result() {
    // 従来機が Math ERROR を返す入力に、複素数対応の電卓は答えられる。
    assert_eq!(main_of(&["4", "neg", "sqrt"]), "j2");
}

#[test]
fn negation_applies_to_the_committed_value() {
    assert_eq!(main_of(&["4", "neg"]), "-4");
    assert_eq!(main_of(&["4", "neg", "neg"]), "4");
}

#[test]
fn functions_compose_with_operators() {
    assert_eq!(main_of(&["3", "add", "4", "sqrt", "eq"]), "5");
}

#[test]
fn pi_is_a_value_not_an_entry() {
    assert_eq!(main_of(&["pi"]), "3.141592654");
    assert_eq!(main_of(&["pi", "sqr"]), "9.869604401");
}

#[test]
fn the_angle_mode_toggles() {
    use calcarc_core::AngleMode;
    assert_eq!(run(&[]).angle, AngleMode::Deg);
    assert_eq!(run(&["angle_toggle"]).angle, AngleMode::Rad);
    assert_eq!(run(&["angle_toggle", "angle_toggle"]).angle, AngleMode::Deg);
}

#[test]
fn trig_follows_the_angle_mode() {
    assert_eq!(main_of(&["angle_toggle", "pi", "cos"]), "-1");
}

#[test]
fn tangent_at_a_pole_is_an_error() {
    assert_eq!(main_of(&["9", "0", "tan"]), "Math ERROR");
}

#[test]
fn the_headline_case() {
    // このスライスが成立したことを示す 1 行。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "polar_toggle"]),
        "5 ∠ 53.13010235"
    );
}

#[test]
fn the_polar_toggle_is_idempotent_in_pairs() {
    // 2 回押すと元の表示に戻る。表示の切替であって計算ではないため。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "polar_toggle", "polar_toggle"]),
        "3+j4"
    );
}

#[test]
fn the_polar_toggle_does_not_feed_rounded_values_forward() {
    // 極形式で表示すると角度は 53.13010235 に丸められるが、保持している
    // 値は 3+j4 のままなので、続く乗算は丸めの影響を受けない
    // （base-spec §26、設計書 D5）。
    assert_eq!(
        main_of(&[
            "3",
            "add",
            "j",
            "4",
            "eq",
            "polar_toggle",
            "mul",
            "lparen",
            "1",
            "add",
            "j",
            "2",
            "rparen",
            "eq",
            "polar_toggle"
        ]),
        "-5+j10"
    );
}

#[test]
fn the_polar_form_follows_the_angle_mode() {
    assert_eq!(
        main_of(&["angle_toggle", "3", "add", "j", "4", "eq", "polar_toggle"]),
        "5 ∠ 0.927295218"
    );
}

#[test]
fn the_entry_text_wins_over_the_display_form() {
    // 入力中は打鍵した通りに見せる。極形式は確定値にのみ適用する。
    assert_eq!(main_of(&["polar_toggle", "3"]), "3");
    assert_eq!(main_of(&["polar_toggle", "3", "eq"]), "3 ∠ 0");
}

#[test]
fn reports_the_display_form() {
    use calcarc_core::engine::state::DisplayForm;
    assert_eq!(run(&[]).form, DisplayForm::Rect);
    assert_eq!(run(&["polar_toggle"]).form, DisplayForm::Polar);
}

#[test]
fn overflow_becomes_an_error() {
    // 9 を繰り返し二乗すると f64 の範囲を出る。
    let mut keys = vec!["9"];
    keys.extend(std::iter::repeat_n("sqr", 10));
    assert_eq!(main_of(&keys), "Math ERROR");
}

#[test]
fn every_error_kind_reaches_the_display() {
    use calcarc_core::CalcError;
    assert_eq!(
        run(&["1", "div", "0", "eq"]).error,
        Some(CalcError::DivisionByZero)
    );
    assert_eq!(run(&["9", "0", "tan"]).error, Some(CalcError::TrigPole));
    assert_eq!(run(&["rparen"]).error, Some(CalcError::SyntaxError));
    let mut keys = vec!["9"];
    keys.extend(std::iter::repeat_n("sqr", 10));
    assert_eq!(run(&keys).error, Some(CalcError::Overflow));
}

#[test]
fn ac_restores_a_usable_calculator() {
    // エラー後に AC を押したら、保留中の演算も一緒に消える。
    assert_eq!(
        main_of(&["2", "mul", "1", "div", "0", "eq", "ac", "7", "eq"]),
        "7"
    );
}

#[test]
fn the_entry_buffer_stops_accepting_digits_at_its_limit() {
    // MAX_ENTRY_LEN は 12。超えた打鍵は無視され、エラーにはしない。
    // 打ち過ぎで電卓が止まるより、入らないほうが電卓らしい。
    let keys = vec!["7"; 20];
    let shown = run(&keys);
    assert_eq!(shown.main, "777777777777");
    assert!(shown.error.is_none());
}

#[test]
fn ac_keeps_the_user_set_modes() {
    use calcarc_core::AngleMode;
    use calcarc_core::engine::state::DisplayForm;
    let state = run(&["angle_toggle", "polar_toggle", "3", "ac"]);
    assert_eq!(state.angle, AngleMode::Rad);
    assert_eq!(state.form, DisplayForm::Polar);
}

#[test]
fn a_second_operator_replaces_the_first() {
    // 押し直しは打ち間違いの訂正。もう一度計算しろという意味ではない。
    assert_eq!(main_of(&["3", "add", "add", "4", "eq"]), "7");
    assert_eq!(main_of(&["5", "sub", "sub", "3", "eq"]), "2");
    assert_eq!(main_of(&["6", "mul", "mul", "2", "eq"]), "12");
    assert_eq!(main_of(&["3", "add", "mul", "4", "eq"]), "12");
    assert_eq!(main_of(&["3", "mul", "add", "4", "eq"]), "7");
    // 3 つ以上続けても、残るのは最後の 1 つだけ。
    assert_eq!(main_of(&["3", "add", "sub", "mul", "4", "eq"]), "12");
}

#[test]
fn a_key_that_changes_nothing_does_not_defeat_operator_replacement() {
    // 演算子を押し直す前に、何も起きないキーを挟んでも意味は変わらない。
    assert_eq!(main_of(&["3", "add", "del", "add", "4", "eq"]), "7");
    assert_eq!(
        main_of(&["3", "add", "angle_toggle", "add", "4", "eq"]),
        "7"
    );
    // polar_toggle は以後の表示形式も切り替えるので、確定値そのものは
    // 3+4=7 のまま極形式で "7 ∠ 0" になる（"the_entry_text_wins_over_
    // the_display_form" と同じ規則）。差し替えが効かず 3+3+4=10 に
    // なっていれば "10 ∠ 0" になるはずだった。
    assert_eq!(
        main_of(&["3", "add", "polar_toggle", "add", "4", "eq"]),
        "7 ∠ 0"
    );
    // 一方、実際に値が入ったら差し替えではなく通常の演算に戻る。
    assert_eq!(main_of(&["3", "add", "4", "add", "5", "eq"]), "12");
}

#[test]
fn equals_after_an_operator_repeats_the_operand() {
    // 3 + = は 3 + 3。CASIO の慣習に合わせる。演算子の押し直しとは別の話。
    assert_eq!(main_of(&["3", "add", "eq"]), "6");
}

#[test]
fn the_polar_angle_does_not_depend_on_how_a_negative_was_reached() {
    assert_eq!(main_of(&["1", "neg", "polar_toggle"]), "1 ∠ 180");
    assert_eq!(main_of(&["0", "sub", "1", "eq", "polar_toggle"]), "1 ∠ 180");
}

#[test]
fn a_zero_result_has_one_polar_angle_whatever_produced_it() {
    assert_eq!(
        main_of(&["1", "neg", "mul", "0", "eq", "polar_toggle"]),
        "0 ∠ 0"
    );
    assert_eq!(main_of(&["0", "mul", "5", "eq", "polar_toggle"]), "0 ∠ 0");
}

#[test]
fn an_error_hides_the_pending_state() {
    // エラー時点で operators には Add が残っているが、
    // Math ERROR の横に保留中の演算子を出すのは誤解を招く。
    let shown = run(&["2", "add", "1", "div", "0", "eq"]);
    assert_eq!(shown.main, "Math ERROR");
    assert_eq!(shown.pending_op, None);
    assert_eq!(shown.pending_depth, 0);
}

#[test]
fn del_removes_an_unclosed_paren() {
    // ( が入力中の 3 を捨てたうえ、閉じていない括弧だけが残る。
    // その状態を DEL で片付けられるようにする。
    assert_eq!(main_of(&["3", "lparen", "del"]), "0");
    assert_eq!(run(&["3", "lparen", "del"]).pending_depth, 0);

    // 押し間違いが綺麗に戻る。
    assert_eq!(main_of(&["3", "add", "lparen", "del", "4", "eq"]), "7");
}

#[test]
fn del_walks_the_three_tiers_in_order() {
    // 数字 → j マーカー → 開き括弧（設計書 I7）。
    assert_eq!(main_of(&["3", "add", "lparen", "j", "4", "del"]), "j");
    assert_eq!(
        run(&["3", "add", "lparen", "j", "4", "del", "del"]).pending_depth,
        1,
        "2 段目では括弧はまだ残る"
    );
    assert_eq!(
        run(&["3", "add", "lparen", "j", "4", "del", "del", "del"]).pending_depth,
        0,
        "3 段目で括弧が消える"
    );
}

#[test]
fn del_does_not_remove_an_operator() {
    use calcarc_core::engine::state::BinOp;
    // 演算子を消せるようにすると、確定済みの入力を復元する必要が生じて
    // undo になる。境界はここ。
    assert_eq!(run(&["3", "add", "del"]).pending_op, Some(BinOp::Add));

    // 括弧の内側で演算子が保留中なら、その括弧も消さない。
    assert_eq!(run(&["lparen", "3", "add", "del"]).pending_depth, 1);
}
