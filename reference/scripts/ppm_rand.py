"""**π の多項式の印の乱択: π・`1/x`・四則・`x²`・`√`・`xʸ` を混ぜたキー列と真値。**

1.2.5 の設計書 `docs/superpowers/specs/2026-10-14-pi-power-marks-design.md` §0 と、
1.2.6 の設計書 `docs/superpowers/specs/2026-10-20-pi-marks-more-design.md` §0。手順は
`docs/superpowers/sdd/2026-10-14-pi-power-marks/README.md` と
`docs/superpowers/sdd/2026-10-20-pi-marks-more/README.md`。

## 使い方

```bash
cd reference && uv --no-config run python scripts/ppm_rand.py OUT.json 20261014 20000
cd reference && uv --no-config run python scripts/ppm_rand.py OUT.json 20261020 20000 1.2.6
```

引数は 出力・種・試行の数・族の組（省けば `1.2.5`）。試行のうち √ に負の値が来たもの・
0 で割るもの・複素になるもの・定義域の外の `asin`・`acos`・|値| > 1e300 は捨てる。
`1.2.5` の組は種 20261014 の 20000 回で 19,331 行、`1.2.6` の組（整数の指数の `xʸ`・
逆三角関数・平方数の `√`・k を範囲の外へ押す族を足す）は種 20261020 の 20000 回で
17,129 行になる。**`1.2.5` の組の乱数の引き方は変えていない**（出力は前と同じバイト列）。
出力は `[族, キー列（空白区切りの綴り）, 真値の表示]` の列。

## 真値

キー列を組むのと同じ順に SymPy の厳密な式（`sp.pi`・`sp.Rational`・`sp.sqrt`・`sp.asin` ほか）を
組む。`sp.simplify` は呼ばない（自動の簡約で `sin(π)` は 0、`√(π²)` は π になる。`simplify` は
メモリを食い尽くした）。極（`zoo`・`oo`・`nan`）は `Math ERROR`、それ以外は `N(v, 50)` を
`float` にして `real_ref.format_rect` で 10 桁の文字列にする。

独立: 別手順（engine は i128 の有理係数と角の表で答えを作り、ここは記号の式の自動簡約と
多倍長の数値で作る。違いは答えに現れる——`e231550` の engine は `1.2.5` の組 19,331 本のうち
319 本で、`481cc5db` の engine は `1.2.6` の組 17,129 本のうち 333 本で真値と違う表示を出す）。
"""

from __future__ import annotations

import json
import random
import sys

import mpmath as mp
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
    "pow": ["powint", "powint", "mulpi", "divpi"],
    "inv": ["asin", "acos", "atan", "fwd"],
    "square": ["sqrt", "half", "mulpi", "mul"],
    "wide": ["mulpi", "divpi", "sqr", "powint"],
}
# 1.2.6 の族（`profile` が "1.2.6" のときだけ使う。"1.2.5" の乱数の引き方は変えない）。
FAMILIES_126 = [*FAMILIES, "pow", "inv", "square", "wide"]
ANY_OPS_126 = [*ANY_OPS, "powint", "asin", "acos", "atan"]
EXPONENTS = ["0", "1", "2", "3", "4", "5", "1N", "2N", "3N"]
SQUARES = ["4", "9", "0.25", "2.25", "16", "6.25"]
# 逆三角関数の表に載る引数。`S3` は `3 √`、`Sh` は `0.5 √`、`S34` は `0.75 √`、
# `S13` は `3 √ 1/x`（ROOTS）。
INV_STARTS = ["0.5", "1", "1N", "0", "S3", "Sh", "S34", "S13", "0.5N"]
ROOTS = {
    "S3": (("3", "sqrt"), sp.sqrt(3)),
    "Sh": (("0", "dot", "5", "sqrt"), sp.sqrt(sp.Rational(1, 2))),
    "S34": (("0", "dot", "7", "5", "sqrt"), sp.sqrt(sp.Rational(3, 4))),
    "S13": (("3", "sqrt", "recip"), 1 / sp.sqrt(3)),
}
INVERSE = {"asin": sp.asin, "acos": sp.acos, "atan": sp.atan}
TRIG = {"sin": sp.sin, "cos": sp.cos, "tan": sp.tan}
ERR = "Math ERROR"
# 影の数値の桁数と、記号の値と食い違うとみなす幅（`agrees`）。
mp.mp.dps = 400
DISAGREED: list[str] = []


def keys_of(token: str) -> tuple[list[str], sp.Expr]:
    """打つ数 1 つのキー列と厳密な値。`1E15N` は `1 EXP 15 +/−`（1e-15）、`2N` は `2 +/−`。"""
    if token == "pi":
        return ["pi"], sp.pi
    if token in ROOTS:
        keys, value = ROOTS[token]
        return list(keys), value
    if token.endswith("N") and "E" not in token:
        keys, value = keys_of(token[:-1])
        return [*keys, "neg"], -value
    if token.endswith("N"):
        mantissa, exponent = token[:-1].split("E")
        keys = [mantissa, "exp", *exponent, "neg"]
        return keys, sp.Rational(int(mantissa), 10 ** int(exponent))
    return [c if c != "." else "dot" for c in token], sp.Rational(token)


def shadow(x: sp.Expr) -> mp.mpf:
    """打つ数の厳密な値を、影の数値（400 桁の mpmath）にする。"""
    return mp.mpf(str(sp.N(x, 410)))


def agrees(n: sp.Expr, m: mp.mpf) -> bool:
    """記号の値 `n`（`N(v, 50)`）と影の数値 `m` が食い違わないか。

    **SymPy の自動の簡約は誤ることがある**（`sin(asin(acos(1 − 10⁻¹⁵)))` を 0 にする。
    しかも同じ式が、走るたびに正しい値にもなり、出力のバイト列が変わった。キャッシュを
    毎回空にしても変わった）。だから同じ手順を mpmath の数値（400 桁）でも 1 段ずつ追い、
    **食い違えば影の数値を真値にして数える**（`main` が印字する）。捨てると、どの行を
    捨てるかが走るたびに変わる。"""
    return abs(mp.mpf(str(n)) - m) <= mp.mpf("1e-40") + mp.mpf("1e-30") * abs(m)


def binary(op: str, v: sp.Expr, w: sp.Expr) -> sp.Expr:
    if op == "add":
        return v + w
    if op == "sub":
        return v - w
    if op == "mul":
        return v * w
    return (v / w) if w != 0 else sp.zoo


def start_of(rng: random.Random, family: str, profile: str) -> str:
    if profile == "1.2.6" and family == "inv":
        return rng.choice(INV_STARTS)
    if profile == "1.2.6" and family == "square":
        return rng.choice(SQUARES)
    return rng.choice(
        ["pi", "pi", "2", "3", "0.5"]
        if family == "root"
        else ["pi", "pi", "1", "2", "0.5", "30", "3"]
    )


def one_line(rng: random.Random, profile: str = "1.2.5") -> tuple[str, str, str] | None:
    """1 試行。捨てる試行は None（乱数は捨てる前と同じだけ引く）。"""
    family = rng.choice(FAMILIES_126 if profile == "1.2.6" else FAMILIES)
    rad = rng.random() < 0.7
    keys = ["angle_toggle"] if rad else []
    k, v = keys_of(start_of(rng, family, profile))
    m = shadow(v)
    keys += k
    for _ in range(rng.randint(1, 4)):
        r = rng.random()
        if family in FAMILY_OPS and r < 0.5:
            op = rng.choice(FAMILY_OPS[family])
        else:
            op = rng.choice(ANY_OPS_126 if profile == "1.2.6" else ANY_OPS)
        if op in ("add", "sub", "mul", "div"):
            k, w = keys_of(rng.choice([*POOL, "pi"]))
            keys += [op, *k, "eq"]
            v = binary(op, v, w)
            if not v.has(sp.zoo):
                m = binary(op, m, shadow(w))
        elif op in ("addpi", "subpi", "mulpi", "divpi"):
            keys += [op[:3], "pi", "eq"]
            v = binary(op[:3], v, sp.pi)
            if not v.has(sp.zoo):
                m = binary(op[:3], m, mp.pi)
        elif op == "recip":
            keys += ["recip"]
            v = (1 / v) if v != 0 else sp.zoo
            m = 1 / m if m != 0 else m
        elif op == "sqr":
            keys += ["sqr"]
            v = v**2
            m = m**2
        elif op == "neg":
            keys += ["neg"]
            v = -v
            m = -m
        elif op == "powint":
            k, n = keys_of(rng.choice(EXPONENTS))
            keys += ["pow", *k, "eq"]
            v = v**n if v != 0 or n >= 0 else sp.zoo
            m = m ** int(n) if m != 0 or n >= 0 else m
        elif op in INVERSE:
            x = sp.N(v, 30)
            if op != "atan" and not -1 <= x <= 1:
                return None
            keys += [op]
            v = INVERSE[op](v) if rad else INVERSE[op](v) * 180 / sp.pi
            angle = {"asin": mp.asin, "acos": mp.acos, "atan": mp.atan}[op](m)
            m = angle if rad else angle * 180 / mp.pi
        elif op == "fwd":
            fn = rng.choice(["sin", "cos", "tan"])
            keys += [fn]
            v = TRIG[fn](v if rad else v * sp.pi / 180)
            m = {"sin": mp.sin, "cos": mp.cos, "tan": mp.tan}[fn](m if rad else m * mp.pi / 180)
        else:
            if sp.N(v, 30) < 0:
                return None
            keys += ["sqrt"] if op == "sqrt" else ["pow", "0", "dot", "5", "eq"]
            v = sp.sqrt(v)
            m = mp.sqrt(m)
        if v.has(sp.zoo, sp.nan):
            return None
    if rng.random() < 0.75:
        fn = rng.choice(["sin", "cos", "tan"])
        keys += [fn]
        x = v if rad else v * sp.pi / 180
        v = TRIG[fn](x)
        m = {"sin": mp.sin, "cos": mp.cos, "tan": mp.tan}[fn](m if rad else m * mp.pi / 180)
        if rng.random() < 0.4:
            k, w = keys_of(rng.choice(["0.5", "1"]))
            keys += ["sub", *k, "eq"]
            v = v - w
            m = m - shadow(w)
    if v.has(sp.zoo, sp.nan, sp.oo):
        want = ERR
    else:
        n = sp.N(v, 50)
        if not n.is_real:
            return None
        if not agrees(n, m):
            DISAGREED.append(" ".join(keys))
            n = m
        f = float(n)
        if abs(f) > 1e300:
            return None
        want = real_ref.format_rect(f, 0.0)
    return family + ("_rad" if rad else "_deg"), " ".join(keys), want


def main() -> None:
    out = sys.argv[1]
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 20261014)
    trials = int(sys.argv[3]) if len(sys.argv) > 3 else 6000
    profile = sys.argv[4] if len(sys.argv) > 4 else "1.2.5"
    rows = [row for row in (one_line(rng, profile) for _ in range(trials)) if row is not None]
    with open(out, "w") as f:
        json.dump(rows, f)
    print(len(rows))
    print("shadowed", len(DISAGREED), *DISAGREED, sep="\n")


if __name__ == "__main__":
    main()
