//! 目標額からの逆算 2 種(設計書 2026-08-15)。
//!
//! **f64 を 1 つも使わない。** ローンが種を要ったのは期間が数万回になりうる
//! うえ償還表が高価だったからで、複利は期数が MAX_PERIODS で頭打ちである。
//!
//! **必要年数に二分探索を使ってはならない**——手取りは期数について単調でない
//! (numerical-policy「手取りは期数について単調でない」)。積立額については
//! 単調なので、そちらは二分探索でよい。

use super::compound::{Growth, MAX_PERIODS, grow};
use super::loan::rate::Rate;
use super::tax::withholding;
use crate::{CalcError, CalcResult};

/// 逆算の答と、その答における全体像。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Solution {
    pub deposit: u64,
    pub periods: u32,
    pub growth: Growth,
    pub national_tax: u64,
    pub local_tax: u64,
    pub net: u64,
}

/// 目標と比べる値。税 ON なら手取り、OFF なら残高(設計書 §2)。
fn reached(balance: u64, interest: u64, taxed: bool) -> CalcResult<u64> {
    if !taxed {
        return Ok(balance);
    }
    let (national, local) = withholding(interest)?;
    balance
        .checked_sub(national)
        .and_then(|v| v.checked_sub(local))
        .ok_or(CalcError::Overflow)
}

fn solution(deposit: u64, periods: u32, growth: Growth, taxed: bool) -> CalcResult<Solution> {
    let (national, local) = if taxed {
        withholding(growth.interest)?
    } else {
        (0, 0)
    };
    let net = growth
        .final_balance
        .checked_sub(national)
        .and_then(|v| v.checked_sub(local))
        .ok_or(CalcError::Overflow)?;
    Ok(Solution {
        deposit,
        periods,
        growth,
        national_tax: national,
        local_tax: local,
        net,
    })
}

/// 目標を下回らない最小の積立額。**単調なので二分探索でよい**(設計書 §3)。
pub fn deposit_for(
    principal: u64,
    rate: &Rate,
    periods: u32,
    target: u64,
    taxed: bool,
) -> CalcResult<Solution> {
    if target == 0 || periods == 0 || periods > MAX_PERIODS {
        return Err(CalcError::SyntaxError);
    }
    // **Overflow は「届く側」として扱う**——探索を u64 の定義域で閉じるため。
    // 選ばれた答は最後に必ず grow を走らせるので、収まらないなら Overflow が出る。
    let probe = |d: u64| -> bool {
        match grow(principal, d, rate, periods) {
            Ok(g) => matches!(reached(g.final_balance, g.interest, taxed), Ok(v) if v >= target),
            Err(CalcError::Overflow) => true,
            Err(_) => false,
        }
    };
    // **`principal > 0` の条件は要る**——`grow(0, 0, ...)` は「入れた金がゼロ」で
    // SyntaxError を返す。`probe` の `Err(_) => false` に頼ると、元本 0 のときに
    // 「積立 0 では届かない」を偶然の経路で得ることになる。条件で言い切る。
    let answer = if principal > 0 && probe(0) {
        0
    } else {
        let mut low = 0u64; // 届かない側
        let mut high = 1u64;
        while !probe(high) {
            low = high;
            if high == u64::MAX {
                return Err(CalcError::Overflow);
            }
            high = high.saturating_mul(2);
        }
        while high - low > 1 {
            let mid = low + (high - low) / 2;
            if probe(mid) {
                high = mid;
            } else {
                low = mid;
            }
        }
        high
    };
    let growth = grow(principal, answer, rate, periods)?;
    solution(answer, periods, growth, taxed)
}

/// 目標を下回らない最小の期数。**最初に届いた期**を前進 1 本で見つける。
///
/// 二分探索を使わないのは手取りが期数について単調でないからで、これは
/// 効率の話ではなく正しさの話である(設計書 §3)。
pub fn periods_for(
    principal: u64,
    deposit: u64,
    rate: &Rate,
    target: u64,
    taxed: bool,
) -> CalcResult<Solution> {
    if target == 0 {
        return Err(CalcError::SyntaxError);
    }
    if principal == 0 && deposit == 0 {
        return Err(CalcError::SyntaxError);
    }
    let mut balance = principal;
    let mut principal_total = principal;
    for n in 1..=MAX_PERIODS {
        balance = balance
            .checked_add(rate.interest_floor(balance)?)
            .and_then(|b| b.checked_add(deposit))
            .ok_or(CalcError::Overflow)?;
        principal_total = principal_total
            .checked_add(deposit)
            .ok_or(CalcError::Overflow)?;
        // 利率は非負なので投入合計を下回らないが、契約として checked のまま引く。
        let interest = balance
            .checked_sub(principal_total)
            .ok_or(CalcError::Overflow)?;
        if reached(balance, interest, taxed)? >= target {
            return solution(
                deposit,
                n,
                Growth {
                    final_balance: balance,
                    principal_total,
                    interest,
                },
                taxed,
            );
        }
    }
    // 1,200 期でも届かない = 事実上の発散(ローンの term_for と同じ扱い)。
    Err(CalcError::SyntaxError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_deposit_is_the_smallest_that_does_not_fall_short() {
        // 設計書 §7 の必須ケース #1。golden と同じ入力・同じ答。
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let s = deposit_for(0, &r, 240, 10_000_000, false).unwrap();
        assert_eq!(s.deposit, 30_461);
        assert_eq!(s.growth.final_balance, 10_000_251);
        // 定義の両側: 1 円少ないと届かない。
        let less = crate::finance::compound::grow(0, s.deposit - 1, &r, 240).unwrap();
        assert!(less.final_balance < 10_000_000);
    }

    #[test]
    fn the_periods_answer_survives_the_dip_that_follows_it() {
        // **この spec の存在理由**(設計書 §3)。19 で届き、20 で下回る。
        let r = Rate::from_annual_percent("1.5", 12).unwrap();
        let s = periods_for(999, 0, &r, 1016, true).unwrap();
        assert_eq!(s.periods, 19);
        assert_eq!(s.net, 1016);
        // 20 期は目標を下回る。二分探索ならここで道を誤る。
        let g20 = crate::finance::compound::grow(999, 0, &r, 20).unwrap();
        let (n20, l20) = crate::finance::tax::withholding(g20.interest).unwrap();
        assert_eq!(g20.final_balance - n20 - l20, 1015);
    }

    #[test]
    fn zero_rate_is_an_integer_ceiling() {
        let r = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(
            deposit_for(0, &r, 240, 12_000_000, false).unwrap().deposit,
            50_000
        );
        assert_eq!(
            deposit_for(0, &r, 240, 12_000_001, false).unwrap().deposit,
            50_001
        );
    }

    #[test]
    fn a_target_already_met_needs_one_period_and_no_deposit() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        assert_eq!(
            periods_for(1_000_000, 0, &r, 500_000, false)
                .unwrap()
                .periods,
            1
        );
        assert_eq!(
            deposit_for(1_000_000, &r, 12, 500_000, false)
                .unwrap()
                .deposit,
            0
        );
    }

    #[test]
    fn the_inversions_agree_with_each_other() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let d = deposit_for(0, &r, 240, 10_000_000, false).unwrap();
        assert_eq!(
            periods_for(0, d.deposit, &r, d.growth.final_balance, false)
                .unwrap()
                .periods,
            240
        );
    }

    #[test]
    fn the_error_table() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let zero = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(
            deposit_for(0, &r, 240, 0, false),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            periods_for(1_000_000, 0, &r, 0, false),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            deposit_for(0, &r, 0, 1_000_000, false),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            deposit_for(0, &r, MAX_PERIODS + 1, 1_000_000, false),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            periods_for(0, 0, &r, 1_000_000, false),
            Err(CalcError::SyntaxError)
        );
        // 増える源が無いので 1200 期でも届かない = 発散。
        assert_eq!(
            periods_for(1_000_000, 0, &zero, 2_000_000, false),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn an_unreachable_target_overflows_instead_of_looping() {
        // **1 期ではなく 2 期であることに意味がある。** 0%・1 期なら答は
        // ちょうど u64::MAX で収まり、あふれずに収まってしまう(残高 = 積立額)。
        // 2 期なら 2d ≥ u64::MAX が要り、最小の d = 2^63 で残高が 2^64 に
        // なってあふれる。
        let zero = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(
            deposit_for(0, &zero, 2, u64::MAX, false),
            Err(CalcError::Overflow)
        );
        // 1 期なら答が出る側。境界の両側を押さえる。
        assert_eq!(
            deposit_for(0, &zero, 1, u64::MAX, false).unwrap().deposit,
            u64::MAX
        );
    }
}
