//! 逆算 2 種(設計書 §5)。原則は**「f64 が候補を出し、厳密整数の償還表が
//! 答を確定する」**。
//!
//! 候補は種にすぎない。確定は `schedule::clears_within`(Python 参照と共有する
//! 公開契約)への単調探索で行うので、答は候補の精度に依存しない。
//!
//! 種を「±数円の歩き」で済ませないのは実測による: 3,000 万・35 年・1.5% 級の
//! 借入可能額で、厳密表の答は f64 候補より **167 円**高い。各行の利息切り捨てが
//! 積み上がって連続式より借りられるためで、差は回数と金利とともに育つ。

use super::closed_form::annuity;
use super::rate::Rate;
use super::schedule::{clears_within, run_schedule};
use crate::{CalcError, CalcResult};

/// 期間逆算が探す上限(月)。100 年。
///
/// 月額が初回利息をわずかに上回るだけの入力は、数学的には収束しても
/// 現実の期間に収まらない。上限を超えるものは事実上の発散として弾く
/// (探索コストの上限でもある)。
pub const MAX_TERM_MONTHS: u32 = 1_200;

/// 期間逆算の結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TermResult {
    /// 完済に要する回数(月)。
    pub n: u32,
    pub total_payment: u64,
    pub total_interest: u64,
    pub final_payment: u64,
}

/// 借入可能額逆算の結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrincipalResult {
    pub principal: u64,
    pub total_payment: u64,
    pub total_interest: u64,
    pub final_payment: u64,
    pub rows_paid: u32,
}

/// 期間逆算: 元本・金利・月額から「完済する最小の回数」。
///
/// 0% は f64 を通さず n = ceil(P/A)(整数演算で ceil できる)。
/// それ以外は候補 m = −ln1p(−P·r/A)/ln1p(r) を種に、表で単調に確定する。
pub fn term_for(principal: u64, rate: &Rate, payment: u64) -> CalcResult<TermResult> {
    if principal == 0 || payment == 0 {
        return Err(CalcError::SyntaxError);
    }
    // 発散(設計書 §2/§5): 月額が初回利息を覆わない。
    if payment <= rate.monthly_interest_floor(principal)? {
        return Err(CalcError::SyntaxError);
    }

    let seed = if rate.is_zero() {
        // ceil(P/A) を整数で。
        let n = principal.div_ceil(payment);
        u32::try_from(n).unwrap_or(MAX_TERM_MONTHS)
    } else {
        let r = rate.as_f64_monthly();
        let ratio = principal as f64 * r / payment as f64;
        // 発散検査を通っているので ratio < 1。log の引数は 0 近傍で効くよう
        // ln_1p(-ratio) の形で評価する。
        let m = -f64::ln_1p(-ratio) / f64::ln_1p(r);
        if !m.is_finite() || m <= 0.0 {
            return Err(CalcError::SyntaxError);
        }
        let candidate = m.ceil();
        if candidate >= MAX_TERM_MONTHS as f64 {
            MAX_TERM_MONTHS
        } else {
            candidate as u32
        }
    };

    let n = smallest_term_that_clears(principal, rate, payment, seed.clamp(1, MAX_TERM_MONTHS))?;
    let s = run_schedule(principal, rate, n, payment, 0)?;
    Ok(TermResult {
        n,
        total_payment: s.total_payment,
        total_interest: s.total_interest,
        final_payment: s.final_payment,
    })
}

/// 借入可能額逆算: 月額・金利・回数から「n 回以内に表が完済する最大の元本」。
///
/// 0% は P = A·n(整数演算)。それ以外は候補 P₀ = A·annuity(n) を種に、
/// 「完済する / しない」の境界を挟み撃ちで確定する。
pub fn principal_for(payment: u64, rate: &Rate, n: u32) -> CalcResult<PrincipalResult> {
    if payment == 0 || n == 0 {
        return Err(CalcError::SyntaxError);
    }
    let principal = if rate.is_zero() {
        payment.checked_mul(n as u64).ok_or(CalcError::Overflow)?
    } else {
        let r = rate.as_f64_monthly();
        let candidate = payment as f64 * annuity(r, n);
        if !candidate.is_finite() || candidate >= u64::MAX as f64 {
            return Err(CalcError::Overflow);
        }
        largest_principal_that_clears(rate, n, payment, (candidate as u64).max(1))
    };
    let s = run_schedule(principal, rate, n, payment, 0)?;
    Ok(PrincipalResult {
        principal,
        total_payment: s.total_payment,
        total_interest: s.total_interest,
        final_payment: s.final_payment,
        rows_paid: s.rows_paid,
    })
}

/// 種から歩いて「完済する最小の n」を確定する。
///
/// `clears_within` は n について単調(回数が増えて完済しなくなることはない)
/// なので、上下どちらかへ一方向に歩けば足りる。歩数は実際には 0〜2 歩だが、
/// 打ち切りは候補の質ではなく `MAX_TERM_MONTHS` が保証する。
fn smallest_term_that_clears(
    principal: u64,
    rate: &Rate,
    payment: u64,
    seed: u32,
) -> CalcResult<u32> {
    if probe(principal, rate, seed, payment) {
        let mut n = seed;
        while n > 1 && probe(principal, rate, n - 1, payment) {
            n -= 1;
        }
        return Ok(n);
    }
    let mut n = seed;
    while n < MAX_TERM_MONTHS {
        n += 1;
        if probe(principal, rate, n, payment) {
            return Ok(n);
        }
    }
    // 100 年でも終わらない = 事実上の発散(設計書 §2 のエラー表と同じ扱い)。
    Err(CalcError::SyntaxError)
}

/// 探索中の一手。**u64 に収まらない元本は「完済しない側」として扱う**——
/// 探索を u64 の定義域で閉じるためで、選ばれた答は最後に必ず表を走り切る
/// (走り切れないなら、そのとき Overflow が出る)。
fn probe(principal: u64, rate: &Rate, n: u32, payment: u64) -> bool {
    matches!(clears_within(principal, rate, n, payment), Ok(true))
}

/// 種を挟んで「n 回で完済する最大の元本」を二分探索で確定する。
///
/// `clears_within` は元本について単調(元本が増えて完済しやすくなることは
/// ない)。元本 1 は必ず完済するので下限に使える。上限は種の倍々で作る。
fn largest_principal_that_clears(rate: &Rate, n: u32, payment: u64, seed: u64) -> u64 {
    let mut low = 1u64; // 完済する側
    let mut high = seed; // これから「完済しない側」にする
    while probe(high, rate, n, payment) {
        low = high;
        if high == u64::MAX {
            return u64::MAX;
        }
        high = high.saturating_mul(2);
    }
    while high - low > 1 {
        let mid = low + (high - low) / 2;
        if probe(mid, rate, n, payment) {
            low = mid;
        } else {
            high = mid;
        }
    }
    low
}

#[cfg(test)]
mod tests {
    use super::super::closed_form::monthly_payment;
    use super::*;

    #[test]
    fn term_is_the_smallest_n_that_clears() {
        let r = Rate::from_percent("1.5").unwrap();
        let a = monthly_payment(30_000_000, &r, 420, 0).unwrap();
        let t = term_for(30_000_000, &r, a).unwrap();
        // 正算の月額なら同じ n に戻る(往復一致)。
        assert_eq!(t.n, 420);
        // 決定性の定義そのもの: n−1 では完済せず、n では完済する。
        assert!(clears_within(30_000_000, &r, t.n, a).unwrap());
        assert!(!clears_within(30_000_000, &r, t.n - 1, a).unwrap());
        assert_eq!(t.total_interest, t.total_payment - 30_000_000);
    }

    #[test]
    fn term_diverges_when_payment_cannot_cover_interest() {
        let r = Rate::from_percent("12.0").unwrap();
        assert_eq!(term_for(1_000_000, &r, 10_000), Err(CalcError::SyntaxError));
        // 100 年で終わらない入力も同じ扱い。月額が利息を 1 円上回るだけだと
        // 元本が大きいほど遅く、ここでは数千万回かかる。
        let interest = r.monthly_interest_floor(100_000_000).unwrap();
        assert_eq!(
            term_for(100_000_000, &r, interest + 1),
            Err(CalcError::SyntaxError)
        );
        // 一方、元本が小さければ各行の利息切り捨てが効いて 100 年内に終わる
        // ——終わるかどうかを決めるのは f64 ではなく厳密表である(設計書 §5)。
        let small = r.monthly_interest_floor(1_000_000).unwrap();
        assert!(term_for(1_000_000, &r, small + 1).unwrap().n < MAX_TERM_MONTHS);
    }

    #[test]
    fn zero_rate_term_is_integer_ceil() {
        // 0% は f64 不要: n = ceil(P/A) を整数演算で。
        let r = Rate::from_percent("0").unwrap();
        assert_eq!(term_for(1_200_000, &r, 100_000).unwrap().n, 12);
        assert_eq!(term_for(1_200_001, &r, 100_000).unwrap().n, 13);
    }

    #[test]
    fn term_rounds_up_at_the_boundary() {
        // ちょうど割り切れる n と、1 円足した n+1(設計書 §7 の必須ケース)。
        let r = Rate::from_percent("2.0").unwrap();
        let a = 50_000u64;
        let exact = principal_for(a, &r, 24).unwrap().principal;
        assert_eq!(term_for(exact, &r, a).unwrap().n, 24);
        assert_eq!(term_for(exact + 1, &r, a).unwrap().n, 25);
    }

    #[test]
    fn principal_is_the_largest_that_clears() {
        let r = Rate::from_percent("1.5").unwrap();
        let p = principal_for(85_000, &r, 420).unwrap();
        // 定義の両側: p.principal は n 回以内に完済し、+1 円は完済しない。
        assert!(clears_within(p.principal, &r, 420, 85_000).unwrap());
        assert!(!clears_within(p.principal + 1, &r, 420, 85_000).unwrap());
        assert_eq!(p.rows_paid, 420);
        // 答は f64 候補(この入力では 27,761,044 円)より 100 円以上高い。
        // 各行の利息切り捨てが積むぶんで、「候補から数円歩く」では届かない。
        assert!(p.principal > 27_761_044 + 100);
    }

    #[test]
    fn zero_rate_principal_is_payment_times_n() {
        let r = Rate::from_percent("0").unwrap();
        let p = principal_for(100_000, &r, 12).unwrap();
        assert_eq!(p.principal, 1_200_000);
        assert_eq!(p.total_interest, 0);
    }

    #[test]
    fn the_inversions_agree_with_each_other() {
        // 借入可能額 → その元本で期間逆算 → 同じ回数に戻る。
        let r = Rate::from_percent("3.0").unwrap();
        let p = principal_for(60_000, &r, 120).unwrap();
        assert_eq!(term_for(p.principal, &r, 60_000).unwrap().n, 120);
    }

    #[test]
    fn the_inverse_error_table_is_syntax_errors() {
        let r = Rate::from_percent("1.5").unwrap();
        assert_eq!(term_for(0, &r, 50_000), Err(CalcError::SyntaxError));
        assert_eq!(term_for(1_000_000, &r, 0), Err(CalcError::SyntaxError));
        assert_eq!(principal_for(0, &r, 12), Err(CalcError::SyntaxError));
        assert_eq!(principal_for(50_000, &r, 0), Err(CalcError::SyntaxError));
    }
}
