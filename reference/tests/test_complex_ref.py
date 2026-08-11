"""参照実装そのものの健全性テスト。

Rust と突き合わせる前に、SymPy の使い方が正しいことを確認する。
"""

import math

from calcarc_reference.complex_ref import add, div, mul, polar_to_rect, rect_to_polar, sub


def test_headline_case() -> None:
    r, theta_deg = rect_to_polar(3.0, 4.0)
    assert r == 5.0
    assert math.isclose(theta_deg, 53.13010235415598, rel_tol=1e-15)


def test_all_four_quadrants() -> None:
    assert math.isclose(rect_to_polar(1.0, 1.0)[1], 45.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, 1.0)[1], 135.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, -1.0)[1], -135.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(1.0, -1.0)[1], -45.0, abs_tol=1e-12)


def test_axes() -> None:
    assert rect_to_polar(1.0, 0.0)[1] == 0.0
    assert math.isclose(rect_to_polar(0.0, 1.0)[1], 90.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, 0.0)[1], 180.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(0.0, -1.0)[1], -90.0, abs_tol=1e-12)


def test_round_trip() -> None:
    re, im = polar_to_rect(5.0, 53.13010235415598)
    assert math.isclose(re, 3.0, abs_tol=1e-12)
    assert math.isclose(im, 4.0, abs_tol=1e-12)


def test_the_origin_has_a_defined_angle() -> None:
    """原点の偏角は数学的には未定義だが、約束として 0 に固定する。

    SymPy の atan2(0, 0) は nan を返す。Rust の f64::atan2 は IEEE 754 に
    従って +0 を返す。両者が食い違ったままでは golden 検証が成立しないので、
    参照実装も IEEE 754 の約束に合わせる。nan は JSON としても不正である。
    """
    assert rect_to_polar(0.0, 0.0) == (0.0, 0.0)


def test_binary_headline_cases() -> None:
    """単体テストと同じ既知値。(3+4j)(1+2j) = -5+10j、その逆除算。"""
    assert mul(3.0, 4.0, 1.0, 2.0) == (-5.0, 10.0)
    assert div(-5.0, 10.0, 1.0, 2.0) == (3.0, 4.0)
    assert add(3.0, 4.0, 1.0, 2.0) == (4.0, 6.0)
    assert sub(3.0, 4.0, 1.0, 2.0) == (2.0, 2.0)


def test_division_is_exact_in_rationals() -> None:
    """厳密有理数の除算には条件数の概念がない。

    f64 では素朴な分母 (b.re² + b.im²) がアンダーフローで 0 に潰れる入力
    でも、有理数では正確に計算できる。これが Rust(Smith 法)との手法の
    独立性そのもの。
    """
    re, im = div(1.0, 0.0, 1e-200, 1e-200)
    assert math.isclose(re, 0.5e200, rel_tol=1e-15)
    assert math.isclose(im, -0.5e200, rel_tol=1e-15)


def test_multiplication_and_division_are_inverse() -> None:
    """(a*b)/b が a に戻る(丸めは最後の float 化の 1 回だけ)。"""
    p_re, p_im = mul(430.27, 0.0040323, 0.87, -0.54)
    re, im = div(p_re, p_im, 0.87, -0.54)
    assert math.isclose(re, 430.27, rel_tol=1e-15)
    assert math.isclose(im, 0.0040323, rel_tol=1e-15)
