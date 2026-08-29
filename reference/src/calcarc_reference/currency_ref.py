"""為替換算の参照実装（U-4 spec §3・§3.1）。

数値は `fractions.Fraction`（任意精度の厳密有理数）。**`float` を一度も経由しない**
——`"155.23"` は `15523/100` であって、`f64` の 155.2300000000000039... ではない
（spec §2.1・§3）。

**Rust の実装は見ていない。** 式は spec §3 と §3.1 から書き起こしている。

**レートは定義値ではなく、外から来る入力である**（spec §3）。だからこのモジュールは
レート表を持たない——`exchange` はレートを 2 つ受け取るだけで、どこからも取りに行かない。
持っているのは **ISO 4217 の minor unit**（`MINOR_UNITS`）だけで、こちらは定義値である。

**換算は必ず基準通貨を経由する**（spec §3。U-1 §3.1 の「必ず基準単位を経由する」と同じ形）:

    基準 = value ÷ rate_from
    結果 = 基準 × rate_to

**通貨に `offset` は無い**（すべて倍率のみ）。したがって U-1 のアフィン機構に 1 行も
足さずに乗る。

**表示は U-1 と別の規則である**（spec §3.1）。U-1 の `format_rational` は
**有効数字 10 桁**で切るが、通貨は**小数点以下を通貨ごとの固定桁**（0 か 2）で切る。
**切る場所が違うので、関数も分けてある**——`convert_ref.format_rational` に分岐を
足していない。共有するのは **3 桁カンマ**と **round-half-to-even** の規則だけである。
"""

from __future__ import annotations

import re
from fractions import Fraction

# ISO 4217 List One の minor unit（spec §3.1 の表）。
# **これは為替レートと違い定義値である**——だから spec はここに表を書き、
# 【ISO 4217 の確認 2026-08-20】が `list-one.xml`（`Pblshd="2026-01-01"`、
# Amendment 180 発効中）と 16 行すべてを突き合わせている。
#
# **並びは spec §3.1 の表の順**（§7 の面の並びもこの順）。
# **小数桁 3 の通貨（`KWD` `BHD` `JOD` `OMR` など）は入れない**——入れると
# 「0 か 2 のどちらか」という単純さが崩れる（spec §3.1 が明示的にそう決めている）。
MINOR_UNITS: dict[str, int] = {
    "jpy": 0,
    "krw": 0,
    "vnd": 0,
    "usd": 2,
    "eur": 2,
    "gbp": 2,
    "chf": 2,
    "cny": 2,
    "thb": 2,
    "sgd": 2,
    "hkd": 2,
    "twd": 2,
    "aud": 2,
    "cad": 2,
    "inr": 2,
    "brl": 2,
}

# **受け付けるのは 10 進リテラルだけ**（U-1 の `convert_ref._LITERAL` と同じ形）。
# 指数表記は受けない——盤面にその打ち方が無い。
#
# **`re.ASCII` が要る。** Python の `\d` は既定で Unicode の数字を含むので、
# 付けないと全角の `１２３` が通ってしまう（`Fraction()` はそれを受け付ける）。
# **Rust 側は ASCII しか受けない**ので、そういう値が golden に入ると 2 実装が
# 静かに食い違う。
#
# **値にもレートにも同じ規則を当てる。** レートは `"155.23"` のような 10 進文字列で
# 外から来る（spec §2.1。**`number` を経由させない**）。別々の規則を持たせない。
_LITERAL = re.compile(r"\A-?\d+(\.\d+)?\Z", re.ASCII)


# **リテラルの天井は公開契約である**（`docs/numerical-policy.md`「分子・分母は
# `i128` で有界」）。**アルゴリズムではない**——Rust が 1 桁ずつ積み上げるのも、
# こちらが数字列を丸ごと `int` にするのも、**同じ天井を別の手順で測っている**。
# `data_scale_ref.U128_MAX` と同じ扱いで、**この定数は 1 つである**——写すと、
# 天井が動いた日に片方だけ古くなる。
I128_MAX = (1 << 127) - 1


def literal_fits(text: str) -> bool:
    """10 進リテラルが `i128` の分子・分母に収まるか（公開契約）。

    独立: 別手順（Rust は 1 桁ずつ `checked_mul(10).checked_add(d)` で積み上げ、
    溢れた時点で `Overflow` を返す。こちらは多倍長なので**数字列を丸ごと整数に
    して天井と比べる**——桁上げのループを持たない。だから片方の積み上げの誤りは
    もう片方に写らない）。

    **写しているのは天井の値だけ**である。`i128` の上限は numerical-policy の
    「分子・分母は `i128` で有界」が固定した**公開契約**であって、実装の都合では
    ない——だから両方に書いても「参照実装を Rust の移植にしない」に触れない。

    **分母は `10 ** 小数桁数`** である（`0.5` なら 10、`0.05` なら 100）。約分は
    しない——Rust もリテラルを読む段では約分しないので、**ここで約分すると
    「何桁で溢れるか」が食い違う**。
    """
    integer, _, fraction = text.lstrip("-").partition(".")
    return int(integer + fraction) <= I128_MAX and 10 ** len(fraction) <= I128_MAX


def exchange(value: Fraction, from_rate: Fraction, to_rate: Fraction) -> Fraction:
    """spec §3 の式。レートは「**1 基準通貨 = rate 通貨**」である。

    **基準通貨を経由する**——`value ÷ rate_from` で基準に戻し、`× rate_to` で目的の
    通貨へ移す。N × N のレート表は持たない。

    `from_rate` が 0 なら `ZeroDivisionError`。**呼び出し側（`compute`）が
    `DivisionByZero` に落とす**——レートは外から来るので、0 が来ることは有り得る。
    """
    return (value / from_rate) * to_rate


def format_amount(value: Fraction, decimals: int) -> str:
    """**小数点以下を `decimals` 桁に固定**して 10 進文字列にする（spec §3.1）。

    U-1 の `format_rational`（有効数字 10 桁）とは**切る場所が違う**。ここでは:

    - **末尾が 0 でも桁を出す**——`12.50` を `12.5` にしない
    - **`decimals` が 0 なら小数点を出さない**——`JPY` に `.0` は付かない
    - **丸めは round-half-to-even**（プロジェクトの中で丸め方向を 2 つ持たない）
    - **整数部だけ 3 桁ごとにカンマ**（numerical-policy の表示節。小数部には入れない）

    **丸めた結果が 0 なら符号を出さない**——`-0.001 USD` は `-0.00` ではなく `0.00`。
    spec は書いていないが、**表示された 0 に符号が付くと「0 でない」の意味に読める**。
    U-1 の `format_rational` が `Fraction(0)` を `"0"` と書くのと同じ扱いにする。
    """
    negative = value < 0
    magnitude = -value if negative else value

    # 10^decimals 倍して整数部を取り、余りで half-to-even を決める。
    # **`round()` を使わない**——Fraction を丸める道具はいくつもあるが、
    # 「余りが分母のちょうど半分か」を自分で見たほうが、規則が読める。
    scaled = magnitude * 10**decimals
    whole, rest = divmod(scaled.numerator, scaled.denominator)
    twice = 2 * rest
    if twice > scaled.denominator or (twice == scaled.denominator and whole % 2 == 1):
        whole += 1

    digits = str(whole)
    if decimals:
        digits = digits.rjust(decimals + 1, "0")  # 0.05 のように整数部が 0 の場合
        integer, fraction = digits[:-decimals], digits[-decimals:]
        body = f"{int(integer):,}." + fraction
    else:
        body = f"{whole:,}"

    sign = "-" if negative and whole != 0 else ""
    return sign + body


def compute(value: str, src: str, dst: str, from_rate: str, to_rate: str) -> dict:
    """入口。**エラーは例外ではなく戻り値**（他の参照実装と同じ流儀）。

    **レートは入力である**（spec §8）。プロバイダを叩かない。
    """
    if src not in MINOR_UNITS or dst not in MINOR_UNITS:
        return {"error": "SyntaxError"}
    for text in (value, from_rate, to_rate):
        if not _LITERAL.match(text):
            return {"error": "SyntaxError"}
    # **3 つとも読んでから換算に入る**（Rust の `convert_currency` も
    # `parse_decimal` を 3 回通してから `exchange` を呼ぶ）。だから天井の検査は
    # **0 レートの検査より先**である——順が逆だと、両方に当たる入力で
    # 2 実装が別のエラーを返す。
    for text in (value, from_rate, to_rate):
        if not literal_fits(text):
            return {"error": "Overflow"}
    rate_from = Fraction(from_rate)
    if rate_from == 0:
        # **レートは外から来る**（spec §3）。0 は割り算ではなくエラーである。
        return {"error": "DivisionByZero"}
    landed = exchange(Fraction(value), rate_from, Fraction(to_rate))
    return {"text": format_amount(landed, MINOR_UNITS[dst])}
