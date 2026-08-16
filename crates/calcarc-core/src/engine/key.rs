use serde::{Deserialize, Serialize};

/// 電卓が受け取るキー。
///
/// 画面上のボタンと物理キーボードの両方がこの型に写像される。
/// 境界（WASM / JS）では `token()` の文字列で表現する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Digit(u8),
    Dot,
    /// 0 を 3 つまとめて入れる(設計書 §3)。
    Zeros3,
    /// 指数入力(設計書 §2)。仮数と指数を分ける唯一のキー。
    Exp,
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
    /// 工学表記(ENG)のトグル。表示の切り替えであって計算ではない(設計書 §4)。
    EngToggle,
    /// xʸ。二項演算子であって後置関数ではない(S-1 設計書 §3.1)。
    Pow,
    /// 自然対数。
    Ln,
    /// 常用対数。
    Log10,
    /// e の x 乗。**`Key::Exp`(指数入力 EE)とは別物**(S-1 設計書 §3)。
    ExpE,
    /// 逆数。
    Recip,
    Asin,
    Acos,
    Atan,
    /// 自然対数の底。π と同じ「値そのもの」のキー。
    E,
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
            "zeros3" => Key::Zeros3,
            "exp" => Key::Exp,
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
            "eng" => Key::EngToggle,
            "pow" => Key::Pow,
            "ln" => Key::Ln,
            "log10" => Key::Log10,
            "exp_e" => Key::ExpE,
            "recip" => Key::Recip,
            "asin" => Key::Asin,
            "acos" => Key::Acos,
            "atan" => Key::Atan,
            "e" => Key::E,
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
            Key::Zeros3 => "zeros3",
            Key::Exp => "exp",
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
            Key::EngToggle => "eng",
            Key::Pow => "pow",
            Key::Ln => "ln",
            Key::Log10 => "log10",
            Key::ExpE => "exp_e",
            Key::Recip => "recip",
            Key::Asin => "asin",
            Key::Acos => "acos",
            Key::Atan => "atan",
            Key::E => "e",
        }
    }
}

impl Key {
    /// このエンジンが受け取るキーの全体。
    ///
    /// トークン表と fuzz テストがこれを参照する。キーを増やしたときに
    /// ここを直し忘れると `tokens_round_trip` が落ちるので、fuzz が
    /// 新しいキーを黙って生成しなくなる事故を防げる。
    pub const ALL: [Key; 42] = [
        Key::Digit(0),
        Key::Digit(1),
        Key::Digit(2),
        Key::Digit(3),
        Key::Digit(4),
        Key::Digit(5),
        Key::Digit(6),
        Key::Digit(7),
        Key::Digit(8),
        Key::Digit(9),
        Key::Dot,
        Key::Zeros3,
        Key::Exp,
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
        Key::EngToggle,
        Key::Pow,
        Key::Ln,
        Key::Log10,
        Key::ExpE,
        Key::Recip,
        Key::Asin,
        Key::Acos,
        Key::Atan,
        Key::E,
    ];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_round_trip() {
        for key in Key::ALL {
            assert_eq!(Key::from_token(key.token()), Some(key), "{:?}", key);
        }

        let unique_tokens: std::collections::HashSet<&str> =
            Key::ALL.iter().map(|key| key.token()).collect();
        assert_eq!(unique_tokens.len(), Key::ALL.len());
    }

    #[test]
    fn unknown_tokens_are_rejected() {
        assert_eq!(Key::from_token("nope"), None);
        assert_eq!(Key::from_token(""), None);
    }
}
