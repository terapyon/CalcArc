use crate::complex::value::Value;

/// 極形式。角度は常にラジアンで保持する。
///
/// 度への変換は表示層でのみ行う。内部表現の単位を 1 つに固定することで、
/// 角度モードの切り替えが保持している値に影響しない（設計書 D5）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Polar {
    pub r: f64,
    /// -PI 以上 PI 以下。atan2 の値域。
    pub theta_rad: f64,
}

/// 直交形式から極形式へ。
///
/// atan2 を使うので四象限が正しく区別される（base-spec §33）。
pub fn to_polar(v: Value) -> Polar {
    Polar {
        r: v.re.hypot(v.im),
        theta_rad: v.im.atan2(v.re),
    }
}

/// 極形式から直交形式へ。
pub fn from_polar(p: Polar) -> Value {
    Value::new(p.r * p.theta_rad.cos(), p.r * p.theta_rad.sin())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_close as close;
    use std::f64::consts::PI;

    #[test]
    fn converts_the_headline_case() {
        // 3 + j4 -> 5 ∠ 53.13010235...°
        let p = to_polar(Value::new(3.0, 4.0));
        close(p.r, 5.0);
        close(p.theta_rad.to_degrees(), 53.13010235415598);
    }

    #[test]
    fn covers_all_four_quadrants() {
        close(to_polar(Value::new(1.0, 1.0)).theta_rad.to_degrees(), 45.0);
        close(to_polar(Value::new(-1.0, 1.0)).theta_rad.to_degrees(), 135.0);
        close(to_polar(Value::new(-1.0, -1.0)).theta_rad.to_degrees(), -135.0);
        close(to_polar(Value::new(1.0, -1.0)).theta_rad.to_degrees(), -45.0);
    }

    #[test]
    fn covers_the_axes() {
        close(to_polar(Value::new(1.0, 0.0)).theta_rad, 0.0);
        close(to_polar(Value::new(0.0, 1.0)).theta_rad, PI / 2.0);
        close(to_polar(Value::new(-1.0, 0.0)).theta_rad, PI);
        close(to_polar(Value::new(0.0, -1.0)).theta_rad, -PI / 2.0);
    }

    #[test]
    fn zero_has_zero_magnitude() {
        let p = to_polar(Value::ZERO);
        close(p.r, 0.0);
    }

    #[test]
    fn converts_back() {
        let v = from_polar(Polar { r: 5.0, theta_rad: 53.13010235415598_f64.to_radians() });
        close(v.re, 3.0);
        close(v.im, 4.0);
    }
}
