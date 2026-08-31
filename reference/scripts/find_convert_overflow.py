"""**`convert` で `Overflow` に到達する入力が在るか。**

## なぜ

**`testdata/convert.json` の `Overflow` は 0 件**である（2026-08-30 実測。
エラー 4 件はすべて `SyntaxError`）。**0.3.x triage の C10 が
「`Overflow` の枝が golden で一度も踏まれない」と起票している。**

**参照側（`convert_ref`）は `Overflow` を持っていない**——`i128` の上限が
無いので、`Fraction` はいくらでも小さい値を表せる。**上限は Rust 側にだけ在る。**

## ★ この探索は Rust を「模して」いる。移植ではない

**`crates/calcarc-core/src/convert/format.rs` の正規化ループの
あふれ条件だけ**を写す——**`u128` の上限に触れるかどうか**である。
**丸めも桁の取り出しも書かない。** **`i128` / `u128` の天井は
`docs/numerical-policy.md` が固定した公開契約**なので、
**両側が同じ数を知っていてよい**（通貨で 2026-08-29 に採った線引きと同じ）。

## 何を探すか

`format_rational` は `1 ≤ p/q < 10` に正規化する。**分母のほうが大きいとき
（`p < q`）、`p` を 10 倍して届かせる**——**その途中で `p` が `u128` を
超えたら `Overflow`。**

**つまり、結果が極端に小さいときに起きる。** 入力は有限小数だから、
`value = n / 10^k`。**`k`（小数点以下の桁数）を増やせば分母は伸びる。**
**問題は、その入力が盤面から打てるかどうか**である。

## 使い方

```bash
cd reference && uv run --no-config python scripts/find_convert_overflow.py
```

**終了コードは常に 0。** 探索の記録である。
"""

from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from calcarc_reference.convert_ref import CATEGORIES  # noqa: E402

U128_MAX = 2**128 - 1
I128_MAX = 2**127 - 1

#: **入力の小数点以下の桁数の上限。** ここまで振る。
#: **前回の探索は 14 文字で切って、25 文字の入力が実際に出てきた**ので、
#: 今回は**十分に大きく取って、届くかどうかを先に見る。**
MAX_DECIMALS = 60


def would_overflow(value: Fraction) -> bool:
    """**Rust の正規化ループが `Overflow` を返すか。**

    **写しているのは 2 つのループのあふれ条件だけ**である
    （`format.rs` の `while let Some(bigger) = q.checked_mul(10)` と
    `while p < q { p.checked_mul(10).ok_or(Overflow)? }`）。
    """
    if value == 0:
        return False
    p = abs(value.numerator)
    q = value.denominator
    # **`Rational` の不変条件**: 分子も分母も `i128` に収まる。
    # 収まらなければ、そもそも `convert()` の手前で落ちる（別の経路）。
    if p > I128_MAX or q > I128_MAX:
        return False
    while True:
        bigger = q * 10
        if bigger > U128_MAX or p < bigger:
            break
        q = bigger
    while p < q:
        p *= 10
        if p > U128_MAX:
            return True
    return False


def smallest_input_reaching_overflow(
    src: tuple[Fraction, Fraction], dst: tuple[Fraction, Fraction]
) -> tuple[int, Fraction] | None:
    """**`0.0…01` の形の入力で、何桁まで伸ばせば `Overflow` に届くか。**

    **届かなければ `None`。** 上限は `MAX_DECIMALS`。
    """
    src_factor, src_offset = src
    dst_factor, dst_offset = dst
    for decimals in range(1, MAX_DECIMALS + 1):
        value = Fraction(1, 10**decimals)
        result = (value * src_factor + src_offset - dst_offset) / dst_factor
        if would_overflow(result):
            return decimals, result
    return None


def main() -> None:
    print(f"u128::MAX = {U128_MAX:.4e} / i128::MAX = {I128_MAX:.4e}")
    print(f"上限: 小数点以下 {MAX_DECIMALS} 桁まで、入力は 0.0…01 の形")
    print()
    reached: list[tuple[str, str, str, int]] = []
    worst_denominator = (0, "")
    pairs = 0
    for category, units in CATEGORIES.items():
        for src, src_pair in units.items():
            for dst, dst_pair in units.items():
                if src == dst:
                    continue
                pairs += 1
                # **届く分母の上限**を、まず素で見る（`MAX_DECIMALS` 桁のとき）。
                value = Fraction(1, 10**MAX_DECIMALS)
                result = (value * src_pair[0] + src_pair[1] - dst_pair[1]) / dst_pair[0]
                if result != 0 and result.denominator > worst_denominator[0]:
                    worst_denominator = (result.denominator, f"{category} {src}->{dst}")
                found = smallest_input_reaching_overflow(src_pair, dst_pair)
                if found is not None:
                    reached.append((category, src, dst, found[0]))

    print(f"探索した単位対: {pairs}")
    print(f"`Overflow` に到達した対: {len(reached)}")
    print(
        f"到達しなかった場合の、{MAX_DECIMALS} 桁での分母の最大: "
        f"{worst_denominator[0]:.4e}（{worst_denominator[1]}）"
        f" = i128::MAX の {worst_denominator[0] / I128_MAX:.3e} 倍"
    )
    print()
    for category, src, dst, decimals in reached[:20]:
        typed = "0." + "0" * (decimals - 1) + "1"
        print(f"  {category:11} {src:>8} -> {dst:<8} 小数 {decimals:>3} 桁: {typed[:40]}")
    if len(reached) > 20:
        print(f"  … 他 {len(reached) - 20} 対")


if __name__ == "__main__":
    main()
