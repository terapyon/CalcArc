"""**非自明な係数で、有効数字 10 桁の丸めの半端にちょうど落ちる入力を探す。**

## なぜ

`convert_ref.format_rational` は **round-half-to-even** である
（`twice == denominator` のとき `whole % 2` で向きを決める）。**その分岐は
`testdata/convert.json` の `length` だけが踏んでおり、しかも `m -> m`
——係数 1、最も易しい形**である（2026-08-30 実測）。

**「非自明な係数でも踏めるか」は、主張ではなく探索でしか答えられない。**
**「探したが見つからなかった」と「無い」は違う**ので、**上限を宣言して、
その範囲で網羅したことを印字する。**

## 何を解いているか

結果 `r` が半端になるのは、`r` を `[1,10)` に正規化して `10^9` 倍したとき
**小数部がちょうど 1/2** のとき。**入力は `value = (r − offset) / factor`**
で決まるが、**電卓が受け付ける入力は有限小数だけ**である
（`1e3` も全角も `SyntaxError`。実測）。

**だから条件は 2 つ**——`r` が半端であること、`(r − offset)/factor` の
既約分母が `2^a · 5^b` であること。

## 使い方

```bash
cd reference && uv run --no-config python scripts/find_convert_half_way.py
```

**終了コードは常に 0。** 合否ではなく、**探索の記録**である。
"""

from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from calcarc_reference.convert_ref import CATEGORIES, format_rational  # noqa: E402

#: **探索の上限。** 宣言しないと「探した」が測れない。
#: 各単位対について、**指数をこの範囲で振り**、**半端の仮数をこの数だけ試す。**
EXPONENT_RANGE = range(-12, 13)
MANTISSA_SAMPLES = 40

#: **入力の長さの上限**（文字数）。**打てないものは採らない**
#: ——golden に置いても `heavy:ui` が盤面から確かめられない。
MAX_INPUT_LENGTH = 14


def is_finite_decimal(value: Fraction) -> bool:
    """既約分母が `2^a · 5^b` か。**電卓は有限小数しか受け付けない。**"""
    denominator = value.denominator
    for prime in (2, 5):
        while denominator % prime == 0:
            denominator //= prime
    return denominator == 1


def as_decimal(value: Fraction) -> str:
    """有限小数を、指数を使わない十進の文字列にする。"""
    digits = 0
    scaled = value
    while scaled.denominator != 1:
        scaled *= 10
        digits += 1
    text = str(abs(scaled.numerator)).rjust(digits + 1, "0")
    body = text if digits == 0 else f"{text[:-digits]}.{text[-digits:]}"
    return ("-" if value < 0 else "") + body


def half_way_results(exponent: int, samples: int) -> list[Fraction]:
    """**指数 `exponent` の帯で、ちょうど半端になる結果**を作る。

    `[1,10)` に正規化した仮数が `d.ddddddddd5`（10 桁 + 半端）になるもの。
    **`whole` の偶奇で丸めの向きが変わる**ので、**偶数と奇数の両方**を返す。
    """
    found: list[Fraction] = []
    for index in range(samples):
        # 10 桁の整数（1000000000〜9999999999）を散らして取る。
        whole = 10**9 + index * ((9 * 10**9) // max(samples, 1))
        mantissa = Fraction(2 * whole + 1, 2 * 10**9)  # = whole.5 / 10^9
        found.append(mantissa * Fraction(10) ** exponent)
    return found


def main() -> None:
    pairs = 0
    hits: list[tuple[str, str, str, str, str]] = []
    for category, units in CATEGORIES.items():
        for src, (src_factor, src_offset) in units.items():
            for dst, (dst_factor, dst_offset) in units.items():
                if src == dst:
                    continue
                pairs += 1
                # 変換: base = value * src_factor + src_offset
                #       result = (base - dst_offset) / dst_factor
                # 逆に解くと value = ((result * dst_factor + dst_offset) - src_offset) / src_factor
                best: tuple[str, str] | None = None
                for exponent in EXPONENT_RANGE:
                    for result in half_way_results(exponent, MANTISSA_SAMPLES):
                        value = (result * dst_factor + dst_offset - src_offset) / src_factor
                        if value <= 0 or not is_finite_decimal(value):
                            continue
                        text = as_decimal(value)
                        # **打てない入力は採らない。** golden に置いても
                        # **盤面から確かめられない**（`heavy:ui` が打鍵する）。
                        if len(text) > MAX_INPUT_LENGTH:
                            continue
                        shown = format_rational(result)
                        # **指数表記に落ちる結果は後回しにする。** 見たいのは
                        # **丸めとカンマが同時に効く帯**である。
                        if "e" in shown and best is not None:
                            continue
                        best = (text, shown)
                        if "e" not in shown:
                            break
                    if best is not None and "e" not in best[1]:
                        break
                if best is not None:
                    hits.append((category, src, dst, best[0], best[1]))

    trivial = {(c, s, d) for c, s, d, _, _ in hits if CATEGORIES[c][s][0] == CATEGORIES[c][d][0]}
    print(f"探索した単位対: {pairs}")
    print(
        f"上限: 指数 {EXPONENT_RANGE.start}〜{EXPONENT_RANGE.stop - 1} / 仮数 {MANTISSA_SAMPLES} 個"
    )
    print(f"半端に落ちる入力が構成できた対: {len(hits)}")
    print(f"  うち係数が等しい（＝自明な）対: {len(trivial)}")
    print()
    plain = [h for h in hits if "e" not in h[4]]
    print(f"  うち結果が指数表記にならない（丸めとカンマが同時に効く）対: {len(plain)}")
    print()
    print("**盤面から打てて、結果が普通の表記になるもの**（各カテゴリから 2 対まで）:")
    shown_per_category: dict[str, int] = {}
    for category, src, dst, text, shown in plain:
        if shown_per_category.get(category, 0) >= 2:
            continue
        shown_per_category[category] = shown_per_category.get(category, 0) + 1
        factor = CATEGORIES[category][src][0] / CATEGORIES[category][dst][0]
        print(f"  {category:11} {text:>14} {src:>8} -> {dst:<8} = {shown:<14} 係数 {factor}")


if __name__ == "__main__":
    main()
