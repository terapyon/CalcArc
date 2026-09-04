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
//!
//! **`del` は文字列の形から推測しない。** かつては「最後の部分が数字の
//! 形をしているか」を見て `del` の効果を決めていたが、これは**4 回**
//! 同じ形で壊れた——`zeros3`(1 打鍵 3 文字が 1 打鍵で消える)、演算子
//! (消えないはずの `+` が消える)、`dms`(区切りが消えない)、
//! `j`/`Exp`(段の途中で止まるはずが、末尾の 1 部分しか見ない形では
//! 2 段目に進めない)。**文字列の形は、`engine/state.rs` の `Buffer` が
//! 実際に持つ段の形とは違う情報**であり、形が偶然一致する範囲でしか
//! 動かない(Fix round 4 finding A)。
//!
//! 代わりに、`Entry` が `Buffer` と同じだけの段(仮数の文字・指数・
//! 60 進の確定段・虚部フラグ)を持ち、`del` は `Buffer::backspace`
//! (`engine/state.rs`)と同じ優先順位(指数の桁 → `Exp` マーカー →
//! 仮数の文字 → 60 進の区切り → `j` マーカー)で 1 段だけ戻す。
//! **どのキーが `Entry` を開き、どのキーが確定させるか**は
//! `engine/mod.rs` の `apply()` と `commit_entry` の呼び出し元を
//! そのまま写した(下の各 `match` アームのコメントを見ること)。

use super::key::Key;

/// 60 進の区切り(`dms`)を綴りの中で表す 1 文字。
///
/// **表示層(`display.rs`)が進める `°′″` の段は真似ない。** 真似ると
/// 区切りの段数を数える追加の状態が要り、`Entry` を「`Buffer` の
/// 写し」以上に太らせる。**同じ 1 文字を毎回使う**——`Buffer` が
/// 区切り 1 回を「段 1 つ」として数えるのと同じ 1 対 1 の対応を保てば、
/// `del` の回数は自然に一致する(下の `dms_marks_a_segment_boundary_
/// while_entering_a_number` テストが検算している)。
const DMS_MARKER: char = '°';

/// 現在入力中の 1 件の写し。`engine/state.rs` の `Buffer` と同じ形の
/// フィールドだけを持つ——値は計算しない。
#[derive(Default, Clone)]
struct Entry {
    /// 仮数の文字(数字・`.`)。`Buffer::digits` と同じ。
    digits: String,
    /// `j` が押されて虚部入力中か。`Buffer::imaginary` と同じ。
    imaginary: bool,
    /// **綴りだけが要る追加情報。** `imaginary` が立った時点で仮数に
    /// 数字が無かったか(`add` の直後に `j` を押すなど、新しい虚部入力を
    /// 始めた場合)を持つ。`j` はその場合だけ数字の**前**に綴る
    /// (`3 + j 4` のように、打った順そのまま)。既存の数字を `j` で
    /// 虚部へ切り替えた場合(`3 j` のような打鍵)は数字の**後**に綴る。
    /// `Buffer` 自身は打鍵の順を持たない(値には関係ないため)ので、
    /// これは `Buffer` の写しではなく `spell` だけの追加状態である。
    j_before_digits: bool,
    /// 指数入力中なら `Some(その桁の文字列)`。`Buffer::exponent` と同じ形
    /// ——符号は持たない。`toggle_exponent_sign` は bool を反転する
    /// だけで文字を増やさないので、`del` が消せる段を作らない
    /// (綴りにも符号の記号は無い)。
    exponent: Option<String>,
    /// 60 進で確定した段。`Buffer::sexagesimal` と同じ。
    sexagesimal: Vec<String>,
}

/// `Buffer::backspace` が返す `Backspace` と同じ形。
#[derive(PartialEq, Eq)]
enum Backspace {
    /// 1 段消した。`Entry` はまだ生きている。
    Removed,
    /// 消すものが尽きた。呼び出し側が `Entry` ごと捨ててよい。
    Discard,
}

/// 1 桁を、指数入力中なら指数へ、そうでなければ仮数へ積む。
///
/// **先頭ゼロの置き換え(`Buffer::push_digit` の `"0"->"5"` 規則)は
/// 綴らない。** `Buffer` はそこで値を正規化するが、`spell` は「打った
/// 通りに並べる」(§4a)——`calcarc-wasm/tests/label_parity.rs` が
/// これを固定している: `zeros3` を単独で押した綴りは盤面のラベル
/// (`"000"`)と一致しなければならず、正規化を綴ると `"0"` になって
/// 一致しなくなる(実測で確認)。
fn push_digit_char(entry: &mut Entry, ch: char) {
    let target = match entry.exponent.as_mut() {
        Some(exponent) => exponent,
        None => &mut entry.digits,
    };
    target.push(ch);
}

/// `.`。指数入力中は無視(`Buffer::push_dot` と同じ)。**2 つ目の `.` も
/// 無視する**——`push_dot` はそこで `SyntaxError` を返すが、`spell` は
/// エラー状態を再現しない。ここで数字を増やさないのは、増やすと以後の
/// `del` の回数が実物の桁数とずれるからである(同じ欠陥の形)。
///
/// **先頭の暗黙の `0`(`Buffer::push_dot` の `if digits.is_empty()`)は
/// 綴らない。** これも `push_digit_char` と同じ理由——`label_parity.rs`
/// は `dot` を単独で押した綴りが盤面のラベル(`"."`)と一致することを
/// 固定しており、暗黙の `0` を足すと `"0."` になって一致しなくなる。
fn push_dot_char(entry: &mut Entry) {
    if entry.exponent.is_some() {
        return;
    }
    if entry.digits.contains('.') {
        return;
    }
    entry.digits.push('.');
}

/// `Exp`。連打・60 進入力中は無視(`Buffer::push_exponent` と同じ)。
fn open_exponent(entry: &mut Entry) {
    if entry.exponent.is_some() || !entry.sexagesimal.is_empty() {
        return;
    }
    entry.exponent = Some(String::new());
}

/// `°'"` が区切りとして働けるか。`Buffer::try_push_sexagesimal_separator`
/// と同じ条件(指数入力中でなく、段が 2 つ未満)。
fn try_push_separator(entry: &mut Entry) -> bool {
    if entry.exponent.is_some() || entry.sexagesimal.len() >= 2 {
        return false;
    }
    entry.sexagesimal.push(std::mem::take(&mut entry.digits));
    true
}

/// `del` を 1 回分。`Buffer::backspace` と同じ優先順位・同じ条件。
fn backspace_entry(entry: &mut Entry) -> Backspace {
    if let Some(exponent) = entry.exponent.as_mut() {
        if exponent.pop().is_some() {
            return Backspace::Removed;
        }
        entry.exponent = None;
        return Backspace::Removed;
    }
    if entry.digits.pop().is_some() {
        if entry.digits.is_empty() && !entry.imaginary && entry.sexagesimal.is_empty() {
            return Backspace::Discard;
        }
        return Backspace::Removed;
    }
    if let Some(previous) = entry.sexagesimal.pop() {
        entry.digits = previous;
        return Backspace::Removed;
    }
    Backspace::Discard
}

/// `Entry` を、打った順のトークン列に直す。
fn render_entry(entry: &Entry) -> Vec<String> {
    let mut tokens = Vec::new();
    if entry.imaginary && entry.j_before_digits {
        tokens.push("j".to_string());
    }
    if !entry.digits.is_empty() || !entry.sexagesimal.is_empty() {
        let mut mantissa = String::new();
        for stage in &entry.sexagesimal {
            mantissa.push_str(stage);
            mantissa.push(DMS_MARKER);
        }
        mantissa.push_str(&entry.digits);
        tokens.push(mantissa);
    }
    if let Some(exponent_digits) = &entry.exponent {
        tokens.push("Exp".to_string());
        if !exponent_digits.is_empty() {
            tokens.push(exponent_digits.clone());
        }
    }
    if entry.imaginary && !entry.j_before_digits {
        tokens.push("j".to_string());
    }
    tokens
}

/// 開いている `Entry` を `parts` へ流し込み、閉じる。`commit_entry`
/// (`engine/mod.rs`)と同じ——`Entry` が無ければ何もしない。
fn commit_into(current: &mut Option<Entry>, parts: &mut Vec<String>) {
    if let Some(entry) = current.take() {
        parts.extend(render_entry(&entry));
    }
}

/// 数字 1 桁の文字。範囲外は `'0'`(`calcarc-core` は panic しない)。
fn digit_char(d: u8) -> char {
    match d {
        0 => '0',
        1 => '1',
        2 => '2',
        3 => '3',
        4 => '4',
        5 => '5',
        6 => '6',
        7 => '7',
        8 => '8',
        9 => '9',
        _ => '0',
    }
}

/// `Entry` を確定させたあと、固定の語を 1 つだけ足すキーの綴り。
///
/// ここに来るのは、`apply()`(`engine/mod.rs`)で `commit_entry` を呼ぶ
/// キー(二項演算子・`)`・後置関数)のうち、専用の分岐を持たないもの
/// だけである。`Eq` は綴りに何も足さない(列を閉じるだけ)。
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
/// ——`Entry` も一緒に捨てる)。
///
/// **開く・確定する・捨てるの 3 通り**(`apply()` を読んで分けた):
/// - **開く/伸ばす**(`Entry` を作る・書き足す): 数字・`.`・`000`・
///   `Exp`・`j`・`°'"`(`Entry` が既にあるときだけ)
/// - **確定する**(`Entry` を `parts` へ流し込み、`None` にする):
///   二項演算子・`=`・`)`・後置関数・仮数の符号としての `+/−`
/// - **捨てる**(`Entry` を流し込まずに `None` にする): `(`・`π`・`e`
///   ——`open_paren`/`Key::Pi`/`Key::E` が `state.buffer = None` を
///   直接代入し、`commit_entry` を経由しない(入力途中の値を捨てる)
///   のと同じ。押しかけの数字が式に残らない
///   (`engine_table.rs:858` の `["3","lparen","del"]` == "0" が
///   この「捨てる」を要求している——"3" を確定させていたら del は
///   "3" を残してしまう)。
///
/// **`del` は `Buffer::backspace` と同じ優先順位で 1 段だけ戻す**
/// (`backspace_entry`)。`Entry` が無ければ、先頭の開き括弧だけを
/// (`delete_one` の唯一の例外)——演算子は消えない。
///
/// どの分岐も空の列に来ては何も起きない(**panic しない**)。
pub fn spell(keys: &[Key]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<Entry> = None;

    for &key in keys {
        match key {
            Key::Ac => {
                parts.clear();
                current = None;
            }
            Key::Del => {
                if let Some(entry) = current.as_mut() {
                    if backspace_entry(entry) == Backspace::Discard {
                        current = None;
                    }
                } else if parts.last().map(String::as_str) == Some("(") {
                    parts.pop();
                }
            }
            Key::Digit(d) => {
                push_digit_char(current.get_or_insert_with(Entry::default), digit_char(d));
            }
            Key::Dot => {
                push_dot_char(current.get_or_insert_with(Entry::default));
            }
            Key::Zeros3 => {
                let entry = current.get_or_insert_with(Entry::default);
                for _ in 0..3 {
                    push_digit_char(entry, '0');
                }
            }
            Key::Exp => {
                open_exponent(current.get_or_insert_with(Entry::default));
            }
            Key::J => match current.as_mut() {
                // **数字があれば切り替え**(設計書 §1)。`j` 自身は文字を
                // 増やさない——`del` の段は増えない。
                Some(entry) if !entry.digits.is_empty() => {
                    entry.imaginary = !entry.imaginary;
                    if entry.imaginary {
                        entry.j_before_digits = false;
                    }
                }
                // **数字が無ければ新しい虚部入力**——`Buffer::imaginary()`
                // が指数・60 進も含めてまるごと置き換えるのと同じ
                // (`has_digits` は仮数の数字だけを見る)。
                _ => {
                    current = Some(Entry {
                        imaginary: true,
                        j_before_digits: true,
                        ..Entry::default()
                    });
                }
            },
            Key::Dms => {
                // `Entry` が無ければ表示トグル(値に触れない、無音)。
                if let Some(entry) = current.as_mut() {
                    let _ = try_push_separator(entry);
                }
            }
            Key::Neg if current.as_ref().is_some_and(|e| e.exponent.is_some()) => {
                // 指数入力中は指数の符号を反転するだけ(設計書 §2)。
                // 文字を足さないので `Entry` は確定させない(del の段も
                // 増えない)。
            }
            Key::LParen => {
                // 入力途中の値を捨てる(`open_paren` と同じ。上のコメント
                // 参照)。
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
                // 表示だけを変える。`Entry` にも `parts` にも触れない。
            }
            Key::Eq => {
                commit_into(&mut current, &mut parts);
            }
            _ => {
                // 二項演算子・`)`・後置関数・仮数の符号としての `+/−`。
                commit_into(&mut current, &mut parts);
                if let Some(text) = commit_glyph(key) {
                    parts.push(text.to_string());
                }
            }
        }
    }
    if let Some(entry) = current {
        parts.extend(render_entry(&entry));
    }
    parts.join(" ")
}
