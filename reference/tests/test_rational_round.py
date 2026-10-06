"""`rational_round` の番人。**期待値の作り方が「正しい丸め」であること**を、手で構成した
2 進の値で確かめる（Rust の側は `tests/rational_to_f64_golden.rs` が照合する）。"""

import math
import sys
from fractions import Fraction

from calcarc_reference import rational_round

P53 = 1 << 53


def test_ties_go_to_even():
    assert rational_round.round_ratio(P53 + 1, 1) == float(P53)
    assert rational_round.round_ratio(P53 + 3, 1) == float(P53 + 4)
    k = 1 << 70
    assert rational_round.round_ratio((P53 + 1) * k + 1, k) == float(P53 + 2)


def test_the_double_rounding_shortcut_is_wrong_on_some_rows():
    """**手順の違いが答えに現れる行が golden に在る**（CLAUDE.md「違いが答えに現れうる
    手順だけが、一致を証拠にする」）。`float(num) / float(den)` は 2 度丸める。"""
    cases = rational_round.build_cases()
    differ = 0
    for case in cases:
        num = int(case["input"]["num"])  # type: ignore[index]
        den = int(case["input"]["den"])  # type: ignore[index]
        if float(num) / float(den) != float(Fraction(num, den)):
            differ += 1
    print(f"2 度丸めと答えが違う行: {differ} / {len(cases)}")
    assert differ >= 10


def test_the_tie_families_are_ties():
    """**同点の族は本当に同点である**——真値が 2 つの隣り合う f64 のちょうど中間。"""
    for case in rational_round.build_cases():
        if case["family"] not in ("tie_unreduced", "tie_odd_den"):
            continue
        exact = Fraction(int(case["input"]["num"]), int(case["input"]["den"]))  # type: ignore[index]
        nearest = float(exact)
        other = math.nextafter(nearest, math.inf if exact > Fraction(nearest) else -math.inf)
        assert exact - Fraction(nearest) == (Fraction(other) - Fraction(nearest)) / 2, case["id"]


def test_no_row_is_subnormal_and_ids_are_unique():
    """**非正規化数の行は無い**——生成器の assert とは別に、ここで値域そのものを見る。
    i128 の分数の絶対値は 0 か `2^-128 ≤ |x| ≤ 2^127` で、f64 の正規化数の内側に在る。"""
    cases = rational_round.build_cases()
    for case in cases:
        x = Fraction(int(case["input"]["num"]), int(case["input"]["den"]))  # type: ignore[index]
        assert x == 0 or Fraction(1, 1 << 128) <= abs(x) <= (1 << 127), case["id"]
        assert x == 0 or abs(float(x)) >= sys.float_info.min, case["id"]
    ids = [c["id"] for c in cases]
    assert len(set(ids)) == len(ids)
    families = {c["family"] for c in cases}
    for family in ("around_2_53", "tie_unreduced", "tie_odd_den", "i128_ends", "signs"):
        assert family in families
