"""通常表示の参照実装の検査（段階 J）。

**Rust の出力を期待値として書き写さない。** それをすると参照実装が Rust の
写しになり、検証の意味が消える。ここが確かめるのは「参照実装が、自分の
名乗る規則どおりに動いているか」だけである。

Rust との突き合わせは E2E（`complex-display-000.json` の 2001 件）が行う。
"""

from __future__ import annotations

import pytest

from calcarc_reference.real_ref import format_polar, format_real, format_rect


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, "0"),
        (-0.0, "0"),  # **符号を出さない**
        (1.0, "1"),
        (-4.0, "-4"),
        (0.5, "0.5"),
        (1.0 / 3.0, "0.3333333333"),  # 有効数字 10 桁
        (2.0 / 3.0, "0.6666666667"),  # 最下位で繰り上がる
        # 3 桁区切りは整数部だけ。
        (1234.5, "1,234.5"),
        (9999999999.0, "9,999,999,999"),
        (-1234567.0, "-1,234,567"),
        (1234.5678, "1,234.5678"),
        # 平坦表示の帯は 1e-9 以上 1e10 未満。
        (1e-9, "0.000000001"),
        (1e10, "1e10"),
        (1e-10, "1e-10"),
        (1.23456789e300, "1.23456789e300"),
        (-5.5e-20, "-5.5e-20"),
    ],
)
def test_the_display_rules(value: float, expected: str) -> None:
    assert format_real(value) == expected


def test_rounding_decides_which_notation_is_used() -> None:
    """**丸めた後の値で帯を決める。**

    `9999999999.6` は 10 桁に丸めると `1e10` になり、平坦表示の帯を出る。
    丸める前の指数(9)で決めると `10,000,000,000` と出てしまう——桁区切りの
    入った 11 桁で、有効数字 10 桁の約束を破る。
    """
    assert format_real(9999999999.6) == "1e10"
    # 境界の内側は平坦のまま。
    assert format_real(9999999999.0) == "9,999,999,999"


def test_the_exponent_notation_carries_no_grouping() -> None:
    """指数表記の仮数に 3 桁区切りは入らない（仮数は 1 以上 10 未満）。"""
    assert "," not in format_real(1.234567891e20)
    assert format_real(1.234567891e20) == "1.234567891e20"


def test_trailing_zeros_are_dropped() -> None:
    assert format_real(5.0) == "5"
    assert format_real(1.5) == "1.5"
    assert format_real(1.50) == "1.5"
    assert format_real(1e10) == "1e10"


def test_the_value_comes_from_the_bits_not_from_repr() -> None:
    """**f64 のビットから読む。`repr` を経由しない。**

    `2**-20` の厳密値は `9.5367431640625e-7` で、有効数字 10 桁に丸めると
    `0.0000009536743164` になる——`repr` が返す `9.5367431640625e-07` とは
    書き方も桁数も違う。`repr` は「往復できる最短の十進」であって、
    有効数字 10 桁への丸めとは別の操作である。
    """
    assert format_real(2.0**-20) == "0.0000009536743164"
    # 1e-9 を下回れば指数表記に移る。**帯の境界も丸めた後の値で決まる。**
    assert format_real(2.0**-30) == "9.313225746e-10"


def test_the_rectangular_form_puts_j_before_the_magnitude() -> None:
    """`j` は数の**前**に置く。実測 `3+j4` / `j2` / `-j2`（2026-08-17）。"""
    assert format_rect(3.0, 4.0) == "3+j4"
    assert format_rect(3.0, -4.0) == "3-j4"
    assert format_rect(0.0, 2.0) == "j2"
    assert format_rect(0.0, -2.0) == "-j2"
    assert format_rect(2.2, -0.4) == "2.2-j0.4"


def test_a_zero_imaginary_part_is_shown_as_a_real() -> None:
    """虚部が 0 なら実数として出る。**`j0` とは出ない**（実測）。"""
    assert format_rect(5.0, 0.0) == "5"
    assert format_rect(0.0, 0.0) == "0"
    assert format_rect(-4.0, 0.0) == "-4"


def test_the_polar_form_separates_with_a_spaced_angle_sign() -> None:
    """半径と角度の間は**空白付きの `∠`**（実測 `5 ∠ 53.13010235`）。"""
    assert format_polar(5.0, 53.13010235415598) == "5 ∠ 53.13010235"
    assert format_polar(1.0, 180.0) == "1 ∠ 180"
    assert format_polar(2.0, -90.0) == "2 ∠ -90"
    assert format_polar(0.0, 0.0) == "0 ∠ 0"
