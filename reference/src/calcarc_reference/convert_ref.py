"""単位換算の参照実装（U-1 spec §3.1〜§3.5、U-2 spec §3.1〜§3.6）。

数値は `fractions.Fraction`（任意精度の厳密有理数）。**係数はすべて定義値であって
測定値ではない**——出典は国際ヤード・ポンド協定（1959）と SI、そして
面積の `畳` は不動産の表示に関する公正競争規約施行規則 第 9 条第 16 号
（令和 4 年 9 月 1 日施行）である。式は U-1 spec §3.2 と U-2 spec §3.1〜§3.6 の表から
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

# 面積と体積のヤード・ポンド系は、1 つの定義値の積み上げでできている。
# **上と同じ流儀**——U-2 spec の表が導出と約分済みの値の**両方**を書いている行
# （`in²` `ac` `gal(US)`）は約分済みのほうを採り、**導出しか書いていない行**
# （`ft²` `yd²` `fl oz` `pt` `qt` `cup`）は導出のまま書く。
_IN2 = Fraction(16129, 25000000)  # (127/5000)² m²。国際インチの 2 乗
_FT2 = 144 * _IN2  # 12 in × 12 in
_YD2 = 9 * _FT2  # 3 ft × 3 ft
_GAL_US = Fraction(473176473, 125000000)  # 231 × in³。ちょうど 3.785411784 L
_GAL_IMP = Fraction(454609, 100000)  # ちょうど 4.54609 L（1985）
_FLOZ_US = _GAL_US / 128
_FLOZ_IMP = _GAL_IMP / 160

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
    "area": {  # 基準: 平方メートル（U-2 spec §3.1）
        "mm2": (Fraction(1, 10**6), _ZERO),
        "cm2": (Fraction(1, 10**4), _ZERO),
        "m2": (_ONE, _ZERO),
        "km2": (Fraction(10**6), _ZERO),
        "ha": (Fraction(10**4), _ZERO),  # ヘクタール
        "in2": (_IN2, _ZERO),
        "ft2": (_FT2, _ZERO),
        "yd2": (_YD2, _ZERO),
        # 4840 yd²。**ちょうど 4046.8564224 m²**（= 316160658/78125）。
        # 導出のほうは `the_acre_is_the_yard_pound_stack` が突き合わせる。
        "ac": (Fraction(316160658, 78125), _ZERO),
        # 1 尺 = 10/33 m、1 坪 = 6 尺 × 6 尺 = (20/11)² m²。
        "tsubo": (Fraction(400, 121), _ZERO),
        # **1.62 m² ちょうど**。畳は地域で違うので、表示規約が広告に用いる下限を採る
        # （U-2 spec §3.2。**ラベルは `畳(1.62m²)` と基準を名前に書く**）。
        # **慣用の「1 坪 = 2 畳」には寄せない**——20000/9801 = 2.040608101… と出る。
        "jo": (Fraction(81, 50), _ZERO),
    },
    "volume": {  # 基準: リットル（U-2 spec §3.4）
        "ml": (Fraction(1, 1000), _ZERO),
        "cl": (Fraction(1, 100), _ZERO),
        "dl": (Fraction(1, 10), _ZERO),
        "l": (_ONE, _ZERO),
        "m3": (Fraction(1000), _ZERO),
        "gal_us": (_GAL_US, _ZERO),
        "gal_imp": (_GAL_IMP, _ZERO),
        # **US と Imperial は倍率が違う**（US は gal/128 の 16・32・8 倍、
        # Imperial は gal/160 の 20・40 倍）。取り違えないよう系ごとに積む。
        "floz_us": (_FLOZ_US, _ZERO),
        "floz_imp": (_FLOZ_IMP, _ZERO),
        "pt_us": (16 * _FLOZ_US, _ZERO),
        "pt_imp": (20 * _FLOZ_IMP, _ZERO),
        "qt_us": (32 * _FLOZ_US, _ZERO),
        "qt_imp": (40 * _FLOZ_IMP, _ZERO),
        "cup_us": (8 * _FLOZ_US, _ZERO),  # 米国慣用カップ。236.5882365 mL
        "cup_jp": (Fraction(1, 5), _ZERO),  # 日本の計量カップ。ちょうど 200 mL
    },
    "speed": {  # 基準: メートル毎秒（U-2 spec §3.5）
        "mps": (_ONE, _ZERO),
        "kmh": (Fraction(5, 18), _ZERO),  # 1000/3600
        "mph": (Fraction(1397, 3125), _ZERO),  # mi/3600。ちょうど 0.44704 m/s
        "kn": (Fraction(463, 900), _ZERO),  # 1852/3600。海里毎時
    },
    "data-size": {  # 基準: バイト（U-2 spec §3.6）
        # **SI と IEC を分離する**（設計書 §6）。`GB` と `GiB` を同じにしない。
        "bit": (Fraction(1, 8), _ZERO),  # **1/8 である。** 有理数なので 0.125 が厳密に出る
        "byte": (_ONE, _ZERO),
        "kb": (Fraction(10**3), _ZERO),
        "mb": (Fraction(10**6), _ZERO),
        "gb": (Fraction(10**9), _ZERO),
        "tb": (Fraction(10**12), _ZERO),
        "pb": (Fraction(10**15), _ZERO),
        "kib": (Fraction(2**10), _ZERO),
        "mib": (Fraction(2**20), _ZERO),
        "gib": (Fraction(2**30), _ZERO),
        "tib": (Fraction(2**40), _ZERO),
        "pib": (Fraction(2**50), _ZERO),
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
#
# **`re.ASCII` が要る。** Python の `\d` は既定で Unicode の数字を含むので、
# 付けないと全角の `１２３` やアラビア数字の `١٢٣` が通ってしまう
# （`Fraction()` も `int()` もそれらを受け付けるので、値まで出てしまう）。
# **Rust 側は ASCII しか受けない**ので、そういう値が golden に入ると
# 2 実装が静かに食い違う。
_LITERAL = re.compile(r"\A-?\d+(\.\d+)?\Z", re.ASCII)


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
