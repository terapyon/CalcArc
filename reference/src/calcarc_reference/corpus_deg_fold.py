"""DEG で大きな角と 90° の倍数の近くの角を三角関数に渡すコーパス（`deg-fold-display-000.json`）。

## なぜこの 1 枚が在るのか

**1.2.3 まで、engine は印（打った十進の有理数）を表で引いたあと、表に載らない角を
f64 に丸めてから畳んでいた**（設計書 `2026-10-10-large-degree-angles-design.md` §1）。
f64 が端数を持てない大きな角（`10^17 + 80.5` が `0.5°` でなく `0°` になる）と、
90° の倍数のすぐ近くの角（`90.0000001 tan` が 8 桁目から崩れる）が、真値の 10 桁と
違った。**(c) の小さな角の形は 1.0.0 から間違っていたのに、コーパスは 1 度も
気づかなかった**——engine_table が留めるのは書いた点だけで、族を見張らない。
1.2.4 で engine は印を 90° の倍数とずれに分けて畳むようになった。この 1 枚は、
その族を 5 つの群に分けて、群ごとに 16 の角 × 3 関数を持つ（計 240 件）。

**表示の文字列で比べる。** 値ケース（相対誤差）では見分けられない——真値が 0 の
行は abs 5e-10 で判定するので、`0` と `-5.551115123e-17` がどちらも緑になる。

## 何から起こしたか

**engine の畳み方（`engine/exact.rs`）も三角関数（`scientific/mod.rs`）も写していない。**
（変異の照準を書くために `degree_turn` の行は見たが、ここの手順はそこから取っていない。
期待の作り方は設計書 §4.3 の「角は `Fraction`、0 と極は定義、それ以外は mpmath」だけである。）
期待は次の 3 つだけから作る:

- **角は `Fraction` で `q mod 360` を厳密に取る**（打った十進をそのまま有理数にする）。
- **0 と極は、三角関数の定義から有理数で決める**——`sin` が 0 になるのは
  `r ≡ 0 (mod 180)`、`cos` が 0 になるのは `r ≡ 90 (mod 180)`、`tan` の極は後者、
  `tan` の 0 は前者。**mpmath の値は 0 にならない**（50 桁の π の残りで 1e-50 級が出る）。
- **それ以外は mpmath の 50 桁で `sin(π·r/180)` を直接評価する**（`workdps` で張る）。
  `90° の倍数とずれ` に分けない——角全体を 50 桁で持てば、ずれが `1e-17°` でも
  30 桁以上が残る。

独立: 別手順（engine は印を i128 の剰余で畳み、いちばん近い 90° の倍数とずれに分け、
ずれを f64 にして `sin`・`cos` を 90° ずつ回す。こちらは `Fraction` の剰余で角を決め、
mpmath の 50 桁で角全体の三角関数を直接評価し、0 と極だけを定義から決める。
**手順の違いは答えに現れる**——1.2.4 の畳みの前の engine（`a9844e2`）は、この 1 枚の
240 件中 89 件で違う表示を返す（大きな整数 48・大きな角で 90° の倍数の近く 23・
小さな角で 90° の倍数の近く 18。2026-10-10、ネイティブ実行で実測））
"""

from __future__ import annotations

import random
from collections.abc import Callable
from fractions import Fraction

import mpmath as mp

from calcarc_reference import real_ref

SCHEMA = 1

#: 表示。`corpus_errors.ERROR_TEXT` と同じ契約（`error.rs` が定める表示）。
ERROR_TEXT = "Math ERROR"

FUNCTIONS = ("sin", "cos", "tan")

#: mpmath の精度。**モジュールの読み込みで大域の設定を動かさない**——評価のたびに `workdps` で張る。
DPS = 50

#: 群ごとの角の数。各角を 3 関数に渡すので、群ごとに 48 件。
PER_GROUP = 16

#: **表に載る剰余**（`[0, 360)` で 30° か 45° の倍数）。**数学の位置であって、engine の
#: 表の写しではない**——sin・cos の値が 0・±1/2・±√2/2・±√3/2・±1 になる角はこれで尽きる。
TABLE_RESIDUES = tuple(sorted({30 * k for k in range(12)} | {45 * k for k in range(8)}))

#: **10 桁の丸めの境目からの相対距離の下限。** 真値がこれより境目に近い角は捨てる
#: （`exact-string-needs-exact-input`）。engine は f64 で計算するので真値との差は
#: 相対 1e-15 級で、境目からその 1000 倍離れていれば 10 桁の表示は真値の 10 桁と一致する。
BOUNDARY_MARGIN = Fraction(1, 10**12)

#: **印が i128 に収まる**上限（設計書 §2.2）。既約分数の分子・分母とも、これ未満。
#: i128 の溢れは別の段差（印を捨てて f64 に戻る）で、この 1 枚の対象ではない。
MARK_LIMIT = 2**126

#: **2^53**。大きな整数の群は、f64 が角を厳密に持てない（これを超える）ものだけ。
EXACT_INT = 2**53

#: 群の名前と seed。**seed は群ごとに固定**（生成は決定的）。
SEEDS = {
    "large-integer": 20261010,
    "large-table": 20261011,
    "large-fraction": 20261012,
    "large-near-quarter": 20261013,
    "small-near-quarter": 20261014,
}

#: **境目に近くて捨てた角の数**（群ごと）。生成器が数え、`build_shard` が assert する。
#: **引き直していない**——候補列を順に試し、捨てた候補の次の候補を使う。候補列は
#: 境目への近さと無関係に決まっているので、捨てても残りの分布は偏らない。
#: 2026-10-10 の生成で数えた値。
EXPECTED_DISCARDS = {
    "large-integer": 2,
    "large-table": 0,
    "large-fraction": 1,
    "large-near-quarter": 0,
    "small-near-quarter": 0,
}


def _digits(n: int) -> list[str]:
    return list(str(n))


def _residue(q: Fraction) -> Fraction:
    """`q mod 360`（`[0, 360)`、厳密）。

    Python の `%` は除数の符号に揃うので、負の `q` でも `[0, 360)` に入る。

    独立: 別手順（`Fraction` の剰余。engine の i128 の剰余は読まない）
    """
    return q % 360


def sin_is_zero(q: Fraction) -> bool:
    """`sin(q°) = 0` ⇔ `q ≡ 0 (mod 180)`。`tan` の 0 もここ。

    独立: 別手順（三角関数の零点の定義から有理数で決める。engine の表は読まない）
    """
    return q % 180 == 0


def cos_is_zero(q: Fraction) -> bool:
    """`cos(q°) = 0` ⇔ `q ≡ 90 (mod 180)`。`tan` の極もここ。

    独立: 別手順（三角関数の零点の定義から有理数で決める。engine の表は読まない）
    """
    return (q - 90) % 180 == 0


def _true_value(function: str, q: Fraction) -> mp.mpf:
    r = _residue(q)
    with mp.workdps(DPS):
        angle = mp.pi * mp.mpf(r.numerator) / (r.denominator * 180)
        return {"sin": mp.sin, "cos": mp.cos, "tan": mp.tan}[function](angle)


def near_rounding_boundary(value: mp.mpf) -> bool:
    """**真値が 10 桁の丸めの境目から相対 `BOUNDARY_MARGIN` 未満か。**

    `|v|` を 10 桁の整数部を持つ `s ∈ [10^9, 10^10)` に拡大し、`s` の端数と 1/2 の差を
    `s` で割ったものが相対距離である。

    独立: 別手順（丸めの境目を mpmath の 50 桁で直接測る）
    """
    with mp.workdps(DPS):
        v = abs(mp.mpf(value))
        if v == 0:
            return False
        exponent = int(mp.floor(mp.log10(v)))
        scaled = v / mp.power(10, exponent - 9)
        # log10 の丸めで 1 桁ずれたら直す。
        if scaled >= mp.mpf(10) ** 10:
            scaled /= 10
        elif scaled < mp.mpf(10) ** 9:
            scaled *= 10
        fraction = scaled - mp.floor(scaled)
        distance = abs(fraction - mp.mpf(1) / 2) / scaled
        margin = mp.mpf(BOUNDARY_MARGIN.numerator) / BOUNDARY_MARGIN.denominator
        return bool(distance < margin)


def expected(function: str, q: Fraction) -> dict:
    """`function(q°)` の表示（と、極ならエラー種別）。

    独立: 別手順（`Fraction` の剰余と mpmath の 50 桁で直接評価し、0 と極は定義から決める）
    """
    if function == "tan" and cos_is_zero(q):
        return {"error": "TrigPole", "main": ERROR_TEXT}
    if (function in ("sin", "tan") and sin_is_zero(q)) or (function == "cos" and cos_is_zero(q)):
        return {"main": real_ref.format_real(0.0)}
    value = _true_value(function, q)
    assert not near_rounding_boundary(value), f"10 桁の丸めの境目に近すぎる: {function}({q})"
    return {"main": real_ref.format_real(float(value))}


def _is_near_boundary_anywhere(q: Fraction) -> bool:
    """3 関数のどれかの真値が境目に近いか（0 と極は境目を持たない）。"""
    for function in FUNCTIONS:
        if function == "tan" and cos_is_zero(q):
            continue
        if (function in ("sin", "tan") and sin_is_zero(q)) or (
            function == "cos" and cos_is_zero(q)
        ):
            continue
        if near_rounding_boundary(_true_value(function, q)):
            return True
    return False


def _mark_fits(q: Fraction) -> bool:
    return abs(q.numerator) < MARK_LIMIT and q.denominator < MARK_LIMIT


def _is_table(q: Fraction) -> bool:
    r = _residue(q)
    return r.denominator == 1 and (r.numerator % 30 == 0 or r.numerator % 45 == 0)


# ---- 候補列（群ごとに決まった順で、角とキー列の組を出す） ----

Candidate = tuple[Fraction, list[str], str]


def _large_integer(rng: random.Random) -> Candidate | None:
    """`M EXP E + I =`。`2^53 < q`、表に載らない。"""
    m, e, i = rng.randint(1, 999), rng.randint(16, 30), rng.randint(0, 999)
    q = Fraction(m * 10**e + i)
    if q <= EXACT_INT or _is_table(q):
        return None
    keys = [*_digits(m), "exp", *_digits(e), "add", *_digits(i), "eq"]
    return q, keys, f"{m}e{e} + {i}"


def _large_table(residue: int) -> Callable[[random.Random], Candidate | None]:
    """`M EXP E + I =` で、`q mod 360` がちょうど `residue`（30° か 45° の倍数）。"""

    def draw(rng: random.Random) -> Candidate | None:
        m, e = rng.randint(1, 999), rng.randint(16, 30)
        i = (residue - m * 10**e) % 360
        q = Fraction(m * 10**e + i)
        assert _residue(q) == residue
        keys = [*_digits(m), "exp", *_digits(e), "add", *_digits(i), "eq"]
        return q, keys, f"{m}e{e} + {i}"

    return draw


def _large_fraction(rng: random.Random) -> Candidate | None:
    """`M EXP E + I.F =`。端数は 1〜3 桁で、最後の桁は 0 でない。"""
    m, e, i = rng.randint(1, 999), rng.randint(16, 30), rng.randint(0, 999)
    places = rng.randint(1, 3)
    f = rng.randint(1, 10**places - 1)
    if f % 10 == 0:
        return None
    text = f"{f:0{places}d}"
    q = m * 10**e + i + Fraction(f, 10**places)
    keys = [*_digits(m), "exp", *_digits(e), "add", *_digits(i), "dot", *text, "eq"]
    return q, keys, f"{m}e{e} + {i}.{text}"


def _large_near_quarter(rng: random.Random) -> Candidate | None:
    """`M EXP E + I ± 1 EXP s +/− =`。`M·10^E + I ≡ 90j (mod 360)`。"""
    j, m, e = rng.randint(0, 3), rng.randint(1, 999), rng.randint(16, 20)
    s = rng.randint(3, 17)
    op = rng.choice(("add", "sub"))
    i = (90 * j - m * 10**e) % 360
    offset = Fraction(1, 10**s)
    q = m * 10**e + i + (offset if op == "add" else -offset)
    if not _mark_fits(q):
        # 群の条件（印が i128 に収まる）。境目による捨てとは別で、数えない。
        return None
    sign = "+" if op == "add" else "-"
    keys = [
        *_digits(m),
        "exp",
        *_digits(e),
        "add",
        *_digits(i),
        op,
        "1",
        "exp",
        *_digits(s),
        "neg",
        "eq",
    ]
    return q, keys, f"{m}e{e} + {i} {sign} 1e-{s}"


def _small_near_quarter(rng: random.Random) -> Candidate | None:
    """`180.0000001`・`89.9999999` の形（`|q| < 2^53`、打つ数は 12 文字まで）。"""
    j, s, digit = rng.randint(0, 8), rng.randint(4, 8), rng.randint(1, 9)
    op = rng.choice((1, -1))
    q = 90 * j + op * Fraction(digit, 10**s)
    if q <= 0:
        return None
    whole, part = divmod(q.numerator * 10**s // q.denominator, 10**s)
    assert Fraction(whole) + Fraction(part, 10**s) == q
    text = f"{whole}.{part:0{s}d}"
    if len(text) > 12:
        return None
    keys = ["dot" if ch == "." else ch for ch in text] + ["eq"]
    return q, keys, text


def _case(keys: list[str], expr: str, expect: dict) -> dict:
    return {
        "kind": "display",
        "mode": "Deg",
        "keys": keys,
        "expr": expr,
        "expect": expect,
    }


def _take(
    draws: list[Callable[[random.Random], Candidate | None]], seed: int
) -> tuple[list[Candidate], int]:
    """**決まった候補列を順に試し、群の条件を満たす角を `draws` の数だけ取る。**

    `draws` の 1 つ 1 つが「1 つの角を出す候補列」である。境目に近い候補は**引き直さず
    捨て**、捨てた数を数える。同じ角は 2 度使わない。

    独立: 別手順（境目の判定は `near_rounding_boundary`）
    """
    rng = random.Random(seed)
    taken: list[Candidate] = []
    seen: set[Fraction] = set()
    discarded = 0
    for draw in draws:
        while True:
            candidate = draw(rng)
            if candidate is None:
                continue
            q = candidate[0]
            if q in seen:
                continue
            assert _mark_fits(q), f"印が i128 に収まらない: {q}"
            if _is_near_boundary_anywhere(q):
                discarded += 1
                continue
            seen.add(q)
            taken.append(candidate)
            break
    return taken, discarded


def groups() -> dict[str, tuple[list[Candidate], int]]:
    """5 群の角（各 16）と、境目に近くて捨てた数。"""
    return {
        "large-integer": _take([_large_integer] * PER_GROUP, SEEDS["large-integer"]),
        "large-table": _take([_large_table(r) for r in TABLE_RESIDUES], SEEDS["large-table"]),
        "large-fraction": _take([_large_fraction] * PER_GROUP, SEEDS["large-fraction"]),
        "large-near-quarter": _take([_large_near_quarter] * PER_GROUP, SEEDS["large-near-quarter"]),
        "small-near-quarter": _take([_small_near_quarter] * PER_GROUP, SEEDS["small-near-quarter"]),
    }


def build_shard() -> dict:
    """`id` を連番で振って 1 枚にする。群の順・角の順・関数の順は固定。

    独立: 別手順（各群の docstring を見ること）
    """
    cases: list[dict] = []
    discards: dict[str, int] = {}
    for name, (angles, discarded) in groups().items():
        assert len(angles) == PER_GROUP, name
        discards[name] = discarded
        for q, keys, text in angles:
            for function in FUNCTIONS:
                case = _case([*keys, function], f"{function}({text})", expected(function, q))
                case["id"] = f"dfold-{len(cases):06d}"
                case["group"] = name
                cases.append(case)
    assert discards == EXPECTED_DISCARDS, discards
    return {
        "schema": SCHEMA,
        "generated_by": (
            f"mpmath {mp.__version__} ({DPS} dps)。DEG で大きな角と 90° の倍数の近くの角を"
            "三角関数に渡した答えを、Fraction で q mod 360 を厳密に取り、mpmath の 50 桁で"
            "角全体を直接評価した。0 と極（tan の、cos が 0 になる角）は数値ではなく三角関数の"
            "定義から有理数で決めた。真値が 10 桁の丸めの境目から相対 1e-12 未満の角は、"
            "引き直さずに捨てた。engine の畳み方（engine/exact.rs）も三角関数"
            "（scientific/mod.rs）も写していない。"
        ),
        "cases": cases,
    }
