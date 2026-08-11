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


def _binary(a_re: float, a_im: float, b_re: float, b_im: float):
    """4 つの f64 を厳密有理数の組にする。"""
    return _exact(a_re), _exact(a_im), _exact(b_re), _exact(b_im)


def _to_floats(re_expr, im_expr) -> tuple[float, float]:
    return float(sp.N(re_expr, PRECISION)), float(sp.N(im_expr, PRECISION))


def add(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar + br, ai + bi)


def sub(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar - br, ai - bi)


def mul(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar * br - ai * bi, ar * bi + ai * br)


def div(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    """複素数の除算。教科書どおりの式を厳密有理数で計算する。

    素朴な分母 (b_re² + b_im²) は f64 では禁じ手(アンダーフローで 0 に
    潰れ、オーバーフローで inf になる)であり、Rust はそのために Smith 法を
    使う。厳密有理数にはその問題が存在しないので、教科書の式のまま正しい。
    同じ結論に別の道で着くこと自体が検証の独立性である(base-spec §30)。
    ゼロ除数は golden の対象外(エラー系は engine_table の領域)なので、
    ここでは検査しない —— 渡せば SymPy が ZeroDivisionError を投げ、
    生成が音を立てて止まる。それでよい。
    """
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    den = br * br + bi * bi
    return _to_floats((ar * br + ai * bi) / den, (ai * br - ar * bi) / den)
