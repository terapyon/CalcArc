//! 金利。パーセント文字列を分数のまま保持する(設計書 §1-5)。
//!
//! f64 に直変換すると、償還表(厳密整数経路)と月額決定(f64 経路)が
//! 別の値から出発してしまう。両経路は同じ分数から出発する。

use crate::{CalcError, CalcResult};

/// 月利。分子/分母の分数。約分しない(生成元が読めるまま保持)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rate {
    pub numerator: u64,
    pub denominator: u64,
}

impl Rate {
    /// 年利のパーセント文字列から月利分数へ。
    ///
    /// "1.5" -> 15/(10·100·12) = 15/12000。小数 4 桁まで。
    /// 空・非数字・負・100% 超・5 桁以上は SyntaxError。
    pub fn from_percent(text: &str) -> CalcResult<Rate> {
        let (int_part, frac_part) = match text.split_once('.') {
            Some((i, f)) => (i, f),
            None => (text, ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(CalcError::SyntaxError);
        }
        if frac_part.len() > 4 {
            return Err(CalcError::SyntaxError);
        }
        let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
        if !(int_part.is_empty() || all_digits(int_part))
            || !(frac_part.is_empty() || all_digits(frac_part))
        {
            return Err(CalcError::SyntaxError);
        }
        let scale = 10u64.pow(frac_part.len() as u32);
        let int_val: u64 = if int_part.is_empty() {
            0
        } else {
            int_part.parse().map_err(|_| CalcError::SyntaxError)?
        };
        let frac_val: u64 = if frac_part.is_empty() {
            0
        } else {
            frac_part.parse().map_err(|_| CalcError::SyntaxError)?
        };
        let numerator = int_val
            .checked_mul(scale)
            .and_then(|v| v.checked_add(frac_val))
            .ok_or(CalcError::SyntaxError)?;
        // 100% 超は拒否: numerator/scale > 100  <=>  numerator > 100·scale
        if numerator > 100u64.saturating_mul(scale) {
            return Err(CalcError::SyntaxError);
        }
        let denominator = scale
            .checked_mul(100)
            .and_then(|v| v.checked_mul(12))
            .ok_or(CalcError::SyntaxError)?;
        Ok(Rate {
            numerator,
            denominator,
        })
    }

    pub fn is_zero(&self) -> bool {
        self.numerator == 0
    }

    /// 利息 = floor(残高 × 分子 / 分母)。厳密整数、u128 中間(設計書 §1-1)。
    ///
    /// 残高 ≤ u64::MAX、分子 ≤ 100·10^4 なので積は u128 に必ず収まる。
    /// 商は分子 ≤ 分母(月利 ≤ 100%/12)なので u64 に必ず戻るが、
    /// 契約として checked のまま返す。
    pub fn monthly_interest_floor(&self, balance: u64) -> CalcResult<u64> {
        let product = balance as u128 * self.numerator as u128;
        let interest = product / self.denominator as u128;
        u64::try_from(interest).map_err(|_| CalcError::Overflow)
    }

    /// f64 の月利(閉形式の候補計算にのみ使う。設計書 §1-3)。
    pub fn as_f64_monthly(&self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }

    /// ボーナス列の半年利 = 年利÷2(設計書 §4 の採用決定)。
    ///
    /// 月利分数の 6 倍: 分子×6/分母 = 分子/(分母/6)。分母は scale·1200 で
    /// 常に 6 の倍数なので割り切れる。
    pub fn half_year(&self) -> Rate {
        Rate {
            numerator: self.numerator,
            denominator: self.denominator / 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_string_becomes_an_exact_fraction() {
        // "1.5" -> 年 15/1000 -> 月 15/12000。約分しない。
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!((r.numerator, r.denominator), (15, 12_000));
        let r = Rate::from_percent("0").unwrap();
        assert!(r.is_zero());
        // 小数 4 桁まで受ける(bp の下まで)。5 桁は SyntaxError。
        assert!(Rate::from_percent("2.7125").is_ok());
        assert_eq!(Rate::from_percent("1.23456"), Err(CalcError::SyntaxError));
        assert_eq!(Rate::from_percent(""), Err(CalcError::SyntaxError));
        assert_eq!(Rate::from_percent("-1"), Err(CalcError::SyntaxError));
        assert_eq!(Rate::from_percent("abc"), Err(CalcError::SyntaxError));
        // 上限 100%(年)。閉形式の定義域と UI の現実性の両方から。
        assert_eq!(Rate::from_percent("100.0001"), Err(CalcError::SyntaxError));
        assert!(Rate::from_percent("100").is_ok());
    }

    #[test]
    fn the_measured_one_yen_case_is_exact() {
        // 設計書 §1-1 の実測: 年 2.7%・残高 1200 万円。f64 経由は 26,999 円に
        // 落ちるが、厳密値は 27,000 円(境界ちょうど)。
        let r = Rate::from_percent("2.7").unwrap();
        assert_eq!(r.monthly_interest_floor(12_000_000).unwrap(), 27_000);
    }

    #[test]
    fn round_principals_sit_on_the_yen_boundary() {
        // 3000 万円は全 bp 刻み金利で境界上(設計書 §1-1)。抜き取りで固定。
        for pct in ["0.01", "1.37", "2.7", "5.55"] {
            let r = Rate::from_percent(pct).unwrap();
            let interest = r.monthly_interest_floor(30_000_000).unwrap();
            // 境界ちょうど: 30_000_000×分子 は分母で割り切れる。
            let num = 30_000_000u128 * r.numerator as u128;
            assert_eq!(num % r.denominator as u128, 0, "{pct}");
            assert_eq!(interest as u128, num / r.denominator as u128, "{pct}");
        }
    }

    #[test]
    fn the_largest_balance_does_not_overflow() {
        // 残高 u64::MAX × 分子(最大 10^6) は u128 に収まり、商は u64 に戻る。
        let r = Rate::from_percent("100").unwrap();
        let interest = r.monthly_interest_floor(u64::MAX).unwrap();
        assert_eq!(interest, u64::MAX / 12);
    }

    #[test]
    fn half_year_rate_is_annual_over_two() {
        // ボーナス列の半年利 = 年利÷2(設計書 §4)。分数のまま: 月利分数×6。
        let r = Rate::from_percent("3.0").unwrap(); // 月 30/12000
        let h = r.half_year(); // 半年 30/2000 = 年 3%/2
        assert_eq!((h.numerator, h.denominator), (30, 2_000));
        assert!(Rate::from_percent("0").unwrap().half_year().is_zero());
    }

    #[test]
    fn the_f64_monthly_rate_comes_from_the_same_fraction() {
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(r.as_f64_monthly(), 15.0 / 12_000.0);
        assert_eq!(Rate::from_percent("0").unwrap().as_f64_monthly(), 0.0);
    }
}
