//! `=` で式を値にまとめる(0.9.2 設計書 §4、外部監査 F3)。
//!
//! **丸めない。** 値を正確に書く——有限小数が 39 字に収まればそれ、そうでなければ既約分数
//! `p/q`。表示の 10 桁(`format::format_rational`)とは別の口である。書いた文字列は Convert の
//! 値の欄(web の Entry)にそのまま入り、次の計算でコアに読み直される。
//!
//! **39 字は Entry の数え方**(`web/src/units/entry.ts` の `pushDigit`/`pushDot` が見る
//! `text.length`、上限は `web/src/convert/entry.ts` の `MAX_VALUE_DIGITS`)——小数点と先頭の
//! `0` も 1 字。符号は数えない(Entry の外の `negative` が持つ)。
//!
//! **この数え方なら出力は必ず読み直せる。** i128 の値は高々 39 桁なので、整数と分数の分子・
//! 分母は 39 字に収まる。小数点を含む 39 字の文字列は数字が高々 38 個なので、読み直した分子は
//! 10^38 未満、分母は 10^37 以下で、どちらも i128 に収まる(`expr/parse.rs` の `literal` は
//! i128 に収まらない数字を `Overflow` にする)。**数字の個数で数えるとこの論法は崩れる**
//! ——`7/4 + 1/2^38`(= `481036337153/274877906944`)は小数にすると数字が 39 個(小数点を
//! 入れて 40 字)で、読み直した分子が約 1.75×10^38 になり、i128 の上限(約 1.70×10^38)を超える。

use crate::CalcResult;
use crate::expr::{UnitSet, evaluate_to_rational};

/// 値の欄に入る字数の上限(`web/src/convert/entry.ts` の `MAX_VALUE_DIGITS` と同じ数)。
///
/// **番人は在る**——`crates/calcarc-wasm/tests/token_parity.rs` が
/// `include_str!` で `web/src/convert/entry.ts` を読み、**2 つの数が一致することを
/// 確かめる**(0.9.3 設計書 §8.2)。
///
/// **ここには「機械の番人は無い」と書いてあった。結論が誤りだった**(2026-09-17 に訂正)。
/// 理由の前半——**この定数は wasm 境界を越えて公開されておらず、web 側が実行時に
/// 読むことはできない**——は本当である。**誤っていたのは「だから番人を置けない」のほう**で、
/// **向きを変えれば置ける**: Rust のテストが TS の本文を読めばよい。
/// **`include_str!` はこの repo の作法である**(`crates/` に 16 呼び出し・4 ファイル、
/// うち `web/` を読むのが 3 ファイル・8 本の TS/TSX)。
pub const MAX_VALUE_CHARS: usize = 39;

/// 式を正確な値の文字列にする。有限小数(39 字以内)か既約分数 `p/q`、負なら先頭に `-`。
pub fn settle(value: &str) -> CalcResult<String> {
    // 単項マイナスは構文解析器に無い——`convert()` と同じく `0` を前置する(`mod.rs` の註)。
    let owned;
    let text = if value.starts_with('-') {
        owned = format!("0{value}");
        &owned
    } else {
        value
    };
    let (num, den) = evaluate_to_rational(text, UnitSet::None)?.parts();
    let sign = if num < 0 { "-" } else { "" };
    // `Rational` は `i128::MIN` を持たない(`rational.rs` の註)ので絶対値は i128 に収まる。
    let magnitude = num.unsigned_abs();
    let denominator = den.unsigned_abs();
    Ok(match decimal(magnitude, denominator) {
        Some(text) if text.len() <= MAX_VALUE_CHARS => format!("{sign}{text}"),
        _ => format!("{sign}{magnitude}/{denominator}"),
    })
}

/// `n/d`(既約)が有限小数なら、指数もカンマも使わない 10 進の文字列。有限小数でなければ
/// None。桁が u128 に収まらないとき(そのときは必ず 39 字を超える)も None。
fn decimal(n: u128, d: u128) -> Option<String> {
    let (mut rest, mut twos, mut fives) = (d, 0u32, 0u32);
    while rest % 2 == 0 {
        rest /= 2;
        twos += 1;
    }
    while rest % 5 == 0 {
        rest /= 5;
        fives += 1;
    }
    if rest != 1 {
        return None;
    }
    // n/d = n·2^(k−twos)·5^(k−fives) / 10^k
    let k = twos.max(fives);
    let scaled = n
        .checked_mul(2u128.checked_pow(k - twos)?)?
        .checked_mul(5u128.checked_pow(k - fives)?)?;
    let digits = scaled.to_string();
    let k = k as usize;
    Some(if k == 0 {
        digits
    } else if digits.len() > k {
        let (whole, part) = digits.split_at(digits.len() - k);
        format!("{whole}.{part}")
    } else {
        format!("0.{}{digits}", "0".repeat(k - digits.len()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CalcError;

    /// 読み直す(`convert()` と同じく、先頭の `-` には `0` を前置する)。
    fn reread(text: &str) -> (i128, i128) {
        let owned;
        let text = if text.starts_with('-') {
            owned = format!("0{text}");
            &owned
        } else {
            text
        };
        evaluate_to_rational(text, UnitSet::None).unwrap().parts()
    }

    /// 出力が値の欄に入り(語ごとに 39 字以内)、読み直すと元の値に戻ること(注記 D)。
    fn settles_to(value: &str) -> String {
        let settled = settle(value).unwrap();
        assert_eq!(
            reread(&settled),
            reread(value),
            "{value} → {settled} が同じ値に戻らない"
        );
        assert!(
            settled
                .trim_start_matches('-')
                .split('/')
                .all(|part| part.len() <= MAX_VALUE_CHARS),
            "{settled} は値の欄に入らない"
        );
        settled
    }

    #[test]
    fn a_terminating_value_stays_a_decimal() {
        // 監査の例(設計書 §1 の f3-probe)。どれも 10 桁に丸めない。
        assert_eq!(settles_to("0.123456789012"), "0.123456789012");
        assert_eq!(settles_to("9999999999.4"), "9999999999.4");
        assert_eq!(settles_to("12345678901.5"), "12345678901.5");
        assert_eq!(settles_to("1/4"), "0.25");
        assert_eq!(settles_to("5*12"), "60");
        assert_eq!(settles_to("0"), "0");
    }

    #[test]
    fn a_repeating_value_becomes_a_reduced_fraction() {
        // 裁定(§9 の 3): 割り切れない値は分数で見せる。
        assert_eq!(settles_to("1/3"), "1/3");
        assert_eq!(settles_to("2/6"), "1/3");
        assert_eq!(settles_to("10/4/3"), "5/6");
    }

    #[test]
    fn the_sign_leads() {
        assert_eq!(settles_to("-12.5"), "-12.5");
        assert_eq!(settles_to("-1/3"), "-1/3");
        assert_eq!(settles_to("1-3/2"), "-0.5");
    }

    #[test]
    fn the_boundary_is_counted_the_way_the_entry_counts() {
        // 注記 D の境目(字数は設計書 §4.3、Python の fractions で数えた)。
        // 1/2^37 は小数で 39 字 → 有限小数のまま。
        assert_eq!(
            settles_to("1/137438953472"),
            "0.0000000000072759576141834259033203125"
        );
        // 1/2^38 は小数なら 40 字 → 分数。
        assert_eq!(settles_to("1/274877906944"), "1/274877906944");
        // 5^16/2^39 は小数なら 41 字(読み直した分子は 5^55 で i128 を超える)→ 分数。
        assert_eq!(
            settles_to("152587890625/549755813888"),
            "152587890625/549755813888"
        );
        // i128 の上限の整数(39 桁)もそのまま入る。
        assert_eq!(
            settles_to("170141183460469231731687303715884105727"),
            "170141183460469231731687303715884105727"
        );
    }

    #[test]
    fn counting_digits_instead_of_characters_would_break_the_reread() {
        // 7/4 + 1/2^38 は小数なら数字 39 個・40 字。字で数えるので分数になる。数字の個数で
        // 数えると小数を選び、読み直した分子(約 1.75×10^38)が i128 を超えて `Overflow` になる。
        assert_eq!(
            settles_to("481036337153/274877906944"),
            "481036337153/274877906944"
        );
    }

    #[test]
    fn a_value_that_cannot_be_evaluated_is_an_error() {
        assert_eq!(settle("1/0"), Err(CalcError::DivisionByZero));
        assert_eq!(settle("1+"), Err(CalcError::SyntaxError));
    }
}
