//! 償還表エンジン(設計書 §2 の中心)。
//!
//! 各行: 利息 = floor(残高×分子/分母)(厳密整数) → 元金 = 支払額 − 利息
//! → 残高更新。**f64 はこのファイルに存在しない**。
//! 内部は「期間ごとの利率列」を受けられる形に開けてある(変動金利 M7-8 への
//! 拡張点。公開 API は単一金利で、内部で同じ利率を繰り返すだけ)。

use super::rate::Rate;
use crate::{CalcError, CalcResult};

/// 償還表の実行結果。行そのものは持たない(表の表示はスコープ外)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    /// 実際に支払いが発生した回数(縮退入力では n より小さい)。
    pub rows_paid: u32,
    pub total_payment: u64,
    pub total_interest: u64,
    pub final_payment: u64,
    pub final_balance: u64,
}

/// 元利均等の償還表を走らせる。
///
/// `residual == 0`: 定例 `payment` × (n−1) 回 + 最終回 = 残高 + 利息
/// (端数は最終回が吸収し、増減どちらもあり得る。設計書 §2)。
///
/// `residual > 0`: 設計書 §3 の実慣行モデル。定例 `payment` × (n−2) 回 +
/// **調整回(n−1 回目)** + 最終回 = 残価。調整回で残高を
/// 「最終回の支払が残価をちょうど覆う値」に合わせる(下記 `residual_target`)。
///
/// 入力が表と噛み合わないとき(月額が初回利息を覆わない、残価に届く前に
/// 完済してしまう、調整回の支払が負になる)は SyntaxError。
pub fn run_schedule(
    principal: u64,
    rate: &Rate,
    n: u32,
    payment: u64,
    residual: u64,
) -> CalcResult<Schedule> {
    if n == 0 || principal == 0 || payment == 0 || residual >= principal {
        return Err(CalcError::SyntaxError);
    }
    if residual > 0 && n < 2 {
        // n=1 の残価は「均等 0 回 + 最終回 = 残価のみ」となり元本を返す回が
        // 存在しない。構造的に成立しない入力(設計書 §3 の帰結)。
        return Err(CalcError::SyntaxError);
    }
    // 発散(設計書 §2): 月額が初回利息以下だと残高が減らない。
    // 金利 0 のときは初回利息 0 < payment なので、この検査は素通りする。
    if payment <= rate.monthly_interest_floor(principal)? {
        return Err(CalcError::SyntaxError);
    }

    let mut run = Run {
        balance: principal,
        total_payment: 0,
        total_interest: 0,
        rows: 0,
    };
    // 定例回数: 残価なしは n−1 回(最終回が端数吸収)、残価ありは n−2 回
    // (n−1 回目が調整回、n 回目が残価)。
    let regular_rows = if residual == 0 { n - 1 } else { n - 2 };

    for _ in 0..regular_rows {
        let interest = rate.monthly_interest_floor(run.balance)?;
        let due = run
            .balance
            .checked_add(interest)
            .ok_or(CalcError::Overflow)?;
        if due <= payment {
            // 縮退(設計書 §2): 定例回の途中で払い切れる。以後の回は支払 0。
            if residual > 0 {
                // 残価を返す前に完済してしまう矛盾入力。
                return Err(CalcError::SyntaxError);
            }
            run.pay(due, interest)?;
            return Ok(run.finish(due));
        }
        run.pay(payment, interest)?;
        run.balance = due - payment;
    }

    if residual == 0 {
        // 最終回 = 残高 + 利息。
        let interest = rate.monthly_interest_floor(run.balance)?;
        let due = run
            .balance
            .checked_add(interest)
            .ok_or(CalcError::Overflow)?;
        run.pay(due, interest)?;
        return Ok(run.finish(due));
    }

    // 調整回(n−1 回目): 残高を residual_target まで落とす。
    let target = residual_target(residual, rate);
    let interest = rate.monthly_interest_floor(run.balance)?;
    let due = run
        .balance
        .checked_add(interest)
        .ok_or(CalcError::Overflow)?;
    // 残高が既に目標を下回っている = 定例額が大きすぎる矛盾入力。
    let adjusted = due.checked_sub(target).ok_or(CalcError::SyntaxError)?;
    run.pay(adjusted, interest)?;
    run.balance = target;

    // 最終回: 残価のみ(設計書 §3)。
    let interest = rate.monthly_interest_floor(run.balance)?;
    let due = run
        .balance
        .checked_add(interest)
        .ok_or(CalcError::Overflow)?;
    run.pay(due, interest)?;
    Ok(run.finish(due))
}

/// **逆算の確定規則**(設計書 §5)。Python 参照と共有する公開契約であり、
/// 候補の出し方(f64 か Decimal か)は独立でよいが、この判定は同一でなければ
/// golden が一致しない。
///
/// 「n 回で完済する」= 定例 `payment` を n−1 回払ったあと、最終回の
/// 残高 + 利息が `payment` 以下に収まること。表が途中で払い切る(縮退)場合も
/// 完済である。月額が利息を覆わないなどで表が組めない入力は「完済しない」
/// (Overflow だけは伝播させる——それは入力の外にある事故)。
pub fn clears_within(principal: u64, rate: &Rate, n: u32, payment: u64) -> CalcResult<bool> {
    match run_schedule(principal, rate, n, payment, 0) {
        Ok(s) => Ok(s.final_payment <= payment),
        Err(CalcError::SyntaxError) => Ok(false),
        Err(e) => Err(e),
    }
}

/// 走行中の状態。checked 演算を 1 か所に閉じる。
struct Run {
    balance: u64,
    total_payment: u64,
    total_interest: u64,
    rows: u32,
}

impl Run {
    fn pay(&mut self, payment: u64, interest: u64) -> CalcResult<()> {
        self.total_payment = self
            .total_payment
            .checked_add(payment)
            .ok_or(CalcError::Overflow)?;
        self.total_interest = self
            .total_interest
            .checked_add(interest)
            .ok_or(CalcError::Overflow)?;
        self.rows += 1;
        Ok(())
    }

    fn finish(self, final_payment: u64) -> Schedule {
        Schedule {
            rows_paid: self.rows,
            total_payment: self.total_payment,
            total_interest: self.total_interest,
            final_payment,
            final_balance: 0,
        }
    }
}

/// 最終回の直前に残しておく残高 X。
///
/// 最終回の支払は X + floor(X·r) なので、**残価 B を超えない最大の X** を選ぶ
/// (全金銭計算を切り捨てに揃える設計書 §2 の 1 語と同じ向き)。
///
/// f(X) = X + floor(X·r) は単調非減少で 1 か 2 ずつ増えるため、**B を飛ばす
/// ことがある**。飛んだときの最終回は B − 1 円になる(B + 1 円にはしない)。
///
/// 実数解は X* = B·den/(den+num)。X₀ = floor(X*) は f(X₀) ≤ X₀(1+r) ≤ B を
/// 満たし、f(X₀+2) > B なので、候補は X₀ と X₀+1 の 2 つだけで足りる。
fn residual_target(residual: u64, rate: &Rate) -> u64 {
    let den = rate.denominator as u128;
    let num = rate.numerator as u128;
    let x0 = (residual as u128 * den / (den + num)) as u64;
    let f = |x: u64| -> u128 { x as u128 + (x as u128 * num) / den };
    if x0 < u64::MAX && f(x0 + 1) <= residual as u128 {
        x0 + 1
    } else {
        x0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_schedule_clears_the_balance_at_the_final_row() {
        // 12 回・年 1.2%。月額は仮に閉形式外から与える(このテストの主眼は
        // 表の力学: 利息→元金→残高、最終回の端数吸収)。
        let r = Rate::from_percent("1.2").unwrap();
        let s = run_schedule(1_000_000, &r, 12, 83_900, 0).unwrap();
        assert_eq!(s.rows_paid, 12);
        assert_eq!(s.final_balance, 0);
        // 総支払 = 月額×11 + 最終回。最終回は増減どちらもあり得る(設計書 §2)。
        assert_eq!(s.total_payment, 83_900 * 11 + s.final_payment);
        // 総利息 = 総支払 − 元本(残価 0 のとき)。
        assert_eq!(s.total_interest, s.total_payment - 1_000_000);
    }

    #[test]
    fn zero_rate_schedule_charges_no_interest() {
        let r = Rate::from_percent("0").unwrap();
        let s = run_schedule(1_200_000, &r, 12, 100_000, 0).unwrap();
        assert_eq!(s.total_interest, 0);
        assert_eq!(s.total_payment, 1_200_000);
    }

    #[test]
    fn degenerate_input_stops_early() {
        // 極小元本×長期間: 残高が n 回前に 0 になったら打ち切り(設計書 §2)。
        let r = Rate::from_percent("1.0").unwrap();
        let s = run_schedule(10_000, &r, 600, 5_000, 0).unwrap();
        assert!(s.rows_paid < 600);
        assert_eq!(s.final_balance, 0);
        assert_eq!(s.total_payment, s.total_interest + 10_000);
    }

    #[test]
    fn residual_final_row_is_the_residual_alone() {
        // 残価 B: 均等×(n−2) 回 + 調整回 + 最終回 = 残価のみ(設計書 §3)。
        let r = Rate::from_percent("2.0").unwrap();
        let s = run_schedule(3_000_000, &r, 36, 55_000, 1_200_000).unwrap();
        assert_eq!(s.rows_paid, 36);
        assert_eq!(s.final_payment, 1_200_000); // 最終回は B ちょうど
        assert_eq!(s.final_balance, 0);
        // 利息は残価込みの全残高にかかる(設計書 §3)。総支払は B 込みの完済総額。
        assert_eq!(s.total_payment, s.total_interest + 3_000_000);
    }

    #[test]
    fn residual_falls_one_yen_short_when_the_final_row_skips_it() {
        // f(X) = X + floor(X·r) は B を飛ばすことがある。年 2%(r = 1/600)で
        // B = 1201 は像に無い: f(1199) = 1200、f(1200) = 1202。
        // 切り捨てに揃える規約により、最終回は B − 1 = 1200 円になる。
        let r = Rate::from_percent("2.0").unwrap();
        let s = run_schedule(100_000, &r, 12, 9_000, 1_201).unwrap();
        assert_eq!(s.rows_paid, 12);
        assert_eq!(s.final_payment, 1_200);
        assert_eq!(s.final_balance, 0);
    }

    #[test]
    fn payment_not_covering_interest_is_an_error() {
        // 月額 ≤ 初回利息は発散(設計書 §2 のエラー表)。
        let r = Rate::from_percent("12.0").unwrap(); // 月 1%
        assert_eq!(
            run_schedule(1_000_000, &r, 120, 10_000, 0),
            Err(CalcError::SyntaxError)
        );
        // ちょうど利息と同額でも残高が減らない。
        assert_eq!(
            run_schedule(1_000_000, &r, 120, 10_000, 0),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn the_error_table_is_syntax_errors() {
        // 設計書 §2 のエラー表: 回数 0 / 元本 0 / 残価 ≥ 元本。
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(
            run_schedule(1_000_000, &r, 0, 50_000, 0),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            run_schedule(0, &r, 12, 50_000, 0),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            run_schedule(1_000_000, &r, 12, 50_000, 1_000_000),
            Err(CalcError::SyntaxError)
        );
        // 残価は 2 回以上でないと成立しない。
        assert_eq!(
            run_schedule(1_000_000, &r, 1, 50_000, 500_000),
            Err(CalcError::SyntaxError)
        );
        // 支払 0 は永久に終わらない入力。
        assert_eq!(
            run_schedule(1_000_000, &r, 12, 0, 0),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn a_payment_too_large_for_the_residual_is_rejected() {
        // 定例額が大きすぎると、調整回より前に残価を割ってしまう。
        let r = Rate::from_percent("2.0").unwrap();
        assert_eq!(
            run_schedule(3_000_000, &r, 36, 200_000, 1_200_000),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn interest_rides_on_the_whole_balance_including_the_residual() {
        // 設計書 §3: 利息は (P−B) ではなく残価込みの全残高にかかる。
        // 同じ定例額で B を積むほど、同じ回数での総利息は増える。
        let r = Rate::from_percent("2.0").unwrap();
        let low = run_schedule(3_000_000, &r, 36, 55_000, 600_000).unwrap();
        let high = run_schedule(3_000_000, &r, 36, 55_000, 1_200_000).unwrap();
        assert!(high.total_interest > low.total_interest);
    }
}
