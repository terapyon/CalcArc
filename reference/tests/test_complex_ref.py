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
