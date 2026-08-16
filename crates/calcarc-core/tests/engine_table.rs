//! 電卓の挙動仕様。キー列を打鍵したときのメイン表示を固定する。
//!
//! このファイルの各行が仕様そのものである。挙動を変えるときは
//! まずここを変えること。

use calcarc_core::{DisplayState, EngineState, Key, reduce, render};

/// キー列を打鍵した結果の表示を返す。
fn run(keys: &[&str]) -> DisplayState {
    let mut state = EngineState::initial();
    for token in keys {
        let key = Key::from_token(token).unwrap_or_else(|| panic!("unknown key: {token}"));
        state = reduce(&state, key).0;
    }
    render(&state)
}

fn main_of(keys: &[&str]) -> String {
    run(keys).main
}

/// 上部のエコー行。保留中の式を見せる(設計書 §4)。
fn echo_of(keys: &[&str]) -> String {
    run(keys).echo
}

#[test]
fn the_echo_shows_the_pending_expression() {
    // 設計書 §4: 保留中の式を状態から導出する。打鍵履歴は持たない。
    assert_eq!(echo_of(&["3", "add"]), "3 +");
    assert_eq!(echo_of(&["3", "add", "4", "mul"]), "3 + 4 ×");
    assert_eq!(echo_of(&["3", "add", "lparen", "4"]), "3 + ( 4");
    assert_eq!(echo_of(&["j", "4", "mul"]), "j4 ×");
    // = で確定するとスタックが空になり、echo も空になる。
    assert_eq!(echo_of(&["3", "add", "4", "eq"]), "");
    // 保留式が無いあいだは空(main が値を見せている)。
    assert_eq!(echo_of(&["1", "dot", "5", "exp", "3"]), "");
    // 畳まれたものは畳まれた姿で見える(設計書 §4 の制限)。
    assert_eq!(echo_of(&["3", "0", "sin", "add"]), "0.5 +");
    assert_eq!(echo_of(&["2", "mul", "3", "add"]), "6 +");
    // エラー中は保留を伏せる(pending_op と同じ扱い)。
    assert_eq!(echo_of(&["1", "div", "0", "eq"]), "");
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
fn j_after_digits_turns_the_entry_imaginary() {
    // 設計書 §1: 数字があれば j は実部と虚部を切り替える。
    assert_eq!(main_of(&["3", "j"]), "j3");
    assert_eq!(main_of(&["3", "j", "j"]), "3");
    assert_eq!(main_of(&["3", "j", "4"]), "j34");
    assert_eq!(main_of(&["3", "dot", "5", "j"]), "j3.5");
    // 数字が無い j は従来どおり新しい虚部入力を開始する。
    assert_eq!(main_of(&["j", "j", "4"]), "j4");
    // DEL の段構成は変わらない(数字だけ消え、j マーカーが残る)。
    assert_eq!(main_of(&["3", "j", "del"]), "j");
    assert_eq!(main_of(&["3", "j", "del", "del"]), "0");
    // 式の中でも同じ。
    assert_eq!(main_of(&["3", "add", "4", "j", "eq"]), "3+j4");
    assert_eq!(main_of(&["3", "j", "add", "2", "j", "eq"]), "j5");
}

#[test]
fn exp_enters_an_exponent() {
    // 設計書 §2。1.5 Exp 3 = 1500。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3"]), "1.5e3");
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "eq"]), "1,500");
    // 仮数なしの Exp は仮数 1。表示にも 1 が出る(空の "e3" にはしない)。
    assert_eq!(main_of(&["exp", "3"]), "1e3");
    assert_eq!(main_of(&["exp", "3", "eq"]), "1,000");
    // 連打は無視。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "exp"]), "1.5e");
    // 指数は整数。小数点は無視する。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "dot"]), "1.5e3");
    // 指数は 3 桁で頭打ち(4 桁目は無視)。
    assert_eq!(main_of(&["1", "exp", "3", "0", "9", "9"]), "1e309");
    // 先頭ゼロは仮数と同じ規則。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "0", "0", "3"]), "1.5e3");
    // 指数入力中でも後置 j は効く(設計書 §1 の表の最後の行)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "j"]), "j1.5e3");
}

#[test]
fn the_sign_key_follows_the_exponent_while_one_is_open() {
    // 設計書 §2: 指数入力中は指数の符号、それ以外は確定値の符号。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "neg"]), "1.5e-3");
    assert_eq!(
        main_of(&["1", "dot", "5", "exp", "3", "neg", "neg"]),
        "1.5e3"
    );
    // 桁が無くても押せる。順序を変えても同じ値になる。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "neg", "3"]), "1.5e-3");
    // Exp 中でなければ従来どおり確定値の符号。
    assert_eq!(main_of(&["4", "neg"]), "-4");
}

#[test]
fn del_walks_out_of_the_exponent_one_stage_at_a_time() {
    // 段は 指数の桁 → e マーカー → 仮数の文字(設計書 §2)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "del"]), "1.5e");
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "del", "del"]), "1.5");
    assert_eq!(
        main_of(&["1", "dot", "5", "exp", "3", "del", "del", "del"]),
        "1."
    );
}

#[test]
fn an_exponent_out_of_range_is_an_error_when_it_is_committed() {
    // 打鍵の途中はエラーにしない。値になる瞬間に Overflow(設計書 §2)。
    assert_eq!(main_of(&["1", "exp", "3", "0", "9"]), "1e309");
    assert_eq!(main_of(&["1", "exp", "3", "0", "9", "eq"]), "Math ERROR");
}

#[test]
fn the_triple_zero_key_adds_three_zeros_at_most() {
    // 設計書 §3。押した回数と消える回数が食い違わないよう、Digit(0) の
    // 3 連ではなく 1 打鍵として扱う。
    assert_eq!(main_of(&["1", "zeros3"]), "1000");
    // 先頭ゼロは増えない(現行の規則をそのまま適用)。
    assert_eq!(main_of(&["zeros3"]), "0");
    assert_eq!(main_of(&["0", "zeros3"]), "0");
    // 残り字数に収まるぶんだけ入る(MAX_ENTRY_LEN は 12)。
    assert_eq!(
        main_of(&["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "zeros3"]),
        "123456789000"
    );
    // DEL は 1 文字ずつ。
    assert_eq!(main_of(&["1", "zeros3", "del"]), "100");
    // 指数入力中は指数へ入る(3 桁上限、先頭ゼロ規則も同じ)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "zeros3"]), "1.5e0");
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
fn square_root_of_a_negative_is_a_domain_error() {
    // 関数は実数に閉じる（設計書 §1 の裁定 1）。複素数は入力と四則と
    // 表示の機能であって、関数の値域ではない。
    assert_eq!(main_of(&["4", "neg", "sqrt"]), "Math ERROR");
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
fn del_returns_to_the_pending_operator() {
    // DEL が実際に何かを消して「演算子の直後」に戻ったなら、次に押した
    // 演算子は差し替えでなければならない。加算だけで書くと差が出ない
    // （3+3+4 も 3+4 も 7）ので、乗算で固定する。この穴が表から見えて
    // いなかったのは、DEL の行が加算経路しか持っていなかったためである。
    assert_eq!(
        main_of(&["3", "mul", "lparen", "del", "mul", "4", "eq"]),
        "12"
    );
    assert_eq!(main_of(&["3", "mul", "4", "del", "mul", "5", "eq"]), "15");
    assert_eq!(main_of(&["3", "mul", "j", "del", "mul", "5", "eq"]), "15");
    // 数字を続けたときは従来どおり。
    assert_eq!(main_of(&["3", "mul", "lparen", "del", "4", "eq"]), "12");
    assert_eq!(
        main_of(&["3", "add", "lparen", "del", "add", "4", "eq"]),
        "7"
    );
}

#[test]
fn del_does_not_restore_the_value_a_paren_discarded() {
    // `(` は入力中の値を捨てて current を 0 にする。DEL は括弧を消すが
    // 0 は戻さない。したがって押し間違いが綺麗に戻るのは、続けて打つのが
    // 数字のときと、加法の単位元 0 が答えを変えない `+` `−` のときだけで、
    // `×` `=` では 0 が残る。DEL は undo ではないという境界（設計書 §4）が
    // ここに出る。
    assert_eq!(main_of(&["3", "mul", "lparen", "del", "eq"]), "0");
    assert_eq!(main_of(&["3", "add", "lparen", "del", "eq"]), "3");
}

#[test]
fn del_after_a_closing_paren_does_not_fake_a_pending_operator() {
    // `)` の直後は「演算子の直後」ではない。入力した 5 を DEL で消しても
    // 戻るのはそこであって、次の `+` は差し替えではなく通常の演算になる。
    //
    // この形は状態だけを見ると `3 + 4 DEL` と区別がつかない。どちらも
    // バッファが消えて演算子スタックの先頭が `+` になる。だから
    // operator_pending は DEL 後の状態から導き直すのではなく、DEL が
    // 落とさないもの（引き継ぐ事実）として扱う。
    assert_eq!(
        main_of(&[
            "3", "add", "lparen", "4", "rparen", "5", "del", "add", "6", "eq"
        ]),
        "13"
    );
    assert_eq!(
        main_of(&["3", "add", "lparen", "4", "rparen", "del", "add", "5", "eq"]),
        "12"
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

#[test]
fn eng_turns_the_answer_into_engineering_notation() {
    // 1000 を作って ENG を押す。もう一度押すと戻る(設計書 §1 の裁定 1)。
    assert_eq!(main_of(&["1", "0", "0", "0", "eq"]), "1,000");
    assert_eq!(main_of(&["1", "0", "0", "0", "eq", "eng"]), "1e3");
    assert_eq!(main_of(&["1", "0", "0", "0", "eq", "eng", "eng"]), "1,000");
}

#[test]
fn eng_stays_on_for_the_next_answer() {
    // **モードとして残る**——一度押したら以後の計算結果も ENG で出る。
    assert_eq!(main_of(&["eng", "1", "2", "3", "4", "5", "eq"]), "12.345e3");
}

#[test]
fn eng_does_not_touch_what_you_are_typing() {
    // 入力中は buffer.text() の経路で、format_real を通らない(設計書 §3.2)。
    // ENG に入れても打っている数字はそのまま見える。
    //
    // **数字を打ってから eng を押すこと。** 逆順だと commit_entry を足す変異が
    // 空バッファへの no-op になり、この検査は緑のまま何も主張しない。
    assert_eq!(main_of(&["1", "2", "3", "4", "5", "eng"]), "12345");
    // ENG を先に入れてから打っても同じ(モードは入力中の表示に効かない)。
    assert_eq!(main_of(&["eng", "1", "2", "3", "4", "5"]), "12345");
}

#[test]
fn eng_reaches_the_pending_expression_too() {
    // 保留中の式(echo)と答(main)が同じ画面に出るので、表記が食い違うと読めない。
    // 設計書 §6 は main しか論じていなかった。
    // 1000 を確定して ENG に入れ、演算子を押して保留を作る。
    let shown = run(&["1", "0", "0", "0", "eq", "eng", "add"]);
    assert_eq!(shown.main, "1e3");
    assert_eq!(shown.echo, "1e3 +");
}
