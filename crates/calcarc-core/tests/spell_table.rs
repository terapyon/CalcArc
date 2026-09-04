//! **綴りの仕様書。** キー列と式の文字列の対応を、ここが固定する。
//!
//! `engine_table.rs` が「キー列と**表示**」を固定しているのと同じ形である
//! ——あちらは電卓の挙動、こちらは履歴に残す綴りである。
//!
//! **golden は置かない。** 綴りは「盤面のキーが何と書いてあるか」という
//! 取り決めであって数学ではないので、`reference/` の Python が別手順で
//! 同じ文字列に到達する道が無い(書けば写しになる)。**表がこれの番人である。**

use calcarc_core::{Key, engine::spell::spell};

fn spell_of(tokens: &[&str]) -> String {
    let keys: Vec<Key> = tokens
        .iter()
        .map(|t| Key::from_token(t).expect("unknown token in the table"))
        .collect();
    spell(&keys)
}

#[test]
fn digits_run_together_and_everything_else_gets_a_space() {
    assert_eq!(spell_of(&["3", "0", "sin"]), "30 sin");
    assert_eq!(spell_of(&["2", "mul", "3", "add", "4"]), "2 × 3 + 4");
    assert_eq!(spell_of(&["1", "dot", "5"]), "1.5");
    assert_eq!(spell_of(&["1", "zeros3"]), "1000");
}

#[test]
fn unary_functions_are_postfix_because_that_is_how_they_are_typed() {
    // `["4","sqrt"]` は 2 を出す(engine_table.rs)。**押した順に綴る。**
    assert_eq!(spell_of(&["4", "sqrt"]), "4 √");
    assert_eq!(spell_of(&["2", "sqr"]), "2 x²");
    assert_eq!(spell_of(&["5", "n_fact"]), "5 n!");
}

#[test]
fn parentheses_are_spelled_as_typed_even_when_unbalanced() {
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "3", "add", "4", "rparen"]),
        "2 × ( 3 + 4 )"
    );
    assert_eq!(
        spell_of(&["2", "mul", "lparen", "3", "add", "4"]),
        "2 × ( 3 + 4"
    );
}

#[test]
fn mode_keys_never_spell() {
    // 表示だけを変える 3 つは綴りに何も残さない。**角度モードは 1 件が
    // 別の欄に持つ**(`dms` は表示トグルと 60 進の区切りの 2 役があるので
    // 別のテスト(`dms_marks_a_segment_boundary_while_entering_a_number`)
    // に分けてある——常に無音の 3 つとは条件が違う)。
    assert_eq!(spell_of(&["3", "0", "angle_toggle", "sin"]), "30 sin");
    assert_eq!(spell_of(&["3", "eng"]), "3");
    assert_eq!(spell_of(&["3", "polar_toggle"]), "3");
    // `eq` は列を閉じるだけで、綴りに現れない。
    assert_eq!(spell_of(&["3", "add", "4", "eq"]), "3 + 4");
}

#[test]
fn dms_marks_a_segment_boundary_while_entering_a_number() {
    // **Fix round 3 finding 12。** `engine/mod.rs` の `Key::Dms`:
    // `buffer` が Some(入力中)なら 60 進の区切りとして働き(`Buffer::
    // try_push_sexagesimal_separator`)、そうでなければ表示の一時トグルで
    // 値には触れない。旧い実装は常に無音だったので、
    // `["1","dms","3","0"]`(engine_table.rs:421 の `main_of` が "1°30" を
    // 固定している)の答(1.5 系列)を「130」という無関係の数として記録
    // していた——finding 2 の `del`/`zeros3` と同じ形の欠陥である。
    //
    // **印は固定で 1 文字("°")。** 表示層が進める `°′″` の段は真似ない
    // ——真似ると区切りの段数を数える状態機械が要り、§4a の「組まない」
    // 方針に反する。**`del` の粒度とは一致する**: 区切り 1 回・数字 1 個
    // がそれぞれ 1 文字として現れるので、`Buffer::backspace` が数字→区切り
    // の順に 1 段ずつ戻すのと同じ回数で `del` が戻せる。
    assert_eq!(spell_of(&["1", "dms", "3", "0"]), "1°30");
    assert_eq!(spell_of(&["1", "dms", "3", "0", "dms", "0"]), "1°30°0");
    // **3 段目までで打ち止め**(度・分・秒)。`Buffer::
    // try_push_sexagesimal_separator` が `sexagesimal.len() >= 2` で断る
    // のと同じ数で、3 回目の `dms` は engine 側でも完全な無音になる
    // ——見た目にも足さない。
    assert_eq!(
        spell_of(&["1", "dms", "3", "0", "dms", "0", "dms"]),
        "1°30°0"
    );
    // 何も打っていない状態の `dms` は表示トグルで、値に触れない(無音)。
    assert_eq!(spell_of(&["dms"]), "");
    // 後置関数の直後(buffer は None)の `dms` も無音。
    assert_eq!(spell_of(&["3", "sin", "dms"]), "3 sin");
    // `del` は区切りも数字と同じ 1 打鍵として、1 文字ずつ戻る。
    assert_eq!(spell_of(&["1", "dms", "3", "0", "del"]), "1°3");
    assert_eq!(
        spell_of(&["1", "dms", "3", "0", "del", "del", "del", "del"]),
        ""
    );
}

#[test]
fn del_is_one_character_on_a_digit_run_and_ac_empties_the_line() {
    // engine_table.rs:178 が `["3","add","j","4","del","5","eq"]` を
    // `3+5j` にしている。**綴りも同じ数の打鍵を落とす。**
    assert_eq!(spell_of(&["3", "add", "j", "4", "del", "5"]), "3 + j 5");
    assert_eq!(spell_of(&["1", "2", "del"]), "1");
    assert_eq!(spell_of(&["1", "2", "del", "del"]), "");
    // 空の列に `del` を打っても壊れない。**core は panic しない。**
    assert_eq!(spell_of(&["del"]), "");
    assert_eq!(spell_of(&["1", "add", "2", "ac", "9"]), "9");
    // **`del` は 1 文字である。** engine_table.rs:168 が
    // `main_of(&["1","zeros3","del"]) == "100"` を固定しているので、
    // 綴りがここでずれると**式が自分の答を生まない 1 件**ができる。
    assert_eq!(spell_of(&["1", "zeros3", "del"]), "100");
    assert_eq!(spell_of(&["1", "zeros3", "del", "del", "del"]), "1");
    assert_eq!(spell_of(&["1", "dot", "5", "del"]), "1.");
    // `delete_one`(engine/mod.rs)は buffer が None のとき、先頭の開き括弧
    // 以外は何も消さない——演算子も後置関数も残る。**綴りも同じでなければ
    // ならない**: そうでないと `3 + DEL 4 =` が engine では 7 を計算するのに
    // 綴りは `34` を記録し、「34 = 7」という自分の答えを生まない式ができる。
    assert_eq!(spell_of(&["3", "add", "del", "4"]), "3 + 4");
    // 後置関数も同様——`del` は演算子でも関数でもない、数字だけを消す。
    assert_eq!(spell_of(&["4", "sqrt", "del"]), "4 √");
    // 唯一の例外は開き括弧(`delete_one` の「先頭の開き括弧だけ」)。
    assert_eq!(spell_of(&["2", "mul", "lparen", "del"]), "2 ×");
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
