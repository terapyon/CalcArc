//! 有理数を 10 進の表示文字列にする(numerical-policy の「表示」節)。
//!
//! **有効数字 10 桁 / round-half-to-even / `|x| ≥ 1e10` または `0 < |x| < 1e-9` で
//! 指数表記 / 整数部だけ 3 桁カンマ。**
//!
//! **`numeric::format` と規則は同じで実装は別である。** あちらは f64 を Rust の
//! `{:e}` 書式に渡して丸めさせる。ここは有理数なので使えない——f64 を経由した
//! 時点で厳密性が消える(U-1 spec §3.3)。
//!
//! **log10 を使わない。** 10 の冪の近くで 1 桁ずれ、丸めの繰り上がり
//! (`9999999999.5` → `1e10`)を先読みできない(`numeric::format` と同じ理由)。
//!
//! **境の判定は丸めた後の値で行う**(spec §3.3)。丸めと境の適用順で 2 通りの
//! 答えが出るのを防ぐ。

use crate::expr::rational::Rational;
use crate::{CalcError, CalcResult};

const DIGITS: usize = 10;

pub fn format_rational(value: Rational) -> CalcResult<String> {
    let (num, den) = value.parts();
    if num == 0 {
        return Ok("0".to_string());
    }
    let negative = num < 0;
    let mut p = num.unsigned_abs();
    // 分母は常に正(`Rational` の不変条件)。
    let mut q = den.unsigned_abs();

    // 1 ≤ p/q < 10 に正規化する。**分母を上げる向きを先にやる**
    // ——`checked_mul` が None を返したら、それ以上大きい分母は p を超えるので
    // ループはそこで終わってよい(あふれではない)。
    let mut exponent: i32 = 0;
    while let Some(bigger) = q.checked_mul(10) {
        if p < bigger {
            break;
        }
        q = bigger;
        exponent += 1;
    }
    // こちらは**あふれたら Overflow**。p を 10 倍する側で、値を失う。
    // 到達するのは分母が u128::MAX/10 を超える場合で、この spec の係数表からは
    // 作れない(分母は 10^9・16·10^8・5000・125・180・9 の積までしか育たない)が、
    // **証明をコメントに置いて検査は残す**——証明が崩れた日に黙って折り返さない。
    while p < q {
        p = p.checked_mul(10).ok_or(CalcError::Overflow)?;
        exponent -= 1;
    }

    // 10 桁を 1 桁ずつ取り出す。
    let mut digits = Vec::with_capacity(DIGITS);
    let mut rest = p;
    for i in 0..DIGITS {
        let d = rest / q;
        digits.push(d as u8);
        rest -= d * q;
        if i + 1 < DIGITS {
            rest = rest.checked_mul(10).ok_or(CalcError::Overflow)?;
        }
    }

    // **round-half-to-even。** `2 * rest` を作らない(あふれる)——
    // `rest` と `q - rest` を比べる。
    let last_is_odd = digits.last().is_some_and(|d| d % 2 == 1);
    let up = match rest.cmp(&(q - rest)) {
        core::cmp::Ordering::Greater => true,
        core::cmp::Ordering::Equal => last_is_odd,
        core::cmp::Ordering::Less => false,
    };
    if up {
        exponent += carry(&mut digits);
    }

    Ok(render(negative, &digits, exponent))
}

/// 末尾から繰り上げる。全部繰り上がったら `[1, 0, …]` にして 1 を返す。
fn carry(digits: &mut [u8]) -> i32 {
    for digit in digits.iter_mut().rev() {
        if *digit < 9 {
            *digit += 1;
            return 0;
        }
        *digit = 0;
    }
    // ここに来たのは全桁が 9 だった場合だけで、いま全桁 0 になっている。
    if let Some(first) = digits.first_mut() {
        *first = 1;
    }
    1
}

/// 桁列と指数から文字列を作る。**境の判定はここ**(丸めた後の指数を見ている)。
fn render(negative: bool, digits: &[u8], exponent: i32) -> String {
    let sign = if negative { "-" } else { "" };
    // `d0 d1 d2 …` を `"d0d1d2…"` にしておく。値は 0.d0d1… × 10^(exponent+1)。
    let text: String = digits.iter().map(|d| (b'0' + d) as char).collect();

    // **指数表記の境**(numerical-policy「`|x| >= 1e10` または `0 < |x| < 1e-9`」)。
    if exponent >= DIGITS as i32 || exponent <= -(DIGITS as i32) {
        let (lead, tail) = text.split_at(1);
        let tail = tail.trim_end_matches('0');
        let mantissa = if tail.is_empty() {
            lead.to_string()
        } else {
            format!("{lead}.{tail}")
        };
        // **`+` も先行 0 も付けない。** 仮数はどの指数表記でも 4 桁に届かず、
        // カンマを要する桁数にならない(numerical-policy)。
        return format!("{sign}{mantissa}e{exponent}");
    }

    let (integer, fraction) = if exponent >= 0 {
        // 小数点は exponent + 1 桁目の後ろ。`exponent ≤ 9` はすぐ上の境の判定が
        // 保証しており、10 桁の桁列に必ず収まる。**それでも添字は検査する**
        // ——core は panic しない(CLAUDE.md)。
        let (head, tail) = text
            .split_at_checked(exponent as usize + 1)
            .unwrap_or((&text, ""));
        (head.to_string(), tail.to_string())
    } else {
        // `0.` の後ろに -exponent - 1 個の 0 を置く。
        let zeros = "0".repeat((-exponent - 1) as usize);
        ("0".to_string(), format!("{zeros}{text}"))
    };

    let fraction = fraction.trim_end_matches('0');
    let integer = group(&integer);
    if fraction.is_empty() {
        // 裸の小数点は置かない。
        format!("{sign}{integer}")
    } else {
        format!("{sign}{integer}.{fraction}")
    }
}

/// **整数部だけ**に 3 桁ごとのカンマを入れる。負号はこの外側にある。
fn group(integer: &str) -> String {
    let mut out = String::with_capacity(integer.len() + integer.len() / 3);
    for (i, c) in integer.chars().enumerate() {
        if i > 0 && (integer.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::expr::rational::Rational;

    fn f(num: i128, den: i128) -> String {
        format_rational(Rational::from_ratio(num, den).unwrap()).unwrap()
    }

    #[test]
    fn zero_is_a_single_digit() {
        assert_eq!(f(0, 1), "0");
    }

    #[test]
    fn trailing_zeros_are_dropped() {
        // **25.40000000 にしない。**
        assert_eq!(f(254, 10), "25.4");
        assert_eq!(f(-40, 1), "-40");
    }

    #[test]
    fn ten_significant_digits_is_the_ceiling() {
        // 100 km = 62.13711922 mi（spec §4.1 の盤面図の値）
        assert_eq!(f(100_000 * 125, 201_168), "62.13711922");
    }

    #[test]
    fn commas_go_in_the_integer_part_only() {
        assert_eq!(f(1_234_567, 1), "1,234,567");
        assert_eq!(f(12_345_678, 10_000), "1,234.5678");
        assert_eq!(f(-1_234_567, 1), "-1,234,567");
    }

    #[test]
    fn the_big_boundary_is_ten_to_the_tenth() {
        assert_eq!(f(10_000_000_000, 1), "1e10");
        assert_eq!(f(9_999_999_999, 1), "9,999,999,999");
    }

    #[test]
    fn the_boundary_is_judged_after_rounding() {
        // **丸めると 10^10 に達するので指数表記**(spec §3.3)。
        // half-to-even: 9999999999.5 は偶数側 10000000000 へ。
        assert_eq!(f(99_999_999_995, 10), "1e10");
    }

    #[test]
    fn the_small_boundary_is_ten_to_the_minus_ninth() {
        assert_eq!(f(1, 1_000_000_000), "0.000000001");
        assert_eq!(f(1, 10_000_000_000), "1e-10");
    }

    #[test]
    fn the_small_boundary_is_judged_after_rounding_too() {
        // 9.9999999995e-10 は 1e-9 より小さいが、10 桁に丸めると 1e-9 に達する。
        // spec §3.3「小さい側も同じで、丸めて 10^-9 に達したら固定小数点にする」。
        assert_eq!(
            f(99_999_999_995, 100_000_000_000_000_000_000),
            "0.000000001"
        );
    }

    #[test]
    fn half_to_even_rounds_toward_the_even_digit() {
        // 11 桁目がちょうど 5。10 桁目が偶数なら上げない、奇数なら上げる。
        assert_eq!(f(12_345_678_925, 100_000_000), "123.4567892");
        assert_eq!(f(12_345_678_935, 100_000_000), "123.4567894");
    }

    #[test]
    fn a_carry_moves_the_exponent() {
        // 9.9999999995 は 10 桁に丸めると 10 になる。桁が 1 つ増える。
        assert_eq!(f(99_999_999_995, 10_000_000_000), "10");
    }
}
