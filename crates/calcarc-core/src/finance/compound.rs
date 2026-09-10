//! 複利(一括預入・毎月積立)。**厳密整数だけで走る**——f64 は無い。
//!
//! 1 期の演算はローンの各行利息と同一の floor(残高×分子/分母) である。
//! 違うのは**切り捨てを選ぶ根拠**のほうで、ローンでは「安全な向き」、
//! ここでは「慣行の再現」になる(numerical-policy「複利は同じ切り捨て、
//! 違う理由」)。
//!
//! 積立の位置は選べる。**既定は期末**——利息を付けてから足す。その期に
//! 入れた金はその期の利息を生まない。期首を選ぶと積立が利息の前に入り、
//! その期の利息を生む(設計書 2026-09-03 §5.4)。

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

/// 積立を期のどちらの端で入れるか。**既定は期末**(設計書 §5.4.1)。
///
/// 期首は**増える選択肢**であって「正しい答」ではない。既定を動かすと
/// 同じ入力に対する答が黙って変わり、`testdata/` の複利 golden が全部
/// 動く——それは「直し」ではなく**「別のものになった」**である。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DepositTiming {
    /// 期末。利息を付けてから積立を足す。**既定**。
    #[default]
    End,
    /// 期首。積立を足してから利息を付ける。その期に入れた金にも利息が付く。
    Start,
}

/// 1 期ぶん進める。**漸化式はここ 1 か所しか無い。**
///
/// `grow_with_timing` と `compound_inverse::periods_for_with_timing` の
/// 両方がこれを呼ぶ。以前は逆算側が式を書き写していて、写しがずれても
/// 答がもっともらしいままになる形だった。**位置の分岐が増えると口が 2 つに
/// なる**ので、分岐を足すのと同じ変更で 1 か所に寄せた。
pub(super) fn step(
    balance: u64,
    deposit: u64,
    rate: &Rate,
    timing: DepositTiming,
) -> CalcResult<u64> {
    let balance = match timing {
        DepositTiming::End => balance,
        DepositTiming::Start => balance.checked_add(deposit).ok_or(CalcError::Overflow)?,
    };
    let interest = rate.interest_floor(balance)?;
    let balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
    match timing {
        DepositTiming::End => balance.checked_add(deposit).ok_or(CalcError::Overflow),
        DepositTiming::Start => Ok(balance),
    }
}

/// 期を回す(**積立は期末**)。位置を選ぶなら `grow_with_timing`。
///
/// **位置を取らないこの入口が既定の経路である。** 既定が動いていないことを
/// リテラルで見張れるよう、入口を分けてある(設計書 §5.4.6)。境界も golden も
/// この入口を通っており、`testdata/` を再生成せずに緑であることが
/// 「既定は 1 ミリも動いていない」の証拠になる。
pub fn grow(principal: u64, deposit: u64, rate: &Rate, periods: u32) -> CalcResult<Growth> {
    grow_with_timing(principal, deposit, rate, periods, DepositTiming::default())
}

/// 期を回す。**答はこのループが出す。**
pub fn grow_with_timing(
    principal: u64,
    deposit: u64,
    rate: &Rate,
    periods: u32,
    timing: DepositTiming,
) -> CalcResult<Growth> {
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
        balance = step(balance, deposit, rate, timing)?;
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
        // **この種は既定の見張りにならない。** 積立が 0 なので期首でも
        // 同じ 1,051,136 が出る(実測)。既定を見張るのは積立のあるほう
        // ——`a_deposit_lands_at_the_end_of_the_period` と
        // `the_casio_fc_100_monthly_example_pins_both_timings` である。
        assert_eq!(
            grow_with_timing(1_000_000, 0, &r, 10, DepositTiming::Start)
                .unwrap()
                .final_balance,
            1_051_136
        );
    }

    #[test]
    fn the_default_timing_is_the_end_of_the_period() {
        // **既定は期末**(設計書 §5.4.1)。型の既定と、位置を取らない入口の
        // 両方を押さえる。golden ではなくここに置くのは、`testdata/` は
        // 再生成すれば緑になるので既定の見張りにならないからである。
        assert_eq!(DepositTiming::default(), DepositTiming::End);
        let r = Rate::from_annual_percent("12", 12).unwrap();
        let by_default = grow(0, 10_000, &r, 2).unwrap();
        assert_eq!(
            by_default,
            grow_with_timing(0, 10_000, &r, 2, DepositTiming::End).unwrap()
        );
        // 判別ケース: 位置が効く入力であることを、対照で言い切っておく。
        assert_ne!(
            by_default,
            grow_with_timing(0, 10_000, &r, 2, DepositTiming::Start).unwrap()
        );
    }

    #[test]
    fn a_deposit_at_the_start_of_the_period_earns_interest_in_that_period() {
        // 期首なので、最初の期の利息が積立額に付く。
        // 1 期目: 10,000 を入れてから利息 100。2 期目: 20,100 に 10,000 を
        // 足してから利息 201。
        let r = Rate::from_annual_percent("12", 12).unwrap();
        let g = grow_with_timing(0, 10_000, &r, 2, DepositTiming::Start).unwrap();
        assert_eq!(g.final_balance, 20_301);
        assert_eq!(g.principal_total, 20_000);
        assert_eq!(g.interest, 301);
    }

    #[test]
    fn the_casio_fc_100_monthly_example_pins_both_timings() {
        // **外部の公表値との関係を固定する**(設計書 §5.2・§5.4.7)。
        // カシオ FC-100 の例題 ③: 毎月 2,500 円・年 6%・月複利・60 期。
        //
        //                    カシオ(閉形式・f64)   私たち(厳密整数)   差
        //   期末              174,425.0763          174,386          −39.08 円
        //   期首              175,297.2017          175,257          −40.20 円
        //
        // **カシオに合わせた値ではない**——私たちの整数ループが出す値であり、
        // 差は 1 期ごとの切り捨てが積み上がったものである(向きは常に一方向)。
        // この 2 本が動いたら、外部との関係が変わったということである。
        let r = Rate::from_annual_percent("6", 12).unwrap();
        assert_eq!(grow(0, 2_500, &r, 60).unwrap().final_balance, 174_386);
        assert_eq!(
            grow_with_timing(0, 2_500, &r, 60, DepositTiming::Start)
                .unwrap()
                .final_balance,
            175_257
        );
    }

    #[test]
    fn the_start_of_period_never_falls_short_of_the_end_of_period() {
        // 期首は「1 期ぶん先に入れた期末」ではない(切り捨てが期ごとに入る
        // ので厳密な等式にはならない)。**言えるのは向きだけ**——そして
        // **「積立があれば必ず上回る」も言えない**: 積立額に付く利息が
        // 1 円に満たなければ floor が飲み込む。**書いてから実測で外れた
        // 主張なので、外れた実例を残す**。
        //
        //   P=100 万 / d=7 / 年 3% / 月複利 / 1 期  期末 1,002,507 = 期首
        //     (7 円に付く 1 期の利息は 0.0175 円で、floor が消す)
        //   同じ入力で 240 期  期末 1,822,887 < 期首 1,822,894(差 7 円)
        let r = Rate::from_annual_percent("3", 12).unwrap();
        for periods in [1u32, 2, 12, 240, MAX_PERIODS] {
            for (principal, deposit) in [(1_000_000u64, 0u64), (0, 30_000), (1_000_000, 7)] {
                let end = grow(principal, deposit, &r, periods).unwrap();
                let start = grow_with_timing(principal, deposit, &r, periods, DepositTiming::Start)
                    .unwrap();
                assert_eq!(start.principal_total, end.principal_total);
                assert!(
                    start.final_balance >= end.final_balance,
                    "期首が期末を下回った: n={periods} P={principal} d={deposit}"
                );
                if deposit == 0 {
                    assert_eq!(start, end, "積立 0 では位置は結果を変えない");
                }
            }
        }
        // **判別ケース**: 上の向きだけでは「期首を期末と同じにする」変異が
        // すり抜ける(= でも >= は真)。差が出る入力をリテラルで押さえる。
        assert_eq!(grow(0, 30_000, &r, 12).unwrap().final_balance, 364_986);
        assert_eq!(
            grow_with_timing(0, 30_000, &r, 12, DepositTiming::Start)
                .unwrap()
                .final_balance,
            365_898
        );
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
        // 期首は積立を先に足すので、**1 期目であふれる**(期末なら 2 期目)。
        assert_eq!(
            grow_with_timing(u64::MAX, 1, &r, 1, DepositTiming::Start),
            Err(CalcError::Overflow)
        );
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
        // 位置は誤りの表を変えない。
        assert_eq!(
            grow_with_timing(1_000_000, 0, &r, 0, DepositTiming::Start),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            grow_with_timing(0, 0, &r, 12, DepositTiming::Start),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            grow_with_timing(1_000_000, 0, &r, MAX_PERIODS + 1, DepositTiming::Start),
            Err(CalcError::SyntaxError)
        );
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
