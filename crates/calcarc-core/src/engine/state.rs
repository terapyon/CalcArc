use serde::{Deserialize, Serialize};

use crate::{AngleMode, CalcError, CalcResult, Value};

/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 本スライスでは保存しないが、後から足すと既存データが扱えなくなるため
/// 最初から持たせておく（設計書 §4.4）。
/// 4: `Buffer` に指数部が入った(設計書 §2)。直列化の形が変わったので上げた。
/// 形を変えたら上げる——上げないと、旧い形の状態が届いたときの初期化が
/// serde の解析失敗という事故として起き、意図した挙動と区別できなくなる。
pub const STATE_SCHEMA: u32 = 4;

/// 入力欄に打ち込める最大文字数。
const MAX_ENTRY_LEN: usize = 12;

/// 指数部に打てる桁数。f64 の定義域(約 1e±308)を打鍵で覆える 3 桁にする
/// (設計書 §2)。2 桁だと golden の境界ケースを手で再現できない。
const MAX_EXPONENT_LEN: usize = 3;

/// 表示形式。`▸∠` で切り替わる。値そのものには影響しない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayForm {
    Rect,
    Polar,
}

impl DisplayForm {
    pub fn toggled(self) -> DisplayForm {
        match self {
            DisplayForm::Rect => DisplayForm::Polar,
            DisplayForm::Polar => DisplayForm::Rect,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
}

impl BinOp {
    /// 大きいほど先に評価される（設計書 D9）。
    pub fn precedence(self) -> u8 {
        match self {
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul | BinOp::Div => 2,
        }
    }
}

/// 演算子スタックに積まれるもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpToken {
    Op(BinOp),
    OpenParen,
}

/// 入力中の指数部。`Exp` を押した時点で、桁が無いまま存在する。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Exponent {
    pub digits: String,
    pub negative: bool,
}

/// 入力中の数値。確定するまで Value にならない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Buffer {
    /// 打鍵された文字列。`"3"`, `"3.1"`, `""`（j の直後）。
    pub digits: String,
    /// `j` が押されて虚部として入力中か。
    pub imaginary: bool,
    /// `Exp` を押してから確定するまでの指数部(設計書 §2)。
    pub exponent: Option<Exponent>,
}

/// `backspace` が何を消したか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backspace {
    /// 1 文字消した。バッファはまだ生きている。
    Removed,
    /// 消すものが尽きた。呼び出し側はバッファごと破棄してよい。
    Exhausted,
}

impl Buffer {
    pub fn imaginary() -> Buffer {
        Buffer {
            imaginary: true,
            ..Buffer::default()
        }
    }

    /// 確定値。`j` だけで数字がなければ j1 と解釈する（設計書 §4.3）。
    /// `Exp` だけの場合も仮数 1 とする(実機と同じ)。
    ///
    /// 指数を付けた結果が f64 の範囲を超えたら Overflow(設計書 §2)。
    /// **打鍵の途中ではなく、値になる瞬間に返す**——`1e30` を打つ途中に
    /// `1e3` を経由するのと同じで、途中経過をエラーにはしない。
    pub fn value(&self) -> CalcResult<Value> {
        let mantissa = if self.digits.is_empty() {
            "1".to_string()
        } else {
            self.digits.clone()
        };
        let text = match &self.exponent {
            // 桁の無い指数は指数なしと同じ。
            Some(e) if !e.digits.is_empty() => format!(
                "{mantissa}e{}{}",
                if e.negative { "-" } else { "" },
                e.digits
            ),
            _ => mantissa,
        };
        let n: f64 = text.parse().map_err(|_| CalcError::SyntaxError)?;
        if !n.is_finite() {
            return Err(CalcError::Overflow);
        }
        Ok(if self.imaginary {
            Value::imag(n)
        } else {
            Value::real(n)
        })
    }

    /// 入力中に表示する文字列。打鍵した通りに見せる。
    pub fn text(&self) -> String {
        let mantissa = if !self.digits.is_empty() {
            self.digits.clone()
        } else if self.exponent.is_some() {
            // 仮数なしの Exp は仮数 1(実機と同じ)。値と表示を揃える。
            "1".to_string()
        } else if self.imaginary {
            String::new()
        } else {
            "0".to_string()
        };
        let exponent = match &self.exponent {
            Some(e) => format!("e{}{}", if e.negative { "-" } else { "" }, e.digits),
            None => String::new(),
        };
        let head = if self.imaginary { "j" } else { "" };
        format!("{head}{mantissa}{exponent}")
    }

    /// 打鍵された数字があるか。j の切り替え条件(設計書 §1)。
    pub fn has_digits(&self) -> bool {
        !self.digits.is_empty()
    }

    /// 実部と虚部を切り替える。数字はそのまま残す。
    pub fn toggle_imaginary(&mut self) {
        self.imaginary = !self.imaginary;
    }

    pub fn push_digit(&mut self, d: u8) {
        if d > 9 {
            // Key::Digit は pub なので範囲外の値を構築できる。from_token は
            // 0..=9 しか作らないが、直接渡されると (b'0' + d) が桁上がりして
            // panic する。このクレートは panic しないと約束している。
            return;
        }
        let digit = (b'0' + d) as char;
        // 指数入力中は指数へ入る(設計書 §2)。先頭ゼロの規則は仮数と共通。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.len() >= MAX_EXPONENT_LEN {
                return;
            }
            if exponent.digits == "0" {
                exponent.digits.clear();
            }
            exponent.digits.push(digit);
            return;
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return;
        }
        // 先頭の 0 は次の数字で置き換える。"0" -> "5" であって "05" ではない。
        if self.digits == "0" {
            self.digits.clear();
        }
        self.digits.push(digit);
    }

    /// `000`。0 を 3 つ入れる。字数制限に収まるぶんだけ入り、先頭ゼロの
    /// 規則も 1 つずつ押したときと同じになる(設計書 §3)。
    pub fn push_zeros(&mut self) {
        for _ in 0..3 {
            self.push_digit(0);
        }
    }

    /// `Exp`。すでに指数入力中なら何もしない(連打は無視)。
    pub fn push_exponent(&mut self) {
        self.exponent.get_or_insert_with(Exponent::default);
    }

    /// `+/−`。指数入力中なら指数の符号を反転して true を返す。そうでなければ
    /// 何もせず false——呼び出し側が確定値の符号を反転する(設計書 §2)。
    pub fn toggle_exponent_sign(&mut self) -> bool {
        match self.exponent.as_mut() {
            Some(exponent) => {
                exponent.negative = !exponent.negative;
                true
            }
            None => false,
        }
    }

    pub fn push_dot(&mut self) -> CalcResult<()> {
        if self.exponent.is_some() {
            // 指数は整数。小数点は無視する(打ち間違いで計算を止めない)。
            return Ok(());
        }
        if self.digits.contains('.') {
            return Err(CalcError::SyntaxError);
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return Ok(());
        }
        if self.digits.is_empty() {
            self.digits.push('0');
        }
        self.digits.push('.');
        Ok(())
    }

    /// 末尾 1 文字を削る。
    ///
    /// 虚数入力では数字が尽きても j マーカーを残す。ここで一緒に捨てると
    /// `3 + j4 DEL 5 =` が 3+j5 ではなく 3+5 になり、何を計算しているかが
    /// 黙って変わる。j を消すにはもう一度 DEL を押す。
    pub fn backspace(&mut self) -> Backspace {
        // 段は 指数の桁 → e マーカー → 仮数の文字 → j マーカー の順
        // (設計書 §2)。一度に 1 段だけ戻す。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.pop().is_some() {
                return Backspace::Removed;
            }
            self.exponent = None;
            return Backspace::Removed;
        }
        if self.digits.pop().is_some() {
            if self.digits.is_empty() && !self.imaginary {
                return Backspace::Exhausted;
            }
            return Backspace::Removed;
        }
        // 数字はもう無い。残っているのは j だけなので、これで破棄してよい。
        Backspace::Exhausted
    }
}

/// 電卓の全状態。Rust はこれを保持せず、呼び出しごとに受け渡す（設計書 D7）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineState {
    pub schema: u32,
    /// 入力中の数値。None なら `current` が表示される。
    pub buffer: Option<Buffer>,
    /// 確定している現在値。
    pub current: Value,
    /// 保留中の被演算数。
    pub operands: Vec<Value>,
    /// 保留中の演算子と開き括弧。
    pub operators: Vec<OpToken>,
    pub angle: AngleMode,
    pub form: DisplayForm,
    /// Some のあいだは AC 以外のキーを受け付けない。
    pub error: Option<CalcError>,
    /// 二項演算子の直後に居るか。演算子を続けて押したときに差し替える
    /// ための判定に使う。
    ///
    /// 「直前のキーが演算子だったか」ではない。入力中の文字や `(` は
    /// 居場所を動かさないので、この旗を落とさない。DEL で入力を消せば
    /// 演算子の直後に戻るのだから、落としてはいけない。差し替えてよい
    /// 状態かどうかは、この旗と `buffer` / `operators` の形を併せて
    /// `push_binop` が決める。
    pub operator_pending: bool,
}

impl EngineState {
    pub fn initial() -> EngineState {
        EngineState {
            schema: STATE_SCHEMA,
            buffer: None,
            current: Value::ZERO,
            operands: Vec::new(),
            operators: Vec::new(),
            angle: AngleMode::Deg,
            form: DisplayForm::Rect,
            error: None,
            operator_pending: false,
        }
    }

    /// 角度モードと表示形式は利用者の設定なので AC で戻さない。
    pub fn cleared(&self) -> EngineState {
        EngineState {
            angle: self.angle,
            form: self.form,
            ..EngineState::initial()
        }
    }

    pub fn is_valid(&self) -> bool {
        self.schema == STATE_SCHEMA
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_digit_ignores_an_out_of_range_digit() {
        // Key::Digit は pub なので範囲外の値を構築できる。(b'0' + d) が
        // 桁上がりして panic しないことを確認する。
        let mut buffer = Buffer::default();
        buffer.push_digit(250);
        assert_eq!(buffer, Buffer::default());
    }
}
