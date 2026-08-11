use crate::{CalcError, CalcResult};
use serde::{Deserialize, Serialize};

/// 計算コアが扱う唯一の数値型。
///
/// 実数も虚部 0 の複素数として保持する（base-spec §10、設計書 D8）。
/// 実数型と複素数型を分けないことで、演算ごとの型分岐が生じない。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Value {
    pub re: f64,
    pub im: f64,
}

impl Value {
    pub const ZERO: Value = Value { re: 0.0, im: 0.0 };

    pub fn new(re: f64, im: f64) -> Value {
        Value { re, im }
    }

    pub fn real(re: f64) -> Value {
        Value { re, im: 0.0 }
    }

    pub fn imag(im: f64) -> Value {
        Value { re: 0.0, im }
    }

    /// 虚部が 0 のとき真。表示を実数として描画するかの判定に使う。
    pub fn is_real(&self) -> bool {
        self.im == 0.0
    }

    /// 非有限な結果を Overflow として弾き、-0.0 を均す関門。
    ///
    /// f64 の演算は溢れても panic せず inf / NaN を返すため、
    /// 表示に到達する前にここで捕まえる（base-spec §25、§27）。
    /// atan2 は零の符号で ±π を返し分けるため、-0.0 を残さない。
    pub(crate) fn finalize(self) -> CalcResult<Value> {
        if self.re.is_finite() && self.im.is_finite() {
            Ok(Value::new(
                without_negative_zero(self.re),
                without_negative_zero(self.im),
            ))
        } else {
            Err(CalcError::Overflow)
        }
    }

    pub fn checked_add(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re + rhs.re, self.im + rhs.im).finalize()
    }

    pub fn checked_sub(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re - rhs.re, self.im - rhs.im).finalize()
    }

    pub fn checked_mul(self, rhs: Value) -> CalcResult<Value> {
        Value::new(
            self.re * rhs.re - self.im * rhs.im,
            self.re * rhs.im + self.im * rhs.re,
        )
        .finalize()
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
    pub fn checked_div(self, rhs: Value) -> CalcResult<Value> {
        if rhs.re == 0.0 && rhs.im == 0.0 {
            return Err(CalcError::DivisionByZero);
        }
        if rhs.re.abs() >= rhs.im.abs() {
            let t = rhs.im / rhs.re;
            let d = rhs.re + rhs.im * t;
            Value::new((self.re + self.im * t) / d, (self.im - self.re * t) / d).finalize()
        } else {
            let t = rhs.re / rhs.im;
            let d = rhs.re * t + rhs.im;
            Value::new((self.re * t + self.im) / d, (self.im * t - self.re) / d).finalize()
        }
    }
}

/// -0.0 を +0.0 に均す。それ以外はそのまま返す。
fn without_negative_zero(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { x }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_has_zero_imaginary_part() {
        let v = Value::real(3.0);
        assert_eq!(v.re, 3.0);
        assert_eq!(v.im, 0.0);
        assert!(v.is_real());
    }

    #[test]
    fn imag_has_zero_real_part() {
        let v = Value::imag(4.0);
        assert_eq!(v.re, 0.0);
        assert_eq!(v.im, 4.0);
        assert!(!v.is_real());
    }

    #[test]
    fn zero_is_real() {
        assert!(Value::ZERO.is_real());
        assert_eq!(Value::ZERO, Value::new(0.0, 0.0));
    }

    #[test]
    fn negative_zero_imaginary_still_counts_as_real() {
        // -0.0 == 0.0 は true なので実数扱いになる。
        // atan2 の符号が -0.0 で変わるため、この前提を明示的に固定しておく。
        assert!(Value::new(1.0, -0.0).is_real());
    }

    #[test]
    fn adds_complex_numbers() {
        let r = Value::new(3.0, 4.0)
            .checked_add(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(4.0, 6.0));
    }

    #[test]
    fn subtracts_complex_numbers() {
        let r = Value::new(3.0, 4.0)
            .checked_sub(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(2.0, 2.0));
    }

    #[test]
    fn multiplies_complex_numbers() {
        // (3+j4)(1+j2) = 3 + j6 + j4 + j^2*8 = -5 + j10
        let r = Value::new(3.0, 4.0)
            .checked_mul(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(-5.0, 10.0));
    }

    #[test]
    fn divides_complex_numbers() {
        // (-5+j10) / (1+j2) = 3+j4
        let r = Value::new(-5.0, 10.0)
            .checked_div(Value::new(1.0, 2.0))
            .unwrap();
        crate::assert_close(r.re, 3.0);
        crate::assert_close(r.im, 4.0);
    }

    #[test]
    fn divides_reals() {
        let r = Value::real(7.0).checked_div(Value::real(2.0)).unwrap();
        assert_eq!(r, Value::real(3.5));
    }

    #[test]
    fn division_by_zero_is_an_error() {
        assert_eq!(
            Value::real(1.0).checked_div(Value::ZERO),
            Err(CalcError::DivisionByZero)
        );
        // 複素数のゼロでも同じ。
        assert_eq!(
            Value::new(1.0, 1.0).checked_div(Value::new(0.0, 0.0)),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn overflow_is_an_error() {
        let big = Value::real(f64::MAX);
        assert_eq!(big.checked_mul(Value::real(10.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn a_tiny_but_nonzero_divisor_is_not_treated_as_zero() {
        // b.re^2 は f64 の最小非正規数を下回って 0 に潰れるが、b はゼロではない。
        // 1e-200 / (1e-200 + j1e-200) = 1/(1+j) = 0.5 - j0.5
        let r = Value::real(1e-200)
            .checked_div(Value::new(1e-200, 1e-200))
            .unwrap();
        crate::assert_close(r.re, 0.5);
        crate::assert_close(r.im, -0.5);
    }

    #[test]
    fn a_huge_divisor_does_not_collapse_to_zero() {
        // 素朴な式では分母が inf になり、結果が 0 に潰れる。
        let r = Value::real(1.0).checked_div(Value::real(1e200)).unwrap();
        assert!(r.re > 0.0, "expected a tiny positive value, got {}", r.re);
        // 相対誤差で見る。絶対誤差では 1e-200 と 0 の区別がつかない。
        crate::assert_close(r.re / 1e-200, 1.0);
        assert_eq!(r.im, 0.0);
    }

    #[test]
    fn finite_rejects_nan_and_infinity() {
        assert_eq!(Value::real(f64::NAN).finalize(), Err(CalcError::Overflow));
        assert_eq!(
            Value::new(1.0, f64::INFINITY).finalize(),
            Err(CalcError::Overflow)
        );
        assert_eq!(Value::real(1.0).finalize(), Ok(Value::real(1.0)));
    }

    #[test]
    fn multiplication_never_produces_a_negative_zero() {
        // 1 × -1 × 0 のような経路は素朴な IEEE 754 の乗算では -0.0 を
        // 生む。atan2 が符号違いの角度を返すのを防ぐため、finite() で
        // 均す。
        assert!(
            Value::real(-1.0)
                .checked_mul(Value::ZERO)
                .unwrap()
                .re
                .is_sign_positive()
        );
    }
}
