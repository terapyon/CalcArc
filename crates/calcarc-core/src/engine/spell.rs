//! キー列を、履歴に残す式の文字列に綴る。
//!
//! **打った順に、キーのラベルをそのまま並べる。** 構文木を組まない
//! ——組めばそれは計算であり、参照実装に同じ手順を書くことになって
//! 照合の意味が消える(設計書 `2026-09-03-history-design.md` §4a)。
//! **ただし演算子の直後の演算子は訂正なので、最後の 1 つだけを残す**
//! (0.9.2 設計書 §9 の 9。engine の押し直しと同じ意味)。
//!
//! 独立: 不可能。**綴りは「盤面のキーが何と書いてあるか」という取り決め**
//! であって数学的な事実ではないので、別手順で同じ文字列に到達する道が無い。
//! **番人は `tests/spell_table.rs` の表**であり、そこでは入力中の数の綴りを
//! **engine を実際に走らせた `render(...).main` と 1 文字ずつ突き合わせる。**
//!
//! **番人はもう 1 つある**——`tests/spell_differential.rs` が、長さ 5 までの
//! 全列と入力に寄せた乱択で「入力中は綴りの最後の語が engine の表示と一致する」
//! (不変条件 A)を確かめる。**写しの残り(キーの振り分け)を見るのはこちら**である。
//! A が見るのは最後の語だけなので、途中の語に取り残されたずれには構造的に
//! 黙る(設計書 `2026-09-10-independent-verification-gaps-design.md` §2.4)。
//! 過去の欠陥版 4 つで赤くなることを実測した(同 §2.6)。
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

/// 二項演算子の字面。**押し直しの判定にだけ使う**(`spell` の `_` の腕)。
const BINARY_GLYPHS: [&str; 7] = ["+", "−", "×", "÷", "xʸ", "nPr", "nCr"];

fn is_binary(key: Key) -> bool {
    matches!(
        key,
        Key::Add | Key::Sub | Key::Mul | Key::Div | Key::Pow | Key::Npr | Key::Ncr
    )
}

/// 綴りの語の列で、保留のいちばん上が閉じていない `(` なら、その位置。**1 つの計算の中では**
/// engine の演算子スタックの先頭が `(` であることと同じ——末尾から、閉じた組・数・後置関数・定数を
/// 飛ばし、最初に当たるのが二項演算子なら無し、閉じていない `(` ならそれ。
///
/// **`=` をまたぐと同じではない。** `spell` は `=` の印を `parts` に残さない(`Key::Eq` の腕は
/// バッファを流し込むだけ)ので、`( 3 = DEL` では前の計算の `(` を消すが、engine のスタックは
/// `=` で空になっていて何も消さない(旧規則の「末尾の `(` だけ」も `( = DEL` で同じ隙間を
/// 持っていた)。web は `=` で打鍵の列を切る(`ScientificPanel.tsx` の `press`)ので、この形は
/// 履歴の綴りに届かない。
fn top_open(parts: &[String]) -> Option<usize> {
    let mut depth = 0usize;
    for (i, part) in parts.iter().enumerate().rev() {
        match part.as_str() {
            ")" => depth += 1,
            "(" if depth > 0 => depth -= 1,
            "(" => return Some(i),
            p if depth == 0 && BINARY_GLYPHS.contains(&p) => return None,
            _ => {}
        }
    }
    None
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
///   直接代入し、`commit_entry` を経由しない(入力途中の値を捨てる)のを
///   そのまま写した分岐である。**0.9.2 以降、web はこの捨てる経路に
///   入力途中の値を持ち込まない**——engine が数字の入力中はこれらの
///   キーを拒否するようになり(0.9.2 設計書 §3.2 S1)、`press`(web 側)は
///   拒否されたキーを engine にも列にも渡さない。この分岐が残っているのは
///   `spell` が公開関数で、任意のキー列を渡す呼び出し元(テストなど)には
///   拒否が掛からないため。
///
/// **`del` は `Buffer::backspace` を呼ぶ**(`delete_one` と同じ)。
/// バッファが無ければ、**保留のいちばん上の、閉じていない `(`** を消す
/// (`delete_one` が演算子スタックの先頭の `(` を抜くのと同じ `(`)——
/// **その `(` のあとに値や閉じた組があっても消す**(`2 × ( π DEL + 1` は
/// 「2 × π + 1」、`2 × ( ( 3 ) DEL + 1` は「2 × ( 3 ) + 1」)。演算子は消えず、
/// 演算子が保留されていれば何も消さない(`3 + ( 4 ) DEL` は「3 + ( 4 )」のまま)。
/// 以前は末尾の `(` しか消さず、値の下の `(` が綴りに残って履歴の式が答えを
/// 生まなかった(0.9.2 設計書 §10 の既知の穴。利用者の裁定 2026-09-16、同 §9 の 12
/// ——綴りを engine に合わせ、engine は変えない)。
///
/// どの分岐も空の列に来ては何も起きない(**panic しない**)。
pub fn spell(keys: &[Key]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<Buffer> = None;
    // 押し直しの判定に使う: 直前に積んだ語が二項演算子で、そのあと `=` で計算が閉じて
    // いないか。`=` は綴りに何も足さないので、語の並びだけでは「閉じた」ことが見えない
    // ——`3 + = × 5` の `+` は訂正の対象ではない(engine の `finish` が演算子を使い切っている)。
    let mut open_operator = false;

    for &key in keys {
        match key {
            Key::Ac => {
                parts.clear();
                current = None;
                open_operator = false;
            }
            Key::Del => {
                // `delete_one`(engine/mod.rs)をそのまま辿る。バッファが無ければ、
                // engine が演算子スタックの先頭から抜く `(` を綴りからも抜く——末尾の語で
                // なくてもよい(値や閉じた組の下の `(`。利用者の裁定 2026-09-16、0.9.2 設計書
                // §10・§9 の 12)。`open_operator` には触らない: 押し直しは末尾の語が演算子の
                // ときにしか効かない。`(` の後ろに値や閉じた組があれば、消したあとも末尾はその
                // 値か `)` のままなので押し直しにならない(engine でも値のあとの演算子は訂正では
                // ない)。末尾の `(` を消せば、その前の演算子と真偽がそのまま戻る(`(` を消した
                // 直後の演算子は訂正。spell_table の `3 × ( DEL + 4` →「3 + 4」)。
                if let Some(buffer) = current.as_mut() {
                    if buffer.backspace() == Backspace::Exhausted {
                        current = None;
                    }
                } else if let Some(i) = top_open(&parts) {
                    parts.remove(i);
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
                // 入力途中の値を捨てる(`open_paren` と同じ)。0.9.2 以降、
                // web はここに入力途中の値を持ち込まない——engine が
                // 数字の入力中はこのキーを拒否し、`press` は拒否された
                // キーを渡さない。`spell` 自身は公開関数で拒否を知らない
                // ので、分岐は残す(上の註参照)。
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
                open_operator = false;
            }
            _ => {
                // 二項演算子・`)`・後置関数。
                commit_into(&mut current, &mut parts);
                // 演算子の直後の演算子は訂正(engine の `push_binop`)。綴りも最後の 1 つ
                // だけを残す(0.9.2 設計書 §9 の 9)。バッファがあれば上の行が数を流し込む
                // ので、ここで末尾が演算子なのは「演算子の直後から動いていない」ときだけ。
                // `=` は綴りに何も足さないので、`open_operator` フラグで「演算子がまだ開いている」
                // かどうかを判定する(engine の `finish` が演算子を消費したかどうか)。
                if is_binary(key)
                    && open_operator
                    && parts
                        .last()
                        .is_some_and(|part| BINARY_GLYPHS.contains(&part.as_str()))
                {
                    parts.pop();
                }
                if let Some(text) = commit_glyph(key) {
                    parts.push(text.to_string());
                }
                // 後置関数と `)` は二項ではないので、フラグを false にする。
                open_operator = is_binary(key);
            }
        }
    }
    commit_into(&mut current, &mut parts);
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_binary_glyphs_are_the_ones_commit_glyph_writes() {
        // `BINARY_GLYPHS` は `commit_glyph` の二項演算子の字面と同じでなければならない
        // ——片方だけ変えると押し直しの判定が黙って外れる。
        let binary: Vec<Key> = Key::ALL.iter().copied().filter(|&k| is_binary(k)).collect();
        assert_eq!(binary.len(), BINARY_GLYPHS.len());
        for key in binary {
            let glyph = commit_glyph(key).unwrap();
            assert!(BINARY_GLYPHS.contains(&glyph), "{key:?} → {glyph}");
        }
    }
}
