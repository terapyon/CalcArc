from fractions import Fraction

import pytest

from calcarc_reference import expr_ref

U64_MAX = (1 << 64) - 1


def test_rounding_happens_once_at_the_landing():
    # 各演算で丸めるなら 999999 になる。ここが方式の分かれ目である。
    value = expr_ref.evaluate("1000000/3*3")
    assert expr_ref.land_integer(value, U64_MAX) == 1_000_000
    assert expr_ref.land_integer(expr_ref.evaluate("1000000/3"), U64_MAX) == 333_333


def test_precedence_and_parentheses():
    assert expr_ref.evaluate("3000+500*2") == Fraction(4000)
    assert expr_ref.evaluate("(3000+500)*2") == Fraction(7000)


def test_units_are_parsed_by_the_core():
    # 単位はコアが解釈する(設計書 訂正 2)。UI は展開しない。
    assert expr_ref.evaluate("3000万*2", "yen") == Fraction(60_000_000)
    assert expr_ref.evaluate("100万+50万", "yen") == Fraction(1_500_000)
    assert expr_ref.evaluate("1億6000万-500万", "yen") == Fraction(155_000_000)
    assert expr_ref.evaluate("100M/4", "count") == Fraction(25_000_000)
    assert expr_ref.evaluate("35年", "months") == Fraction(420)
    assert expr_ref.evaluate("3年6", "months") == Fraction(42)
    assert expr_ref.evaluate("3年6月", "months") == Fraction(42)


def test_the_period_length_scales_the_year():
    # どの周期でも割り切れる——端数の期が生まれない(設計書 §5)。
    assert expr_ref.evaluate("10年", "periods:12") == Fraction(120)
    assert expr_ref.evaluate("10年", "periods:2") == Fraction(20)
    assert expr_ref.evaluate("10年", "periods:1") == Fraction(10)


def test_units_only_step_down():
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate("1万億", "yen")
    assert error.value.code == "SyntaxError"
    # 同じ単位を 2 度も置けない。
    with pytest.raises(expr_ref.ExprError):
        expr_ref.evaluate("1万2万", "yen")


def test_an_unknown_unit_is_a_syntax_error():
    # 綴りがワイヤ契約である(設計書 訂正 2)。ずれたら黙って誤答にはならない。
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate("3000萬", "yen")
    assert error.value.code == "SyntaxError"


def test_intermediate_overflow_is_an_error():
    # 数学的には定義域へ戻るが、i128 を超えた時点で落とす(設計書 §8 の角)。
    huge = str(expr_ref.I128_MAX)
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate(f"{huge}*2/2", "count")
    assert error.value.code == "Overflow"


def test_the_guard_has_teeth():
    # 番人に判別力があること。i128 ちょうどは通り、1 つ超えると落ちる。
    assert expr_ref._guard(Fraction(expr_ref.I128_MAX)) is not None
    with pytest.raises(expr_ref.ExprError):
        expr_ref._guard(Fraction(expr_ref.I128_MAX + 1))


def test_division_by_zero():
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate("100/0")
    assert error.value.code == "DivisionByZero"


def test_percent_landing_keeps_four_digits():
    assert expr_ref.land_percent(expr_ref.evaluate("1.5+0.25", "none")) == "1.75"
    assert expr_ref.land_percent(expr_ref.evaluate("2*25", "none")) == "50"
    assert expr_ref.land_percent(expr_ref.evaluate("1/8", "none")) == "0.125"
    with pytest.raises(expr_ref.ExprError):
        # 4 桁で表せない(1/3 = 0.3333... )
        expr_ref.land_percent(expr_ref.evaluate("1/3", "none"))
    with pytest.raises(expr_ref.ExprError):
        # 100% 超
        expr_ref.land_percent(expr_ref.evaluate("3*40", "none"))


def test_negative_intermediates_are_allowed_but_not_landings():
    assert expr_ref.evaluate("(500-1000)+2000") == Fraction(1500)
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.land_integer(expr_ref.evaluate("500-1000"), U64_MAX)
    assert error.value.code == "SyntaxError"


def test_the_syntax_table():
    for text in ("3000+", "(3000+500", "", "3000)", "+3000", "3000**2"):
        with pytest.raises(expr_ref.ExprError) as error:
            expr_ref.evaluate(text)
        assert error.value.code == "SyntaxError", text
