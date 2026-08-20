//! 単位換算の計算コア(U-1 設計書 §3)。
//!
//! **すべての単位はアフィン変換 1 本で表す**(§3.1):
//!
//! ```text
//! base  = value × factor + offset
//! value = (base − offset) ÷ factor
//! ```
//!
//! **換算は必ず基準単位を経由する**(§0.0-5)。N 個の単位に N × N の式を持たない
//! ——直接の係数を 1 つでも書くと、表と式の 2 か所が真実になる。
//! **この約束は数で守れない**(値が合っていればテストは緑になる)。**レビューで守る**(§6 の赤確認 5)。
//!
//! **係数はすべて定義値である**(§3.2)。出典は国際ヤード・ポンド協定(1959)と SI。
//! f64 を一度も経由しない——`Rational` は i128 有界の既約分数である。
//!
//! **温度は「点」である**(§3.4)。温度差の換算はしない。

pub mod currency;
pub mod format;

use crate::expr::rational::Rational;
use crate::expr::{UnitSet, evaluate_to_rational};
use crate::{CalcError, CalcResult};

/// 換算のカテゴリ。**カテゴリをまたぐ換算は無い**(§3.1)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Length,
    Mass,
    Temperature,
    Area,
    Volume,
    Speed,
    DataSize,
}

/// 単位。**並びは契約である**——境界の一覧と golden がこの順で並ぶ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    // Length(基準: メートル)
    Nm,
    Um,
    Mm,
    Cm,
    M,
    Km,
    In,
    Ft,
    Yd,
    Mi,
    Nmi,
    // Mass(基準: キログラム)
    Mg,
    G,
    Kg,
    T,
    Lb,
    Oz,
    St,
    // Temperature(基準: ケルビン)
    Kelvin,
    DegC,
    DegF,
    // Area(基準: 平方メートル)
    Mm2,
    Cm2,
    M2,
    Km2,
    Ha,
    In2,
    Ft2,
    Yd2,
    Ac,
    Tsubo,
    Jo,
    // Volume(基準: リットル)
    Ml,
    Cl,
    Dl,
    L,
    M3,
    GalUs,
    GalImp,
    FlozUs,
    FlozImp,
    PtUs,
    PtImp,
    QtUs,
    QtImp,
    CupUs,
    CupJp,
    // Speed(基準: メートル毎秒)
    Mps,
    Kmh,
    Mph,
    Kn,
    // Data Size(基準: バイト)
    Bit,
    Byte,
    Kb,
    Mb,
    Gb,
    Tb,
    Pb,
    Kib,
    Mib,
    Gib,
    Tib,
    Pib,
}

/// カテゴリごとの単位の数(§3.2 の表の行数)。**`ALL` の並びを切る位置でもある。**
const LENGTH_COUNT: usize = 11;
const MASS_COUNT: usize = 7;
const TEMPERATURE_COUNT: usize = 3;
const AREA_COUNT: usize = 11;
const VOLUME_COUNT: usize = 15;
const SPEED_COUNT: usize = 4;
const DATA_SIZE_COUNT: usize = 12;

/// `Category::units()` が切り出す位置。**和が `Unit::ALL` の長さと合わなければ型で落ちる。**
const AREA_START: usize = LENGTH_COUNT + MASS_COUNT + TEMPERATURE_COUNT;
const VOLUME_START: usize = AREA_START + AREA_COUNT;
const SPEED_START: usize = VOLUME_START + VOLUME_COUNT;
const DATA_SIZE_START: usize = SPEED_START + SPEED_COUNT;

/// `Category::units()` が返す部分スライスの実体。
///
/// **並びの真実を 1 か所に留めるため `ALL` から作る**——カテゴリごとに別の配列を
/// 書くと、単位を足したときに片方だけ直る。
static UNITS: [Unit; DATA_SIZE_START + DATA_SIZE_COUNT] = Unit::ALL;

impl Unit {
    /// 境界(WASM / JS)とテストが参照する全体。**上の並びのまま。**
    pub const ALL: [Unit; 63] = [
        Unit::Nm,
        Unit::Um,
        Unit::Mm,
        Unit::Cm,
        Unit::M,
        Unit::Km,
        Unit::In,
        Unit::Ft,
        Unit::Yd,
        Unit::Mi,
        Unit::Nmi,
        Unit::Mg,
        Unit::G,
        Unit::Kg,
        Unit::T,
        Unit::Lb,
        Unit::Oz,
        Unit::St,
        Unit::Kelvin,
        Unit::DegC,
        Unit::DegF,
        Unit::Mm2,
        Unit::Cm2,
        Unit::M2,
        Unit::Km2,
        Unit::Ha,
        Unit::In2,
        Unit::Ft2,
        Unit::Yd2,
        Unit::Ac,
        Unit::Tsubo,
        Unit::Jo,
        Unit::Ml,
        Unit::Cl,
        Unit::Dl,
        Unit::L,
        Unit::M3,
        Unit::GalUs,
        Unit::GalImp,
        Unit::FlozUs,
        Unit::FlozImp,
        Unit::PtUs,
        Unit::PtImp,
        Unit::QtUs,
        Unit::QtImp,
        Unit::CupUs,
        Unit::CupJp,
        Unit::Mps,
        Unit::Kmh,
        Unit::Mph,
        Unit::Kn,
        Unit::Bit,
        Unit::Byte,
        Unit::Kb,
        Unit::Mb,
        Unit::Gb,
        Unit::Tb,
        Unit::Pb,
        Unit::Kib,
        Unit::Mib,
        Unit::Gib,
        Unit::Tib,
        Unit::Pib,
    ];

    /// 境界(WASM / JS)へ渡す文字列トークン。**ASCII の小文字に倒す**(計画の裁定 1)。
    pub fn token(self) -> &'static str {
        match self {
            Unit::Nm => "nm",
            // **µ は使わない**(U+00B5 と U+03BC の 2 通りがあり、同じに見えて
            // 一致しない。計画の裁定 1)。記号はラベルが持つ。
            Unit::Um => "um",
            Unit::Mm => "mm",
            Unit::Cm => "cm",
            Unit::M => "m",
            Unit::Km => "km",
            Unit::In => "in",
            Unit::Ft => "ft",
            Unit::Yd => "yd",
            Unit::Mi => "mi",
            Unit::Nmi => "nmi",
            Unit::Mg => "mg",
            Unit::G => "g",
            Unit::Kg => "kg",
            Unit::T => "t",
            Unit::Lb => "lb",
            Unit::Oz => "oz",
            Unit::St => "st",
            Unit::Kelvin => "k",
            Unit::DegC => "degc",
            Unit::DegF => "degf",
            Unit::Mm2 => "mm2",
            Unit::Cm2 => "cm2",
            Unit::M2 => "m2",
            Unit::Km2 => "km2",
            Unit::Ha => "ha",
            Unit::In2 => "in2",
            Unit::Ft2 => "ft2",
            Unit::Yd2 => "yd2",
            Unit::Ac => "ac",
            // **記号はラベルが持つ**(計画の裁定 1)。坪と畳も ASCII に倒す。
            Unit::Tsubo => "tsubo",
            Unit::Jo => "jo",
            Unit::Ml => "ml",
            Unit::Cl => "cl",
            Unit::Dl => "dl",
            Unit::L => "l",
            Unit::M3 => "m3",
            // **系はトークンに書く**(§0.0-3)。`gal` という裸の名前は使わない。
            Unit::GalUs => "gal_us",
            Unit::GalImp => "gal_imp",
            Unit::FlozUs => "floz_us",
            Unit::FlozImp => "floz_imp",
            Unit::PtUs => "pt_us",
            Unit::PtImp => "pt_imp",
            Unit::QtUs => "qt_us",
            Unit::QtImp => "qt_imp",
            Unit::CupUs => "cup_us",
            Unit::CupJp => "cup_jp",
            Unit::Mps => "mps",
            Unit::Kmh => "kmh",
            Unit::Mph => "mph",
            Unit::Kn => "kn",
            Unit::Bit => "bit",
            Unit::Byte => "byte",
            Unit::Kb => "kb",
            Unit::Mb => "mb",
            Unit::Gb => "gb",
            Unit::Tb => "tb",
            Unit::Pb => "pb",
            Unit::Kib => "kib",
            Unit::Mib => "mib",
            Unit::Gib => "gib",
            Unit::Tib => "tib",
            Unit::Pib => "pib",
        }
    }

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Unit> {
        Unit::ALL.into_iter().find(|unit| unit.token() == token)
    }

    /// この単位が属するカテゴリ。**`Category::units()` の逆写像である。**
    pub fn category(self) -> Category {
        match self {
            Unit::Nm
            | Unit::Um
            | Unit::Mm
            | Unit::Cm
            | Unit::M
            | Unit::Km
            | Unit::In
            | Unit::Ft
            | Unit::Yd
            | Unit::Mi
            | Unit::Nmi => Category::Length,
            Unit::Mg | Unit::G | Unit::Kg | Unit::T | Unit::Lb | Unit::Oz | Unit::St => {
                Category::Mass
            }
            Unit::Kelvin | Unit::DegC | Unit::DegF => Category::Temperature,
            Unit::Mm2
            | Unit::Cm2
            | Unit::M2
            | Unit::Km2
            | Unit::Ha
            | Unit::In2
            | Unit::Ft2
            | Unit::Yd2
            | Unit::Ac
            | Unit::Tsubo
            | Unit::Jo => Category::Area,
            Unit::Ml
            | Unit::Cl
            | Unit::Dl
            | Unit::L
            | Unit::M3
            | Unit::GalUs
            | Unit::GalImp
            | Unit::FlozUs
            | Unit::FlozImp
            | Unit::PtUs
            | Unit::PtImp
            | Unit::QtUs
            | Unit::QtImp
            | Unit::CupUs
            | Unit::CupJp => Category::Volume,
            Unit::Mps | Unit::Kmh | Unit::Mph | Unit::Kn => Category::Speed,
            Unit::Bit
            | Unit::Byte
            | Unit::Kb
            | Unit::Mb
            | Unit::Gb
            | Unit::Tb
            | Unit::Pb
            | Unit::Kib
            | Unit::Mib
            | Unit::Gib
            | Unit::Tib
            | Unit::Pib => Category::DataSize,
        }
    }

    /// `(factor, offset)`。**spec §3.2 の表の値をそのまま持つ。**
    ///
    /// 掛け算で導ける行も式で書かない——表が「何が定義値か」を語らなくなる。
    /// 導出は註に置く。
    fn affine(self) -> CalcResult<(Rational, Rational)> {
        let zero = Rational::from_i128(0)?;
        Ok(match self {
            // Length(基準: メートル)
            Unit::Nm => (Rational::from_ratio(1, 1_000_000_000)?, zero),
            Unit::Um => (Rational::from_ratio(1, 1_000_000)?, zero),
            Unit::Mm => (Rational::from_ratio(1, 1_000)?, zero),
            Unit::Cm => (Rational::from_ratio(1, 100)?, zero),
            Unit::M => (Rational::from_i128(1)?, zero),
            Unit::Km => (Rational::from_i128(1_000)?, zero),
            Unit::In => (Rational::from_ratio(127, 5000)?, zero), // ちょうど 25.4 mm(1959)
            Unit::Ft => (Rational::from_ratio(381, 1250)?, zero), // 12 × in。ちょうど 0.3048 m
            Unit::Yd => (Rational::from_ratio(1143, 1250)?, zero), // 3 × ft。ちょうど 0.9144 m
            Unit::Mi => (Rational::from_ratio(201168, 125)?, zero), // 1760 × yd。ちょうど 1609.344 m
            Unit::Nmi => (Rational::from_i128(1852)?, zero),        // 海里。ちょうど 1852 m
            // Mass(基準: キログラム)
            Unit::Mg => (Rational::from_ratio(1, 1_000_000)?, zero),
            Unit::G => (Rational::from_ratio(1, 1_000)?, zero),
            Unit::Kg => (Rational::from_i128(1)?, zero),
            Unit::T => (Rational::from_i128(1_000)?, zero), // メートルトン
            // ちょうど 0.45359237 kg(1959)
            Unit::Lb => (Rational::from_ratio(45_359_237, 100_000_000)?, zero),
            // lb / 16。常衡オンス
            Unit::Oz => (Rational::from_ratio(45_359_237, 1_600_000_000)?, zero),
            // 14 × lb。ストーン
            Unit::St => (Rational::from_ratio(635_029_318, 100_000_000)?, zero),
            // Temperature(基準: ケルビン)。**温度だけが offset を使う**(§3.1)。
            Unit::Kelvin => (Rational::from_i128(1)?, zero),
            // 5463/20 = 273.15
            Unit::DegC => (Rational::from_i128(1)?, Rational::from_ratio(5463, 20)?),
            // K = (F + 459.67) × 5/9。45967/180 = 459.67 × 5/9
            Unit::DegF => (
                Rational::from_ratio(5, 9)?,
                Rational::from_ratio(45967, 180)?,
            ),
            // Area(基準: 平方メートル)。spec §3.1
            Unit::Mm2 => (Rational::from_ratio(1, 1_000_000)?, zero),
            Unit::Cm2 => (Rational::from_ratio(1, 10_000)?, zero),
            Unit::M2 => (Rational::from_i128(1)?, zero),
            Unit::Km2 => (Rational::from_i128(1_000_000)?, zero),
            Unit::Ha => (Rational::from_i128(10_000)?, zero), // ヘクタール。1 辺 100 m
            // (127/5000)²。国際インチの 2 乗。ちょうど 0.00064516 m²
            Unit::In2 => (Rational::from_ratio(16_129, 25_000_000)?, zero),
            // 144 × in²。ちょうど 0.09290304 m²
            Unit::Ft2 => (Rational::from_ratio(145_161, 1_562_500)?, zero),
            // 9 × ft²。ちょうど 0.83612736 m²
            Unit::Yd2 => (Rational::from_ratio(1_306_449, 1_562_500)?, zero),
            // 4840 × yd²。ちょうど 4046.8564224 m²(**11 桁。表示は 10 桁までしか出さない**)
            Unit::Ac => (Rational::from_ratio(316_160_658, 78_125)?, zero),
            // 1 尺 = 10/33 m、1 坪 = 6 尺 × 6 尺 = (60/33)² = 400/121
            Unit::Tsubo => (Rational::from_ratio(400, 121)?, zero),
            // ちょうど 1.62 m²。**坪/2 ではない**(spec §3.3)。
            // 出典は表示規約施行規則 第 9 条第 16 号(spec §3.2)——広告表示の下限であって実寸ではない。
            Unit::Jo => (Rational::from_ratio(81, 50)?, zero),
            // Volume(基準: リットル)。spec §3.4
            Unit::Ml => (Rational::from_ratio(1, 1_000)?, zero),
            Unit::Cl => (Rational::from_ratio(1, 100)?, zero),
            Unit::Dl => (Rational::from_ratio(1, 10)?, zero),
            Unit::L => (Rational::from_i128(1)?, zero),
            Unit::M3 => (Rational::from_i128(1_000)?, zero),
            // 231 × in³。in³ は m³ なので L に直すのに 1000 倍が要る。ちょうど 3.785411784 L
            Unit::GalUs => (Rational::from_ratio(473_176_473, 125_000_000)?, zero),
            // ちょうど 4.54609 L(1985)。**US とは別物である。**
            Unit::GalImp => (Rational::from_ratio(454_609, 100_000)?, zero),
            // gal(US)/128。29.5735295625 mL
            Unit::FlozUs => (Rational::from_ratio(473_176_473, 16_000_000_000)?, zero),
            // gal(Imp)/160。28.4130625 mL
            Unit::FlozImp => (Rational::from_ratio(454_609, 16_000_000)?, zero),
            // 16 × fl oz(US)。473.176473 mL
            Unit::PtUs => (Rational::from_ratio(473_176_473, 1_000_000_000)?, zero),
            // 20 × fl oz(Imp)。568.26125 mL。**Imperial のパイントは 20 オンスである。**
            Unit::PtImp => (Rational::from_ratio(454_609, 800_000)?, zero),
            // 32 × fl oz(US)。946.352946 mL
            Unit::QtUs => (Rational::from_ratio(473_176_473, 500_000_000)?, zero),
            // 40 × fl oz(Imp)。1136.5225 mL
            Unit::QtImp => (Rational::from_ratio(454_609, 400_000)?, zero),
            // 8 × fl oz(US)。236.5882365 mL
            Unit::CupUs => (Rational::from_ratio(473_176_473, 2_000_000_000)?, zero),
            // 日本の計量カップ。ちょうど 200 mL。**cup(US) とは別物である。**
            Unit::CupJp => (Rational::from_ratio(1, 5)?, zero),
            // Speed(基準: メートル毎秒)。spec §3.5
            Unit::Mps => (Rational::from_i128(1)?, zero),
            Unit::Kmh => (Rational::from_ratio(5, 18)?, zero), // 1000/3600
            // mi/3600 = (201168/125)/3600。ちょうど 0.44704 m/s
            Unit::Mph => (Rational::from_ratio(1_397, 3_125)?, zero),
            Unit::Kn => (Rational::from_ratio(463, 900)?, zero), // 1852/3600。海里毎時
            // Data Size(基準: バイト)。spec §3.6。**SI と IEC を混ぜない。**
            Unit::Bit => (Rational::from_ratio(1, 8)?, zero), // **1/8 である。8 ではない**
            Unit::Byte => (Rational::from_i128(1)?, zero),
            Unit::Kb => (Rational::from_i128(1_000)?, zero),
            Unit::Mb => (Rational::from_i128(1_000_000)?, zero),
            Unit::Gb => (Rational::from_i128(1_000_000_000)?, zero),
            Unit::Tb => (Rational::from_i128(1_000_000_000_000)?, zero),
            Unit::Pb => (Rational::from_i128(1_000_000_000_000_000)?, zero),
            Unit::Kib => (Rational::from_i128(1_024)?, zero), // 2^10
            Unit::Mib => (Rational::from_i128(1_048_576)?, zero), // 2^20
            Unit::Gib => (Rational::from_i128(1_073_741_824)?, zero), // 2^30
            Unit::Tib => (Rational::from_i128(1_099_511_627_776)?, zero), // 2^40
            Unit::Pib => (Rational::from_i128(1_125_899_906_842_624)?, zero), // 2^50
        })
    }
}

impl Category {
    /// 境界とテストが参照する全体。
    pub const ALL: [Category; 7] = [
        Category::Length,
        Category::Mass,
        Category::Temperature,
        Category::Area,
        Category::Volume,
        Category::Speed,
        Category::DataSize,
    ];

    /// 境界へ渡す文字列トークン。
    pub fn token(self) -> &'static str {
        match self {
            Category::Length => "length",
            Category::Mass => "mass",
            Category::Temperature => "temperature",
            Category::Area => "area",
            Category::Volume => "volume",
            Category::Speed => "speed",
            // **ハイフンである**(route の `#convert/data-size` と同じ綴り)。
            Category::DataSize => "data-size",
        }
    }

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Category> {
        Category::ALL
            .into_iter()
            .find(|category| category.token() == token)
    }

    /// このカテゴリの単位を、**盤面に出す並びのまま**返す。
    pub fn units(self) -> &'static [Unit] {
        match self {
            Category::Length => &UNITS[..LENGTH_COUNT],
            Category::Mass => &UNITS[LENGTH_COUNT..LENGTH_COUNT + MASS_COUNT],
            Category::Temperature => &UNITS[LENGTH_COUNT + MASS_COUNT..AREA_START],
            Category::Area => &UNITS[AREA_START..VOLUME_START],
            Category::Volume => &UNITS[VOLUME_START..SPEED_START],
            Category::Speed => &UNITS[SPEED_START..DATA_SIZE_START],
            Category::DataSize => &UNITS[DATA_SIZE_START..],
        }
    }
}

/// 基準単位へ上げる。**モジュール外には出さない**——境界(WASM)が使うのは `convert()` だけで、
/// `#[cfg(test)] mod tests` は `use super::*` で親のプライベート項目に届く。
fn to_base(value: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    value.checked_mul(factor)?.checked_add(offset)
}

/// 基準単位から下ろす。**モジュール外には出さない**(理由は `to_base` と同じ)。
fn from_base(base: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    base.checked_sub(offset)?.checked_div(factor)
}

/// 入口。**値は式でよい**(§4.3)。
///
/// **単項マイナスは構文解析器に無い**ので、ここで担う(計画の裁定 2)。
/// `parse.rs` は 1 行も変えない。
///
/// **先頭が `-` なら、評価する前に `0` を前置するだけでよい**(裁定 2 の
/// 【訂正 2026-08-20】)。左結合と優先順位が符号を正しい位置に入れる。
/// 剥がした残り全体を評価してから符号反転すると、`-5-12` が `−(5−12)` = +7 になる
/// (正しくは −17)。`--1` は `0--1` になり、演算子の連続として `SyntaxError` のまま拒否される
/// ——二重負号の扱いは変わらない。
///
/// **単位の接尾辞は取らない(`UnitSet::None`)。** `K` / `M` / `G` を式に持ち込むと、
/// `km` の `k` と同じ字が 2 つの意味を持つ。
pub fn convert(value: &str, category: Category, from: Unit, to: Unit) -> CalcResult<Rational> {
    if from.category() != category || to.category() != category {
        return Err(CalcError::SyntaxError);
    }
    let owned;
    let text = if value.starts_with('-') {
        owned = format!("0{value}");
        &owned
    } else {
        value
    };
    let parsed = evaluate_to_rational(text, UnitSet::None)?;
    from_base(to_base(parsed, from)?, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::expr::rational::Rational;

    fn r(num: i128, den: i128) -> Rational {
        Rational::from_ratio(num, den).unwrap()
    }

    /// **カテゴリをまたぐ主張は `convert()` では書けない**(入口が拒む)。
    /// `in² = in × in` のような表と表の関係は、係数そのものを取り出して確かめる。
    fn factor(unit: Unit) -> Rational {
        unit.affine().unwrap().0
    }

    #[test]
    fn the_inch_is_exactly_25_point_4_millimetres() {
        assert_eq!(
            convert("1", Category::Length, Unit::In, Unit::Mm),
            Ok(r(254, 10))
        );
    }

    #[test]
    fn the_pound_is_exactly_0_point_45359237_kilograms() {
        assert_eq!(
            convert("1", Category::Mass, Unit::Lb, Unit::Kg),
            Ok(r(45359237, 100_000_000))
        );
    }

    #[test]
    fn minus_forty_is_the_fixed_point_of_the_two_scales() {
        // **factor と offset の両方が同時に効く唯一の点**(spec §6)。
        assert_eq!(
            convert("-40", Category::Temperature, Unit::DegC, Unit::DegF),
            Ok(r(-40, 1))
        );
        assert_eq!(
            convert("-40", Category::Temperature, Unit::DegF, Unit::DegC),
            Ok(r(-40, 1))
        );
    }

    #[test]
    fn the_offsets_check_out() {
        assert_eq!(
            convert("0", Category::Temperature, Unit::DegC, Unit::Kelvin),
            Ok(r(5463, 20))
        );
        assert_eq!(
            convert("32", Category::Temperature, Unit::DegF, Unit::DegC),
            Ok(r(0, 1))
        );
    }

    #[test]
    fn a_round_trip_returns_exactly_where_it_started() {
        // **有理数でなければ通らない。**
        let miles = convert("100", Category::Length, Unit::Km, Unit::Mi).unwrap();
        let (num, den) = miles.parts();
        let back = from_base(to_base(miles, Unit::Mi).unwrap(), Unit::Km).unwrap();
        assert_eq!(back, r(100, 1), "{num}/{den} が戻らない");
    }

    #[test]
    fn an_expression_is_a_valid_value() {
        // spec §4.3: `5*12` と打って inch を選べば 60 inch。
        assert_eq!(
            convert("5*12", Category::Length, Unit::In, Unit::In),
            Ok(r(60, 1))
        );
    }

    #[test]
    fn one_leading_minus_is_allowed_and_two_are_not() {
        // **`*` で確かめてはいけない。** `−(5×12)` も `(−5)×12` も −60 で、
        // 2 つの解釈が一致する——判別力が無い(裁定 2 の【訂正 2026-08-20】)。
        assert_eq!(
            convert("-5*12", Category::Length, Unit::M, Unit::M),
            Ok(r(-60, 1))
        );
        // **これが判別する 1 件。** 剥がして全体を反転する実装だと
        // `-5-12` は `−(5−12)` = +7 になる(正しくは −17)。
        assert_eq!(
            convert("-5-12", Category::Length, Unit::M, Unit::M),
            Ok(r(-17, 1))
        );
        assert_eq!(
            convert("-2-3-4", Category::Length, Unit::M, Unit::M),
            Ok(r(-9, 1))
        );
        assert_eq!(
            convert("-1+1", Category::Length, Unit::M, Unit::M),
            Ok(r(0, 1))
        );
        assert_eq!(
            convert("--1", Category::Length, Unit::M, Unit::M),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn crossing_categories_is_not_a_conversion() {
        assert_eq!(
            convert("1", Category::Length, Unit::Km, Unit::Kg),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn every_token_round_trips() {
        for unit in Unit::ALL {
            assert_eq!(Unit::from_token(unit.token()), Some(unit), "{unit:?}");
        }
        for category in Category::ALL {
            assert_eq!(
                Category::from_token(category.token()),
                Some(category),
                "{category:?}"
            );
        }
        assert_eq!(Unit::from_token("furlong"), None);
        assert_eq!(Category::from_token("loudness"), None);
    }

    #[test]
    fn every_unit_belongs_to_exactly_one_category_and_that_category_lists_it() {
        // **表が 2 つある**（`Unit::category()` と `Category::units()`）。
        // 片方だけ直すと、単位が盤面から消えるか、二重に出る。
        let mut counted = 0usize;
        for category in Category::ALL {
            for unit in category.units() {
                assert_eq!(unit.category(), category, "{unit:?}");
                counted += 1;
            }
        }
        assert_eq!(counted, Unit::ALL.len(), "どこにも載っていない単位がある");
    }

    #[test]
    fn the_unit_counts_match_the_spec() {
        assert_eq!(Category::Length.units().len(), 11);
        assert_eq!(Category::Mass.units().len(), 7);
        assert_eq!(Category::Temperature.units().len(), 3);
        assert_eq!(Category::Area.units().len(), 11);
        assert_eq!(Category::Volume.units().len(), 15);
        assert_eq!(Category::Speed.units().len(), 4);
        assert_eq!(Category::DataSize.units().len(), 12);
    }

    #[test]
    fn a_ratio_too_wide_for_i128_is_an_overflow_not_a_wrap() {
        // spec §3.5: **あふれは実際に起きる。** 黙って f64 に落ちるより Overflow と言う。
        //
        // **向きに注意**(spec §3.5 の【訂正 2026-08-20】)。桁の大きい入力を
        // `nm → mi` に掛けると分子は縮み(1.1e34/1.8e11)、i128 に収まってしまう。
        // 分子が 1.6e12 倍に伸びる `mi → nm` が、係数の比が効く向きである。
        let huge = "99999999999999999999999999999999999";
        assert_eq!(
            convert(huge, Category::Length, Unit::Mi, Unit::Nm),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn below_absolute_zero_is_not_stopped() {
        // spec §3.5 の裁定。物理の妥当性は単位換算器の仕事ではない。
        assert_eq!(
            convert("-300", Category::Temperature, Unit::DegC, Unit::Kelvin),
            Ok(r(-537, 20))
        );
    }

    #[test]
    fn a_tsubo_is_not_exactly_two_tatami() {
        // spec §3.3: **慣用に寄せない。** 20000/9801 = 2.040608101…
        assert_eq!(
            convert("1", Category::Area, Unit::Tsubo, Unit::Jo),
            Ok(r(20000, 9801))
        );
        // **比だけでは足りない。** 2 つが同じ倍率でずれても比は変わらないので、
        // それぞれを m² で固定する。
        assert_eq!(
            convert("1", Category::Area, Unit::Tsubo, Unit::M2),
            Ok(r(400, 121))
        );
        assert_eq!(
            convert("1", Category::Area, Unit::Jo, Unit::M2),
            Ok(r(81, 50))
        );
    }

    #[test]
    fn an_acre_is_exactly_4046_point_8564224_square_metres() {
        // spec §5 の【註 2026-08-20】: 画面に出るのは `4,046.856422` までで、
        // **11 桁目の 4 を守っているのはこの単体テストだけである**(golden は見ていない)。
        assert_eq!(
            convert("1", Category::Area, Unit::Ac, Unit::M2),
            Ok(r(316_160_658, 78_125))
        );
    }

    #[test]
    fn the_two_gallons_are_not_the_same() {
        // ちょうど 3.785411784 L と、ちょうど 4.54609 L。
        assert_eq!(
            convert("1", Category::Volume, Unit::GalUs, Unit::L),
            Ok(r(473_176_473, 125_000_000))
        );
        assert_eq!(
            convert("1", Category::Volume, Unit::GalImp, Unit::L),
            Ok(r(454_609, 100_000))
        );
    }

    #[test]
    fn the_two_cups_are_not_the_same() {
        // 236.5882365 mL と、ちょうど 200 mL。
        assert_eq!(
            convert("1", Category::Volume, Unit::CupUs, Unit::Ml),
            Ok(r(473_176_473, 2_000_000))
        );
        assert_eq!(
            convert("1", Category::Volume, Unit::CupJp, Unit::Ml),
            Ok(r(200, 1))
        );
    }

    #[test]
    fn si_and_iec_are_separate() {
        // 10⁹ / 2²⁰ = 1953125/2048 = 953.67431640625
        assert_eq!(
            convert("1", Category::DataSize, Unit::Gb, Unit::Mib),
            Ok(r(1_953_125, 2_048))
        );
    }

    #[test]
    fn a_bit_is_an_eighth_of_a_byte() {
        assert_eq!(
            convert("1", Category::DataSize, Unit::Bit, Unit::Byte),
            Ok(r(1, 8))
        );
    }

    #[test]
    fn a_knot_is_exactly_1_point_852_kilometres_per_hour() {
        assert_eq!(
            convert("1", Category::Speed, Unit::Kn, Unit::Kmh),
            Ok(r(463, 250))
        );
    }

    #[test]
    fn crossing_the_new_categories_is_not_a_conversion() {
        assert_eq!(
            convert("1", Category::Area, Unit::M2, Unit::L),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            convert("1", Category::Volume, Unit::L, Unit::Kn),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            convert("1", Category::DataSize, Unit::Gb, Unit::Km2),
            Err(CalcError::SyntaxError)
        );
    }

    // ---- 表を横断する主張 ----
    //
    // **名指しのケースだけでは表の大半が一度も見られない。** 実測: `ft²` を
    // `12 × in²` に変異させても、上の名指し 7 件は 1 つも赤くならなかった。
    // 下の 5 本は、行と行の関係(2 乗・梯子・時速・1024・1000)を主張して表全体を覆う。

    #[test]
    fn every_square_unit_is_the_square_of_its_length() {
        for (area, length) in [
            (Unit::Mm2, Unit::Mm),
            (Unit::Cm2, Unit::Cm),
            (Unit::M2, Unit::M),
            (Unit::Km2, Unit::Km),
            (Unit::In2, Unit::In),
            (Unit::Ft2, Unit::Ft),
            (Unit::Yd2, Unit::Yd),
        ] {
            let side = factor(length);
            assert_eq!(factor(area), side.checked_mul(side).unwrap(), "{area:?}");
        }
        // ヘクタールは 1 辺 100 m の正方形、エーカーは 4840 yd² である。
        let hectometre = factor(Unit::M).checked_mul(r(100, 1)).unwrap();
        assert_eq!(
            factor(Unit::Ha),
            hectometre.checked_mul(hectometre).unwrap()
        );
        assert_eq!(
            factor(Unit::Ac),
            factor(Unit::Yd2).checked_mul(r(4840, 1)).unwrap()
        );
    }

    #[test]
    fn the_fluid_ounce_ladders_are_128_in_the_us_and_160_in_the_imperial() {
        for (unit, ounces) in [
            (Unit::GalUs, 128),
            (Unit::QtUs, 32),
            (Unit::PtUs, 16),
            (Unit::CupUs, 8),
        ] {
            assert_eq!(
                convert("1", Category::Volume, unit, Unit::FlozUs),
                Ok(r(ounces, 1)),
                "{unit:?}"
            );
        }
        // **Imperial の梯子は 160 で、パイントは 20 オンスである**(US の 16 ではない)。
        for (unit, ounces) in [(Unit::GalImp, 160), (Unit::QtImp, 40), (Unit::PtImp, 20)] {
            assert_eq!(
                convert("1", Category::Volume, unit, Unit::FlozImp),
                Ok(r(ounces, 1)),
                "{unit:?}"
            );
        }
    }

    #[test]
    fn the_metric_volumes_are_powers_of_ten_of_the_litre() {
        for (unit, per_litre) in [(Unit::Ml, 1000), (Unit::Cl, 100), (Unit::Dl, 10)] {
            assert_eq!(
                convert("1", Category::Volume, Unit::L, unit),
                Ok(r(per_litre, 1)),
                "{unit:?}"
            );
        }
        assert_eq!(
            convert("1", Category::Volume, Unit::M3, Unit::L),
            Ok(r(1000, 1))
        );
    }

    #[test]
    fn an_hour_of_each_speed_is_exactly_its_distance() {
        // km/h・mph・kn は「距離 ÷ 1 時間」である。**3600 倍して距離の係数に戻る。**
        for (speed, distance) in [
            (Unit::Kmh, Unit::Km),
            (Unit::Mph, Unit::Mi),
            (Unit::Kn, Unit::Nmi),
        ] {
            assert_eq!(
                factor(speed).checked_mul(r(3600, 1)).unwrap(),
                factor(distance),
                "{speed:?}"
            );
        }
        assert_eq!(factor(Unit::Mps), factor(Unit::M));
    }

    #[test]
    fn the_iec_ladder_climbs_by_1024_at_every_step() {
        for (small, big) in [
            (Unit::Byte, Unit::Kib),
            (Unit::Kib, Unit::Mib),
            (Unit::Mib, Unit::Gib),
            (Unit::Gib, Unit::Tib),
            (Unit::Tib, Unit::Pib),
        ] {
            assert_eq!(
                convert("1", Category::DataSize, big, small),
                Ok(r(1024, 1)),
                "{big:?}"
            );
        }
    }

    #[test]
    fn the_si_ladder_climbs_by_1000_at_every_step() {
        for (small, big) in [
            (Unit::Byte, Unit::Kb),
            (Unit::Kb, Unit::Mb),
            (Unit::Mb, Unit::Gb),
            (Unit::Gb, Unit::Tb),
            (Unit::Tb, Unit::Pb),
        ] {
            assert_eq!(
                convert("1", Category::DataSize, big, small),
                Ok(r(1000, 1)),
                "{big:?}"
            );
        }
    }
}
