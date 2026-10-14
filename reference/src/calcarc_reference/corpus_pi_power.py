"""π の冪・和・√ を印で持つ式を表示の文字列で比べるコーパス（`pi-power-display-000.json`）。

## なぜこの 1 枚が在るのか

**1.2.4 まで、engine が π の印として持てたのは `k·π`（k ∈ {0, 1}）の単項だけだった。**
`d ÷ π = 1/x`（π⁻¹）・`π x²`（π²）・`π + 0.1 − 0.1`（和が打ち消す）・`π × 2 = √ x²`
（√ の中の π）は、印が落ちて f64 の π に戻り、`sin`・`cos`・`tan` が表の位置で
`1.224646799e-16` のような端数を返した。1.2.5 で engine は印を π⁻²〜π⁴ のローラン多項式と、
√ の中の π の冪で持つようになった（設計書 `2026-10-14-pi-power-marks-design.md`）。
**engine_table が留めるのは書いた点だけで、族を見張らない**——この 1 枚が、その族を
8 群に分けて持つ（計 368 件）。

**表示の文字列で比べる。** 値ケース（相対誤差）では見分けられない——真値が 0 の行は
abs 5e-10 で判定するので、`1.224646799e-16` も `0` も緑になる。

## 何から起こしたか

**engine の印（`engine/exact.rs`）も三角関数の表（`scientific/mod.rs`）も読んでいない。**
期待は次の 3 つだけから作る:

- **キー列を SymPy の厳密な式に読む**（`sp.pi`・`sp.Rational`・`sp.sqrt`・`sp.sin` など）。
  打った十進は `sp.Rational` で厳密に持ち、`sp.simplify` は呼ばない（SymPy の自動の
  簡約で足りる）。**キー列は `=` で区切った各区間に演算子の優先順位が効かない形にしてある**
  ので、読み手は左から順に畳むだけでよい（番人が区間の形を見張る）。
- **0 と極は、SymPy の厳密な値から決める**（`0`・`zoo`・`oo`・`nan`）。数値では決めない
  ——50 桁の π の残りは 0 にならない。極は `Math ERROR`（`TrigPole`）。
- **それ以外は `N(式, 50)` の 50 桁を 10 桁に整形する**（`real_ref.format_real`）。

独立: 別手順（engine は i128 の係数 7 つと表で答えを作る。こちらは SymPy の記号の式の
自動簡約と多倍長の数値で作る。**手順の違いは答えに現れる**——1.2.4 の最後の engine
（`e231550`）と SymPy の真値は、乱択 19,331 本のうち 319 本で違う（設計書 §4.2）。
この 1 枚での違いの件数は 2026-10-14 にネイティブ実行で実測した値を `build_shard` の
外（コミットメッセージと報告）に残した）
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable
from fractions import Fraction

import mpmath as mp
import sympy as sp

from calcarc_reference import real_ref
from calcarc_reference.corpus_deg_fold import TABLE_RESIDUES, near_rounding_boundary

SCHEMA = 1

#: 表示。`corpus_errors.ERROR_TEXT` と同じ契約（`error.rs` が定める表示）。
ERROR_TEXT = "Math ERROR"

FUNCTIONS = ("sin", "cos", "tan")

#: mpmath の精度。**モジュールの読み込みで大域の設定を動かさない**——評価のたびに `workdps` で張る。
DPS = 50

#: **表に載る 16 の位置**（半周 π の 1/6 か 1/4 の倍数、`[0, 2)`）。
#: **数学の位置であって、engine の表の写しではない**——sin・cos の値が
#: 0・±1/2・±√2/2・±√3/2・±1 になる角はこれで尽きる。
TABLE_POSITIONS = tuple(
    sorted({Fraction(k, 6) for k in range(12)} | {Fraction(k, 4) for k in range(8)})
)

#: 群ごとの件数（角または式の数）。三角関数の群は各角を 3 関数に渡す。
PER_GROUP = 16

#: 群の名前（出力の順）。値は seed——**群ごとに固定**（生成は決定的）。
SEEDS = {
    "k-1": 20261014,
    "k2": 20261015,
    "sum": 20261016,
    "sqrt-pi": 20261017,
    "sqrt-pi-squared": 20261018,
    "k-2-to-4": 20261019,
    "half-power-zero": 20261020,
    "half-power-diff": 20261021,
    "deg-pi-cancels": 20261022,
}

#: 三角関数に渡す群（各角 × 3 関数）。残りは三角関数なし。
TRIG_GROUPS = (
    "k-1",
    "k2",
    "sum",
    "sqrt-pi",
    "sqrt-pi-squared",
    "k-2-to-4",
    "deg-pi-cancels",
)

#: **境目に近くて捨てた候補の数**（群ごと）。生成器が数え、`build_shard` が assert する。
#: **引き直していない**——決まった候補列を順に試し、捨てた候補の次を使う。
#: 2026-10-14 の生成で数えた値。
EXPECTED_DISCARDS = {
    "k-1": 0,
    "k2": 0,
    "sum": 0,
    "sqrt-pi": 0,
    "sqrt-pi-squared": 0,
    "k-2-to-4": 0,
    "half-power-zero": 0,
    "half-power-diff": 0,
    "deg-pi-cancels": 0,
}

#: 入力の桁の上限（打てる文字数。小数点を含む）。
ENTRY_LIMIT = 12

#: 群の件数（`build_shard` が assert する）。
EXPECTED_COUNTS = {
    "k-1": 48,
    "k2": 48,
    "sum": 48,
    "sqrt-pi": 48,
    "sqrt-pi-squared": 48,
    "k-2-to-4": 48,
    "half-power-zero": 16,
    "half-power-diff": 16,
    "deg-pi-cancels": 48,
}

#: √(sπ²) = tπ の `s`（打つ文字列）と `t`（平方根）。**s は有理数の平方数**。
SQUARES: tuple[tuple[str, Fraction], ...] = (
    ("4", Fraction(2)),
    ("9", Fraction(3)),
    ("16", Fraction(4)),
    ("25", Fraction(5)),
    ("0.25", Fraction(1, 2)),
    ("2.25", Fraction(3, 2)),
    ("0.0625", Fraction(1, 4)),
    ("0.01", Fraction(1, 10)),
    ("6.25", Fraction(5, 2)),
    ("1.44", Fraction(6, 5)),
)


def _digits(n: int) -> list[str]:
    return list(str(n))


def _typed(text: str) -> list[str]:
    """`12.345` → `["1", "2", "dot", "3", "4", "5"]`。"""
    return ["dot" if ch == "." else ch for ch in text]


# ---- キー列を SymPy の厳密な式に読む ----

_BINARY = {"add", "sub", "mul", "div", "pow"}
_UNARY = {"sqr", "recip", "sqrt", "neg"}
_FUNCS = {"sin": sp.sin, "cos": sp.cos, "tan": sp.tan}


def _apply_binary(op: str, left: sp.Expr, right: sp.Expr) -> sp.Expr:
    if op == "add":
        return left + right
    if op == "sub":
        return left - right
    if op == "mul":
        return left * right
    if op == "div":
        return left / right
    assert op == "pow"
    return left**right


def _apply_unary(key: str, x: sp.Expr) -> sp.Expr:
    if key == "sqr":
        return x**2
    if key == "recip":
        return 1 / x
    if key == "sqrt":
        return sp.sqrt(x)
    assert key == "neg"
    return -x


def read_keys(keys: list[str], mode: str) -> sp.Expr:
    """キー列を SymPy の厳密な式に読む（左から順に畳む。優先順位は見ない）。

    `=` で区切った各区間は演算子が高々 1 種類の優先順位の層にしか居ない形に作ってある
    ので、左から畳んで正しい。**番人が区間の形を見張る**（`test_corpus_pi_power.py`）。
    打った十進は `sp.Rational`（厳密）。π は `sp.pi`。三角関数は RAD なら角そのもの、
    DEG なら度を π/180 倍する。

    独立: 別手順（キー列を SymPy の式に読む。engine の状態機械は読まない）
    """
    value: sp.Expr | None = None
    op: str | None = None
    entry: sp.Expr | None = None
    text = ""
    radians = mode == "Rad"

    def current() -> sp.Expr:
        nonlocal entry, text
        if text:
            entry = sp.Rational(text if not text.startswith(".") else "0" + text)
            text = ""
        if entry is not None:
            return entry
        assert value is not None
        return value

    for key in keys:
        if key == "angle_toggle":
            radians = not radians
        elif key.isdigit() or key == "dot":
            text += "." if key == "dot" else key
            entry = None
        elif key == "pi":
            text = ""
            entry = sp.pi
        elif key in _BINARY:
            if entry is not None or text:
                operand = current()
                value = _apply_binary(op, value, operand) if op and value is not None else operand
                entry = None
            op = key
        elif key == "eq":
            if entry is not None or text:
                operand = current()
                value = _apply_binary(op, value, operand) if op and value is not None else operand
                entry = None
            op = None
        elif key in _UNARY:
            result = _apply_unary(key, current())
            if entry is not None:
                entry = result
            else:
                value = result
        elif key in _FUNCS:
            angle = current() if radians else current() * sp.pi / 180
            return _FUNCS[key](angle)
        else:
            raise AssertionError(f"読めないキー: {key}")
    return current()


def _is_pole(expr: sp.Expr) -> bool:
    return expr in (sp.zoo, sp.oo, -sp.oo, sp.nan)


def _true_mp(expr: sp.Expr) -> mp.mpf:
    return mp.mpf(str(sp.N(expr, DPS)))


def expected(expr: sp.Expr) -> dict:
    """厳密な式から表示（と、極ならエラー種別）を作る。

    0 と極は SymPy の厳密な値から決める。それ以外は 50 桁を 10 桁にする。
    **10 桁の丸めの境目に近い値は使わない**（呼び手が先に `is_near_boundary` で弾く。
    ここでも assert する）。

    独立: 別手順（SymPy の厳密な式の自動簡約と `N(…, 50)`。0 と極は厳密な値から決める）
    """
    if _is_pole(expr):
        return {"error": "TrigPole", "main": ERROR_TEXT}
    if expr == 0:
        return {"main": real_ref.format_real(0.0)}
    with mp.workdps(DPS):
        value = _true_mp(expr)
        assert not near_rounding_boundary(value), f"10 桁の丸めの境目に近すぎる: {expr}"
        return {"main": real_ref.format_real(float(value))}


def is_near_boundary(expr: sp.Expr) -> bool:
    """厳密な式の真値が 10 桁の丸めの境目に近いか（0 と極は境目を持たない）。

    独立: 別手順（`corpus_deg_fold.near_rounding_boundary` を 50 桁の値に当てる）
    """
    if _is_pole(expr) or expr == 0:
        return False
    with mp.workdps(DPS):
        return near_rounding_boundary(_true_mp(expr))


def in_gate(q: Fraction, p: Fraction) -> bool:
    """`√q − p` が 2 倍の門の内側か（`q/4 ≤ p² ≤ 4q`、設計書 §3.1）。

    独立: 不可能（門は engine の方式の境で、答えの定義ではない。群の標本をどちら側にも
    置くための分類にだけ使い、期待値には使わない）
    """
    return q / 4 <= p * p <= 4 * q


# ---- 候補列 ----

#: 1 つの候補: (キー列（関数なし）, 式の文字列)。
Candidate = tuple[list[str], str]


def _angle_for(rng: random.Random, r: Fraction) -> Fraction:
    """表の位置 `r` に周（2）の整数倍を足した角（`r = 0` は 0 にならないよう 1 周以上）。

    周の整数倍だけ足すので、角を 2 で割った余りは `r` のまま（16 の位置が重ならない）。
    """
    shift = 2 * rng.randint(1 if r == 0 else 0, 2)
    return r + shift


def _mul_up(rng: random.Random, angle: Fraction) -> tuple[int, int]:
    """`angle = n/d`（`n`, `d` は正の整数で、既約分数の整数倍）。"""
    t = rng.randint(1, 6)
    return angle.numerator * t, angle.denominator * t


def _spell_k_minus_1(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    n, d = _mul_up(rng, angle)
    keys = [*_digits(d), "div", "pi", "eq", "recip", "mul", *_digits(n), "eq"]
    return keys, f"1/({d}/pi)*{n}"


def _spell_k2(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    n, d = _mul_up(rng, angle)
    keys = ["pi", "sqr", "mul", *_digits(n), "eq", "div", *_digits(d), "eq", "div", "pi", "eq"]
    return keys, f"pi^2*{n}/{d}/pi"


def _decimal(rng: random.Random) -> str:
    """打つ十進（整数部 1〜3 桁、小数部 1〜4 桁、最後の桁は 0 でない）。"""
    whole = rng.randint(0, 999)
    places = rng.randint(1, 4)
    frac = rng.randint(1, 10**places - 1)
    if frac % 10 == 0:
        frac += 1
    return f"{whole}.{frac:0{places}d}"


def _spell_sum(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    n, d = _mul_up(rng, angle)
    a = _decimal(rng)
    keys = [
        "pi",
        "mul",
        *_digits(n),
        "eq",
        "div",
        *_digits(d),
        "eq",
        "add",
        *_typed(a),
        "eq",
        "sub",
        *_typed(a),
        "eq",
    ]
    return keys, f"pi*{n}/{d}+{a}-{a}"


def _spell_sqrt_pi(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    n, d = _mul_up(rng, angle)
    head = ["pi", "mul", *_digits(n), "eq"]
    tail = ["sqr", "div", *_digits(d), "eq"]
    if variant == 0:
        return [*head, "sqrt", *tail], f"sqrt(pi*{n})^2/{d}"
    return [*head, "pow", "0", "dot", "5", "eq", *tail], f"(pi*{n})^0.5^2/{d}"


def _spell_sqrt_pi_squared(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    s_text, root = rng.choice(SQUARES)
    ratio = angle / root
    t = rng.randint(1, 3)
    n, d = ratio.numerator * t, ratio.denominator * t
    keys = [
        "pi",
        "sqr",
        "mul",
        *_typed(s_text),
        "eq",
        "sqrt",
        "mul",
        *_digits(n),
        "eq",
        "div",
        *_digits(d),
        "eq",
    ]
    return keys, f"sqrt(pi^2*{s_text})*{n}/{d}"


def _spell_k_range(rng: random.Random, angle: Fraction, variant: int) -> Candidate:
    n, d = _mul_up(rng, angle)
    if variant == 0:
        keys = [
            "pi",
            "sqr",
            "sqr",
            "mul",
            *_digits(n),
            "eq",
            "div",
            *_digits(d),
            "eq",
            "div",
            "pi",
            "eq",
            "div",
            "pi",
            "eq",
            "div",
            "pi",
            "eq",
        ]
        return keys, f"pi^4*{n}/{d}/pi/pi/pi"
    keys = [
        "pi",
        "sqr",
        "recip",
        "mul",
        *_digits(n),
        "eq",
        "div",
        *_digits(d),
        "eq",
        "mul",
        "pi",
        "eq",
        "mul",
        "pi",
        "eq",
        "mul",
        "pi",
        "eq",
    ]
    return keys, f"pi^-2*{n}/{d}*pi*pi*pi"


_SPELLINGS: dict[str, Callable[[random.Random, Fraction, int], Candidate]] = {
    "k-1": _spell_k_minus_1,
    "k2": _spell_k2,
    "sum": _spell_sum,
    "sqrt-pi": _spell_sqrt_pi,
    "sqrt-pi-squared": _spell_sqrt_pi_squared,
    "k-2-to-4": _spell_k_range,
}

#: 打てる数の文字数の検査用: 数を打つ区間で桁を数える。
_DIGIT_KEYS = set("0123456789") | {"dot"}


def _entries(keys: list[str]) -> list[str]:
    """キー列から、打った数（連続する数字と小数点）を文字列で取り出す。"""
    out: list[str] = []
    cur = ""
    for key in keys:
        if key in _DIGIT_KEYS:
            cur += "." if key == "dot" else key
        elif cur:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def _fits_entry(keys: list[str]) -> bool:
    return all(len(e) <= ENTRY_LIMIT for e in _entries(keys))


def _fragile_degrees() -> list[int]:
    """**f64 の `π + a − π` が `a` に戻らない**、30° か 45° の倍数の度数。

    `a` が 2 の冪の直前（`2^k − 1`・`2^k − 2`）にあると、`π + a` が次の冪をまたいで
    刻みが倍になり、引き算で `a` がずれる。**π の印を落とした engine は、この `a` で
    答えが崩れる**（`a = 33554430` は 270° の剰余で、tan の極が有限の巨大値になる）。
    小さい `a` や 2 の冪から遠い `a` は、f64 でも `a` に戻って、印を落としても答えが合う。

    独立: 別手順（Python の float で `(π + a) − π ≠ a` を直接確かめる。engine は読まない）
    """
    out = []
    for k in range(3, 40):
        for j in (1, 2, 3):
            a = 2**k - j
            if a % 360 in TABLE_RESIDUES and (math.pi + a) - math.pi != a:
                out.append(a)
    return out


def _deg_values(rng: random.Random) -> list[int]:
    """DEG の群の `a` を 16 個。**f64 でずれる `a` を全部**（9）と、残りの剰余（7）。

    残りは 0・90・180（0 と極が出る剰余）と 45・60・225・300。360 の整数倍を足して
    大きくする（最大 3.6e11、12 文字以内）。
    """
    fragile = _fragile_degrees()
    rest = []
    for residue in (0, 90, 180, 45, 60, 225, 300):
        m = rng.randint(1 if residue == 0 else 0, 10 ** rng.randint(0, 9))
        rest.append(residue + 360 * m)
    values = [*fragile, *rest]
    assert len(values) == PER_GROUP and all(len(str(a)) <= ENTRY_LIMIT for a in values)
    return values


def _variant(index: int, function_index: int) -> int:
    """綴り（0 か 1）。**2 つの綴りを持つ群で、0 と極の行がどちらの綴りにも当たる**ように選ぶ。

    0 と極が出る位置は `index` が 0・4・8・12（角が 0・1/2・1・3/2 の半周の倍数）。
    その 4 位置で sin の 0・tan の 0・cos の 0・tan の極が、**0 と 1 の両方の綴りで**
    出る（番人が数える）。関数ごとに `[0, 0, 1]` を足すのは、同じ位置の sin と tan
    （どちらも 0）、cos と tan（0 と極）を別の綴りにするため。

    独立: 不可能（どの綴りでどの行を打つかを決めるだけで、答えには触れない。
    答えは `read_keys` と SymPy が決める）
    """
    return (index // 4 + index // 8 + (0, 0, 1)[function_index]) % 2


def _trig_group(name: str) -> tuple[list[dict], int]:
    """三角関数の群: 16 の位置 × 3 関数 = 48 件。決まった候補列で、境目に近い角は捨てる。"""
    rng = random.Random(SEEDS[name])
    cases: list[dict] = []
    discarded = 0
    if name == "deg-pi-cancels":
        for a in _deg_values(rng):
            keys = ["pi", "add", *_digits(a), "eq", "sub", "pi", "eq"]
            text = f"pi+{a}-pi"
            exprs = [read_keys([*keys, f], "Deg") for f in FUNCTIONS]
            # 境目に近い a は、3 関数のどれが近くても、ここに居ない（a は表の剰余で、
            # 値は 0・±1/2・±√2/2・±√3/2・±1・tan の ±1 と ±√3・1/√3）。
            assert all(not is_near_boundary(e) for e in exprs), a
            for f in FUNCTIONS:
                cases.append(_case("Deg", [*keys, f], f"{f}({text})", name))
        return cases, discarded
    spelling = _SPELLINGS[name]
    for index, r in enumerate(TABLE_POSITIONS):
        while True:
            angle = _angle_for(rng, r)
            position_seed = rng.getrandbits(64)
            # 3 関数の綴りは、同じ位置では `n`・`d` などの引きが同じで、綴り（0 か 1）だけが違う。
            spelled = {
                variant: spelling(random.Random(position_seed), angle, variant)
                for variant in (0, 1)
            }
            used = {_variant(index, fi) for fi in range(len(FUNCTIONS))}
            if not all(_fits_entry(spelled[v][0]) for v in used):
                continue
            exprs = [
                read_keys([*spelled[_variant(index, fi)][0], f], "Rad")
                for fi, f in enumerate(FUNCTIONS)
            ]
            if all(not is_near_boundary(e) for e in exprs):
                break
            discarded += 1
        for v in used:
            # 生成器の自己検査: キー列が打つ角は、意図した角と同じ（`simplify` は呼ばない）。
            shown = read_keys(spelled[v][0], "Rad")
            assert (
                sp.expand(shown - sp.Rational(angle.numerator, angle.denominator) * sp.pi) == 0
            ), (
                name,
                spelled[v][0],
            )
        for fi, f in enumerate(FUNCTIONS):
            keys, text = spelled[_variant(index, fi)]
            cases.append(_case("Rad", [*keys, f], f"{f}({text})", name))
    return cases, discarded


def _case(mode: str, keys: list[str], expr: str, group: str) -> dict:
    toggle = ["angle_toggle"] if mode == "Rad" else []
    return {
        "kind": "display",
        "mode": mode,
        "keys": [*toggle, *keys],
        "expr": expr,
        "expect": expected(read_keys([*toggle, *keys], "Deg")),
        "group": group,
    }


def _nonsquare_q(rng: random.Random) -> tuple[str, Fraction]:
    """打つ `q`（正の十進、平方根が有理数でない）。"""
    while True:
        if rng.random() < 0.6:
            text = str(rng.randint(2, 999))
        else:
            places = rng.randint(1, 2)
            text = f"{rng.randint(0, 99)}.{rng.randint(1, 10**places - 1):0{places}d}"
            if text.endswith("0"):
                continue
        q = Fraction(text)
        if q <= 0:
            continue
        root = sp.sqrt(sp.Rational(q.numerator, q.denominator))
        if root.is_rational:
            continue
        return text, q


def _half_power_zero() -> tuple[list[dict], int]:
    """`q xʸ 0.5 = x² − q =`（答え 0）。√ の中に平方数でない数を入れて 2 乗に戻す。"""
    rng = random.Random(SEEDS["half-power-zero"])
    cases: list[dict] = []
    seen: set[str] = set()
    while len(cases) < PER_GROUP:
        text, _ = _nonsquare_q(rng)
        if text in seen:
            continue
        seen.add(text)
        keys = [
            *_typed(text),
            "pow",
            "0",
            "dot",
            "5",
            "eq",
            "sqr",
            "sub",
            *_typed(text),
            "eq",
        ]
        cases.append(_case("Deg", keys, f"{text}^0.5^2-{text}", "half-power-zero"))
    return cases, 0


#: 差の群の 16 の枠: (呼び名, 倍率, 小数の桁の候補)。**倍率は `p / √q`**。
#: 門は `q/4 ≤ p² ≤ 4q`、つまり `1/2 ≤ p/√q ≤ 2`。
#: near は p が √q に近い（門の内側で、打ち消しが大きい）。mid は内側で遠い。
#: edge は門の境の両側（0.5・2 の 1e-4 内と外。桁は 6 以上にして、丸めで側が変わらない）。
#: far は門の外。**内 12・外 4**（`in_gate` で番人が数える）。
_DIFF_SLOTS: tuple[tuple[str, float, tuple[int, ...]], ...] = (
    *[("near", 1.0, (6, 7, 8, 9))] * 8,
    ("mid", 0.7, (3, 4, 5, 6)),
    ("mid", 1.4, (3, 4, 5, 6)),
    ("edge", 0.4999, (6, 7, 8)),
    ("edge", 0.5001, (6, 7, 8)),
    ("edge", 1.9999, (6, 7, 8)),
    ("edge", 2.0001, (6, 7, 8)),
    ("far", 0.2, (3, 4, 5)),
    ("far", 3.5, (3, 4, 5)),
)


def _p_text(q: Fraction, factor: float, places: int) -> str | None:
    """`p = round(√q × factor, places)` を打つ文字列に（12 文字以内、末尾は 0 でない）。"""
    with mp.workdps(DPS):
        root = mp.sqrt(mp.mpf(q.numerator) / q.denominator)
        scaled = int(mp.floor(root * mp.mpf(str(factor)) * 10**places + mp.mpf(1) / 2))
    if scaled <= 0 or scaled % 10 == 0:
        return None
    whole, frac = divmod(scaled, 10**places)
    text = f"{whole}.{frac:0{places}d}"
    if len(text) > ENTRY_LIMIT:
        return None
    return text


def _half_power_diff() -> tuple[list[dict], int]:
    """`q xʸ 0.5 = − p =`（`p` は √q に近い十進）。2 倍の門の内と外の両方。"""
    rng = random.Random(SEEDS["half-power-diff"])
    cases: list[dict] = []
    discarded = 0
    seen: set[tuple[str, str]] = set()
    for _, factor, places_choices in _DIFF_SLOTS:
        while True:
            text, q = _nonsquare_q(rng)
            places = rng.choice(places_choices)
            p_text = _p_text(q, factor, places)
            if p_text is None or (text, p_text) in seen:
                continue
            keys = [*_typed(text), "pow", "0", "dot", "5", "eq", "sub", *_typed(p_text), "eq"]
            if not _fits_entry(keys):
                continue
            expr = read_keys(keys, "Deg")
            if is_near_boundary(expr):
                discarded += 1
                continue
            seen.add((text, p_text))
            break
        cases.append(_case("Deg", keys, f"{text}^0.5-{p_text}", "half-power-diff"))
    return cases, discarded


def groups() -> dict[str, tuple[list[dict], int]]:
    """9 群のケース（`id` なし）と、境目に近くて捨てた候補の数。

    独立: 別手順（群の作り方は設計書 §5.4 の表から。engine のコードは写していない）
    """
    out: dict[str, tuple[list[dict], int]] = {}
    for name in TRIG_GROUPS:
        out[name] = _trig_group(name)
    out["half-power-zero"] = _half_power_zero()
    out["half-power-diff"] = _half_power_diff()
    return out


def build_shard() -> dict:
    """`id` を連番で振って 1 枚にする。群の順・角の順・関数の順は固定。

    独立: 別手順（各群の docstring を見ること）
    """
    cases: list[dict] = []
    counts: dict[str, int] = {}
    discards: dict[str, int] = {}
    built = groups()
    for name in SEEDS:
        group_cases, discarded = built[name]
        counts[name] = len(group_cases)
        discards[name] = discarded
        for case in group_cases:
            case = dict(case)
            case["id"] = f"ppow-{len(cases):06d}"
            cases.append(case)
    assert counts == EXPECTED_COUNTS, counts
    assert discards == EXPECTED_DISCARDS, discards
    return {
        "schema": SCHEMA,
        "generated_by": (
            f"SymPy {sp.__version__} と mpmath {mp.__version__} ({DPS} dps)。π の冪・和・√ を"
            "含む式を三角関数に渡した答え（と √q − p）を、キー列を SymPy の厳密な式に読み、"
            "0 と極は厳密な値から決め、それ以外は N(式, 50) の 50 桁を 10 桁に整形した。"
            "10 桁の丸めの境目から相対 1e-12 未満の標本は、引き直さずに捨てた。"
            "engine の印（engine/exact.rs）も三角関数の表（scientific/mod.rs）も写していない。"
        ),
        "cases": cases,
    }
