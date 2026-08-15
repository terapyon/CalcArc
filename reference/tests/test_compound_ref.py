import pytest

from calcarc_reference import compound_ref


def test_the_half_year_seed_matches_the_hand_computation():
    # 100 万・年 1%・5 年・半年複利。各期 floor して元本組入(numerical-policy)。
    num, den = compound_ref.rate_fraction("1", 2)
    assert (num, den) == (1, 200)
    assert compound_ref.grow(1_000_000, 0, num, den, 10) == 1_051_136


def test_the_closed_form_sits_above_the_exact_loop():
    # 切り捨てが積み上がるので厳密ループは必ず小さい。向きが反転したらバグ。
    num, den = compound_ref.rate_fraction("1", 2)
    exact = compound_ref.grow(1_000_000, 0, num, den, 10)
    assert compound_ref.closed_form(1_000_000, 0, num, den, 10) > exact


def test_the_guard_rejects_a_loop_that_drifted_too_far():
    # **番人自身に判別力があること**を確かめる。否定的な保証(「ずれていない」)を
    # 出す側なので、陽性を出せることを見てからでないと信じられない。
    num, den = compound_ref.rate_fraction("1", 2)
    with pytest.raises(ValueError):
        compound_ref.check_against_closed_form(0, 1_000_000, 0, num, den, 10)
    # 逆向き(厳密ループが閉形式を上回る)も弾く。
    with pytest.raises(ValueError):
        compound_ref.check_against_closed_form(2_000_000, 1_000_000, 0, num, den, 10)


def test_a_deposit_lands_at_the_end_of_the_period():
    # 期末なので、最初の期の利息は積立額に付かない。
    num, den = compound_ref.rate_fraction("12", 12)  # 月 1%
    assert compound_ref.grow(0, 10_000, num, den, 2) == 20_100


def test_taxes_are_floored_separately():
    # 合算 20.315% の 1 回切り捨てとは 1 円違う(設計書 §6)。
    national, local = compound_ref.withholding_tax(2_648_906)
    assert (national, local) == (405_679, 132_445)
    assert national + local == 538_124
    assert 2_648_906 * 20315 // 100_000 == 538_125


def test_zero_rate_keeps_what_was_put_in():
    num, den = compound_ref.rate_fraction("0", 12)
    assert compound_ref.grow(1_000_000, 0, num, den, 12) == 1_000_000
    assert compound_ref.grow(0, 30_000, num, den, 12) == 360_000


def test_the_period_count_moves_the_denominator():
    assert compound_ref.rate_fraction("1", 1) == (1, 100)
    assert compound_ref.rate_fraction("1", 2) == (1, 200)
    assert compound_ref.rate_fraction("1.5", 12) == (15, 12_000)
    with pytest.raises(compound_ref.CompoundError):
        compound_ref.rate_fraction("1", 4)


def test_the_error_table():
    num, den = compound_ref.rate_fraction("3", 12)
    for principal, deposit, periods in (
        (1_000_000, 0, 0),  # 期数 0
        (0, 0, 12),  # 元本も積立も無い
        (1_000_000, 0, compound_ref.MAX_PERIODS + 1),  # 上限超
    ):
        with pytest.raises(compound_ref.CompoundError) as error:
            compound_ref.grow(principal, deposit, num, den, periods)
        assert error.value.code == "SyntaxError"


def test_growth_can_overflow_u64():
    # ローンには無かった経路(残高が減る一方だった)。
    num, den = compound_ref.rate_fraction("100", 12)
    with pytest.raises(compound_ref.CompoundError) as error:
        compound_ref.grow(compound_ref.U64_MAX, 0, num, den, 12)
    assert error.value.code == "Overflow"
