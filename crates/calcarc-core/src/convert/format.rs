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

/// 表示する有効数字の桁数(numerical-policy「表示は有効数字 10 桁」)。
/// **指数表記の境とは別の定数である。** 桁数だけを変えるつもりで指数の境まで
/// 動かさないよう、`EXP_HIGH_EXPONENT` / `EXP_LOW_EXPONENT` に分けてある
/// (先例: `numeric::format::DISPLAY_DIGITS` と `EXP_HIGH_EXPONENT` /
/// `EXP_LOW_EXPONENT` の分離。U-1 spec §3.3 が「S-0 で直した『同じ字が 2 つの
/// 意味を持つ』と同じ型の罠」と名指ししている)。
const DISPLAY_DIGITS: usize = 10;

/// この 10 の冪以上で指数表記にする(numerical-policy「`|x| >= 1e10`」)。
const EXP_HIGH_EXPONENT: i32 = 10;
/// この 10 の冪未満で指数表記にする(numerical-policy「`|x| < 1e-9`」)。
const EXP_LOW_EXPONENT: i32 = -9;

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
    // **分母は係数表からは来ない。** `convert()` の第 1 引数は式であり、
    // 利用者が打った値が分母を決める——係数表の分母がどこまでしか育たないかは
    // ここでは関係ない(前段のコメントに以前あった「係数表からは作れない」は
    // 事実誤認だったので削った)。
    // **実測でここに到達する**: `1 / 170141183460469231731687303715884105727`
    // (= `1 / i128::MAX`) は `convert()` は `Ok`、ここで `Err(Overflow)` になる。
    // p=1, q=i128::MAX(≈1.7014e38) から始まり、p を q に届かせようと 10 倍を
    // 重ねると `10^38 < q` でまだ足りず、次の `10^39` が `u128::MAX`(≈3.4028e38)
    // を超える。
    // **黙って丸めるより Overflow と言うほうがよい**
    // (numerical-policy「表示できない値を黙って丸めない」、design §3.5 の
    // 「黙って f64 に落ちるより `Overflow` と言うほうがよい」と同じ方針)。
    while p < q {
        p = p.checked_mul(10).ok_or(CalcError::Overflow)?;
        exponent -= 1;
    }

    // 10 桁を 1 桁ずつ取り出す。
    let mut digits = Vec::with_capacity(DISPLAY_DIGITS);
    let mut rest = p;
    for i in 0..DISPLAY_DIGITS {
        let d = rest / q;
        digits.push(d as u8);
        rest -= d * q;
        if i + 1 < DISPLAY_DIGITS {
            // こちらも**あふれたら Overflow**。**値が大きい側は、上の
            // `p.checked_mul(10)` より先にこちらが発火する。**
            // 実測: `150000000000000000000000000000000000000` (= 1.5e38) は
            // `convert()` は `Ok`、ここで `Err(Overflow)` になる。正規化後
            // p=1.5e38, q=1e38 で 1 桁目の余り `rest = 0.5e38` を 10 倍すると
            // `5e38 > u128::MAX`(≈3.4028e38)。
            // 一方 `100000000000000000000000000000000000000` (= 1e38) は
            // p と q が一致して割り切れ、`rest` は以後ずっと 0 のまま
            // 9 回の `*10` を安全に通り抜けるので `Ok("1e38")` になる——
            // **同じ桁数でも割り切れるかどうかでこの境をまたぐ**。
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
    // **`(b'0' + d) as char` が安全である根拠**: `d` は上の抽出ループで
    // `rest / q`(0 ≤ rest < q だった直後の商)であり、`checked_mul(10)` が
    // あふれて break したのでなければ 0 ≤ d ≤ 9 に収まる。あふれた場合は
    // `?` で早期リターンしているのでここには来ない——
    // あふれて break したとき `10q > u128::MAX ≥ p` なので `p/q ≤ 9` になる、
    // というのが keep する不変条件である。
    let text: String = digits.iter().map(|d| (b'0' + d) as char).collect();

    // **指数表記の境**(numerical-policy「`|x| >= 1e10` または `0 < |x| < 1e-9`」)。
    // `DISPLAY_DIGITS` ではなく `EXP_HIGH_EXPONENT` / `EXP_LOW_EXPONENT` を見る
    // ——桁数を変えても指数の境は動かない(上の定数のコメント参照)。
    if !(EXP_LOW_EXPONENT..EXP_HIGH_EXPONENT).contains(&exponent) {
        // `text` は digits(常に `DISPLAY_DIGITS` 桁、空にはならない)から
        // 作っているので長さ 1 以上は自明であり、無検査の `split_at(1)` でも
        // panic しない。**それでも下の固定小数点の枝(`split_at_checked`)と
        // 作法を揃える**——「ここは自明だから検査を省く」を枝ごとに判断させると、
        // 判断が古びたときに気づく場所がなくなる。core は panic しない
        // (CLAUDE.md)ので、検査のコストより揃っていることの価値を取る。
        let (lead, tail) = text.split_at_checked(1).unwrap_or((&text, ""));
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
///
/// `numeric::format::group_integer_part` と `data_scale::format::group_digits`
/// に続く 3 つ目の同型実装。**同じ判断で共通化しない**——f64 版の理由をここでも
/// 踏襲する: 入力の型(ここは `&str`、他は `f64` の文字列化 / `u128`)も定義域も
/// 用途も違い、5 行前後の処理を 1 つにまとめる価値より、まとめて生まれる
/// 結合(片方の都合がもう片方に効く)の害のほうが大きい。
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

    #[test]
    fn a_rational_the_conversion_layer_accepts_can_still_overflow_here() {
        // **換算層(convert())は成功するのに表示層が拒む帯が実在する。**
        // どちらも `p`/`rest` を 10 倍する側の `checked_mul` があふれる
        // ——`wrapping_mul` に変異させると 2 つとも黙って(間違った)数を
        // 返すようになり、このテストが赤くなる。
        //
        // `1 / i128::MAX`。convert() の分母は係数表ではなく利用者の入力が
        // 決める(この分数はどの係数表からも作れない)。p=1, q=i128::MAX から
        // p を q に届かせる正規化ループの `p.checked_mul(10)` で
        // `10^39 > u128::MAX` に当たる。
        assert_eq!(
            format_rational(Rational::from_ratio(1, i128::MAX).unwrap()),
            Err(CalcError::Overflow)
        );

        // 1.5e38(39 桁の整数、i128 には収まる)。正規化後 p=1.5e38, q=1e38 で、
        // 1 桁目の余り 0.5e38 を、桁抽出ループの `rest.checked_mul(10)` が
        // `5e38 > u128::MAX` にする。こちらは正規化ループの
        // `p.checked_mul(10)` よりコメントの付いていなかった側で、
        // 大きい値ではこちらが先に発火する。
        assert_eq!(
            format_rational(
                Rational::from_i128(150_000_000_000_000_000_000_000_000_000_000_000_000).unwrap()
            ),
            Err(CalcError::Overflow)
        );

        // 1e38(39 桁の整数)は境の内側。p=q=1e38 に割り切れるので rest は
        // ずっと 0 のまま残り 9 桁を安全に通り抜ける。
        // **なぜこの挙動でよいか**: 表示できない値は黙って丸めず Overflow と
        // 言う(numerical-policy「表示できない値を黙って丸めない」、
        // design §3.5「黙って f64 に落ちるより `Overflow` と言うほうがよい」)
        // ——間違った数を出すよりエラーと言うほうがよい、という方針の帯である。
        assert_eq!(
            f(100_000_000_000_000_000_000_000_000_000_000_000_000, 1),
            "1e38"
        );
    }

    #[test]
    fn the_p_normalization_overflow_is_not_masked_by_the_rest_overflow() {
        // **`1 / i128::MAX` だけでは `p.checked_mul(10)` の行を単独では赤くしない。**
        // `wrapping_mul` に変異させて実測したところ、あの入力は正規化後の `p` が
        // 破損した値になっても、桁抽出の `rest.checked_mul(10)`(こちらは無変異)が
        // 別の理由でたまたま `Overflow` を返し、最終結果は偶然にも同じ `Err(Overflow)`
        // になった——**壊れた計算過程の上に、たまたま正しい結論が乗っていた**。
        // この入力は `p.checked_mul(10)` の検査を単独では検査していない。
        //
        // これは、`p` の正規化があふれ、かつ破損した `p` が桁抽出ループを
        // あふれずに(誤った)`Ok` まで通り抜ける組(探索で見つけた実例)。
        // `p.checked_mul(10)` だけを `wrapping_mul(10)` に変異させると、
        // 実測でここが `Err(Overflow)` から `Ok("1.001552626e-30")` に変わる
        // ——**このテストだけがその変異を検出する**。
        assert_eq!(
            format_rational(
                Rational::from_ratio(
                    387_699_925,
                    47_344_050_470_018_749_799_790_552_491_131_718_782
                )
                .unwrap()
            ),
            Err(CalcError::Overflow)
        );
    }
}
