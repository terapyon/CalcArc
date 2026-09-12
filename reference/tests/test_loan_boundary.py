from fractions import Fraction

import pytest

from calcarc_reference import loan_boundary, loan_ref

NEAR = Fraction(1, 10**6)


@pytest.fixture(scope="module")
def cases():
    return loan_boundary.build_cases()


def _theory(case) -> tuple[Fraction, Fraction | None]:
    inp = case["input"]
    num, den = loan_ref.rate_fraction(inp["rate"])
    n = inp["n"]
    if case["op"] == "loan_forward":
        return loan_ref.monthly_payment_exact(
            int(inp["principal"]), num, den, n, int(inp["residual"])
        ), None
    bp = int(inp["bonus_principal"])
    monthly = loan_ref.monthly_payment_exact(int(inp["principal"]) - bp, num, den, n, 0)
    hnum, hden = loan_ref.half_year(num, den)
    bonus = loan_ref.monthly_payment_exact(bp, hnum, hden, n // loan_ref.BONUS_INTERVAL_MONTHS, 0)
    return monthly, bonus


def _kind(a: Fraction) -> str | None:
    fl = a.numerator // a.denominator
    frac = a - fl
    if frac == 0:
        return "exact"
    if 1 - frac <= NEAR:
        return "below"
    if frac <= NEAR:
        return "above"
    return None


def test_every_case_sits_where_its_label_says(cases):
    for case in cases:
        monthly, bonus = _theory(case)
        at_boundary = bonus if case["set"] == "bonus" else monthly
        assert _kind(at_boundary) == case["boundary"], case["id"]
        assert case["expect"]["monthly_floor"] == str(monthly.numerator // monthly.denominator), (
            case["id"]
        )
        if bonus is not None:
            assert case["expect"]["bonus_floor"] == str(bonus.numerator // bonus.denominator), case[
                "id"
            ]


def test_the_payments_stay_under_the_cap(cases):
    floors = [int(v) for c in cases for v in c["expect"].values()]
    assert max(floors) <= loan_boundary.MAX_MONTHLY_YEN
    # 上限の近くも踏む(10 億円の直下まで、設計書 §4.3)。
    assert max(floors) >= loan_boundary.MAX_MONTHLY_YEN // 2


def test_each_cell_has_enough_cases(cases):
    counts = {}
    for c in cases:
        counts[(c["set"], c["boundary"])] = counts.get((c["set"], c["boundary"]), 0) + 1
    for s in ("plain", "residual", "bonus"):
        for b in ("exact", "below", "above"):
            assert counts.get((s, b), 0) >= 20, (s, b, counts)
    assert counts[("plain", "below")] >= 100 and counts[("plain", "above")] >= 100, counts


def test_the_ends_of_rate_and_term_are_covered(cases):
    rates = {c["input"]["rate"] for c in cases}
    terms = {c["input"]["n"] for c in cases}
    assert {"0.0001", "100"} <= rates, rates
    assert {2, 1200} <= terms, terms


def test_ids_are_unique(cases):
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))


def test_each_case_survives_a_payment_one_yen_off(cases):
    # 製品の月額が上下 1 円ずれても償還表がエラーにならない入力だけを採る(テストが Err を踏まない)。
    for case in cases[:: max(1, len(cases) // 200)]:
        inp = case["input"]
        num, den = loan_ref.rate_fraction(inp["rate"])
        if case["op"] == "loan_forward":
            fl = int(case["expect"]["monthly_floor"])
            for pay in (fl - 1, fl, fl + 1):
                loan_ref.run_schedule(
                    int(inp["principal"]), num, den, inp["n"], pay, int(inp["residual"])
                )
