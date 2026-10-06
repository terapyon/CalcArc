"""「i128 の分数 → 正しく丸めた f64」の golden（1.2.3 設計書 §5.3・§8.2）。

engine は段階 2 で、k=0 の印がある値の `re` を「印の有理数を正しく丸めた f64」に置き換える。
その丸めは Rust の `expr::rational::ratio_to_f64`（2^53 を超えたら u128 の長除算で
54 ビット＋sticky）が作る。**ここはその照合の相手である。**

**期待値は `float(Fraction(num, den))`**——CPython の `Fraction.__float__` は
`int / int` の真の除算で、**int の真の除算は正しく丸める**（最近接・同点は偶数）。
**手順が違う**: Rust は 1 ビットずつの長除算と自前の丸め、こちらは bigint の除算。

**期待値は f64 のビット列（16 進の文字列）で持つ。** 許容を置かない——正しい丸めの
答えは 1 つしかない。十進の綴りは読む人のために横に添えるだけで、Rust は読まない
（JSON の十進を f64 に読む段で、読み手の丸めが入りうる）。

**分子と分母も十進の文字列で持つ。** 2^53 を超える整数は JSON の数では運べない。

**非正規化数の行は作れない。** i128 の分数の絶対値は `1/(2^127)` から `2^127` までで、
f64 の正規化数の内側に収まる（2^-1022 ≪ 2^-127）。設計書 §8.2 は非正規化数の行を
挙げているが、**入力の値域がそこに届かない**——`build_cases` がそれを assert する
（届く行が混ざったら、生成の段で落ちる）。
"""

from __future__ import annotations

import random
import struct
from fractions import Fraction

SCHEMA = 1

I128_MAX = (1 << 127) - 1
I128_MIN = -(1 << 127)
P53 = 1 << 53

#: 乱択の行の種。**固定する**——生成し直しても golden が動かない（CI が差分を見る）。
_SEED = 20261006

#: 乱択の行の数。ビット長を 1〜127 で振る（分子と分母を別々に）。
_RANDOM_ROWS = 400


def round_ratio(num: int, den: int) -> float:
    """`num / den` を正しく丸めた f64。

    独立: 別手順——Python の bigint の真の除算（`Fraction.__float__`）。Rust は u128 の
    長除算で 54 ビットと sticky を作り、自前で偶数へ丸める。**違いが答えに現れうる**:
    `num as f64 / den as f64` のような 2 度丸めの実装は、2^53 を超える行で 1 ulp 外れる。
    """
    return float(Fraction(num, den))


def _bits(x: float) -> str:
    return "0x" + struct.pack(">d", x).hex()


def _named_rows() -> list[tuple[str, int, int]]:
    """意図を持って選んだ行。(族, 分子, 分母)。"""
    rows: list[tuple[str, int, int]] = []
    # 除算 1 回の道（分子と分母が 2^53 以下）。near_subtraction の印もここに入る。
    for num, den in [(1, 3), (2, 3), (1, 10), (3, 10), (1, 1000), (4548399395, 1000)]:
        rows.append(("small", num, den))
    rows.append(("small", P53, 1))
    rows.append(("small", 1, P53))
    rows.append(("small", P53, P53 - 1))
    # 2^53 の前後（整数）。2^53+1 と 2^53+3 は同点。
    for offset in range(-3, 6):
        rows.append(("around_2_53", P53 + offset, 1))
        rows.append(("around_2_53", -(P53 + offset), 1))
    # 2^54 の前後（ulp が 4 になる）。
    for offset in (-2, -1, 1, 2, 3, 5, 6, 7):
        rows.append(("around_2_54", 2 * P53 + offset, 1))
    # 同点を長除算の道で（分子・分母とも大きい、約分されていない形）。
    for shift in (20, 60, 70):
        k = 1 << shift
        if (P53 + 3) * k <= I128_MAX:
            rows.append(("tie_unreduced", (P53 + 1) * k, k))
            rows.append(("tie_unreduced", (P53 + 3) * k, k))
            # 同点のすぐ上・すぐ下（sticky が余りだけから来る）。
            rows.append(("tie_neighbour", (P53 + 1) * k + 1, k))
            rows.append(("tie_neighbour", (P53 + 1) * k - 1, k))
            rows.append(("tie_neighbour", (P53 + 3) * k - 1, k))
    # 分母が奇数の同点（2 の冪で割らない）。(2M+1)/2 を 3 倍した形。
    for m in (P53, P53 + 1, 3 * P53 // 2 + 7):
        rows.append(("tie_odd_den", (2 * m + 1) * 3, 6))
    # 小数部から仮数を作る道（整数部が 54 ビットに満たない、分母が大きい）。
    for num, den in [
        (1, 3 * (1 << 80)),
        (10**30 + 1, 3 * 10**30),
        (7, 10**38),
        (10**38, 7),
        (12345678901234567890123, 10**22),
    ]:
        rows.append(("long_division", num, den))
    # i128 の端。
    rows += [
        ("i128_ends", I128_MAX, 1),
        ("i128_ends", 1, I128_MAX),
        ("i128_ends", I128_MAX, I128_MAX - 1),
        ("i128_ends", I128_MAX - 1, I128_MAX),
        ("i128_ends", I128_MAX, 3),
        ("i128_ends", 3, I128_MAX),
        ("i128_ends", I128_MIN, 1),
        ("i128_ends", I128_MIN, -1),
        ("i128_ends", I128_MIN, I128_MIN),
        ("i128_ends", 1, I128_MIN),
        ("i128_ends", I128_MAX, I128_MIN),
        # 上位 54 ビットがすべて 1 で、繰り上がりが仮数を 54 ビットにする。
        ("i128_ends", (1 << 127) - (1 << 72), 1),
        ("i128_ends", (1 << 127) - (1 << 73) - 1, 1),
    ]
    # 符号の 4 通り。
    for sign_num, sign_den in [(1, 1), (-1, 1), (1, -1), (-1, -1)]:
        rows.append(("signs", sign_num * (10**30 + 7), sign_den * (3 * 10**20 + 1)))
        rows.append(("signs", sign_num * 1, sign_den * 3))
    rows.append(("zero", 0, 5))
    rows.append(("zero", 0, -5))
    rows.append(("zero", 0, I128_MAX))
    return rows


def _random_rows() -> list[tuple[str, int, int]]:
    rng = random.Random(_SEED)
    rows: list[tuple[str, int, int]] = []
    for _ in range(_RANDOM_ROWS):
        num = rng.getrandbits(rng.randint(1, 127))
        den = rng.getrandbits(rng.randint(1, 127)) or 1
        if rng.random() < 0.5:
            num = -num
        if rng.random() < 0.25:
            den = -den
        rows.append(("random", num, den))
    return rows


def build_cases() -> list[dict[str, object]]:
    """golden の行。

    独立: 別手順——期待値は `round_ratio`（Python の bigint の真の除算）が作る。
    """
    cases: list[dict[str, object]] = []
    seen: set[tuple[int, int]] = set()
    for family, num, den in _named_rows() + _random_rows():
        assert I128_MIN <= num <= I128_MAX and I128_MIN <= den <= I128_MAX, (num, den)
        assert den != 0
        if (num, den) in seen:
            continue
        seen.add((num, den))
        value = round_ratio(num, den)
        # **非正規化数と溢れには届かない**（モジュールの註）。届いたら値域の主張が偽。
        assert value == 0.0 or 2.0**-128 <= abs(value) <= 2.0**127, (num, den, value)
        cases.append(
            {
                "id": f"{family}/{num}/{den}",
                "family": family,
                "input": {"num": str(num), "den": str(den)},
                "expect": {"bits": _bits(value), "repr": repr(value)},
            }
        )
    return cases
