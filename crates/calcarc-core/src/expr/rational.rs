//! `i128` 有界の既約分数(numerical-policy「式は有理数で評価し、着地で 1 回
//! だけ丸める」)。
//!
//! **約分は最適化ではなく正しさの一部である。** 有界なので、約分しないと
//! 収まるはずの式が Overflow になる——`100万 ÷ 3 × 3` が通るのは、約分で
//! 分母の 3 が消えるからである。

use crate::{CalcError, CalcResult};

/// 既約分数。分母は常に正で、符号は分子が持つ。
///
/// **`i128::MIN` は値として持たない。** 絶対値が `i128::MAX` を超えるため、
/// Python 参照(|値| ≤ 2^127−1)と値域が食い違う。端から排除する方が、
/// 符号反転が失敗する場所ごとに分岐するより単純である。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rational {
    num: i128,
    den: i128,
}

fn gcd(a: u128, b: u128) -> u128 {
    let (mut a, mut b) = (a, b);
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a.max(1)
}

fn make(num: i128, den: i128) -> CalcResult<Rational> {
    if den == 0 {
        return Err(CalcError::DivisionByZero);
    }
    if num == i128::MIN || den == i128::MIN {
        return Err(CalcError::Overflow);
    }
    // ここまで来れば符号反転は必ず成功する。
    let (num, den) = if den < 0 { (-num, -den) } else { (num, den) };
    let divisor = gcd(num.unsigned_abs(), den.unsigned_abs()) as i128;
    Ok(Rational {
        num: num / divisor,
        den: den / divisor,
    })
}

impl Rational {
    pub fn from_i128(value: i128) -> CalcResult<Rational> {
        make(value, 1)
    }

    /// 小数を分数にする。`(15, 1)` は 1.5 を `15/10` で表す形の入口。
    pub fn from_ratio(numerator: i128, denominator: i128) -> CalcResult<Rational> {
        make(numerator, denominator)
    }

    pub fn is_negative(&self) -> bool {
        self.num < 0
    }

    pub fn is_zero(&self) -> bool {
        self.num == 0
    }

    pub fn checked_add(self, other: Rational) -> CalcResult<Rational> {
        let left = self.num.checked_mul(other.den).ok_or(CalcError::Overflow)?;
        let right = other.num.checked_mul(self.den).ok_or(CalcError::Overflow)?;
        let num = left.checked_add(right).ok_or(CalcError::Overflow)?;
        let den = self.den.checked_mul(other.den).ok_or(CalcError::Overflow)?;
        make(num, den)
    }

    pub fn checked_sub(self, other: Rational) -> CalcResult<Rational> {
        let negated = Rational {
            num: other.num.checked_neg().ok_or(CalcError::Overflow)?,
            den: other.den,
        };
        self.checked_add(negated)
    }

    /// **先に約分してから掛ける。** 交差する約分をしないと、収まるはずの式が
    /// 中間であふれる。
    pub fn checked_mul(self, other: Rational) -> CalcResult<Rational> {
        let a = gcd(self.num.unsigned_abs(), other.den.unsigned_abs()) as i128;
        let b = gcd(other.num.unsigned_abs(), self.den.unsigned_abs()) as i128;
        let num = (self.num / a)
            .checked_mul(other.num / b)
            .ok_or(CalcError::Overflow)?;
        let den = (self.den / b)
            .checked_mul(other.den / a)
            .ok_or(CalcError::Overflow)?;
        make(num, den)
    }

    pub fn checked_div(self, other: Rational) -> CalcResult<Rational> {
        if other.is_zero() {
            return Err(CalcError::DivisionByZero);
        }
        let reciprocal = Rational {
            num: other.den,
            den: other.num,
        };
        // 逆数は分母が負になりうる。make が符号を寄せる。
        self.checked_mul(make(reciprocal.num, reciprocal.den)?)
    }

    /// floor して符号なし整数へ。**負は着地できない**——金額も件数も期間も
    /// 符号なしの定義域だからである(numerical-policy)。
    pub fn floor_to_u128(&self) -> CalcResult<u128> {
        if self.is_negative() {
            return Err(CalcError::SyntaxError);
        }
        Ok(self.num.unsigned_abs() / self.den.unsigned_abs())
    }

    /// 分子と分母(検査と着地のため)。
    pub fn parts(&self) -> (i128, i128) {
        (self.num, self.den)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduction_keeps_expressions_inside_the_bound() {
        // 100万 ÷ 3 × 3。約分が効いていれば分母が 1 に戻る。
        let a = Rational::from_i128(1_000_000)
            .unwrap()
            .checked_div(Rational::from_i128(3).unwrap())
            .unwrap()
            .checked_mul(Rational::from_i128(3).unwrap())
            .unwrap();
        assert_eq!(a.parts(), (1_000_000, 1));
        assert_eq!(a.floor_to_u128().unwrap(), 1_000_000);
    }

    #[test]
    fn division_floors_only_at_the_landing() {
        let a = Rational::from_i128(1_000_000)
            .unwrap()
            .checked_div(Rational::from_i128(3).unwrap())
            .unwrap();
        assert_eq!(a.parts(), (1_000_000, 3));
        assert_eq!(a.floor_to_u128().unwrap(), 333_333);
    }

    #[test]
    fn an_intermediate_beyond_the_bound_is_an_error() {
        let huge = Rational::from_i128(i128::MAX).unwrap();
        assert_eq!(
            huge.checked_mul(Rational::from_i128(2).unwrap()),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn the_seam_sits_exactly_at_i128_max() {
        // 既存 golden の 39 桁ケースは**ちょうど i128::MAX** なので通る
        // (設計書 訂正 1)。u128 側の残りの帯は式に入れられない。
        assert_eq!(
            Rational::from_i128(i128::MAX)
                .unwrap()
                .floor_to_u128()
                .unwrap(),
            i128::MAX as u128
        );
    }

    #[test]
    fn i128_min_is_not_a_value() {
        // Python 参照は |値| ≤ 2^127−1 しか認めない。**対称な線を引く。**
        assert_eq!(Rational::from_i128(i128::MIN), Err(CalcError::Overflow));
        // 引き算で MIN に落ちる経路も塞がっている。
        let far = Rational::from_i128(-(i128::MAX)).unwrap();
        assert_eq!(
            far.checked_sub(Rational::from_i128(1).unwrap()),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn negatives_live_only_in_the_middle() {
        let v = Rational::from_i128(500)
            .unwrap()
            .checked_sub(Rational::from_i128(1000).unwrap())
            .unwrap();
        assert!(v.is_negative());
        assert_eq!(v.floor_to_u128(), Err(CalcError::SyntaxError));
        assert_eq!(
            v.checked_add(Rational::from_i128(2000).unwrap())
                .unwrap()
                .floor_to_u128()
                .unwrap(),
            1500
        );
    }

    #[test]
    fn dividing_by_zero_is_its_own_error() {
        assert_eq!(
            Rational::from_i128(100)
                .unwrap()
                .checked_div(Rational::from_i128(0).unwrap()),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn a_decimal_becomes_a_fraction() {
        // 1.5 + 0.25 = 175/100 -> 7/4。
        let a = Rational::from_ratio(15, 10).unwrap();
        let b = Rational::from_ratio(25, 100).unwrap();
        assert_eq!(a.checked_add(b).unwrap().parts(), (7, 4));
    }
}
