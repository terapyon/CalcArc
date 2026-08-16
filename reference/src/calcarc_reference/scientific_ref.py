"""単項関数の参照実装。

Rust は libm の f64 実装を使う。ここでは mpmath の任意精度実装を
50 桁で評価してから f64 に落とす。
"""

from __future__ import annotations

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


def sqrt_real(x: float) -> dict:
    """実数の平方根。

    **負の実数は定義域の外**である（S-1 設計書 §1 の裁定 1）。判定は Rust の
    分岐を写したものではなく、mpmath が mpc（複素数）を返すかどうかで決める。
    """
    r = mp.sqrt(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return {"re": float(r), "im": 0.0}
