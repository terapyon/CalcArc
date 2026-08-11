use serde::{Deserialize, Serialize};

/// 電卓が受け取るキー。
///
/// 画面上のボタンと物理キーボードの両方がこの型に写像される。
/// 境界（WASM / JS）では `token()` の文字列で表現する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Digit(u8),
    Dot,
    Pi,
    Add,
    Sub,
    Mul,
    Div,
    Eq,
    LParen,
    RParen,
    J,
    PolarToggle,
    Sqrt,
    Sqr,
    Sin,
    Cos,
    Tan,
    Neg,
    Ac,
    Del,
    AngleToggle,
}

impl Key {
    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Key> {
        Some(match token {
            "0" => Key::Digit(0),
            "1" => Key::Digit(1),
            "2" => Key::Digit(2),
            "3" => Key::Digit(3),
            "4" => Key::Digit(4),
            "5" => Key::Digit(5),
            "6" => Key::Digit(6),
            "7" => Key::Digit(7),
            "8" => Key::Digit(8),
            "9" => Key::Digit(9),
            "dot" => Key::Dot,
            "pi" => Key::Pi,
            "add" => Key::Add,
            "sub" => Key::Sub,
            "mul" => Key::Mul,
            "div" => Key::Div,
            "eq" => Key::Eq,
            "lparen" => Key::LParen,
            "rparen" => Key::RParen,
            "j" => Key::J,
            "polar_toggle" => Key::PolarToggle,
            "sqrt" => Key::Sqrt,
            "sqr" => Key::Sqr,
            "sin" => Key::Sin,
            "cos" => Key::Cos,
            "tan" => Key::Tan,
            "neg" => Key::Neg,
            "ac" => Key::Ac,
            "del" => Key::Del,
            "angle_toggle" => Key::AngleToggle,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
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
            Key::Dot => "dot",
            Key::Pi => "pi",
            Key::Add => "add",
            Key::Sub => "sub",
            Key::Mul => "mul",
            Key::Div => "div",
            Key::Eq => "eq",
            Key::LParen => "lparen",
            Key::RParen => "rparen",
            Key::J => "j",
            Key::PolarToggle => "polar_toggle",
            Key::Sqrt => "sqrt",
            Key::Sqr => "sqr",
            Key::Sin => "sin",
            Key::Cos => "cos",
            Key::Tan => "tan",
            Key::Neg => "neg",
            Key::Ac => "ac",
            Key::Del => "del",
            Key::AngleToggle => "angle_toggle",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_round_trip() {
        let all = [
            Key::Digit(0),
            Key::Digit(7),
            Key::Digit(9),
            Key::Dot,
            Key::Pi,
            Key::Add,
            Key::Sub,
            Key::Mul,
            Key::Div,
            Key::Eq,
            Key::LParen,
            Key::RParen,
            Key::J,
            Key::PolarToggle,
            Key::Sqrt,
            Key::Sqr,
            Key::Sin,
            Key::Cos,
            Key::Tan,
            Key::Neg,
            Key::Ac,
            Key::Del,
            Key::AngleToggle,
        ];
        for key in all {
            assert_eq!(Key::from_token(key.token()), Some(key), "{:?}", key);
        }
    }

    #[test]
    fn unknown_tokens_are_rejected() {
        assert_eq!(Key::from_token("nope"), None);
        assert_eq!(Key::from_token(""), None);
    }
}
