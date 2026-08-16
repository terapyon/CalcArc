use crate::{AngleMode, CalcError, CalcResult, Value};

/// 実数の平方根。**負の実数と複素数は定義域の外**である（S-1 設計書 §1 の裁定 1）。
///
/// 以前は負の実数を虚軸に載せて `sqrt(-4) = j2` を返していた。関数を実数に
/// 閉じる裁定でそれを落とした。**複素数は入力と四則と表示の機能であって、
/// 関数の値域ではない。** `sqr` と `neg` は複素数のままである——2 乗は乗算、
/// 符号反転は減算であり、どちらも四則の側にある。
pub fn sqrt(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x < 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.sqrt()).finalize()
}

/// 関数の引数を実数として取り出す。複素数は `DomainError`（設計書 §1 の裁定 4）。
///
/// 実部だけ使う案は**黙って別の計算をする**ので採らない。
fn real_arg(v: Value) -> CalcResult<f64> {
    if v.is_real() {
        Ok(v.re)
    } else {
        Err(CalcError::DomainError)
    }
}

pub fn sqr(v: Value) -> CalcResult<Value> {
    v.checked_mul(v)
}

pub fn neg(v: Value) -> Value {
    Value::new(negated(v.re), negated(v.im))
}

/// 符号を反転する。ただし -0.0 は作らない。
///
/// atan2 は第一引数の零の符号で ±π を返し分けるため、-0.0 が虚部に
/// 残ると `1 +/−` が `1 ∠ -180`、`0 − 1 =` が `1 ∠ 180` と食い違う。
/// 同じ値が到達経路で違う角度になるのを防ぐ。
fn negated(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { -x }
}

/// 角度モードに従って引数をラジアンに直す。
///
/// 複素数の引数でも実部・虚部の両方を同じ係数で変換する。
/// これは z を単位付きの量とみなす解釈で、実数のときに
/// 通常の度数法と一致する。
fn to_rad(v: Value, mode: AngleMode) -> Value {
    Value::new(mode.radians_of(v.re), mode.radians_of(v.im))
}

pub fn sin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    Value::new(z.re.sin() * z.im.cosh(), z.re.cos() * z.im.sinh()).finalize()
}

pub fn cos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    Value::new(z.re.cos() * z.im.cosh(), -z.re.sin() * z.im.sinh()).finalize()
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
    sin(v, mode)?.checked_div(cos(v, mode)?)
}

fn is_tan_pole(v: Value, mode: AngleMode) -> bool {
    if !v.is_real() || mode != AngleMode::Deg {
        return false;
    }
    let a = v.re.abs();
    a >= 90.0 && (a - 90.0) % 180.0 == 0.0
}

/// 自然対数。定義域は `x > 0`（設計書 §3）。
pub fn ln(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x <= 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.ln()).finalize()
}

/// 常用対数。定義域は `x > 0`。
pub fn log10(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x <= 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.log10()).finalize()
}

/// e の x 乗。
///
/// **`Key::Exp`（指数入力 EE）とは別物である。** 名前が紛らわしいので、
/// この関数もキーのトークンも `exp_e` で通す（設計書 §3）。
/// 定義域は全実数で、落ちるのは結果が f64 を溢れたときだけ。
pub fn exp_e(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    Value::real(x.exp()).finalize()
}

/// 逆正弦。定義域は `−1 ≤ x ≤ 1`。
///
/// **返す角度は `AngleMode` に従う。** `sin` などが `AngleMode` で引数を
/// 解釈しているのと対称である（設計書 §3）。
pub fn asin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if !(-1.0..=1.0).contains(&x) {
        return Err(CalcError::DomainError);
    }
    Value::real(mode.angle_of(x.asin())).finalize()
}

/// 逆余弦。定義域は `−1 ≤ x ≤ 1`。
pub fn acos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if !(-1.0..=1.0).contains(&x) {
        return Err(CalcError::DomainError);
    }
    Value::real(mode.angle_of(x.acos())).finalize()
}

/// 逆正接。定義域は全実数。
pub fn atan(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    Value::real(mode.angle_of(x.atan())).finalize()
}

/// 逆数。**`x = 0` は `DomainError` ではなく `DivisionByZero`**（設計書 §3.0）。
///
/// `DomainError` は「その値には定義が無い」を言うために新設した名前で、
/// 0 除算はそれとは別に既に名前を持っている。
pub fn recip(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x == 0.0 {
        return Err(CalcError::DivisionByZero);
    }
    Value::real(1.0 / x).finalize()
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
    fn square_root_of_a_negative_real_is_a_domain_error() {
        assert_eq!(sqrt(Value::real(-4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn square_root_of_a_complex_number_is_a_domain_error() {
        // 極形式経由で答えられたが、関数は実数に閉じる（設計書 §5）。
        assert_eq!(sqrt(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
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
    fn negation_never_produces_a_negative_zero() {
        // -0.0 が残ると atan2 が符号違いの角度を返す。
        assert!(neg(Value::real(1.0)).im.is_sign_positive());
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
    fn natural_log_of_e_is_one() {
        close(ln(Value::real(std::f64::consts::E)).unwrap().re, 1.0);
    }

    #[test]
    fn natural_log_is_undefined_at_zero_and_below() {
        assert_eq!(ln(Value::real(0.0)), Err(CalcError::DomainError));
        assert_eq!(ln(Value::real(-1.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn common_log_of_a_power_of_ten() {
        close(log10(Value::real(1000.0)).unwrap().re, 3.0);
        assert_eq!(log10(Value::real(0.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn exp_e_is_the_inverse_of_ln() {
        close(exp_e(Value::real(1.0)).unwrap().re, std::f64::consts::E);
        // 定義域は全実数。落ちるのは溢れたときだけ（設計書 §3）。
        assert_eq!(exp_e(Value::real(1e5)), Err(CalcError::Overflow));
    }

    #[test]
    fn inverse_trig_returns_the_angle_in_the_current_mode() {
        close(asin(Value::real(0.5), AngleMode::Deg).unwrap().re, 30.0);
        close(acos(Value::real(0.5), AngleMode::Deg).unwrap().re, 60.0);
        close(atan(Value::real(1.0), AngleMode::Deg).unwrap().re, 45.0);
        close(asin(Value::real(1.0), AngleMode::Rad).unwrap().re, PI / 2.0);
    }

    #[test]
    fn inverse_sine_and_cosine_are_bounded_by_one() {
        assert_eq!(
            asin(Value::real(1.0000001), AngleMode::Deg),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            acos(Value::real(-1.0000001), AngleMode::Deg),
            Err(CalcError::DomainError)
        );
        // 境界そのものは定義域の中。
        assert!(asin(Value::real(1.0), AngleMode::Deg).is_ok());
        assert!(acos(Value::real(-1.0), AngleMode::Deg).is_ok());
        // atan は全実数。
        assert!(atan(Value::real(1e300), AngleMode::Deg).is_ok());
    }

    #[test]
    fn reciprocal_of_zero_is_a_division_by_zero() {
        // DomainError ではない（設計書 §3.0）。利用者にとってこれは 0 除算で
        // あり、5 ÷ 0 と違うエラーを返す理由が無い。
        assert_eq!(recip(Value::real(0.0)), Err(CalcError::DivisionByZero));
    }

    #[test]
    fn reciprocal_inverts() {
        close(recip(Value::real(4.0)).unwrap().re, 0.25);
        close(recip(Value::real(-8.0)).unwrap().re, -0.125);
        // 複素数は DomainError。1 ÷ (3+j4) と四則で書けるので機能は失われない。
        assert_eq!(recip(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn reciprocal_of_a_tiny_value_overflows() {
        assert_eq!(recip(Value::real(1e-320)), Err(CalcError::Overflow));
    }

    #[test]
    fn the_new_functions_reject_complex_arguments() {
        // 裁定 4: 実部だけ使う案は黙って別の計算をするので採らない。
        let z = Value::new(3.0, 4.0);
        assert_eq!(ln(z), Err(CalcError::DomainError));
        assert_eq!(log10(z), Err(CalcError::DomainError));
        assert_eq!(exp_e(z), Err(CalcError::DomainError));
        assert_eq!(asin(z, AngleMode::Deg), Err(CalcError::DomainError));
        assert_eq!(acos(z, AngleMode::Deg), Err(CalcError::DomainError));
        assert_eq!(atan(z, AngleMode::Deg), Err(CalcError::DomainError));
    }

    #[test]
    fn trig_accepts_complex_arguments() {
        // sin(z) = sin(a)cosh(b) + j cos(a)sinh(b)
        let r = sin(Value::new(0.0, 1.0), AngleMode::Rad).unwrap();
        close(r.re, 0.0);
        close(r.im, 1.0_f64.sinh());
    }
}
