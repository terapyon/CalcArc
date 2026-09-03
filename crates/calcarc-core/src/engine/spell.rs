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
        Key::AngleToggle | Key::EngToggle | Key::PolarToggle | Key::Dms => return None,
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
/// 数字・小数点だけでできていれば真。`del` はここを見て、1 文字だけ
/// 落とすか、部分をまるごと落とすかを決める。
fn is_digit_run(part: &str) -> bool {
    !part.is_empty() && part.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// キー列を式の文字列に綴る。
///
/// **`ac` は列を空にする。**
///
/// **`del` は最後の部分が数字の綴りなら 1 文字だけ落とし、
/// そうでなければ部分をまるごと落とす。** 電卓本体の DEL が
/// `engine_table.rs:168`(`main_of(&["1","zeros3","del"]) == "100"`)
/// で「数字は 1 文字ずつ」と決めているので、`zeros3` の `000` を
/// 打鍵単位でまるごと戻すと綴りが `1` になってしまい、その式が
/// 自分の答(`100`)と食い違う。**綴りは表示の DEL と同じ粒度でなければ
/// ならない。** 一方 `sin` のような数でない綴りは 1 打鍵で 1 語が
/// 入るので、`del` もその語をまるごと戻す——1 打鍵の効果と一致する。
///
/// どちらも空の列に来ても何も起きない(**panic しない**)。
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
                    } else {
                        parts.pop();
                    }
                }
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
