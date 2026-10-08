//! 値に添える「厳密な正体」の印(1.2.2 設計書 §3)。
//!
//! **印は `re`(実部)の正体である**——`re == q × π^k`(k は 0 か 1)。虚部は問わない
//! (§3.1)。**`re` の計算には使わない**: `re` は今までどおり f64 で計算し、印はその横を
//! 並んで走るだけである。**印を読むのは engine だけ**で、`Value` には欄を足さない
//! (§3.2、§11.2 の未決 6)。
//!
//! **印の計算で i128 が溢れたら、印を捨てるだけでエラーにしない**(§3.4)。`re` は印と
//! 無関係に計算しているので、答えは今の f64 の道に戻る。だからこのファイルの関数は
//! どれも印(`Marks`。中身は `Option`)を返し、`CalcResult` を返さない。
//!
//! **伝わり方の規則はキー(演算)ごとに 1 つの関数**として書き、engine の `apply` が
//! 後置関数の腕ごとに `Value` の計算と並べて呼ぶ(§3.4「書き方」)。

use serde::{Deserialize, Serialize};

use super::state::Buffer;
use crate::expr::rational::{Rational, ratio_to_f64};
use crate::scientific::{self, Entry, Row, Turn, table_row};
use crate::{AngleMode, Value};

/// `re` の厳密な正体。`re == q × π^k`(虚部は問わない)。
///
/// **`(0, k=1)` は持たない**——`0·π = 0·π⁰` なので `(0, k=0)` に正規化する(§3.4)。
/// **欄は private で、作る道は `Exact::of` と直列化の読みの 2 つだけ**であり、
/// **どちらも正規化を通る**(読みは `ExactWire` から `Exact::of` へ)。
/// **境界の向こうから `(0, k=1)` が来ても、`(0, k=0)` になってから engine に入る**
/// ——`common_k` は「q が 0 の側は相手の k に合わせる」ので、正規化されていない印でも
/// 和は壊れないが、**等値(`Held` の `PartialEq`)と表の引き方が k を見る**。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ExactWire")]
pub struct Exact {
    /// **WASM 境界では文字列 `"num/den"` で渡す**(§6.1)。i128 を BigInt のまま
    /// JS へ出すと、JSON を経た写しなどで別の型に化けたとき `reduce_key` が
    /// 黙って初期状態に戻る。型の段で起きなくする。
    #[serde(serialize_with = "rational_text::serialize")]
    q: Rational,
    /// k = 1 なら true。
    pi: bool,
}

/// 直列化の読み口。**読んだ値は `Exact::of` を通してから `Exact` になる**。
#[derive(Deserialize)]
struct ExactWire {
    #[serde(with = "rational_text")]
    q: Rational,
    pi: bool,
}

impl From<ExactWire> for Exact {
    fn from(wire: ExactWire) -> Exact {
        Exact::of(wire.q, wire.pi)
    }
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

    /// 有理数の部分 `q`。
    pub fn q(self) -> Rational {
        self.q
    }

    /// k = 1 か。
    pub fn pi(self) -> bool {
        self.pi
    }
}

/// √ の印(1.2.3 設計書 §3.1)。`re == c × √r`、`r > 0`。
///
/// **`Exact` に種類を足さず、`Held` に別の欄として持つ**——√ の印が意味を持つのは
/// 「√ の直後」と「桁落ちする ± の 1 段」だけなので、読む所を閉じ込める(§3.1)。
/// **欄は private**。作る道は `√` の印の関数 `exact::sqrt`(`r` は正の印 `q` そのもの)と、
/// 直列化の読みの 2 つだけである。**読みは `r > 0` でなければ拒む**(`RootWire`)。
/// `+/−` は `c` の符号だけを変えて運ぶ(`exact::neg`。`r` は触らない)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RootWire")]
pub struct Root {
    /// `Exact` の `q` と同じく、**WASM 境界では文字列 `"num/den"` で渡す**(§3.4)。
    #[serde(serialize_with = "rational_text::serialize")]
    c: Rational,
    #[serde(serialize_with = "rational_text::serialize")]
    r: Rational,
}

/// 直列化の読み口。**`r > 0` の不変を境界の向こうから来た値にも課す**——
/// `Exact` の読みが `Exact::of` を通るのと同じ扱い。
#[derive(Deserialize)]
struct RootWire {
    #[serde(with = "rational_text")]
    c: Rational,
    #[serde(with = "rational_text")]
    r: Rational,
}

impl TryFrom<RootWire> for Root {
    type Error = &'static str;

    fn try_from(wire: RootWire) -> Result<Root, Self::Error> {
        if !wire.r.is_negative() && !wire.r.is_zero() {
            Ok(Root {
                c: wire.c,
                r: wire.r,
            })
        } else {
            Err("expected r > 0")
        }
    }
}

/// 印の計算の戻り値(1.2.3 設計書 §3.1、条件 1)。`Held` の印の欄 2 つを 1 つにまとめる。
///
/// **印の関数(`add`・`neg`・`sin` など)はどれもこれを返し、`Held::settled` が受け取る。**
/// 運び方をこの 1 つにそろえるので、root を作る・運ぶ腕が増えても遷移は増えない。
/// **欄は private**——外からは `Marks::NONE` しか作れない。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Marks {
    exact: Option<Exact>,
    root: Option<Root>,
}

impl Marks {
    /// 印なし。落とす腕(`dropped`、`xʸ`・`nPr`・`nCr`)が返す。
    pub const NONE: Marks = Marks {
        exact: None,
        root: None,
    };

    /// `Exact` の印だけを持つ。**root は持たない**——root を作る・運ぶ腕は §3.2 の 2 つ
    /// (`√`・`+/−`)だけで、ほかの腕は全部ここを通る(`x²` は root を読んで `Exact` を返す)。
    fn exact(exact: Option<Exact>) -> Marks {
        Marks { exact, root: None }
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
    /// √ の印(1.2.3 設計書 §3.1)。**`Some` のとき `exact` は `None`**。
    /// **欠けた状態(9 の形)も読める**(`#[serde(default)]`、§3.4)。
    #[serde(default)]
    pub root: Option<Root>,
}

impl Held {
    /// 0 の値と 0 の印(初期値・`AC`・`(`)。
    pub const ZERO: Held = Held {
        value: Value::ZERO,
        exact: Some(Exact::ZERO),
        root: None,
    };
    /// `π` キー(§3.3)。`re` は今までどおり `f64::consts::PI`。
    pub const PI: Held = Held {
        value: Value {
            re: std::f64::consts::PI,
            im: 0.0,
        },
        exact: Some(Exact::PI),
        root: None,
    };

    /// 印の無い値(`e` キーなど)。
    pub fn bare(value: Value) -> Held {
        Held {
            value,
            exact: None,
            root: None,
        }
    }

    /// 計算した値に印を添える。**k=0 の印があれば、`re` を印を正しく丸めた f64 に
    /// 置き換える**(段階 2、設計書 §5.1)。虚部はそのまま。
    ///
    /// - **k=1 の値は `re` を変えない**——π を含む値は正しく丸められない(§5.1)。
    /// - **印が無ければ(落ちた・初めから無い)`value` のまま**——今の f64 の道。
    ///
    /// **これで「`re` は印を正しく丸めた値」という不変が 1 つになる**(§11.2 の未決 2)。
    /// 四則の各段で `re` を印から作り直すので、印が落ちない限り、最後の段の `re` は
    /// 式全体を 1 回で丸めた値そのものになる(§5.2)。
    ///
    /// **60 進の入力も同じ規則に入れる**(実行役の裁定)。`Buffer::value` は度・分・秒を
    /// f64 で足すので、`0°7'11"` は `0.11972222222222223` になり、印 `431/3600` を正しく
    /// 丸めた `0.11972222222222222` と 1 ulp ずれる。**例外を残すと「`re` は印の丸め」が
    /// 60 進だけ偽になり**、DEG の三角関数は印を、四則は f64 の和を読む二重の正体ができる。
    /// 同じ規則にしても 10 桁の表示は動かない(1 ulp の差)。
    ///
    /// **root には丸め直しが及ばない**(1.2.3 設計書 §3.1)——√ の答えを正しく丸める手段が
    /// 無いので、root を持つ値の `re` は √ の f64 のままである。
    pub fn settled(value: Value, marks: Marks) -> Held {
        let Marks { exact, root } = marks;
        let value = match exact {
            Some(mark) if !mark.pi => Value {
                re: mark.q.to_f64(),
                im: value.im,
            },
            _ => value,
        };
        Held { value, exact, root }
    }
}

/// 打ちかけの数の印(§3.3)。**`Buffer::value` と同じ読み方をする**——仮数が空なら 1、
/// 桁の無い指数は指数なし、60 進は段を畳む。
///
/// - 虚数の入力は `re` が 0 なので `(0, k=0)`。
/// - **i128 に収まらなければ印なし**(`1 EXP 40`、`1 EXP 30 +/−` の小さい側も同じ:
///   分母の 10^40 が収まらない)。
pub fn of_buffer(buffer: &Buffer) -> Marks {
    Marks::exact(buffer_mark(buffer))
}

fn buffer_mark(buffer: &Buffer) -> Option<Exact> {
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
pub fn add(a: Held, b: Held) -> Marks {
    Marks::exact(add_mark(a, b))
}

fn add_mark(a: Held, b: Held) -> Option<Exact> {
    let (a, b) = (a.exact?, b.exact?);
    let k = common_k(a, b)?;
    Some(Exact::of(a.q.checked_add(b.q).ok()?, k))
}

/// `a − b`。`add` と同じ規則。
pub fn sub(a: Held, b: Held) -> Marks {
    Marks::exact(sub_mark(a, b))
}

fn sub_mark(a: Held, b: Held) -> Option<Exact> {
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
pub fn mul(a: Held, b: Held) -> Marks {
    Marks::exact(mul_mark(a, b))
}

fn mul_mark(a: Held, b: Held) -> Option<Exact> {
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
/// `1 ÷ π` は落とす。
///
/// **`0 ÷ π` は `(0, k=0)`**——**0 は k に中立**(§3.4、条件 1)なので、k の差が −1 でも
/// 答えは 0 である。以前は「決めていない場合は落とす」として落としていたが、それは
/// 条件 1 と矛盾した(RAD `0 × π = + π = sin` は 0、`0 ÷ π = + π = sin` は
/// `1.224646799e-16`。中間審査の条件 1 で直した)。
pub fn div(a: Held, b: Held) -> Marks {
    Marks::exact(div_mark(a, b))
}

fn div_mark(a: Held, b: Held) -> Option<Exact> {
    if !both_real(a, b) {
        return None;
    }
    let (a, b) = (a.exact?, b.exact?);
    if a.q.is_zero() && !b.q.is_zero() {
        return Some(Exact::ZERO);
    }
    if b.q.is_zero() || (!a.pi && b.pi) {
        return None;
    }
    Some(Exact::of(a.q.checked_div(b.q).ok()?, a.pi && !b.pi))
}

/// `+/−`。`(−q, k)`。**虚部があっても保つ**(`re` の符号反転は `re` だけで決まる)。
/// **root も `(−c, r)` にして運ぶ**(1.2.3 設計書 §3.2)——`−√a + √b` を書き換えるため。
/// root を持つ値は `exact` が `None` なので、2 つの欄が両方 `Some` になることはない。
pub fn neg(a: Held) -> Marks {
    Marks {
        exact: neg_mark(a),
        root: a.root.and_then(|root| {
            Some(Root {
                c: Rational::ZERO.checked_sub(root.c).ok()?,
                r: root.r,
            })
        }),
    }
}

fn neg_mark(a: Held) -> Option<Exact> {
    let a = a.exact?;
    Some(Exact::of(Rational::ZERO.checked_sub(a.q).ok()?, a.pi))
}

/// `x²`。k=0 なら `(q², 0)`。k=1 なら落とす。**root `(c, r)` なら `(c²·r, 0)`**——√ を
/// 2 乗すると有理数に戻る(1.2.3 設計書 §3.2。`2 √ x² − 2 =` が 0 になる)。
pub fn sqr(a: Held) -> Marks {
    Marks::exact(sqr_mark(a))
}

fn sqr_mark(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    let (_, square) = signed_square(a)?;
    Some(Exact::of(square, false))
}

/// 実数の項を「符号と 2 乗」で読む(1.2.3 設計書 §3.3)。root `(c, r)` なら `(c < 0, c²·r)`、
/// k=0 の印 `q` なら `(q < 0, q²)`。k=1・印なし・溢れは `None`。**虚部は見ない**
/// (呼び手が見る)。
fn signed_square(a: Held) -> Option<(bool, Rational)> {
    match (a.root, a.exact) {
        (Some(root), _) => Some((
            root.c.is_negative(),
            root.c.checked_mul(root.c).ok()?.checked_mul(root.r).ok()?,
        )),
        (None, Some(mark)) if !mark.pi => {
            Some((mark.q.is_negative(), mark.q.checked_mul(mark.q).ok()?))
        }
        _ => None,
    }
}

/// **桁落ちする `a ± b` の書き換え**(1.2.3 設計書 §3.3)。書き換えないなら `None`
/// (呼び手は今の f64 の和と `add`・`sub` の印に戻る)。`subtract` は `−` のとき true。
///
/// 各項を「符号と 2 乗」で読み、`−` なら右の符号を反転する。**どちらかが root で、
/// 符号が逆で、大きさが 2 倍以内(`A²/4 ≤ B² ≤ 4A²`、2 乗の有理数で比べる)のときだけ**、
/// 答えを `(A² − B²) ÷ (|A| + |B|)` に左の項の符号を掛けた値にする。分子は有理数で厳密、
/// 分母は正の数の和で桁落ちしない。**分子が 0 なら答えは `(0, k=0)`**。
///
/// - **2 倍の門**: 桁落ちしない引き算(`667 ÷ 833 = − 334 √ =`)を書き換えると丸めが
///   1 回増えるだけなので、門の外は今の f64 のまま(§3.3 の試作の実測)。
/// - **両方が k=0 の印なら書き換えない**——そちらは `sub` の印が厳密に引く。
/// - **i128 が溢れたら書き換えない**(§3.5)。
pub fn cancel(a: Held, b: Held, subtract: bool) -> Option<(Value, Marks)> {
    if !both_real(a, b) || (a.root.is_none() && b.root.is_none()) {
        return None;
    }
    let ((a_negative, a_square), (b_negative, b_square)) = (signed_square(a)?, signed_square(b)?);
    let four = Rational::from_i128(4).ok()?;
    let below = b_square
        .checked_mul(four)
        .ok()?
        .checked_sub(a_square)
        .ok()?;
    let above = a_square
        .checked_mul(four)
        .ok()?
        .checked_sub(b_square)
        .ok()?;
    if a_negative == (b_negative != subtract) || below.is_negative() || above.is_negative() {
        return None;
    }
    let numerator = a_square.checked_sub(b_square).ok()?;
    // `a + b' = s·(|A| − |B|) = s·(A² − B²) ÷ (|A| + |B|)`(`s` は左の項の符号)。**分子の
    // 符号も残す**——右の項のほうが大きければ答えの符号は `s` の逆である(`copysign` で
    // `s` を付けると `√2 − √3` が正に化ける。engine_table の
    // `a_rewritten_difference_keeps_the_sign_of_the_larger_side`)。`a.value.re` の符号は
    // `a_negative` と同じで、0 の項は門を通らないので `signum` は ±1。
    // 分子が 0 なら印 `(0, k=0)` が `Held::settled` で `re` を `+0.0` にする。
    let quotient = numerator.to_f64() / (a.value.re.abs() + b.value.re.abs());
    Some((
        Value::real(quotient * a.value.re.signum()),
        Marks::exact(numerator.is_zero().then_some(Exact::ZERO)),
    ))
}

/// `√`。**k=0 の印 `q > 0` なら root `(1, q)`**(1.2.3 設計書 §3.2)。**`Root` を作る
/// 唯一の関数**である。`q = 0` なら `(0, k=0)`(√0 は 0)。k=1・負・印なしは落とす
/// (負の引数は値の計算が `DomainError` にする。複素の引数も同じ)。
pub fn sqrt(a: Held) -> Marks {
    match a.exact {
        Some(mark) if mark.pi || mark.q.is_negative() => Marks::NONE,
        Some(mark) if mark.q.is_zero() => Marks::exact(Some(Exact::ZERO)),
        Some(mark) => Marks {
            exact: None,
            root: Some(Root {
                c: Rational::ONE,
                r: mark.q,
            }),
        },
        None => Marks::NONE,
    }
}

/// `1/x`。k=0 で q ≠ 0 なら `(1/q, 0)`。k=1 なら落とす。
pub fn recip(a: Held) -> Marks {
    Marks::exact(recip_mark(a))
}

fn recip_mark(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    let a = a.exact?;
    if a.pi || a.q.is_zero() {
        return None;
    }
    Some(Exact::of(Rational::ONE.checked_div(a.q).ok()?, false))
}

/// 印を落とす。`ln`・`log`・`eˣ`・`xʸ`・`n!`・`nPr`・`nCr`・逆三角関数
/// (§3.4、§11.2 の未決 3・4)。
pub fn dropped(_: Held) -> Marks {
    Marks::NONE
}

// ---- 三角関数(§4) ----

/// **角の実部の正体**を印から決める(§4.1)。**印で決まらなければ、印の無い値と
/// 同じ規則**(`scientific::turn_of`。DEG で f64 が 30° か 45° の倍数なら表)。
///
/// - **RAD で印が k=1**: `r = q mod 2`。表に載れば `Table`、載らなければ `(−1, 1]` に
///   畳んで `Folded(f64(r) × π)`。
/// - **RAD で印が k=0**: **q = 0 のときだけ**表(0)。**打った `3.1415926535` も
///   `32993.006048` も表に載らない**——π ではないので、f64 の答えが正しい答えである。
/// - **DEG で印が k=0**: `r = q mod 360` が 30 か 45 の倍数なら表。
/// - **DEG で印が k=1**(`π` を度で読む)は表に載らない(π° は無理数の角)。f64 の規則へ。
///
/// **どちらでも決まらなければ、DEG で印が k=0・分母 ≠ 1 のときだけ印のまま畳む**
/// (1.2.3 設計書 §2.1、`degree_fold`)。**順は「印が表 → f64 が表 → 畳む」で、
/// 畳みを先に当ててはならない**(台帳の条件 1)——`30 + 1e-15` の印は表に載らないが、
/// f64 の和は 30 ちょうどなので f64 の規則が表を引き、`sin − 0.5` は `0` になる。
/// 畳みを先にすると `-5.551115123e-17` に後退する(engine_table の
/// `an_angle_whose_f64_is_on_the_table_is_not_folded` が見張る)。
///
/// **RAD は 1.0.0 で「触らない」とした**(入力そのものが厳密でないので、厳密な答えを
/// 返すと嘘になる)。**1.2.2 で RAD に広げるのは、入力が π の有理数倍だと「分かっている」
/// ときだけ**——π キーから四則だけで作った値(印が k=1)。**1.0.0 の線引き「入力が厳密なら、
/// 答えも厳密に」は変えていない。** 変えたのは「厳密な入力」の数え方で、π キーの印が
/// そこに入った(設計書 §7.2)。
pub fn turn(arg: Held, mode: AngleMode) -> Option<Turn> {
    let from_mark = match (arg.exact, mode) {
        (Some(mark), AngleMode::Rad) if mark.pi => pi_turn(mark.q),
        (Some(mark), AngleMode::Rad) if mark.q.is_zero() => Turn::table(0),
        (Some(_), AngleMode::Rad) => return None,
        (Some(mark), AngleMode::Deg) if !mark.pi => degree_turn(mark.q),
        _ => None,
    };
    from_mark
        .or_else(|| scientific::turn_of(arg.value, mode))
        .or_else(|| match (arg.exact, mode) {
            (Some(mark), AngleMode::Deg) if !mark.pi => degree_fold(mark.q),
            _ => None,
        })
}

/// `q × π` の角(RAD)。`r = q mod 2`。
///
/// **q = n/d は既約なので、`r` が π/12 の倍数 ⟺ `d` が 12 を割る**
/// (`gcd(n mod 2d, d) = gcd(n, d) = 1`)。だから `12r` を作らずに判定でき、溢れない。
/// **`2d` が i128 に収まらなければ `None`**(印を捨てて f64 の道へ。§3.4)。
fn pi_turn(q: Rational) -> Option<Turn> {
    let (n, d) = q.parts();
    let r = n.rem_euclid(d.checked_mul(2)?);
    if 12 % d == 0
        && let Some(table) = Turn::table(r * (12 / d))
    {
        return Some(table);
    }
    // 表に載らない(π/12 の奇数倍を含む)。`(−1, 1]` に畳んでから `f64(r) × π`。
    // **`f64(r)` は正しく丸める**(`ratio_to_f64`、段階 2)。`folded as f64 / d as f64` は
    // `d > 2^53` で変換と除算の 2 度丸めになり、1 ulp 外れうる。
    let folded = if r > d { r - 2 * d } else { r };
    let x = ratio_to_f64(folded, d)?;
    Some(Turn::Folded(x * std::f64::consts::PI))
}

/// `q` 度の角(DEG)。`r = q mod 360`。**30 か 45 の倍数は整数だけ**なので、
/// 分母が 1 でなければ表に載らない。
fn degree_turn(q: Rational) -> Option<Turn> {
    let (n, d) = q.parts();
    if d != 1 {
        return None;
    }
    let r = n.rem_euclid(360);
    if r % 15 == 0 {
        Turn::table(r / 15)
    } else {
        None
    }
}

/// **表に載らない分数の度**(1.2.3 設計書 §2.2)。`r = n mod 360d` を正しく丸めた f64 に
/// してから、ラジアンにする。`(−180, 180]` には寄せない。
///
/// **剰余は切り捨て(符号は `n` と同じ)でなければならない。** 理由は、**小さい負の角は
/// 0 の近くに留まり、360 の隣へ動いてはならない**からである。ユークリッドの剰余は
/// `−ε` を `360 − ε` に写し、それを f64 にした丸めは 360 の ulp(5.7e-14)で効く。
/// `sin` の答えは ε 級なので、相対で崩れる(実測: `0.0000001 +/− sin` は切り捨てで
/// `-0.000000001745329252`、ユークリッドで `-0.000000001745329459`。engine_table の
/// `a_small_negative_fractional_degree_stays_near_zero` が見張る)。
/// `to_rad` の `re % 360.0`(IEEE の `fmod`)と向きがそろうのは、その結果である。
///
/// - **分母が 1(整数の角)は畳まない**——整数は f64 で厳密なので、`to_rad` の
///   `re % 360.0` が既に厳密である。畳み直すと丸めの向きが変わるだけで、
///   遠ざかる値が出る(試作の実測。§2.1)。
/// - **`360d` が i128 に収まらなければ `None`**(印を捨てて f64 の道へ。§3.4)。
///
/// **有理数の角はちょうど 90° にはならない**(分母 ≠ 1。§2.3)。ただし `r/d` を f64 に
/// 丸めた値が 90.0 ちょうどに着地することはありうる——**`|q| > 2^53` のときだけ**
/// (整数部が 2^53 を超えると、90 からの小数のずれが丸めで消える)。そのとき tan は
/// 極の表を引かず、f64 の `tan` の大きな有限値を返す(例 `1 EXP 17 + 170 +
/// 1 EXP 16 +/− = tan` → `1.633123935e16`)。
fn degree_fold(q: Rational) -> Option<Turn> {
    let (n, d) = q.parts();
    if d == 1 {
        return None;
    }
    let r = n.checked_rem(d.checked_mul(360)?)?;
    Some(Turn::Folded(ratio_to_f64(r, d)?.to_radians()))
}

/// 表の答えの印(§3.3・§4.2)。**0・±1/2・±1 なら k=0、√ を含めば印なし。**
///
/// **k=0 の印を付けるのは引数の虚部が 0 のときだけ**(レビュー役の注記 1)。
/// 複素の引数では表の値に `cosh y` が掛かるので、答えの実部は表の値にならない。
/// **ただし表の値が 0 なら、複素でも答えの実部は `0 × cosh y = 0`** なので
/// `(0, k=0)` を付ける(`sin` の注記どおり。`cos` の 0 も同じ理由で同じ扱い)。
fn table_answer(arg: Held, entry: Entry) -> Option<Exact> {
    match entry {
        Entry::Exact(n, d) if arg.value.im == 0.0 || n == 0 => Some(Exact::of(
            Rational::from_ratio(i128::from(n), i128::from(d)).ok()?,
            false,
        )),
        _ => None,
    }
}

/// 表の行。`turn` が表の位置でなければ `None`。
fn row_of(turn: Option<Turn>) -> Option<Row> {
    match turn {
        Some(Turn::Table(t)) => table_row(t),
        _ => None,
    }
}

/// `sin` の答えの印。答えの実部は `sin x · cosh y`。
pub fn sin(arg: Held, turn: Option<Turn>) -> Marks {
    Marks::exact(sin_mark(arg, turn))
}

fn sin_mark(arg: Held, turn: Option<Turn>) -> Option<Exact> {
    table_answer(arg, row_of(turn)?.sin)
}

/// `cos` の答えの印。答えの実部は `cos x · cosh y`。
pub fn cos(arg: Held, turn: Option<Turn>) -> Marks {
    Marks::exact(cos_mark(arg, turn))
}

fn cos_mark(arg: Held, turn: Option<Turn>) -> Option<Exact> {
    table_answer(arg, row_of(turn)?.cos)
}

/// `tan` の答えの印。**表から返すのは実数の引数だけ**(複素は sin/cos の商で、
/// 実部は表の値にならない)ので、**虚部が 0 でなければ印なし**。
pub fn tan(arg: Held, turn: Option<Turn>) -> Marks {
    Marks::exact(tan_mark(arg, turn))
}

fn tan_mark(arg: Held, turn: Option<Turn>) -> Option<Exact> {
    if arg.value.im != 0.0 {
        return None;
    }
    table_answer(arg, row_of(turn)?.tan?)
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
    fn sexagesimal_entry_takes_the_rounded_mark_not_the_f64_sum() {
        // **60 進も「`re` は印の丸め」に入れる**(`Held::settled` の裁定)。`0°7'11"` の
        // 印は 431/3600。f64 で度・分・秒を足すと `0.11972222222222223`(1 ulp 上)。
        let held = state_after(&["0", "dms", "7", "dms", "1", "1", "eq"]).current;
        assert_eq!(held.exact, q(431, 3600, false));
        assert_eq!(held.value.re, 0.11972222222222222);
        let f64_sum = 0.0 + 7.0 / 60.0 + 11.0 / 3600.0;
        assert_eq!(f64_sum, 0.11972222222222223, "比べる相手が 1 ulp 違うこと");
        assert_ne!(held.value.re, f64_sum);
    }

    #[test]
    fn the_re_is_the_rounded_mark_for_k_zero_only() {
        // 段階 2(§5.1)。`4548399.395 − 4548399.394` の印は 1/1000、`re` は f64 の 0.001。
        let held = state_after(&[
            "4", "5", "4", "8", "3", "9", "9", "dot", "3", "9", "5", "sub", "4", "5", "4", "8",
            "3", "9", "9", "dot", "3", "9", "4", "eq",
        ])
        .current;
        assert_eq!(held.exact, q(1, 1000, false));
        assert_eq!(held.value.re, 0.001);
        // **k=1 は `re` を変えない**——`π × 2` は f64 の `2π` のまま。
        let held = state_after(&["pi", "mul", "2", "eq"]).current;
        assert_eq!(held.value.re, std::f64::consts::PI * 2.0);
        // 印が落ちた値も f64 のまま(`1 EXP 30 × 1 EXP 30`)。
        let held = state_after(&["1", "exp", "3", "0", "mul", "1", "exp", "3", "0", "eq"]).current;
        assert_eq!(held.value.re, 1e30 * 1e30);
        // 虚部は残る。
        let held = state_after(&[
            "0", "dot", "1", "add", "0", "dot", "2", "add", "3", "j", "eq",
        ])
        .current;
        assert_eq!(held.value, Value::new(0.3, 3.0));
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
        // **0 は k に中立**(中間審査の条件 1)。`0 ÷ π` は `(0, k=0)`。
        assert_eq!(mark(&["0", "div", "pi", "eq"]), Some(Exact::ZERO));
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
        ] {
            assert_eq!(mark(tokens), None, "{tokens:?}");
        }
    }

    #[test]
    fn the_implied_operand_carries_its_mark() {
        // `2 × =` は `2 × 2`(暗黙の被演算数)。印も `2 × 2` の印になる。
        assert_eq!(mark(&["2", "mul", "eq"]), q(4, 1, false));
        // `π × =` は `π × π`——k=2 で落ちる。
        assert_eq!(mark(&["pi", "mul", "eq"]), None);
    }

    // ---- 三角関数の答えの印(§3.3・§4.2) ----

    /// RAD で打鍵する。
    fn rad(tokens: &[&str]) -> Option<Exact> {
        let mut pressed = vec!["angle_toggle"];
        pressed.extend_from_slice(tokens);
        mark(&pressed)
    }

    #[test]
    fn table_answers_of_zero_half_and_one_are_marked() {
        assert_eq!(mark(&["3", "0", "sin"]), q(1, 2, false));
        assert_eq!(mark(&["6", "0", "cos"]), q(1, 2, false));
        assert_eq!(mark(&["4", "5", "tan"]), q(1, 1, false));
        assert_eq!(mark(&["1", "8", "0", "cos"]), q(-1, 1, false));
        assert_eq!(rad(&["pi", "sin"]), q(0, 1, false));
        assert_eq!(rad(&["pi", "div", "6", "eq", "sin"]), q(1, 2, false));
        assert_eq!(
            rad(&["pi", "mul", "3", "div", "4", "eq", "tan"]),
            q(-1, 1, false)
        );
        // **印の無い DEG の f64 でも、30° の倍数なら表**(§4.1)。答えは表の 1/2 なので
        // 印が付く(引数の印は `e` で落ちている)。
        assert_eq!(mark(&["e", "sub", "e", "add", "3", "0", "eq"]), None);
        assert_eq!(
            mark(&["e", "sub", "e", "add", "3", "0", "eq", "sin"]),
            q(1, 2, false)
        );
        assert_eq!(mark(&["1", "5", "0", "sin"]), q(1, 2, false));
    }

    #[test]
    fn table_answers_with_a_root_are_not_marked() {
        assert_eq!(mark(&["4", "5", "sin"]), None);
        assert_eq!(mark(&["3", "0", "cos"]), None);
        assert_eq!(mark(&["6", "0", "tan"]), None);
        assert_eq!(rad(&["pi", "div", "4", "eq", "cos"]), None);
        // 表に載らない角も印なし(`π × 7 ÷ 5`)。
        assert_eq!(rad(&["pi", "mul", "7", "div", "5", "eq", "sin"]), None);
        // 15° は表に無い(§4.1)。
        assert_eq!(mark(&["1", "5", "sin"]), None);
    }

    #[test]
    fn pi_over_twelve_is_folded_not_tabled() {
        // **15°(π/12)は表に無い**(§4.1)。答えの表示は表の値と同じ 10 桁になるので、
        // 載らないことは角の正体で見る。
        let held = state_after(&["angle_toggle", "pi", "div", "1", "2", "eq"]).current;
        assert!(matches!(turn(held, AngleMode::Rad), Some(Turn::Folded(_))));
        let held = state_after(&["angle_toggle", "pi", "div", "6", "eq"]).current;
        assert!(matches!(turn(held, AngleMode::Rad), Some(Turn::Table(p)) if p.get() == 2));
    }

    #[test]
    fn the_fold_rounds_its_fraction_once() {
        // **`f64(r)` は正しく丸める**(段階 2)。分母が 2^53 を超えると、`n as f64 / d as f64`
        // は変換と除算で 2 度丸め、この分数では 1 ulp 下(`0.6082601208004513`)に落ちる。
        // 正しく丸めた値は `0.6082601208004514`(Python の `float(Fraction(n, d))`)。
        // **盤面からは打てない分母**(12 文字の入力では届かない)なので、`pi_turn` を直に呼ぶ。
        let (n, d) = (
            322_740_770_792_394_276_848_i128,
            530_596_630_875_089_193_213_i128,
        );
        let twice = n as f64 / d as f64;
        assert_eq!(
            twice, 0.6082601208004513,
            "比べる相手が 2 度丸めの値であること"
        );
        let q = Rational::from_ratio(n, d).unwrap();
        assert_eq!(
            pi_turn(q),
            Some(Turn::Folded(0.6082601208004514 * std::f64::consts::PI))
        );
    }

    #[test]
    fn typed_numbers_in_radians_reach_the_table_only_at_zero() {
        // **RAD で印が k=0 なら q = 0 のときだけ**(§4.1)。
        assert_eq!(rad(&["0", "sin"]), q(0, 1, false));
        assert_eq!(rad(&["0", "cos"]), q(1, 1, false));
        assert_eq!(rad(&["1", "8", "0", "sin"]), None);
        assert_eq!(
            rad(&[
                "3", "dot", "1", "4", "1", "5", "9", "2", "6", "5", "3", "5", "sin"
            ]),
            None
        );
    }

    #[test]
    fn a_complex_argument_marks_only_a_zero_table_answer() {
        // **レビュー役の注記 1**: 複素の引数では、答えの実部は表の値 × `cosh y`。
        // `j cos` の実部は `cosh 1`(1 ではない)。
        assert_eq!(rad(&["j", "cos"]), None);
        assert_eq!(rad(&["pi", "add", "j", "eq", "cos"]), None);
        // **ただし表の値が 0 なら、実部は 0**(`0 × cosh y`)。
        assert_eq!(rad(&["j", "sin"]), q(0, 1, false));
        assert_eq!(rad(&["pi", "add", "j", "eq", "sin"]), q(0, 1, false));
        assert_eq!(
            rad(&["pi", "div", "2", "add", "j", "eq", "cos"]),
            q(0, 1, false)
        );
        // tan の複素は商なので印なし。
        assert_eq!(rad(&["pi", "add", "j", "eq", "tan"]), None);
    }

    #[test]
    fn the_answer_mark_is_true_of_the_answer() {
        // **印は `re` の正体**——付けた印の値と答えの `re` が一致する。
        for tokens in [
            &["3", "0", "sin"][..],
            &["1", "5", "0", "sin"],
            &["2", "1", "0", "sin"],
            &["1", "2", "0", "cos"],
            &["2", "2", "5", "tan"],
            &["angle_toggle", "pi", "mul", "5", "div", "6", "eq", "sin"],
            &["angle_toggle", "pi", "mul", "5", "div", "3", "eq", "cos"],
            &["angle_toggle", "pi", "add", "j", "eq", "sin"],
        ] {
            let held = state_after(tokens).current;
            let mark = held.exact.expect("印が付く");
            let (num, den) = mark.q().parts();
            assert!(!mark.pi(), "{tokens:?}");
            let want = num as f64 / den as f64;
            assert_eq!(held.value.re, want, "{tokens:?}");
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
    fn a_zero_times_pi_from_outside_is_normalized() {
        // **`Exact::of` を通らない道は無い**——直列化の読みも正規化する。
        let held: Held =
            serde_json::from_str(r#"{"value":{"re":0.0,"im":0.0},"exact":{"q":"0/1","pi":true}}"#)
                .unwrap();
        assert_eq!(held.exact, Some(Exact::ZERO));
        assert!(!held.exact.unwrap().pi());
        // 0 でない k=1 はそのまま。
        let held: Held =
            serde_json::from_str(r#"{"value":{"re":0.0,"im":0.0},"exact":{"q":"1/2","pi":true}}"#)
                .unwrap();
        assert_eq!(held.exact, q(1, 2, true));
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

    // ---- √ の印(1.2.3 設計書 §3.1・§3.4) ----

    #[test]
    fn a_held_without_a_root_reads_as_no_root() {
        // **9 の形(`root` の欄が無い)も読める**(`#[serde(default)]`)。
        let held: Held =
            serde_json::from_str(r#"{"value":{"re":0.5,"im":0.0},"exact":{"q":"1/2","pi":false}}"#)
                .unwrap();
        assert_eq!(held.root, None);
        assert_eq!(held.exact, q(1, 2, false));
    }

    fn root_of(tokens: &[&str]) -> Option<(Rational, Rational)> {
        state_after(tokens)
            .current
            .root
            .map(|root| (root.c, root.r))
    }

    fn r(num: i128, den: i128) -> Rational {
        Rational::from_ratio(num, den).unwrap()
    }

    #[test]
    fn only_sqrt_makes_a_root_and_only_neg_carries_it() {
        // **作るのは `√` だけ**(§3.2)。印 k=0 の `q > 0` から `(1, q)`。
        assert_eq!(root_of(&["9", "sqrt"]), Some((r(1, 1), r(9, 1))));
        assert_eq!(
            root_of(&["0", "dot", "5", "sqrt"]),
            Some((r(1, 1), r(1, 2)))
        );
        // **`+/−` は `(−c, r)` にして運ぶ。**
        assert_eq!(root_of(&["2", "sqrt", "neg"]), Some((r(-1, 1), r(2, 1))));
        assert_eq!(
            root_of(&["2", "sqrt", "neg", "neg"]),
            Some((r(1, 1), r(2, 1)))
        );
        // **不変: root が `Some` なら `exact` は `None`**(√ の答えは一般に無理数)。
        for tokens in [&["9", "sqrt"][..], &["2", "sqrt", "neg"]] {
            assert_eq!(mark(tokens), None, "{tokens:?}");
        }
        // **ほかはすべて root を落とす**: 印の無い・k=1 の・0 の引数、×・÷・関数・桁落ち
        // しない差、`=` の答え。
        for tokens in [
            &["0", "sqrt"][..],
            &["pi", "sqrt"],
            &["1", "exp", "4", "0", "sqrt"],
            &["2", "sqrt", "mul", "2", "eq"],
            &["2", "sqrt", "div", "2", "eq"],
            &["2", "sqrt", "sin"],
            &["2", "sqrt", "recip"],
            &["2", "sqrt", "sqr"],
            &["2", "sqrt", "add", "1", "eq"],
            &["2", "sqrt", "sub", "1", "eq"],
        ] {
            assert_eq!(root_of(tokens), None, "{tokens:?}");
        }
    }

    #[test]
    fn the_square_of_a_root_is_its_rational_mark() {
        // `x²` は root `(c, r)` を印 `(c²·r, k=0)` にする(§3.2)。`re` も印の丸めになる。
        assert_eq!(mark(&["2", "sqrt", "sqr"]), q(2, 1, false));
        assert_eq!(mark(&["2", "sqrt", "neg", "sqr"]), q(2, 1, false));
        assert_eq!(mark(&["0", "dot", "5", "sqrt", "sqr"]), q(1, 2, false));
        assert_eq!(state_after(&["2", "sqrt", "sqr"]).current.value.re, 2.0);
        // **√0 は印 `(0, k=0)`**(root は `r > 0` だけ)。
        assert_eq!(mark(&["0", "sqrt"]), q(0, 1, false));
    }

    #[test]
    fn a_cancelling_difference_of_roots_is_exact_at_zero() {
        // 分子 `A² − B²` が 0 なら答えは `(0, k=0)`(§3.3)。`√4 − 2` は門の内側で符号が逆。
        for tokens in [
            &["4", "sqrt", "sub", "2", "eq"][..],
            &["2", "sqrt", "sub", "2", "sqrt", "eq"],
            &["2", "sqrt", "neg", "add", "2", "sqrt", "eq"],
        ] {
            let state = state_after(tokens);
            assert_eq!(state.current.exact, q(0, 1, false), "{tokens:?}");
            assert_eq!(
                state.current.value.re.to_bits(),
                0.0_f64.to_bits(),
                "{tokens:?}"
            );
        }
        // 書き換えた答えには印も root も付かない(一般に無理数)。
        let state = state_after(&["5", "sqrt", "sub", "2", "eq"]);
        assert_eq!((state.current.exact, state.current.root), (None, None));
    }

    #[test]
    fn a_root_crosses_serde_as_text_and_refuses_a_non_positive_radicand() {
        let text = r#"{"value":{"re":1.0,"im":0.0},"exact":null,"root":{"c":"2/4","r":"3/1"}}"#;
        let held: Held = serde_json::from_str(text).unwrap();
        let root = held.root.unwrap();
        assert_eq!(root.c, Rational::from_ratio(1, 2).unwrap());
        assert_eq!(root.r, Rational::from_ratio(3, 1).unwrap());
        let json = serde_json::to_string(&held).unwrap();
        assert!(json.contains(r#""root":{"c":"1/2","r":"3/1"}"#), "{json}");
        let back: Held = serde_json::from_str(&json).unwrap();
        assert_eq!(back, held);
        // **`r > 0` でなければ拒む**(`RootWire`)。読めない文字列も拒む。
        for bad in ["0/1", "-2/1", "1/0", "a/2"] {
            let text = format!(
                r#"{{"value":{{"re":1.0,"im":0.0}},"exact":null,"root":{{"c":"1/1","r":"{bad}"}}}}"#
            );
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{bad}");
        }
    }
}
