"""整数の指数・逆三角関数・平方数の √・π/2 の倍数の近くの角を表示の文字列で比べるコーパス
（`pi-marks-more-display-000.json`）。

## なぜこの 1 枚が在るのか

**1.2.5 まで、engine の π の印は `xʸ` の整数の指数と逆三角関数で落ち、`4 √` は root の
ままだった。** `π xʸ 2 = ÷ π = sin`・`1 +/− acos sin`・`4 √ × π = sin` は f64 の π に戻り、
表の位置で `1.224646799e-16` のような端数を返した。RAD で π の倍数のすぐ近くの角も、角全体を
f64 にした丸めが答えに相対で効いた。1.2.6 で engine は、整数の指数と表に載る逆三角関数の
答えに印を付け、平方数の √ を有理数にし、RAD の角をいちばん近い π/2 の倍数とずれに分けて
畳むようになった（設計書 `2026-10-20-pi-marks-more-design.md`）。**engine_table が留めるのは
書いた点だけで、族を見張らない**——この 1 枚が、その族を 10 群に分けて持つ（計 509 件）。

**表示の文字列で比べる。** 値ケース（相対誤差）では見分けられない——真値が 0 の行は
abs 5e-10 で判定するので、`1.224646799e-16` も `0` も緑になる。

## 何から起こしたか

**engine の印（`engine/exact.rs`）も三角関数の表（`scientific/mod.rs`）も読んでいない。**
期待は次の 3 つだけから作る:

- **キー列を SymPy の厳密な式に読む**（`sp.pi`・`sp.Rational`・`sp.sqrt`・`sp.asin` など）。
  打った十進は `sp.Rational` で厳密に持ち、`sp.simplify` は呼ばない（三角関数の角だけ
  `sp.expand` で π の多項式に展開する）。**`=` で区切った各区間（括弧の中は別の区間）に
  演算子の優先順位が効かない形にしてある**ので、読み手は左から順に畳むだけでよい
  （番人が区間の形を見張る）。
- **0 と極は、SymPy の厳密な値から決める**（`0`・`zoo`）。極は `Math ERROR`（`TrigPole`）。
  それ以外は `N(式, 50)` の 50 桁を 10 桁に整形する（`real_ref.format_real`）。
- **同じキー列を mpmath の 400 桁でも 1 段ずつ追う（影の数値）。** SymPy の自動の簡約は
  誤ることがあり、しかも走るたびに答えが変わることがある（`sin(asin(acos(1 − 10⁻¹⁵)))` を
  0 にしたりしなかったりした。設計書 §0）。**食い違えば影の数値を真値にする**——捨てると、
  どの行を捨てるかが走るたびに変わり、生成がバイト列で再現しなくなる。

独立: 別手順（engine は i128 の係数 7 つと角の表で答えを作る。こちらは SymPy の記号の式の
自動簡約と多倍長の数値で作る。**手順の違いは答えに現れる**——1.2.5 の engine（`481cc5db`）と
SymPy の真値は、乱択 17,129 本のうち 333 本で違う（設計書 §1）。この 1 枚での違いの件数は
ネイティブ実行で実測した値を `build_shard` の外（コミットメッセージと報告）に残した）
"""

from __future__ import annotations

import functools
import random
from collections.abc import Callable
from fractions import Fraction

import mpmath as mp
import sympy as sp

from calcarc_reference import real_ref
from calcarc_reference.corpus_deg_fold import near_rounding_boundary
from calcarc_reference.corpus_pi_power import (
    SQUARES,
    TABLE_POSITIONS,
    _angle_for,
    _decimal,
    _digits,
    _entries,
    _mul_up,
    _typed,
)

SCHEMA = 1

#: 表示。`corpus_errors.ERROR_TEXT` と同じ契約（`error.rs` が定める表示）。
ERROR_TEXT = "Math ERROR"

FUNCTIONS = ("sin", "cos", "tan")

#: mpmath の精度（`N(式, DPS)` と境目の判定）。**モジュールの読み込みで大域の設定を
#: 動かさない**——評価のたびに `workdps` で張る。
DPS = 50

#: 影の数値の桁数。
SHADOW_DPS = 400

#: 入力の桁の上限（打てる文字数。小数点を含む）。
ENTRY_LIMIT = 12

#: 群の名前（出力の順）。値は seed——**群ごとに固定**（生成は決定的）。
SEEDS = {
    "int-power": 20261020,
    "neg-power": 20261021,
    "sum-power": 20261022,
    "zero-power": 20261023,
    "root-power": 20261024,
    "inverse-rad": 20261025,
    "inverse-deg": 20261026,
    "square-sqrt": 20261027,
    "square-half-power": 20261028,
    "quarter-fold": 20261029,
}

#: 群の件数（`build_shard` が assert する）。
EXPECTED_COUNTS = {
    "int-power": 48,
    "neg-power": 48,
    "sum-power": 48,
    "zero-power": 32,
    "root-power": 48,
    "inverse-rad": 75,
    "inverse-deg": 50,
    "square-sqrt": 48,
    "square-half-power": 16,
    "quarter-fold": 96,
}

#: **境目に近くて捨てた候補の数**（群ごと）。生成器が数え、`build_shard` が assert する。
#: **引き直していない**——決まった候補列を順に試し、捨てた候補の次を使う。
#: 2026-10-20 の生成で数えた値。
EXPECTED_DISCARDS = dict.fromkeys(SEEDS, 0)

#: 逆三角関数の表に載る引数（打つキー列と厳密な値）。asin・acos は 9 つ、atan は 7 つ。
#: **数学の値であって、engine の表の写しではない**——角が π/12 の倍数になる引数のうち、
#: 2 乗が有理数のものはこれで尽きる。√ の綴りは `√` キー（root）で打つ。
_SINE_ARGS: tuple[tuple[tuple[str, ...], sp.Expr], ...] = (
    (("0",), sp.Integer(0)),
    (("0", "dot", "5"), sp.Rational(1, 2)),
    (("0", "dot", "5", "neg"), -sp.Rational(1, 2)),
    (("0", "dot", "5", "sqrt"), sp.sqrt(sp.Rational(1, 2))),
    (("0", "dot", "5", "sqrt", "neg"), -sp.sqrt(sp.Rational(1, 2))),
    (("0", "dot", "7", "5", "sqrt"), sp.sqrt(sp.Rational(3, 4))),
    (("0", "dot", "7", "5", "sqrt", "neg"), -sp.sqrt(sp.Rational(3, 4))),
    (("1",), sp.Integer(1)),
    (("1", "neg"), sp.Integer(-1)),
)
_TANGENT_ARGS: tuple[tuple[tuple[str, ...], sp.Expr], ...] = (
    (("0",), sp.Integer(0)),
    (("3", "recip", "sqrt"), sp.sqrt(sp.Rational(1, 3))),
    (("3", "recip", "sqrt", "neg"), -sp.sqrt(sp.Rational(1, 3))),
    (("1",), sp.Integer(1)),
    (("1", "neg"), sp.Integer(-1)),
    (("3", "sqrt"), sp.sqrt(3)),
    (("3", "sqrt", "neg"), -sp.sqrt(3)),
)

#: 表に載る引数の 25 通り: (キー列, 関数)。
INVERSE_ARGS: tuple[tuple[tuple[str, ...], str], ...] = (
    *[(keys, "asin") for keys, _ in _SINE_ARGS],
    *[(keys, "acos") for keys, _ in _SINE_ARGS],
    *[(keys, "atan") for keys, _ in _TANGENT_ARGS],
)

#: 90° 単位の近くの畳みの群: `π × K = ÷ 2 = ± ( π × 7 EXP E +/− ) =`。
FOLD_QUARTERS = (1, 2, 3, -1)
FOLD_EXPONENTS = (11, 13, 15, 17)


# ---- キー列を読む（記号と影の 2 つの数で） ----


class _Arithmetic:
    """読み手が使う数の作り方。記号（SymPy）と影（mpmath）で同じ手順を踏む。"""

    def __init__(self, symbolic: bool) -> None:
        self.symbolic = symbolic

    def number(self, text: str) -> sp.Expr | mp.mpf:
        mantissa, _, exponent = text.partition("e")
        q = Fraction(mantissa if not mantissa.startswith(".") else "0" + mantissa)
        q *= Fraction(10) ** int(exponent or "0")
        if self.symbolic:
            return sp.Rational(q.numerator, q.denominator)
        return mp.mpf(q.numerator) / q.denominator

    def pi(self) -> sp.Expr | mp.mpf:
        return sp.pi if self.symbolic else +mp.pi

    def unary(self, key: str, x, radians: bool):
        lib = sp if self.symbolic else mp
        half_turn = lib.pi
        if key == "sqr":
            return x**2
        if key == "recip":
            return 1 / x
        if key == "sqrt":
            return lib.sqrt(x)
        if key == "neg":
            return -x
        if key == "exp_e":
            return lib.exp(x)
        if key in FUNCTIONS:
            angle = x if radians else x * half_turn / 180
            if self.symbolic:
                angle = sp.expand(angle)
            return getattr(lib, key)(angle)
        assert key in ("asin", "acos", "atan"), key
        answer = getattr(lib, key)(x)
        return answer if radians else answer * 180 / half_turn


_BINARY = {"add", "sub", "mul", "div", "pow"}
_UNARY = {"sqr", "recip", "sqrt", "neg", "exp_e", *FUNCTIONS, "asin", "acos", "atan"}


def _fold(op: str | None, left, right):
    if op is None or left is None:
        return right
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


def _read(keys: list[str], arith: _Arithmetic):
    """キー列を左から順に畳む（優先順位は見ない。括弧は別の区間）。最初は DEG。"""
    value = None
    op: str | None = None
    entry = None
    text = ""
    radians = False
    stack: list[tuple[object, str | None]] = []

    def current():
        nonlocal entry, text
        if text:
            entry = arith.number(text)
            text = ""
        if entry is not None:
            return entry
        assert value is not None
        return value

    def settle() -> None:
        nonlocal value, entry
        if entry is not None or text:
            value = _fold(op, value, current())
            entry = None

    for key in keys:
        if key == "angle_toggle":
            radians = not radians
        elif key.isdigit() or key == "dot":
            text += "." if key == "dot" else key
            entry = None
        elif key == "exp":
            text += "e"
        elif key == "neg" and "e" in text:
            # 指数の入力中の `+/−` は指数の符号。
            mantissa, _, exponent = text.partition("e")
            text = f"{mantissa}e{exponent[1:] if exponent.startswith('-') else '-' + exponent}"
        elif key == "pi":
            text = ""
            entry = arith.pi()
        elif key in _BINARY:
            settle()
            op = key
        elif key == "eq":
            settle()
            op = None
        elif key == "lparen":
            stack.append((value, op))
            value, op, entry = None, None, None
        elif key == "rparen":
            settle()
            inner = value
            value, op = stack.pop()
            entry = inner
        elif key in _UNARY:
            result = arith.unary(key, current(), radians)
            if entry is not None:
                entry = result
            else:
                value = result
        else:
            raise AssertionError(f"読めないキー: {key}")
    assert not stack, keys
    return current()


def read_keys(keys: list[str]) -> sp.Expr:
    """キー列を SymPy の厳密な式に読む（最初は DEG。`angle_toggle` で切り替わる）。

    `=` で区切った各区間（括弧の中は別の区間）は演算子が高々 1 種類の優先順位の層にしか
    居ない形に作ってあるので、左から畳んで正しい。**番人が区間の形を見張る**
    （`test_corpus_pi_marks_more.py`）。三角関数は RAD なら角そのもの、DEG なら度を
    π/180 倍し、角を `sp.expand` で π の多項式に展開してから渡す。逆三角関数の答えは
    DEG なら 180/π 倍する。

    独立: 別手順（キー列を SymPy の式に読む。engine の状態機械は読まない）
    """
    return _read(keys, _Arithmetic(symbolic=True))


def read_shadow(keys: list[str]) -> mp.mpf:
    """同じキー列を mpmath の 400 桁で 1 段ずつ追う（影の数値）。

    独立: 別手順（`read_keys` と同じ畳み方を、記号の簡約を通さない多倍長の数値で踏む）
    """
    with mp.workdps(SHADOW_DPS):
        return +_read(keys, _Arithmetic(symbolic=False))


# ---- 期待値 ----

#: 影の数値で 0 と極を決める閾（400 桁の残りは 10⁻³⁸⁰ 級、極は 10³⁸⁰ 級）。
_SHADOW_ZERO = mp.mpf("1e-300")
_SHADOW_POLE = mp.mpf("1e300")


def _is_pole(expr: sp.Expr) -> bool:
    return expr in (sp.zoo, sp.oo, -sp.oo, sp.nan)


def _verdict_of_shadow(m: mp.mpf) -> tuple[str, mp.mpf | None]:
    if abs(m) > _SHADOW_POLE:
        return "pole", None
    if abs(m) < _SHADOW_ZERO:
        return "zero", None
    return "value", m


def _verdict_of_symbolic(expr: sp.Expr) -> tuple[str, mp.mpf | None]:
    if _is_pole(expr):
        return "pole", None
    if expr == 0:
        return "zero", None
    with mp.workdps(DPS):
        return "value", mp.mpf(str(sp.N(expr, DPS)))


def agrees(symbolic: tuple[str, mp.mpf | None], shadow: tuple[str, mp.mpf | None]) -> bool:
    """記号の答えと影の答えが食い違わないか（0・極・値の別と、値なら相対 1e-40）。

    独立: 別手順（2 つの別々の計算の答えを比べるだけで、engine は読まない）
    """
    if symbolic[0] != shadow[0]:
        return False
    if symbolic[0] != "value":
        return True
    a, b = symbolic[1], shadow[1]
    assert a is not None and b is not None
    with mp.workdps(DPS):
        return bool(abs(a - b) <= mp.mpf("1e-40") * abs(b))


def answer(keys: list[str]) -> tuple[str, mp.mpf | None]:
    """キー列の真の答え: `("zero" | "pole" | "value", 50 桁の値)`。

    記号の答えを使い、**影の数値と食い違えば影の数値を使う**（SymPy の簡約の揺れに備える）。

    独立: 別手順（`read_keys` と `read_shadow` の 2 つの手順。engine は読まない）
    """
    symbolic = _verdict_of_symbolic(read_keys(keys))
    shadow = _verdict_of_shadow(read_shadow(keys))
    return symbolic if agrees(symbolic, shadow) else shadow


def is_near_boundary(keys: list[str]) -> bool:
    """真の答えが 10 桁の丸めの境目に近いか（0 と極は境目を持たない）。

    独立: 別手順（`corpus_deg_fold.near_rounding_boundary` を 50 桁の値に当てる）
    """
    kind, value = answer(keys)
    return kind == "value" and near_rounding_boundary(value)


def expected(keys: list[str]) -> dict:
    """キー列から表示（と、極ならエラー種別）を作る。

    **10 桁の丸めの境目に近い値は使わない**（呼び手が先に `is_near_boundary` で弾く。
    ここでも assert する）。

    独立: 別手順（`answer` の答えを `real_ref.format_real` で 10 桁にする）
    """
    kind, value = answer(keys)
    if kind == "pole":
        return {"error": "TrigPole", "main": ERROR_TEXT}
    if kind == "zero":
        return {"main": real_ref.format_real(0.0)}
    assert value is not None and not near_rounding_boundary(value), keys
    return {"main": real_ref.format_real(float(value))}


# ---- 群 ----

#: 1 つの候補: (キー列（関数なし）, 式の文字列)。
Candidate = tuple[list[str], str]


def _spell_int_power(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    keys = ["pi", "pow", "2", "eq", "mul", *_digits(n), "eq", "div", *_digits(d), "eq"]
    return [*keys, "div", "pi", "eq"], f"pi^2*{n}/{d}/pi"


def _spell_neg_power(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    keys = ["pi", "pow", "1", "neg", "eq", "mul", *_digits(n), "eq", "div", *_digits(d), "eq"]
    return [*keys, "mul", "pi", "sqr", "eq"], f"pi^-1*{n}/{d}*pi^2"


def _spell_sum_power(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    a = _decimal(rng)
    keys = [
        *["pi", "add", *_typed(a), "eq", "pow", "2", "eq"],
        *["sub", "pi", "sqr", "eq", "sub", *_typed(a), "sqr", "eq"],
        *["div", "2", "eq", "div", *_typed(a), "eq"],
        *["mul", *_digits(n), "eq", "div", *_digits(d), "eq"],
    ]
    return keys, f"((pi+{a})^2-pi^2-{a}^2)/2/{a}*{n}/{d}"


def _spell_root_power(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    m = rng.randint(2, 99)
    keys = [
        *["pi", "mul", *_digits(m), "eq", "sqrt", "pow", "2", "eq"],
        *["div", *_digits(m), "eq", "mul", *_digits(n), "eq", "div", *_digits(d), "eq"],
    ]
    return keys, f"sqrt(pi*{m})^2/{m}*{n}/{d}"


def _root_text(root: Fraction) -> str:
    """平方数の平方根（有限の十進）を打つ文字列に（`1/10` → `0.1`）。"""
    text = f"{float(root):.12g}"
    assert Fraction(text) == root, root
    return text


def _spell_square_sqrt(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    s_text, root = rng.choice(SQUARES)
    r_text = _root_text(root)
    keys = [
        *[*_typed(s_text), "sqrt", "mul", "pi", "eq"],
        *["mul", *_digits(n), "eq", "div", *_digits(d), "eq", "div", *_typed(r_text), "eq"],
    ]
    return keys, f"sqrt({s_text})*pi*{n}/{d}/{r_text}"


def _spell_square_half_power(rng: random.Random, angle: Fraction) -> Candidate:
    n, d = _mul_up(rng, angle)
    s_text, root = rng.choice(SQUARES)
    r_text = _root_text(root)
    keys = [
        *[*_typed(s_text), "pow", "0", "dot", "5", "eq", "mul", "pi", "eq"],
        *["mul", *_digits(n), "eq", "div", *_digits(d), "eq", "div", *_typed(r_text), "eq"],
    ]
    return keys, f"{s_text}^0.5*pi*{n}/{d}/{r_text}"


def _spell_zero_power(rng: random.Random, angle: Fraction, base: str) -> Candidate:
    n, d = _mul_up(rng, angle)
    head = ["pi"] if base == "pi" else ["2", "exp_e"]
    keys = [*head, "pow", "0", "eq", "mul", "pi", "eq", "mul", *_digits(n), "eq"]
    keys += ["div", *_digits(d), "eq"]
    name = "pi" if base == "pi" else "e^2"
    return keys, f"{name}^0*pi*{n}/{d}"


#: 16 の位置の群: 綴りと、渡す関数。
_POSITION_GROUPS: dict[str, tuple[Callable[[random.Random, Fraction], Candidate], tuple]] = {
    "int-power": (_spell_int_power, FUNCTIONS),
    "neg-power": (_spell_neg_power, FUNCTIONS),
    "sum-power": (_spell_sum_power, FUNCTIONS),
    "root-power": (_spell_root_power, FUNCTIONS),
    "square-sqrt": (_spell_square_sqrt, FUNCTIONS),
    "square-half-power": (_spell_square_half_power, ("sin",)),
}


def _fits_entry(keys: list[str]) -> bool:
    return all(len(e) <= ENTRY_LIMIT for e in _entries(keys))


def _case(keys: list[str], expr: str, group: str) -> dict:
    return {
        "kind": "display",
        "mode": "Rad" if keys[0] == "angle_toggle" else "Deg",
        "keys": keys,
        "expr": expr,
        "expect": expected(keys),
        "group": group,
    }


def _positions(
    rng: random.Random,
    spelling: Callable[[random.Random, Fraction], Candidate],
    functions: tuple,
    name: str,
) -> tuple[list[dict], int]:
    """16 の位置 × 関数。決まった候補列で、打てない候補と境目に近い候補は捨てる。"""
    cases: list[dict] = []
    discarded = 0
    for r in TABLE_POSITIONS:
        while True:
            angle = _angle_for(rng, r)
            keys, text = spelling(random.Random(rng.getrandbits(64)), angle)
            if not _fits_entry(keys):
                continue
            rows = [["angle_toggle", *keys, f] for f in functions]
            if not any(is_near_boundary(row) for row in rows):
                break
            discarded += 1
        # 生成器の自己検査: キー列が打つ角は、意図した角と同じ。
        shown = read_keys(["angle_toggle", *keys])
        target = sp.Rational(angle.numerator, angle.denominator) * sp.pi
        assert sp.expand(shown - target) == 0, (name, keys)
        for row, f in zip(rows, functions, strict=True):
            cases.append(_case(row, f"{f}({text})", name))
    return cases, discarded


def _zero_power() -> tuple[list[dict], int]:
    """`π xʸ 0` と `2 eˣ xʸ 0`（底の印が無い）を 16 の位置ずつ、`sin` だけ。"""
    rng = random.Random(SEEDS["zero-power"])
    cases: list[dict] = []
    discarded = 0
    for base in ("pi", "e"):
        spelling = functools.partial(_spell_zero_power, base=base)
        group, n = _positions(rng, spelling, ("sin",), "zero-power")
        cases += group
        discarded += n
    return cases, discarded


def _degrees_text(degrees: sp.Expr) -> list[str]:
    """`− 度 =`（度が負なら `+ |度| =`）のキー列。"""
    assert degrees.is_integer, degrees
    value = int(degrees)
    return ["sub" if value >= 0 else "add", *_digits(abs(value)), "eq"]


def _inverse(mode: str) -> tuple[list[dict], int]:
    """表に載る引数 25 通り。RAD は `sin`・`cos`・`tan`、DEG は `− 度 =` と `tan`。

    **引数を `=` で確定させてから関数を押す**（`0.5 = asin sin`）。`=` を一度も押さない
    キー列は、報告書が「確定前の表示を読む列」として数える（`report.ts` の「入力中の表示」）。
    この群が読むのは関数が計算した答えの表示なので、そこに数えさせない。
    """
    name = "inverse-rad" if mode == "Rad" else "inverse-deg"
    cases: list[dict] = []
    for arg, inverse in INVERSE_ARGS:
        body = [*arg, "eq", inverse]
        text = _arg_text(arg)
        if mode == "Rad":
            for f in FUNCTIONS:
                cases.append(_case(["angle_toggle", *body, f], f"{f}({inverse}({text}))", name))
            continue
        degrees = read_keys(body)
        cases.append(_case([*body, *_degrees_text(degrees)], f"{inverse}({text})-{degrees}", name))
        cases.append(_case([*body, "tan"], f"tan({inverse}({text}))", name))
    return cases, 0


def _arg_text(arg: tuple[str, ...]) -> str:
    """引数のキー列を式の文字列に（`0 . 5 √ +/−` → `-sqrt(0.5)`）。"""
    digits = [k for k in arg if k.isdigit() or k == "dot"]
    text = "".join("." if k == "dot" else k for k in digits)
    for key in arg[len(digits) :]:
        text = {"sqrt": f"sqrt({text})", "recip": f"1/{text}", "neg": f"-{text}"}[key]
    return text


def _quarter_fold() -> tuple[list[dict], int]:
    """`π × K = ÷ 2 = ± ( π × 7 EXP E +/− ) =` を `sin`・`cos`・`tan` に渡す。"""
    cases: list[dict] = []
    discarded = 0
    for k in FOLD_QUARTERS:
        for e in FOLD_EXPONENTS:
            for sign in ("add", "sub"):
                k_keys = [*_digits(abs(k)), *(["neg"] if k < 0 else [])]
                keys = [
                    *["angle_toggle", "pi", "mul", *k_keys, "eq", "div", "2", "eq"],
                    *[sign, "lparen", "pi", "mul", "7", "exp", *_digits(e), "neg", "rparen", "eq"],
                ]
                text = f"pi*{k}/2{'+' if sign == 'add' else '-'}pi*7e-{e}"
                for f in FUNCTIONS:
                    row = [*keys, f]
                    if is_near_boundary(row):
                        discarded += 1
                        continue
                    cases.append(_case(row, f"{f}({text})", "quarter-fold"))
    return cases, discarded


def groups() -> dict[str, tuple[list[dict], int]]:
    """10 群のケース（`id` なし）と、境目に近くて捨てた候補の数。

    独立: 別手順（群の作り方は設計書 §5.4 の表から。engine のコードは写していない）
    """
    out: dict[str, tuple[list[dict], int]] = {}
    for name in SEEDS:
        if name in _POSITION_GROUPS:
            spelling, functions = _POSITION_GROUPS[name]
            out[name] = _positions(random.Random(SEEDS[name]), spelling, functions, name)
        elif name == "zero-power":
            out[name] = _zero_power()
        elif name == "inverse-rad":
            out[name] = _inverse("Rad")
        elif name == "inverse-deg":
            out[name] = _inverse("Deg")
        else:
            assert name == "quarter-fold", name
            out[name] = _quarter_fold()
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
            case["id"] = f"pmm-{len(cases):06d}"
            cases.append(case)
    assert counts == EXPECTED_COUNTS, counts
    assert discards == EXPECTED_DISCARDS, discards
    return {
        "schema": SCHEMA,
        "generated_by": (
            f"SymPy {sp.__version__} と mpmath {mp.__version__} ({DPS} dps、影は {SHADOW_DPS} "
            "dps)。整数の指数の xʸ・逆三角関数・平方数の √・π/2 の倍数の近くの角を含む式の"
            "答えを、キー列を SymPy の厳密な式に読み、0 と極は厳密な値から決め、それ以外は"
            " N(式, 50) の 50 桁を 10 桁に整形した。同じキー列を mpmath の 400 桁でも追い、"
            "食い違えばそちらを真値にした。10 桁の丸めの境目から相対 1e-12 未満の標本は、"
            "引き直さずに捨てた。engine の印（engine/exact.rs）も三角関数の表"
            "（scientific/mod.rs）も写していない。"
        ),
        "cases": cases,
    }
