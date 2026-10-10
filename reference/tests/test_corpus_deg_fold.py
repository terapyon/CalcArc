"""`corpus_deg_fold`（`deg-fold-display-000.json`）の番人。"""

from __future__ import annotations

import itertools
from fractions import Fraction

import mpmath as mp
import pytest

from calcarc_reference import corpus_deg_fold, corpus_errors


@pytest.fixture(scope="module")
def shard() -> dict:
    return corpus_deg_fold.build_shard()


def _angle(case: dict) -> Fraction:
    """キー列から角を読み直す（生成器の `q` を使わない）。`M EXP E`・`+`・`−`・`.`・`+/−` だけ。"""
    keys = case["keys"][:-2]  # `eq` と関数を外す
    assert case["keys"][-2] == "eq"
    total = Fraction(0)
    sign = 1
    term: list[str] = []

    def value(tokens: list[str]) -> Fraction:
        if "exp" in tokens:
            at = tokens.index("exp")
            mantissa, exponent = tokens[:at], tokens[at + 1 :]
            negative = exponent[-1:] == ["neg"]
            digits = int("".join(t for t in exponent if t != "neg"))
            return value(mantissa) * Fraction(10) ** (-digits if negative else digits)
        text = "".join("." if t == "dot" else t for t in tokens)
        return Fraction(text)

    for token in [*keys, "add"]:
        if token in ("add", "sub"):
            total += sign * value(term)
            sign = 1 if token == "add" else -1
            term = []
        else:
            term.append(token)
    return total


def test_the_shard_counts_by_group(shard):
    """**5 群 × 16 の角 × 3 関数 = 240 件。** 群を 1 つ落とせば数が変わる。"""
    cases = shard["cases"]
    assert len(cases) == 240
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    by_group: dict[str, int] = {}
    for case in cases:
        by_group[case["group"]] = by_group.get(case["group"], 0) + 1
    assert by_group == dict.fromkeys(corpus_deg_fold.SEEDS, 48)
    for name, (angles, _) in corpus_deg_fold.groups().items():
        assert len(angles) == 16, name
        assert len({q for q, _, _ in angles}) == 16, name


def test_the_discarded_angles_are_counted_not_redrawn():
    """**境目に近くて捨てた角の数を、群ごとに固定する。**

    数が動いたら、候補列か境目の判定が変わったということである。
    """
    discards = {name: n for name, (_, n) in corpus_deg_fold.groups().items()}
    assert discards == corpus_deg_fold.EXPECTED_DISCARDS
    assert sum(discards.values()) == 3


def test_the_boundary_check_sees_a_value_on_the_edge():
    """境目の判定そのものが働くこと（捨てた数が 0 でも緑にならないように）。"""
    with mp.workdps(corpus_deg_fold.DPS):
        assert corpus_deg_fold.near_rounding_boundary(mp.mpf("0.12345678905"))
        assert corpus_deg_fold.near_rounding_boundary(mp.mpf("-123456789.05"))
        assert corpus_deg_fold.near_rounding_boundary(mp.mpf("0.1234567890500000000001"))
        assert not corpus_deg_fold.near_rounding_boundary(mp.mpf("0.123456789051"))
        assert not corpus_deg_fold.near_rounding_boundary(mp.mpf("0.5"))
        assert not corpus_deg_fold.near_rounding_boundary(mp.mpf(0))


def test_every_angle_is_the_one_its_keys_type(shard):
    """**キー列が打つ数と、期待を作った角が同じ。** 群の条件もキー列から当て直す。"""
    angles = {q for _, (group, _) in corpus_deg_fold.groups().items() for q, _, _ in group}
    for case in shard["cases"]:
        q = _angle(case)
        assert q in angles, case["id"]
        assert abs(q.numerator) < 2**126 and q.denominator < 2**126, case["id"]
        r = q % 360
        group = case["group"]
        on_table = r.denominator == 1 and (r.numerator % 30 == 0 or r.numerator % 45 == 0)
        if group == "large-integer":
            assert q.denominator == 1 and q > 2**53 and not on_table, case["id"]
        elif group == "large-table":
            assert q.denominator == 1 and q > 2**53 and on_table, case["id"]
        elif group == "large-fraction":
            assert q.denominator != 1 and q > 2**53, case["id"]
        elif group == "large-near-quarter":
            nearest = round(q / 90) * 90
            assert q.denominator != 1 and q > 2**53, case["id"]
            assert abs(q - nearest) < Fraction(1, 100), case["id"]
        else:
            assert group == "small-near-quarter"
            nearest = round(q / 90) * 90
            assert q.denominator != 1 and 0 < q < 2**53, case["id"]
            assert abs(q - nearest) < Fraction(1, 1000), case["id"]


def test_the_table_group_covers_every_table_residue(shard):
    """**表に載る 16 の剰余を 1 つずつ。** 0・90・180・270 を含む。"""
    residues = sorted(int(_angle(c) % 360) for c in shard["cases"] if c["group"] == "large-table")
    assert residues == sorted(r for r in corpus_deg_fold.TABLE_RESIDUES for _ in range(3))
    assert {0, 90, 180, 270} <= set(residues)


def test_zeros_and_poles_come_from_the_definition_not_from_mpmath():
    """**mpmath の値は 0 にならない。** だから 0 と極は定義から決める。"""
    with mp.workdps(corpus_deg_fold.DPS):
        assert mp.sin(mp.pi * 180 / 180) != 0
        assert mp.cos(mp.pi * 90 / 180) != 0
    big = Fraction(10**17 + 170)  # ≡ 90 (mod 360)
    assert corpus_deg_fold.expected("tan", big) == {
        "error": "TrigPole",
        "main": corpus_deg_fold.ERROR_TEXT,
    }
    assert corpus_deg_fold.expected("cos", big) == {"main": "0"}
    assert corpus_deg_fold.expected("sin", big) == {"main": "1"}
    assert corpus_deg_fold.expected("sin", Fraction(10**17 + 260)) == {"main": "0"}
    assert corpus_deg_fold.expected("tan", Fraction(10**17 + 260)) == {"main": "0"}
    assert corpus_deg_fold.expected("tan", Fraction(-90)) == {
        "error": "TrigPole",
        "main": corpus_deg_fold.ERROR_TEXT,
    }


def test_the_rows_of_the_design_are_the_true_ten_digits():
    """設計書 §4.1 の行（engine_table が留める点）と同じ答えになる。"""
    assert corpus_deg_fold.expected("sin", Fraction(10**17) + Fraction(161, 2)) == {
        "main": "0.008726535498"
    }
    assert corpus_deg_fold.expected("tan", Fraction(10**16 + 169)) == {"main": "57.28996163"}
    assert corpus_deg_fold.expected("tan", Fraction(900000001, 10**7)) == {"main": "-572,957,795.1"}
    assert corpus_deg_fold.expected("tan", 10**17 + 170 + Fraction(1, 10**16)) == {
        "main": "-5.729577951e17"
    }
    assert corpus_deg_fold.expected("cos", Fraction(2700000001, 10**7)) == {
        "main": "0.000000001745329252"
    }


def test_every_pole_and_zero_in_the_shard_follows_the_definition(shard):
    """シャードの極と 0 は、角の剰余から決まったとおりに並ぶ。"""
    poles = zeros = 0
    for case in shard["cases"]:
        q = _angle(case)
        function = case["keys"][-1]
        if function == "tan" and (q - 90) % 180 == 0:
            assert case["expect"].get("error") == "TrigPole", case["id"]
            poles += 1
        elif (function in ("sin", "tan") and q % 180 == 0) or (
            function == "cos" and (q - 90) % 180 == 0
        ):
            assert case["expect"] == {"main": "0"}, case["id"]
            zeros += 1
        else:
            assert "error" not in case["expect"], case["id"]
            assert case["expect"]["main"] != "0", case["id"]
    # 表の群の 0・90・180・270 だけが極と 0 を持つ（分数の角は 90° の倍数にならない）。
    assert poles == 2
    assert zeros == 6


def test_the_error_text_is_the_same_contract_as_the_errors_shard():
    assert corpus_deg_fold.ERROR_TEXT == corpus_errors.ERROR_TEXT


def test_no_spelling_mixes_precedence_levels_or_divides_before_multiplying(shard):
    """**優先順位の変異と、畳む向きの変異を、この 1 枚に巻き込まない。**

    `× ÷` を 1 つも使わない（`corpus_rad_pi` の同名の番人と同じ主張を、より強く）。
    """
    for case in shard["cases"]:
        ops = [k for k in case["keys"] if k in ("add", "sub", "mul", "div")]
        assert not {"mul", "div"} & set(ops), case["id"]
        for left, right in itertools.pairwise(ops):
            assert (left, right) != ("div", "mul"), case["id"]


def test_every_case_is_in_degrees_and_types_within_the_entry_limits(shard):
    """**全件 DEG**（`angle_toggle` を押さない）。打つ数は 12 文字・指数は 3 桁まで。"""
    for case in shard["cases"]:
        assert case["mode"] == "Deg"
        assert "angle_toggle" not in case["keys"]
        assert case["keys"][-1] in corpus_deg_fold.FUNCTIONS
        term: list[str] = []
        limit = 12
        for token in [*case["keys"][:-2], "add"]:
            if token in ("add", "sub", "exp"):
                assert 0 < len([t for t in term if t != "neg"]) <= limit, case["id"]
                term = []
                limit = 3 if token == "exp" else 12
            else:
                term.append(token)
