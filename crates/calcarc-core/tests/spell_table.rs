//! **綴りの仕様書。** キー列と式の文字列の対応を、ここが固定する。
//!
//! `engine_table.rs` が「キー列と**表示**」を固定しているのと同じ形である
//! ——あちらは電卓の挙動、こちらは履歴に残す綴りである。
//!
//! **golden は置かない。** 綴りは「盤面のキーが何と書いてあるか」という
//! 取り決めであって数学ではないので、`reference/` の Python が別手順で
//! 同じ文字列に到達する道が無い(書けば写しになる)。**表がこれの番人である。**
//!
//! **番人はもう 1 つある**——手で並べたこの表のほかに、`spell_differential.rs`
//! が長さ 5 までの全列と入力に寄せた乱択で「バッファが開いているあいだ、綴りは
//! engine の表示で終わり、その直前は空白か `(` か行頭である」(不変条件 A′)を見ており、
//! **A′ が構造上見られない行**(途中に取り残された語と、末尾に届かない記号のずれ)を
//! 持つのはこの表である。
//!
//! **関数の書き方**(1.2.1、設計書 `2026-10-04-function-notation-design.md`)の行は
//! 下の後半に置いた——`sin(30)`・`30²`・`−3`・`(2 + 3)`・`2 ^ 3`。**画面の値**
//! (関数が演算子や `(` の直後に押されたときに、engine が実際にかけた値)は、
//! `spell_of` が engine を歩いて各キーの直前の `render(...).main` を積み、
//! `spell_line` に渡す(本番の web と同じ形。設計書 §2.7.1)。
//!
//! **入力中の数の綴りは engine の表示と 1 文字も違ってはならない。**
//! `spell` は `engine/state.rs` の `Buffer` そのものを歩かせ、値の部分を
//! `Buffer::text()` で綴る。**「同じコードだから食い違わない」は構造の
//! 主張であって検証ではない**ので、下の `assert_entry` は毎回 engine を
//! 実際に走らせて `render(...).main` と綴りの両方を突き合わせる
//! ——片方だけが動いたら赤くなる。

use calcarc_core::{
    EngineState, Key,
    engine::{
        refuses,
        spell::{spell, spell_line},
    },
    reduce, render,
};

/// キー列を綴る。**各キーの直前の画面(`render(...).main`)を engine を歩いて積み、
/// `spell_line` に添える**——本番の web がそうしている(設計書 §2.7.1 の案 P)。
/// 拒まれたキーもそのまま渡す(この表は `spell` 自身の振る舞いを見る。拒みを通すのは
/// 下の `accepted`)。
fn spell_of(tokens: &[&str]) -> String {
    spell_from(EngineState::initial(), None, tokens)
}

/// `state` から `tokens` を打ったときの綴り。`carry` は行の頭に置く前の答え。
fn spell_from(mut state: EngineState, carry: Option<&str>, tokens: &[&str]) -> String {
    let mut keys = Vec::new();
    let mut screens = Vec::new();
    for token in tokens {
        let key = Key::from_token(token).expect("unknown token in the table");
        screens.push(render(&state).main);
        state = reduce(&state, key).0;
        keys.push(key);
    }
    let screens: Vec<&str> = screens.iter().map(String::as_str).collect();
    spell_line(carry, &keys, &screens)
}

/// **`=` をまたぐ行**(設計書 §2.5)。`before` を engine に打ち(`=` で終わる)、
/// その答えの `main` を前の答えとして頭に置き、`after` を綴る。web が `=` で打鍵の列を
/// 切り、次の区間の頭に答えを置くのと同じ形である。
fn spell_after(before: &[&str], after: &[&str]) -> String {
    let mut state = EngineState::initial();
    for token in before {
        let key = Key::from_token(token).expect("unknown token in the table");
        state = reduce(&state, key).0;
    }
    let carry = render(&state).main;
    spell_from(state, Some(&carry), after)
}

/// 画面の列を添えない綴り(`spell(keys)`)。
fn bare(tokens: &[&str]) -> String {
    let keys: Vec<Key> = tokens
        .iter()
        .map(|t| Key::from_token(t).expect("unknown token in the table"))
        .collect();
    spell(&keys)
}

/// 行を全部当ててから、外れた行をまとめて報告する(1 行目で止まらない)。
fn rows(table: &[(&[&str], &str)]) {
    let wrong: Vec<String> = table
        .iter()
        .filter_map(|(tokens, expected)| {
            let got = spell_of(tokens);
            (got != *expected).then(|| format!("  {tokens:?} → {got:?}(表は {expected:?})"))
        })
        .collect();
    assert!(wrong.is_empty(), "綴りが表と違う行:\n{}", wrong.join("\n"));
}

/// engine が受け付けたキーだけの列。**web は拒まれたキーを打鍵の列に積まない**
/// (ScientificPanel、0.9.2 設計書 §3.3 の条件 1)ので、綴りに渡るのはこの列である。
fn accepted(tokens: &[&str]) -> Vec<Key> {
    let mut state = EngineState::initial();
    let mut keys = Vec::new();
    for token in tokens {
        let key = Key::from_token(token).unwrap_or_else(|| panic!("unknown key: {token}"));
        if refuses(&state, key) {
            continue;
        }
        state = reduce(&state, key).0;
        keys.push(key);
    }
    keys
}

/// 同じキー列を **engine に通した**ときのメイン表示。
///
/// `engine_table.rs` の `main_of` と同じ手順である。ここで再実装するのは、
/// あちらが「電卓の挙動」を固定する表で、こちらが「綴り」を固定する表だから
/// ——**2 つの表が同じ数を別々に見て、同じ答に着くこと**が要点である。
fn main_of(tokens: &[&str]) -> String {
    let mut state = EngineState::initial();
    for token in tokens {
        let key = Key::from_token(token).expect("unknown token in the table");
        state = reduce(&state, key).0;
    }
    render(&state).main
}

/// **数を 1 つ打っている途中**のキー列について、engine の表示と綴りが
/// 同じ文字列であることを主張する。
///
/// 入力中は `render` が `buffer.text()` をそのまま返す(`display.rs`)ので、
/// この 2 つが食い違うことは「式が自分の答を生まない履歴」がまた 1 件
/// できたということである。**期待値は自分の推論からではなく engine から
/// 取る**——だから両方をこの 1 つの文字列に当てる。
fn assert_entry(tokens: &[&str], expected: &str) {
    assert_eq!(main_of(tokens), expected, "engine の表示が違う: {tokens:?}");
    assert_eq!(spell_of(tokens), expected, "綴りが違う: {tokens:?}");
}

#[test]
fn digits_run_together_and_operators_get_a_space() {
    assert_eq!(spell_of(&["3", "0", "sin"]), "sin(30)");
    assert_eq!(spell_of(&["2", "mul", "3", "add", "4"]), "2 × 3 + 4");
    assert_eq!(spell_of(&["1", "dot", "5"]), "1.5");
    assert_eq!(spell_of(&["1", "zeros3"]), "1000");
}

#[test]
fn unary_functions_are_written_the_mathematical_way() {
    // `["4","sqrt"]` は 2 を出す(engine_table.rs)。**キーは後置で押すが、書き方は
    // 数学の慣例**(1.2.1、利用者の裁定 2026-10-04)——前置の関数は `f(…)`、記号は後ろに付く。
    assert_eq!(spell_of(&["4", "sqrt"]), "√(4)");
    assert_eq!(spell_of(&["2", "sqr"]), "2²");
    assert_eq!(spell_of(&["5", "n_fact"]), "5!");
}

#[test]
fn parentheses_are_spelled_as_typed_even_when_unbalanced() {
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "3", "add", "4", "rparen"]),
        "2 × (3 + 4)"
    );
    // **括弧の内側に空白を入れない**(裁定 2、設計書 §2.6)。閉じていなくても同じ。
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "3", "add", "4"]),
        "2 × (3 + 4"
    );
}

#[test]
fn mode_keys_never_spell() {
    // 表示だけを変える 3 つは綴りに何も残さない。**角度モードは 1 件が
    // 別の欄に持つ**(`dms` は表示トグルと 60 進の区切りの 2 役があるので
    // 別のテスト(`dms_marks_a_segment_boundary_while_entering_a_number`)
    // に分けてある——常に無音の 3 つとは条件が違う)。
    assert_eq!(spell_of(&["3", "0", "angle_toggle", "sin"]), "sin(30)");
    assert_eq!(spell_of(&["3", "eng"]), "3");
    assert_eq!(spell_of(&["3", "polar_toggle"]), "3");
    // `eq` は列を閉じるだけで、綴りに現れない。
    assert_eq!(spell_of(&["3", "add", "4", "eq"]), "3 + 4");
}

#[test]
fn the_mantissa_stops_at_the_entry_limit_exactly_where_the_engine_stops() {
    // `MAX_ENTRY_LEN` は 12(`engine/state.rs`)。13 個目の `1` は
    // `Buffer::push_digit` が黙って捨てる。**綴りが 13 文字のままだと、
    // 履歴の式は engine が受け付けない数を語ることになる。**
    let thirteen_ones = ["1"; 13];
    assert_entry(&thirteen_ones, "111111111111");

    // 上限で止まったあとの `del` は、実際に入った 12 文字から 1 つ消す。
    let thirteen_then_del = [
        "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "del",
    ];
    assert_entry(&thirteen_then_del, "11111111111");

    // 上限では `.` も落ちる(`push_dot` の `digits.len() >= MAX_ENTRY_LEN`)。
    // **`.` が落ちれば続く `5` も仮数へは入らない**——上限のままである。
    let twelve_then_dot_five = [
        "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "dot", "5",
    ];
    assert_entry(&twelve_then_dot_five, "111111111111");

    // `000` は 1 打鍵で 3 回 `push_digit(0)` する。上限を跨ぐと入るぶん
    // だけ入る(設計書 §3)——10 文字から 2 文字だけ足されて 12 で止まる。
    let ten_ones_then_zeros3 = ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "zeros3"];
    assert_entry(&ten_ones_then_zeros3, "111111111100");
}

#[test]
fn the_exponent_follows_the_buffers_own_rules() {
    // 指数は 3 桁まで(`MAX_EXPONENT_LEN`)。4 桁目は黙って落ちる。
    assert_entry(&["1", "exp", "1", "2", "3", "4"], "1e123");

    // **H-2。** 指数入力中の `+/−` は指数の符号を反転する(設計書 §2)。
    // 綴りは `Buffer::text()` が出す `e-` をそのまま持つ——ここを落として
    // いたので、`1.5e-3` の履歴が `1.5e3`(1e6 倍違う数)を語っていた。
    assert_entry(&["1", "dot", "5", "exp", "3", "neg"], "1.5e-3");

    // 指数は整数。`.` は `push_dot` が早く戻って何も起きない。
    assert_entry(&["1", "exp", "2", "dot", "3"], "1e23");

    // `Exp` の連打は無視(`push_exponent` の `get_or_insert_with`)。
    assert_entry(&["1", "exp", "exp", "3"], "1e3");

    // 60 進入力中の `Exp` も無視(`push_exponent` の `sexagesimal` 判定)。
    // **打った `5` は 60 進の段のほうへ入る。**
    assert_entry(&["1", "dms", "3", "0", "exp", "5"], "1°305");

    // 仮数を打たずに `Exp` を押したら仮数は 1(`Buffer::text` / `value`)。
    assert_entry(&["exp", "3"], "1e3");
}

#[test]
fn a_leading_zero_is_replaced_and_a_bare_dot_gets_one() {
    // `"0" -> "5"` であって `"05"` ではない(`push_digit`)。
    // engine_table.rs の `replaces_a_leading_zero` と同じ規則である。
    assert_entry(&["0", "5"], "5");
    assert_entry(&["0"], "0");
    // **指数でも同じ規則が効く**(`push_digit` の指数側の枝)。
    assert_entry(&["1", "exp", "0", "5"], "1e5");
    // 何も打たずに `.` を押すと `0` が補われる(`push_dot`)。
    assert_entry(&["dot", "5"], "0.5");
    assert_entry(&["dot"], "0.");
}

#[test]
fn dms_marks_a_segment_boundary_while_entering_a_number() {
    // **Fix round 3 finding 12。** `engine/mod.rs` の `Key::Dms`:
    // `buffer` が Some(入力中)なら 60 進の区切りとして働き(`Buffer::
    // try_push_sexagesimal_separator`)、そうでなければ表示の一時トグルで
    // 値には触れない。
    //
    // **印は `Buffer::text()` が使う `°` そのもの**である。表示層が進める
    // `°′″` の段は綴らない——`text()` が段を `°` で繋ぐので、綴りは
    // 入力中の表示と 1 文字も違わない。
    assert_entry(&["1", "dms", "3", "0"], "1°30");
    assert_entry(&["1", "dms", "3", "0", "dms", "0"], "1°30°0");
    // **3 段目までで打ち止め**(度・分・秒)。`try_push_sexagesimal_separator`
    // が `sexagesimal.len() >= 2` で断るので、3 回目の `dms` は engine 側でも
    // 完全な無音になる——見た目にも足さない。
    assert_entry(&["1", "dms", "3", "0", "dms", "0", "dms"], "1°30°0");
    // 何も打っていない状態の `dms` は表示トグルで、値に触れない(無音)。
    assert_eq!(spell_of(&["dms"]), "");
    // 後置関数の直後(buffer は None)の `dms` も無音。
    assert_eq!(spell_of(&["3", "sin", "dms"]), "sin(3)");
    // `del` は区切りも数字と同じ 1 打鍵として、1 段ずつ戻る。
    assert_entry(&["1", "dms", "3", "0", "del"], "1°3");
    // 4 回で入力そのものが尽きる。engine 側では `buffer` が消えて `current`
    // (0)が出るので、ここだけは engine の表示と対にできない——**綴りは
    // 打鍵の記録であって、確定値の表示ではない。**
    assert_eq!(
        spell_of(&["1", "dms", "3", "0", "del", "del", "del", "del"]),
        ""
    );
}

#[test]
fn del_is_one_character_on_a_digit_run_and_ac_empties_the_line() {
    // engine_table.rs:178 が `["3","add","j","4","del","5","eq"]` を
    // `3+5j` にしている。**綴りも同じ数の打鍵を落とす。**
    // `j` の位置は `Buffer::text()` が決める——虚部は数字の**後ろ**に付く
    // (engine が入力中に見せている姿と同じ)。
    assert_eq!(spell_of(&["3", "add", "j", "4", "del", "5"]), "3 + 5j");
    assert_entry(&["1", "2", "del"], "1");
    assert_eq!(spell_of(&["1", "2", "del", "del"]), "");
    // 空の列に `del` を打っても壊れない。**core は panic しない。**
    assert_eq!(spell_of(&["del"]), "");
    assert_eq!(spell_of(&["1", "add", "2", "ac", "9"]), "9");
    // **`del` は 1 段である。** engine_table.rs:168 が
    // `main_of(&["1","zeros3","del"]) == "100"` を固定しているので、
    // 綴りがここでずれると**式が自分の答を生まない 1 件**ができる。
    assert_entry(&["1", "zeros3", "del"], "100");
    assert_entry(&["1", "zeros3", "del", "del", "del"], "1");
    assert_entry(&["1", "dot", "5", "del"], "1.");
    // `delete_one`(engine/mod.rs)は buffer が None のとき、先頭の開き括弧
    // 以外は何も消さない——演算子も後置関数も残る。**綴りも同じでなければ
    // ならない**: そうでないと `3 + DEL 4 =` が engine では 7 を計算するのに
    // 綴りは `34` を記録し、「34 = 7」という自分の答えを生まない式ができる。
    assert_eq!(spell_of(&["3", "add", "del", "4"]), "3 + 4");
    // 後置関数も同様——`del` は演算子でも関数でもない、数字だけを消す。
    assert_eq!(spell_of(&["4", "sqrt", "del"]), "√(4)");
    // 唯一の例外は開き括弧(`delete_one` の「先頭の開き括弧だけ」)。
    assert_eq!(spell_of(&["2", "mul", "lparen", "del"]), "2 ×");
}

#[test]
fn del_walks_the_exact_stages_the_real_engine_walks() {
    // **もう「同じ段を書き写す」ことはしない。** `spell` は本物の
    // `Buffer` を歩かせ、`Buffer::backspace` をそのまま呼ぶ。ここは
    // `crates/calcarc-core/tests/engine_table.rs` が固定している DEL の
    // 行のうち、値へ続くものを直接なぞる。

    // engine_table.rs:177,180
    // (`j` は数字が尽きても残り、もう 1 回の del で消える)。
    assert_eq!(spell_of(&["3", "add", "j", "4", "del"]), "3 + j");
    assert_eq!(spell_of(&["3", "add", "j", "4", "del", "del"]), "3 +");

    // engine_table.rs:139-142
    // (指数の段: 桁 → `Exp` マーカー → 仮数の文字、の順)。**マーカーだけ
    // が残った姿は `text()` が `1.5e` と綴る**——engine の表示と同じである。
    assert_entry(&["1", "dot", "5", "exp", "3", "del"], "1.5e");
    assert_entry(&["1", "dot", "5", "exp", "3", "del", "del"], "1.5");
    assert_entry(&["1", "dot", "5", "exp", "3", "del", "del", "del"], "1.");

    // engine_table.rs:892
    // (`del` が j 入力をまるごと消したあと、次の `mul` は差し替え(訂正)。
    // 綴りは最後の 1 つだけを残す(0.9.2 設計書 §9 の 9)。答は 15)。
    assert_eq!(
        spell_of(&["3", "mul", "j", "del", "mul", "5", "eq"]),
        "3 × 5"
    );

    // engine_table.rs:870,875
    // (del の三段——数字 → j マーカー → 開き括弧——のうち、最初の 2 回
    // では括弧はまだ残り、3 回目で消える)。
    assert_eq!(
        spell_of(&["3", "add", "lparen", "j", "4", "del", "del"]),
        "3 + ("
    );
    assert_eq!(
        spell_of(&["3", "add", "lparen", "j", "4", "del", "del", "del"]),
        "3 +"
    );

    // engine_table.rs:806
    // (del は演算子を消さない。2 度目の `+` は打ち直し(訂正)。綴りは最後の
    // 1 つだけを残す(0.9.2 設計書 §9 の 9)。答は 7)。
    assert_eq!(spell_of(&["3", "add", "del", "add", "4", "eq"]), "3 + 4");
}

#[test]
fn a_refused_key_never_reaches_the_spelling() {
    // 打ちかけの数のあとの `(`・`π`・`e` は数を捨てるので押せない(0.9.2 設計書 §3.2)。
    // 拒まれたキーは打鍵の列に来ないので、綴りにも出ない。
    assert_eq!(spell(&accepted(&["3", "lparen", "del"])), "");
    assert_eq!(spell(&accepted(&["3", "pi"])), "3");
    assert_eq!(spell(&accepted(&["3", "e"])), "3");
    assert_eq!(
        spell(&accepted(&["lparen", "3", "add", "4", "rparen", "5"])),
        "(3 + 4)"
    );
}

#[test]
fn del_after_lparen_returns_to_the_operator() {
    // `(` を DEL で消すと、engine は `(` の前へ戻る(0.9.2 設計書 §9 の 2。
    // engine_table の `del_on_a_fresh_paren_returns_to_the_operator_before_it`)。
    // 綴りは「3 ×」「3 +」のままで、答え 9・6 をそのまま説明する——以前ここにあった
    // 「既知の穴」は閉じた。
    assert_eq!(spell_of(&["3", "mul", "lparen", "del"]), "3 ×");
    assert_eq!(spell_of(&["3", "add", "lparen", "del"]), "3 +");
}

#[test]
fn a_corrected_operator_is_spelled_once() {
    // 押し直しは訂正であって計算ではない(engine_table の `a_second_operator_replaces_the_first`)。
    // 綴りも最後の 1 つだけを残す(0.9.2 設計書 §9 の 9、利用者の裁定)。以前は
    // 同じ演算子も違う演算子も両方並べていた(実測: `3 + + 4` → 「3 + + 4」)。
    assert_eq!(spell_of(&["3", "add", "add", "4"]), "3 + 4");
    assert_eq!(spell_of(&["3", "mul", "mul", "4"]), "3 × 4");
    assert_eq!(spell_of(&["3", "add", "mul", "4"]), "3 × 4");
    assert_eq!(spell_of(&["3", "add", "sub", "mul", "4"]), "3 × 4");
    assert_eq!(spell_of(&["2", "add", "3", "add", "mul", "4"]), "2 + 3 × 4");
    // DEL で演算子の直後に戻ってからの押し直しも訂正(engine と同じ)。
    assert_eq!(spell_of(&["3", "mul", "4", "del", "add", "5"]), "3 + 5");
    assert_eq!(
        spell_of(&["3", "mul", "lparen", "del", "add", "4"]),
        "3 + 4"
    );
    // 開き括弧の直後の演算子は訂正ではない(engine も差し替えない)。
    // **括弧の空白を無くした副作用**(設計書 §2.6): `(` の直後の演算子は `(+ 4` と付く。
    // engine は `0 + 4` と読む(engine_table の
    // `an_operator_right_after_an_open_paren_takes_zero_as_its_left_operand`)。
    assert_eq!(spell_of(&["3", "mul", "lparen", "add", "4"]), "3 × (+ 4");
    // `=` のあとの演算子は訂正ではない(engine の `finish` が `+` を使い切っている)。
    // 綴りは打った通りのまま。web は `=` で列を切るので、この形は画面からは来ない。
    assert_eq!(spell_of(&["3", "add", "eq", "mul", "5"]), "3 + × 5");
}

#[test]
fn every_key_spells_or_is_one_of_the_seven() {
    // **一覧から漏れたキーは黙って空文字になる。** ここが数える。
    let silent = [
        "eq",
        "ac",
        "del",
        "angle_toggle",
        "eng",
        "polar_toggle",
        "dms",
    ];
    let mut spelled = 0;
    for key in Key::ALL {
        let token = key.token();
        if silent.contains(&token) {
            continue;
        }
        assert!(
            !spell(&[key]).is_empty(),
            "{token} spells to nothing, and it is not one of the seven silent keys"
        );
        spelled += 1;
    }
    assert_eq!(spelled, Key::ALL.len() - silent.len());
    assert_eq!(spelled, 39);
}

#[test]
fn del_on_a_paren_under_a_value_spells_what_the_engine_computes() {
    // 利用者の裁定(2026-09-16、0.9.2 設計書 §10): 綴りの DEL は engine の `delete_one` と
    // 同じ `(`——保留のいちばん上の、閉じていない `(`——を消す。以前は末尾の `(` しか消さず、
    // 値や閉じた組の下の `(` が綴りに残って、履歴の式が答えを生まなかった。
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "pi", "del", "add", "1"]),
        "2 × π + 1"
    );
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "4", "sqrt", "del", "add", "1"]),
        "2 × √(4) + 1"
    );
    // **★ 0.9.3 で変わった 2 行**(利用者の裁定 2026-09-17、設計書 §4.2)。
    // **閉じた組のあとの DEL は、その `)` を取り消す**ので、綴りからも `)` が消える
    // ——engine が「`)` を押す直前の状態」へ戻るのと同じ形である
    // (engine_table: `del_after_a_closed_group_reopens_that_group`)。
    assert_eq!(
        spell_of(&[
            "2", "mul", "lparen", "lparen", "3", "rparen", "del", "add", "1"
        ]),
        "2 × ((3 + 1"
    );
    // **値は変わっていない**(`3 + ( 4 ) DEL + 5 =` は 0.9.2 でも 0.9.3 でも 12)。
    // **変わったのは綴りだけ**である——0.9.2 では「DEL は何も消さない」で `)` が残り、
    // 0.9.3 では `)` が取り消されて組が開いたままになる。
    assert_eq!(
        spell_of(&["3", "add", "lparen", "4", "rparen", "del", "add", "5"]),
        "3 + (4 + 5"
    );
    // `+/−` で手元にある値の上の `(` も、engine の DEL は消す(calcarc-1e の検算で見つかった族)。
    // 綴りも同じ `(` を消す——`( 3 +/− DEL )` は engine が SyntaxError、綴りも開いていない `)` になる。
    // **括弧の空白を無くした副作用**(設計書 §2.6)で、`)` は `−3` に付く。
    // **この族は網ではなくこの行が守る**: `engine_values.rs` の網に `+/−` を足すと、Task 4 の
    // 独立の評価器に新しい規則を教えることになる(engine_table の
    // `del_after_a_closed_group_removes_the_unclosed_paren_before_it` が engine 側を固定する)。
    assert_eq!(spell_of(&["lparen", "3", "neg", "del", "rparen"]), "−3)");
    // 2 × (−3) + 1 = −5。engine も同じ(`2 × ( 3 +/− DEL + 1 =` → −5)。
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "3", "neg", "del", "add", "1"]),
        "2 × −3 + 1"
    );
}

// ---------------------------------------------------------------------------
// **関数の書き方**(1.2.1、設計書 `2026-10-04-function-notation-design.md`)。
// 行は設計書 §3 の表をそのまま写した。**表と engine の印字が食い違えば engine が勝つ**。
// ---------------------------------------------------------------------------

#[test]
fn keys_and_spellings_from_the_design_table() {
    // 設計書 §3.1。
    rows(&[
        (&["3", "0", "sin"], "sin(30)"),
        (&["2", "add", "3", "0", "sin"], "2 + sin(30)"),
        // **組の括弧を関数の括弧として使う**(二重にしない)。
        (&["lparen", "2", "add", "3", "rparen", "sin"], "sin(2 + 3)"),
        (&["lparen", "2", "add", "3", "rparen", "sqr"], "(2 + 3)²"),
        (&["3", "0", "sqr", "sin"], "sin(30²)"),
        (&["3", "0", "sin", "sin"], "sin(sin(30))"),
        // **例外は作らない**(裁定 5)——関数の結果も「そのほか」なので包む。
        (&["3", "0", "sin", "sqr"], "(sin(30))²"),
        (&["3", "neg"], "−3"),
        (&["3", "neg", "neg"], "−(−3)"),
        // `−3²` は −9 と読めるので包む。
        (&["3", "neg", "sqr"], "(−3)²"),
        // 指数入力中の `+/−` は指数の符号(`Buffer` の中)。指数表記は原子ではない。
        (&["1", "dot", "5", "exp", "3", "neg", "exp_e"], "e^(1.5e-3)"),
        (&["pi", "sin"], "sin(π)"),
        (&["e", "sqr"], "e²"),
        // 60 進は原子ではない。`Buffer::text()` は段を `°` で繋ぐ。
        (&["3", "0", "dms", "1", "5", "sin"], "sin(30°15)"),
        (&["3", "j", "sqr"], "(3j)²"),
        // **`^` の左が「そのほか」なら包む**(§2.4)。
        (&["2", "neg", "pow", "2"], "(−2) ^ 2"),
        (&["2", "pow", "3", "pow", "2"], "2 ^ 3 ^ 2"),
        (
            &["2", "mul", "lparen", "3", "add", "4", "rparen"],
            "2 × (3 + 4)",
        ),
    ]);
}

#[test]
fn each_function_wraps_an_atom_a_group_and_anything_else() {
    // 設計書 §2.3 の表の全ての升目。
    rows(&[
        // 前置で書く関数。
        (&["3", "neg", "sin"], "sin(−3)"),
        (&["3", "0", "cos"], "cos(30)"),
        (&["3", "0", "tan"], "tan(30)"),
        (&["dot", "5", "asin"], "asin(0.5)"),
        (&["dot", "5", "acos"], "acos(0.5)"),
        (&["1", "atan"], "atan(1)"),
        (&["2", "ln"], "ln(2)"),
        (&["1", "0", "log10"], "log(10)"),
        (&["lparen", "2", "add", "3", "rparen", "sqrt"], "√(2 + 3)"),
        // `n!`
        (&["5", "n_fact"], "5!"),
        (&["lparen", "2", "add", "3", "rparen", "n_fact"], "(2 + 3)!"),
        (&["3", "neg", "n_fact"], "(−3)!"),
        // `eˣ`
        (&["2", "exp_e"], "e^2"),
        (&["lparen", "2", "add", "3", "rparen", "exp_e"], "e^(2 + 3)"),
        (&["3", "neg", "exp_e"], "e^(−3)"),
        // `1/x`
        (&["2", "recip"], "1/2"),
        (&["lparen", "2", "add", "3", "rparen", "recip"], "1/(2 + 3)"),
        (&["3", "neg", "recip"], "1/(−3)"),
        (&["3", "0", "sin", "recip"], "1/(sin(30))"),
        // `+/−`(仮数の符号)
        (&["lparen", "2", "add", "3", "rparen", "neg"], "−(2 + 3)"),
        (&["3", "0", "sin", "neg"], "−(sin(30))"),
        // `^` の左(§2.4)と右(包まない)。
        (&["3", "0", "sqr", "pow", "2"], "(30²) ^ 2"),
        (&["3", "0", "sin", "pow", "2"], "(sin(30)) ^ 2"),
        (
            &["lparen", "2", "add", "3", "rparen", "pow", "2"],
            "(2 + 3) ^ 2",
        ),
        (&["2", "pow", "3", "neg"], "2 ^ −3"),
        // **組を畳むときも `^` の左を包む**——字面を作る関数は 1 つ(§4.1、条件 3)。
        (
            &["lparen", "3", "neg", "pow", "2", "rparen", "sin"],
            "sin((−3) ^ 2)",
        ),
        // `nPr`・`nCr` は変えない。
        (&["5", "n_p_r", "2"], "5 nPr 2"),
        (&["5", "n_c_r", "2"], "5 nCr 2"),
    ]);
}

#[test]
fn a_function_with_no_value_on_the_line_writes_the_screen() {
    // 設計書 §3.2(裁定 1)。**engine がかけた値=押す直前の画面**を書く。
    rows(&[
        (&["2", "mul", "3", "add", "sqr", "eq"], "2 × 3 + 6²"),
        (&["2", "add", "3", "mul", "sqr", "eq"], "2 + 3 × 3²"),
        (&["2", "add", "sin"], "2 + sin(2)"),
        (&["3", "add", "neg", "eq"], "3 + −3"),
        // 画面の値は表示の文字列のまま(ASCII の `-`)。原子ではないので包む。
        (&["3", "neg", "add", "sqr", "eq"], "−3 + (-3)²"),
        (&["2", "pow", "neg"], "2 ^ −2"),
        (&["lparen", "sqr", "eq"], "(0²"),
        (&["5", "add", "lparen", "sqr", "eq"], "5 + (0²"),
        // 10 桁で丸めた画面がそのまま入る(§2.7.2)。
        (&["1", "div", "3", "add", "sqr"], "1 ÷ 3 + 0.3333333333²"),
        // 空の区間でも同じ規則(§2.7.4)。
        (&["sqr"], "0²"),
    ]);
    // **綴りが説明する答え**(表の右端の列)。
    assert_eq!(main_of(&["2", "mul", "3", "add", "sqr", "eq"]), "42");
    assert_eq!(main_of(&["2", "add", "3", "mul", "sqr", "eq"]), "29");
    assert_eq!(main_of(&["3", "add", "neg", "eq"]), "0");
    assert_eq!(main_of(&["3", "neg", "add", "sqr", "eq"]), "6");
    assert_eq!(main_of(&["lparen", "sqr", "eq"]), "0");
    assert_eq!(main_of(&["5", "add", "lparen", "sqr", "eq"]), "5");
}

#[test]
fn without_the_screens_the_missing_value_is_an_ellipsis() {
    // **画面の列を添えない呼び出し**(`spell(keys)`)は、画面の値が要る場所に `…` を書く。
    // **panic しない**(設計書 §2.7.1)。本番の経路は必ず列を添える。
    assert_eq!(bare(&["2", "add", "sin"]), "2 + sin(…)");
    assert_eq!(bare(&["sqr"]), "…²");
    // 列が途中で足りなくなっても同じ。
    let keys = [Key::Digit(2), Key::Add, Key::Sin, Key::Add, Key::Sqr];
    assert_eq!(spell_line(None, &keys, &["0", "2"]), "2 + sin(…) + …²");
    // 値の語があれば列は読まない。
    assert_eq!(bare(&["3", "0", "sin"]), "sin(30)");
}

#[test]
fn the_edges_the_order_named() {
    // 設計書 §3.3。
    rows(&[
        // DEL は `Buffer` の中で効く。
        (&["3", "0", "del", "5", "sin"], "sin(35)"),
        // **関数は取り消せない**(engine の DEL は手元の値に何もしない)。
        (&["4", "sqrt", "del"], "√(4)"),
        // DEL の 0 段目が `3` を打ちかけに戻し、`sin` はその `3` にかかる。
        (
            &["lparen", "2", "add", "3", "rparen", "del", "sin"],
            "(2 + sin(3)",
        ),
        // **畳んだあとに古い長さへ切り詰めない**(§4.1)——`sin` が `closed` を空にする。
        (
            &["lparen", "2", "add", "3", "rparen", "sin", "del"],
            "sin(2 + 3)",
        ),
        (&["3", "add", "mul", "4", "sin"], "3 × sin(4)"),
        // **押し直しで `^` になっても左を包む**——包むのは繋ぐ時点。
        (&["3", "neg", "add", "pow", "2"], "(−3) ^ 2"),
        // **`^` を取り消したら包みも外す。**
        (&["3", "neg", "pow", "add", "2"], "−3 + 2"),
        // engine の押し直しは戻り先から畳み直す。画面の値は押す直前の `main` を写すだけ。
        (&["2", "mul", "3", "add", "mul", "sqr"], "2 × 3 × 6²"),
        // 打っている最中の行。
        (&["3", "0"], "30"),
        (&["lparen", "3"], "(3"),
    ]);
    // **`=` をまたぐ**(前の答えが最初の語。§2.5)。
    assert_eq!(spell_after(&["3", "eq"], &["sin"]), "sin(3)");
    assert_eq!(spell_after(&["3", "neg", "eq"], &["sqr"]), "(-3)²");
    assert_eq!(
        spell_after(&["4", "div", "3", "eq"], &["sqr"]),
        "1.333333333²"
    );
    assert_eq!(spell_after(&["3", "eq"], &["add", "1"]), "3 + 1");
    assert_eq!(spell_after(&["3", "eq"], &["add", "sqr"]), "3 + 3²");
    // **式 `2 + 3` を持ち越さない**——頭は答えの表示 `5`。
    assert_eq!(spell_after(&["2", "add", "3", "eq"], &["sqr"]), "5²");
}

#[test]
fn a_grouped_answer_is_still_an_atom() {
    // 設計書 §2.1(条件 2): 画面の整数部は 3 桁ごとに `,` で区切られる
    // (`format_real` の `group_integer_part`)。**その組も原子**——含めないと `(1,234,000)²`。
    assert_eq!(
        spell_after(
            &["1", "2", "3", "4", "mul", "1", "0", "0", "0", "eq"],
            &["sqr"]
        ),
        "1,234,000²"
    );
    // 画面の値の側でも同じ判定(`3333 +` の画面は `3,333`)。
    assert_eq!(
        spell_of(&["3", "3", "3", "3", "add", "sqr"]),
        "3333 + 3,333²"
    );
}

#[test]
fn an_empty_spelling_takes_no_answer_in_front() {
    // **綴りが空なら前の答えも付けない**(web の `lineOf` の約束を core に移した。§2.5)
    // ——空の式の行は履歴に積まれない。
    assert_eq!(spell_after(&["3", "eq"], &[]), "");
    assert_eq!(spell_after(&["3", "eq"], &["lparen", "del"]), "");
    assert_eq!(spell_after(&["3", "eq"], &["ac"]), "");
    // 列が空でなければ付く。
    assert_eq!(spell_after(&["3", "eq"], &["mul", "2"]), "3 × 2");
}
