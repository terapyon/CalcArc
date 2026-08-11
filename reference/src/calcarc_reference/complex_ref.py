"""直交形式と極形式の相互変換の参照実装。

Rust は f64 の hypot と atan2 を直接呼ぶ。ここでは SymPy で厳密式を
組み立て、50 桁で評価してから f64 に落とす。同じ手順を踏まないことで、
同一の実装バグが両方に入る確率を下げる(base-spec §30)。
"""

from __future__ import annotations

import sympy as sp

PRECISION = 50


def _exact(x: float) -> sp.Rational:
    """float を厳密な有理数にする。

    str を経由するのは、sp.Rational(0.1) が二進表現をそのまま
    有理数化してしまうのを避けるため。
    """
    return sp.Rational(str(x))


def rect_to_polar(re: float, im: float) -> tuple[float, float]:
    """直交形式から極形式へ。角度は度で返す。"""
    a, b = _exact(re), _exact(im)
    if a == 0 and b == 0:
        # 原点の偏角は数学的には未定義で、SymPy の atan2(0, 0) は nan を返す。
        # IEEE 754 は atan2(+0, +0) = +0 と定めており、Rust の f64::atan2 は
        # それに従う。参照実装も同じ約束を採る。
        #
        # これはアルゴリズムの共有ではなく、未定義値に対する約束の統一である。
        # 約束が食い違ったままでは突き合わせ自体が成立しない。また nan は
        # RFC 8259 の JSON として不正なので、書き出す前にここで潰す。
        return 0.0, 0.0
    r_expr = sp.sqrt(a**2 + b**2)
    theta_expr = sp.atan2(b, a) * 180 / sp.pi
    return float(sp.N(r_expr, PRECISION)), float(sp.N(theta_expr, PRECISION))


def polar_to_rect(r: float, theta_deg: float) -> tuple[float, float]:
    """極形式から直交形式へ。角度は度で受け取る。"""
    radius = _exact(r)
    theta = _exact(theta_deg) * sp.pi / 180
    return (
        float(sp.N(radius * sp.cos(theta), PRECISION)),
        float(sp.N(radius * sp.sin(theta), PRECISION)),
    )
