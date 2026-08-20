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

use crate::expr::rational::Rational;
use crate::expr::{UnitSet, evaluate_to_rational};
use crate::{CalcError, CalcResult};

/// 換算のカテゴリ。**カテゴリをまたぐ換算は無い**(§3.1)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Length,
    Mass,
    Temperature,
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
}

/// カテゴリごとの単位の数(§3.2 の表の行数)。**`ALL` の並びを切る位置でもある。**
const LENGTH_COUNT: usize = 11;
const MASS_COUNT: usize = 7;
const TEMPERATURE_COUNT: usize = 3;

/// `Category::units()` が返す部分スライスの実体。
///
/// **並びの真実を 1 か所に留めるため `ALL` から作る**——カテゴリごとに別の配列を
/// 書くと、単位を足したときに片方だけ直る。
static UNITS: [Unit; LENGTH_COUNT + MASS_COUNT + TEMPERATURE_COUNT] = Unit::ALL;

impl Unit {
    /// 境界(WASM / JS)とテストが参照する全体。**上の並びのまま。**
    pub const ALL: [Unit; 21] = [
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
        })
    }
}

impl Category {
    /// 境界とテストが参照する全体。
    pub const ALL: [Category; 3] = [Category::Length, Category::Mass, Category::Temperature];

    /// 境界へ渡す文字列トークン。
    pub fn token(self) -> &'static str {
        match self {
            Category::Length => "length",
            Category::Mass => "mass",
            Category::Temperature => "temperature",
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
            Category::Temperature => &UNITS[LENGTH_COUNT + MASS_COUNT..],
        }
    }
}

/// 基準単位へ上げる。
pub fn to_base(value: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    value.checked_mul(factor)?.checked_add(offset)
}

/// 基準単位から下ろす。
pub fn from_base(base: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    base.checked_sub(offset)?.checked_div(factor)
}

/// 入口。**値は式でよい**(§4.3)。
///
/// **単項マイナスは構文解析器に無い**ので、ここで 1 つだけ剥がす(計画の裁定 2)。
/// `parse.rs` は 1 行も変えない——`--40` は剥がした残りが `-40` になり、
/// 構文解析器が `SyntaxError` を返す。
///
/// **単位の接尾辞は取らない(`UnitSet::None`)。** `K` / `M` / `G` を式に持ち込むと、
/// `km` の `k` と同じ字が 2 つの意味を持つ。
pub fn convert(value: &str, category: Category, from: Unit, to: Unit) -> CalcResult<Rational> {
    if from.category() != category || to.category() != category {
        return Err(CalcError::SyntaxError);
    }
    let (text, negate) = match value.strip_prefix('-') {
        Some(rest) => (rest, true),
        None => (value, false),
    };
    let mut parsed = evaluate_to_rational(text, UnitSet::None)?;
    if negate {
        parsed = Rational::from_i128(0)?.checked_sub(parsed)?;
    }
    from_base(to_base(parsed, from)?, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::expr::rational::Rational;

    fn r(num: i128, den: i128) -> Rational {
        Rational::from_ratio(num, den).unwrap()
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
        assert_eq!(
            convert("-5*12", Category::Length, Unit::M, Unit::M),
            Ok(r(-60, 1))
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
    }

    #[test]
    fn a_ratio_too_wide_for_i128_is_an_overflow_not_a_wrap() {
        // spec §3.5: **あふれは実際に起きる。** 黙って f64 に落ちるより Overflow と言う。
        //
        // **あふれる向きは「大きい単位 → 小さい単位」である。** 桁の大きい入力を
        // `nm → mi` に掛けると分子は縮み(1.1e34/1.8e11)、i128 に収まってしまう
        // ——spec §3.5 が例に挙げた向きでは、この入力は落ちない(計画の誤り)。
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
}
