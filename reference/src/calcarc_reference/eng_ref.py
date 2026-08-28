"""工学表記の参照実装（段階 I）。

**Rust の移植ではない。** `numeric/format.rs` は f64 を一度 `{:.9e}` で文字列に
してから指数を読み直し、仮数を `10^shift` 倍して再び整形する。こちらは
**f64 の厳密な十進値**を `Decimal` で取り、指数と仮数を直接求める。
同じ答えに別の道で着くことが検証の土台である。

表示の桁数は有効数字 10 桁で、指数は 3 の倍数へ**下向きに**丸める
（`1` → `0`、`-1` → `-3`、`-4` → `-6`）。
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, localcontext

DISPLAY_DIGITS = 10


def _group_integer_part(text: str) -> str:
    """整数部だけを 3 桁ごとに区切る。**小数部と指数部には入れない。**"""
    sign, rest = ("-", text[1:]) if text.startswith("-") else ("", text)
    if "." in rest:
        integer, fraction = rest.split(".", 1)
        fraction = f".{fraction}"
    else:
        integer, fraction = rest, ""
    grouped = ""
    for index, char in enumerate(integer):
        if index != 0 and (len(integer) - index) % 3 == 0:
            grouped += ","
        grouped += char
    return f"{sign}{grouped}{fraction}"


def _trim_zeros(text: str) -> str:
    """末尾のゼロと、裸になった小数点を落とす。"""
    if "." not in text:
        return text
    return text.rstrip("0").rstrip(".")


def format_real_eng(x: float) -> str:
    """工学表記の文字列。

    **`//` を使い、`int()` を経由しない。** Python の `//` は負の無限大方向に
    丸めるので `-1 // 3 == -1` で正しいが、`int(-1 / 3)` は `0` になる
    ——負の指数側だけ静かに壊れる(Rust 側も同じ罠を `div_euclid` で避けている)。
    """
    if x == 0.0:
        return "0"
    with localcontext() as ctx:
        ctx.prec = DISPLAY_DIGITS
        ctx.rounding = ROUND_HALF_EVEN
        # **f64 のビットから厳密な十進値を取り**、有効数字 10 桁に丸める。
        # `repr(x)` を経由しない——あれは「往復できる最短の十進」であって、
        # 有効数字 10 桁の丸めとは別の操作である。
        rounded = +Decimal(x)
    sign = rounded.as_tuple().sign
    # 10 進指数 = 最上位桁の位置。**`as_tuple()` から組み立てない**——
    # あちらの `exponent` は NaN と無限大で `'n'`/`'N'`/`'F'` という**印**を返す
    # ので、`len(digits) - 1 + exponent` は「数と印を足す」式になる(有限値しか
    # 来ない前提なら動くが、その前提はどこにも書かれていない)。`adjusted()` は
    # **同じ値を返し、型が `int` に閉じている。**
    decimal_exponent = rounded.adjusted()
    eng_exponent = (decimal_exponent // 3) * 3
    shift = decimal_exponent - eng_exponent  # 0, 1, 2 のいずれか
    int_digits = shift + 1
    decimals = max(0, DISPLAY_DIGITS - int_digits)
    # 仮数は 10^eng_exponent で割った値。小数点を動かすだけなので精度は落ちない。
    mantissa = rounded.scaleb(-eng_exponent)
    body = _trim_zeros(f"{mantissa:.{decimals}f}")
    if sign and not body.startswith("-"):
        body = f"-{body}"
    if eng_exponent == 0:
        # 指数 0 は書かない。通常の 10 進と同じ扱いにする。
        return _group_integer_part(body)
    return f"{body}e{eng_exponent}"
