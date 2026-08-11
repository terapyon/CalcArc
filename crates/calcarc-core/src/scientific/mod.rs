use crate::complex::arith::{div, finite, mul};
use crate::complex::polar::to_polar;
use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;

/// 平方根の主値。
///
/// 実数は専用の経路で扱う。負の実数を極形式経由で計算すると
/// 実部に 1.2e-16 程度の残差が出て `1.224646799e-16+j2` と表示されるため、
/// 実数のときは虚軸上の値をそのまま構成する。
pub fn sqrt(v: Value) -> CalcResult<Value> {
    if v.is_real() {
        return if v.re >= 0.0 {
            finite(Value::real(v.re.sqrt()))
        } else {
            finite(Value::imag((-v.re).sqrt()))
        };
    }
    let p = to_polar(v);
    let r = p.r.sqrt();
    let half = p.theta_rad / 2.0;
    finite(Value::new(r * half.cos(), r * half.sin()))
}

pub fn sqr(v: Value) -> CalcResult<Value> {
    mul(v, v)
}

pub fn neg(v: Value) -> Value {
    Value::new(-v.re, -v.im)
}

/// 角度モードに従って引数をラジアンに直す。
///
/// 複素数の引数でも実部・虚部の両方を同じ係数で変換する。
/// これは z を単位付きの量とみなす解釈で、実数のときに
/// 通常の度数法と一致する。
fn to_rad(v: Value, mode: AngleMode) -> Value {
    Value::new(mode.to_radians(v.re), mode.to_radians(v.im))
}

pub fn sin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    finite(Value::new(
        z.re.sin() * z.im.cosh(),
        z.re.cos() * z.im.sinh(),
    ))
}

pub fn cos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    finite(Value::new(
        z.re.cos() * z.im.cosh(),
        -z.re.sin() * z.im.sinh(),
    ))
}

/// tan は sin / cos として求める。
///
/// Deg モードの実数引数については、極（90 + 180n 度）を先に検出する。
/// f64 の tan(PI/2) は無限大ではなく 1.633e16 という有限値を返すため、
/// Overflow の検査では捕まらない。
pub fn tan(v: Value, mode: AngleMode) -> CalcResult<Value> {
    if is_tan_pole(v, mode) {
        return Err(CalcError::TrigPole);
    }
    div(sin(v, mode)?, cos(v, mode)?)
}

fn is_tan_pole(v: Value, mode: AngleMode) -> bool {
    if !v.is_real() || mode != AngleMode::Deg {
        return false;
    }
    let a = v.re.abs();
    a >= 90.0 && (a - 90.0) % 180.0 == 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_close as close;
    use std::f64::consts::PI;

    #[test]
    fn square_root_of_a_positive_real() {
        assert_eq!(sqrt(Value::real(4.0)).unwrap(), Value::real(2.0));
    }

    #[test]
    fn square_root_of_a_negative_real_is_exactly_imaginary() {
        // 極形式を経由すると実部に 1.2e-16 が残る。実数の負値は
        // 専用の経路で扱い、ちょうど j2 を返す。
        assert_eq!(sqrt(Value::real(-4.0)).unwrap(), Value::imag(2.0));
    }

    #[test]
    fn square_root_of_a_complex_number() {
        // sqrt(3+j4) = 2+j1
        let r = sqrt(Value::new(3.0, 4.0)).unwrap();
        close(r.re, 2.0);
        close(r.im, 1.0);
    }

    #[test]
    fn squares_a_complex_number() {
        // (3+j4)^2 = -7+j24
        assert_eq!(sqr(Value::new(3.0, 4.0)).unwrap(), Value::new(-7.0, 24.0));
    }

    #[test]
    fn negates() {
        assert_eq!(neg(Value::new(3.0, -4.0)), Value::new(-3.0, 4.0));
    }

    #[test]
    fn sine_in_degrees() {
        close(sin(Value::real(30.0), AngleMode::Deg).unwrap().re, 0.5);
    }

    #[test]
    fn sine_in_radians() {
        close(sin(Value::real(PI / 6.0), AngleMode::Rad).unwrap().re, 0.5);
    }

    #[test]
    fn cosine_in_degrees() {
        close(cos(Value::real(60.0), AngleMode::Deg).unwrap().re, 0.5);
    }

    #[test]
    fn tangent_in_degrees() {
        close(tan(Value::real(45.0), AngleMode::Deg).unwrap().re, 1.0);
    }

    #[test]
    fn tangent_at_a_pole_is_an_error() {
        // f64 の tan(PI/2) は無限大ではなく 1.6e16 を返すため、
        // Deg モードでは極を明示的に検出する（設計書 §4.6）。
        assert_eq!(
            tan(Value::real(90.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        assert_eq!(
            tan(Value::real(270.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        assert_eq!(
            tan(Value::real(-90.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        // 極でない値は通る。
        assert!(tan(Value::real(89.0), AngleMode::Deg).is_ok());
    }

    #[test]
    fn trig_accepts_complex_arguments() {
        // sin(z) = sin(a)cosh(b) + j cos(a)sinh(b)
        let r = sin(Value::new(0.0, 1.0), AngleMode::Rad).unwrap();
        close(r.re, 0.0);
        close(r.im, 1.0_f64.sinh());
    }
}
