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

/// キー列を式の文字列に綴る。
///
/// **`del` は直前の 1 打鍵ぶんを落とし、`ac` は列を空にする。**
/// どちらも空の列に来ても何も起きない(**panic しない**)。
///
/// 各「部分」(空白で区切られる単位)は、それを作った打鍵ごとの断片
/// (`chunk`)の列として持つ。`3` `0` は 1 つの部分 `["3", "0"]`(表示は
/// `30`)で、`del` はその部分の最後の断片だけを取り除く——`zeros3` の
/// ように 1 打鍵で複数文字(`000`)を入れるキーでも、`del` は 1 打鍵ぶんを
/// まるごと戻す。断片が尽きて部分が空になったら、部分そのものを消す。
/// atomic な部分(`sin` など)は断片が 1 つしか無いので、`del` はその
/// 部分をまるごと消す——それが 1 打鍵の効果と一致する。
pub fn spell(keys: &[Key]) -> String {
    let mut parts: Vec<Vec<&'static str>> = Vec::new();
    for &key in keys {
        match key {
            Key::Ac => parts.clear(),
            Key::Del => {
                if let Some(last) = parts.last_mut() {
                    last.pop();
                    if last.is_empty() {
                        parts.pop();
                    }
                }
            }
            _ => {
                let Some(text) = glyph(key) else { continue };
                let joins = joins_to_previous(key)
                    && parts.last().is_some_and(|last| {
                        last.iter()
                            .all(|chunk| chunk.chars().all(|c| c.is_ascii_digit() || c == '.'))
                    });
                if joins {
                    // **数は前にくっつく。** `3` `0` は `30` になる。
                    if let Some(last) = parts.last_mut() {
                        last.push(text);
                    }
                } else {
                    parts.push(vec![text]);
                }
            }
        }
    }
    parts
        .iter()
        .map(|chunks| chunks.concat())
        .collect::<Vec<String>>()
        .join(" ")
}
