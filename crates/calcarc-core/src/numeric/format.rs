use crate::complex::polar::to_polar;
use crate::complex::value::Value;
use crate::numeric::angle::AngleMode;

/// 表示する有効数字の桁数。
pub const DISPLAY_DIGITS: usize = 10;

/// この絶対値以上で指数表記に切り替える。
const EXP_HIGH: f64 = 1e10;
/// この絶対値未満（かつ 0 でない）で指数表記に切り替える。
const EXP_LOW: f64 = 1e-9;

/// 実数 1 つを表示文字列にする。
///
/// 丸めは Rust の書式化に従い round-half-to-even となる。
/// ここで丸めた結果を計算に戻さないことは engine 側で保証する（base-spec §26）。
pub fn format_real(x: f64) -> String {
    if x == 0.0 {
        // -0.0 も "0" として表示する。
        return "0".to_string();
    }
    let a = x.abs();
    if !(EXP_LOW..EXP_HIGH).contains(&a) {
        let s = format!("{:.*e}", DISPLAY_DIGITS - 1, x);
        return match s.split_once('e') {
            Some((mantissa, exp)) => format!("{}e{}", trim_zeros(mantissa), exp),
            None => s,
        };
    }
    let int_digits = if a >= 1.0 {
        a.log10().floor() as i32 + 1
    } else {
        1
    };
    let decimals = (DISPLAY_DIGITS as i32 - int_digits).max(0) as usize;
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
        assert_eq!(
            format_polar(Value::imag(1.0), AngleMode::Deg),
            "1 ∠ 90"
        );
        assert_eq!(
            format_polar(Value::imag(1.0), AngleMode::Rad),
            "1 ∠ 1.570796327"
        );
    }
}
