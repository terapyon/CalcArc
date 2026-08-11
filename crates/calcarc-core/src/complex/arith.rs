use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};

/// 非有限な結果を Overflow として弾く。
///
/// f64 の演算は溢れても panic せず inf / NaN を返すため、
/// 表示に到達する前にここで捕まえる（base-spec §25、§27）。
pub fn finite(v: Value) -> CalcResult<Value> {
    if v.re.is_finite() && v.im.is_finite() {
        Ok(v)
    } else {
        Err(CalcError::Overflow)
    }
}

pub fn add(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(a.re + b.re, a.im + b.im))
}

pub fn sub(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(a.re - b.re, a.im - b.im))
}

pub fn mul(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(
        a.re * b.re - a.im * b.im,
        a.re * b.im + a.im * b.re,
    ))
}

/// 複素数の除算。
///
/// 素朴な `(b.re² + b.im²)` を分母にすると、中間の二乗で溢れるか潰れる。
/// `b = (1e-200, 1e-200)` ではゼロでない除数の分母が 0 になって
/// DivisionByZero を返し、`b = (1e200, 0)` では分母が inf になって
/// 結果が 0 に潰れる。後者は最終値が有限なので `finite()` も捕まえられない。
/// base-spec §25 が禁じる「暗黙の overflow」がここで起きる。
///
/// そこで大きい方の成分で規格化してから割る（Smith 法）。
pub fn div(a: Value, b: Value) -> CalcResult<Value> {
    if b.re == 0.0 && b.im == 0.0 {
        return Err(CalcError::DivisionByZero);
    }
    if b.re.abs() >= b.im.abs() {
        let t = b.im / b.re;
        let d = b.re + b.im * t;
        finite(Value::new(
            (a.re + a.im * t) / d,
            (a.im - a.re * t) / d,
        ))
    } else {
        let t = b.re / b.im;
        let d = b.re * t + b.im;
        finite(Value::new(
            (a.re * t + a.im) / d,
            (a.im * t - a.re) / d,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_complex_numbers() {
        let r = add(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(4.0, 6.0));
    }

    #[test]
    fn subtracts_complex_numbers() {
        let r = sub(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(2.0, 2.0));
    }

    #[test]
    fn multiplies_complex_numbers() {
        // (3+j4)(1+j2) = 3 + j6 + j4 + j^2*8 = -5 + j10
        let r = mul(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(-5.0, 10.0));
    }

    #[test]
    fn divides_complex_numbers() {
        // (-5+j10) / (1+j2) = 3+j4
        let r = div(Value::new(-5.0, 10.0), Value::new(1.0, 2.0)).unwrap();
        crate::assert_close(r.re, 3.0);
        crate::assert_close(r.im, 4.0);
    }

    #[test]
    fn divides_reals() {
        let r = div(Value::real(7.0), Value::real(2.0)).unwrap();
        assert_eq!(r, Value::real(3.5));
    }

    #[test]
    fn division_by_zero_is_an_error() {
        assert_eq!(
            div(Value::real(1.0), Value::ZERO),
            Err(CalcError::DivisionByZero)
        );
        // 複素数のゼロでも同じ。
        assert_eq!(
            div(Value::new(1.0, 1.0), Value::new(0.0, 0.0)),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn overflow_is_an_error() {
        let big = Value::real(f64::MAX);
        assert_eq!(mul(big, Value::real(10.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn a_tiny_but_nonzero_divisor_is_not_treated_as_zero() {
        // b.re^2 は f64 の最小非正規数を下回って 0 に潰れるが、b はゼロではない。
        // 1e-200 / (1e-200 + j1e-200) = 1/(1+j) = 0.5 - j0.5
        let r = div(Value::real(1e-200), Value::new(1e-200, 1e-200)).unwrap();
        crate::assert_close(r.re, 0.5);
        crate::assert_close(r.im, -0.5);
    }

    #[test]
    fn a_huge_divisor_does_not_collapse_to_zero() {
        // 素朴な式では分母が inf になり、結果が 0 に潰れる。
        let r = div(Value::real(1.0), Value::real(1e200)).unwrap();
        assert!(r.re > 0.0, "expected a tiny positive value, got {}", r.re);
        // 相対誤差で見る。絶対誤差では 1e-200 と 0 の区別がつかない。
        crate::assert_close(r.re / 1e-200, 1.0);
        assert_eq!(r.im, 0.0);
    }

    #[test]
    fn finite_rejects_nan_and_infinity() {
        assert_eq!(finite(Value::real(f64::NAN)), Err(CalcError::Overflow));
        assert_eq!(finite(Value::new(1.0, f64::INFINITY)), Err(CalcError::Overflow));
        assert_eq!(finite(Value::real(1.0)), Ok(Value::real(1.0)));
    }
}
