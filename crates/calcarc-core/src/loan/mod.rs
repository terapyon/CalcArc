//! Loan Calculator の計算コア(base-spec §20〜§21、設計書 2026-08-13)。
//!
//! 製品方針は**決定的概算**(設計書 §0): 実額の機関一致は非目標で、
//! 同じ入力が常に同じ答を返すことを保証する。数値経路は 2 本ある:
//!
//! - **償還表**(`schedule`)は厳密整数だけで走る。各行利息は
//!   floor(残高×分子/分母) を u128 中間で計算し、f64 を通さない(設計書 §1-1)。
//! - **f64 は閉形式の月額決定にのみ使う**(設計書 §1-3)。逆算でも f64 は
//!   候補を出すだけで、答は厳密償還表が確定する(設計書 §5)。
//!
//! `Value`/`engine`/`data_scale` とは相互 import しない(設計書 §9)。
//! 共有するのはエラー分類(`CalcError`)だけ。

use crate::{CalcError, CalcResult};

pub mod bonus;
pub mod closed_form;
pub mod forward;
pub mod inverse;
pub mod rate;
pub mod schedule;

/// 10 進数字列を円(u64)にする。`data_scale::parse_count` と同じ流儀。
///
/// 空・数字以外・u64 の上限超は SyntaxError。先頭ゼロは許す。符号・小数点・
/// 区切り文字は受け付けない(フォームの入力は数字だけ)。境界(WASM)で
/// 文字列を使うのは、円が JS の number(2^53)を超えうるためである。
pub fn parse_yen(text: &str) -> CalcResult<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CalcError::SyntaxError);
    }
    text.parse::<u64>().map_err(|_| CalcError::SyntaxError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yen_parsing_takes_digits_only() {
        assert_eq!(parse_yen("0"), Ok(0));
        assert_eq!(parse_yen("007"), Ok(7));
        assert_eq!(parse_yen("18446744073709551615"), Ok(u64::MAX));
        for bad in [
            "",
            "abc",
            "-1",
            "1.5",
            "1,000",
            " 1",
            "18446744073709551616",
        ] {
            assert_eq!(parse_yen(bad), Err(CalcError::SyntaxError), "{bad}");
        }
    }
}
