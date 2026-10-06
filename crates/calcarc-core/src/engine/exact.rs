//! 値に添える「厳密な正体」の印(1.2.3 設計書 §3)。
//!
//! **印は `re`(実部)の正体である**——`re == q × π^k`(k は 0 か 1)。虚部は問わない
//! (§3.1)。**`re` の計算には使わない**: `re` は今までどおり f64 で計算し、印はその横を
//! 並んで走るだけである。**印を読むのは engine だけ**で、`Value` には欄を足さない
//! (§3.2、§11.2 の未決 6)。
//!
//! **印の計算で i128 が溢れたら、印を捨てるだけでエラーにしない**(§3.4)。`re` は印と
//! 無関係に計算しているので、答えは今の f64 の道に戻る。だからこのファイルの関数は
//! どれも `Option<Exact>` を返し、`CalcResult` を返さない。
//!
//! **伝わり方の規則はキー(演算)ごとに 1 つの関数**として書き、engine の `apply` が
//! 後置関数の腕ごとに `Value` の計算と並べて呼ぶ(§3.4「書き方」)。

use serde::{Deserialize, Serialize};

use super::state::Buffer;
use crate::Value;
use crate::expr::rational::Rational;

/// `re` の厳密な正体。`re == q × π^k`(虚部は問わない)。
///
/// **`(0, k=1)` は持たない**——`0·π = 0·π⁰` なので `(0, k=0)` に正規化する(§3.4)。
/// 作るときは `Exact::of` を通す。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exact {
    /// **WASM 境界では文字列 `"num/den"` で渡す**(§6.1)。i128 を BigInt のまま
    /// JS へ出すと、JSON を経た写しなどで別の型に化けたとき `reduce_key` が
    /// 黙って初期状態に戻る。型の段で起きなくする。
    #[serde(with = "rational_text")]
    pub q: Rational,
    /// k = 1 なら true。
    pub pi: bool,
}

impl Exact {
    /// 0 の印 `(0, k=0)`。初期値・`AC`・`(` の 0、虚数の入力の `re` に付く(§3.3)。
    pub const ZERO: Exact = Exact {
        q: Rational::ZERO,
        pi: false,
    };
    /// `π` キーの印 `(1, k=1)`。
    pub const PI: Exact = Exact {
        q: Rational::ONE,
        pi: true,
    };

    /// 正規化して作る。**q が 0 なら k は 0**(§3.4 の `π × 0`)。
    pub fn of(q: Rational, pi: bool) -> Exact {
        Exact {
            q,
            pi: pi && !q.is_zero(),
        }
    }
}

/// engine が持つ値。`Value` に印を添えたもの(§3.2)。
///
/// **`Copy`**——`Value` が `Copy` なので、engine の書き方を変えずに済む。
/// **等値は印まで比べる**(`engine_robustness.rs` の `before.current == after.current` が
/// DEL や押し直しで印も戻ることを見張る)。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Held {
    pub value: Value,
    pub exact: Option<Exact>,
}

impl Held {
    /// 0 の値と 0 の印(初期値・`AC`・`(`)。
    pub const ZERO: Held = Held {
        value: Value::ZERO,
        exact: Some(Exact::ZERO),
    };
    /// `π` キー(§3.3)。`re` は今までどおり `f64::consts::PI`。
    pub const PI: Held = Held {
        value: Value {
            re: std::f64::consts::PI,
            im: 0.0,
        },
        exact: Some(Exact::PI),
    };

    /// 印の無い値(`e` キーなど)。
    pub fn bare(value: Value) -> Held {
        Held { value, exact: None }
    }
}

/// 打ちかけの数の印(§3.3)。**`Buffer::value` と同じ読み方をする**——仮数が空なら 1、
/// 桁の無い指数は指数なし、60 進は段を畳む。
///
/// - 虚数の入力は `re` が 0 なので `(0, k=0)`。
/// - **i128 に収まらなければ印なし**(`1 EXP 40`、`1 EXP 30 +/−` の小さい側も同じ:
///   分母の 10^40 が収まらない)。
pub fn of_buffer(buffer: &Buffer) -> Option<Exact> {
    if buffer.imaginary {
        return Some(Exact::ZERO);
    }
    if !buffer.sexagesimal.is_empty() {
        // 度 + 分/60 + 秒/3600。段は最大 3 つ(`Buffer::sexagesimal` は 2 つまで)。
        let mut total = Rational::ZERO;
        let mut scale = Rational::ONE;
        let sixty = Rational::from_i128(60).ok()?;
        for stage in buffer
            .sexagesimal
            .iter()
            .chain(std::iter::once(&buffer.digits))
        {
            let n = if stage.is_empty() {
                Rational::ZERO
            } else {
                decimal(stage)?
            };
            total = total.checked_add(n.checked_div(scale).ok()?).ok()?;
            scale = scale.checked_mul(sixty).ok()?;
        }
        return Some(Exact::of(total, false));
    }
    let mantissa = if buffer.digits.is_empty() {
        decimal("1")?
    } else {
        decimal(&buffer.digits)?
    };
    let q = match &buffer.exponent {
        Some(e) if !e.digits.is_empty() => {
            let power: u32 = e.digits.parse().ok()?;
            let scale = Rational::from_i128(10_i128.checked_pow(power)?).ok()?;
            if e.negative {
                mantissa.checked_div(scale).ok()?
            } else {
                mantissa.checked_mul(scale).ok()?
            }
        }
        _ => mantissa,
    };
    Some(Exact::of(q, false))
}

/// `"12.5"`・`"3."`・`"0.25"` のような打った十進を分数にする。読めなければ None。
fn decimal(text: &str) -> Option<Rational> {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    if !whole
        .chars()
        .chain(fraction.chars())
        .all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let digits = format!("{whole}{fraction}");
    let num: i128 = if digits.is_empty() {
        0
    } else {
        digits.parse().ok()?
    };
    let den = 10_i128.checked_pow(u32::try_from(fraction.len()).ok()?)?;
    Rational::from_ratio(num, den).ok()
}

/// 被演算数どうしが合成できる k。**0 は k に中立**(§3.4、条件 1)——q が 0 の側は相手の
/// k に合わせる。両方 0 でなく k が違えば None。
fn common_k(a: Exact, b: Exact) -> Option<bool> {
    if a.q.is_zero() {
        Some(b.pi)
    } else if b.q.is_zero() || a.pi == b.pi {
        Some(a.pi)
    } else {
        None
    }
}

/// `a + b`。**複素数が混ざっても `re` どうしで合成する**(条件 2)。
pub fn add(a: Held, b: Held) -> Option<Exact> {
    let (a, b) = (a.exact?, b.exact?);
    let k = common_k(a, b)?;
    Some(Exact::of(a.q.checked_add(b.q).ok()?, k))
}

/// `a − b`。`add` と同じ規則。
pub fn sub(a: Held, b: Held) -> Option<Exact> {
    let (a, b) = (a.exact?, b.exact?);
    let k = common_k(a, b)?;
    Some(Exact::of(a.q.checked_sub(b.q).ok()?, k))
}

/// 両方とも虚部が 0 か。**積・商・関数は、どちらかの虚部が 0 でなければ印を落とす**
/// (複素の積の `re` は `re·re − im·im` で、`re` の印だけでは決まらない)。
fn both_real(a: Held, b: Held) -> bool {
    a.value.im == 0.0 && b.value.im == 0.0
}

/// `a × b`。k の和が 1 以下なら `(qa·qb, ka+kb)`。2 なら落とす(`π × π`)。
pub fn mul(a: Held, b: Held) -> Option<Exact> {
    if !both_real(a, b) {
        return None;
    }
    let (a, b) = (a.exact?, b.exact?);
    if a.pi && b.pi {
        return None;
    }
    Some(Exact::of(a.q.checked_mul(b.q).ok()?, a.pi || b.pi))
}

/// `a ÷ b`。`qb ≠ 0` で k の差が 0 か 1 なら `(qa/qb, ka−kb)`。`π ÷ π` は `(1, 0)`、
/// `1 ÷ π` は落とす。**`0 ÷ π` も落とす**(差が −1。設計書は ± でしか 0 を中立にして
/// いない——決めていない場合は落とす、という実行役の裁定)。
pub fn div(a: Held, b: Held) -> Option<Exact> {
    if !both_real(a, b) {
        return None;
    }
    let (a, b) = (a.exact?, b.exact?);
    if b.q.is_zero() || (!a.pi && b.pi) {
        return None;
    }
    Some(Exact::of(a.q.checked_div(b.q).ok()?, a.pi && !b.pi))
}

/// `+/−`。`(−q, k)`。**虚部があっても保つ**(`re` の符号反転は `re` だけで決まる)。
pub fn neg(a: Held) -> Option<Exact> {
    let a = a.exact?;
    Some(Exact::of(Rational::ZERO.checked_sub(a.q).ok()?, a.pi))
}

/// `x²`。k=0 なら `(q², 0)`。k=1 なら落とす。
pub fn sqr(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    let a = a.exact?;
    if a.pi {
        return None;
    }
    Some(Exact::of(a.q.checked_mul(a.q).ok()?, false))
}

/// `1/x`。k=0 で q ≠ 0 なら `(1/q, 0)`。k=1 なら落とす。
pub fn recip(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    let a = a.exact?;
    if a.pi || a.q.is_zero() {
        return None;
    }
    Some(Exact::of(Rational::ONE.checked_div(a.q).ok()?, false))
}

/// 印を落とす。`√`・`ln`・`log`・`eˣ`・`xʸ`・`n!`・`nPr`・`nCr`・逆三角関数
/// (§3.4、§11.2 の未決 3・4)。**三角関数もこの段では落とす**——表の答えに印を付けるのは
/// 次の段(§4)である。
pub fn dropped(_: Held) -> Option<Exact> {
    None
}

/// `Rational` を `"num/den"` の文字列で直列化する(§6.1)。
mod rational_text {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};

    use crate::expr::rational::Rational;

    pub fn serialize<S: Serializer>(q: &Rational, serializer: S) -> Result<S::Ok, S::Error> {
        let (num, den) = q.parts();
        serializer.serialize_str(&format!("{num}/{den}"))
    }

    /// **既約・分母正・`i128::MIN` 無しの不変は `Rational::from_ratio` が作り直す**——
    /// 境界の向こうから来た文字列を信じない。
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Rational, D::Error> {
        let text = String::deserialize(deserializer)?;
        let (num, den) = text
            .split_once('/')
            .ok_or_else(|| D::Error::custom("expected \"num/den\""))?;
        let num: i128 = num.parse().map_err(D::Error::custom)?;
        let den: i128 = den.parse().map_err(D::Error::custom)?;
        Rational::from_ratio(num, den).map_err(|e| D::Error::custom(format!("{e:?}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{EngineState, Key, reduce};

    /// 盤面と同じ打鍵列で状態を作る(手で `EngineState` を組み立てない)。
    fn state_after(tokens: &[&str]) -> EngineState {
        let mut state = EngineState::initial();
        for token in tokens {
            let key = Key::from_token(token).expect("unknown key");
            state = reduce(&state, key).0;
        }
        assert!(state.error.is_none(), "{tokens:?} がエラーになった");
        state
    }

    fn mark(tokens: &[&str]) -> Option<Exact> {
        state_after(tokens).current.exact
    }

    fn q(num: i128, den: i128, pi: bool) -> Option<Exact> {
        Some(Exact::of(Rational::from_ratio(num, den).unwrap(), pi))
    }

    // ---- 入口(§3.3) ----

    #[test]
    fn zeros_carry_the_zero_mark() {
        assert_eq!(EngineState::initial().current, Held::ZERO);
        assert_eq!(mark(&["3", "add", "4", "ac"]), q(0, 1, false));
        assert_eq!(mark(&["3", "add", "lparen"]), q(0, 1, false));
    }

    #[test]
    fn a_typed_number_is_its_own_decimal() {
        assert_eq!(mark(&["1", "2", "dot", "5", "eq"]), q(25, 2, false));
        assert_eq!(mark(&["3", "dot", "eq"]), q(3, 1, false));
        assert_eq!(mark(&["dot", "2", "5", "eq"]), q(1, 4, false));
        assert_eq!(mark(&["4", "zeros3", "eq"]), q(4000, 1, false));
        // 12 文字の 3.1415926535 は π ではない(§2)。
        assert_eq!(
            mark(&[
                "3", "dot", "1", "4", "1", "5", "9", "2", "6", "5", "3", "5", "eq"
            ]),
            q(31_415_926_535, 10_000_000_000, false)
        );
    }

    #[test]
    fn the_exponent_scales_the_decimal() {
        assert_eq!(
            mark(&["1", "dot", "5", "exp", "3", "eq"]),
            q(1500, 1, false)
        );
        assert_eq!(
            mark(&["1", "dot", "5", "exp", "3", "neg", "eq"]),
            q(3, 2000, false)
        );
        // 仮数の無い Exp は仮数 1、桁の無い指数は指数なし(`Buffer::value` と同じ読み)。
        assert_eq!(mark(&["exp", "2", "eq"]), q(100, 1, false));
        assert_eq!(mark(&["7", "exp", "eq"]), q(7, 1, false));
    }

    #[test]
    fn a_decimal_beyond_i128_has_no_mark() {
        // 10^38 は i128(約 1.7e38)に収まり、10^40 は収まらない(§3.3)。
        assert_eq!(
            mark(&["1", "exp", "3", "8", "eq"]),
            q(
                100_000_000_000_000_000_000_000_000_000_000_000_000,
                1,
                false
            )
        );
        assert_eq!(mark(&["1", "exp", "4", "0", "eq"]), None);
        assert_eq!(mark(&["1", "exp", "4", "0", "neg", "eq"]), None);
        // 値は今までどおり(印が落ちても答えは f64 の道)。
        assert_eq!(
            state_after(&["1", "exp", "4", "0", "eq"]).current.value,
            Value::real(1e40)
        );
    }

    #[test]
    fn sexagesimal_entry_folds_into_one_fraction() {
        // 1°30' = 3/2、1°0'36" = 1 + 36/3600 = 101/100。
        assert_eq!(mark(&["1", "dms", "3", "0", "dms", "eq"]), q(3, 2, false));
        assert_eq!(
            mark(&["1", "dms", "0", "dms", "3", "6", "eq"]),
            q(101, 100, false)
        );
    }

    #[test]
    fn imaginary_entry_marks_its_zero_real_part() {
        assert_eq!(mark(&["j", "eq"]), q(0, 1, false));
        assert_eq!(mark(&["j", "3", "eq"]), q(0, 1, false));
        assert_eq!(mark(&["3", "j", "eq"]), q(0, 1, false));
    }

    #[test]
    fn pi_is_marked_and_e_is_not() {
        let pi = state_after(&["pi"]).current;
        assert_eq!(pi.exact, Some(Exact::PI));
        // `re` は今までどおり(1 ビットも変えない)。
        assert_eq!(pi.value.re.to_bits(), std::f64::consts::PI.to_bits());
        assert_eq!(mark(&["e"]), None);
    }

    // ---- 伝わり方(§3.4) ----

    #[test]
    fn sums_combine_when_k_agrees() {
        assert_eq!(mark(&["1", "add", "2", "eq"]), q(3, 1, false));
        assert_eq!(mark(&["pi", "add", "pi", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["pi", "sub", "pi", "eq"]), q(0, 1, false));
        assert_eq!(
            mark(&["0", "dot", "1", "add", "0", "dot", "2", "eq"]),
            q(3, 10, false)
        );
        // k が違えば落とす。
        assert_eq!(mark(&["pi", "add", "1", "eq"]), None);
        assert_eq!(mark(&["1", "sub", "pi", "eq"]), None);
    }

    #[test]
    fn zero_is_neutral_to_k() {
        // 4 列とも `π sin` と同じ印になる(条件 1)。
        assert_eq!(mark(&["pi"]), q(1, 1, true));
        assert_eq!(mark(&["add", "pi", "eq"]), q(1, 1, true));
        assert_eq!(mark(&["lparen", "add", "pi", "rparen"]), q(1, 1, true));
        assert_eq!(mark(&["0", "add", "pi", "eq"]), q(1, 1, true));
        assert_eq!(mark(&["pi", "sub", "0", "eq"]), q(1, 1, true));
    }

    #[test]
    fn a_zero_times_pi_is_normalized_to_k_zero() {
        assert_eq!(mark(&["pi", "mul", "0", "eq"]), Some(Exact::ZERO));
        assert_eq!(mark(&["0", "mul", "pi", "eq"]), Some(Exact::ZERO));
        // 正規化しないと `π × 0 + 1` が落ちる(k が違って見える)。
        assert_eq!(mark(&["pi", "mul", "0", "add", "1", "eq"]), q(1, 1, false));
    }

    #[test]
    fn products_keep_at_most_one_pi() {
        assert_eq!(mark(&["pi", "mul", "2", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["2", "mul", "pi", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["3", "mul", "4", "eq"]), q(12, 1, false));
        assert_eq!(mark(&["pi", "mul", "pi", "eq"]), None);
    }

    #[test]
    fn quotients_keep_k_zero_or_one() {
        assert_eq!(mark(&["pi", "div", "2", "eq"]), q(1, 2, true));
        assert_eq!(mark(&["pi", "div", "pi", "eq"]), q(1, 1, false));
        assert_eq!(mark(&["1", "div", "3", "eq"]), q(1, 3, false));
        assert_eq!(mark(&["1", "div", "pi", "eq"]), None);
        // 設計書が決めていない場合 → 落とす(実行役の裁定)。
        assert_eq!(mark(&["0", "div", "pi", "eq"]), None);
    }

    #[test]
    fn negation_flips_q_and_keeps_k() {
        assert_eq!(mark(&["pi", "neg"]), q(-1, 1, true));
        assert_eq!(mark(&["3", "neg"]), q(-3, 1, false));
        // 虚部があっても `re` の符号反転は `re` だけで決まる。
        assert_eq!(mark(&["2", "add", "3", "j", "eq", "neg"]), q(-2, 1, false));
    }

    #[test]
    fn square_and_reciprocal_keep_only_k_zero() {
        assert_eq!(mark(&["1", "dot", "5", "sqr"]), q(9, 4, false));
        assert_eq!(mark(&["4", "recip"]), q(1, 4, false));
        assert_eq!(mark(&["pi", "sqr"]), None);
        assert_eq!(mark(&["pi", "recip"]), None);
    }

    #[test]
    fn the_other_functions_drop_the_mark() {
        for tokens in [
            &["9", "sqrt"][..],
            &["2", "ln"],
            &["2", "log10"],
            &["2", "exp_e"],
            &["3", "n_fact"],
            &["2", "pow", "3", "eq"],
            &["5", "n_p_r", "2", "eq"],
            &["5", "n_c_r", "2", "eq"],
            &["0", "dot", "5", "asin"],
            &["0", "dot", "5", "acos"],
            &["1", "atan"],
            // 三角関数の表はこの段では無い(次の段が足す)。
            &["3", "0", "sin"],
            &["6", "0", "cos"],
            &["4", "5", "tan"],
        ] {
            assert_eq!(mark(tokens), None, "{tokens:?}");
        }
    }

    #[test]
    fn complex_sums_combine_their_real_parts() {
        // `re` の和は `re` どうしの和(条件 2)。
        assert_eq!(mark(&["2", "j", "add", "pi", "eq"]), q(1, 1, true));
        assert_eq!(mark(&["3", "add", "4", "j", "eq"]), q(3, 1, false));
    }

    #[test]
    fn complex_products_quotients_and_functions_drop_the_mark() {
        assert_eq!(mark(&["2", "j", "mul", "3", "eq"]), None);
        assert_eq!(mark(&["3", "mul", "2", "j", "eq"]), None);
        assert_eq!(mark(&["3", "div", "2", "j", "eq"]), None);
        // 関数は実数に閉じている(S-1)ので、複素数で答えを返すのは `x²` だけ。
        assert_eq!(mark(&["1", "add", "j", "eq", "sqr"]), None);
    }

    #[test]
    fn an_overflowing_mark_is_dropped_not_an_error() {
        // 10^30 × 10^30 は i128 を超える。値は 1e60 で、エラーにはならない。
        let state = state_after(&["1", "exp", "3", "0", "mul", "1", "exp", "3", "0", "eq"]);
        assert_eq!(state.current.exact, None);
        assert_eq!(state.current.value, Value::real(1e30 * 1e30));
        // 落ちた後は印の無い値として伝わる。
        assert_eq!(
            mark(&[
                "1", "exp", "3", "0", "mul", "1", "exp", "3", "0", "add", "1", "eq"
            ]),
            None
        );
        // 和でも同じ(分母どうしの積が溢れる)。
        assert_eq!(
            mark(&[
                "1", "exp", "3", "0", "neg", "add", "1", "exp", "3", "0", "eq"
            ]),
            None
        );
    }

    // ---- DEL・押し直し・閉じた組の開き直しで印が戻る ----

    #[test]
    fn reopening_a_closed_group_restores_the_mark() {
        let state = state_after(&["lparen", "pi", "rparen", "del"]);
        assert_eq!(state.current, Held::PI);
        assert_eq!(
            mark(&["lparen", "pi", "rparen", "del", "mul", "2", "rparen"]),
            q(2, 1, true)
        );
        // 中で畳んだ値の印も、`)` の前の姿に戻る。
        let state = state_after(&["lparen", "pi", "mul", "3", "rparen", "del"]);
        assert_eq!(state.operands[0].exact, Some(Exact::PI));
        assert_eq!(
            mark(&[
                "lparen", "pi", "mul", "3", "rparen", "del", "div", "2", "rparen"
            ]),
            q(3, 2, true)
        );
    }

    #[test]
    fn deleting_a_fresh_paren_restores_the_operand_with_its_mark() {
        let state = state_after(&["pi", "mul", "lparen", "del"]);
        assert_eq!(state.current, Held::PI);
        assert_eq!(mark(&["pi", "mul", "lparen", "del", "eq"]), None);
        assert_eq!(mark(&["pi", "div", "lparen", "del", "eq"]), q(1, 1, false));
    }

    #[test]
    fn re_pressing_an_operator_restores_the_marks() {
        // `π × 2 + ×` は `π × 2 ×` と同じ(0.9.2 §2)。畳んだ `2π` から π と 2 に戻る。
        let corrected = state_after(&["pi", "mul", "2", "add", "mul"]);
        let direct = state_after(&["pi", "mul", "2", "mul"]);
        assert_eq!(corrected.current, direct.current);
        assert_eq!(corrected.operands, direct.operands);
        assert_eq!(corrected.replace_base, direct.replace_base);
        assert_eq!(
            mark(&["pi", "mul", "2", "add", "div", "4", "eq"]),
            q(1, 2, true)
        );
    }

    #[test]
    fn del_of_a_typed_digit_restores_the_typed_mark() {
        assert_eq!(mark(&["1", "2", "del", "eq"]), q(1, 1, false));
        assert_eq!(mark(&["pi", "mul", "2", "5", "del", "eq"]), q(2, 1, true));
    }

    // ---- 直列化(§6.1) ----

    #[test]
    fn the_mark_crosses_serde_as_text() {
        let state = state_after(&["pi", "mul", "2", "div", "3"]);
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains(r#""q":"2/1""#), "{json}");
        let back: EngineState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, state);
    }

    #[test]
    fn a_mark_from_outside_is_reduced_or_refused() {
        let held: Held =
            serde_json::from_str(r#"{"value":{"re":0.5,"im":0.0},"exact":{"q":"2/4","pi":false}}"#)
                .unwrap();
        assert_eq!(held.exact, q(1, 2, false));
        for bad in ["1/0", "1", "a/2", "1/2/3"] {
            let text =
                format!(r#"{{"value":{{"re":0.5,"im":0.0}},"exact":{{"q":"{bad}","pi":false}}}}"#);
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{bad}");
        }
    }
}
