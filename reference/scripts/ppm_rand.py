"""**1.2.5（π の多項式の印）の乱択: π・`1/x`・四則・`x²`・`√`・`xʸ 0.5` を混ぜたキー列と真値。**

設計書 `docs/superpowers/specs/2026-10-14-pi-power-marks-design.md` §0。手順は
`docs/superpowers/sdd/2026-10-14-pi-power-marks/README.md`。

## 使い方

```bash
cd reference && uv --no-config run python scripts/ppm_rand.py OUT.json 20261014 20000
```

引数は 出力・種・試行の数。試行のうち √ に負の値が来たもの・0 で割るもの・複素になるもの・
|値| > 1e300 は捨てるので、種 20261014 の 20000 回で 19,331 行になる。出力は
`[族, キー列（空白区切りの綴り）, 真値の表示]` の列。

## 真値

キー列を組むのと同じ順に SymPy の厳密な式（`sp.pi`・`sp.Rational`・`sp.sqrt`）を組む。
`sp.simplify` は呼ばない（自動の簡約で `sin(π)` は 0、`√(π²)` は π になる。`simplify` は
メモリを食い尽くした）。極（`zoo`・`oo`・`nan`）は `Math ERROR`、それ以外は `N(v, 50)` を
`float` にして `real_ref.format_rect` で 10 桁の文字列にする。

独立: 別手順（engine は i128 の有理係数と角の表で答えを作り、ここは記号の式の自動簡約と
多倍長の数値で作る。違いは答えに現れる——`e231550` の engine はこの 19,331 本のうち 319 本で
真値と違う表示を出す）。
"""

from __future__ import annotations

import json
import random
import sys

import sympy as sp

from calcarc_reference import real_ref

POOL = [
    "1", "2", "3", "0.5", "6", "4", "12", "30", "45", "90", "180", "1.5", "0.25", "7",
    "1E15N", "1E16N",
]  # fmt: skip
FAMILIES = ["km1", "k2", "mix", "root", "any"]
ANY_OPS = [
    "add", "sub", "mul", "div", "recip", "sqr", "sqrt", "neg", "half",
    "addpi", "subpi", "mulpi", "divpi",
]  # fmt: skip
FAMILY_OPS = {
    "km1": ["recip", "divpi", "mulpi"],
    "k2": ["sqr", "mulpi", "divpi"],
    "mix": ["addpi", "subpi", "add", "sub"],
    "root": ["sqrt", "half", "sqr"],
}
ERR = "Math ERROR"


def keys_of(token: str) -> tuple[list[str], sp.Expr]:
    """打つ数 1 つのキー列と厳密な値。`1E15N` は `1 EXP 15 +/−`（1e-15）。"""
    if token == "pi":
        return ["pi"], sp.pi
    if token.endswith("N"):
        mantissa, exponent = token[:-1].split("E")
        keys = [mantissa, "exp", *exponent, "neg"]
        return keys, sp.Rational(int(mantissa), 10 ** int(exponent))
    return [c if c != "." else "dot" for c in token], sp.Rational(token)


def binary(op: str, v: sp.Expr, w: sp.Expr) -> sp.Expr:
    if op == "add":
        return v + w
    if op == "sub":
        return v - w
    if op == "mul":
        return v * w
    return (v / w) if w != 0 else sp.zoo


def one_line(rng: random.Random) -> tuple[str, str, str] | None:
    """1 試行。捨てる試行は None（乱数は捨てる前と同じだけ引く）。"""
    family = rng.choice(FAMILIES)
    rad = rng.random() < 0.7
    keys = ["angle_toggle"] if rad else []
    start = rng.choice(
        ["pi", "pi", "2", "3", "0.5"]
        if family == "root"
        else ["pi", "pi", "1", "2", "0.5", "30", "3"]
    )
    k, v = keys_of(start)
    keys += k
    for _ in range(rng.randint(1, 4)):
        r = rng.random()
        if family in FAMILY_OPS and r < 0.5:
            op = rng.choice(FAMILY_OPS[family])
        else:
            op = rng.choice(ANY_OPS)
        if op in ("add", "sub", "mul", "div"):
            k, w = keys_of(rng.choice([*POOL, "pi"]))
            keys += [op, *k, "eq"]
            v = binary(op, v, w)
        elif op in ("addpi", "subpi", "mulpi", "divpi"):
            keys += [op[:3], "pi", "eq"]
            v = binary(op[:3], v, sp.pi)
        elif op == "recip":
            keys += ["recip"]
            v = (1 / v) if v != 0 else sp.zoo
        elif op == "sqr":
            keys += ["sqr"]
            v = v**2
        elif op == "neg":
            keys += ["neg"]
            v = -v
        else:
            if sp.N(v, 30) < 0:
                return None
            keys += ["sqrt"] if op == "sqrt" else ["pow", "0", "dot", "5", "eq"]
            v = sp.sqrt(v)
        if v.has(sp.zoo, sp.nan):
            return None
    if rng.random() < 0.75:
        fn = rng.choice(["sin", "cos", "tan"])
        keys += [fn]
        x = v if rad else v * sp.pi / 180
        v = {"sin": sp.sin, "cos": sp.cos, "tan": sp.tan}[fn](x)
        if rng.random() < 0.4:
            k, w = keys_of(rng.choice(["0.5", "1"]))
            keys += ["sub", *k, "eq"]
            v = v - w
    if v.has(sp.zoo, sp.nan, sp.oo):
        want = ERR
    else:
        n = sp.N(v, 50)
        if not n.is_real:
            return None
        f = float(n)
        if abs(f) > 1e300:
            return None
        want = real_ref.format_rect(f, 0.0)
    return family + ("_rad" if rad else "_deg"), " ".join(keys), want


def main() -> None:
    out = sys.argv[1]
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 20261014)
    trials = int(sys.argv[3]) if len(sys.argv) > 3 else 6000
    rows = [row for row in (one_line(rng) for _ in range(trials)) if row is not None]
    with open(out, "w") as f:
        json.dump(rows, f)
    print(len(rows))


if __name__ == "__main__":
    main()
