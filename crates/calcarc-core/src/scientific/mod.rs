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
///
/// **★ 度数法では、先に `% 360` で畳む**（2026-10-03。台帳
/// `docs/superpowers/sdd/2026-10-03-trig-large-args.md` §4）。
///
/// **順を変えただけで、答えは変わらない**——**`sin` と `cos` は実部について
/// 360° 周期**であり、**`%` は IEEE の `fmod` で厳密**だからである
/// （`turn_of` が `x % 360.0` で表の位置を決めているのと同じ理由）。
///
/// **変わるのは精度である。** **`x * (π/180)` を先に計算すると、`x` が大きいほど
/// 下の桁が落ちる**——**掛けた結果を f64 に入れる時点で、角度の情報が ulp の
/// 下に消える。** **実測（画面の 10 桁が真値と違う割合、各桁 300 件）**:
/// **先に掛ける順では 1e6 で 4 件・1e9 で 241 件・1e11 で実質全部**、
/// **先に畳む順では 1e15 まで 0 件**（1e16 以上でも 300 件中 2〜6 件）。
///
/// **虚部は畳めない。** **あちらは `cosh`・`sinh` に入り、周期を持たない**
/// ——`sin(x+iy) = sin x·cosh y + i·cos x·sinh y`。**畳むのは実部だけである。**
///
/// **RAD の f64 はここでは畳まない。** **変換が無いので落ちる桁も無く、実測で
/// 1e18 まで 10 桁一致する**（`f64::sin` 自身が引数を正しく縮約している）。
/// **RAD で畳むのは、π の有理数倍だと「分かっている」角だけ**で、それは印の
/// 剰余で畳む（`Turn::Folded`。1.2.3 設計書 §4.2）——f64 の `re` を畳むのではない。
fn to_rad(v: Value, mode: AngleMode) -> Value {
    let re = if mode == AngleMode::Deg {
        v.re % 360.0
    } else {
        v.re
    };
    Value::new(mode.radians_of(re), mode.radians_of(v.im))
}

/// 角の実部の**正体**（1.2.3 設計書 §4.1）。`sin x`・`cos x` をどこから取るか。
///
/// **`None` は「正体が分からない」**——今までどおり f64 の `re` の `sin`・`cos`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Turn {
    /// **表の 16 の位置**のどれか。**15° 単位の `0..24`**（RAD では π/12 単位）で、
    /// 載るのは 30° か 45° の倍数（`t % 2 == 0 || t % 3 == 0`）だけ。
    /// **15° は載らない**——sin 15° は表に無い（§4.1「`12r` が整数、では広すぎる」）。
    /// 作るのは `Turn::table` だけで、載らない位置は作らない。
    Table(u8),
    /// **表に載らない、π の有理数倍の角**。`r = q mod 2` を `(−1, 1]` に畳んでから
    /// `f64(r) × π`（ラジアン）。**巨大な倍数でも真の角から外れない**（§4.2）。
    Folded(f64),
}

impl Turn {
    /// 15° 単位の位置 `t`（`0..24` に畳む）。**表に載らなければ `None`**。
    pub fn table(t: i128) -> Option<Turn> {
        let t = t.rem_euclid(24);
        if t % 2 == 0 || t % 3 == 0 {
            u8::try_from(t).ok().map(Turn::Table)
        } else {
            None
        }
    }
}

/// 表の値 1 つ。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Entry {
    /// **厳密な f64 で持てる値**（0・±1/2・±1）。`(分子, 分母)`。
    /// engine はこれに k=0 の印を付ける（§3.3）。
    Exact(i8, i8),
    /// **√ を含む値**。正しく丸めた f64 定数で、印は付かない。
    Rounded(f64),
}

impl Entry {
    pub fn f64(self) -> f64 {
        match self {
            Entry::Exact(n, d) => f64::from(n) / f64::from(d),
            Entry::Rounded(x) => x,
        }
    }
}

/// 表の 1 行。`tan` が `None` なら極。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Row {
    pub sin: Entry,
    pub cos: Entry,
    pub tan: Option<Entry>,
}

// **√ の定数は、正しく丸めた f64 の literal**（1.2.3 設計書 §4.2。mpmath 50 桁を
// f64 に丸めて確かめた値。レビュー役の値と一致）。**計算で作らない**——`1.0 / 3f64.sqrt()`
// は丸めを 2 回通り、1 ulp 外れる（`0.5773502691896258`。単体テストが見る）。
const HALF_SQRT3: f64 = 0.866_025_403_784_438_6;
// 設計書の literal をそのまま書く。`std` の `FRAC_1_SQRT_2` と同値(単体テストが見る)。
#[allow(clippy::approx_constant)]
const HALF_SQRT2: f64 = 0.707_106_781_186_547_6;
const SQRT3: f64 = 1.732_050_807_568_877_2;
const INV_SQRT3: f64 = 0.577_350_269_189_625_7;

/// **表の 16 の位置**（1.2.3 設計書 §4.2）。`t` は 15° 単位。
///
/// **`tan` も表から返す**——**sin/cos の商にしない**（商は丸めを 2 回通る）。
/// **90°・270° の `tan` は極**（`None`）。
pub fn table_row(turn: u8) -> Option<Row> {
    use Entry::{Exact as E, Rounded as R};
    let row = |sin, cos, tan| Some(Row { sin, cos, tan });
    match turn {
        0 => row(E(0, 1), E(1, 1), Some(E(0, 1))),
        2 => row(E(1, 2), R(HALF_SQRT3), Some(R(INV_SQRT3))),
        3 => row(R(HALF_SQRT2), R(HALF_SQRT2), Some(E(1, 1))),
        4 => row(R(HALF_SQRT3), E(1, 2), Some(R(SQRT3))),
        6 => row(E(1, 1), E(0, 1), None),
        8 => row(R(HALF_SQRT3), E(-1, 2), Some(R(-SQRT3))),
        9 => row(R(HALF_SQRT2), R(-HALF_SQRT2), Some(E(-1, 1))),
        10 => row(E(1, 2), R(-HALF_SQRT3), Some(R(-INV_SQRT3))),
        12 => row(E(0, 1), E(-1, 1), Some(E(0, 1))),
        14 => row(E(-1, 2), R(-HALF_SQRT3), Some(R(INV_SQRT3))),
        15 => row(R(-HALF_SQRT2), R(-HALF_SQRT2), Some(E(1, 1))),
        16 => row(R(-HALF_SQRT3), E(-1, 2), Some(R(SQRT3))),
        18 => row(E(-1, 1), E(0, 1), None),
        20 => row(R(-HALF_SQRT3), E(1, 2), Some(R(-SQRT3))),
        21 => row(R(-HALF_SQRT2), R(HALF_SQRT2), Some(E(-1, 1))),
        22 => row(E(-1, 2), R(HALF_SQRT3), Some(R(-INV_SQRT3))),
        _ => None,
    }
}

/// **印の無い値**の角の正体。**度数法で、f64 そのものが 30° か 45° の倍数なら表**
/// （1.2.3 設計書 §4.1）。**RAD の f64 は表に載らない**。
///
/// **整数は f64 で厳密に持てる**ので、**利用者が打ったのは「30 度」そのもの**である
/// ——1.0.0 §3.1 の「入力が厳密なら、答えも厳密に」に入る。1.0.0 の `quadrant_exact`
/// （90 の倍数だけ）を広げたもの。
///
/// **`% 360` は IEEE の `fmod` で厳密**なので、**周回した角でも位置は正確に決まる**
/// （`540 % 360 = 180`、`(1e10 + 180) % 360 = 100`）。**`-360` は `-0.0` になるが、
/// 位置は `rem_euclid` で 0 に着く**——符号で分けない。
pub fn turn_of(v: Value, mode: AngleMode) -> Option<Turn> {
    if mode != AngleMode::Deg {
        return None;
    }
    let r = v.re % 360.0;
    if r.fract() != 0.0 || r % 15.0 != 0.0 {
        return None;
    }
    // `r` は `(−360, 360)` の 15 の倍数なので、`r / 15` は `(−24, 24)` の整数で厳密。
    let t = (r / 15.0) as i128;
    Turn::table(t)
}

/// `sin x` と `cos x`——**角の正体が分かれば表か畳んだ角から、無ければ f64 から**。
///
/// **1 つの経路である。** **実数は `im == 0` の特別な場合**で、
/// **別の分岐を持たない**（1.0.0 設計書 §3.2、裁定 (a)。1.2.3 設計書 §4.4）。
/// **実数だけ表を引くと、`im == 0` と `im == 1e-300` の間に段差が生まれる**
/// ——`sin(180° + 1e-300j)` の実部は `sin x · cosh y` で、
/// **`cosh(1.7e-302)` は `1.0`** だから**虚部を足しても実部は動かない。**
fn circular(z: Value, turn: Option<Turn>) -> (f64, f64) {
    match turn {
        Some(Turn::Table(t)) => match table_row(t) {
            Some(row) => (row.sin.f64(), row.cos.f64()),
            None => (z.re.sin(), z.re.cos()),
        },
        Some(Turn::Folded(x)) => (x.sin(), x.cos()),
        None => (z.re.sin(), z.re.cos()),
    }
}

/// `sin`。**角の正体は f64 の規則で決める**（`turn_of`）。印を知らない入口で、
/// golden（`golden.rs`）が呼ぶ。engine は印から決めた正体で `sin_at` を呼ぶ。
pub fn sin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    sin_at(v, mode, turn_of(v, mode))
}

/// `sin`。**角の実部の正体 `turn` を呼び出し側が渡す**（engine が印から決める。
/// 1.2.3 設計書 §4）。
pub fn sin_at(v: Value, mode: AngleMode, turn: Option<Turn>) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    let (sine, cosine) = circular(z, turn);
    Value::new(sine * z.im.cosh(), cosine * z.im.sinh()).finalize()
}

pub fn cos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    cos_at(v, mode, turn_of(v, mode))
}

/// `cos`。`sin_at` と同じく、正体は呼び出し側が渡す。
pub fn cos_at(v: Value, mode: AngleMode, turn: Option<Turn>) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    let (sine, cosine) = circular(z, turn);
    // `sine` が 0 の行では `-0.0 * sinh y` が `-0.0` になりうる。
    // **`finalize` が均す**ので値は在るべき所に来る（`without_negative_zero`）。
    Value::new(cosine * z.im.cosh(), -sine * z.im.sinh()).finalize()
}

/// tan。
///
/// Deg モードの実数引数については、極（90 + 180n 度）を先に検出する。
/// f64 の tan(PI/2) は無限大ではなく 1.633e16 という有限値を返すため、
/// Overflow の検査では捕まらない。
pub fn tan(v: Value, mode: AngleMode) -> CalcResult<Value> {
    if is_tan_pole(v, mode) {
        return Err(CalcError::TrigPole);
    }
    tan_at(v, mode, turn_of(v, mode))
}

/// tan。**実数の引数で角が表に載れば、表から返す**（1.2.3 設計書 §4.2——sin/cos の
/// 商にしない）。**表の極（90°・270°、RAD では π/2・3π/2）は `TrigPole`**（§4.3）。
///
/// **表と極を引くのは `im == 0` のときだけ**（§4.3、レビュー役の注記 2）。
/// DEG の `is_tan_pole` が実数の引数だけを極と見るのと同じで、`tan(π/2 + εj)` は
/// 有限の商を返す。**複素の引数は sin/cos の商**（その sin x・cos x は表から）。
pub fn tan_at(v: Value, mode: AngleMode, turn: Option<Turn>) -> CalcResult<Value> {
    if v.im == 0.0
        && let Some(Turn::Table(t)) = turn
        && let Some(row) = table_row(t)
    {
        return match row.tan {
            Some(entry) => Value::real(entry.f64()).finalize(),
            None => Err(CalcError::TrigPole),
        };
    }
    sin_at(v, mode, turn)?.checked_div(cos_at(v, mode, turn)?)
}

/// Deg モードの**実数**引数が tan の極（90 + 180n 度）に載っているか。
///
/// **複素数の引数は極として判定しない。**`tan(90 + εj)` は `TrigPole` に
/// ならず、`sin / cos` の商がそのまま返る（値は巨大だが有限である）。
///
/// **これは制約から出た形であって、見落としではない。** 極かどうかは
/// 下の `a % 180.0 == 90.0` という**実数の剰余**で決めている。複素数には
/// 剰余の意味が無いので、**実数であることを先に確かめないとこの式が書けない**。
/// 複素の極を見るなら別の判定（`cos(z)` の絶対値が 0 に近いか、など）が要り、
/// それは近さの閾値を決める話になる。
///
/// **★ 2026-10-03 に式を替えた。** **前は `a >= 90.0 && (a - 90.0) % 180.0 == 0.0`**
/// だった——**大きい `a` では `a - 90.0` が `a - 90` にならない。** **2 段ある**
/// （**実測。最初に書いた「境目は `90 × 2^53 ≈ 8.1e17`」は誤りで、
/// レビュー役が当て直した**）:
///
/// - **`2^54 ≈ 1.80e16` から、`a - 90.0` が厳密でなくなる**
///   ——**ulp が 4 以上で、90 は 4 の倍数でない**ので `a - 88` や `a - 92` に丸まる。
/// - **`2^60 ≈ 1.153e18` より上では、`a - 90.0` が `a` そのもの**になる
///   （**ulp が 256 で、90 がその半分より小さい**）。**そこで式は
///   `a % 180.0 == 0.0` に化け、「180 の倍数」＝`sin` が 0 になる角を極として弾く。**
///
/// **実測**: `1.161e18` は `sin = 0`・`cos = 1` なのに **`tan` が `Math ERROR`**
/// （盤面から 8 打鍵で届く。台帳
/// `docs/superpowers/sdd/2026-10-03-trig-large-args.md` §11）。
///
/// **`a % 180.0 == 90.0` は大きさで化けない。** **`%` は IEEE の `fmod` で
/// 厳密**であり、**`a` がどれだけ大きくても剰余はその角の剰余そのもの**である
/// （`turn_of` が `x % 360.0` で表の位置を決めているのと同じ理由）。
/// **引き算を剰余の外から中へ動かしただけで、述語の意味は変わらない**
/// ——**`a = 90 + 180n` ⟺ `a % 180 == 90`**。
/// **`a >= 90.0` の判定も要らなくなった**: `a < 90` では `a % 180 == a` なので、
/// **90 になるのは `a == 90` のときだけ**である。
///
/// **★ `2^54 ≈ 1.80e16` 以上に、本物の極は 1 つも存在しない**（だから失われる判定は
/// 1 つも無い）——**`2^54` 以上の f64 はすべて 4 の倍数**（仮数に掛かる 2 の冪が
/// 4 以上）だが、**極は `90 + 180n ≡ 2 (mod 4)`**（90 も 270 も 450 も 4 で割って
/// 2 余る）。**両立しない。** **実測でも、`2^54` 以上の 200,000 標本に
/// `a % 180 == 90` は 0 件**（4 の倍数でない標本も 0 件）。
/// **これはレビュー役が示した、私の最初の主張（「帯の中には無い」）より広い形である。**
///
/// `the_pole_guard_does_not_look_at_complex_arguments` と
/// `an_angle_that_is_not_a_pole_is_not_refused_however_large` が固定している。
fn is_tan_pole(v: Value, mode: AngleMode) -> bool {
    if !v.is_real() || mode != AngleMode::Deg {
        return false;
    }
    v.re.abs() % 180.0 == 90.0
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
    fn tangent_of_a_large_imaginary_part_is_not_a_false_overflow() {
        // **`tan` は `sin/cos`** なので、**複素除算の壊れ方をそのまま受け継ぐ**
        // （F7、0.9.4）。`cos(1 + 710.4j)` は `(9.0e307, -1.40e308)` で、
        // **大きいほうが `f64::MAX/2` を超える**——**引き金の形そのもの**である。
        //
        // **0.9.3 は `Err(Overflow)` を返していた**（実測 2026-09-18）。
        // **真の答えは `j` に限りなく近い**（虚部が大きい `tan` は `j` へ漸近する）。
        // **除算の直しがここまで届いていることを、呼び出し元の側から押さえる**
        // ——**`value.rs` の番人は `checked_div` を直接叩いており、
        // 「`tan` も直ったか」は別の主張**である。
        let q = tan(Value::new(1.0, 710.4), AngleMode::Rad).expect("有限の答えが在る");
        assert_eq!((q.re, q.im), (0.0, 1.0));
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
    fn degree_quadrant_angles_are_exact() {
        // **`180` は f64 で厳密に表せる**ので、**ずれを持ち込んでいるのは
        // `to_rad`** である（1.0.0 の設計書 §3）。**入力が厳密なら、答えも厳密に。**
        // **`close` ではなく `assert_eq!` で撃つ**——**主張は「近い」ではなく
        // 「厳密に 0・±1」**である。
        for (deg, s, c) in [
            (0.0, 0.0, 1.0),
            (90.0, 1.0, 0.0),
            (180.0, 0.0, -1.0),
            (270.0, -1.0, 0.0),
            (-90.0, -1.0, 0.0),
            (-180.0, 0.0, -1.0),
            (-270.0, 1.0, 0.0),
            // **周回した角も同じ**（`% 360` は IEEE の `fmod` で厳密）。
            (360.0, 0.0, 1.0),
            (540.0, 0.0, -1.0),
            (-360.0, 0.0, 1.0),
            (810.0, 1.0, 0.0),
        ] {
            let sine = sin(Value::real(deg), AngleMode::Deg).expect("有限");
            let cosine = cos(Value::real(deg), AngleMode::Deg).expect("有限");
            assert_eq!((sine.re, sine.im), (s, 0.0), "sin({deg}°)");
            assert_eq!((cosine.re, cosine.im), (c, 0.0), "cos({deg}°)");
        }
        // `tan` も表から(1.2.3 設計書 §4.2)。0°・180° では 0。
        assert_eq!(
            tan(Value::real(180.0), AngleMode::Deg).expect("有限").re,
            0.0
        );
        assert_eq!(
            tan(Value::real(360.0), AngleMode::Deg).expect("有限").re,
            0.0
        );
    }

    #[test]
    fn the_quadrant_table_reaches_the_complex_formula() {
        // **表は複素の公式の `sin x`・`cos x` に入る**（設計書 §3.2、裁定 (a)）。
        // **実数だけ表を引くと、`im == 0` と `im == 1e-300` の間に段差が生まれる**
        // ——**直す前の実測**: `sin(180 + 1e-300j)` の実部は
        // `1.2246467991473532e-16` で、**虚部を足しても動かなかった**
        // （真値は `4.1e-43` の側）。
        // **この 1 本が、この段差の唯一の番人である**——**コーパスには永久に出ない**
        // （検証役の実測、`92adf99`: **複素の三角は 95 件で全部 DEG、引数に `j` を
        // 含む 59 か所は全部純虚数**。**`a + jb` の形は 0 件**で、**その 0 は
        // 「試したが該当なし」ではなく「生成器がその形を作っていない」**。
        // **同じ正規表現で実数側は 3,962 件・90 の倍数 19 件を拾えている**ので、
        // 当て方が空振りだったのではない）。
        let s = sin(Value::new(180.0, 1e-300), AngleMode::Deg).expect("有限");
        assert_eq!(s.re, 0.0, "sin(180° + 1e-300j) の実部");
        // **負の角も**。**表の 0 に `r` の符号が掛かって `-0.0` になりうる**ので、
        // **`0.0` と比べる**（**ビット比較にはしない**。`-0.0 == 0.0` は真、
        // そして `finalize` が均す）。
        let n = sin(Value::new(-180.0, 1e-300), AngleMode::Deg).expect("有限");
        assert_eq!(n.re, 0.0, "sin(-180° + 1e-300j) の実部");
        // **極のすぐ近く**。**実部は `cos(90°)` の `6.12e-17` が作っていた幻**で、
        // 表を引けば消える。**虚部は残る**（極に近いことは変わらない）。
        let t = tan(Value::new(90.0, 1e-8), AngleMode::Deg).expect("有限");
        assert_eq!(t.re, 0.0, "tan(90° + 1e-8j) の実部");
        close(t.im, 1.0 / 1e-8_f64.to_radians().sinh());
    }

    #[test]
    fn complex_arguments_on_the_imaginary_axis_do_not_move() {
        // **0.9.8 のマニュアルに出ている 3 つの値**（`1.175201194j`・
        // `1.543080635`・`0.761594156j`）**を守る床**である。
        // **`x = 0` は表でも `sin 0 = 0`・`cos 0 = 1`** で、
        // **f64 の `sin`/`cos` の答えと同じ**——だから動かない。
        let s = sin(Value::imag(1.0), AngleMode::Rad).expect("有限");
        assert_eq!((s.re, s.im), (0.0, 1.175_201_193_643_801_4));
        let c = cos(Value::imag(1.0), AngleMode::Rad).expect("有限");
        assert_eq!((c.re, c.im), (1.543_080_634_815_243_7, 0.0));
        let t = tan(Value::imag(1.0), AngleMode::Rad).expect("有限");
        assert_eq!((t.re, t.im), (0.0, 0.761_594_155_955_764_9));
    }

    #[test]
    fn an_unmarked_radian_f64_keeps_its_own_answer() {
        // **印の無い RAD の f64 は表を引かない**（1.2.3 設計書 §4.1、§7.2）。
        // **RAD に表を広げるのは、入力が π の有理数倍だと「分かっている」ときだけ**
        // ——π キーから四則だけで作った値（印が k=1）で、それは engine が印から
        // `Turn` を作って `sin_at` に渡す。**この入口（`sin`）は印を知らない**ので、
        // `f64` の π は π ではなく、その `sin` は厳密に `1.2246467991473532e-16`
        // である（打った `3.1415926535` も同じ理由で π ではない）。
        // **1.0.0 の線引き「入力が厳密なら、答えも厳密に」は変えていない。**
        assert_eq!(
            sin(Value::real(PI), AngleMode::Rad).expect("有限").re,
            1.224_646_799_147_353_2e-16
        );
        assert_eq!(
            cos(Value::real(PI / 2.0), AngleMode::Rad).expect("有限").re,
            6.123_233_995_736_766e-17
        );
        // **★ 上の 2 行だけでは、`turn_of` を RAD に広げても赤くならない**
        // （2026-09-29、実行役が変異させて確かめた——**`π` は 30 の倍数ではない**ので、
        // 広げても表が発火しない）。**RAD で「数として 30・45 の倍数」を撃つ**のが番人:
        // **`180` ラジアンは `-0.8011526357338304`**、**`90` ラジアンの `cos` は
        // `-0.4480736161291701`**、**`30` ラジアンは `-0.9880316240928618`**。
        assert_eq!(
            sin(Value::real(180.0), AngleMode::Rad).expect("有限").re,
            -0.801_152_635_733_830_4
        );
        assert_eq!(
            cos(Value::real(90.0), AngleMode::Rad).expect("有限").re,
            -0.448_073_616_129_170_1
        );
        assert_eq!(
            sin(Value::real(30.0), AngleMode::Rad).expect("有限").re,
            -0.988_031_624_092_861_8
        );
    }

    #[test]
    fn the_root_constants_are_the_rounded_values() {
        // **設計書 §4.2 の literal**。1 回の丸めで作れるものは計算と一致する
        // (√ は正しく丸め、÷ 2 は厳密)。
        assert_eq!(HALF_SQRT2, std::f64::consts::FRAC_1_SQRT_2);
        assert_eq!(3_f64.sqrt(), SQRT3);
        assert_eq!(3_f64.sqrt() / 2.0, HALF_SQRT3);
        assert_eq!((1.0_f64 / 3.0).sqrt(), INV_SQRT3);
        // **`1 / √3` を商で作ると丸めを 2 回通り、1 ulp 外れる**(`0.5773502691896258`)
        // ——だから literal で持つ。
        assert_ne!(1.0 / 3_f64.sqrt(), INV_SQRT3);
    }

    #[test]
    fn degree_thirty_and_forty_five_come_from_the_table() {
        // **`assert_eq!` で撃つ**——主張は「近い」ではなく「表の値そのもの」。
        // 直す前の `30 sin` は `0.49999999999999994`。
        for (deg, s, c) in [
            (30.0, 0.5, HALF_SQRT3),
            (45.0, HALF_SQRT2, HALF_SQRT2),
            (60.0, HALF_SQRT3, 0.5),
            (120.0, HALF_SQRT3, -0.5),
            (135.0, HALF_SQRT2, -HALF_SQRT2),
            (150.0, 0.5, -HALF_SQRT3),
            (210.0, -0.5, -HALF_SQRT3),
            (225.0, -HALF_SQRT2, -HALF_SQRT2),
            (240.0, -HALF_SQRT3, -0.5),
            (300.0, -HALF_SQRT3, 0.5),
            (315.0, -HALF_SQRT2, HALF_SQRT2),
            (330.0, -0.5, HALF_SQRT3),
            (-30.0, -0.5, HALF_SQRT3),
            (390.0, 0.5, HALF_SQRT3),
        ] {
            let sine = sin(Value::real(deg), AngleMode::Deg).expect("有限");
            let cosine = cos(Value::real(deg), AngleMode::Deg).expect("有限");
            assert_eq!((sine.re, sine.im), (s, 0.0), "sin({deg}°)");
            assert_eq!((cosine.re, cosine.im), (c, 0.0), "cos({deg}°)");
        }
        // **tan も表から**(商にしない)。
        for (deg, t) in [
            (30.0, INV_SQRT3),
            (45.0, 1.0),
            (60.0, SQRT3),
            (120.0, -SQRT3),
            (135.0, -1.0),
            (150.0, -INV_SQRT3),
            (225.0, 1.0),
            (-45.0, -1.0),
        ] {
            assert_eq!(
                tan(Value::real(deg), AngleMode::Deg).expect("有限").re,
                t,
                "tan({deg}°)"
            );
        }
        // **15° は表に無い**(§4.1)。
        assert_eq!(turn_of(Value::real(15.0), AngleMode::Deg), None);
        assert_eq!(turn_of(Value::real(30.5), AngleMode::Deg), None);
    }

    #[test]
    fn the_table_has_sixteen_positions() {
        let positions: Vec<u8> = (0..24)
            .filter_map(|t| match Turn::table(t) {
                Some(Turn::Table(p)) => Some(p),
                _ => None,
            })
            .collect();
        assert_eq!(
            positions,
            vec![0, 2, 3, 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22]
        );
        for p in positions {
            let row = table_row(p).expect("載る位置には行が在る");
            // sin² + cos² = 1 の、表の上での確かめ(丸めた定数どうしなので近さで見る)。
            close(row.sin.f64().powi(2) + row.cos.f64().powi(2), 1.0);
            if let Some(t) = row.tan {
                close(t.f64() * row.cos.f64(), row.sin.f64());
            } else {
                assert_eq!(row.cos, Entry::Exact(0, 1), "極は cos が 0 の位置だけ");
            }
        }
        // 負の位置も畳む。
        assert_eq!(Turn::table(-6), Some(Turn::Table(18)));
        assert_eq!(Turn::table(1), None);
    }

    #[test]
    fn the_table_and_the_pole_guard_agree() {
        // **同じ条件が 2 か所に在る**（表と `is_tan_pole`）。**片方だけ直した日に
        // 赤くなる番人**である（レビュー役 calcarc-1e の注記）。
        // **表の極（`tan` が `None`）** ⇔ **`is_tan_pole`**。
        //
        // **刻みは `i as f64 * 0.5` で作る**——`x += 0.5` の累算だと
        // **格子そのものがずれる**（`retry-biases-the-sample` の族）。
        let mut compared = 0_usize;
        let mut poles = 0_usize;
        for i in -720..=720 {
            let x = f64::from(i) * 0.5;
            let from_table = match turn_of(Value::real(x), AngleMode::Deg) {
                Some(Turn::Table(t)) => table_row(t).is_some_and(|row| row.tan.is_none()),
                _ => false,
            };
            let from_guard = is_tan_pole(Value::real(x), AngleMode::Deg);
            assert_eq!(from_table, from_guard, "{x}° で表と極の判定が食い違う");
            compared += 1;
            if from_guard {
                poles += 1;
            }
        }
        // **比較の回数を数える**——**1 度も比較しない格子を作らないため**
        // （`tests-can-assert-nothing`）。
        assert_eq!(compared, 1441);
        // **−360〜360 の極は ±90・±270 の 4 点。**
        assert_eq!(poles, 4);
    }

    #[test]
    fn a_folded_turn_is_used_as_the_real_angle() {
        // **`Turn::Folded` は実部の角そのもの**(ラジアン)。f64 の `re` は読まない。
        let x = 0.4 * PI;
        let s = sin_at(Value::real(1e300), AngleMode::Rad, Some(Turn::Folded(x))).expect("有限");
        assert_eq!(s.re, x.sin());
    }

    #[test]
    fn a_table_pole_needs_a_real_argument() {
        // **レビュー役の注記 2**: 極は `im == 0` に限る。複素は有限の商。
        let pole = Some(Turn::Table(6));
        assert_eq!(
            tan_at(Value::real(PI / 2.0), AngleMode::Rad, pole),
            Err(CalcError::TrigPole)
        );
        assert!(tan_at(Value::new(PI / 2.0, 1e-8), AngleMode::Rad, pole).is_ok());
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

    #[test]
    fn the_pole_guard_does_not_look_at_complex_arguments() {
        // **極の検出は実数引数にしか掛からない**(`is_tan_pole`)。
        // 実部がちょうど 90° でも、虚部を持つ値は `TrigPole` にならず、
        // `sin / cos` の商がそのまま返る。
        //
        // **これは見落としではなく、比較の形から出た制約である**——
        // 極かどうかは `a >= 90.0 && (a - 90.0) % 180.0 == 0.0` という
        // **実数の順序と剰余**で判定している。複素数には順序が無いので、
        // 実数であることを先に確かめないとこの式が書けない。
        let z = Value::new(90.0, 1e-8);
        let r = tan(z, AngleMode::Deg);
        assert!(r.is_ok(), "複素数の引数は極判定を通らない: {r:?}");

        // 対になる実数はエラーになる。**同じ実部で結果が分かれる**ことを、
        // 片方だけ見て「極を見ている」と読まないために並べて置く。
        assert_eq!(
            tan(Value::real(90.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
    }

    /// **虚部は畳まない**（2026-10-03。`to_rad` の註の規律に対応する番人）。
    ///
    /// **`sin(x+iy) = sin x·cosh y + i·cos x·sinh y`** であり、
    /// **`cosh`・`sinh` は周期を持たない**——**実部を `% 360` で畳むのと同じことを
    /// 虚部にすると、まったく別の数になる。**
    ///
    /// **実測（2026-10-03、mpmath 50 桁）**:
    /// **`sin(0 + 400j°)` の虚部は `sinh(400°) = 538.1670233`**、
    /// **畳むと `sinh(40°) = 0.7562402`**——**700 倍以上違う。**
    /// **`720j` なら `143375.66` が `0`**（720 % 360 = 0）になる。
    ///
    /// **盤面から届く**: `4 0 0 j sin` で `538.1670233j` が出る
    /// （`engine_table.rs` の
    /// `the_imaginary_part_is_not_folded_by_the_degree_reduction` が画面を撃つ）。
    #[test]
    fn the_imaginary_part_is_never_folded() {
        // **`sinh` の引数は畳まれていない** ——`400°` のままである。
        let got = sin(Value::new(0.0, 400.0), AngleMode::Deg).expect("有限");
        close(got.im, (400.0_f64.to_radians()).sinh());
        // **畳んだ値ではない**（それが入ったら上の `assert_close` が落ちるが、
        // **何と間違えたのかを名指しで言う**ために、こちらも撃つ）。
        assert!(
            (got.im - (40.0_f64.to_radians()).sinh()).abs() > 1.0,
            "虚部が 360 で畳まれている: {} （畳まない値は {}）",
            got.im,
            (400.0_f64.to_radians()).sinh()
        );
        // **`cos` も同じ**——あちらは実部に `cosh` が掛かる。
        let c = cos(Value::new(0.0, 400.0), AngleMode::Deg).expect("有限");
        close(c.re, (400.0_f64.to_radians()).cosh());
    }
}
