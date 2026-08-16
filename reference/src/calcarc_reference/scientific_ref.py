"""単項関数の参照実装。

Rust は libm の f64 実装を使う。ここでは mpmath の任意精度実装を
50 桁で評価してから f64 に落とす。
"""

from __future__ import annotations

import math

import mpmath as mp

mp.mp.dps = 50


def _to_radians(x: float, mode: str) -> mp.mpf:
    v = mp.mpf(str(x))
    if mode == "Deg":
        return v * mp.pi / 180
    if mode == "Rad":
        return v
    raise ValueError(f"unknown angle mode: {mode}")


def sin(x: float, mode: str) -> float:
    return float(mp.sin(_to_radians(x, mode)))


def cos(x: float, mode: str) -> float:
    return float(mp.cos(_to_radians(x, mode)))


def tan(x: float, mode: str) -> float:
    return float(mp.tan(_to_radians(x, mode)))


def _real_or_domain_error(r) -> dict:
    """mpmath の結果を golden の expect に写す。

    **定義域の判定を Rust から写さない。** mpmath は定義域の外で mpc（複素数）
    または非有限を返すので、それをそのまま「実数の答が無い」の判定に使う。
    これが独立検証の軸である（CONTRIBUTING: 参照実装を Rust の移植にしない）。
    """
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    x = float(r.real if isinstance(r, mp.mpc) else r)
    if math.isnan(x) or math.isinf(x):
        return {"error": "DomainError"}
    return {"re": x, "im": 0.0}


def ln(x: float, mode: str) -> dict:
    return _real_or_domain_error(mp.log(mp.mpf(str(x))))


def log10(x: float, mode: str) -> dict:
    return _real_or_domain_error(mp.log10(mp.mpf(str(x))))


def exp_e(x: float, mode: str) -> dict:
    """e の x 乗。定義域は全実数なので、外れるのは f64 に入らないときだけ。"""
    y = float(mp.exp(mp.mpf(str(x))))
    # 実数として定義はされている。f64 に収まらないだけなので Overflow
    # （設計書 §3 の「Overflow のみ」）。
    if math.isinf(y):
        return {"error": "Overflow"}
    return {"re": y, "im": 0.0}


def _from_radians(r, mode: str):
    if mode == "Deg":
        return r * 180 / mp.pi
    if mode == "Rad":
        return r
    raise ValueError(f"unknown angle mode: {mode}")


def asin(x: float, mode: str) -> dict:
    r = mp.asin(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return _real_or_domain_error(_from_radians(r, mode))


def acos(x: float, mode: str) -> dict:
    r = mp.acos(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return _real_or_domain_error(_from_radians(r, mode))


def atan(x: float, mode: str) -> dict:
    return _real_or_domain_error(_from_radians(mp.atan(mp.mpf(str(x))), mode))


def sqrt_real(x: float) -> dict:
    """実数の平方根。

    **負の実数は定義域の外**である（S-1 設計書 §1 の裁定 1）。判定は Rust の
    分岐を写したものではなく、mpmath が mpc（複素数）を返すかどうかで決める。
    """
    r = mp.sqrt(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return {"re": float(r), "im": 0.0}
