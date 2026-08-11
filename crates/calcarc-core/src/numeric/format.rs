use crate::complex::polar::to_polar;
use crate::complex::value::Value;
use crate::numeric::angle::AngleMode;

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
    trim_zeros(&format!("{:.*}", decimals, x))
}

fn trim_zeros(s: &str) -> String {
    if !s.contains('.') {
        return s.to_string();
    }
    s.trim_end_matches('0').trim_end_matches('.').to_string()
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
pub fn format_polar(v: Value, mode: AngleMode) -> String {
    let p = to_polar(v);
    format!(
        "{} ∠ {}",
        format_real(p.r),
        format_real(mode.from_radians(p.theta_rad))
    )
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
        assert_eq!(format_real(9999999999.4), "9999999999");
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
}
