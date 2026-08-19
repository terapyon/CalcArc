//! 式入力(設計書 2026-08-15 §8、numerical-policy)。
//!
//! **評価器は 1 つで、着地が項目ごとに違う。** 途中は有理数のまま保ち、
//! 丸めるのは項目に着地させる 1 回だけである——各演算で丸めると
//! `100万 ÷ 3 × 3` が 999,999 になり、**打つ順序で答えが変わる**。
//!
//! **単位を解釈するのはここである。** TypeScript は単位のラベルと並び順しか
//! 持たない(scale の数値は持たない)。単位表を両方の言語に置くと二重管理に
//! なり、ずれが静かに沈むからである。

pub mod parse;
pub mod rational;

use crate::{CalcError, CalcResult};
use rational::Rational;

/// 年利の小数桁数。`Rate` と同じ線(小数 4 桁まで)。
const PERCENT_SCALE: i128 = 10_000;

/// どの単位表を使うか。**表の中身はここにあり、境界からは名前だけを渡す**
/// ——表そのものを渡す形にすると、呼ぶ側が scale を持つことになる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitSet {
    /// 金額。億 = 10^8、万 = 10^4。
    Yen,
    /// 件数・次元数。G = 10^9、M = 10^6、K = 10^3。
    Count,
    /// ローンの期間。年 = 12、月 = 1。
    Months,
    /// 複利の期間。**年 = 1 年あたりの期数**、期 = 1。どの周期でも割り切れる。
    Periods(u32),
    /// LLM のパラメータ数。**B = 10^9、M = 10^6**。`Count` と係数は同じだが、
    /// モデルカードの慣習では `G` ではなく `B` と呼ぶ(spec §4.3)。
    Params,
    /// 単位を取らない(年利)。
    None,
}

impl UnitSet {
    /// **降順**に並べた (ラベル, scale)。「億 の次に 万」は置けるが逆は不可。
    pub fn units(&self) -> Vec<(char, u128)> {
        match self {
            UnitSet::Yen => vec![('億', 100_000_000), ('万', 10_000)],
            UnitSet::Count => vec![('G', 1_000_000_000), ('M', 1_000_000), ('K', 1_000)],
            UnitSet::Months => vec![('年', 12), ('月', 1)],
            UnitSet::Periods(1) => vec![('年', 1)],
            UnitSet::Periods(per_year) => vec![('年', *per_year as u128), ('期', 1)],
            UnitSet::Params => vec![('B', 1_000_000_000), ('M', 1_000_000)],
            UnitSet::None => Vec::new(),
        }
    }
}

/// 境界から来る名前を単位表に直す。`"periods:12"` の形。
pub fn unit_set_from_str(text: &str) -> CalcResult<UnitSet> {
    if let Some(rest) = text.strip_prefix("periods:") {
        let per_year: u32 = rest.parse().map_err(|_| CalcError::SyntaxError)?;
        if !matches!(per_year, 1 | 2 | 12) {
            return Err(CalcError::SyntaxError);
        }
        return Ok(UnitSet::Periods(per_year));
    }
    match text {
        "yen" => Ok(UnitSet::Yen),
        "count" => Ok(UnitSet::Count),
        "months" => Ok(UnitSet::Months),
        "params" => Ok(UnitSet::Params),
        "none" => Ok(UnitSet::None),
        _ => Err(CalcError::SyntaxError),
    }
}

/// 式を評価して整数へ着地させる。`maximum` は項目の上限。
pub fn evaluate_to_integer(text: &str, maximum: u128, units: UnitSet) -> CalcResult<u128> {
    let landed = parse::evaluate(text, units)?.floor_to_u128()?;
    if landed > maximum {
        return Err(CalcError::Overflow);
    }
    Ok(landed)
}

/// 式を評価して年利のパーセント文字列へ着地させる。
///
/// **小数 4 桁に収まらなければ `SyntaxError`。** `1.23456` を入口で拒む
/// のと同じ線を、計算で出た値にも引く——表示できない値を黙って丸めない。
pub fn evaluate_to_percent(text: &str) -> CalcResult<String> {
    let value = parse::evaluate(text, UnitSet::None)?;
    if value.is_negative() {
        return Err(CalcError::SyntaxError);
    }
    let hundred = Rational::from_i128(100)?;
    if value.checked_sub(hundred)?.parts().0 > 0 {
        return Err(CalcError::SyntaxError); // 100% 超
    }
    let scaled = value.checked_mul(Rational::from_i128(PERCENT_SCALE)?)?;
    let (num, den) = scaled.parts();
    if den != 1 {
        return Err(CalcError::SyntaxError); // 4 桁で表せない
    }
    Ok(format_percent(num))
}

/// `17500` -> `"1.75"`。末尾の 0 は落とす。
fn format_percent(scaled: i128) -> String {
    let whole = scaled / PERCENT_SCALE;
    let fraction = scaled % PERCENT_SCALE;
    if fraction == 0 {
        return whole.to_string();
    }
    let digits = format!("{fraction:04}");
    format!("{whole}.{}", digits.trim_end_matches('0'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_unit_sets_are_ordered_downwards() {
        for set in [
            UnitSet::Yen,
            UnitSet::Count,
            UnitSet::Months,
            UnitSet::Periods(12),
            UnitSet::Params,
        ] {
            let units = set.units();
            for pair in units.windows(2) {
                assert!(pair[0].1 > pair[1].1, "{set:?} が降順でない");
            }
        }
    }

    #[test]
    fn parameters_count_in_billions() {
        // **`B` は既存の `G` と係数が同じで、ラベルだけが違う**(spec §4.3)
        // ——Data Scale の件数は `G`、LLM のパラメータ数は `B` と呼ぶ慣習である。
        assert_eq!(
            UnitSet::Params.units(),
            vec![('B', 1_000_000_000), ('M', 1_000_000)]
        );
        assert_eq!(unit_set_from_str("params").unwrap(), UnitSet::Params);
        assert_eq!(
            evaluate_to_integer("27B", u128::MAX, UnitSet::Params).unwrap(),
            27_000_000_000
        );
    }

    #[test]
    fn the_period_length_scales_the_year() {
        assert_eq!(UnitSet::Periods(12).units()[0], ('年', 12));
        assert_eq!(UnitSet::Periods(2).units()[0], ('年', 2));
        // 1 期 = 1 年なので下位単位が無い。
        assert_eq!(UnitSet::Periods(1).units(), vec![('年', 1)]);
    }

    #[test]
    fn the_wire_names_map_to_tables() {
        assert_eq!(unit_set_from_str("yen").unwrap(), UnitSet::Yen);
        assert_eq!(unit_set_from_str("periods:2").unwrap(), UnitSet::Periods(2));
        assert_eq!(unit_set_from_str("periods:4"), Err(CalcError::SyntaxError));
        assert_eq!(unit_set_from_str("yens"), Err(CalcError::SyntaxError));
    }

    #[test]
    fn the_percent_landing_keeps_four_digits() {
        assert_eq!(evaluate_to_percent("1.5+0.25").unwrap(), "1.75");
        assert_eq!(evaluate_to_percent("1/8").unwrap(), "0.125");
        assert_eq!(evaluate_to_percent("2*25").unwrap(), "50");
        // 4 桁で表せない / 100% 超
        assert_eq!(evaluate_to_percent("1/3"), Err(CalcError::SyntaxError));
        assert_eq!(evaluate_to_percent("3*40"), Err(CalcError::SyntaxError));
    }

    #[test]
    fn integers_land_with_a_ceiling() {
        assert_eq!(
            evaluate_to_integer("100*12", 1200, UnitSet::Months).unwrap(),
            1200
        );
        assert_eq!(
            evaluate_to_integer("100*12+1", 1200, UnitSet::Months),
            Err(CalcError::Overflow)
        );
    }
}
