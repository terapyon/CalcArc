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
    fn the_net_is_monotone_in_the_deposit() {
        // **§3 の証明を検査として残す。** 二分探索の正当性はこれに依存している。
        // 範囲は設計書 §15 の総当たりの縮小版(テスト時間に収める)。
        let mut compared = 0usize;
        for percent in ["0", "0.0001", "1.5", "3", "20"] {
            for ppy in [1u32, 2, 12] {
                let r = Rate::from_annual_percent(percent, ppy).unwrap();
                for periods in [1u32, 2, 3, 12, 240] {
                    for principal in [0u64, 999, 1_000_000] {
                        let mut previous = 0u64;
                        for d in 0..200u64 {
                            // principal=0 かつ d=0 は grow の契約上「入れた金がゼロ」で
                            // SyntaxError になる(無効な入力であって単調性の反例ではない)。
                            // 高率×長期×高額(例: 20%・240 期・元本 100 万)は u64 を
                            // あふれることがある(これも単調性の反例ではなく、別の契約の
                            // 話なので素通りする)。20%・ppy=1・240 期は d=1 でも
                            // あふれる格子で、この 3 セルは 200 個の d が全て continue
                            // する(この関数では 1 度も比較しない)。
                            let g = match grow(principal, d, &r, periods) {
                                Ok(g) => g,
                                Err(_) => continue,
                            };
                            let v = reached(g.final_balance, g.interest, true).unwrap();
                            assert!(
                                v >= previous,
                                "手取りが減った: {percent}% ppy={ppy} n={periods} P={principal} d={d}"
                            );
                            previous = v;
                            compared += 1;
                        }
                    }
                }
            }
        }
        // **空振りの検査**。`continue` が全部を飲み込んでも通ってしまう形に
        // しないための下限である(オーバーフローする格子は実際にある: 20% ×
        // 年複利 × 240 期は d=1 でも u64 を超える)。実測 44,326 / 45,000。
        assert!(compared > 40_000, "比較したのは {compared} 回だけ");
    }

    #[test]
    fn the_net_is_not_monotone_in_the_periods() {
        // **非単調は仕様である**(numerical-policy)。ここが緑でなくなったら、
        // 税の丸めが変わったということなので、前進 1 本の根拠を読み直す。
        let r = Rate::from_annual_percent("1.5", 12).unwrap();
        let net_at = |n: u32| {
            let g = grow(999, 0, &r, n).unwrap();
            reached(g.final_balance, g.interest, true).unwrap()
        };
        assert_eq!(net_at(19), 1016);
        assert_eq!(net_at(20), 1015); // 減る
        assert_eq!(net_at(21), 1016);
    }

    #[test]
    fn the_forward_scan_accumulates_exactly_what_grow_would() {
        // **periods_for は grow の 1 期分の式を書き写している**(一本走査にするため)。
        // 写しがずれると、逆算だけが別の漸化式で走ることになる——しかも答は
        // もっともらしいままである。**複数の n で縛る**: 1 点の一致では
        // 「その n までは同じ」しか言えず、写しずれは特定の期で初めて出うる。
        let mut compared = 0usize;
        for percent in ["0", "0.0001", "1.5", "3", "20"] {
            for ppy in [1u32, 2, 12] {
                let r = Rate::from_annual_percent(percent, ppy).unwrap();
                for n in [1u32, 2, 3, 19, 20, 21, 240, MAX_PERIODS] {
                    for (principal, deposit) in [(999u64, 0u64), (0, 30_000), (1_000_000, 7)] {
                        // 目標を「その n でちょうど届く値」に取る。ただし高率×長期は
                        // u64 をあふれる(そのもの自体は別の契約の話なので、ここでは
                        // 素通りする)。
                        let expected = match grow(principal, deposit, &r, n) {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        // taxed=false なので reached は残高をそのまま返す(常に Ok)。
                        let target =
                            reached(expected.final_balance, expected.interest, false).unwrap();
                        let s = periods_for(principal, deposit, &r, target, false);
                        if let Ok(s) = s {
                            // **止まった期がどこであれ**、そこまで積んだ残高は
                            // 同じ入力の grow と一致しなければならない。以前は
                            // `s.periods == n` で絞っていたが、それだと「積み方が
                            // ずれて止まる期も n からずれる」種類の写しずれが
                            // 沈黙側(if の外)に落ちてしまい、検査が空振りになる。
                            // s.periods <= n は残高の単調性から保証されるので、
                            // grow(..., s.periods) はあふれない。
                            let at_stop = grow(principal, deposit, &r, s.periods).unwrap();
                            assert_eq!(
                                s.growth, at_stop,
                                "写しがずれた: {percent}% ppy={ppy} n={n} P={principal} d={deposit} 止まった期={}",
                                s.periods
                            );
                            compared += 1;
                        }
                    }
                }
            }
        }
        // **空振りの検査**。ガードを外した後も `continue`(高率×長期の
        // オーバーフロー)は残るので、下限は満杯の 360 より緩く置く。
        // 実測 349 / 360(残り 11 は grow 自体があふれた格子)。
        assert!(compared > 300, "比較したのは {compared} 回だけ");
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
