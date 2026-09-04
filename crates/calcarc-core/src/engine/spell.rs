//! キー列を、履歴に残す式の文字列に綴る。
//!
//! **打った順に、キーのラベルをそのまま並べる。** 構文木を組まない
//! ——組めばそれは計算であり、参照実装に同じ手順を書くことになって
//! 照合の意味が消える(設計書 `2026-09-03-history-design.md` §4a)。
//!
//! 独立: 不可能。**綴りは「盤面のキーが何と書いてあるか」という取り決め**
//! であって数学的な事実ではないので、別手順で同じ文字列に到達する道が無い。
//! **番人は `tests/spell_table.rs` の表と、`calcarc-wasm` の
//! `tests/label_parity.rs`(綴りと盤面のラベルが一致すること)である。**

use super::key::Key;

/// 60 進の区切り(`dms`)を綴りの中で表す 1 文字。
///
/// **表示層(`display.rs`)が進める `°′″` の段は真似ない。** 真似ると
/// 区切りの段数を数える状態機械が要り、`spell` を「組まない」という
/// §4a の方針に反する。**同じ 1 文字を毎回使う**——`del` の 1 打鍵 1 文字
/// という粒度をここでも保つため(下の `dms_marks_a_segment_boundary_
/// while_entering_a_number` テストが `del` の回数を検算している)。
const DMS_MARKER: char = '°';

/// 数を作るキーか。**これらだけが前の綴りにくっつく。**
fn joins_to_previous(key: Key) -> bool {
    matches!(key, Key::Digit(_) | Key::Dot | Key::Zeros3)
}

/// 1 キーの綴り。**綴らないキーは None。**
///
/// 文字はすべて `web/src/ui/Keypad/scientific.ts` の `label:` から写した
/// (`shift:` の裏も含む)。`sub`/`mul`/`div` の記号は
/// `calcarc-core/src/engine/display.rs` の `op_symbol` と同じ Unicode
/// (`−` は U+2212 MINUS SIGN、ハイフンではない)。
fn glyph(key: Key) -> Option<&'static str> {
    Some(match key {
        // 列に対する操作であって、綴りではない。
        Key::Eq | Key::Ac | Key::Del => return None,
        // モードの切替。**値の見せ方を変えるだけで、式には現れない。**
        Key::AngleToggle | Key::EngToggle | Key::PolarToggle => return None,
        // **ここには実際には来ない。** `spell` の中で `Key::Dms` を個別に
        // 扱っており(下記)、`glyph` まで届く前に処理を終える。網羅性の
        // ためだけに腕を残す——2 役(60 進の区切り/表示トグル)を持ち、
        // `buffer` が Some かどうかで効果が変わるので、他の 3 つと違って
        // 「常に無音」の 1 行では言えない(Fix round 3 finding 12)。
        Key::Dms => return None,
        Key::Digit(0) => "0",
        Key::Digit(1) => "1",
        Key::Digit(2) => "2",
        Key::Digit(3) => "3",
        Key::Digit(4) => "4",
        Key::Digit(5) => "5",
        Key::Digit(6) => "6",
        Key::Digit(7) => "7",
        Key::Digit(8) => "8",
        Key::Digit(9) => "9",
        Key::Digit(_) => "0",
        Key::Dot => ".",
        Key::Zeros3 => "000",
        Key::Exp => "Exp",
        Key::Pi => "π",
        Key::Add => "+",
        Key::Sub => "−",
        Key::Mul => "×",
        Key::Div => "÷",
        Key::LParen => "(",
        Key::RParen => ")",
        Key::J => "j",
        Key::Sqrt => "√",
        Key::Sqr => "x²",
        Key::Sin => "sin",
        Key::Cos => "cos",
        Key::Tan => "tan",
        Key::Neg => "+/−",
        Key::Pow => "xʸ",
        Key::Ln => "ln",
        Key::Log10 => "log",
        Key::ExpE => "eˣ",
        Key::Recip => "1/x",
        Key::Asin => "asin",
        Key::Acos => "acos",
        Key::Atan => "atan",
        Key::E => "e",
        Key::NFact => "n!",
        Key::Npr => "nPr",
        Key::Ncr => "nCr",
    })
}

/// 部分(空白で区切られる 1 単位)が、数字を打っている最中の綴りか。
///
/// 数字・小数点・`DMS_MARKER`(60 進の区切り)だけでできていれば真。
/// `del` はここを見て、1 文字だけ落とすか、部分をまるごと落とすかを
/// 決める。`Key::Dms` もここを見て、区切りとして働くか(= `buffer` が
/// Some にあたるか)を判断する——**buffer そのものは持たないので、
/// 「最後の部分がいまも数字の綴りの形をしているか」を代わりに見る**。
fn is_digit_run(part: &str) -> bool {
    !part.is_empty()
        && part
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == DMS_MARKER)
}

/// キー列を式の文字列に綴る。
///
/// **`ac` は列を空にする。**
///
/// **`del` は `engine/mod.rs` の `delete_one` と同じ粒度で消す。**
/// `delete_one` は `state.buffer`(入力中の数値)があるときだけ 1 文字を
/// 消し、無いとき(演算子や後置関数を打った直後)は先頭の開き括弧を除いて
/// **何も消さない**——演算子は消えない、という `delete_one` 自身の註の
/// とおりである。綴りの「数字が続く最後の部分」は buffer が Some のとき
/// にあたるので、そこは 1 文字だけ落とす(`zeros3` の `000` は
/// `engine_table.rs:168` が 1 文字ずつの DEL を固定しているので、綴りも
/// 合わせないと `1000 del` の式が自分の答(`100`)を生まなくなる)。
/// 最後の部分が数字でなければ buffer は None にあたるので、**開き括弧
/// でない限り何も落とさない**——`3 + DEL 4` は `3 + 4` のままで、
/// `sin` のような後置関数の綴りも残る。
///
/// **`dms` は buffer が Some のときだけ区切り 1 文字(`DMS_MARKER`)を足す。**
/// `engine/mod.rs` の `Key::Dms` は buffer が Some なら 60 進の区切りとして
/// 働き(`Buffer::try_push_sexagesimal_separator`)、None なら表示の一時
/// トグルで値には触れない。旧い実装は常に無音だったので、
/// `["1","dms","3","0"]`(答は 1.5 系列、`engine_table.rs:421`)を「130」
/// という無関係の数として記録していた——`del`/`zeros3`(finding 2)と同じ
/// 形の欠陥である。**既に 2 回区切りを打っていれば(度・分・秒で打ち止め)
/// 3 回目は engine 側でも完全な無音になるので、ここでも足さない。**
/// **既知の穴**: 指数(`Exp`)を開いたあとの `dms` は、engine 側では
/// (`exponent.is_some()` により)常に無音になるが、この関数は指数部の桁が
/// 「まだ数字の綴りの形をしている」ことしか見ないので区切りを足してしまう
/// ことがある——60 進と指数を同じ入力の中で混ぜる操作自体が実用上ほぼ
/// 無い組み合わせなので、ここでは追わない(実測未対応)。
///
/// どの分岐も空の列に来ては何も起きない(**panic しない**)。
pub fn spell(keys: &[Key]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for &key in keys {
        match key {
            Key::Ac => parts.clear(),
            Key::Del => {
                if let Some(last) = parts.last_mut() {
                    if is_digit_run(last) {
                        last.pop();
                        if last.is_empty() {
                            parts.pop();
                        }
                    } else if last == "(" {
                        // `delete_one` が消す唯一の非数字: 先頭の開き括弧。
                        parts.pop();
                    }
                    // それ以外(演算子・後置関数の綴り)は `delete_one` が
                    // 何も消さない場合にあたるので、ここでも落とさない。
                }
            }
            Key::Dms => {
                if let Some(last) = parts.last_mut() {
                    let separators = last.matches(DMS_MARKER).count();
                    // `is_digit_run` は「buffer が Some か」の代わり、
                    // `separators < 2` は「度・分・秒で打ち止めか」の代わり
                    // ——`Buffer::try_push_sexagesimal_separator` の
                    // `sexagesimal.len() >= 2` と同じ上限。
                    if is_digit_run(last) && separators < 2 {
                        last.push(DMS_MARKER);
                    }
                }
                // 何も打っていない状態の `dms` は表示トグルで、値に触れない
                // ——`parts` が空、または最後の部分が数字の形をしていない
                // (後置関数の直後など)ときは、どちらも無音のまま。
            }
            _ => {
                let Some(text) = glyph(key) else { continue };
                let joins =
                    joins_to_previous(key) && parts.last().is_some_and(|last| is_digit_run(last));
                if joins {
                    // **数は前にくっつく。** `3` `0` は `30` になる。
                    if let Some(last) = parts.last_mut() {
                        last.push_str(text);
                    }
                } else {
                    parts.push(text.to_string());
                }
            }
        }
    }
    parts.join(" ")
}
