"""工学表記の参照実装の検査（段階 I）。

**Rust の出力と突き合わせるのは E2E の仕事**で、ここではない。ここが確かめる
のは「参照実装が、自分の名乗る規則どおりに動いているか」である——指数は
3 の倍数へ下向き、有効数字は 10 桁、指数 0 は書かない、整数部だけ 3 桁区切り。

もし両方をここで確かめようとすると、Rust の出力を期待値として書き写すことに
なり、**参照実装が Rust の写しになる**。それは検証の意味を消す。
"""

from __future__ import annotations

import pytest

from calcarc_reference.eng_ref import format_real_eng


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, "0"),
        (1.0, "1"),
        (10.0, "10"),
        (100.0, "100"),
        # 指数 3 の倍数ちょうど。仮数は 1 になる。
        (1000.0, "1e3"),
        (1e6, "1e6"),
        (1e9, "1e9"),
        # 3 の倍数に足りないぶんは仮数の整数部へ回る。
        (1e10, "10e9"),
        (1e11, "100e9"),
        (1234.5678, "1.2345678e3"),
        (123456789.0, "123.456789e6"),
        # **1 未満。ここが `//` と `int()` の分かれ目である。**
        # 10 進指数 -1 → 下向きに丸めて -3。`int(-1/3)` なら 0 になり、
        # `0.5` がそのまま `0.5` と出てしまう。
        (0.5, "500e-3"),
        (0.001, "1e-3"),
        (0.0001234, "123.4e-6"),
        (1e-7, "100e-9"),
        (1e-9, "1e-9"),
        # 負号は仮数に付く。指数には付かない。
        (-1500.0, "-1.5e3"),
        (-0.5, "-500e-3"),
    ],
)
def test_the_exponent_rounds_down_to_a_multiple_of_three(value: float, expected: str) -> None:
    assert format_real_eng(value) == expected


def test_rounding_can_carry_into_the_next_exponent() -> None:
    """**丸めた後で指数が 1 つ上がる。**

    `999.99999999` は 10 桁に丸めると `1000.000000` になり、10 進指数が
    2 から 3 へ動く。丸める前の指数で仮数を決めると `1000e0` と出る
    ——丸めてから指数を取る順序でなければ通らない。
    """
    assert format_real_eng(999.99999999) == "1e3"
    assert format_real_eng(0.00099999999999) == "1e-3"


def test_only_the_integer_part_is_grouped() -> None:
    """3 桁区切りは整数部だけ。小数部には入れない。"""
    assert format_real_eng(123456.0) == "123.456e3"
    # 指数 0 の側だけが区切りを使う（指数が付けば仮数は 3 桁未満になる）。
    assert format_real_eng(123.456789) == "123.456789"


def test_the_exponent_zero_is_not_written() -> None:
    """指数 0 のときは `e0` を書かず、通常の 10 進と同じ形にする。"""
    for value in (1.0, 12.5, 999.9999999):
        assert "e" not in format_real_eng(value), value


def test_ten_significant_digits_and_no_more() -> None:
    """有効数字は 10 桁。11 桁目は丸めて捨てる。"""
    assert format_real_eng(1.000000001) == "1.000000001"
    # 11 桁目は残らない。
    assert format_real_eng(1.0000000001) == "1"


def test_the_value_comes_from_the_bits_not_from_repr() -> None:
    """**f64 のビットから読む。`repr` を経由しない。**

    `repr(x)` は「往復できる最短の十進」で、有効数字 10 桁への丸めとは別の
    操作である。`0.1` の厳密な十進値は `0.1000000000000000055511151231...` で、
    10 桁に丸めれば `0.1` になる——ここでは結果が一致するが、一致する理由が
    「短い repr を採ったから」であってはならない。

    ビットから読んでいることは、**repr が短く見せている桁の先**を要求すれば
    分かる。`2**-30` の厳密値は `9.31322574615478515625e-10` で、10 桁に
    丸めると `931.3225746e-12` になる。`repr` は `9.313225746154785e-10`。
    """
    assert format_real_eng(2.0**-30) == "931.3225746e-12"
