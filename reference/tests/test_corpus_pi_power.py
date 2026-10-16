"""`corpus_pi_power`（`pi-power-display-000.json`）の番人。"""

from __future__ import annotations

import itertools
import math
from fractions import Fraction

import mpmath as mp
import pytest
import sympy as sp

from calcarc_reference import corpus_errors, corpus_pi_power
from calcarc_reference.corpus_pi_power import (
    EXPECTED_COUNTS,
    EXPECTED_DISCARDS,
    SEEDS,
    TABLE_POSITIONS,
    TRIG_GROUPS,
    read_keys,
)


@pytest.fixture(scope="module")
def shard() -> dict:
    return corpus_pi_power.build_shard()


def _by_group(shard: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {name: [] for name in SEEDS}
    for case in shard["cases"]:
        out[case["group"]].append(case)
    return out


def _body(case: dict) -> list[str]:
    """`angle_toggle` と末尾の関数を外した、式を打つキー列。"""
    keys = [k for k in case["keys"] if k != "angle_toggle"]
    return keys[:-1] if keys[-1] in corpus_pi_power.FUNCTIONS else keys


def test_the_shard_counts_by_group(shard):
    """**8 群（三角関数なしは 2 群）、計 368 件。** 群を 1 つ落とせば数が変わる。"""
    cases = shard["cases"]
    assert len(cases) == 368
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    counts = {name: len(group) for name, group in _by_group(shard).items()}
    assert counts == EXPECTED_COUNTS
    assert sum(counts.values()) == 368
    # 三角関数の群は 16 の位置 × 3 関数、三角関数なしの 2 群は 16 ずつ。
    for name in TRIG_GROUPS:
        assert counts[name] == 48, name
    assert counts["half-power-zero"] == counts["half-power-diff"] == 16


def test_the_discarded_candidates_are_counted_not_redrawn():
    """**境目に近くて捨てた候補の数を、群ごとに固定する。** 数が動いたら、候補列か
    境目の判定が変わったということである。"""
    discards = {name: n for name, (_, n) in corpus_pi_power.groups().items()}
    assert discards == EXPECTED_DISCARDS
    assert sum(discards.values()) == sum(EXPECTED_DISCARDS.values())


def test_the_boundary_check_sees_an_expression_on_the_edge():
    """境目の判定そのものが働くこと（捨てた数が 0 でも緑にならないように）。"""
    edge = sp.Rational("0.12345678905")
    assert corpus_pi_power.is_near_boundary(edge)
    assert not corpus_pi_power.is_near_boundary(sp.Rational("0.5"))
    assert not corpus_pi_power.is_near_boundary(sp.Integer(0))
    assert not corpus_pi_power.is_near_boundary(sp.zoo)
    with pytest.raises(AssertionError):
        corpus_pi_power.expected(edge)


def test_the_reader_reads_the_spellings_the_groups_use():
    """読み手そのものの確かめ。**生成器の自己検査と別に、手で書いた式と突き合わせる。**"""
    pi = sp.pi
    assert read_keys(["5", "div", "pi", "eq", "recip", "mul", "1", "5", "eq"], "Rad") == 3 * pi
    assert read_keys(["pi", "sqr", "sqr", "mul", "2", "eq"], "Rad") == 2 * pi**4
    assert read_keys(["pi", "mul", "2", "eq", "pow", "0", "dot", "5", "eq", "sqr"], "Rad") == 2 * pi
    assert read_keys(["pi", "sqr", "mul", "4", "eq", "sqrt"], "Rad") == 2 * pi
    assert (
        read_keys(["pi", "add", "0", "dot", "1", "eq", "sub", "0", "dot", "1", "eq"], "Rad") == pi
    )
    # 度は π/180 倍、`angle_toggle` で RAD に切り替わる。
    assert read_keys(["3", "0", "sin"], "Deg") == sp.Rational(1, 2)
    assert read_keys(["angle_toggle", "pi", "div", "2", "eq", "tan"], "Deg") == sp.zoo
    assert read_keys(["2", "pow", "0", "dot", "5", "eq", "sqr", "sub", "2", "eq"], "Deg") == 0


def test_every_trig_case_types_a_table_angle_whose_keys_give_that_angle(shard):
    """**キー列が打つ角は、表の位置の周の整数倍である。**

    16 の位置 × 3 関数が各群にそろい、位置は群の中で重ならない（周を半周ずらしても
    同じ位置の集合に入るので、重ならないのは打ったキー列の組）。
    """
    by_group = _by_group(shard)
    for name in TRIG_GROUPS:
        if name == "deg-pi-cancels":
            continue
        group = by_group[name]
        positions = set()
        for case in group:
            assert case["mode"] == "Rad" and case["keys"][0] == "angle_toggle", case["id"]
            ratio = read_keys(_body(case), "Rad") / sp.pi
            assert ratio.is_rational and ratio > 0, case["id"]
            frac = Fraction(int(ratio.p), int(ratio.q))
            assert frac % 2 in TABLE_POSITIONS, case["id"]
            positions.add(frac % 2)
        assert positions == set(TABLE_POSITIONS), name
        # 16 の位置 × 3 関数。2 つの綴りを持つ群は、同じ位置でも綴りが分かれる。
        assert 16 <= len({tuple(_body(c)) for c in group}) <= 32, name


def test_the_degree_group_cancels_pi_and_includes_the_values_f64_gets_wrong(shard):
    """**DEG の群の `a` は 30° か 45° の倍数で、9 個は f64 の `π + a − π` が `a` に戻らない。**

    戻る `a` だけの群は、π の印を落とした engine でも緑になる（実測: 小さい `a` 48 件のうち
    f64 がずれるのは `a = 30` の 1 つだけで、`e231550` は 48 件全部合った）。
    """
    group = _by_group(shard)["deg-pi-cancels"]
    residues = set()
    wrong = set()
    for case in group:
        assert case["mode"] == "Deg" and "angle_toggle" not in case["keys"], case["id"]
        a = read_keys(_body(case), "Deg")
        assert a.is_integer and a >= 0, case["id"]
        r = int(a) % 360
        assert r % 30 == 0 or r % 45 == 0, case["id"]
        residues.add(r)
        if (math.pi + int(a)) - math.pi != int(a):
            wrong.add(int(a))
    assert {0, 90, 180, 270} <= residues
    assert len(wrong) == 9
    assert wrong == set(corpus_pi_power._fragile_degrees())
    # 極（270° の剰余）は、f64 でずれる `a` の中に居る。
    assert any(a % 360 == 270 for a in wrong)


def test_poles_and_zeros_follow_the_definition(shard):
    """**三角関数の群の極と 0 は、角の位置から決まったとおりに並ぶ。**"""
    by_group = _by_group(shard)
    for name in TRIG_GROUPS:
        poles = zeros = 0
        for case in by_group[name]:
            function = case["keys"][-1]
            if name == "deg-pi-cancels":
                turns = Fraction(int(read_keys(_body(case), "Deg")), 180)
            else:
                ratio = read_keys(_body(case), "Rad") / sp.pi
                turns = Fraction(int(ratio.p), int(ratio.q))
            half = turns - Fraction(1, 2)
            if function == "tan" and half.denominator == 1:
                assert case["expect"].get("error") == "TrigPole", case["id"]
                assert case["expect"]["main"] == corpus_pi_power.ERROR_TEXT
                poles += 1
            elif (function in ("sin", "tan") and turns.denominator == 1) or (
                function == "cos" and half.denominator == 1
            ):
                assert case["expect"] == {"main": "0"}, case["id"]
                zeros += 1
            else:
                assert "error" not in case["expect"], case["id"]
                assert case["expect"]["main"] != "0", case["id"]
        # RAD の群: 16 の位置のうち 2 つ（1/2 と 3/2）が極と cos の 0、2 つ（0 と 1）が
        # sin・tan の 0。DEG の群: 剰余 90 が 1 つと、f64 でずれる `a` のうち 270 の剰余が
        # 2 つ（33554430・137438953470）が極と cos の 0、剰余 0・180 が sin・tan の 0。
        if name == "deg-pi-cancels":
            assert (poles, zeros) == (3, 4 + 3), name
        else:
            assert (poles, zeros) == (2, 4 + 2), name


def test_zeros_and_poles_come_from_the_exact_value_not_from_mpmath():
    """**mpmath の値は 0 にならない。** だから 0 と極は SymPy の厳密な値から決める。"""
    with mp.workdps(corpus_pi_power.DPS):
        assert mp.sin(mp.pi) != 0
    assert corpus_pi_power.expected(sp.sin(sp.pi)) == {"main": "0"}
    assert corpus_pi_power.expected(sp.cos(sp.pi / 2)) == {"main": "0"}
    assert corpus_pi_power.expected(sp.tan(sp.pi / 2)) == {
        "error": "TrigPole",
        "main": corpus_pi_power.ERROR_TEXT,
    }
    assert corpus_pi_power.expected(sp.sin(7 * sp.pi / 6)) == {"main": "-0.5"}
    assert corpus_pi_power.expected(sp.sin(sp.pi / 3)) == {"main": "0.8660254038"}


def test_the_half_power_groups_hold_their_answers(shard):
    by_group = _by_group(shard)
    # 答え 0: √q を 2 乗して q を引く。
    for case in by_group["half-power-zero"]:
        assert case["expect"] == {"main": "0"}, case["id"]
        assert case["mode"] == "Deg" and "angle_toggle" not in case["keys"]
        assert case["keys"][-1] == "eq"
    # 差: √q − p。p は 0 でも √q でもなく、答えは 0 にならない。
    inside = outside = 0
    for case in by_group["half-power-diff"]:
        typed = corpus_pi_power._entries(case["keys"])
        q, p = Fraction(typed[0]), Fraction(typed[2])
        assert typed[1] == "0.5"
        assert p > 0 and case["expect"]["main"] != "0", case["id"]
        gate = corpus_pi_power.in_gate(q, p)
        inside += gate
        outside += not gate
        with mp.workdps(corpus_pi_power.DPS):
            value = (
                mp.sqrt(mp.mpf(q.numerator) / q.denominator) - mp.mpf(p.numerator) / p.denominator
            )
            assert not corpus_pi_power.near_rounding_boundary(value), case["id"]
    # 2 倍の門の内と外を両方入れる（内側は `2 xʸ 0.5 = − 1.414213562 =` の形）。
    assert (inside, outside) == (12, 4)


def test_both_spellings_meet_every_zero_and_pole(shard):
    """**√π と k = −2〜4 は、同じ 16 の位置を 2 つの綴りで打つ。**

    0 と極の行（sin の 0・tan の 0・cos の 0・tan の極）が、**どちらの綴りにも**当たること。
    当たらないと、片方の綴りの印の壊れは、f64 でも 10 桁が合う行にしか出ず、見逃される。
    """
    by_group = _by_group(shard)
    spelled = {
        "sqrt-pi": lambda c: "pow" in c["keys"],
        "k-2-to-4": lambda c: "recip" in c["keys"],
    }
    for name, which in spelled.items():
        seen: dict[str, set[bool]] = {}
        for case in by_group[name]:
            function = case["keys"][-1]
            ratio = read_keys(_body(case), "Rad") / sp.pi
            turns = Fraction(int(ratio.p), int(ratio.q))
            if function == "tan" and (turns - Fraction(1, 2)).denominator == 1:
                row = "tan-pole"
            elif turns.denominator == 1 and function in ("sin", "tan"):
                row = f"{function}-zero"
            elif function == "cos" and (turns - Fraction(1, 2)).denominator == 1:
                row = "cos-zero"
            else:
                continue
            seen.setdefault(row, set()).add(which(case))
        assert seen == dict.fromkeys(
            ("tan-pole", "sin-zero", "tan-zero", "cos-zero"), {True, False}
        ), (
            name,
            seen,
        )


def test_the_square_group_types_perfect_squares(shard):
    """√(π²) の群の `s` は有理数の平方数（`√(sπ²) = tπ` の t が有理数）。"""
    for case in _by_group(shard)["sqrt-pi-squared"]:
        typed = corpus_pi_power._entries(case["keys"])
        s = Fraction(typed[0])
        assert dict(corpus_pi_power.SQUARES)[typed[0]] ** 2 == s, case["id"]
        assert "sqrt" in case["keys"] and "sqr" in case["keys"], case["id"]


def test_no_segment_mixes_precedence_levels_or_divides_before_multiplying(shard):
    """**優先順位の変異と、畳む向きの変異を、この 1 枚に巻き込まない。**

    `rad_pi` の番人（`× ÷` と `+ −` が 1 本に同居したら赤）は、この綴りを通さない
    （`π × n = ÷ d = + a = − a =` は 1 本に両方を持つ）。**間には必ず `=` がある**ので、
    見るのは `=` で区切った区間である: 区間の中で `× ÷` と `+ −` が同居しない、
    区間の中で `÷` の後に `×` が来ない。
    """
    for case in shard["cases"]:
        segment: list[str] = []
        for key in [*case["keys"], "eq"]:
            if key != "eq":
                segment.append(key)
                continue
            ops = [k for k in segment if k in ("add", "sub", "mul", "div")]
            assert not ({"mul", "div"} & set(ops) and {"add", "sub"} & set(ops)), case["id"]
            for left, right in itertools.pairwise(ops):
                assert (left, right) != ("div", "mul"), case["id"]
            segment = []


def test_every_typed_number_fits_the_entry_limit(shard):
    """打つ数は 12 文字まで（小数点を含む）。"""
    for case in shard["cases"]:
        for text in corpus_pi_power._entries(case["keys"]):
            assert 0 < len(text) <= corpus_pi_power.ENTRY_LIMIT, case["id"]


def test_modes_follow_the_groups(shard):
    for case in shard["cases"]:
        if case["group"] in ("deg-pi-cancels", "half-power-zero", "half-power-diff"):
            assert case["mode"] == "Deg" and "angle_toggle" not in case["keys"], case["id"]
        else:
            assert case["mode"] == "Rad" and case["keys"][0] == "angle_toggle", case["id"]
        assert case["kind"] == "display"


def test_the_error_text_is_the_same_contract_as_the_errors_shard():
    assert corpus_pi_power.ERROR_TEXT == corpus_errors.ERROR_TEXT
