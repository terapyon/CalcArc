//! 値に添える「厳密な正体」の印(1.2.2 設計書 §3、1.2.5 設計書 §2)。
//!
//! **印は `re`(実部)の正体である**——`re == q₋₂/π² + q₋₁/π + q₀ + q₁π + … + q₄π⁴`
//! (π のローラン多項式。k は −2〜4)。虚部は問わない(1.2.2 §3.1)。**`re` の計算には
//! 使わない**: `re` は今までどおり f64 で計算し、印はその横を並んで走るだけである。
//! **印を読むのは engine だけ**で、`Value` には欄を足さない(§3.2、§11.2 の未決 6)。
//!
//! **印の計算で i128 が溢れたら、印を捨てるだけでエラーにしない**(§3.4)。k が −2〜4 の
//! 外へ出る項ができたときも同じ。`re` は印と無関係に計算しているので、答えは今の f64 の
//! 道に戻る。だからこのファイルの関数はどれも印(`Marks`。中身は `Option`)を返し、
//! `CalcResult` を返さない。
//!
//! **伝わり方の規則はキー(演算)ごとに 1 つの関数**として書き、engine の `apply` が
//! 後置関数の腕ごとに `Value` の計算と並べて呼ぶ(§3.4「書き方」)。

use serde::{Deserialize, Serialize};

use super::state::Buffer;
use crate::expr::rational::{EXACT_INT, Rational, ratio_to_f64};
use crate::scientific::{self, Entry, Row, Turn, table_row};
use crate::{AngleMode, Value};

/// 係数の数。k = −2, …, 4。
const TERMS: usize = 7;
/// 係数の配列の先頭の k。
const LOWEST: i8 = -2;
/// 係数の配列の末尾の k。
const HIGHEST: i8 = 4;

/// `re` の厳密な正体。`re == Σ qₖ πᵏ`(k = −2, …, 4。虚部は問わない)。
///
/// **係数は固定の 7 つ**で、0 の書き方は全部 0 の 1 通りしかない(正規化は要らない)。
/// **欄は private で、作る道は `Exact::of`・このファイルの演算・直列化の読みだけ**である。
/// 読みは係数がちょうど 7 個で、どれも既約な `"num/den"` でなければ拒む(`ExactWire`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ExactWire")]
pub struct Exact {
    /// k = −2, …, 4 の順。**WASM 境界では文字列 `"num/den"` の列で渡す**(§6.1)。
    /// i128 を BigInt のまま JS へ出すと、JSON を経た写しなどで別の型に化けたとき
    /// `reduce_key` が黙って初期状態に戻る。型の段で起きなくする。
    #[serde(serialize_with = "rational_text::serialize_terms")]
    terms: [Rational; TERMS],
}

/// 直列化の読み口。**係数がちょうど 7 個のときだけ `Exact` になる**。
#[derive(Deserialize)]
struct ExactWire {
    #[serde(deserialize_with = "rational_text::deserialize_terms")]
    terms: Vec<Rational>,
}

impl TryFrom<ExactWire> for Exact {
    type Error = &'static str;

    fn try_from(wire: ExactWire) -> Result<Exact, Self::Error> {
        let terms = <[Rational; TERMS]>::try_from(wire.terms).map_err(|_| "expected 7 terms")?;
        Ok(Exact { terms })
    }
}

impl Exact {
    /// 0 の印。初期値・`AC`・`(` の 0、虚数の入力の `re` に付く(§3.3)。
    pub const ZERO: Exact = Exact {
        terms: [Rational::ZERO; TERMS],
    };
    /// `π` キーの印 `1·π`。
    pub const PI: Exact = Exact {
        terms: [
            Rational::ZERO,
            Rational::ZERO,
            Rational::ZERO,
            Rational::ONE,
            Rational::ZERO,
            Rational::ZERO,
            Rational::ZERO,
        ],
    };

    /// 単項 `q` か `qπ` を作る。
    pub fn of(q: Rational, pi: bool) -> Exact {
        let mut exact = Exact::ZERO;
        exact.terms[if pi { 3 } else { 2 }] = q;
        exact
    }

    /// 単項 `qπᵏ`。k が −2〜4 の外なら `None`。
    fn term(k: i8, q: Rational) -> Option<Exact> {
        let mut exact = Exact::ZERO;
        *exact.slot(k)? = q;
        Some(exact)
    }

    /// k の係数の置き場。k が −2〜4 の外なら `None`。
    fn slot(&mut self, k: i8) -> Option<&mut Rational> {
        self.terms
            .get_mut(usize::try_from(k.checked_sub(LOWEST)?).ok()?)
    }

    /// 0 でない係数を `(k, q)` で、k の小さい順に。
    fn nonzero(self) -> impl Iterator<Item = (i8, Rational)> {
        (LOWEST..=HIGHEST)
            .zip(self.terms)
            .filter(|(_, q)| !q.is_zero())
    }

    fn is_zero(self) -> bool {
        self.nonzero().next().is_none()
    }

    /// **単項なら `(k, q)`**。全部 0 なら `(0, 0)`、項が 2 つ以上なら `None`。
    /// 三角関数・`1/x`・`÷` の割る側・`√` が読む。
    pub(super) fn monomial(self) -> Option<(i8, Rational)> {
        let mut terms = self.nonzero();
        match (terms.next(), terms.next()) {
            (None, _) => Some((0, Rational::ZERO)),
            (Some(term), None) => Some(term),
            (Some(_), Some(_)) => None,
        }
    }

    /// **π を含まない有理数なら `q`**(単項 k = 0 か 0)。
    pub(super) fn rational(self) -> Option<Rational> {
        match self.monomial()? {
            (0, q) => Some(q),
            _ => None,
        }
    }
}

/// √ の印(1.2.3 設計書 §3.1、1.2.5 設計書 §2.3)。`re == c × √(r × π^pi)`、`r > 0`、
/// `pi` は −2〜4(√ を取る前の印の k)。
///
/// **`Exact` に種類を足さず、`Held` に別の欄として持つ**——√ は π の多項式の外の数で、
/// √ の印が意味を持つのは「√ の直後」と「桁落ちする ± の 1 段」だけなので、読む所を
/// 閉じ込める(1.2.3 §3.1)。**欄は private**。作る道は `√` の印の関数 `exact::sqrt` と、
/// 直列化の読みの 2 つだけである。**読みは `r > 0` で `pi` が −2〜4 でなければ拒む**
/// (`RootWire`)。`+/−` は `c` の符号だけを変えて運ぶ(`exact::neg`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RootWire")]
pub struct Root {
    /// `Exact` の係数と同じく、**WASM 境界では文字列 `"num/den"` で渡す**(§3.4)。
    #[serde(serialize_with = "rational_text::serialize")]
    c: Rational,
    #[serde(serialize_with = "rational_text::serialize")]
    r: Rational,
    pi: i8,
}

/// 直列化の読み口。**`r > 0` と `pi` の範囲を境界の向こうから来た値にも課す**。
/// **`pi` は省けない**(既定値を置かない)。
#[derive(Deserialize)]
struct RootWire {
    #[serde(with = "rational_text")]
    c: Rational,
    #[serde(with = "rational_text")]
    r: Rational,
    pi: i8,
}

impl TryFrom<RootWire> for Root {
    type Error = &'static str;

    fn try_from(wire: RootWire) -> Result<Root, Self::Error> {
        if wire.r.is_negative() || wire.r.is_zero() {
            Err("expected r > 0")
        } else if !(LOWEST..=HIGHEST).contains(&wire.pi) {
            Err("expected pi in -2..=4")
        } else {
            Ok(Root {
                c: wire.c,
                r: wire.r,
                pi: wire.pi,
            })
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

    /// `Exact` の印だけを持つ。**root は持たない**——root を作る・運ぶ腕は `√`・`+/−`
    /// だけで、ほかの腕は全部ここを通る(`x²` は root を読んで `Exact` を返す)。
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
    /// **欠けた形も読める**(`#[serde(default)]`、§3.4)。
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

    /// 計算した値に印を添える。**印が π を含まない有理数なら、`re` を印を正しく丸めた
    /// f64 に置き換える**(1.2.2 段階 2、設計書 §5.1)。虚部はそのまま。
    ///
    /// - **π を含む値は `re` を変えない**——π を含む値は正しく丸められない(§5.1)。
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
        let value = match exact.and_then(Exact::rational) {
            Some(q) => Value {
                re: q.to_f64(),
                im: value.im,
            },
            None => value,
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

/// 係数ごとの和。どれかが溢れたら `None`。
fn sum(a: Exact, b: Exact) -> Option<Exact> {
    let mut out = a;
    for (slot, q) in out.terms.iter_mut().zip(b.terms) {
        *slot = slot.checked_add(q).ok()?;
    }
    Some(out)
}

/// 係数ごとに符号を反転する。
fn negated(a: Exact) -> Option<Exact> {
    let mut out = a;
    for slot in &mut out.terms {
        *slot = Rational::ZERO.checked_sub(*slot).ok()?;
    }
    Some(out)
}

/// 多項式の積。**積の項が 1 つでも k の範囲の外へ出たら `None`**(打ち消し合う項が
/// あっても落とす)。
fn product(a: Exact, b: Exact) -> Option<Exact> {
    let mut out = Exact::ZERO;
    for (ka, qa) in a.nonzero() {
        for (kb, qb) in b.nonzero() {
            let slot = out.slot(ka.checked_add(kb)?)?;
            *slot = slot.checked_add(qa.checked_mul(qb).ok()?).ok()?;
        }
    }
    Some(out)
}

/// `a + b`。係数ごとの和。**複素数が混ざっても `re` どうしで合成する**(1.2.2 の条件 2)。
pub fn add(a: Held, b: Held) -> Marks {
    Marks::exact(add_mark(a, b))
}

fn add_mark(a: Held, b: Held) -> Option<Exact> {
    sum(a.exact?, b.exact?)
}

/// `a − b`。`add` と同じ規則。
pub fn sub(a: Held, b: Held) -> Marks {
    Marks::exact(sub_mark(a, b))
}

fn sub_mark(a: Held, b: Held) -> Option<Exact> {
    sum(a.exact?, negated(b.exact?)?)
}

/// 両方とも虚部が 0 か。**積・商・関数は、どちらかの虚部が 0 でなければ印を落とす**
/// (複素の積の `re` は `re·re − im·im` で、`re` の印だけでは決まらない)。
fn both_real(a: Held, b: Held) -> bool {
    a.value.im == 0.0 && b.value.im == 0.0
}

/// `a × b`。多項式の積(`π × π` は `π²`、`(π + 1) × (π − 1)` は `π² − 1`)。
pub fn mul(a: Held, b: Held) -> Marks {
    Marks::exact(mul_mark(a, b))
}

fn mul_mark(a: Held, b: Held) -> Option<Exact> {
    if !both_real(a, b) {
        return None;
    }
    product(a.exact?, b.exact?)
}

/// `a ÷ b`。**割る側が単項 `qπᵏ`(`q ≠ 0`)なら、割られる側の各項 `qᵢπⁱ` を
/// `(qᵢ/q)π^(i−k)` にする。** 1 項でも k の範囲の外へ出たら落とす。割る側が和なら落とす。
///
/// **割る側の逆数 `π⁻ᵏ` を作らない**——作ると、割る側が k = 3・4 のとき逆数が範囲の外に
/// 出て、答えが範囲の中でも落ちる(`π⁴ ÷ π³` は π)。
///
/// **`0 ÷ b` は 0**(`b ≠ 0`)。0 は k に中立である(1.2.2 の中間審査の条件 1)。
pub fn div(a: Held, b: Held) -> Marks {
    Marks::exact(div_mark(a, b))
}

fn div_mark(a: Held, b: Held) -> Option<Exact> {
    if !both_real(a, b) {
        return None;
    }
    let (a, b) = (a.exact?, b.exact?);
    if b.is_zero() {
        return None;
    }
    if a.is_zero() {
        return Some(Exact::ZERO);
    }
    let (k, q) = b.monomial()?;
    let mut out = Exact::ZERO;
    for (ka, qa) in a.nonzero() {
        *out.slot(ka.checked_sub(k)?)? = qa.checked_div(q).ok()?;
    }
    Some(out)
}

/// `+/−`。係数ごとに符号を反転する。**虚部があっても保つ**(`re` の符号反転は `re` だけで
/// 決まる)。**root も `(−c, r, pi)` にして運ぶ**(1.2.3 設計書 §3.2)——`−√a + √b` を
/// 書き換えるため。root を持つ値は `exact` が `None` なので、2 つの欄が両方 `Some` に
/// なることはない。
pub fn neg(a: Held) -> Marks {
    Marks {
        exact: a.exact.and_then(negated),
        root: a.root.and_then(|root| {
            Some(Root {
                c: Rational::ZERO.checked_sub(root.c).ok()?,
                ..root
            })
        }),
    }
}

/// `x²`。印は自分との積(`π` は `π²`、`π + 1` は `π² + 2π + 1`)。**root `(c, r, pi)` なら
/// 単項 `c²·r·π^pi`**——√ を 2 乗すると √ の中身に戻る(1.2.3 設計書 §3.2。`2 √ x² − 2 =`
/// が 0、`π √ x²` が π)。`pi` は −2〜4 なので範囲の外へは出ない。
pub fn sqr(a: Held) -> Marks {
    Marks::exact(sqr_mark(a))
}

fn sqr_mark(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    match (a.root, a.exact) {
        (Some(root), _) => Exact::term(
            root.pi,
            root.c.checked_mul(root.c).ok()?.checked_mul(root.r).ok()?,
        ),
        (None, Some(mark)) => product(mark, mark),
        (None, None) => None,
    }
}

/// 実数の項を「符号と 2 乗」で読む(1.2.3 設計書 §3.3)。root `(c, r, 0)` なら
/// `(c < 0, c²·r)`、π を含まない有理数の印 `q` なら `(q < 0, q²)`。**π を含む印・`pi ≠ 0` の
/// root・印なし・溢れは `None`**——`cancel` の門は有理数の 2 乗で比べるので、π の入った
/// 項は読まない。**虚部は見ない**(呼び手が見る)。
fn signed_square(a: Held) -> Option<(bool, Rational)> {
    match (a.root, a.exact) {
        (Some(root), _) if root.pi == 0 => Some((
            root.c.is_negative(),
            root.c.checked_mul(root.c).ok()?.checked_mul(root.r).ok()?,
        )),
        (Some(_), _) => None,
        (None, mark) => {
            let q = mark?.rational()?;
            Some((q.is_negative(), q.checked_mul(q).ok()?))
        }
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
/// - **両方が有理数の印なら書き換えない**——そちらは `sub` の印が厳密に引く。
/// - **π を含む印と `pi ≠ 0` の root は読まない**(`signed_square`)。門は有理数の 2 乗で
///   比べるので、π の入った項には使えない。
/// - **i128 が溢れたら書き換えない**(§3.5)。
pub(super) fn cancel(a: Held, b: Held, subtract: bool) -> Option<(Value, Marks)> {
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
    // **ほかの二項演算と同じく `finalize` を通す**(−0.0 を残さない。商が下に溢れたとき。
    // `a_rewritten_quotient_never_leaves_a_negative_zero`)。有限でなければ書き換えない。
    let quotient = numerator.to_f64() / (a.value.re.abs() + b.value.re.abs());
    Some((
        Value::real(quotient * a.value.re.signum())
            .finalize()
            .ok()?,
        Marks::exact(numerator.is_zero().then_some(Exact::ZERO)),
    ))
}

/// `√`(1.2.3 設計書 §3.2、1.2.5 設計書 §2.3)。**`Root` を作る唯一の関数**である。
/// 引数の印が**単項 `qπᵏ` で `q > 0`** のとき:
///
/// - **k = 0** なら root `(1, q, 0)`。平方数でも root のまま(1.2.3 の root の意味を変えない)。
/// - **0 でない偶数の k で `q` が平方数**なら単項 `√q·π^(k/2)`(`π x² √` は `π`)。
/// - それ以外(奇数の k、平方数でない `q`)は root `(1, q, k)`(`π √` は `(1, 1, 1)`)。
///
/// `q = 0` なら 0 の印(√0 は 0)。負・和・印なしは落とす(負の引数は値の計算が
/// `DomainError` にする。複素の引数も同じ)。**k ∈ [−2, 4] の √ は範囲の外へ出ない**——root
/// なら `pi = k`、単項なら `k/2 ∈ {−1, 1, 2}`。
pub(super) fn sqrt(a: Held) -> Marks {
    let Some((k, q)) = a.exact.and_then(Exact::monomial) else {
        return Marks::NONE;
    };
    if q.is_negative() {
        return Marks::NONE;
    }
    if q.is_zero() {
        return Marks::exact(Some(Exact::ZERO));
    }
    if k != 0 && k % 2 == 0 {
        if let Some(root) = square_root(q) {
            return Marks::exact(Exact::term(k / 2, root));
        }
    }
    Marks {
        exact: None,
        root: Some(Root {
            c: Rational::ONE,
            r: q,
            pi: k,
        }),
    }
}

/// `q` が有理数の平方なら、その正の平方根。**分子と分母を整数の平方根で厳密に判定する**
/// (f64 の `sqrt` を通さない)。`q ≥ 0` を前提とする。
fn square_root(q: Rational) -> Option<Rational> {
    let (num, den) = q.parts();
    let exact_root = |n: i128| {
        let n = u128::try_from(n).ok()?;
        let root = n.isqrt();
        (root.checked_mul(root)? == n).then_some(root)
    };
    let (num, den) = (exact_root(num)?, exact_root(den)?);
    Rational::from_ratio(i128::try_from(num).ok()?, i128::try_from(den).ok()?).ok()
}

/// **`xʸ` の指数がちょうど `1/2` で、底と指数が実数か**(1.2.5 設計書 §3.1)。そのとき
/// engine は答えを `√` で計算し、印も `√` と同じにする。
pub(super) fn is_square_root(base: Held, exponent: Held) -> bool {
    both_real(base, exponent)
        && exponent.exact.and_then(Exact::rational) == Rational::from_ratio(1, 2).ok()
}

/// `1/x`。単項 `qπᵏ`(`q ≠ 0`)なら `(1/q)π⁻ᵏ`。k = 3・4 の逆数は範囲の外なので落とす。
/// 和は落とす。
pub fn recip(a: Held) -> Marks {
    Marks::exact(recip_mark(a))
}

fn recip_mark(a: Held) -> Option<Exact> {
    if a.value.im != 0.0 {
        return None;
    }
    let (k, q) = a.exact?.monomial()?;
    if q.is_zero() {
        return None;
    }
    Exact::term(k.checked_neg()?, Rational::ONE.checked_div(q).ok()?)
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
/// - **RAD で印が単項 k=1**: `r = q mod 2`。表に載れば `Table`、載らなければ `(−1, 1]` に
///   畳んで `Folded(f64(r) × π)`。
/// - **RAD で印が 0**: 表(0)。
/// - **RAD でそれ以外の印**(0 でない k=0・k ≠ 1 の単項・和)は表を引かない。**打った
///   `3.1415926535` も `32993.006048` も表に載らない**——π ではないので、f64 の答えが
///   正しい答えである。`π + 1` も畳まない(f64 の `sin` で 10 桁が合う)。
/// - **DEG で印が単項 k=0**: 表か、90° の倍数とずれに分けて畳む(`degree_turn`)。
///   f64 が `q` を厳密に持つ整数だけは、印で決めずに f64 の規則へ渡す。
/// - **DEG で π を含む印**(`π` を度で読む)は表に載らない(π° は無理数の角)。f64 の規則へ。
///
/// **RAD は 1.0.0 で「触らない」とした**(入力そのものが厳密でないので、厳密な答えを
/// 返すと嘘になる)。**1.2.2 で RAD に広げるのは、入力が π の有理数倍だと「分かっている」
/// ときだけ**——π キーから印を保つ演算だけで作った値(印が単項 k=1)。**1.0.0 の線引き
/// 「入力が厳密なら、答えも厳密に」は変えていない。** 変えたのは「厳密な入力」の数え方で、
/// π キーの印がそこに入った(1.2.2 設計書 §7.2)。
pub fn turn(arg: Held, mode: AngleMode) -> Option<Turn> {
    let from_mark = match (arg.exact.map(Exact::monomial), mode) {
        (Some(Some((1, q))), AngleMode::Rad) => pi_turn(q),
        (Some(Some((0, q))), AngleMode::Rad) if q.is_zero() => Turn::table(0),
        (Some(_), AngleMode::Rad) => return None,
        (Some(Some((0, q))), AngleMode::Deg) => degree_turn(q),
        _ => None,
    };
    from_mark.or_else(|| scientific::turn_of(arg.value, mode))
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
    Some(Turn::Folded {
        quarter: 0,
        radians: x * std::f64::consts::PI,
    })
}

/// `q` 度の角(DEG)。`r = q mod 360`(ユークリッドの剰余、`[0, 360)`)。
///
/// 1. **`r` が 30 か 45 の倍数なら表**。分母 ≠ 1 なら `r` は整数でないので載らない。
/// 2. **`|q| ≤ 2^53` の整数は `None`**(f64 の規則へ)。f64 は `q` を厳密に持つので、
///    `to_rad` の `re % 360` が既に厳密である。
/// 3. **それ以外は、いちばん近い 90° の倍数 `90k` と、ずれ `δ = r − 90k`
///    (`[−45, 45)`、有理数)に分ける。** `δ` を正しく丸めた f64 `x` が ±30 か ±45
///    ちょうどなら表(位置 `6k ± 2`・`6k ± 3`)、そうでなければ
///    `Folded { quarter: k mod 4, radians: x° }`。
///
/// **角全体ではなく、ずれだけを f64 にする**理由: 90° の倍数の近くでは `sin`・`cos` の
/// どちらかが `δ` に比例して小さく、角全体を f64 にした丸め(180 の ulp と π の丸め)が
/// その答えに対して相対で効く。ずれは小さいほど細かく丸まるので、相対で崩れない。
/// 同じ理由で、分母 ≠ 1 の角から極は出ない(`δ` は 0 にならない)。
///
/// 表に吸うのは `x` が ±30・±45 に丸まったときだけである。そこでは表の `1/2`・`√` の
/// 値のほうが、丸めた角の `sin` より真値に近い。0 の近くでは、ずれの `sin` のほうが
/// 表の 0 より近い。
///
/// i128 が溢れたら `None`(印を捨てて f64 の道へ)。
fn degree_turn(q: Rational) -> Option<Turn> {
    let (n, d) = q.parts();
    let quarter = d.checked_mul(90)?;
    let r = n.rem_euclid(quarter.checked_mul(4)?);
    if d == 1 {
        if r % 15 == 0 {
            if let Some(table) = Turn::table(r / 15) {
                return Some(table);
            }
        }
        if n.unsigned_abs() <= EXACT_INT {
            return None;
        }
    }
    let k = r.checked_add(d.checked_mul(45)?)?.div_euclid(quarter);
    let x = ratio_to_f64(r.checked_sub(k.checked_mul(quarter)?)?, d)?;
    if x.abs() == 30.0 || x.abs() == 45.0 {
        if let Some(table) = Turn::table(6 * k + (x / 15.0) as i128) {
            return Some(table);
        }
    }
    Some(Turn::Folded {
        quarter: u8::try_from(k % 4).ok()?,
        radians: x.to_radians(),
    })
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

    fn text(q: &Rational) -> String {
        let (num, den) = q.parts();
        format!("{num}/{den}")
    }

    pub fn serialize<S: Serializer>(q: &Rational, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&text(q))
    }

    /// 係数の列を、文字列の列で直列化する。
    pub fn serialize_terms<S: Serializer>(
        terms: &[Rational],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(terms.iter().map(text))
    }

    /// **既約・分母正・`i128::MIN` 無しの不変は `Rational::from_ratio` が作り直す**——
    /// 境界の向こうから来た文字列を信じない。
    fn parse<E: Error>(text: &str) -> Result<Rational, E> {
        let (num, den) = text
            .split_once('/')
            .ok_or_else(|| E::custom("expected \"num/den\""))?;
        let num: i128 = num.parse().map_err(E::custom)?;
        let den: i128 = den.parse().map_err(E::custom)?;
        Rational::from_ratio(num, den).map_err(|e| E::custom(format!("{e:?}")))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Rational, D::Error> {
        parse(&String::deserialize(deserializer)?)
    }

    /// 係数の列を読む。個数は呼び手(`ExactWire` から `Exact` への変換)が見る。
    pub fn deserialize_terms<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<Rational>, D::Error> {
        Vec::<String>::deserialize(deserializer)?
            .iter()
            .map(|text| parse(text))
            .collect()
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

    /// 係数を `(k, 分子, 分母)` で並べた印(挙げない k は 0)。**直列化の読みを通して作る**
    /// ——単項しか作れない `Exact::of` では、和も k ∉ {0, 1} も書けない。
    fn laurent(terms: &[(i8, i128, i128)]) -> Option<Exact> {
        let mut text = vec!["0/1".to_string(); 7];
        for &(k, num, den) in terms {
            text[usize::try_from(k + 2).unwrap()] = format!("{num}/{den}");
        }
        Some(serde_json::from_value(serde_json::json!({ "terms": text })).unwrap())
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
    fn sums_combine_term_by_term() {
        assert_eq!(mark(&["1", "add", "2", "eq"]), q(3, 1, false));
        assert_eq!(mark(&["pi", "add", "pi", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["pi", "sub", "pi", "eq"]), q(0, 1, false));
        assert_eq!(
            mark(&["0", "dot", "1", "add", "0", "dot", "2", "eq"]),
            q(3, 10, false)
        );
        // k が違えば、係数ごとの和として持つ。
        assert_eq!(
            mark(&["pi", "add", "1", "eq"]),
            laurent(&[(0, 1, 1), (1, 1, 1)])
        );
        assert_eq!(
            mark(&["1", "sub", "pi", "eq"]),
            laurent(&[(0, 1, 1), (1, -1, 1)])
        );
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
    fn products_multiply_the_polynomials() {
        assert_eq!(mark(&["pi", "mul", "2", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["2", "mul", "pi", "eq"]), q(2, 1, true));
        assert_eq!(mark(&["3", "mul", "4", "eq"]), q(12, 1, false));
        assert_eq!(mark(&["pi", "mul", "pi", "eq"]), laurent(&[(2, 1, 1)]));
    }

    #[test]
    fn quotients_shift_the_dividend() {
        assert_eq!(mark(&["pi", "div", "2", "eq"]), q(1, 2, true));
        assert_eq!(mark(&["pi", "div", "pi", "eq"]), q(1, 1, false));
        assert_eq!(mark(&["1", "div", "3", "eq"]), q(1, 3, false));
        assert_eq!(mark(&["1", "div", "pi", "eq"]), laurent(&[(-1, 1, 1)]));
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
    fn squares_and_reciprocals_move_the_power() {
        assert_eq!(mark(&["1", "dot", "5", "sqr"]), q(9, 4, false));
        assert_eq!(mark(&["4", "recip"]), q(1, 4, false));
        assert_eq!(mark(&["pi", "sqr"]), laurent(&[(2, 1, 1)]));
        assert_eq!(mark(&["pi", "recip"]), laurent(&[(-1, 1, 1)]));
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
        // `π × =` は `π × π`。
        assert_eq!(mark(&["pi", "mul", "eq"]), laurent(&[(2, 1, 1)]));
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
        assert!(matches!(
            turn(held, AngleMode::Rad),
            Some(Turn::Folded { .. })
        ));
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
            Some(Turn::Folded {
                quarter: 0,
                radians: 0.6082601208004514 * std::f64::consts::PI
            })
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
            let q = held
                .exact
                .and_then(Exact::rational)
                .expect("有理数の印が付く");
            let (num, den) = q.parts();
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
        // 和の係数(10^38·π が 2 つで i128 を超える)。
        assert_eq!(
            mark(&[
                "1", "exp", "3", "8", "mul", "pi", "add", "1", "exp", "3", "8", "mul", "pi", "eq"
            ]),
            None
        );
        // 積の係数(10^20·π の 2 乗)。
        assert_eq!(
            mark(&["1", "exp", "2", "0", "mul", "pi", "eq", "sqr"]),
            None
        );
        // root の `c²·r`(盤面からは `c` が ±1 にしかならないので、直に渡す)。
        let big = Held {
            value: Value::real(1e20),
            exact: None,
            root: Some(Root {
                c: r(100_000_000_000_000_000_000, 1),
                r: Rational::ONE,
                pi: 1,
            }),
        };
        assert_eq!(sqr(big), Marks::NONE);
    }

    // ---- k の範囲の端と、多項式の積・商(1.2.5 設計書 §2.3・§3.1) ----

    #[test]
    fn a_term_outside_minus_two_to_four_drops_the_mark() {
        // π⁴ × π、π⁻² ÷ π、(π³)²、1/π³ は範囲の外。
        assert_eq!(mark(&["pi", "sqr", "sqr", "mul", "pi", "eq"]), None);
        assert_eq!(mark(&["pi", "sqr", "recip", "div", "pi", "eq"]), None);
        assert_eq!(mark(&["pi", "sqr", "mul", "pi", "eq", "sqr"]), None);
        assert_eq!(mark(&["pi", "sqr", "mul", "pi", "eq", "recip"]), None);
        // 1/π⁻² は π²。
        assert_eq!(
            mark(&["pi", "sqr", "recip", "recip"]),
            laurent(&[(2, 1, 1)])
        );
    }

    #[test]
    fn a_quotient_shifts_the_dividend_without_the_divisors_reciprocal() {
        // π⁴ ÷ π³ は π、π³ ÷ π³ は 1——割る側の逆数 π⁻³ は範囲の外だが、経ない。
        assert_eq!(
            mark(&[
                "pi", "sqr", "sqr", "div", "lparen", "pi", "sqr", "mul", "pi", "rparen", "eq"
            ]),
            q(1, 1, true)
        );
        assert_eq!(
            mark(&[
                "pi", "sqr", "mul", "pi", "eq", "div", "lparen", "pi", "sqr", "mul", "pi",
                "rparen", "eq"
            ]),
            q(1, 1, false)
        );
        // 割る側が和なら落とす。0 を割るなら 0。
        assert_eq!(
            mark(&["1", "div", "lparen", "pi", "add", "1", "rparen", "eq"]),
            None
        );
        assert_eq!(
            mark(&["0", "div", "lparen", "pi", "add", "1", "rparen", "eq"]),
            Some(Exact::ZERO)
        );
    }

    #[test]
    fn products_of_sums_expand_or_drop_as_a_whole() {
        // (π + 1)(π − 1) = π² − 1。
        assert_eq!(
            mark(&[
                "lparen", "pi", "add", "1", "rparen", "mul", "lparen", "pi", "sub", "1", "rparen",
                "eq"
            ]),
            laurent(&[(0, -1, 1), (2, 1, 1)])
        );
        // (π⁴ + 1) × π は π⁵ の項が外へ出るので、π の項ごと全体を落とす。
        assert_eq!(
            mark(&["pi", "sqr", "sqr", "add", "1", "eq", "mul", "pi", "eq"]),
            None
        );
    }

    // ---- √ の表(1.2.5 設計書 §2.3) ----

    #[test]
    fn the_root_of_a_power_of_pi_follows_the_table() {
        let root = |c: &str, r: &str, pi: i8| serde_json::json!({ "c": c, "r": r, "pi": pi });
        // k = 0 は平方数でも root のまま。
        assert_eq!(root_json(&["4", "sqrt"]), root("1/1", "4/1", 0));
        // 0 でない偶数の k で平方数なら単項。
        assert_eq!(mark(&["pi", "sqr", "sqrt"]), q(1, 1, true));
        assert_eq!(root_json(&["pi", "sqr", "sqrt"]), serde_json::Value::Null);
        assert_eq!(mark(&["pi", "sqr", "sqr", "sqrt"]), laurent(&[(2, 1, 1)]));
        assert_eq!(
            mark(&["pi", "sqr", "recip", "sqrt"]),
            laurent(&[(-1, 1, 1)])
        );
        assert_eq!(
            mark(&["pi", "sqr", "mul", "4", "eq", "sqrt"]),
            q(2, 1, true)
        );
        // 平方数でない偶数の k と、奇数の k は root。
        assert_eq!(
            root_json(&["pi", "sqr", "mul", "2", "eq", "sqrt"]),
            root("1/1", "2/1", 2)
        );
        assert_eq!(
            root_json(&["1", "div", "pi", "eq", "sqrt"]),
            root("1/1", "1/1", -1)
        );
        assert_eq!(
            root_json(&["pi", "sqr", "mul", "pi", "eq", "sqrt"]),
            root("1/1", "1/1", 3)
        );
        // `+/−` は `pi` を運ぶ。
        assert_eq!(root_json(&["pi", "sqrt", "neg"]), root("-1/1", "1/1", 1));
        // 和は落とす。
        assert_eq!(mark(&["pi", "add", "1", "eq", "sqrt"]), None);
        assert_eq!(
            root_json(&["pi", "add", "1", "eq", "sqrt"]),
            serde_json::Value::Null
        );
    }

    #[test]
    fn a_square_is_decided_by_integer_roots_not_by_f64() {
        // (2^60 + 1)² / (2^61 + 3)² は平方数。1 を足した分子は平方数でないが、f64 の `sqrt` は
        // 2^60 + 1 を表せないので、f64 で当てると割れ目が見えない。
        let (a, b) = ((1_i128 << 60) + 1, (1_i128 << 61) + 3);
        let square = Rational::from_ratio(a * a, b * b).unwrap();
        assert_eq!(square_root(square), Some(r(a, b)));
        let near = Rational::from_ratio(a * a + 1, b * b).unwrap();
        assert_eq!(
            ((a * a + 1) as f64).sqrt(),
            (a as f64),
            "f64 では割れ目が見えないこと"
        );
        assert_eq!(square_root(near), None);
    }

    #[test]
    fn the_square_of_a_root_keeps_its_power_of_pi() {
        assert_eq!(mark(&["pi", "sqrt", "sqr"]), q(1, 1, true));
        assert_eq!(
            mark(&["1", "div", "pi", "eq", "sqrt", "sqr"]),
            laurent(&[(-1, 1, 1)])
        );
        assert_eq!(
            mark(&["pi", "sqr", "mul", "2", "eq", "sqrt", "sqr"]),
            laurent(&[(2, 2, 1)])
        );
        assert_eq!(
            mark(&["pi", "sqr", "mul", "pi", "eq", "sqrt", "sqr"]),
            laurent(&[(3, 1, 1)])
        );
    }

    #[test]
    fn a_half_power_carries_the_root_mark() {
        assert_eq!(
            root_json(&["2", "pow", "0", "dot", "5", "eq"]),
            root_json(&["2", "sqrt"])
        );
        assert_eq!(
            mark(&["pi", "sqr", "pow", "0", "dot", "5", "eq"]),
            q(1, 1, true)
        );
        // 値も √ と同じビット。
        assert_eq!(
            state_after(&["3", "pow", "0", "dot", "5", "eq"])
                .current
                .value,
            state_after(&["3", "sqrt"]).current.value
        );
        // 指数が 1/2 でなければ落とす。
        assert_eq!(
            root_json(&["2", "pow", "0", "dot", "2", "5", "eq"]),
            serde_json::Value::Null
        );
    }

    // ---- `cancel` が読む範囲(1.2.5 設計書 §5.2、レビュー役の条件 2) ----

    /// `cancel` の左右に置く値。`value` は印と同じ大きさ(1.4 と 1.5 の近く)にする。
    fn held(value: f64, exact: Option<Exact>, root: Option<Root>) -> Held {
        Held {
            value: Value::real(value),
            exact,
            root,
        }
    }

    fn root2(pi: i8) -> Held {
        held(
            std::f64::consts::SQRT_2,
            None,
            Some(Root {
                c: Rational::ONE,
                r: r(2, 1),
                pi,
            }),
        )
    }

    #[test]
    fn cancel_reads_only_rational_marks_and_roots_without_pi() {
        let three_halves = held(1.5, q(3, 2, false), None);
        // **対照**: √2 − 3/2 は門の内側(A² = 2、B² = 9/4)で書き換える。これが無いと、全部
        // `None` を返す壊れ方でも下の行は緑になる。
        assert!(cancel(root2(0), three_halves, true).is_some());
        // Exact 側: 係数 3/2 を π の入った位置に置いた印。k = 0 の係数だけを読み違えれば、
        // 対照と同じく書き換わる。
        let sum = |k: i8| {
            let mut exact = Exact::of(r(3, 2), false);
            *exact.slot(k).unwrap() = r(1, 7);
            Some(exact)
        };
        for (label, exact) in [
            ("3/2 + π/7", sum(1)),
            ("3/2 + π⁴/7", sum(4)),
            ("3/2 + π⁻²/7", sum(-2)),
            ("π + 1", laurent(&[(0, 1, 1), (1, 1, 1)])),
            ("3/2 π⁻²", laurent(&[(-2, 3, 2)])),
            ("3/2 π⁻¹", laurent(&[(-1, 3, 2)])),
            ("3/2 π", laurent(&[(1, 3, 2)])),
            ("3/2 π²", laurent(&[(2, 3, 2)])),
            ("3/2 π³", laurent(&[(3, 3, 2)])),
            ("3/2 π⁴", laurent(&[(4, 3, 2)])),
        ] {
            assert_eq!(
                cancel(root2(0), held(1.5, exact, None), true),
                None,
                "{label}"
            );
        }
        // Root 側: √(2πᵏ) は読まない。
        for pi in [-2, -1, 1, 2, 3, 4] {
            assert_eq!(cancel(root2(pi), three_halves, true), None, "pi = {pi}");
        }
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
        assert_eq!(
            mark(&["pi", "mul", "lparen", "del", "eq"]),
            laurent(&[(2, 1, 1)])
        );
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
        assert!(
            json.contains(r#""terms":["0/1","0/1","0/1","2/1","0/1","0/1","0/1"]"#),
            "{json}"
        );
        let back: EngineState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, state);
    }

    /// `exact` の欄を `"terms"` の 7 つの文字列で書いた `Held` の JSON。
    fn held_with_terms(terms: &[&str]) -> String {
        let terms = terms
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(",");
        format!(r#"{{"value":{{"re":0.5,"im":0.0}},"exact":{{"terms":[{terms}]}}}}"#)
    }

    #[test]
    fn a_mark_from_outside_reads_its_seven_terms() {
        // 全部 0 は 0 の印。0 の書き方は 1 通りしか無い。
        let zero = ["0/1"; 7];
        let held: Held = serde_json::from_str(&held_with_terms(&zero)).unwrap();
        assert_eq!(held.exact, Some(Exact::ZERO));
        // 位置が k を決める(k = −2, …, 4 の順)。
        let held: Held = serde_json::from_str(&held_with_terms(&[
            "0/1", "0/1", "0/1", "1/2", "0/1", "0/1", "0/1",
        ]))
        .unwrap();
        assert_eq!(held.exact, q(1, 2, true));
    }

    #[test]
    fn a_mark_from_outside_is_reduced_or_refused() {
        let held: Held = serde_json::from_str(&held_with_terms(&[
            "0/1", "0/1", "2/4", "0/1", "0/1", "0/1", "0/1",
        ]))
        .unwrap();
        assert_eq!(held.exact, q(1, 2, false));
        for bad in ["1/0", "1", "a/2", "1/2/3"] {
            let text = held_with_terms(&["0/1", "0/1", bad, "0/1", "0/1", "0/1", "0/1"]);
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{bad}");
        }
        // **係数はちょうど 7 個**。
        for count in [6, 8] {
            let text = held_with_terms(&vec!["0/1"; count]);
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{count}");
        }
        // 1 項と 1 ビットの形(`STATE_SCHEMA` 10)は読まない。
        let old = r#"{"value":{"re":0.5,"im":0.0},"exact":{"q":"1/2","pi":false}}"#;
        assert!(serde_json::from_str::<Held>(old).is_err());
    }

    // ---- √ の印(1.2.3 設計書 §3.1・§3.4) ----

    #[test]
    fn a_held_without_a_root_reads_as_no_root() {
        // **`root` の欄が無い形も読める**(`#[serde(default)]`)。
        let held: Held = serde_json::from_str(&held_with_terms(&[
            "0/1", "0/1", "1/2", "0/1", "0/1", "0/1", "0/1",
        ]))
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

    /// root を直列化の形で読む(`pi` の欄まで見る)。
    fn root_json(tokens: &[&str]) -> serde_json::Value {
        serde_json::to_value(state_after(tokens).current.root).unwrap()
    }

    #[test]
    fn only_sqrt_makes_a_root_and_only_neg_carries_it() {
        // **作るのは `√` だけ**(§3.2)。印 k=0 の `q > 0` から `(1, q)`。
        assert_eq!(root_of(&["9", "sqrt"]), Some((r(1, 1), r(9, 1))));
        // 単項の π の冪も root にする(√ の中の冪を `pi` に持つ)。
        assert_eq!(
            root_json(&["pi", "sqrt"]),
            serde_json::json!({ "c": "1/1", "r": "1/1", "pi": 1 })
        );
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
        // **ほかはすべて root を落とす**: 印の無い・0 の引数、×・÷・関数・桁落ち
        // しない差、`=` の答え。
        for tokens in [
            &["0", "sqrt"][..],
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
    fn outside_the_gate_the_difference_is_the_plain_f64_one() {
        // **2 倍の門の番人**(§3.3)。`667/833 − √334` は A² が B² の 1/4 より小さいので
        // 書き換えない——生の f64 は、印の丸め `667/833` と `√334` の f64 の差そのもの。
        // 門を外すと書き換えの丸めが 1 回増えて 1 ulp 動き、真値から遠ざかる
        // (相対 1.4e-17 → 1.9e-16)。10 桁の表示は動かないので engine_table では見えない。
        let state = state_after(&[
            "6", "6", "7", "div", "8", "3", "3", "eq", "sub", "3", "3", "4", "sqrt", "eq",
        ]);
        let plain = r(667, 833).to_f64() - 334.0_f64.sqrt();
        assert_eq!(state.current.value.re.to_bits(), plain.to_bits());
    }

    #[test]
    fn the_gate_factor_is_two_on_both_sides() {
        // **門の幅そのものの番人**(§3.3)。上の番人は門を外したときしか鳴らない——
        // 係数 4(大きさで 2 倍)を 2 にも 8 にも動かしても緑のままだった。**どの件も、
        // 書き換えた f64 と素の f64 の差が 1 ulp 以上ある**(下の `assert_ne!`)ので、
        // どちらの道を通ったかが生のビットで分かる。
        //
        // **門は 2 本の不等式**(`below = 4B² − A² ≥ 0` と `above = 4A² − B² ≥ 0`。A は左の項、
        // B は右の項)で、**係数も比較もそれぞれ別に動きうる**ので、それぞれの境目に置く。
        // - `below` の境目(A² ≤ 4B²): `√399 − 10`(4·100 − 399 = 1)と `26 − √170`
        //   (4·170 − 676 = 4)が内側、`√401 − 10`(−1)と `26 − √167`(−8)が外側。
        // - `above` の境目(B² ≤ 4A²): 上の鏡像。`10 − √399`(4·100 − 399 = 1)と
        //   `√170 − 26`(4)が内側、`10 − √401`(−1)と `√167 − 26`(−8)が外側。
        // - **等号**(門は `≤` で、境目ちょうどは内側): `√2 − √0.5` は `below = 0`、
        //   `√0.5 − √2` は `above = 0` で、どちらも書き換える。すぐ外の
        //   `√2 − √0.4999`(`below` = −0.0004)と `√0.4999 − √2`(`above` = −0.0004)は書き換えない。
        // 片方の係数を 2 に狭めるとその側の内側が素の f64 になって赤、8 に広げるとその側の
        // 外側が書き換わって赤。片方の比較を `<` にすると、その側の等号の件が赤
        // (2026-10-08、片側ずつの変異で確認)。
        let fold = |keys: &[&str]| state_after(keys).current.value.re;
        // (表示, 答え, 分子 A² − B² の f64, |A| + |B|, 素の f64, 門の内側か)
        // 分子は engine と同じく**有理数で引いてから** f64 にする(`0.4999` は f64 で引くと丸めが乗る)。
        let (s2, s05, s04999) = (2.0_f64.sqrt(), 0.5_f64.sqrt(), 0.4999_f64.sqrt());
        let cases = [
            (
                "√399 − 10",
                fold(&["3", "9", "9", "sqrt", "sub", "1", "0", "eq"]),
                299.0,
                399.0_f64.sqrt() + 10.0,
                399.0_f64.sqrt() - 10.0,
                true,
            ),
            (
                "√401 − 10",
                fold(&["4", "0", "1", "sqrt", "sub", "1", "0", "eq"]),
                301.0,
                401.0_f64.sqrt() + 10.0,
                401.0_f64.sqrt() - 10.0,
                false,
            ),
            (
                "26 − √170",
                fold(&["2", "6", "sub", "1", "7", "0", "sqrt", "eq"]),
                506.0,
                26.0 + 170.0_f64.sqrt(),
                26.0 - 170.0_f64.sqrt(),
                true,
            ),
            (
                "26 − √167",
                fold(&["2", "6", "sub", "1", "6", "7", "sqrt", "eq"]),
                509.0,
                26.0 + 167.0_f64.sqrt(),
                26.0 - 167.0_f64.sqrt(),
                false,
            ),
            (
                "10 − √399",
                fold(&["1", "0", "sub", "3", "9", "9", "sqrt", "eq"]),
                -299.0,
                10.0 + 399.0_f64.sqrt(),
                10.0 - 399.0_f64.sqrt(),
                true,
            ),
            (
                "10 − √401",
                fold(&["1", "0", "sub", "4", "0", "1", "sqrt", "eq"]),
                -301.0,
                10.0 + 401.0_f64.sqrt(),
                10.0 - 401.0_f64.sqrt(),
                false,
            ),
            (
                "√170 − 26",
                fold(&["1", "7", "0", "sqrt", "sub", "2", "6", "eq"]),
                -506.0,
                170.0_f64.sqrt() + 26.0,
                170.0_f64.sqrt() - 26.0,
                true,
            ),
            (
                "√167 − 26",
                fold(&["1", "6", "7", "sqrt", "sub", "2", "6", "eq"]),
                -509.0,
                167.0_f64.sqrt() + 26.0,
                167.0_f64.sqrt() - 26.0,
                false,
            ),
            (
                "√2 − √0.5",
                fold(&["2", "sqrt", "sub", "0", "dot", "5", "sqrt", "eq"]),
                1.5,
                s2 + s05,
                s2 - s05,
                true,
            ),
            (
                "√0.5 − √2",
                fold(&["0", "dot", "5", "sqrt", "sub", "2", "sqrt", "eq"]),
                -1.5,
                s05 + s2,
                s05 - s2,
                true,
            ),
            (
                "√2 − √0.4999",
                fold(&[
                    "2", "sqrt", "sub", "0", "dot", "4", "9", "9", "9", "sqrt", "eq",
                ]),
                r(15001, 10000).to_f64(),
                s2 + s04999,
                s2 - s04999,
                false,
            ),
            (
                "√0.4999 − √2",
                fold(&[
                    "0", "dot", "4", "9", "9", "9", "sqrt", "sub", "2", "sqrt", "eq",
                ]),
                -r(15001, 10000).to_f64(),
                s04999 + s2,
                s04999 - s2,
                false,
            ),
        ];
        // 最初の 1 件で止めない——どの側が鳴ったかを全部印字する。
        let mut wrong: Vec<String> = Vec::new();
        for (label, shown, numerator, sum, plain, inside) in cases {
            let rewritten: f64 = numerator / sum;
            assert_ne!(
                rewritten.to_bits(),
                plain.to_bits(),
                "{label}: not a witness"
            );
            let want = if inside { rewritten } else { plain };
            if shown.to_bits() != want.to_bits() {
                wrong.push(format!("{label}: inside={inside}, shown {shown:e}"));
            }
        }
        assert_eq!(wrong, Vec::<String>::new());
    }

    #[test]
    fn a_rewritten_quotient_never_leaves_a_negative_zero() {
        // `cancel` の答えも、ほかの二項演算と同じく `finalize` を通す(−0.0 を +0.0 に)。
        // **キー列では作れない**: 分子は 0 でなければ |m/d| ≥ 1/d ≈ 6e-39(i128)、分母は
        // |A| + |B| ≲ 2.6e19(A² が i128 に収まる)なので、商は f64 の最小の正の数に届かない。
        // そこで値を印と食い違わせた `Held` を直接渡し、商を下に溢れさせる。
        // A² = 1(正)、B² = (1 + 10⁻¹⁸)²(負)、分子 ≈ −2e-18、分母 ≈ 1e308 → 商は −0.0。
        let a = Held {
            value: Value::real(1e308),
            exact: None,
            root: Some(Root {
                c: Rational::ONE,
                r: Rational::ONE,
                pi: 0,
            }),
        };
        let b = Held {
            value: Value::real(-1.0),
            exact: q(-1_000_000_000_000_000_001, 1_000_000_000_000_000_000, false),
            root: None,
        };
        let (value, _) = cancel(a, b, false).unwrap();
        assert_eq!(value.re.to_bits(), 0.0_f64.to_bits(), "{:e}", value.re);
    }

    #[test]
    fn a_root_crosses_serde_as_text_and_refuses_a_non_positive_radicand() {
        let text =
            r#"{"value":{"re":1.0,"im":0.0},"exact":null,"root":{"c":"2/4","r":"3/1","pi":3}}"#;
        let held: Held = serde_json::from_str(text).unwrap();
        let root = held.root.unwrap();
        assert_eq!(root.c, Rational::from_ratio(1, 2).unwrap());
        assert_eq!(root.r, Rational::from_ratio(3, 1).unwrap());
        let json = serde_json::to_string(&held).unwrap();
        assert!(
            json.contains(r#""root":{"c":"1/2","r":"3/1","pi":3}"#),
            "{json}"
        );
        let back: Held = serde_json::from_str(&json).unwrap();
        assert_eq!(back, held);
        // **`r > 0` でなければ拒む**(`RootWire`)。読めない文字列も拒む。
        for bad in ["0/1", "-2/1", "1/0", "a/2"] {
            let text = format!(
                r#"{{"value":{{"re":1.0,"im":0.0}},"exact":null,"root":{{"c":"1/1","r":"{bad}","pi":0}}}}"#
            );
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{bad}");
        }
        // **`pi` は必ず書き、−2〜4 でなければ拒む。**
        for bad in [r#""#, r#","pi":5"#, r#","pi":-3"#] {
            let text = format!(
                r#"{{"value":{{"re":1.0,"im":0.0}},"exact":null,"root":{{"c":"1/1","r":"2/1"{bad}}}}}"#
            );
            assert!(serde_json::from_str::<Held>(&text).is_err(), "{bad}");
        }
    }
}
