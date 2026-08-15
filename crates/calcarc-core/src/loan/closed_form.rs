//! 閉形式による月額の**候補**計算。f64 はこのファイルと `inverse` にしか
//! 存在しない(設計書 §1-3)。
//!
//! `(1+r)^n − 1` は素朴に計算せず `expm1(n·log1p(r))` で評価する(低金利での
//! 桁落ち回避。素朴式は年 0.001% で ~1e-5 円まで悪化する——設計書 §1-3)。
//! 誤差上限は入力依存で概ね 月額 × max(n·ε/2, ε/(2r))。
//!
//! 出た候補は必ず切り捨てる。**切り捨ては安全な向き**である: 月額が理論値を
//! 下回るぶん残高が高めに残り、端数は最終回(残価ありなら調整回)が吸収する。

use super::rate::Rate;
use crate::{CalcError, CalcResult};

/// (1+r)^n。素朴な `powi` ではなく expm1/log1p 経由で評価する。
///
/// 素朴式は低金利で桁落ちし、年 0.001% では ~1e-5 円まで悪化する
/// (設計書 §1-3)。**これは f64 の弱点への対処であって、複利(厳密整数)
/// からは呼ばれない。**
pub(super) fn pow_1p(r: f64, n: u32) -> f64 {
    f64::exp_m1(n as f64 * f64::ln_1p(r)) + 1.0
}

/// 年金現価 (1 − (1+r)^{−n})/r。r > 0 を前提とする(呼び出し側が 0 を弾く)。
///
/// 内側で `pow_1p` から 1 を引き戻すのは意図的である。桁落ちが起きるのは
/// `(1+r)^n − 1` の側で、その値を `x` として保持したまま使う。expm1 の値
/// そのものを返す関数を別に作ると、呼び出し側が 2 種類を取り違える。
pub(super) fn annuity(r: f64, n: u32) -> f64 {
    let x = pow_1p(r, n) - 1.0; // = expm1(n·log1p(r))
    (x / (x + 1.0)) / r
}

/// 元利均等の月額。
///
/// 残価 B(既定 0)は設計書 §3 の実慣行モデル:
/// P = A·annuity(n−1) + B/(1+r)^n を A について解く
/// (annuity(m) = (1 − (1+r)^{−m})/r)。
///
/// 金利 0% と 1 回払いは f64 を通さない——理論値が円境界ちょうどに乗るのが
/// 常態で、f64 の floor が式の書き方次第で 1 円ずれるため(設計書 §1-4)。
pub fn monthly_payment(principal: u64, rate: &Rate, n: u32, residual: u64) -> CalcResult<u64> {
    if n == 0 || principal == 0 || residual >= principal {
        return Err(CalcError::SyntaxError);
    }
    if residual > 0 && n < 2 {
        return Err(CalcError::SyntaxError);
    }
    if rate.is_zero() {
        // (P − B)/n ではない: B は最終回に返すので、均等部分は
        // 残価 0 なら P/n、残価ありは (P − B)/(n−1)。
        return Ok(if residual == 0 {
            principal / n as u64
        } else {
            (principal - residual) / (n as u64 - 1)
        });
    }
    if n == 1 {
        // 厳密経路(f64 不要)。residual は n<2 で拒否済み。
        let interest = rate.monthly_interest_floor(principal)?;
        return principal.checked_add(interest).ok_or(CalcError::Overflow);
    }
    let r = rate.as_f64_monthly();
    let pow_n = pow_1p(r, n);
    // 残価ありは n−1 回目が調整回なので、年金現価は n−1 回ぶん(設計書 §3)。
    let annuity_m = annuity(r, if residual == 0 { n } else { n - 1 });
    let pv = principal as f64 - residual as f64 / pow_n;
    if pv <= 0.0 || annuity_m <= 0.0 {
        return Err(CalcError::SyntaxError);
    }
    let a = pv / annuity_m;
    if !a.is_finite() || a < 0.0 || a >= u64::MAX as f64 {
        return Err(CalcError::Overflow);
    }
    Ok(a as u64) // 円未満切り捨て(設計書 §2 の 1 語)
}

#[cfg(test)]
mod tests {
    use super::super::schedule::run_schedule;
    use super::*;

    #[test]
    fn zero_rate_is_principal_over_n() {
        // 端数元本で採録(設計書 §1-4: 丸い元本は境界ちょうどが常態)。
        let r = Rate::from_percent("0").unwrap();
        assert_eq!(monthly_payment(2_999_999, &r, 12, 0).unwrap(), 249_999);
    }

    #[test]
    fn zero_rate_with_a_residual_spreads_the_rest() {
        // 残価は最終回に返すので、均等部分は (P − B)/(n−1)。
        let r = Rate::from_percent("0").unwrap();
        let a = monthly_payment(2_999_999, &r, 12, 1_000_000).unwrap();
        assert_eq!(a, (2_999_999 - 1_000_000) / 11);
        let s = run_schedule(2_999_999, &r, 12, a, 1_000_000).unwrap();
        assert_eq!(s.final_payment, 1_000_000);
    }

    #[test]
    fn single_payment_is_principal_plus_interest() {
        // 1 回払い: 月額 = P + floor(P×月利)。これは表と一致する厳密経路で
        // 計算できるので f64 を使わない(設計書 §1-4 の衝突を根から回避)。
        let r = Rate::from_percent("2.4").unwrap(); // 月 0.2%
        let p = 2_999_999u64;
        let expected = p + r.monthly_interest_floor(p).unwrap();
        assert_eq!(monthly_payment(p, &r, 1, 0).unwrap(), expected);
        // 表もその 1 回で閉じる。
        let s = run_schedule(p, &r, 1, expected, 0).unwrap();
        assert_eq!((s.rows_paid, s.final_payment), (1, expected));
    }

    #[test]
    fn the_closed_form_uses_expm1() {
        // 低金利で素朴式 (1+r)^n − 1 と食い違わないこと自体は golden の守備。
        // ここでは「月額で表が n 回で完済する」動力学のみ固定する。
        let r = Rate::from_percent("1.5").unwrap();
        let a = monthly_payment(30_000_000, &r, 420, 0).unwrap();
        let s = run_schedule(30_000_000, &r, 420, a, 0).unwrap();
        assert_eq!(s.rows_paid, 420);
        assert_eq!(s.final_balance, 0);
        // 切り捨てた分は最終回が吸収する。ずれは月額 1 回ぶんに収まる。
        assert!(s.final_payment <= a * 2);
    }

    #[test]
    fn a_very_low_rate_still_lands_on_the_schedule() {
        // 素朴式が最も崩れる領域(年 0.001%)。expm1/log1p 経路なら表と噛み合う。
        let r = Rate::from_percent("0.001").unwrap();
        let a = monthly_payment(30_000_000, &r, 420, 0).unwrap();
        let s = run_schedule(30_000_000, &r, 420, a, 0).unwrap();
        assert_eq!(s.rows_paid, 420);
        assert!(s.final_payment <= a * 2);
    }

    #[test]
    fn residual_reduces_the_monthly_payment() {
        // P = A·annuity(n−1) + B/(1+r)^n(設計書 §3)。B が増えると A は減る。
        let r = Rate::from_percent("2.0").unwrap();
        let a0 = monthly_payment(3_000_000, &r, 36, 0).unwrap();
        let a1 = monthly_payment(3_000_000, &r, 36, 1_200_000).unwrap();
        assert!(a1 < a0);
        // その月額で表が最後まで走り、最終回は残価ちょうど。
        let s = run_schedule(3_000_000, &r, 36, a1, 1_200_000).unwrap();
        assert_eq!(s.rows_paid, 36);
        assert_eq!(s.final_payment, 1_200_000);
    }

    #[test]
    fn the_error_table_is_shared_with_the_schedule() {
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(
            monthly_payment(1_000_000, &r, 0, 0),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(monthly_payment(0, &r, 12, 0), Err(CalcError::SyntaxError));
        assert_eq!(
            monthly_payment(1_000_000, &r, 12, 1_000_000),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            monthly_payment(1_000_000, &r, 1, 500_000),
            Err(CalcError::SyntaxError)
        );
    }
}
