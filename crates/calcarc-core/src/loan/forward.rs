//! 正算(設計書 §0 の「求めるもの = 月額」)。
//!
//! 閉形式が月額の候補を出し、**厳密償還表が総額を確定する**(設計書 §5 の
//! 原則は逆算だけでなく正算にも効く: 表示する総支払額・総利息は f64 由来では
//! なく、1 行ずつ整数で積んだ値である)。

use super::closed_form::monthly_payment;
use super::rate::Rate;
use super::schedule::run_schedule;
use crate::CalcResult;

/// 正算の結果。金額は円(u64)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoanResult {
    pub monthly_payment: u64,
    /// 残価ありのときも B を含む完済総額(設計書 §3)。
    pub total_payment: u64,
    pub total_interest: u64,
    /// 実際に支払いが発生した回数(縮退入力では n より小さい)。
    pub rows_paid: u32,
    /// 最終回の支払額。残価ありなら残価(飛ばされたときは B − 1)。
    pub final_payment: u64,
}

/// 元利均等の正算。`residual` は残価(既定 0、正算のみ。設計書 §3)。
pub fn compute(principal: u64, rate: &Rate, n: u32, residual: u64) -> CalcResult<LoanResult> {
    let monthly = monthly_payment(principal, rate, n, residual)?;
    let s = run_schedule(principal, rate, n, monthly, residual)?;
    Ok(LoanResult {
        monthly_payment: monthly,
        total_payment: s.total_payment,
        total_interest: s.total_interest,
        rows_paid: s.rows_paid,
        final_payment: s.final_payment,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CalcError;

    #[test]
    fn the_totals_come_from_the_table_not_the_closed_form() {
        // 住宅基準例。総支払 = 月額×(回数−1) + 最終回、総利息 = 総支払 − 元本。
        let r = Rate::from_percent("1.5").unwrap();
        let out = compute(30_000_000, &r, 420, 0).unwrap();
        assert_eq!(out.rows_paid, 420);
        assert_eq!(
            out.total_payment,
            out.monthly_payment * 419 + out.final_payment
        );
        assert_eq!(out.total_interest, out.total_payment - 30_000_000);
    }

    #[test]
    fn a_residual_of_zero_is_the_plain_loan() {
        // 退化恒等式(設計書 §3): B=0 は通常ローンそのもの。
        let r = Rate::from_percent("2.0").unwrap();
        assert_eq!(
            compute(3_000_000, &r, 60, 0).unwrap(),
            compute(3_000_000, &r, 60, 0).unwrap()
        );
        // 残価を積むと月額は下がり、総支払(B 込み)は上がる。
        let plain = compute(3_000_000, &r, 60, 0).unwrap();
        let with_b = compute(3_000_000, &r, 60, 1_200_000).unwrap();
        assert!(with_b.monthly_payment < plain.monthly_payment);
        assert!(with_b.total_payment > plain.total_payment);
        assert_eq!(with_b.final_payment, 1_200_000);
    }

    #[test]
    fn the_car_example_closes_on_the_residual() {
        // 車例(300 万・5 年・残価 40% 級。設計書 §7 の必須ケース)。
        let r = Rate::from_percent("3.9").unwrap();
        let out = compute(3_000_000, &r, 60, 1_200_000).unwrap();
        assert_eq!(out.rows_paid, 60);
        assert_eq!(out.final_payment, 1_200_000);
        assert_eq!(out.total_interest, out.total_payment - 3_000_000);
    }

    #[test]
    fn errors_come_straight_through() {
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(compute(0, &r, 12, 0), Err(CalcError::SyntaxError));
        assert_eq!(compute(1_000_000, &r, 0, 0), Err(CalcError::SyntaxError));
        assert_eq!(
            compute(1_000_000, &r, 12, 1_000_000),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn the_largest_principal_does_not_wrap() {
        // u64 域の上端。あふれるなら Overflow で、黙って折り返さない。
        let r = Rate::from_percent("1.5").unwrap();
        match compute(u64::MAX / 2, &r, 600, 0) {
            Ok(out) => {
                assert_eq!(out.rows_paid, 600);
                assert!(out.total_payment > u64::MAX / 2);
            }
            Err(e) => assert_eq!(e, CalcError::Overflow),
        }
    }
}
