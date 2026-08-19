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


def test_reached_is_the_net_when_taxed() -> None:
    # 目標と比べる値は、税 ON なら手取り、OFF なら残高(設計書 §2)。
    num, den = compound_ref.rate_fraction("1.5", 12)
    assert compound_ref.reached(999, 0, num, den, 19, taxed=False) == 1018
    assert compound_ref.reached(999, 0, num, den, 19, taxed=True) == 1016


def test_the_periods_answer_is_the_first_that_reaches() -> None:
    # 非単調の実例(設計書 §3)。19 で届き、20 で下回り、21 で戻る。
    num, den = compound_ref.rate_fraction("1.5", 12)
    assert compound_ref.periods_for(999, 0, num, den, 1016, taxed=True) == 19
    assert compound_ref.reached(999, 0, num, den, 20, taxed=True) == 1015
    assert compound_ref.reached(999, 0, num, den, 21, taxed=True) == 1016


def test_the_deposit_answer_does_not_fall_short() -> None:
    num, den = compound_ref.rate_fraction("3", 12)
    d = compound_ref.deposit_for(0, num, den, 240, 10_000_000, taxed=False)
    assert d == 30_461
    assert compound_ref.grow(0, d, num, den, 240) == 10_000_251
    assert compound_ref.grow(0, d - 1, num, den, 240) == 9_999_906


def test_the_certificate_rejects_an_answer_one_period_too_late() -> None:
    # 21 は「最初に届いた期」ではない。20 期が下回るので、n−1 の 1 点しか
    # 見なければ通ってしまう——全数走査が要る理由(設計書 §9 の #2)。
    num, den = compound_ref.rate_fraction("1.5", 12)
    with pytest.raises(AssertionError):
        compound_ref.check_periods_certificate(21, 999, 0, num, den, 1016, taxed=True)
    compound_ref.check_periods_certificate(19, 999, 0, num, den, 1016, taxed=True)


def test_a_zero_principal_reaches_a_tiny_target_with_one_yen() -> None:
    # **探索の途中で「元本 0・積立 0」を踏む入力**。grow はそこで SyntaxError を
    # 上げるが、それは「積立 0 では届かない」の意味であって入力の誤りではない。
    num, den = compound_ref.rate_fraction("3", 12)
    assert compound_ref.deposit_for(0, num, den, 1, 1, taxed=False) == 1
    assert compound_ref.deposit_for(0, num, den, 2, 1, taxed=False) == 1


def test_the_certificate_does_not_fall_into_the_zero_principal_hole() -> None:
    # d == 1 かつ元本 0 のとき、両隣を見る証明書は d - 1 == 0 で
    # reached(0, 0, ...) = grow(0, 0, ...) を直接呼んでいた。元本も積立も
    # 無い入力は SyntaxError なので、答があるケースの証明が例外で落ちていた
    # （修正 1）。_reached_or_nothing を使えば「積立 0 では届かない」に倒れて
    # 例外を出さずに通る。
    num, den = compound_ref.rate_fraction("3", 12)
    compound_ref.check_deposit_certificate(1, 0, num, den, 1, 1, taxed=False)


# `build_finance_shard(seed=20260821, count=2000)` が棄却した `compound_deposit_for`
# の実測 10 件（すべて `tax: True`）。種が税を見ずに組まれていたため `MAX_WALK`
# を使い切って諦めていた（設計書 §4.9）。実測から来た入力なので、この経路が
# 再発すれば必ず赤くなる。
TAX_SEED_MISS_CASES: tuple[dict[str, object], ...] = (
    {
        "principal": 45274742,
        "rate": "4.5",
        "periods_per_year": 12,
        "periods": 104,
        "target": 755402859,
    },
    {
        "principal": 63149292,
        "rate": "8.1",
        "periods_per_year": 12,
        "periods": 80,
        "target": 881006021,
    },
    {
        "principal": 213948711,
        "rate": "1.0",
        "periods_per_year": 1,
        "periods": 9,
        "target": 437867318,
    },
    {
        "principal": 298937362,
        "rate": "5.1",
        "periods_per_year": 12,
        "periods": 99,
        "target": 601241328,
    },
    {
        "principal": 236741933,
        "rate": "3.0",
        "periods_per_year": 12,
        "periods": 268,
        "target": 661986954,
    },
    {
        "principal": 45277543,
        "rate": "3.2",
        "periods_per_year": 2,
        "periods": 163,
        "target": 677913573,
    },
    {
        "principal": 187627116,
        "rate": "0.1",
        "periods_per_year": 1,
        "periods": 11,
        "target": 969955332,
    },
    {
        "principal": 224600998,
        "rate": "5.3",
        "periods_per_year": 12,
        "periods": 214,
        "target": 821133637,
    },
    {
        "principal": 96899159,
        "rate": "14.8",
        "periods_per_year": 12,
        "periods": 49,
        "target": 807413223,
    },
    {
        "principal": 391992896,
        "rate": "6.4",
        "periods_per_year": 12,
        "periods": 72,
        "target": 827929955,
    },
)


def test_deposit_for_solves_every_tax_seed_miss_case() -> None:
    # 赤確認: 種が税を見ずに組まれていたときは、この 10 件すべてが
    # `MAX_WALK` を使い切って `DepositSearchLimitError` を投げていた。
    for case in TAX_SEED_MISS_CASES:
        num, den = compound_ref.rate_fraction(str(case["rate"]), int(case["periods_per_year"]))
        d = compound_ref.deposit_for(
            int(case["principal"]), num, den, int(case["periods"]), int(case["target"]), taxed=True
        )
        compound_ref.check_deposit_certificate(
            d,
            int(case["principal"]),
            num,
            den,
            int(case["periods"]),
            int(case["target"]),
            taxed=True,
        )


def test_the_downward_walk_is_bounded_too(monkeypatch: pytest.MonkeyPatch) -> None:
    # `while d > 0 and ...` は元々上限を持たなかった(設計書 §4.9 Step 4)。
    # **番人自身に判別力があること**を見てから信じる
    # (`test_the_guard_rejects_a_loop_that_drifted_too_far` と同じ形)。種を
    # 意図的に高く付け替え、下向きに長く歩かせる。`MAX_WALK` を 3 に絞れば、
    # 10 歩の下向き修正が必要な入力は `DepositSearchLimitError` で止まる。
    num, den = compound_ref.rate_fraction("3", 12)
    real_seed = compound_ref._deposit_seed

    def _seed_ten_too_high(
        principal: int, num: int, den: int, periods: int, target: int, taxed: bool
    ) -> int:
        return real_seed(principal, num, den, periods, target, taxed) + 10

    monkeypatch.setattr(compound_ref, "_deposit_seed", _seed_ten_too_high)
    monkeypatch.setattr(compound_ref, "MAX_WALK", 3)
    with pytest.raises(compound_ref.DepositSearchLimitError, match="下向き"):
        compound_ref.deposit_for(0, num, den, 240, 10_000_000, taxed=False)


def test_deposit_for_reaches_every_tax_seed_miss_case_within_a_few_steps() -> None:
    # 「解けた」だけでは、種が悪いまま `MAX_WALK` を上げても緑になる。税を
    # 織り込んだ種からは、切り捨て 2 回ぶん(数円)しかずれないはずなので、
    # 数歩で当たることを歩数そのものに主張させる。実測の最大歩数は 2
    # （10 件中 8 件が 1 歩、2 件が 2 歩）。上限 4 はそこに余裕を持たせた値。
    for case in TAX_SEED_MISS_CASES:
        num, den = compound_ref.rate_fraction(str(case["rate"]), int(case["periods_per_year"]))
        _d, steps = compound_ref._deposit_search(
            int(case["principal"]), num, den, int(case["periods"]), int(case["target"]), taxed=True
        )
        assert steps <= 4, f"{case} が {steps} 歩かかった(上限 4、実測最大は 2)"
