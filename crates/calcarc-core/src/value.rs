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
    /// # 何が難しいか
    ///
    /// 素朴な `(rhs.re² + rhs.im²)` を分母にすると、中間の二乗で溢れるか潰れる。
    /// `rhs = (1e-200, 1e-200)` ではゼロでない除数の分母が 0 になって
    /// DivisionByZero を返し、`rhs = (1e200, 0)` では分母が inf になって
    /// 結果が 0 に潰れる。後者は最終値が有限なので `finalize()` も捕まえられない。
    /// base-spec §25 が禁じる「暗黙の overflow」がここで起きる。
    ///
    /// # 手当ては 2 段階（**どちらが何を塞ぐか**）
    ///
    /// **① Smith 法**（大きい方の成分で規格化してから割る）——**二乗を作らない**ので、
    /// 上の 2 例は塞がる。**0.9.4 より前はここまでだった。**
    ///
    /// **② 2 の冪でのスケーリング**（0.9.4、外部報告 F7）。**①だけでは足りなかった。**
    /// **残っていたのは、二乗ではなく `d` そのものが溢れる形**である
    /// ——`|re| >= |im|` の腕の `d = re + im*t` は最大 `2|re|` になるので、
    /// **`|re| + im²/|re| > f64::MAX` で `d` が inf**。分子が有限なら
    /// **`有限/inf = 0` に潰れ、エラーも出ない**（**静かに嘘の答え**）。
    /// **下端にも別口が在った**——非正規化数では `t = im/re` と `im*t` が
    /// **非正規化域で丸められて桁が死ぬ**（`1e-320` で相対 2.4e-4 の誤差）。
    ///
    /// **分子と分母を、それぞれ 2 の冪で `[1,2)` へ寄せてから割り、商を戻す。**
    /// `(a·2^kn)/(b·2^ks) = (a/b)·2^(kn−ks)` なので、戻す倍率は `2^(ks−kn)`。
    /// **2 の冪倍は仮数を変えない**ので、**商は倍率に依らない**——精度を足すのでも
    /// 削るのでもなく、**中間値を安全な帯へ移すだけ**である。
    /// 寄せたあとの `d` は `[1,4)` に収まり、**溢れも潰れもしない。**
    ///
    /// # この註が言えること・言えないこと
    ///
    /// **測ったのは複素除算 1 回**である（calcarc-88 の 572 件。分母の形 5 種 ×
    /// 符号 4 種 × 大きさ 10 階級と、真に範囲外の 12 件）。**直す前は 80 件が壊れ、
    /// 直したあとは 0 件**、**「範囲外なのに値を返す」は前後とも 0 件**である。
    ///
    /// **測っていないもの**（**「塞いだ」と読まないこと**——**①をそう読んだのが
    /// F7 の出発点だった**）: **`checked_mul` / `checked_add` に同じ形が在るか**、
    /// **`a/b/c` のように途中の商が端に着地する連鎖**、**除算を内蔵する関数**
    /// （`tan`・`recip`・極形式）、**表示層**、**wasm 境界の向こう**。
    pub fn checked_div(self, rhs: Value) -> CalcResult<Value> {
        if rhs.re == 0.0 && rhs.im == 0.0 {
            return Err(CalcError::DivisionByZero);
        }
        // **分子と分母を別々に寄せる。** 同じ倍率で寄せると、片方が端に居るときに
        // もう片方が溢れるか潰れる（`MAX / 1e-320` のような組み合わせ）。
        let ks = -binary_exponent(rhs.re.abs().max(rhs.im.abs()));
        let kn = -binary_exponent(self.re.abs().max(self.im.abs()));
        let (ar, ai) = (scale_pow2(self.re, kn), scale_pow2(self.im, kn));
        let (br, bi) = (scale_pow2(rhs.re, ks), scale_pow2(rhs.im, ks));
        let (qr, qi) = if br.abs() >= bi.abs() {
            let t = bi / br;
            let d = br + bi * t;
            ((ar + ai * t) / d, (ai - ar * t) / d)
        } else {
            let t = br / bi;
            let d = br * t + bi;
            ((ar * t + ai) / d, (ai * t - ar) / d)
        };
        // **戻す段で溢れたなら、それは本物の範囲外**である（`finalize()` が見る）。
        let back = ks - kn;
        Value::new(scale_pow2(qr, back), scale_pow2(qi, back)).finalize()
    }
}

/// `x` の 2 進指数（`x` が `2^e` 以上 `2^(e+1)` 未満の `e`）。
///
/// **非正規化数も正しく返す**——あそこは指数欄が 0 で、大きさは仮数に入っている。
/// **0 と非有限には 0 を返す**（寄せない。呼び出し側はそのまま割る）。
fn binary_exponent(x: f64) -> i32 {
    if x == 0.0 || !x.is_finite() {
        return 0;
    }
    let bits = x.to_bits();
    let raw = ((bits >> 52) & 0x7ff) as i32;
    if raw != 0 {
        return raw - 1023;
    }
    // 非正規化数: 最上位の立っているビットの位置から数える。
    let mantissa = bits & ((1u64 << 52) - 1);
    let leading = 63 - mantissa.leading_zeros() as i32;
    leading - 52 - 1022
}

/// `x * 2^k`。**2 の冪倍は仮数を変えない**ので、丸めを増やさない。
///
/// **倍率を 1 つの `f64` で作らない**——`k` は非正規化数の正規化で ±1000 を
/// 超えうるので、`2^k` 自体が表せない。**刻んで掛ける。**
fn scale_pow2(x: f64, k: i32) -> f64 {
    const CHUNK: i32 = 1000;
    let mut y = x;
    let mut k = k;
    while k > CHUNK {
        y *= two_pow(CHUNK);
        k -= CHUNK;
    }
    while k < -CHUNK {
        y *= two_pow(-CHUNK);
        k += CHUNK;
    }
    y * two_pow(k)
}

/// `2^k`（`-1022 <= k <= 1023`）。指数欄を直に組む。
fn two_pow(k: i32) -> f64 {
    f64::from_bits((((k + 1023) as u64) & 0x7ff) << 52)
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
        // (3+4j)(1+2j) = 3 + 6j + 4j + j^2*8 = -5 + 10j
        let r = Value::new(3.0, 4.0)
            .checked_mul(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(-5.0, 10.0));
    }

    #[test]
    fn divides_complex_numbers() {
        // (-5+10j) / (1+2j) = 3+4j
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
        // 1e-200 / (1e-200 + 1je-200) = 1/(1+j) = 0.5 - 0.5j
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
    fn finalize_rejects_nan_and_infinity() {
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
        // 生む。atan2 が符号違いの角度を返すのを防ぐため、finalize() で
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
