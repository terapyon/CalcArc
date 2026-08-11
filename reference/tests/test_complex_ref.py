"""参照実装そのものの健全性テスト。

Rust と突き合わせる前に、SymPy の使い方が正しいことを確認する。
"""

import math

from calcarc_reference.complex_ref import polar_to_rect, rect_to_polar


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
