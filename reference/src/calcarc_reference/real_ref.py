"""通常表示の参照実装（段階 J）。

**Rust の移植ではない。** `numeric/format.rs` の `format_real` は f64 を一度
`{:.9e}` で文字列にしてから指数を読み直し、その指数から小数桁数を決めて
**元の f64 を改めて整形する**。こちらは f64 の厳密な十進値を `Decimal` で取り、
有効数字 10 桁に 1 度だけ丸めてから、その丸めた値だけを見て表記を決める。

同じ答えに別の道で着くことが検証の土台である（base-spec §30）。

表示の規則:

- 有効数字 10 桁、round-half-to-even
- `1e-9` 以上 `1e10` 未満は平坦な十進、それ以外は指数表記
- 整数部だけ 3 桁ごとにカンマ（小数部と指数部には入れない）
- 末尾のゼロと裸の小数点は落とす
- `0` と `-0.0` はどちらも `"0"`

**判定は丸めた後の値で行う。** `9999999999.6` は 10 桁に丸めると `1e10` に
なり、平坦表示の帯を出る——丸める前の値からは先読みできない。
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, localcontext

DISPLAY_DIGITS = 10

#: この 10 の冪以上で指数表記にする（`|x| >= 1e10`）。
EXP_HIGH_EXPONENT = 10
#: この 10 の冪未満で指数表記にする（`|x| < 1e-9`）。
EXP_LOW_EXPONENT = -9


def group_integer_part(text: str) -> str:
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


def trim_zeros(text: str) -> str:
    """末尾のゼロと、裸になった小数点を落とす。"""
    if "." not in text:
        return text
    return text.rstrip("0").rstrip(".")


def round_to_display(x: float) -> Decimal:
    """f64 を有効数字 10 桁に丸める。

    **`repr(x)` を経由しない。** あれは「往復できる最短の十進」であって、
    有効数字 10 桁への丸めとは別の操作である。`Decimal(x)` は f64 のビットから
    厳密な十進値を作る。
    """
    with localcontext() as ctx:
        ctx.prec = DISPLAY_DIGITS
        ctx.rounding = ROUND_HALF_EVEN
        return +Decimal(x)


def decimal_exponent_of(rounded: Decimal) -> int:
    """丸めた値の 10 進指数。最上位桁の位置である。"""
    _, digits, exponent = rounded.as_tuple()
    if not isinstance(exponent, int):  # pragma: no cover - inf/nan は呼ばれない
        raise TypeError(f"not a finite decimal: {rounded}")
    return len(digits) - 1 + exponent


def format_real(x: float) -> str:
    """実数 1 つを表示文字列にする。"""
    if x == 0.0:
        # **`-0.0` も `"0"`。** 符号は出さない。
        return "0"
    rounded = round_to_display(x)
    exponent = decimal_exponent_of(rounded)
    if not (EXP_LOW_EXPONENT <= exponent < EXP_HIGH_EXPONENT):
        # 指数表記。仮数は 1 以上 10 未満で、桁区切りは入らない。
        mantissa = rounded.scaleb(-exponent)
        body = trim_zeros(f"{mantissa:.{DISPLAY_DIGITS - 1}f}")
        return f"{body}e{exponent}"
    # 平坦な十進。小数点以下の桁数 = 有効数字 10 桁 - 整数部の桁数。
    decimals = max(0, DISPLAY_DIGITS - 1 - exponent)
    return group_integer_part(trim_zeros(f"{rounded:.{decimals}f}"))


def format_rect(re: float, im: float) -> str:
    """直交形式。**`j` は数の後ろに置く**（`3+4j` / `2j` / `-2j`）。

    **【変更 2026-08-25】0.3.x までは前に置いていた**（`3+j4`）。ユーザー指示で
    後置に変えた。参照実装は Rust の移植ではないので、**この規則を spec から
    独立に書いている**——揃っていることは engine_table と各言語のテストが見る。

    虚部が 0 のときは実数として表示する——engine の `is_real()` と同じ線引きで、
    `0j` とは出さない（実測 2026-08-17: `j` `0` `=` は `0` を表示する）。
    """
    if im == 0.0:
        return format_real(re)
    body = format_real(abs(im))
    if re == 0.0:
        sign = "-" if im < 0 else ""
        return f"{sign}{body}j"
    sign = "-" if im < 0 else "+"
    return f"{format_real(re)}{sign}{body}j"


def format_polar(r: float, theta_deg: float) -> str:
    """極形式。**半径と角度の間に空白付きの `∠`** を置く（実測 `5 ∠ 53.13010235`）。"""
    return f"{format_real(r)} ∠ {format_real(theta_deg)}"
