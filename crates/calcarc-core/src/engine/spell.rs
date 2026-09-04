//! キー列を、履歴に残す式の文字列に綴る。
//!
//! **打った順に、キーのラベルをそのまま並べる。** 構文木を組まない
//! ——組めばそれは計算であり、参照実装に同じ手順を書くことになって
//! 照合の意味が消える(設計書 `2026-09-03-history-design.md` §4a)。
//!
//! 独立: 不可能。**綴りは「盤面のキーが何と書いてあるか」という取り決め**
//! であって数学的な事実ではないので、別手順で同じ文字列に到達する道が無い。
//! **番人は `tests/spell_table.rs` の表**であり、そこでは入力中の数の綴りを
//! **engine を実際に走らせた `render(...).main` と 1 文字ずつ突き合わせる。**
//!
//! # 数の部分は真似ない。`Buffer` そのものを歩かせる
//!
//! かつてここには `Buffer` と「同じ形の」写しが置いてあり、`del` の段・
//! 先頭ゼロ・小数点・指数を手で真似ていた。**同じ欠陥が 5 回入った**
//! ——真似そこねた振る舞いが 1 つ直るたびに、次の真似そこねが表に出た。
//! 数え直したところ `Buffer` の 16 の振る舞いのうち **13 を真似られて
//! いなかった**(字数上限、上限での `.`、指数の桁数上限、指数の符号、
//! 指数中の `.`、`Exp` の連打、60 進中の `Exp`、仮数と指数の先頭ゼロ、
//! 裸の `.` の暗黙の 0、仮数なしの `Exp` の 1、`000` の上限跨ぎ、ほか)。
//!
//! **いまは写しを持たない。** `spell` は本物の `Buffer`
//! (`engine/state.rs`)を持って歩き、`engine/mod.rs` の `apply()` が
//! バッファへ渡すのと同じキーを同じ順で渡し、**値の部分を
//! `Buffer::text()` で綴る。** `text()` の docstring が
//! 「入力中に表示する文字列。打鍵した通りに見せる。」と言っているとおり、
//! これは §4a の「打った通り」を **engine 自身の実装で**述べたものである。
//! 演算子・関数・括弧など、バッファを通らないものは従来どおりここで
//! 組み立てる(`commit_glyph`)。
//!
//! **その帰結**: 指数の符号は綴りに出る(`1.5e-3`)。**仮数の符号は出ない**
//! ——`+/−` は指数入力中でなければ `Buffer` ではなく呼び出し側
//! (`apply_unary`)が確定値に掛けるので、`Buffer` は符号を知らない。
//! この非対称は engine の分担そのままであり、直さない。
//!
//! **どのキーがバッファに届き、どのキーがバッファを確定・破棄するか**は
//! `engine/mod.rs` の `apply()` と `commit_entry` の呼び出し元をそのまま
//! 辿った(下の各 `match` アームのコメントを見ること)。

use super::key::Key;
use super::state::{Backspace, Buffer};

/// 開いている `Buffer` を `parts` へ流し込み、閉じる。`commit_entry`
/// (`engine/mod.rs`)と同じ——バッファが無ければ何もしない。
///
/// **`value()` は呼ばない。** 綴りは打鍵の記録であって計算ではないので、
/// 溢れも構文エラーもここでは起きない(engine 側だけが状態をエラーに
/// する)。流し込むのは `text()` ——engine が入力中に見せていた姿である。
fn commit_into(current: &mut Option<Buffer>, parts: &mut Vec<String>) {
    if let Some(buffer) = current.take() {
        parts.push(buffer.text());
    }
}

/// `Buffer` を確定させたあと、固定の語を 1 つだけ足すキーの綴り。
///
/// ここに来るのは、`apply()`(`engine/mod.rs`)で `commit_entry` を呼ぶ
/// キー(二項演算子・`)`・後置関数)のうち、専用の分岐を持たないもの
/// だけである。`Eq` は綴りに何も足さない(列を閉じるだけ)。
///
/// **`Buffer` に届くキー(数字・`.`・`000`・`Exp`・`j`・`°'"`)はここに
/// 載らない。** それらの綴りは `Buffer::text()` が持っており、固定の
/// 字面を持たない。
fn commit_glyph(key: Key) -> Option<&'static str> {
    Some(match key {
        Key::Add => "+",
        Key::Sub => "−",
        Key::Mul => "×",
        Key::Div => "÷",
        Key::Pow => "xʸ",
        Key::Npr => "nPr",
        Key::Ncr => "nCr",
        Key::NFact => "n!",
        Key::RParen => ")",
        Key::Sqrt => "√",
        Key::Sqr => "x²",
        Key::Sin => "sin",
        Key::Cos => "cos",
        Key::Tan => "tan",
        Key::Neg => "+/−",
        Key::Ln => "ln",
        Key::Log10 => "log",
        Key::ExpE => "eˣ",
        Key::Recip => "1/x",
        Key::Asin => "asin",
        Key::Acos => "acos",
        Key::Atan => "atan",
        _ => return None,
    })
}

/// キー列を式の文字列に綴る。
///
/// **`ac` は列を空にする**(`engine/mod.rs` の `next.cleared()` と同じ
/// ——入力中のバッファも一緒に捨てる)。
///
/// **開く・確定する・捨てるの 3 通り**(`apply()` を読んで分けた):
/// - **開く/伸ばす**(バッファを作る・書き足す): 数字・`.`・`000`・
///   `Exp`・`j`・`°'"`(バッファが既にあるときだけ)・指数入力中の `+/−`
/// - **確定する**(バッファを `parts` へ流し込み、`None` にする):
///   二項演算子・`=`・`)`・後置関数・仮数の符号としての `+/−`
/// - **捨てる**(流し込まずに `None` にする): `(`・`π`・`e`
///   ——`open_paren`/`Key::Pi`/`Key::E` が `state.buffer = None` を
///   直接代入し、`commit_entry` を経由しない(入力途中の値を捨てる)
///   のと同じ。押しかけの数字が式に残らない
///   (`engine_table.rs:858` の `["3","lparen","del"]` == "0" が
///   この「捨てる」を要求している——"3" を確定させていたら del は
///   "3" を残してしまう)。
///
/// **`del` は `Buffer::backspace` を呼ぶ**(`delete_one` と同じ)。
/// バッファが無ければ、先頭の開き括弧だけを消す(`delete_one` の唯一の
/// 例外)——演算子は消えない。
///
/// どの分岐も空の列に来ては何も起きない(**panic しない**)。
pub fn spell(keys: &[Key]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<Buffer> = None;

    for &key in keys {
        match key {
            Key::Ac => {
                parts.clear();
                current = None;
            }
            Key::Del => {
                // `delete_one`(engine/mod.rs)をそのまま辿る。
                if let Some(buffer) = current.as_mut() {
                    if buffer.backspace() == Backspace::Exhausted {
                        current = None;
                    }
                } else if parts.last().map(String::as_str) == Some("(") {
                    parts.pop();
                }
            }
            Key::Digit(d) => {
                // 範囲外の桁は `push_digit` 自身が捨てる(panic しない)。
                current.get_or_insert_with(Buffer::default).push_digit(d);
            }
            Key::Dot => {
                // 2 つ目の `.` は `SyntaxError` になるが、綴りはエラー状態を
                // 持たない——engine 側だけが状態を止める。
                let _ = current.get_or_insert_with(Buffer::default).push_dot();
            }
            Key::Zeros3 => {
                current.get_or_insert_with(Buffer::default).push_zeros();
            }
            Key::Exp => {
                current.get_or_insert_with(Buffer::default).push_exponent();
            }
            Key::J => {
                // 数字があれば実部⇄虚部の切り替え、無ければ新しい虚部入力
                // (設計書 §1)。`apply()` の `Key::J` と同じ 2 段の借用。
                let toggles = current.as_ref().is_some_and(Buffer::has_digits);
                if toggles {
                    if let Some(buffer) = current.as_mut() {
                        buffer.toggle_imaginary();
                    }
                } else {
                    current = Some(Buffer::imaginary());
                }
            }
            Key::Dms => {
                // バッファが無ければ表示トグル(値に触れない、無音)。
                let _ = current
                    .as_mut()
                    .is_some_and(Buffer::try_push_sexagesimal_separator);
            }
            Key::Neg => {
                // `+/−` は 2 つの階層で働く(設計書 §2)。指数入力中は
                // 指数の符号——`text()` が `e-` を出すので綴りに現れる。
                // そうでなければ確定値の符号で、`Buffer` は関与しない
                // (`apply_unary` が掛ける)ので、キーの字面を足す。
                let signed_exponent = current.as_mut().is_some_and(Buffer::toggle_exponent_sign);
                if !signed_exponent {
                    commit_into(&mut current, &mut parts);
                    if let Some(text) = commit_glyph(key) {
                        parts.push(text.to_string());
                    }
                }
            }
            Key::LParen => {
                // 入力途中の値を捨てる(`open_paren` と同じ。上の註参照)。
                current = None;
                parts.push("(".to_string());
            }
            Key::Pi => {
                current = None;
                parts.push("π".to_string());
            }
            Key::E => {
                current = None;
                parts.push("e".to_string());
            }
            Key::AngleToggle | Key::EngToggle | Key::PolarToggle => {
                // 表示だけを変える。バッファにも `parts` にも触れない。
            }
            Key::Eq => {
                commit_into(&mut current, &mut parts);
            }
            _ => {
                // 二項演算子・`)`・後置関数。
                commit_into(&mut current, &mut parts);
                if let Some(text) = commit_glyph(key) {
                    parts.push(text.to_string());
                }
            }
        }
    }
    commit_into(&mut current, &mut parts);
    parts.join(" ")
}
