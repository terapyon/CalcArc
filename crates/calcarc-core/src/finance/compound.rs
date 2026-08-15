//! 複利(一括預入・毎月積立)。**厳密整数だけで走る**——f64 は無い。
//!
//! 1 期の演算はローンの各行利息と同一の floor(残高×分子/分母) である。
//! 違うのは**切り捨てを選ぶ根拠**のほうで、ローンでは「安全な向き」、
//! ここでは「慣行の再現」になる(numerical-policy「複利は同じ切り捨て、
//! 違う理由」)。
//!
//! 積立は**期末**——利息を付けてから足す。その期に入れた金はその期の
//! 利息を生まない。

use super::loan::rate::Rate;
use crate::{CalcError, CalcResult};

/// 期数の上限。ローンの `MAX_TERM_MONTHS` と揃える(月次なら 100 年ぶん)。
///
/// 上限が要るのは、複利が**単調増加**だからである: 期数を大きくすれば
/// いつか u64 を超え、その手前まではループが走り続ける。
pub const MAX_PERIODS: u32 = 1_200;

/// 満期の内訳。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Growth {
    /// 満期の残高(元利合計)。
    pub final_balance: u64,
    /// 自分で入れた合計(元本 + 積立額×期数)。
    pub principal_total: u64,
    /// 運用で増えたぶん。
    pub interest: u64,
}

/// 期を回す。**答はこのループが出す。**
pub fn grow(principal: u64, deposit: u64, rate: &Rate, periods: u32) -> CalcResult<Growth> {
    if periods == 0 || periods > MAX_PERIODS {
        return Err(CalcError::SyntaxError);
    }
    // 入れた金がゼロなら計算する対象が無い。0 円の答を返すより、
    // 入力が足りていないことを言う(ローンの元本 0 と同じ扱い)。
    if principal == 0 && deposit == 0 {
        return Err(CalcError::SyntaxError);
    }
    let mut balance = principal;
    for _ in 0..periods {
        let interest = rate.interest_floor(balance)?;
        balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
        balance = balance.checked_add(deposit).ok_or(CalcError::Overflow)?;
    }
    let principal_total = deposit
        .checked_mul(periods as u64)
        .and_then(|v| v.checked_add(principal))
        .ok_or(CalcError::Overflow)?;
    // 利率は非負なので残高が投入額を下回ることは無いが、契約として
    // checked のまま引く(計算コアは panic しない)。
    let interest = balance
        .checked_sub(principal_total)
        .ok_or(CalcError::Overflow)?;
    Ok(Growth {
        final_balance: balance,
        principal_total,
        interest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_half_year_seed_is_exact() {
        // 100 万・年 1%・5 年・半年複利(numerical-policy の実測値)。
        // 丸めない方式なら 1,051,140 になる——ここが方式の分かれ目である。
        let r = Rate::from_annual_percent("1", 2).unwrap();
        let g = grow(1_000_000, 0, &r, 10).unwrap();
        assert_eq!(g.final_balance, 1_051_136);
        assert_eq!(g.interest, 51_136);
        assert_eq!(g.principal_total, 1_000_000);
    }

    #[test]
    fn a_deposit_lands_at_the_end_of_the_period() {
        // 期末なので、最初の期の利息は積立額に付かない。
        // 1 期目: 利息 0 + 10,000。2 期目: 利息 100 + 10,000。
        let r = Rate::from_annual_percent("12", 12).unwrap(); // 月 1%
        let g = grow(0, 10_000, &r, 2).unwrap();
        assert_eq!(g.final_balance, 20_100);
        assert_eq!(g.principal_total, 20_000);
        assert_eq!(g.interest, 100);
    }

    #[test]
    fn a_lump_sum_is_a_deposit_of_zero() {
        // 一括は積立ループの退化である(設計書 §2)。両方入れた場合は
        // それぞれの合計より大きい——積んだ元本にも利息が付くため。
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let lump = grow(1_000_000, 0, &r, 120).unwrap().final_balance;
        let monthly = grow(0, 10_000, &r, 120).unwrap().final_balance;
        let both = grow(1_000_000, 10_000, &r, 120).unwrap().final_balance;
        assert!(both >= lump + monthly - 120); // 各期 1 円未満の切り捨てぶん
        assert!(both > lump && both > monthly);
    }

    #[test]
    fn zero_rate_keeps_what_was_put_in() {
        let r = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(grow(1_000_000, 0, &r, 12).unwrap().interest, 0);
        let g = grow(0, 30_000, &r, 12).unwrap();
        assert_eq!(g.final_balance, 360_000);
        assert_eq!(g.interest, 0);
    }

    #[test]
    fn growth_can_overflow_u64() {
        // **ローンには無かった経路**。残高が減る一方だったので、上限に
        // 届く道が無かった(設計書 §3)。
        let r = Rate::from_annual_percent("100", 12).unwrap();
        assert_eq!(grow(u64::MAX, 0, &r, 12), Err(CalcError::Overflow));
        // 積立側からもあふれる。
        assert_eq!(grow(0, u64::MAX, &r, 2), Err(CalcError::Overflow));
    }

    #[test]
    fn the_error_table() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        assert_eq!(grow(1_000_000, 0, &r, 0), Err(CalcError::SyntaxError));
        assert_eq!(grow(0, 0, &r, 12), Err(CalcError::SyntaxError));
        assert_eq!(
            grow(1_000_000, 0, &r, MAX_PERIODS + 1),
            Err(CalcError::SyntaxError)
        );
        assert!(grow(1_000_000, 0, &r, MAX_PERIODS).is_ok());
    }

    #[test]
    fn the_period_length_changes_the_answer() {
        // 同じ年利・同じ期数でも、周期が違えば別の計算である。
        let yearly = Rate::from_annual_percent("3", 1).unwrap();
        let monthly = Rate::from_annual_percent("3", 12).unwrap();
        let a = grow(1_000_000, 0, &yearly, 10).unwrap().final_balance;
        let b = grow(1_000_000, 0, &monthly, 10).unwrap().final_balance;
        assert!(a > b); // 年利 3% を 10 年 > 月利 0.25% を 10 か月
    }
}
