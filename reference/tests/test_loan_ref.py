"""Loan 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from decimal import Decimal
from fractions import Fraction

import pytest

from calcarc_reference import loan_ref
from calcarc_reference.loan_ref import (
    LoanError,
    bonus_forward,
    forward,
    monthly_interest,
    monthly_payment,
    monthly_payment_exact,
    principal_for,
    rate_fraction,
    run_schedule,
    term_for,
)


def test_rate_is_an_exact_fraction() -> None:
    assert rate_fraction("1.5") == (15, 12_000)
    assert rate_fraction("0") == (0, 1_200)
    for bad in ("", "-1", "abc", "1.23456", "100.0001"):
        with pytest.raises(LoanError):
            rate_fraction(bad)


def test_the_measured_one_yen_case_is_exact() -> None:
    # 設計書 §1-1 の実測: f64 経由なら 26,999 円に落ちる境界ちょうどの値。
    num, den = rate_fraction("2.7")
    assert monthly_interest(12_000_000, num, den) == 27_000


def test_zero_rate_charges_no_interest() -> None:
    num, den = rate_fraction("0")
    result = forward(1_200_000, num, den, 12, 0)
    assert result["total_interest"] == 0
    assert result["total_payment"] == 1_200_000


def test_residual_final_row_is_the_residual() -> None:
    # 設計書 §3: 最終回は残価のみ。B=0 なら通常ローンに退化する。
    num, den = rate_fraction("3.9")
    with_residual = forward(3_000_000, num, den, 60, 1_200_000)
    assert with_residual["final_payment"] == 1_200_000
    plain = forward(3_000_000, num, den, 60, 0)
    assert with_residual["monthly_payment"] < plain["monthly_payment"]
    assert with_residual["total_payment"] > plain["total_payment"]


def test_degenerate_input_stops_early() -> None:
    num, den = rate_fraction("1.0")
    result = forward(10_000, num, den, 600, 0)
    assert result["rows_paid"] < 600


def test_the_inversions_are_settled_by_the_table() -> None:
    # 借入可能額 → 期間逆算 の往復一致(設計書 §7)。
    num, den = rate_fraction("1.5")
    borrowed = principal_for(85_000, num, den, 420)["principal"]
    assert term_for(borrowed, num, den, 85_000)["n"] == 420
    # 定義の両側: +1 円は 420 回では終わらない。
    assert term_for(borrowed + 1, num, den, 85_000)["n"] == 421


def test_term_rejects_divergence() -> None:
    num, den = rate_fraction("12.0")
    with pytest.raises(LoanError):
        term_for(1_000_000, num, den, 10_000)  # 月額 ≤ 初回利息
    with pytest.raises(LoanError):
        term_for(100_000_000, num, den, 1_000_001)  # 100 年でも終わらない


def test_bonus_zero_is_the_plain_loan() -> None:
    num, den = rate_fraction("1.5")
    plain = forward(30_000_000, num, den, 420, 0)
    with_bonus = bonus_forward(30_000_000, 0, num, den, 420)
    assert with_bonus["monthly_payment"] == plain["monthly_payment"]
    assert with_bonus["total_payment"] == plain["total_payment"]


def test_bonus_column_uses_the_half_year_rate() -> None:
    # 半年利 = 年利÷2 は月利の 6 倍。月利で回した列より利息は必ず多い。
    num, den = rate_fraction("1.5")
    combined = bonus_forward(30_000_000, 6_000_000, num, den, 420)
    monthly_only = forward(24_000_000, num, den, 420, 0)
    at_monthly_rate = forward(6_000_000, num, den, 70, 0)
    assert combined["total_interest"] > (
        monthly_only["total_interest"] + at_monthly_rate["total_interest"]
    )


def test_bonus_share_over_half_is_rejected() -> None:
    num, den = rate_fraction("1.5")
    with pytest.raises(LoanError):
        bonus_forward(1_000_000, 500_001, num, den, 60)
    with pytest.raises(LoanError):
        bonus_forward(1_000_000, 100_000, num, den, 5)  # ボーナス回が来ない


def test_the_u64_domain_is_a_contract() -> None:
    num, den = rate_fraction("1.5")
    with pytest.raises(LoanError) as caught:
        monthly_payment((1 << 64) - 1, num, den, 1, 0)  # P + 利息があふれる
    assert caught.value.code == "Overflow"


def test_the_boundary_guard_keeps_coin_tosses_out_of_the_golden() -> None:
    # ガードは「f64 の floor が転ぶ値」を golden に入れない番人(設計書 §1-4)。
    loan_ref._guard_boundary(Decimal("1000.5"))  # 十分離れている
    with pytest.raises(ValueError, match="yen boundary"):
        loan_ref._guard_boundary(Decimal("1000.0000000001"))
    # 絶対 1e-6 円だけでは巨大な月額を守れない——相対の限度が効く。
    with pytest.raises(ValueError, match="yen boundary"):
        loan_ref._guard_boundary(Decimal("1000000000000000.4"))
    # 実入力でも触れる: 3,000 万・2 回・年 2.4% の月額は境界に近すぎる。
    num, den = rate_fraction("2.4")
    with pytest.raises(ValueError, match="yen boundary"):
        monthly_payment(30_000_000, num, den, 2, 0)


def test_schedule_rejects_a_payment_that_cannot_cover_interest() -> None:
    num, den = rate_fraction("12.0")
    with pytest.raises(LoanError):
        run_schedule(1_000_000, num, den, 120, 10_000, 0)


def test_the_audit_boundary_is_an_exact_integer() -> None:
    # 720,600 円・年 2%・2 か月の理論月額は 361,201 円ちょうど
    # （外部監査 F2、設計書 2026-09-12 §2.3）。
    num, den = rate_fraction("2")
    assert monthly_payment_exact(720_600, num, den, 2, 0) == Fraction(361_201)


def test_the_exact_value_agrees_with_the_decimal_one_away_from_boundaries() -> None:
    # 境界から離れた入力では、Decimal 50 桁の月額の切り捨てと一致する。
    num, den = rate_fraction("1.5")
    exact = monthly_payment_exact(30_000_000, num, den, 420, 0)
    assert exact.numerator // exact.denominator == monthly_payment(30_000_000, num, den, 420, 0)


def test_a_residual_moves_the_payment_down() -> None:
    num, den = rate_fraction("2")
    plain = monthly_payment_exact(3_000_000, num, den, 60, 0)
    with_residual = monthly_payment_exact(3_000_000, num, den, 60, 1_000_000)
    assert with_residual < plain


def test_zero_rate_follows_the_integer_rule() -> None:
    assert monthly_payment_exact(2_999_999, 0, 1200, 12, 0) == Fraction(2_999_999, 12)
    assert monthly_payment_exact(3_000_000, 0, 1200, 12, 600_000) == Fraction(2_400_000, 11)


def test_a_monthly_payment_above_the_cap_is_overflow() -> None:
    # 正の年利・2 回以上で理論月額が上限 + 2 円以上の入力(R2 と同じ線。
    # closed_form.rs の `a_monthly_payment_above_the_verified_cap_is_an_error`
    # と同じ入力——理論月額は約 1,001,250,000 円)。
    num, den = rate_fraction("1")
    with pytest.raises(LoanError) as caught:
        monthly_payment(2_000_000_000, num, den, 2, 0)
    assert caught.value.code == "Overflow"


def test_the_boundary_guard_still_applies_below_the_cap() -> None:
    # 5 億円台の月額は上限(10 億円)の下だが、円境界ガードの相対しきい値
    # (値 × 1e-9)がこの規模ではもう最大距離 0.5 円を超えるので、上限とは
    # 別に境界ガードが NearYenBoundaryError で落とす(LoanError ではない)。
    # 上限を 5 億に下げるとこの入力は Overflow に変わる——赤の確認(Step 5)
    # で使う境目。
    num, den = rate_fraction("1")
    with pytest.raises(ValueError, match="yen boundary"):
        monthly_payment(1_500_000_000, num, den, 2, 0)


def test_exactly_the_cap_is_still_an_answer() -> None:
    # golden の residual/exact/15/2/987654400/81 と同じ入力(monthly_floor = 1,000,000,000)。
    # この入力は理論値がちょうど円境界に乗るので、Decimal 50 桁の `monthly_payment` は
    # `_guard_boundary` に阻まれる(境界ガードの仕事どおり)。ちょうど上限を「通す」side は
    # 理論値の側——`monthly_payment_exact` の切り捨て——で確かめる(golden もここを見る)。
    num, den = rate_fraction("15")
    exact = monthly_payment_exact(987_654_400, num, den, 2, 81)
    assert exact.numerator // exact.denominator == 1_000_000_000


def test_zero_rate_is_outside_the_cap() -> None:
    # 金利 0% は上限の前で返る厳密経路(closed_form.rs の `the_exact_paths_are_outside_the_cap`
    # と同じ入力)。理論月額が上限を大きく超えても掛けない。
    num, den = rate_fraction("0")
    assert monthly_payment(loan_ref.U64_MAX, num, den, 600, 0) == 30_744_573_456_182_586


def test_one_payment_is_outside_the_cap() -> None:
    # 1 回払いも上限の前で返る厳密経路。理論月額が上限を超えても値を返す。
    num, den = rate_fraction("1")
    payment = monthly_payment(5_000_000_000, num, den, 1, 0)
    assert payment > loan_ref.MAX_VERIFIED_MONTHLY_YEN


def test_a_bonus_payment_above_the_cap_is_overflow() -> None:
    # bonus_forward はボーナス分も monthly_payment で決めるので、賞与の月額が
    # 上限を超えれば同じく Overflow になる(calcarc-3d の実測で賞与 1 回あたり
    # 約 22.8 億円という規模感と同じ桁)。
    #
    # ブリーフの例(20,000,000,000 / 9,000,000,000 / 24 回)はそのままでは使えない
    # ——月々の列(11,000,000,000 を 24 回)がたまたま円境界の近くに落ち、
    # 賞与の上限とは無関係に `_guard_boundary` が先に鳴る(この節の理由と同じ、
    # 5 億円級では相対しきい値が最大距離 0.5 円を超えるため)。月々の列が
    # 境界を踏まない組(6,000,000,000 / 3,000,000,000 / 12 回 → 月々は
    # 251,356,234 円で安全、賞与列は 2 回で 1,511,259,351 円で上限超え)に
    # 差し替える。
    num, den = rate_fraction("1")
    with pytest.raises(LoanError) as caught:
        bonus_forward(6_000_000_000, 3_000_000_000, num, den, 12)
    assert caught.value.code == "Overflow"


def test_the_same_inputs_are_refused() -> None:
    num, den = rate_fraction("2")
    bad_inputs = [
        (0, num, den, 12, 0),
        (100, num, den, 0, 0),
        (100, num, den, 12, 100),
        (100, num, den, 1, 10),
    ]
    for args in bad_inputs:
        try:
            monthly_payment_exact(*args)
        except loan_ref.LoanError:
            continue
        raise AssertionError(f"accepted {args}")
