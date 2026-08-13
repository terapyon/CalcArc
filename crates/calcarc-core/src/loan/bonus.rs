//! ボーナス併用(設計書 §4)。これは**「決定」であり「慣行」ではない**。
//!
//! モデル: 元本を月払い分 P1 とボーナス分 P2 に分け、**2 本の償還列を独立に
//! 併走**させる。ボーナス列は年 2 回・**半年利 = 年利÷2**・6 の倍数月・
//! 初回端数期間なし。ウェブシミュレータ標準の簡略化を採る決定である
//! (実務には複利半年利 (1+年利/12)^6−1・日割り・初回オフセットが併存し、
//! 完全一致の世界では別物になるため、どれを採るかを明記する)。
//!
//! 償還表エンジンは「期」の意味を知らない——半年利を渡せば、そのまま
//! 半年ごとの列として走る。ボーナス列に特別なコードは要らない。
//!
//! 制約: P2 ≤ P の 50%。期間逆算との組み合わせは M6 では扱わない(閉形式で
//! 解けず反復解法になるため。設計書 §4-a)。

use super::forward;
use super::inverse;
use super::rate::Rate;
use crate::{CalcError, CalcResult};

/// ボーナス回の間隔(月)。年 2 回。
const BONUS_INTERVAL_MONTHS: u32 = 6;

/// ボーナス併用の正算結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BonusResult {
    pub monthly_payment: u64,
    /// ボーナス回 1 回あたりの支払額(ボーナス分 0 円なら 0)。
    pub bonus_payment: u64,
    /// ボーナス回の回数 = floor(n/6)。
    pub bonus_rows: u32,
    /// 2 列の合計。
    pub total_payment: u64,
    pub total_interest: u64,
    pub monthly_final_payment: u64,
    pub bonus_final_payment: u64,
}

/// ボーナス併用の借入可能額逆算の結果(設計書 §4-b)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BonusPrincipalResult {
    pub monthly_principal: u64,
    pub bonus_principal: u64,
    pub total_principal: u64,
    pub total_payment: u64,
    pub total_interest: u64,
}

/// ボーナス併用の正算。`bonus_principal` は元本のうちボーナス回で返す分。
pub fn compute_forward(
    principal: u64,
    bonus_principal: u64,
    rate: &Rate,
    n: u32,
) -> CalcResult<BonusResult> {
    check_bonus_share(bonus_principal, principal)?;
    if bonus_principal > 0 && n < BONUS_INTERVAL_MONTHS {
        // ボーナス回が 1 度も来ない矛盾入力。
        return Err(CalcError::SyntaxError);
    }
    let monthly = forward::compute(principal - bonus_principal, rate, n, 0)?;
    if bonus_principal == 0 {
        return Ok(BonusResult {
            monthly_payment: monthly.monthly_payment,
            bonus_payment: 0,
            bonus_rows: 0,
            total_payment: monthly.total_payment,
            total_interest: monthly.total_interest,
            monthly_final_payment: monthly.final_payment,
            bonus_final_payment: 0,
        });
    }
    let bonus_rows = n / BONUS_INTERVAL_MONTHS;
    let bonus = forward::compute(bonus_principal, &rate.half_year(), bonus_rows, 0)?;
    Ok(BonusResult {
        monthly_payment: monthly.monthly_payment,
        bonus_payment: bonus.monthly_payment,
        bonus_rows,
        total_payment: sum(monthly.total_payment, bonus.total_payment)?,
        total_interest: sum(monthly.total_interest, bonus.total_interest)?,
        monthly_final_payment: monthly.final_payment,
        bonus_final_payment: bonus.final_payment,
    })
}

/// ボーナス併用の借入可能額逆算(設計書 §4-b)。
///
/// 「月々の支払額」と「ボーナス回の支払額」の 2 入力 → **2 本の独立な逆算** →
/// P = P1 + P2。**50% 制約は解いた後に検証する**(入力段では P が未知)。
pub fn principal_for(
    monthly_payment: u64,
    bonus_payment: u64,
    rate: &Rate,
    n: u32,
) -> CalcResult<BonusPrincipalResult> {
    if bonus_payment > 0 && n < BONUS_INTERVAL_MONTHS {
        return Err(CalcError::SyntaxError);
    }
    let monthly = inverse::principal_for(monthly_payment, rate, n)?;
    if bonus_payment == 0 {
        return Ok(BonusPrincipalResult {
            monthly_principal: monthly.principal,
            bonus_principal: 0,
            total_principal: monthly.principal,
            total_payment: monthly.total_payment,
            total_interest: monthly.total_interest,
        });
    }
    let bonus_rows = n / BONUS_INTERVAL_MONTHS;
    let bonus = inverse::principal_for(bonus_payment, &rate.half_year(), bonus_rows)?;
    let total_principal = sum(monthly.principal, bonus.principal)?;
    check_bonus_share(bonus.principal, total_principal)?;
    Ok(BonusPrincipalResult {
        monthly_principal: monthly.principal,
        bonus_principal: bonus.principal,
        total_principal,
        total_payment: sum(monthly.total_payment, bonus.total_payment)?,
        total_interest: sum(monthly.total_interest, bonus.total_interest)?,
    })
}

/// ボーナス分は元本の 50% まで(設計書 §4)。
fn check_bonus_share(bonus_principal: u64, principal: u64) -> CalcResult<()> {
    let doubled = bonus_principal.checked_mul(2).ok_or(CalcError::Overflow)?;
    if doubled > principal {
        return Err(CalcError::SyntaxError);
    }
    Ok(())
}

fn sum(a: u64, b: u64) -> CalcResult<u64> {
    a.checked_add(b).ok_or(CalcError::Overflow)
}

/// 月払い列だけの結果(テストの読みやすさのため)。
#[cfg(test)]
fn plain(principal: u64, rate: &Rate, n: u32) -> forward::LoanResult {
    forward::compute(principal, rate, n, 0).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bonus_zero_equals_the_plain_loan() {
        // 回帰恒等式(設計書 §7): ボーナス 0 円 = 通常式一致。
        let r = Rate::from_percent("1.5").unwrap();
        let plain = plain(30_000_000, &r, 420);
        let with = compute_forward(30_000_000, 0, &r, 420).unwrap();
        assert_eq!(with.monthly_payment, plain.monthly_payment);
        assert_eq!(with.total_payment, plain.total_payment);
        assert_eq!(with.bonus_payment, 0);
        assert_eq!(with.bonus_rows, 0);
    }

    #[test]
    fn bonus_over_half_is_rejected() {
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(
            compute_forward(1_000_000, 500_001, &r, 60),
            Err(CalcError::SyntaxError)
        );
        assert!(compute_forward(1_000_000, 500_000, &r, 60).is_ok());
    }

    #[test]
    fn bonus_needs_at_least_one_bonus_month() {
        // n < 6 でボーナス元本 > 0 は、ボーナス回が 1 回も来ない矛盾入力。
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(
            compute_forward(1_000_000, 100_000, &r, 5),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn the_bonus_column_runs_at_the_half_year_rate() {
        // 半年利 = 年利÷2 は月利の 6 倍。同じ元本・同じ回数で月利を使うより
        // 利息は必ず多くなる——取り違え(赤確認 6)をこの不等式が捕まえる。
        let r = Rate::from_percent("1.5").unwrap();
        let out = compute_forward(30_000_000, 6_000_000, &r, 420).unwrap();
        assert_eq!(out.bonus_rows, 70);
        let monthly_part = plain(24_000_000, &r, 420);
        let bonus_at_monthly_rate = plain(6_000_000, &r, 70);
        assert!(
            out.total_interest > monthly_part.total_interest + bonus_at_monthly_rate.total_interest
        );
        // 出力は 2 列をそのまま足したもの。
        let bonus_part = plain(6_000_000, &r.half_year(), 70);
        assert_eq!(out.monthly_payment, monthly_part.monthly_payment);
        assert_eq!(out.bonus_payment, bonus_part.monthly_payment);
        assert_eq!(
            out.total_payment,
            monthly_part.total_payment + bonus_part.total_payment
        );
    }

    #[test]
    fn bonus_principal_inversion_is_two_independent_closed_forms() {
        // 借入可能額×ボーナス(設計書 §4-b): 2 入力 → 2 本独立逆算 → 合算、
        // ≤50% は解後検証。
        let r = Rate::from_percent("1.5").unwrap();
        let both = principal_for(80_000, 100_000, &r, 420).unwrap();
        let p1 = inverse::principal_for(80_000, &r, 420).unwrap().principal;
        assert_eq!(both.monthly_principal, p1);
        assert_eq!(
            both.total_principal,
            both.monthly_principal + both.bonus_principal
        );
        // ボーナス列は 70 回・半年利で独立に解かれている。
        let p2 = inverse::principal_for(100_000, &r.half_year(), 70)
            .unwrap()
            .principal;
        assert_eq!(both.bonus_principal, p2);
    }

    #[test]
    fn a_bonus_heavier_than_half_is_rejected_after_solving() {
        // 入力段では P が未知なので、50% 違反は解いた後にしか分からない。
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(
            principal_for(10_000, 500_000, &r, 60),
            Err(CalcError::SyntaxError)
        );
        // ボーナス 0 円なら通常の借入可能額に退化する。
        let plain_p = inverse::principal_for(80_000, &r, 420).unwrap().principal;
        assert_eq!(
            principal_for(80_000, 0, &r, 420).unwrap().total_principal,
            plain_p
        );
    }
}
