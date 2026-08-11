use serde::{Deserialize, Serialize};

use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;

/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 本スライスでは保存しないが、後から足すと既存データが扱えなくなるため
/// 最初から持たせておく（設計書 §4.4）。
pub const STATE_SCHEMA: u32 = 1;

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

    /// 末尾 1 文字を削る。空になったら true を返し、呼び出し側が
    /// Buffer 自体を破棄する。
    pub fn pop(&mut self) -> bool {
        self.digits.pop();
        self.digits.is_empty()
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
