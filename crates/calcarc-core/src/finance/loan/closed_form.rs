//! 閉形式による月額の**候補**計算。f64 はこのファイルと `inverse` にしか
//! 存在しない(設計書 §1-3)。
//!
//! `(1+r)^n − 1` は素朴に計算せず `expm1(n·log1p(r))` で評価する(低金利での
//! 桁落ち回避。素朴式は年 0.001% で ~1e-5 円まで悪化する——設計書 §1-3)。
//! 誤差上限は入力依存で概ね 月額 × max(n·ε/2, ε/(2r))。
//!
//! 出た候補は必ず切り捨てる。**理由は円単位の支払を決定的に決めるため**である
//! (「安全な向き」ではない——月額は理論値の切り捨てから上下 1 円ずれうるし、
//! 総利息は月額に従って決まる。numerical-policy.md の「定例月額の許容」)。
//! 端数は最終回(残価ありなら調整回)が吸収する。

use super::rate::Rate;
use crate::{CalcError, CalcResult};

/// f64 で決める月額の上限(円)。**これを超える月額は答えを出さず `Overflow` にする。**
///
/// 月額は f64 で決めるので、金額が大きいと切り捨てが理論値から 1 円を超えてずれうる
/// (Python で閉形式を写した計算で、年 0.0001%・2 回の月額約 45 億円から 1 円に届いた)。
/// 精度を確かめたのはここまで——出どころは `docs/numerical-policy.md` の節
/// 「定例月額の許容(2026-09-12、外部監査 F2・利用者の裁定)」で、同じ数を
/// `testdata/loan_boundary.json` の `max_monthly_yen` が持つ(参照実装が照合する)。
///
/// **比べるのは切り捨てたあとの月額**——ちょうど 10 億円は通す(境界 golden の
/// `residual/exact/15/2/987654400/81`)。**f64 を通らない経路(金利 0%・1 回払い)と
/// 逆算の答えには掛けない**(0.9.2 設計書 §9 の 7)。
const MAX_VERIFIED_MONTHLY_YEN: u64 = 1_000_000_000;

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
/// `pow_1p` から 1 を引き戻して `x` を作る。**1 を足した時点で下位の桁が落ちている**ので、
/// `x` は `expm1(n·log1p(r))` の値そのものではない(絶対誤差がおよそ ε/2 残る)。
/// 素朴な `powi` よりは良いが、円の境界では 1 円ずれうる——許容は numerical-policy.md の
/// 「定例月額の許容」、見張りは `tests/loan_boundary_golden.rs` と wasm32 の同じ検査。
pub(super) fn annuity(r: f64, n: u32) -> f64 {
    let x = pow_1p(r, n) - 1.0; // expm1 に 1 を足して引いた値(下位の桁は落ちている)
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
/// f64 の枝の答えは `MAX_VERIFIED_MONTHLY_YEN` まで(超えたら `Overflow`)。
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
    let monthly = a as u64; // 円未満切り捨て(設計書 §2 の 1 語)
    if monthly > MAX_VERIFIED_MONTHLY_YEN {
        // 精度を確かめていない答えは出さない(0.9.2 設計書 §5.1。画面は既存の Math ERROR)。
        return Err(CalcError::Overflow);
    }
    Ok(monthly)
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

    #[test]
    fn a_monthly_payment_above_the_verified_cap_is_an_error() {
        // 0.9.2 設計書 §5.1(外部監査 F2 の追加の裁定): f64 で決める月額は 10 億円まで
        // しか精度を確かめていない。**切り捨てた月額**がそれを超えたら答えを出さない。
        let r = Rate::from_percent("1").unwrap();
        // 理論月額は約 1,001,250,000 円(上限 + 2 円より十分に上。境目の 1 円は f64 で揺れる)。
        assert_eq!(
            monthly_payment(2_000_000_000, &r, 2, 0),
            Err(CalcError::Overflow)
        );
        // 上限の下は答えが出る(約 996,000,000 円)。
        assert!(monthly_payment(1_990_000_000, &r, 2, 0).is_ok());
    }

    #[test]
    fn exactly_the_cap_is_still_an_answer() {
        // ちょうど 10 億円は通す(calcarc-1e の条件 2)。calcarc-88 の境界 golden の
        // `residual/exact/15/2/987654400/81`(`monthly_floor` = 1,000,000,000)と同じ入力。
        let r = Rate::from_percent("15").unwrap();
        assert_eq!(monthly_payment(987_654_400, &r, 2, 81), Ok(1_000_000_000));
    }

    #[test]
    fn the_exact_paths_are_outside_the_cap() {
        // 金利 0% と 1 回払いは f64 を通らない厳密な経路で、精度の心配が無い(§9 の 7)。
        // 0%: finance.json の `loan_forward/18446744073709551615/0/600/0` と同じ答え。
        let zero = Rate::from_percent("0").unwrap();
        assert_eq!(
            monthly_payment(18_446_744_073_709_551_615, &zero, 600, 0),
            Ok(30_744_573_456_182_586)
        );
        let r = Rate::from_percent("1").unwrap();
        assert!(monthly_payment(5_000_000_000, &r, 1, 0).is_ok());
    }
}
