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
fn seven_keys_do_not_spell() {
    // モードの 4 つは綴りに何も残さない。**角度モードは 1 件が別の欄に持つ。**
    assert_eq!(spell_of(&["3", "0", "angle_toggle", "sin"]), "30 sin");
    assert_eq!(spell_of(&["3", "eng"]), "3");
    assert_eq!(spell_of(&["3", "polar_toggle"]), "3");
    assert_eq!(spell_of(&["3", "dms"]), "3");
    // `eq` は列を閉じるだけで、綴りに現れない。
    assert_eq!(spell_of(&["3", "add", "4", "eq"]), "3 + 4");
}

#[test]
fn del_drops_the_last_spelling_and_ac_empties_the_line() {
    // engine_table.rs:178 が `["3","add","j","4","del","5","eq"]` を
    // `3+5j` にしている。**綴りも同じ数の打鍵を落とす。**
    assert_eq!(spell_of(&["3", "add", "j", "4", "del", "5"]), "3 + j 5");
    assert_eq!(spell_of(&["1", "2", "del"]), "1");
    assert_eq!(spell_of(&["1", "2", "del", "del"]), "");
    // 空の列に `del` を打っても壊れない。**core は panic しない。**
    assert_eq!(spell_of(&["del"]), "");
    assert_eq!(spell_of(&["1", "add", "2", "ac", "9"]), "9");
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
