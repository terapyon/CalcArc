"""`corpus_pi_marks_more`（`pi-marks-more-display-000.json`）の番人。"""

from __future__ import annotations

import itertools
from fractions import Fraction

import mpmath as mp
import pytest
import sympy as sp

from calcarc_reference import corpus_errors, corpus_pi_marks_more
from calcarc_reference.corpus_pi_marks_more import (
    EXPECTED_COUNTS,
    EXPECTED_DISCARDS,
    FUNCTIONS,
    INVERSE_ARGS,
    SEEDS,
    TABLE_POSITIONS,
    read_keys,
    read_shadow,
)

#: 16 の位置に角を置く群（`zero-power` は 2 つの底で 16 ずつ）。
POSITION_GROUPS = (
    "int-power",
    "neg-power",
    "sum-power",
    "zero-power",
    "root-power",
    "square-sqrt",
    "square-half-power",
)


@pytest.fixture(scope="module")
def shard() -> dict:
    return corpus_pi_marks_more.build_shard()


def _by_group(shard: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {name: [] for name in SEEDS}
    for case in shard["cases"]:
        out[case["group"]].append(case)
    return out


def _body(case: dict) -> list[str]:
    """末尾の三角関数を外した、角を打つキー列（`angle_toggle` は残す）。"""
    keys = case["keys"]
    return keys[:-1] if keys[-1] in FUNCTIONS else keys


def _turns(case: dict) -> Fraction:
    """RAD の角を π で割った有理数。"""
    ratio = sp.expand(read_keys(_body(case)) / sp.pi)
    assert ratio.is_rational, case["id"]
    return Fraction(int(ratio.p), int(ratio.q))


def test_the_shard_counts_by_group(shard):
    """**10 群、計 509 件。** 群を 1 つ落とせば数が変わる。"""
    cases = shard["cases"]
    assert len(cases) == 509
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    counts = {name: len(group) for name, group in _by_group(shard).items()}
    assert counts == EXPECTED_COUNTS
    assert sum(counts.values()) == 509


def test_the_discarded_candidates_are_counted_not_redrawn():
    """**境目に近くて捨てた候補の数を、群ごとに固定する。** 数が動いたら、候補列か
    境目の判定が変わったということである。"""
    discards = {name: n for name, (_, n) in corpus_pi_marks_more.groups().items()}
    assert discards == EXPECTED_DISCARDS


def test_the_boundary_check_sees_a_value_on_the_edge():
    """境目の判定そのものが働くこと（捨てた数が 0 でも緑にならないように）。"""
    edge = ["0", "dot", *"12345678905"]
    assert corpus_pi_marks_more.is_near_boundary(edge)
    assert not corpus_pi_marks_more.is_near_boundary(["0", "dot", "5"])
    assert not corpus_pi_marks_more.is_near_boundary(["angle_toggle", "pi", "sin"])
    assert not corpus_pi_marks_more.is_near_boundary(["angle_toggle", "0", "acos", "tan"])
    with pytest.raises(AssertionError):
        corpus_pi_marks_more.expected(edge)


def test_the_reader_reads_the_spellings_the_groups_use():
    """読み手そのものの確かめ。**生成器の自己検査と別に、手で書いた式と突き合わせる。**"""
    pi = sp.pi
    rad = ["angle_toggle"]
    assert read_keys([*rad, "pi", "pow", "2", "eq", "div", "pi", "eq"]) == pi
    assert read_keys(["pi", "pow", "1", "neg", "eq"]) == 1 / pi
    assert read_keys(["2", "exp_e", "pow", "0", "eq"]) == 1
    assert (
        sp.expand(read_keys(["pi", "add", "1", "eq", "pow", "2", "eq", "sub", "pi", "sqr", "eq"]))
        == 2 * pi + 1
    )
    # 指数の入力中の `+/−` は指数の符号。括弧の中は別の区間。
    assert read_keys(["7", "exp", "1", "5", "neg"]) == sp.Rational(7, 10**15)
    assert (
        read_keys(["pi", "div", "2", "eq", "sub", "lparen", "pi", "mul", "3", "rparen", "eq"])
        == pi / 2 - 3 * pi
    )
    # 逆三角関数: RAD は角そのもの、DEG は度。
    assert read_keys([*rad, "1", "neg", "acos"]) == pi
    assert read_keys(["0", "dot", "5", "asin"]) == 30
    assert read_keys(["3", "recip", "sqrt", "atan"]) == 30
    # 三角関数の角は π の多項式に展開してから渡す。
    assert read_keys([*rad, "pi", "add", "2", "eq", "sqr", "sub", "4", "eq", "sin"]) == sp.sin(
        sp.expand((pi + 2) ** 2 - 4)
    )
    assert read_keys([*rad, "0", "acos", "tan"]) == sp.zoo


def test_the_shadow_follows_the_same_keys():
    """影の数値は同じキー列を mpmath で追う（記号の値と 400 桁で合う）。"""
    for keys in (
        ["angle_toggle", "0", "dot", "5", "asin", "mul", "6", "eq", "sin"],
        ["pi", "add", "1", "eq", "pow", "2", "eq"],
        ["angle_toggle", "pi", "mul", "7", "exp", "1", "5", "neg", "eq", "add", "pi", "eq", "sin"],
    ):
        with mp.workdps(corpus_pi_marks_more.SHADOW_DPS):
            exact = mp.mpf(str(sp.N(read_keys(keys), corpus_pi_marks_more.SHADOW_DPS)))
            assert abs(read_shadow(keys) - exact) < mp.mpf("1e-350"), keys


def test_the_shadow_replaces_a_wrong_symbolic_answer(monkeypatch):
    """**SymPy の簡約が誤った答えを返しても、影の数値が真値になる。**"""
    keys = ["angle_toggle", "pi", "mul", "7", "exp", "1", "5", "neg", "eq"]
    keys += ["add", "pi", "eq", "sin"]
    right = corpus_pi_marks_more.expected(keys)
    assert right == {"main": "-2.199114858e-14"}
    monkeypatch.setattr(corpus_pi_marks_more, "read_keys", lambda _keys: sp.Integer(0))
    assert corpus_pi_marks_more.expected(keys) == right
    # 逆向き（記号が有限、影が極）でも影を使う。
    monkeypatch.setattr(corpus_pi_marks_more, "read_keys", lambda _keys: sp.Integer(1))
    assert corpus_pi_marks_more.expected(["angle_toggle", "0", "acos", "tan"]) == {
        "error": "TrigPole",
        "main": corpus_pi_marks_more.ERROR_TEXT,
    }


def test_every_position_case_types_a_table_angle(shard):
    """**角を置く群のキー列は、表の 16 の位置の周の整数倍を打つ。**"""
    by_group = _by_group(shard)
    for name in POSITION_GROUPS:
        positions: list[Fraction] = []
        for case in by_group[name]:
            assert case["mode"] == "Rad" and case["keys"][0] == "angle_toggle", case["id"]
            turns = _turns(case)
            assert turns > 0 and turns % 2 in TABLE_POSITIONS, case["id"]
            positions.append(turns % 2)
        functions = len(by_group[name]) // len(positions and TABLE_POSITIONS)
        # どの位置も同じ回数（関数の数、`zero-power` は 2 つの底）だけ現れる。
        assert {p: positions.count(p) for p in positions} == dict.fromkeys(
            TABLE_POSITIONS, functions
        ), name


def test_poles_and_zeros_follow_the_definition(shard):
    """**角を置く群と逆三角関数の RAD の群の極と 0 は、角の位置から決まったとおりに並ぶ。**"""
    by_group = _by_group(shard)
    for name in (*POSITION_GROUPS, "inverse-rad"):
        for case in by_group[name]:
            function = case["keys"][-1]
            turns = _turns(case)
            half = turns - Fraction(1, 2)
            if function == "tan" and half.denominator == 1:
                assert case["expect"] == {
                    "error": "TrigPole",
                    "main": corpus_pi_marks_more.ERROR_TEXT,
                }, case["id"]
            elif (function in ("sin", "tan") and turns.denominator == 1) or (
                function == "cos" and half.denominator == 1
            ):
                assert case["expect"] == {"main": "0"}, case["id"]
            else:
                assert "error" not in case["expect"], case["id"]
                assert case["expect"]["main"] != "0", case["id"]


def test_the_inverse_groups_cover_every_table_argument(shard):
    """**表に載る引数 25 通りを、RAD は 3 関数、DEG は `− 度 =` と `tan` に渡す。**"""
    assert len(INVERSE_ARGS) == 25
    assert sum(f == "atan" for _, f in INVERSE_ARGS) == 7
    by_group = _by_group(shard)
    rad = {(tuple(c["keys"][1:-3]), c["keys"][-2], c["keys"][-1]) for c in by_group["inverse-rad"]}
    # 引数は `=` で確定させてから関数を押す。
    assert all(c["keys"][-3] == "eq" for c in by_group["inverse-rad"])
    assert rad == {(arg, f, g) for arg, f in INVERSE_ARGS for g in FUNCTIONS}
    zeros = poles = 0
    for case in by_group["inverse-deg"]:
        assert case["mode"] == "Deg" and "angle_toggle" not in case["keys"], case["id"]
        if case["keys"][-1] == "eq":
            # 度ちょうどを引いた答えは 0。
            assert case["expect"] == {"main": "0"}, case["id"]
            zeros += 1
        else:
            assert case["keys"][-1] == "tan"
            poles += case["expect"].get("error") == "TrigPole"
    assert zeros == 25
    # 90° と −90° に着く引数: asin の ±1、acos の 0、atan は無い。
    assert poles == 3


def test_the_square_groups_type_perfect_squares(shard):
    """平方数の群の `s` は有理数の平方数で、割る `r` は `√s`。"""
    by_group = _by_group(shard)
    for name in ("square-sqrt", "square-half-power"):
        for case in by_group[name]:
            typed = corpus_pi_marks_more._entries(case["keys"])
            s, r = Fraction(typed[0]), Fraction(typed[-1])
            assert r * r == s, case["id"]
            assert ("sqrt" in case["keys"]) == (name == "square-sqrt"), case["id"]


def test_the_quarter_fold_sits_next_to_four_quarter_turns(shard):
    """**`π × K ÷ 2 ± 7 × 10⁻ᴱ π` は π/2 の倍数のすぐ近くで、0 にも極にもならない。**"""
    group = _by_group(shard)["quarter-fold"]
    quarters = set()
    for case in group:
        turns = _turns(case)
        quarter = round(2 * turns)
        offset = turns - Fraction(quarter, 2)
        assert offset.numerator in (7, -7) and offset.denominator in (
            10**e for e in corpus_pi_marks_more.FOLD_EXPONENTS
        ), case["id"]
        quarters.add(quarter)
        assert "error" not in case["expect"] and case["expect"]["main"] != "0", case["id"]
    # π/2・π・3π/2 と、負の側の −π/2（`quarter` は 3 と同じ。0 と 2π の近くは畳みの直しの外）。
    assert quarters == set(corpus_pi_marks_more.FOLD_QUARTERS)


def _segments(keys: list[str]) -> list[list[str]]:
    """`=` で区切った区間。**括弧の中は別の区間**にし、外の区間には括弧ごと 1 つの数として残す。"""
    out: list[list[str]] = []
    stack: list[list[str]] = [[]]
    for key in [*keys, "eq"]:
        if key == "lparen":
            stack.append([])
        elif key == "rparen":
            out.append(stack.pop())
            stack[-1].append("group")
        elif key == "eq" and len(stack) == 1:
            out.append(stack[0])
            stack[0] = []
        else:
            stack[-1].append(key)
    return out


def test_no_segment_mixes_precedence_levels_or_chains_powers(shard):
    """**優先順位の変異と、畳む向きの変異を、この 1 枚に巻き込まない。**

    `=` で区切った区間（括弧の中は別の区間）の中で、`× ÷` と `+ −` が同居しない、`÷` の
    後に `×` が来ない、**`xʸ` は区間の中で唯一の演算子**である（`xʸ` は右結合なので、
    `2 xʸ 3 xʸ 2` の形を作らない）。
    """
    for case in shard["cases"]:
        for segment in _segments(case["keys"]):
            ops = [k for k in segment if k in ("add", "sub", "mul", "div", "pow")]
            assert not ({"mul", "div"} & set(ops) and {"add", "sub"} & set(ops)), case["id"]
            assert "pow" not in ops or ops == ["pow"], case["id"]
            for left, right in itertools.pairwise(ops):
                assert (left, right) != ("div", "mul"), case["id"]


def test_every_typed_number_fits_the_entry_limit(shard):
    """打つ数は 12 文字まで（小数点を含む）。"""
    for case in shard["cases"]:
        for text in corpus_pi_marks_more._entries(case["keys"]):
            assert 0 < len(text) <= corpus_pi_marks_more.ENTRY_LIMIT, case["id"]


def test_modes_follow_the_groups(shard):
    for case in shard["cases"]:
        if case["group"] == "inverse-deg":
            assert case["mode"] == "Deg" and "angle_toggle" not in case["keys"], case["id"]
        else:
            assert case["mode"] == "Rad" and case["keys"][0] == "angle_toggle", case["id"]
        assert case["kind"] == "display"


def test_the_error_text_is_the_same_contract_as_the_errors_shard():
    assert corpus_pi_marks_more.ERROR_TEXT == corpus_errors.ERROR_TEXT
