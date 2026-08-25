use crate::{AngleMode, CalcError, CalcResult, Value};

/// 実数の平方根。**負の実数と複素数は定義域の外**である（S-1 設計書 §1 の裁定 1）。
///
/// 以前は負の実数を虚軸に載せて `sqrt(-4) = 2j` を返していた。関数を実数に
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

/// x の y 乗。**二項演算子であって後置関数ではない**（設計書 §3.1）。
///
/// 実数の範囲で答が一意に決まるものは返し、そうでないものは `DomainError` に
/// する。判定を `f64::powf` に任せない——`powf` は `(-8)^(1/3)` を NaN に
/// するが `(-2)^3` は −8 を返すので、**どちらが定義域の外なのかを powf は
/// 区別していない**。判定を先に書き、通ったものにだけ powf を使う。
///
/// **`fract` の判定と NaN の網は、実測すると互いに冗長である**
/// （2026-08-16、S-1 の赤確認）。`x < 0` かつ非整数の指数で `powf` は必ず
/// NaN を返し、逆に NaN が出るのはその場合だけなので、**片方を消しても
/// テストは 1 件も赤くならない**。両方消すと `pow/-2.0/0.5` が
/// `Overflow`（`finalize` が NaN を弾いた結果）になって golden が赤くなる。
///
/// つまりこの 2 つが守っているのは**答えの正しさではなく、エラーの名前**で
/// ある——どちらが欠けても答えは出ず、欠けたときの違いは `DomainError` が
/// `Overflow` に化けることだけ。**「片方はテストが守っている」と思って
/// 消さないこと。** どちらも単独ではテストに守られていない。
pub fn pow(base: Value, exponent: Value) -> CalcResult<Value> {
    let x = real_arg(base)?;
    let y = real_arg(exponent)?;
    if !y.is_finite() {
        return Err(CalcError::DomainError);
    }
    if x == 0.0 {
        return match y.partial_cmp(&0.0) {
            // 0^0 = 1。電卓の慣行に従う（設計書 §4.1）。
            Some(std::cmp::Ordering::Equal) => Ok(Value::real(1.0)),
            Some(std::cmp::Ordering::Greater) => Ok(Value::ZERO),
            // 0^(負) は 0 除算だが、設計書 §4 の表は DomainError と定める。
            _ => Err(CalcError::DomainError),
        };
    }
    if x < 0.0 && y.fract() != 0.0 {
        // 複素数になる（裁定 1）。
        return Err(CalcError::DomainError);
    }
    let r = x.powf(y);
    if r.is_nan() {
        // 判定漏れを黙って通さないための最後の網。
        return Err(CalcError::DomainError);
    }
    Value::real(r).finalize()
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

/// 非負整数の引数を取り出す。`n!` / `nPr` / `nCr` の共通の入口（設計書 §3）。
///
/// 複素数は `real_arg` が弾く。ここで見るのは「非負の整数か」だけである。
fn non_negative_integer(v: Value) -> CalcResult<f64> {
    let x = real_arg(v)?;
    if !x.is_finite() || x < 0.0 || x.fract() != 0.0 {
        return Err(CalcError::DomainError);
    }
    Ok(x)
}

/// 階乗。定義域は**非負整数**（設計書 §3 の裁定 3）。
///
/// `2.5!` はガンマ関数だが入れない——「関数は実数に閉じる、面倒な拡張は
/// しない」という S-1 の精神と同じである。
///
/// `170!` ≈ 7.26e306 が f64 の上限で、`171!` は `Overflow` になる。
/// **f64 は `20!` の時点で既に厳密ではない**が、表示は有効数字 10 桁なので
/// 表示される桁はすべて正しい（実測 6.9e-16。numerical-policy を参照）。
pub fn factorial(v: Value) -> CalcResult<Value> {
    let n = non_negative_integer(v)?;
    let mut acc = 1.0_f64;
    let mut i = 2.0_f64;
    while i <= n {
        acc *= i;
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
}

/// `nPr` / `nCr` の 2 引数を検査する。どちらも非負整数で、`r ≤ n`。
fn check_pair(n: Value, r: Value) -> CalcResult<(f64, f64)> {
    let n = non_negative_integer(n)?;
    let r = non_negative_integer(r)?;
    if r > n {
        return Err(CalcError::DomainError);
    }
    Ok((n, r))
}

/// 順列 nPr = n(n−1)…(n−r+1)。定義域は非負整数で `r ≤ n`（設計書 §3）。
///
/// 素直な積でよい——答より大きい途中値が出ない。
pub fn npr(n: Value, r: Value) -> CalcResult<Value> {
    let (n, r) = check_pair(n, r)?;
    let mut acc = 1.0_f64;
    let mut i = 0.0_f64;
    while i < r {
        acc *= n - i;
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
}

/// 組合せ nCr。定義域は非負整数で `r ≤ n`（設計書 §3）。
///
/// **割ってから掛ける。順序が定義域を決める**（設計書 §4 の訂正）:
///
/// - 素直な `n!/(r!(n−r)!)` は `200 nCr 100`（答は 9.05e58）で `200!` が
///   溢れて落ちる
/// - 掛けてから割る（`acc * (n−i) / (i+1)`）は、**段の中のピーク**が答の
///   最大 `r` 倍になるので `n = 1022`〜`1028` の中心二項係数が**答は収まる
///   のに**落ちる
/// - **割ってから掛ける**（`acc / (i+1) * (n−i)`）だけが両方を通る
///
/// 精度は落ちない。無作為な 4,000 組で最悪相対誤差 3.6e-15 であり、
/// 表示の 10 桁より 5 桁良い（実測）。途中で整数にならない段があるが
/// （`C(5,2)` は 2.5 を通る）、f64 はもともと厳密ではない。
pub fn ncr(n: Value, r: Value) -> CalcResult<Value> {
    let (n, r) = check_pair(n, r)?;
    // 反復回数を減らす。C(n, r) = C(n, n−r)。
    let r = if r > n - r { n - r } else { r };
    let mut acc = 1.0_f64;
    let mut i = 0.0_f64;
    while i < r {
        acc = acc / (i + 1.0) * (n - i);
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
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
        // (3+4j)^2 = -7+24j
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
    fn power_of_a_positive_base() {
        close(pow(Value::real(2.0), Value::real(10.0)).unwrap().re, 1024.0);
        close(
            pow(Value::real(2.0), Value::real(0.5)).unwrap().re,
            2.0_f64.sqrt(),
        );
        close(pow(Value::real(2.0), Value::real(-1.0)).unwrap().re, 0.5);
    }

    #[test]
    fn zero_to_the_zero_is_one() {
        // 数学的には不定形だが、電卓は 1 を返すのが慣行である（設計書 §4.1）。
        // DomainError にすると x^0 の一様性が x = 0 でだけ崩れ、利用者には
        // 理由が見えない。
        assert_eq!(
            pow(Value::real(0.0), Value::real(0.0)).unwrap(),
            Value::real(1.0)
        );
    }

    #[test]
    fn zero_to_a_positive_power_is_zero_and_to_a_negative_one_is_undefined() {
        assert_eq!(
            pow(Value::real(0.0), Value::real(3.0)).unwrap(),
            Value::ZERO
        );
        assert_eq!(
            pow(Value::real(0.0), Value::real(-1.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn a_negative_base_needs_an_integer_exponent() {
        // (-2)^3 は実数で一意。これをエラーにすると普段やる計算が落ちる。
        close(pow(Value::real(-2.0), Value::real(3.0)).unwrap().re, -8.0);
        close(pow(Value::real(-2.0), Value::real(2.0)).unwrap().re, 4.0);
        // 非整数の指数は複素数になる（裁定 1）。
        assert_eq!(
            pow(Value::real(-2.0), Value::real(0.5)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            pow(Value::real(-8.0), Value::real(1.0 / 3.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn power_rejects_complex_operands() {
        let z = Value::new(3.0, 4.0);
        assert_eq!(pow(z, Value::real(2.0)), Err(CalcError::DomainError));
        assert_eq!(pow(Value::real(2.0), z), Err(CalcError::DomainError));
    }

    #[test]
    fn power_overflows_rather_than_returning_infinity() {
        assert_eq!(
            pow(Value::real(10.0), Value::real(400.0)),
            Err(CalcError::Overflow)
        );
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
        // 複素数は DomainError。1 ÷ (3+4j) と四則で書けるので機能は失われない。
        assert_eq!(recip(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn reciprocal_of_a_tiny_value_overflows() {
        assert_eq!(recip(Value::real(1e-320)), Err(CalcError::Overflow));
    }

    #[test]
    fn factorial_of_small_integers() {
        assert_eq!(factorial(Value::real(0.0)).unwrap(), Value::real(1.0));
        assert_eq!(factorial(Value::real(1.0)).unwrap(), Value::real(1.0));
        assert_eq!(factorial(Value::real(5.0)).unwrap(), Value::real(120.0));
        close(
            factorial(Value::real(20.0)).unwrap().re,
            2.43290200817664e18,
        );
    }

    #[test]
    fn factorial_stops_at_the_f64_ceiling() {
        // 170! は収まり、171! は溢れる（設計書 §4）。
        assert!(factorial(Value::real(170.0)).is_ok());
        assert_eq!(factorial(Value::real(171.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn factorial_is_only_defined_on_non_negative_integers() {
        // ガンマ関数には広げない（設計書 §3 の裁定 3）。
        assert_eq!(factorial(Value::real(2.5)), Err(CalcError::DomainError));
        assert_eq!(factorial(Value::real(-1.0)), Err(CalcError::DomainError));
        assert_eq!(factorial(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn permutations_and_combinations_of_small_numbers() {
        assert_eq!(
            npr(Value::real(5.0), Value::real(2.0)).unwrap(),
            Value::real(20.0)
        );
        assert_eq!(
            ncr(Value::real(5.0), Value::real(2.0)).unwrap(),
            Value::real(10.0)
        );
    }

    #[test]
    fn the_counting_boundaries_are_all_one() {
        // 0! = nP0 = nC0 = nCn = 1（設計書 §3）。
        assert_eq!(
            npr(Value::real(5.0), Value::real(0.0)).unwrap(),
            Value::real(1.0)
        );
        assert_eq!(
            ncr(Value::real(5.0), Value::real(0.0)).unwrap(),
            Value::real(1.0)
        );
        assert_eq!(
            ncr(Value::real(5.0), Value::real(5.0)).unwrap(),
            Value::real(1.0)
        );
    }

    #[test]
    fn r_may_not_exceed_n() {
        assert_eq!(
            ncr(Value::real(5.0), Value::real(6.0)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            npr(Value::real(5.0), Value::real(6.0)),
            Err(CalcError::DomainError)
        );
        // 非整数と負も定義域の外。
        assert_eq!(
            ncr(Value::real(5.5), Value::real(2.0)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            ncr(Value::real(5.0), Value::real(-1.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn ncr_does_not_overflow_on_the_way_to_an_answer_that_fits() {
        // **設計書 §4 の主張、訂正版。** ここで主張するのは**溢れないこと**
        // だけである。
        //
        // **値そのものはここでは測れない。** `assert_close` は絶対誤差
        // 1e-12 で比べるので、1e58 や 1e306 では常に落ちる（差が 1 ULP でも
        // 1e42 ある）。値は golden が Python の厳密整数と**相対誤差**で
        // 突き合わせる——そちらが正しい場所である。
        let c = |n: f64, r: f64| ncr(Value::real(n), Value::real(r));
        // 素直な n!/(r!(n−r)!) はここで落ちる（200! が溢れる）。
        assert!(c(200.0, 100.0).is_ok());
        assert!(c(1000.0, 500.0).is_ok());
        // **この 3 行が「割ってから掛ける」でしか通らない**——掛けてから
        // 割る形は段の中のピークが答の r 倍になって溢れる。
        assert!(c(1022.0, 511.0).is_ok());
        assert!(c(1024.0, 512.0).is_ok());
        assert!(c(1028.0, 514.0).is_ok());
        // 帯の外側。対照として置く——ここまでは 3 つの書き方すべてが通る。
        assert!(c(1020.0, 510.0).is_ok());
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
