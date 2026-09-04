//! **綴りの仕様書。** キー列と式の文字列の対応を、ここが固定する。
//!
//! `engine_table.rs` が「キー列と**表示**」を固定しているのと同じ形である
//! ——あちらは電卓の挙動、こちらは履歴に残す綴りである。
//!
//! **golden は置かない。** 綴りは「盤面のキーが何と書いてあるか」という
//! 取り決めであって数学ではないので、`reference/` の Python が別手順で
//! 同じ文字列に到達する道が無い(書けば写しになる)。**表がこれの番人である。**
//!
//! **入力中の数の綴りは engine の表示と 1 文字も違ってはならない。**
//! `spell` は `engine/state.rs` の `Buffer` そのものを歩かせ、値の部分を
//! `Buffer::text()` で綴る。**「同じコードだから食い違わない」は構造の
//! 主張であって検証ではない**ので、下の `assert_entry` は毎回 engine を
//! 実際に走らせて `render(...).main` と綴りの両方を突き合わせる
//! ——片方だけが動いたら赤くなる。

use calcarc_core::{EngineState, Key, engine::spell::spell, reduce, render};

fn spell_of(tokens: &[&str]) -> String {
    let keys: Vec<Key> = tokens
        .iter()
        .map(|t| Key::from_token(t).expect("unknown token in the table"))
        .collect();
    spell(&keys)
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
    assert_eq!(spell_of(&["3", "sin", "dms"]), "3 sin");
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
    assert_eq!(spell_of(&["4", "sqrt", "del"]), "4 √");
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
    // (`del` が j 入力をまるごと消したあと、次の `mul` は差し替えでは
    // なく確定した 3 に対する新しい演算になる。答は 15)。
    assert_eq!(
        spell_of(&["3", "mul", "j", "del", "mul", "5", "eq"]),
        "3 × × 5"
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
    // (del は演算子を消さない。2 度目の `+` は打ち直しとして、押した
    // 通りにもう 1 つ現れる。答は 7)。
    assert_eq!(spell_of(&["3", "add", "del", "add", "4", "eq"]), "3 + + 4");
}

#[test]
fn lparen_pi_and_e_discard_the_entry_being_typed_instead_of_committing_it() {
    // **`(`・`π`・`e` は `commit_entry` を経由しない**——`open_paren`・
    // `Key::Pi`・`Key::E`(engine/mod.rs)がそれぞれ `state.buffer = None`
    // を直接代入する。押しかけの数字は式に残らない——残すと、その式が
    // 答を説明しなくなる(engine_table.rs:858 の
    // `main_of(&["3","lparen","del"]) == "0"` が、"3" を確定させて
    // いない証拠——確定させていたら del は "3" を残すはずである)。
    assert_eq!(spell_of(&["3", "lparen", "del"]), "");
    assert_eq!(spell_of(&["3", "pi"]), "π");
    assert_eq!(spell_of(&["3", "e"]), "e");
}

#[test]
fn del_after_lparen_cannot_recover_the_zero_it_silently_substituted() {
    // **既知の穴。Fix round 4 finding A の見直しで見つけたが、直して
    // いない。** `(` は入力途中の値を捨てて `current` を 0 にする
    // (`open_paren` の註)。その `(` を del で消しても、この 0 への
    // 差し替えは戻らない——engine_table.rs の
    // `del_does_not_restore_the_value_a_paren_discarded`(:906-909)の
    // 名前のとおり。**その 0 は一度も打鍵されていない**ので、綴りには
    // 足す文字が無い——「打った通りに並べる」(§4a)だけでは説明できない、
    // いまのところ唯一の形である。
    //
    // engine_table.rs:908 は `["3","mul","lparen","del","eq"]` を "0" に
    // 固定しているが、綴りは "3 ×" のまま(暗黙の 0 を語らない)。
    assert_eq!(spell_of(&["3", "mul", "lparen", "del"]), "3 ×");
    // engine_table.rs:909 は加算版を "3" に固定している(+ の単位元が 0
    // なので値としては偶然合って見えるが、綴りが 0 を語っていない点は
    // 同じ穴である)。
    assert_eq!(spell_of(&["3", "add", "lparen", "del"]), "3 +");
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
