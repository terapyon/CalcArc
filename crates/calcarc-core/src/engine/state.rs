use serde::{Deserialize, Serialize};

use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;

/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 本スライスでは保存しないが、後から足すと既存データが扱えなくなるため
/// 最初から持たせておく（設計書 §4.4）。
pub const STATE_SCHEMA: u32 = 2;

/// 入力欄に打ち込める最大文字数。
const MAX_ENTRY_LEN: usize = 12;

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

/// 入力中の数値。確定するまで Value にならない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Buffer {
    /// 打鍵された文字列。`"3"`, `"3.1"`, `""`（j の直後）。
    pub digits: String,
    /// `j` が押されて虚部として入力中か。
    pub imaginary: bool,
}

impl Buffer {
    pub fn imaginary() -> Buffer {
        Buffer {
            digits: String::new(),
            imaginary: true,
        }
    }

    /// 確定値。`j` だけで数字がなければ j1 と解釈する（設計書 §4.3）。
    pub fn value(&self) -> Value {
        let n = if self.digits.is_empty() {
            1.0
        } else {
            self.digits.parse::<f64>().unwrap_or(0.0)
        };
        if self.imaginary {
            Value::imag(n)
        } else {
            Value::real(n)
        }
    }

    /// 入力中に表示する文字列。打鍵した通りに見せる。
    pub fn text(&self) -> String {
        if self.imaginary {
            format!("j{}", self.digits)
        } else if self.digits.is_empty() {
            "0".to_string()
        } else {
            self.digits.clone()
        }
    }

    pub fn push_digit(&mut self, d: u8) {
        if d > 9 {
            // Key::Digit は pub なので範囲外の値を構築できる。from_token は
            // 0..=9 しか作らないが、直接渡されると (b'0' + d) が桁上がりして
            // panic する。このクレートは panic しないと約束している。
            return;
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return;
        }
        // 先頭の 0 は次の数字で置き換える。"0" -> "5" であって "05" ではない。
        if self.digits == "0" {
            self.digits.clear();
        }
        self.digits.push((b'0' + d) as char);
    }

    pub fn push_dot(&mut self) -> CalcResult<()> {
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

    /// 末尾 1 文字を削る。バッファごと破棄してよいときに true を返す。
    ///
    /// 虚数入力では数字が尽きても j マーカーを残す。ここで一緒に捨てると
    /// `3 + j4 DEL 5 =` が 3+j5 ではなく 3+5 になり、何を計算しているかが
    /// 黙って変わる。j を消すにはもう一度 DEL を押す。
    pub fn pop(&mut self) -> bool {
        if self.digits.pop().is_some() {
            return self.digits.is_empty() && !self.imaginary;
        }
        // 数字はもう無い。残っているのは j だけなので、これで破棄してよい。
        true
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
