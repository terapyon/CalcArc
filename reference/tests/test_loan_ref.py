"""Loan 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from decimal import Decimal

import pytest

from calcarc_reference import loan_ref
from calcarc_reference.loan_ref import (
    LoanError,
    bonus_forward,
    forward,
    monthly_interest,
    monthly_payment,
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
    with pytest.raises(ValueError):
        loan_ref._guard_boundary(Decimal("1000.0000000001"))
    # 絶対 1e-6 円だけでは巨大な月額を守れない——相対の限度が効く。
    with pytest.raises(ValueError):
        loan_ref._guard_boundary(Decimal("1000000000000000.4"))
    # 実入力でも触れる: 3,000 万・2 回・年 2.4% の月額は境界に近すぎる。
    num, den = rate_fraction("2.4")
    with pytest.raises(ValueError):
        monthly_payment(30_000_000, num, den, 2, 0)


def test_schedule_rejects_a_payment_that_cannot_cover_interest() -> None:
    num, den = rate_fraction("12.0")
    with pytest.raises(LoanError):
        run_schedule(1_000_000, num, den, 120, 10_000, 0)
