//! Data Scale Calculator の計算コア(base-spec §14〜§17)。
//!
//! Scientific とは数値型を共有しない(設計書 §1、issue #7 の決定)。
//! バイト数は Exact Integer(§24)であり、u128 の checked 演算で持つ。
//! あふれは黙って折り返さず Overflow にする(§25)。

use crate::{CalcError, CalcResult};

pub mod format;
pub mod llm;

/// 要素のデータ型(base-spec §16 の 9 種)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataType {
    Int8,
    Uint8,
    Int16,
    Float16,
    Bfloat16,
    Int32,
    Float32,
    Int64,
    Float64,
}

impl DataType {
    /// 境界(WASM / JS)とテストが参照する全体。
    pub const ALL: [DataType; 9] = [
        DataType::Int8,
        DataType::Uint8,
        DataType::Int16,
        DataType::Float16,
        DataType::Bfloat16,
        DataType::Int32,
        DataType::Float32,
        DataType::Int64,
        DataType::Float64,
    ];

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<DataType> {
        Some(match token {
            "int8" => DataType::Int8,
            "uint8" => DataType::Uint8,
            "int16" => DataType::Int16,
            "float16" => DataType::Float16,
            "bfloat16" => DataType::Bfloat16,
            "int32" => DataType::Int32,
            "float32" => DataType::Float32,
            "int64" => DataType::Int64,
            "float64" => DataType::Float64,
            _ => return None,
        })
    }

    /// 境界（WASM / JS）へ渡す文字列トークン。`from_token` の逆写像。
    pub fn token(self) -> &'static str {
        match self {
            DataType::Int8 => "int8",
            DataType::Uint8 => "uint8",
            DataType::Int16 => "int16",
            DataType::Float16 => "float16",
            DataType::Bfloat16 => "bfloat16",
            DataType::Int32 => "int32",
            DataType::Float32 => "float32",
            DataType::Int64 => "int64",
            DataType::Float64 => "float64",
        }
    }

    /// 要素 1 つのバイト数。
    pub fn bytes_per_element(self) -> u128 {
        match self {
            DataType::Int8 | DataType::Uint8 => 1,
            DataType::Int16 | DataType::Float16 | DataType::Bfloat16 => 2,
            DataType::Int32 | DataType::Float32 => 4,
            DataType::Int64 | DataType::Float64 => 8,
        }
    }
}

/// 10 進数字列を u128 にする。
///
/// 空・数字以外・u128 の上限超は SyntaxError。先頭ゼロは許す。
/// 符号・小数点・区切り文字は受け付けない(フォームの入力は数字だけ)。
pub fn parse_count(text: &str) -> CalcResult<u128> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CalcError::SyntaxError);
    }
    text.parse::<u128>().map_err(|_| CalcError::SyntaxError)
}

/// count × dimensions × 要素サイズ。あふれたら Overflow(base-spec §25)。
pub fn size_in_bytes(count: u128, dimensions: u128, dtype: DataType) -> CalcResult<u128> {
    count
        .checked_mul(dimensions)
        .and_then(|elements| elements.checked_mul(dtype.bytes_per_element()))
        .ok_or(CalcError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_headline_case_in_bytes() {
        // 100M × 768 × float32（設計書 §0、base-spec §49 M4）
        let bytes = size_in_bytes(100_000_000, 768, DataType::Float32).unwrap();
        assert_eq!(bytes, 307_200_000_000);
    }

    #[test]
    fn every_type_has_its_size() {
        let expect: [(DataType, u128); 9] = [
            (DataType::Int8, 1),
            (DataType::Uint8, 1),
            (DataType::Int16, 2),
            (DataType::Float16, 2),
            (DataType::Bfloat16, 2),
            (DataType::Int32, 4),
            (DataType::Float32, 4),
            (DataType::Int64, 8),
            (DataType::Float64, 8),
        ];
        for (t, size) in expect {
            assert_eq!(t.bytes_per_element(), size, "{:?}", t);
        }
    }

    #[test]
    fn tokens_round_trip() {
        for t in DataType::ALL {
            assert_eq!(DataType::from_token(t.token()), Some(t), "{:?}", t);
        }
        assert_eq!(DataType::from_token("float128"), None);
        assert_eq!(DataType::from_token(""), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_wrap() {
        // 2^127 × 2 × 1 byte = 2^128 はあふれる（base-spec §25）。
        let big = 1u128 << 127;
        assert_eq!(
            size_in_bytes(big, 2, DataType::Uint8),
            Err(CalcError::Overflow)
        );
        // ぎりぎり下は通る。
        assert!(size_in_bytes(big - 1, 2, DataType::Uint8).is_ok());
    }

    #[test]
    fn parse_rejects_what_is_not_a_count() {
        assert_eq!(parse_count(""), Err(CalcError::SyntaxError));
        assert_eq!(parse_count("12a"), Err(CalcError::SyntaxError));
        assert_eq!(parse_count("-1"), Err(CalcError::SyntaxError));
        assert_eq!(parse_count("1.5"), Err(CalcError::SyntaxError));
        // u128 の上限を 1 だけ超える 10 進表記。
        assert_eq!(
            parse_count("340282366920938463463374607431768211456"),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(parse_count("0"), Ok(0));
        assert_eq!(parse_count("007"), Ok(7)); // 先頭ゼロは可（設計書 §2）
    }

    #[test]
    fn zero_count_is_a_valid_input() {
        assert_eq!(size_in_bytes(0, 768, DataType::Float32), Ok(0));
    }
}
