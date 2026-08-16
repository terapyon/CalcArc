use crate::{AngleMode, Value};

/// 表示する有効数字の桁数。
pub const DISPLAY_DIGITS: usize = 10;

/// この 10 の冪以上で指数表記にする。`|x| >= 1e10` に対応する。
const EXP_HIGH_EXPONENT: i32 = 10;
/// この 10 の冪未満で指数表記にする。`|x| < 1e-9` に対応する。
const EXP_LOW_EXPONENT: i32 = -9;

/// 実数 1 つを表示文字列にする。
///
/// 丸めは Rust の書式化に従い round-half-to-even となる。
/// ここで丸めた結果を計算に戻さないことは engine 側で保証する（base-spec §26）。
///
/// 桁の数え方に log10 を使わない。`log10` は 10 の冪の近くで 1 桁ずれることがあり、
/// また丸めによる繰り上がり（`9999999999.6` → `1e10`）を先読みできない。
/// 代わりに Rust の指数表記書式に有効数字 10 桁で 1 度整形させ、そこから
/// 指数を読む。この指数は丸めた後の値のものなので、表記の選択も桁数の計算も
/// これ 1 つで決まる。
pub fn format_real(x: f64) -> String {
    if x == 0.0 {
        // -0.0 も "0" として表示する。
        return "0".to_string();
    }
    let scientific = format!("{:.*e}", DISPLAY_DIGITS - 1, x);
    let (mantissa, exponent_text) = match scientific.split_once('e') {
        Some(parts) => parts,
        // Rust の LowerExp は必ず 'e' を含むため、ここには来ない。
        None => return scientific,
    };
    let exponent: i32 = exponent_text.parse().unwrap_or(0);

    if !(EXP_LOW_EXPONENT..EXP_HIGH_EXPONENT).contains(&exponent) {
        return format!("{}e{}", trim_zeros(mantissa), exponent_text);
    }
    // 小数点以下の桁数 = 有効数字 10 桁 - 整数部の桁数。
    // 指数が -1 なら 0.ddd… なので 10 桁ぶん小数が要る。
    let decimals = (DISPLAY_DIGITS as i32 - 1 - exponent).max(0) as usize;
    group_integer_part(&trim_zeros(&format!("{:.*}", decimals, x)))
}

fn trim_zeros(s: &str) -> String {
    if !s.contains('.') {
        return s.to_string();
    }
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// 整数部だけを 3 桁ごとに区切る。**小数部と指数部には入れない**(設計書 §3.3)。
///
/// `data_scale::format::group_digits` と見た目は同じだが共通化しない——あちらは
/// `u128` の整数で定義域も用途も違い、**同じ見た目のものを 1 つにまとめると
/// 片方の都合がもう片方に効く**。5 行の処理であり、共有する価値より結合の害が大きい。
fn group_integer_part(text: &str) -> String {
    let (sign, rest) = match text.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", text),
    };
    let (int_part, frac) = match rest.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (rest, None),
    };
    let mut grouped = String::with_capacity(int_part.len() + int_part.len() / 3);
    for (i, c) in int_part.chars().enumerate() {
        if i != 0 && (int_part.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(c);
    }
    match frac {
        Some(f) => format!("{sign}{grouped}.{f}"),
        None => format!("{sign}{grouped}"),
    }
}

/// 工学表記。**指数は常に 3 の倍数**で、仮数は 1 以上 1000 未満(設計書 §3)。
///
/// `log10` を使わないのは `format_real` と同じ理由である——10 の冪の近くで
/// 1 桁ずれ、丸めの繰り上がりを先読みできない。**丸めた後の値から指数を決める。**
pub fn format_real_eng(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    let scientific = format!("{:.*e}", DISPLAY_DIGITS - 1, x);
    let (mantissa, exponent_text) = match scientific.split_once('e') {
        Some(parts) => parts,
        None => return scientific,
    };
    let exponent: i32 = exponent_text.parse().unwrap_or(0);
    // 3 の倍数へ**下向きに**丸める。-1 → -3、1 → 0、-4 → -6。
    // `/` ではなく `div_euclid` を使う——`/` は 0 方向に切り捨てるので
    // 負の指数で向きを間違える(`-1 / 3` は Rust で `0`、
    // `(-1).div_euclid(3)` は `-1`)。「簡単にできる」と `/` に戻すと
    // 負の指数側だけ静かに壊れる。
    let eng_exponent = exponent.div_euclid(3) * 3;
    let shift = exponent - eng_exponent; // 0, 1, 2 のいずれか
    // 仮数を 10^shift 倍する。小数点を動かすだけなので精度は落ちない。
    let value: f64 = mantissa.parse().unwrap_or(0.0) * 10f64.powi(shift);
    // 有効数字 10 桁から、整数部が使うぶんを引いた残りを小数に回す。
    let int_digits = shift + 1;
    let decimals = (DISPLAY_DIGITS as i32 - int_digits).max(0) as usize;
    let body = trim_zeros(&format!("{:.*}", decimals, value));
    if eng_exponent == 0 {
        // 指数 0 は書かない(設計書 §3.1)。通常の 10 進と同じ扱いにする。
        return group_integer_part(&body);
    }
    format!("{body}e{eng_exponent}")
}

/// 直交形式で表示する。`3+j4` のように j を数の前に置く。
pub fn format_rect(v: Value) -> String {
    if v.is_real() {
        return format_real(v.re);
    }
    let im = format_real(v.im.abs());
    if v.re == 0.0 {
        let sign = if v.im < 0.0 { "-" } else { "" };
        return format!("{sign}j{im}");
    }
    let sign = if v.im < 0.0 { "-" } else { "+" };
    format!("{}{sign}j{im}", format_real(v.re))
}

/// 極形式で表示する。角度は与えられたモードの単位で描画する。
///
/// 半径が有限であることが呼び出し側で保証されている場合に使う。
/// 保証がない場合は `try_format_polar` を使うこと。
pub fn format_polar(v: Value, mode: AngleMode) -> String {
    let p = v.to_polar();
    format!(
        "{} ∠ {}",
        format_real(p.r),
        format_real(mode.angle_of(p.theta_rad))
    )
}

/// 極形式で表示する。半径が有限でなければ None を返す。
///
/// to_polar の hypot は両成分が f64::MAX に近いと溢れる。engine の
/// finalize() は表示経路を通らないので、ここで捕まえないと "inf ∠ 45"
/// が画面に出る。
pub fn try_format_polar(v: Value, mode: AngleMode) -> Option<String> {
    let p = v.to_polar();
    if !p.r.is_finite() {
        return None;
    }
    Some(format!(
        "{} ∠ {}",
        format_real(p.r),
        format_real(mode.angle_of(p.theta_rad))
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn shows_ten_significant_digits() {
        assert_eq!(format_real(53.13010235415598), "53.13010235");
        assert_eq!(format_real(PI), "3.141592654");
    }

    #[test]
    fn trims_trailing_zeros() {
        assert_eq!(format_real(5.0), "5");
        assert_eq!(format_real(0.5), "0.5");
        assert_eq!(format_real(-4.0), "-4");
    }

    #[test]
    fn formats_zero_without_a_sign() {
        assert_eq!(format_real(0.0), "0");
        assert_eq!(format_real(-0.0), "0");
    }

    #[test]
    fn switches_to_exponent_notation_at_the_thresholds() {
        assert_eq!(format_real(1e10), "1e10");
        assert_eq!(format_real(1e-9), "0.000000001");
        assert_eq!(format_real(1e-10), "1e-10");
        assert_eq!(format_real(-1.5e12), "-1.5e12");
    }

    #[test]
    fn keeps_ten_significant_digits_below_one() {
        // 小数は先頭の 0 を有効数字に数えない。1 未満でも 10 桁出す。
        assert_eq!(format_real(1.0 / 3.0), "0.3333333333");
        assert_eq!(format_real(0.0123456789012), "0.0123456789");
        assert_eq!(format_real(0.00123456789012), "0.00123456789");
    }

    #[test]
    fn rounding_that_carries_into_a_new_digit_switches_notation() {
        // 丸めると 1e10 に繰り上がる。表記の判断は丸めた後の値で行うので、
        // 11 桁の "10000000000" ではなく "1e10" になる。
        assert_eq!(format_real(9999999999.6), "1e10");
        assert_eq!(format_real(9999999999.4), "9,999,999,999");
    }

    #[test]
    fn rounds_half_to_even_at_the_carry_boundary() {
        // 9999999999.5 は f64 でちょうど表現できる真のタイ。有効数字 10 桁目が
        // 奇数の 9 なので round-half-to-even は繰り上げを選び、指数表記に移る。
        assert_eq!(format_real(9999999999.5), "1e10");

        // 一方 0.99999999995 は 10 進の見た目こそタイだが、f64 にすると
        // 0.99999999994999999586 でタイより僅かに小さい。丸めの判定は
        // 書かれた 10 進表記ではなく f64 の実際の値で決まる。
        assert_eq!(format_real(0.99999999995), "0.9999999999");

        assert_eq!(format_real(0.99999999996), "1");
        assert_eq!(format_real(0.99999999994), "0.9999999999");
    }

    #[test]
    fn formats_rectangular_form() {
        assert_eq!(format_rect(Value::new(3.0, 4.0)), "3+j4");
        assert_eq!(format_rect(Value::new(3.0, -4.0)), "3-j4");
        assert_eq!(format_rect(Value::new(-5.0, 10.0)), "-5+j10");
        assert_eq!(format_rect(Value::real(5.0)), "5");
        assert_eq!(format_rect(Value::imag(2.0)), "j2");
        assert_eq!(format_rect(Value::imag(-2.0)), "-j2");
    }

    #[test]
    fn formats_polar_form() {
        // これが本スライスの目標表示。
        assert_eq!(
            format_polar(Value::new(3.0, 4.0), AngleMode::Deg),
            "5 ∠ 53.13010235"
        );
    }

    #[test]
    fn polar_form_follows_the_angle_mode() {
        assert_eq!(format_polar(Value::imag(1.0), AngleMode::Deg), "1 ∠ 90");
        assert_eq!(
            format_polar(Value::imag(1.0), AngleMode::Rad),
            "1 ∠ 1.570796327"
        );
    }

    #[test]
    fn try_format_polar_is_none_when_the_radius_overflows() {
        // hypot(f64::MAX, f64::MAX) は無限大になる。
        assert_eq!(
            try_format_polar(Value::new(f64::MAX, f64::MAX), AngleMode::Deg),
            None
        );
    }

    #[test]
    fn thousands_separators_group_only_the_integer_part() {
        assert_eq!(format_real(1234567.0), "1,234,567");
        assert_eq!(format_real(1234.5678), "1,234.5678"); // 小数部は刻まない
        assert_eq!(format_real(-1234567.0), "-1,234,567"); // 符号は先頭
        assert_eq!(format_real(999.0), "999"); // 4 桁未満は変わらない
        assert_eq!(format_real(1000.0), "1,000"); // 境界の両側
        assert_eq!(format_real(1.5e12), "1.5e12"); // 指数表記には入らない
    }

    #[test]
    fn engineering_notation_keeps_the_exponent_a_multiple_of_three() {
        assert_eq!(format_real_eng(1000.0), "1e3");
        assert_eq!(format_real_eng(12345.0), "12.345e3");
        assert_eq!(format_real_eng(0.0022), "2.2e-3");
        assert_eq!(format_real_eng(1500000.0), "1.5e6");
        assert_eq!(format_real_eng(1.5e11), "150e9"); // 仮数は 1000 未満
        assert_eq!(format_real_eng(0.0), "0");
        assert_eq!(format_real_eng(-1500000.0), "-1.5e6");
    }

    #[test]
    fn engineering_notation_omits_a_zero_exponent() {
        // **`999e0` とは書かない**(設計書 §3.1)。指数が 0 なら通常の 10 進。
        // つまり ENG に入れても見た目が変わらない値がある——それは仕様である。
        assert_eq!(format_real_eng(999.0), "999");
        assert_eq!(format_real_eng(1.5), "1.5");
        assert_eq!(format_real_eng(0.5), "500e-3"); // 1 未満は指数が付く
    }

    #[test]
    fn engineering_notation_decides_the_exponent_after_rounding() {
        // 先に指数を決めて丸めると 999.99999999e0 が 1000e0 になり、
        // 仮数の範囲(1 以上 1000 未満)を破る(設計書「有効数字」)。
        assert_eq!(format_real_eng(999.99999999), "1e3");
    }
}
