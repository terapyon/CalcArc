"""60 進表示の参照実装。

Rust は f64 の trunc と乗算で桁を割り出す。ここは **Fraction の厳密有理数**で
やる——`3.75 = 15/4` から `3 + 45/60` を厳密に出せるので、**f64 の割り算を
1 度も通らない**。アルゴリズムが同型でないことがこの層の価値である
（CONTRIBUTING: 参照実装を Rust の移植にしない）。
"""

from __future__ import annotations

import math
from fractions import Fraction

DISPLAY_DIGITS = 10


def format_sexagesimal(x: float) -> str | None:
    """60 進の文字列。60 進にできなければ None（S-4 設計書 §3、裁定 6）。"""
    if not math.isfinite(x):
        return None
    sign = "-" if x < 0 else ""
    # f64 の二進値をそのまま厳密な有理数にする。10 進 repr を経由しない。
    a = Fraction(abs(x))
    degrees = a.numerator // a.denominator
    int_digits = 1 if degrees == 0 else len(str(degrees))
    if int_digits + 4 > DISPLAY_DIGITS:
        return None
    rest = (a - degrees) * 60
    minutes = rest.numerator // rest.denominator
    seconds = (rest - minutes) * 60
    decimals = max(0, DISPLAY_DIGITS - int_digits - 4)

    # 丸めてから繰り上がりを見る（Rust と同じ順序だが、丸めるのは有理数）。
    # Python の round() は round-half-to-even で、Rust の書式化と同じ規則。
    # **一致は偶然ではなく、どちらも IEEE 754 の既定に従っているため**である。
    quantum = Fraction(1, 10**decimals)
    rounded = Fraction(round(seconds / quantum)) * quantum
    if rounded >= 60:
        rounded = Fraction(0)
        minutes += 1
        if minutes >= 60:
            minutes = 0
            degrees += 1

    text = f"{float(rounded):.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return f"{sign}{degrees}°{minutes}'{text}\""
