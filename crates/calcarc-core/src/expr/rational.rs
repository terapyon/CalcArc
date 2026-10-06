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
    /// 0。engine の印(`engine::exact`)が初期値・`AC`・`(` の 0 に付ける。
    pub const ZERO: Rational = Rational { num: 0, den: 1 };
    /// 1。`π` キーの印 `1 × π` に使う。
    pub const ONE: Rational = Rational { num: 1, den: 1 };

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

    /// **正しく丸めた f64**(1.2.2 設計書 §5.3)。真の値にいちばん近い f64、同点は偶数へ。
    ///
    /// 分母は不変として正なので `ratio_to_f64` は必ず値を返す。**`None` の腕は来ないが、
    /// panic しない約束のために NaN を置く**(`unwrap` は使わない)。
    pub fn to_f64(self) -> f64 {
        ratio_to_f64(self.num, self.den).unwrap_or(f64::NAN)
    }
}

/// 2^53。これ以下の整数は f64 が厳密に持てる。
const EXACT_INT: u128 = 1 << 53;

/// **`num / den` を正しく丸めた f64**(1.2.2 設計書 §5.3、§11.2 の未決 2)。最近接、同点は
/// 偶数へ(IEEE 754 の既定)。`den == 0` なら `None`。**panic しない。**
///
/// - **分子と分母の絶対値がどちらも 2^53 以下なら、除算 1 回**——2 つとも f64 に厳密に
///   入り、IEEE の除算は厳密な 2 数の商を正しく丸める。
/// - **それより大きいときは u128 の長除算**で、商の上位 54 ビット(53 ビット＋丸めの 1 ビット)
///   と sticky(それより下が 0 でないか)を作ってから丸める。`as f64` を 2 回通す道
///   (`num as f64 / den as f64`)は、変換と除算で **2 度丸める**ので 1 ulp 外れうる。
///
/// **値域**: 絶対値は `1/2^127` から `2^127` まで(`i128::MIN` も符号を外して受け取る)。
/// **非正規化数にも溢れにも届かない**——どちらも f64 の正規化数の内側に収まる
/// (2^-1022 ≪ 2^-127、2^127 ≪ 2^1024)。だから丸めは 53 ビットの仮数だけで決まる。
pub fn ratio_to_f64(num: i128, den: i128) -> Option<f64> {
    let magnitude = round_unsigned(num.unsigned_abs(), den.unsigned_abs())?;
    // **0 は符号を持たない**(`0 / −5` は `+0.0`。Python の `float(Fraction(0, -5))` と同じ)。
    Some(if num != 0 && (num < 0) != (den < 0) {
        -magnitude
    } else {
        magnitude
    })
}

/// `a / b`(`b ≠ 0`)を正しく丸める。符号は呼び手が付ける。
fn round_unsigned(a: u128, b: u128) -> Option<f64> {
    if b == 0 {
        return None;
    }
    if a == 0 {
        return Some(0.0);
    }
    if a <= EXACT_INT && b <= EXACT_INT {
        return Some(a as f64 / b as f64);
    }
    // 商を `m × 2^exp`(m は 54 ビット: 2^53 ≤ m < 2^54)と sticky にする。
    let whole = a / b;
    let mut rest = a % b;
    let (mut m, mut exp, sticky): (u128, i32, bool);
    if whole >= EXACT_INT << 1 {
        // 整数部だけで 55 ビット以上ある。上位 54 ビットを取り、捨てた下位と余りが sticky。
        let shift = (u128::BITS - whole.leading_zeros()) - 54;
        m = whole >> shift;
        sticky = whole & ((1 << shift) - 1) != 0 || rest != 0;
        exp = i32::try_from(shift).ok()?;
    } else {
        // 整数部が 54 ビットに満たない。小数部の桁を 1 ビットずつ足していく。
        // **`rest < b ≤ 2^127` なので `rest << 1` は u128 に収まる。**
        m = whole;
        exp = 0;
        while m < EXACT_INT {
            rest <<= 1;
            m <<= 1;
            if rest >= b {
                rest -= b;
                m |= 1;
            }
            exp -= 1;
        }
        sticky = rest != 0;
    }
    // 最下位の 1 ビットが丸めのビット。上の 53 ビットが仮数。
    let round = m & 1 == 1;
    m >>= 1;
    exp += 1;
    if round && (sticky || m & 1 == 1) {
        m += 1;
        if m == EXACT_INT {
            // 繰り上がりで 54 ビットになった(仮数がすべて 1 だった)。
            m >>= 1;
            exp += 1;
        }
    }
    // `m < 2^53` は f64 に厳密に入り、2^exp との積も厳密(値は正規化数の内側)。
    let biased = u64::try_from(exp + 1023).ok()?;
    Some(m as f64 * f64::from_bits(biased << 52))
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

    // ---- 正しく丸めた f64(1.2.2 設計書 §5.3) ----
    //
    // **期待値は手で構成した 2 進の値**——言語をまたぐ照合は
    // `tests/rational_to_f64_golden.rs`(Python の `float(Fraction)`)が持つ。

    const P53: i128 = 1 << 53;

    #[test]
    fn small_ratios_take_one_division() {
        assert_eq!(ratio_to_f64(1, 3), Some(1.0 / 3.0));
        assert_eq!(ratio_to_f64(1, 1000), Some(0.001));
        assert_eq!(ratio_to_f64(P53, 1), Some(9007199254740992.0));
        assert_eq!(ratio_to_f64(0, 7), Some(0.0));
    }

    #[test]
    fn a_zero_denominator_is_none_not_a_panic() {
        assert_eq!(ratio_to_f64(1, 0), None);
        assert_eq!(ratio_to_f64(0, 0), None);
        assert_eq!(ratio_to_f64(i128::MIN, 0), None);
    }

    #[test]
    fn ties_go_to_even_above_two_to_the_53() {
        // 2^53 + 1 は 2^53 と 2^53 + 2 のちょうど中間 → 偶数の 2^53。
        assert_eq!(ratio_to_f64(P53 + 1, 1), Some(9007199254740992.0));
        // 2^53 + 3 は 2^53 + 2 と 2^53 + 4 の中間 → 偶数の 2^53 + 4。
        assert_eq!(ratio_to_f64(P53 + 3, 1), Some(9007199254740996.0));
        // 中間より上なら上へ(sticky が効く)。
        assert_eq!(ratio_to_f64((P53 + 1) * 4 + 1, 4), Some(9007199254740994.0));
        // 中間より下なら下へ。
        assert_eq!(ratio_to_f64((P53 + 1) * 4 - 1, 4), Some(9007199254740992.0));
    }

    #[test]
    fn unreduced_large_ratios_round_like_their_reduced_form() {
        // 長除算の道(分子・分母とも 2^53 超)と除算 1 回の道が同じ答えになる。
        let k = 1_i128 << 70;
        assert_eq!(ratio_to_f64(k, 3 * k), Some(1.0 / 3.0));
        assert_eq!(ratio_to_f64(7 * k, 10 * k), Some(0.7));
        // 同点も長除算の道で偶数へ。
        assert_eq!(ratio_to_f64((P53 + 1) * k, k), Some(9007199254740992.0));
        assert_eq!(ratio_to_f64((P53 + 3) * k, k), Some(9007199254740996.0));
    }

    #[test]
    fn the_ends_of_i128() {
        let two_127 = 2.0_f64.powi(127);
        // 2^127 − 1 は 2^127 に丸まる(繰り上がりで仮数が 54 ビットになる道)。
        assert_eq!(ratio_to_f64(i128::MAX, 1), Some(two_127));
        assert_eq!(ratio_to_f64(1, i128::MAX), Some(1.0 / two_127));
        // `i128::MIN` も符号を外して受け取る。
        assert_eq!(ratio_to_f64(i128::MIN, 1), Some(-two_127));
        assert_eq!(ratio_to_f64(i128::MIN, -1), Some(two_127));
        assert_eq!(ratio_to_f64(i128::MIN, i128::MIN), Some(1.0));
        assert_eq!(ratio_to_f64(i128::MAX, i128::MAX - 1), Some(1.0));
    }

    #[test]
    fn signs_follow_the_quotient() {
        assert_eq!(ratio_to_f64(-1, 3), Some(-1.0 / 3.0));
        assert_eq!(ratio_to_f64(1, -3), Some(-1.0 / 3.0));
        assert_eq!(ratio_to_f64(-1, -3), Some(1.0 / 3.0));
        // 0 は `+0.0`(`-0.0` は `==` では見分けられないのでビットで見る)。
        assert_eq!(ratio_to_f64(0, -5).map(f64::to_bits), Some(0));
        assert_eq!(ratio_to_f64(-(P53 + 3), 1), Some(-9007199254740996.0));
    }

    #[test]
    fn to_f64_reads_the_reduced_fraction() {
        assert_eq!(Rational::from_ratio(1, 1000).unwrap().to_f64(), 0.001);
        assert_eq!(Rational::from_ratio(3, 10).unwrap().to_f64(), 0.3);
    }

    #[test]
    fn a_decimal_becomes_a_fraction() {
        // 1.5 + 0.25 = 175/100 -> 7/4。
        let a = Rational::from_ratio(15, 10).unwrap();
        let b = Rational::from_ratio(25, 100).unwrap();
        assert_eq!(a.checked_add(b).unwrap().parts(), (7, 4));
    }
}
