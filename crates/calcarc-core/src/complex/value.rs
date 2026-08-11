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
}
