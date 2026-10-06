"""RAD で π の有理数倍を三角関数に渡すコーパス（`rad-pi-display-000.json`）。

## なぜこの 1 枚が在るのか

**1.2.3 まで、この経路を踏むケースはコーパスに 1 件も無かった**（v1.2.0 の
コーパスで、π を含む値ケース 865 件のうち RAD は 0 件。2026-10-04 実測）。
1.2.3 で engine は π キーの値を「本当の π」として持つようになり
（設計書 `2026-10-06-exact-pi-decimal-design.md`）、`π sin` が `1.224646799e-16`
から `0` に、`π ÷ 2 = tan` が有限の `1.633123935e16` から `TrigPole` に変わった。

**表示の文字列で比べる。** 値ケース（相対誤差）では見分けられない——真値が 0 の
行は abs 5e-10 で判定するので、`1.224646799e-16` も `0` も緑になる。
**文字列なら `1.224646799e-16` ≠ `0` で赤になる。**

## 何から起こしたか

**engine の表（`scientific::table_row`）も、印の伝わり方（`engine/exact.rs`）も
読んでいない。** 期待は次の 2 つだけから作る:

- **値は mpmath の 50 桁の π で計算する**（`sin(π·a/b)` を直接）。
- **0 と極は、三角関数の定義から有理数で決める**——`sin(π·r)` が 0 になるのは
  `r` が整数のとき、`cos(π·r)` が 0 になるのは `r − 1/2` が整数のとき、
  `tan` の極は後者と同じ。**mpmath の値は 0 にならない**（50 桁の π の残りで
  `1e-50` 級が出る）ので、ここを数値で決めると**参照の側の丸めを期待に写す**
  ことになる（v1.2.0 の調査で 1 度踏んだ罠）。

**対照の行は「電卓が持っている数」に対する答えである。** 打った `3.1415926535` は
π ではない——電卓が持つのはその十進に最も近い f64 で、答えはその数の `sin` である。
ここでは Python の `float()`（十進→f64 の正しい丸め）で同じ数を作り、mpmath で
`sin` を取る。

独立: 別手順（engine は印の有理数を 2 で畳み、16 の位置の表を引く。こちらは
mpmath の 50 桁で三角関数を直接評価し、0 と極だけを定義から有理数で決める。
**手順の違いは答えに現れる**——1.2.3 の前の engine は `π sin` に `1.22e-16` を
返し、こちらは `0` を返す）
"""

from __future__ import annotations

from fractions import Fraction

import mpmath as mp

from calcarc_reference import real_ref

SCHEMA = 1

#: 表示。`corpus_errors.ERROR_TEXT` と同じ契約（`error.rs` が定める表示）。
ERROR_TEXT = "Math ERROR"

FUNCTIONS = ("sin", "cos", "tan")

#: **表に載る 16 の位置**（半周 π の 1/6 か 1/4 の倍数、`[0, 2)`）。
#: **数学の位置であって、engine の表の写しではない**——sin・cos の値が
#: 0・±1/2・±√2/2・±√3/2・±1 になる角はこれで尽きる。
TABLE_POSITIONS = tuple(
    sorted({Fraction(k, 6) for k in range(12)} | {Fraction(k, 4) for k in range(8)})
)

#: **表に載らない位置。** `1/12`（15°）は「`12r` が整数なら表」という書き方の
#: 罠を踏む位置（設計書 §4.1）。`1/8`・`3/8` は 4 の倍数の分母、`1/5`・`2/7`・
#: `4/9` は 6 とも 4 とも素な分母。
OFF_TABLE_POSITIONS = (
    Fraction(1, 12),
    Fraction(5, 12),
    Fraction(1, 8),
    Fraction(3, 8),
    Fraction(1, 5),
    Fraction(7, 5),
    Fraction(2, 7),
    Fraction(4, 9),
)

#: **大きな倍数のずらし**（周の整数倍）。**f64 の積では ulp が角を外す大きさ**で、
#: 畳まずに計算すれば答えが崩れる。2000π は 1000 周。
LARGE_SHIFT = 2000

#: mpmath の精度。**モジュールの読み込みで大域の設定を動かさない**——評価のたびに `workdps` で張る。
DPS = 50


def _digits(n: int) -> list[str]:
    return list(str(n))


def _is_integer(r: Fraction) -> bool:
    return r.denominator == 1


def sin_is_zero(r: Fraction) -> bool:
    """`sin(π·r) = 0` ⇔ `r` が整数。

    独立: 別手順（三角関数の零点の定義から有理数で決める。engine の表は読まない）
    """
    return _is_integer(r)


def cos_is_zero(r: Fraction) -> bool:
    """`cos(π·r) = 0` ⇔ `r − 1/2` が整数。`tan` の極もここ。

    独立: 別手順（三角関数の零点の定義から有理数で決める。engine の表は読まない）
    """
    return _is_integer(r - Fraction(1, 2))


def expected(function: str, r: Fraction) -> dict:
    """`function(π·r)` の表示（と、極ならエラー種別）。

    独立: 別手順（mpmath の 50 桁で直接評価し、0 と極は定義から決める）
    """
    if function == "tan" and cos_is_zero(r):
        return {"error": "TrigPole", "main": ERROR_TEXT}
    if (function in ("sin", "tan") and sin_is_zero(r)) or (function == "cos" and cos_is_zero(r)):
        return {"main": real_ref.format_real(0.0)}
    with mp.workdps(DPS):
        angle = mp.pi * mp.mpf(r.numerator) / r.denominator
        value = {"sin": mp.sin, "cos": mp.cos, "tan": mp.tan}[function](angle)
        return {"main": _shown(value)}


def _shown(value: mp.mpf) -> str:
    """真値を 10 桁で見せる。**丸めの境目に近い値は使わない**（下の assert）。

    engine は f64 で計算するので、真値との差は相対 1e-15 級である。境目から
    その何桁も外にあれば、10 桁の表示は真値の 10 桁と一致する。**境目に近い値を
    厳密一致で比べると、計算の誤差が境目をまたいで赤くなる**ので、作る時点で弾く。
    """
    x = float(value)
    digits = mp.nstr(abs(value), 16, strip_zeros=False)
    mantissa = digits.split("e")[0].replace(".", "").lstrip("0")
    tail = int(mantissa[10:16].ljust(6, "0"))
    margin = abs(tail - 500000)
    assert margin > 1000, f"10 桁の丸めの境目に近すぎる: {value}"
    return real_ref.format_real(x)


def _spellings(r: Fraction) -> list[tuple[list[str], str]]:
    """`π·r` の打ち方。**同じ順位の演算子だけを使う**——`× ÷` と `+ −` を混ぜると、
    優先順位の変異（`precedence-collapse`）がこの 1 枚を巻き込み、その変異の
    検出力の表を書き換えることになる。**`π ÷ b × a` も使わない**——畳む向きの
    変異（`associativity-flip`）で `π ÷ (b × a)` に化けて答えが変わる。
    `π × a ÷ b` は向きを変えても `π × (a ÷ b)` で、答えは同じである。
    """
    a, b = r.numerator, r.denominator
    out: list[tuple[list[str], str]] = []
    if b == 1:
        out.append((["pi", "mul", *_digits(a), "eq"], f"pi*{a}"))
        out.append(([*_digits(a), "mul", "pi", "eq"], f"{a}*pi"))
    else:
        out.append((["pi", "mul", *_digits(a), "div", *_digits(b), "eq"], f"pi*{a}/{b}"))
        out.append(([*_digits(a), "mul", "pi", "div", *_digits(b), "eq"], f"{a}*pi/{b}"))
        out.append(
            (
                ["lparen", "pi", "mul", *_digits(a), "rparen", "div", *_digits(b), "eq"],
                f"(pi*{a})/{b}",
            )
        )
    return out


def _case(keys: list[str], expr: str, expect: dict, mode: str = "Rad") -> dict:
    toggle = ["angle_toggle"] if mode == "Rad" else []
    return {
        "kind": "display",
        "mode": mode,
        "keys": [*toggle, *keys],
        "expr": expr,
        "expect": expect,
    }


def table_grid() -> list[dict]:
    """**16 の位置 × 3 関数**を、1 周ずらした角（`r + 2`）で打つ。

    `r` そのものでなく `r + 2` にするのは、`r = 0` が `π × 0` になって
    印の有無に関係なく 0 になるから（それでは何も見分けない）。
    **符号を反転した答え**（`= +/−` を押してから関数）も 1 本ずつ持つ——
    `+/−` は印の符号も反転する。
    """
    cases: list[dict] = []
    for r in TABLE_POSITIONS:
        angle = r + 2
        for function in FUNCTIONS:
            for keys, text in _spellings(angle):
                cases.append(
                    _case([*keys, function], f"{function}({text})", expected(function, angle))
                )
            keys, text = _spellings(angle)[0]
            cases.append(
                _case(
                    [*keys, "neg", function], f"{function}(-({text}))", expected(function, -angle)
                )
            )
    return cases


def large_multiples() -> list[dict]:
    """**同じ 16 の位置を、1000 周ずらして打つ**（`r + 2000`）。

    f64 の積 `π × 2000.5` は、真の角から ulp の分だけ外れる。**畳まずに
    計算すると `sin` の答えが崩れる大きさではない**が、`cos(π × 2000.5)` は
    0 から外れた値になる——**印で畳めば 0**。
    """
    cases: list[dict] = []
    for r in TABLE_POSITIONS:
        angle = r + LARGE_SHIFT
        for function in FUNCTIONS:
            keys, text = _spellings(angle)[0]
            cases.append(_case([*keys, function], f"{function}({text})", expected(function, angle)))
    return cases


def off_table() -> list[dict]:
    """**表に載らない位置**（と、その 1000 周ずらし）。値は mpmath の真値。"""
    cases: list[dict] = []
    for r in OFF_TABLE_POSITIONS:
        for angle in (r, r + LARGE_SHIFT):
            for function in FUNCTIONS:
                keys, text = _spellings(angle)[0]
                cases.append(
                    _case([*keys, function], f"{function}({text})", expected(function, angle))
                )
    return cases


def zero_is_neutral() -> list[dict]:
    """**0 は印の k に中立**（設計書 §3.4、条件 1）。

    `+ π =`・`( + π ) =`・`0 + π =` の左辺の 0 は、初期値・`(` が置く 0 と、
    打った 0 である。**どれも `π sin` と同じ答えでなければならない**——数学では
    `0 + π = π` だから。
    """
    lead = {
        "+ pi": ["add", "pi", "eq"],
        "( + pi )": ["lparen", "add", "pi", "rparen", "eq"],
        "0 + pi": ["0", "add", "pi", "eq"],
    }
    cases: list[dict] = []
    for text, keys in lead.items():
        for function in FUNCTIONS:
            cases.append(
                _case([*keys, function], f"{function}({text})", expected(function, Fraction(1)))
            )
    return cases


def complex_argument() -> list[dict]:
    """**虚部があっても、実部が π の倍数なら表を引く**（設計書 §4.4、条件 2）。

    `sin(π + iy) = sin π · cosh y + i · cos π · sinh y = 0 − i · sinh y`、
    `cos(π + iy) = cos π · cosh y − i · sin π · sinh y = −cosh y`。
    `y = 1e-300` では `cosh y = 1`、`sinh y = 1e-300`（f64 で厳密にそうなる大きさ）。
    """
    keys = ["pi", "add", "1", "exp", "3", "0", "0", "neg", "j", "eq"]
    y = 1e-300
    return [
        _case([*keys, "sin"], "sin(pi + 1e-300j)", {"main": real_ref.format_rect(0.0, -y)}),
        _case([*keys, "cos"], "cos(pi + 1e-300j)", {"main": real_ref.format_rect(-1.0, 0.0)}),
    ]


def held_numbers() -> list[dict]:
    """**対照: 打った数は π ではない。** 答えは電卓が持つ f64 に対する値。

    - `3.1415926535`（12 文字。打てる上限）——π の 11 桁の近似。
    - `32993.006048`——kπ の最良の 11 桁の近似の 1 つ。**「極小なら 0 と見せる」
      案 (a) は、これを 0 にしてしまう**（レビュー役の反例、2026-10-06）。

    独立: 別手順（十進→f64 は Python の `float()`、`sin` は mpmath）
    """
    cases: list[dict] = []
    with mp.workdps(DPS):
        for text in ("3.1415926535", "32993.006048"):
            keys = ["dot" if ch == "." else ch for ch in text]
            held = mp.mpf(float(text))
            # **`=` を押して終える。** 報告書は `=` を押さないキー列を「打鍵の途中の
            # 表示」として数える——後置関数の答えは確定した値なので、そこに混ぜない。
            cases.append(
                _case([*keys, "sin", "eq"], f"sin({text})", {"main": _shown(mp.sin(held))})
            )
        # **π × π は印が落ちる**（k = 2 を持たない）。答えは真の sin(π²) の 10 桁と同じ。
        cases.append(
            _case(
                ["pi", "mul", "pi", "eq", "sin"], "sin(pi*pi)", {"main": _shown(mp.sin(mp.pi**2))}
            )
        )
    return cases


def build_shard() -> dict:
    """`id` を連番で振って 1 枚にする。**`random` を使わない**——固定の格子である。

    独立: 別手順（各群の docstring を見ること）
    """
    cases: list[dict] = []
    for group in (
        table_grid(),
        large_multiples(),
        off_table(),
        zero_is_neutral(),
        complex_argument(),
        held_numbers(),
    ):
        for case in group:
            case = dict(case)
            case["id"] = f"rpi-{len(cases):06d}"
            cases.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": (
            f"mpmath {mp.__version__} ({DPS} dps)。RAD で π の有理数倍を三角関数に渡した"
            "答えを、mpmath の 50 桁の π で直接評価した。0 と極（tan の、cos が 0 になる角）は"
            "数値ではなく三角関数の定義から有理数で決めた——50 桁の π の残りは 0 にならないので、"
            "数値で決めると参照の側の丸めを期待に写す。engine の表（scientific::table_row）も"
            "印の伝わり方（engine/exact.rs）も読んでいない。対照の行（打った 3.1415926535・"
            "32993.006048）は、電卓が持つ f64（Python の float()）に対する答えである。"
        ),
        "cases": cases,
    }
