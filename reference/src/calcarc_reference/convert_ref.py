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

import re
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


_DIGITS = 10
# **受け付ける値は 10 進リテラルだけ**（式は Rust 側の評価器が持つ。golden で
# 二重に持たない）。指数表記の入力は受けない——盤面にその打ち方が無い。
_LITERAL = re.compile(r"\A-?\d+(\.\d+)?\Z")


def format_rational(value: Fraction) -> str:
    """有効数字 10 桁の 10 進文字列にする（numerical-policy の「表示」節）。

    **log10 を使わない。** 10 の冪の近くで 1 桁ずれるうえ、丸めの繰り上がり
    （`9999999999.5` → `1e10`）を先読みできない。10 倍・1/10 倍で正規化して
    **丸めた後の指数**を持つ。
    """
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    v = -value if value < 0 else value

    # 1 <= v < 10 に正規化し、そのとき動かした冪を exponent に持つ。
    exponent = 0
    while v >= 10:
        v /= 10
        exponent += 1
    while v < 1:
        v *= 10
        exponent -= 1

    # 有効数字 10 桁 = 整数部 1 桁 + 小数 9 桁。10^9 倍して丸める。
    scaled = v * 10 ** (_DIGITS - 1)
    whole, rest = divmod(scaled.numerator, scaled.denominator)
    twice = 2 * rest
    if twice > scaled.denominator or (twice == scaled.denominator and whole % 2 == 1):
        whole += 1
    if whole == 10**_DIGITS:  # 繰り上がりで 11 桁になった
        whole //= 10
        exponent += 1

    digits = str(whole)  # ちょうど 10 桁

    # **境の判定は丸めた後の指数で行う**(spec §3.3)。
    if exponent >= 10 or exponent <= -10:
        mantissa = _trim(digits[0] + "." + digits[1:])
        return f"{sign}{mantissa}e{exponent}"

    if exponent >= 0:
        integer, fraction = digits[: exponent + 1], digits[exponent + 1 :]
    else:
        integer, fraction = "0", "0" * (-exponent - 1) + digits
    body = _trim(integer + "." + fraction) if fraction else integer
    return sign + _group(body)


def _trim(text: str) -> str:
    """末尾の 0 と、裸になった小数点を落とす。"""
    return text.rstrip("0").rstrip(".") if "." in text else text


def _group(text: str) -> str:
    """整数部だけ 3 桁ごとに区切る。**小数部には入れない**（numerical-policy）。"""
    integer, dot, fraction = text.partition(".")
    grouped = f"{int(integer):,}"
    return grouped + dot + fraction


def compute(value: str, category: str, src: str, dst: str) -> dict:
    """入口。**エラーは例外ではなく戻り値**（他の参照実装と同じ流儀）。"""
    if not _LITERAL.match(value):
        return {"error": "SyntaxError"}
    landed = convert_value(Fraction(value), category, src, dst)
    if landed is None:
        return {"error": "SyntaxError"}
    return {"text": format_rational(landed)}
