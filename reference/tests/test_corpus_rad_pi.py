"""`corpus_rad_pi`（`rad-pi-display-000.json`）の番人。"""

from __future__ import annotations

import itertools
from fractions import Fraction

import mpmath as mp

from calcarc_reference import corpus_errors, corpus_rad_pi


def test_the_table_has_sixteen_positions_and_fifteen_degrees_is_not_one():
    """**1/6 か 1/4 の倍数で、`[0, 2)` に 16 個。** `1/12`（15°）は入らない。

    「`12r` が整数なら表」と書くと 15° が入る（設計書 §4.1 の罠）。
    """
    assert len(corpus_rad_pi.TABLE_POSITIONS) == 16
    assert Fraction(1, 12) not in corpus_rad_pi.TABLE_POSITIONS
    assert Fraction(1, 12) in corpus_rad_pi.OFF_TABLE_POSITIONS
    assert not set(corpus_rad_pi.TABLE_POSITIONS) & set(corpus_rad_pi.OFF_TABLE_POSITIONS)


def test_zeros_and_poles_come_from_the_definition_not_from_mpmath():
    """**mpmath の値は 0 にならない。** だから 0 と極は定義から決める。

    この assert が緑であることが、`sin_is_zero` を数値で書いてはいけない理由である。
    """
    with mp.workdps(corpus_rad_pi.DPS):
        assert mp.sin(mp.pi * 3) != 0
        assert mp.cos(mp.pi * 5 / 2) != 0
    assert corpus_rad_pi.expected("sin", Fraction(3)) == {"main": "0"}
    assert corpus_rad_pi.expected("cos", Fraction(5, 2)) == {"main": "0"}
    assert corpus_rad_pi.expected("tan", Fraction(5, 2)) == {
        "error": "TrigPole",
        "main": corpus_rad_pi.ERROR_TEXT,
    }
    assert corpus_rad_pi.expected("tan", Fraction(-3, 2))["error"] == "TrigPole"


def test_the_table_values_are_the_ten_digits_of_the_true_values():
    assert corpus_rad_pi.expected("sin", Fraction(13, 6)) == {"main": "0.5"}
    assert corpus_rad_pi.expected("cos", Fraction(7, 3)) == {"main": "0.5"}
    assert corpus_rad_pi.expected("sin", Fraction(7, 3)) == {"main": "0.8660254038"}
    assert corpus_rad_pi.expected("tan", Fraction(9, 4)) == {"main": "1"}
    assert corpus_rad_pi.expected("sin", Fraction(7, 5)) == {"main": "-0.9510565163"}


def test_the_error_text_is_the_same_contract_as_the_errors_shard():
    assert corpus_rad_pi.ERROR_TEXT == corpus_errors.ERROR_TEXT


def test_no_spelling_mixes_precedence_levels_or_divides_before_multiplying():
    """**優先順位の変異と、畳む向きの変異を、この 1 枚に巻き込まない。**

    `× ÷` と `+ −` が 1 本に同居すると `precedence-collapse` が、`÷` の後に `×` が
    来ると `associativity-flip` が、この 1 枚の答えを変える。どちらの変異の
    検出力の表もこの 1 枚を挙げていないので、混ざれば `heavy:power` が落ちる。
    """
    shard = corpus_rad_pi.build_shard()
    for case in shard["cases"]:
        ops = [k for k in case["keys"] if k in ("add", "sub", "mul", "div")]
        assert not ({"mul", "div"} & set(ops) and {"add", "sub"} & set(ops)), case["id"]
        for left, right in itertools.pairwise(ops):
            assert (left, right) != ("div", "mul"), case["id"]


def test_the_shard_counts_by_group():
    """**件数は群の格子から決まる。** 群を 1 つ落とせば数が変わる。"""
    shard = corpus_rad_pi.build_shard()
    ids = [c["id"] for c in shard["cases"]]
    assert len(ids) == len(set(ids))
    # 表: 16 位置 × 3 関数 × (打ち方 + 符号反転 1)。整数の位置（0, 1 → 2, 3）は
    # 打ち方が 2 通り、ほかは 3 通り。
    table = sum(
        3 * ((2 if (r + 2).denominator == 1 else 3) + 1) for r in corpus_rad_pi.TABLE_POSITIONS
    )
    assert len(corpus_rad_pi.table_grid()) == table
    assert len(corpus_rad_pi.large_multiples()) == 16 * 3
    assert len(corpus_rad_pi.off_table()) == len(corpus_rad_pi.OFF_TABLE_POSITIONS) * 2 * 3
    assert len(corpus_rad_pi.zero_is_neutral()) == 3 * 3
    assert len(shard["cases"]) == table + 48 + 48 + 9 + 2 + 3


def test_every_case_is_in_radians():
    """**全件 RAD**（`angle_toggle` を 1 回押し、`mode` が `Rad`）。"""
    for case in corpus_rad_pi.build_shard()["cases"]:
        assert case["mode"] == "Rad"
        assert case["keys"].count("angle_toggle") == 1
        assert case["keys"][0] == "angle_toggle"
