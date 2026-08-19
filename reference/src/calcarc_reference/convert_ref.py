"""単位換算の参照実装（U-1 spec §3.1〜§3.5）。

数値は `fractions.Fraction`（任意精度の厳密有理数）。**係数はすべて定義値であって
測定値ではない**——出典は国際ヤード・ポンド協定（1959）と SI。式は spec §3.2 の表から
書き起こしている。

**Rust の実装は見ていない。**

**すべての単位はアフィン変換 1 本で表す**（spec §3.1）:

    base  = value × factor + offset
    value = (base − offset) ÷ factor

**換算は必ず基準単位を経由する**（spec §0.0-5）。N 個の単位に N × N の式を持たない。

**温度は「点」である**（spec §3.4）。温度差の換算はしない。
"""

from __future__ import annotations

from fractions import Fraction

_ZERO = Fraction(0)
_ONE = Fraction(1)

# 常衡ポンド。**質量の非 SI 単位はここ 1 つだけが定義値で、残りはこれの倍数**
# ——spec §3.2 の表が `oz` を `lb`/16、`st` を 14 × `lb` と書いている。
_LB = Fraction(45359237, 10**8)  # ちょうど 0.45359237 kg（1959）

# (factor, offset)。基準単位は factor = 1、offset = 0。
# **spec §3.2 の表をそのまま書く。** 長さの `ft` `yd` `mi` は表が
# `12 × in` などの導出と**約分済みの定義値の両方**を書いているので、定義値のほうを
# 採る——`ft = 12 × in` を式で書くと、in を直した日に ft が黙って付いてくる。
# **それは正しい振る舞いだが、表が「何が定義値か」を語らなくなる。**
# 質量の `oz` `st` は表自身が `lb` からの導出しか持たないので、そちらに従う。
CATEGORIES: dict[str, dict[str, tuple[Fraction, Fraction]]] = {
    "length": {  # 基準: メートル
        "nm": (Fraction(1, 10**9), _ZERO),
        "um": (Fraction(1, 10**6), _ZERO),
        "mm": (Fraction(1, 1000), _ZERO),
        "cm": (Fraction(1, 100), _ZERO),
        "m": (_ONE, _ZERO),
        "km": (Fraction(1000), _ZERO),
        "in": (Fraction(127, 5000), _ZERO),  # ちょうど 25.4 mm（1959）
        "ft": (Fraction(381, 1250), _ZERO),  # ちょうど 0.3048 m
        "yd": (Fraction(1143, 1250), _ZERO),  # ちょうど 0.9144 m
        "mi": (Fraction(201168, 125), _ZERO),  # ちょうど 1609.344 m
        "nmi": (Fraction(1852), _ZERO),  # 海里。ちょうど 1852 m
    },
    "mass": {  # 基準: キログラム
        "mg": (Fraction(1, 10**6), _ZERO),
        "g": (Fraction(1, 1000), _ZERO),
        "kg": (_ONE, _ZERO),
        "t": (Fraction(1000), _ZERO),  # メートルトン
        "lb": (_LB, _ZERO),
        "oz": (_LB / 16, _ZERO),  # 常衡オンス = lb / 16
        "st": (14 * _LB, _ZERO),  # ストーン = 14 lb
    },
    "temperature": {  # 基準: ケルビン
        "k": (_ONE, _ZERO),
        "degc": (_ONE, Fraction(5463, 20)),  # 273.15
        "degf": (Fraction(5, 9), Fraction(45967, 180)),  # K = (F + 459.67) × 5/9
    },
}


def to_base(value: Fraction, factor: Fraction, offset: Fraction) -> Fraction:
    return value * factor + offset


def from_base(base: Fraction, factor: Fraction, offset: Fraction) -> Fraction:
    return (base - offset) / factor


def convert_value(value: Fraction, category: str, src: str, dst: str) -> Fraction | None:
    """換算する。**知らないカテゴリ・単位は `None`**（例外にしない——呼び出し側が
    `{"error": "SyntaxError"}` に落とす）。

    **カテゴリをまたぐ換算は存在しない。** `km → kg` は「知らない単位」と同じ扱いで、
    表の引き方が自然にそうなる（カテゴリの表に `kg` は無い）。
    """
    table = CATEGORIES.get(category)
    if table is None:
        return None
    if src not in table or dst not in table:
        return None
    base = to_base(value, *table[src])
    return from_base(base, *table[dst])
