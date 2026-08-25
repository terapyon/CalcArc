"""重量級コーパスの式木と、その二つの直列化(設計書 §5)。

**このモジュールは計算しない。** ここが作るのは「同じ式木の二つの書き方」
だけで、値を出すのは Rust(キー列を食べる)と mpmath(数式を評価する)が
それぞれ独立に行う。両者がアルゴリズムを共有しないことが検証の土台である。

SymPy も mpmath も import しない。純粋であることが目で見て分かるようにする。
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

# **綴りは web/src/calc/types.ts の KEY_TOKENS が正。** 一字でも違うと
# ブラウザ側で未知のキーとして扱われる。
DIGIT_KEYS = ("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")
BINARY_KEYS = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    # 段階 3b-A で追加。**綴りは web/src/calc/types.ts の KEY_TOKENS が正。**
    "^": "pow",
    "nPr": "n_p_r",
    "nCr": "n_c_r",
}
UNARY_KEYS = {
    "sqrt": "sqrt",
    "sqr": "sqr",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "neg": "neg",
    # 段階 3b-A で追加。`fact` だけ式木の名前とキーの綴りが違う。
    "ln": "ln",
    "log10": "log10",
    "exp_e": "exp_e",
    "recip": "recip",
    "asin": "asin",
    "acos": "acos",
    "atan": "atan",
    "fact": "n_fact",
}

# **定数のキー。1 打鍵で値が入る。**
CONST_KEYS = {"pi": "pi", "e": "e"}
CONST_NAMES = ("pi", "e")

BINARY_OPS = ("+", "-", "*", "/")
UNARY_FNS = ("sqrt", "sqr", "sin", "cos", "tan", "neg")

# **既存の BINARY_OPS / UNARY_FNS は乱数の土台なので触らない**(設計書 §3.1)。
# 系統ごとの選択肢はここに別に置く。
ELEMENTARY_FNS = ("ln", "log10", "exp_e", "recip")
ELEMENTARY_BINS = ("^",)
INVERSE_TRIG_FNS = ("asin", "acos", "atan")
COMBINATORICS_FNS = ("fact",)
COMBINATORICS_BINS = ("nPr", "nCr")


@dataclass(frozen=True)
class Num:
    """非負整数のリテラル。押した桁がそのままキーになる。"""

    value: int


@dataclass(frozen=True)
class Bin:
    op: str
    left: Node
    right: Node


@dataclass(frozen=True)
class Un:
    fn: str
    arg: Node


@dataclass(frozen=True)
class Const:
    """1 打鍵で入る定数。`pi` と `e` の 2 つだけ。

    **現行のオペランドはすべて整数リテラルなので、これを入れるまで
    `current` に有理でない値が入ることが一度も起きていない**(設計書 §3.4)。
    """

    name: str


@dataclass(frozen=True)
class Typed:
    """**打った通りのキーと、その厳密な十進の文字列**(設計書 2026-08-17 §3.1)。

    `Num` との違いは、`Num` が「整数の値」を持ちキー列をそこから作るのに対し、
    こちらは**打鍵の列そのもの**を持つことである。小数点・`000`・指数入力は
    どれも「同じ値への別の打ち方」なので、値から復元できない。

    **`Num` は 1 文字も触らない。** あれは既存 16000 件の乱数と直列化の土台で、
    振る舞いを変えれば全シャードが総入れ替えになる(要件 R3b)。

    `text` は `"1.5"` や `"1.5e3"` のような十進の文字列である。
    **参照側はこれを文字列のまま読む**——`float()` を挟むと生成の時点で
    engine と同じ丸めが入り、両側が同じ誤差を持つ(要件 R2)。
    """

    keys: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class Imag:
    """**虚数の葉**（段階 J）。`j` を押して打った数。

    `Typed` と同じく**打鍵の列そのもの**を持つ。`j` は打つ位置で意味が変わる
    ——桁が無ければ虚数として始め、桁があれば実部⇄虚部を切り替える
    （`engine/mod.rs:283`）。どちらの打ち方も同じ値に着くが、
    **どちらを打ったかは値に残らない**ので、キー列を持つ。

    `text` は虚部の大きさの十進文字列で、**符号を含まない**——負の虚数は
    `Un("neg", Imag(...))` で作る（engine も `+/-` を別のキーとして扱う）。
    """

    keys: tuple[str, ...]
    text: str


Node = Num | Const | Typed | Imag | Bin | Un


def walk(node: Node) -> Iterator[Node]:
    """自身と全ての部分木。生成器が中間値の範囲を検査するために使う。"""
    yield node
    if isinstance(node, Bin):
        yield from walk(node.left)
        yield from walk(node.right)
    elif isinstance(node, Un):
        yield from walk(node.arg)


def to_keys(node: Node) -> list[str]:
    """式木をキー列にする。**二項は常に括弧で囲む。**

    優先順位に頼らないので、直列化が engine の結合規則を知らずに済む。
    優先順位そのものの検証は engine_table.rs の担当である(設計書 §5.1)。
    括弧を省いた版は段階 3 で足す。
    """
    if isinstance(node, Num):
        return [DIGIT_KEYS[int(digit)] for digit in str(node.value)]
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return [CONST_KEYS[node.name]]
    if isinstance(node, Typed | Imag):
        # **打鍵の列をそのまま返す。** 値から復元しない——`5 zeros3` と
        # `5 0 0 0` は同じ値の別の打ち方で、どちらを打ったかは値に残らない。
        # `Imag` も同じ——`j` `2` と `2` `j` は同じ値の別の打ち方である。
        return list(node.keys)
    if isinstance(node, Un):
        return [*to_keys(node.arg), UNARY_KEYS[node.fn]]
    return [
        "lparen",
        *to_keys(node.left),
        BINARY_KEYS[node.op],
        *to_keys(node.right),
        "rparen",
    ]


def to_key_sequence(node: Node) -> list[str]:
    """corpus の `keys` に入る形。末尾の `=` まで含む。"""
    return [*to_keys(node), "eq"]


# **engine の優先順位。crates/calcarc-core/src/engine/state.rs:46 が正。**
# Add|Sub = 1、Mul|Div = 2 の 2 段。ここは計算ではなく**記法の約束**なので、
# 参照実装の移植には当たらない(設計書 §5.1 の「残る結合」)。ただし engine が
# 段を増やしたらここも直す必要がある、という結合は残る。
BINARY_PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2}


def to_keys_minimal(node: Node) -> list[str]:
    """式木を、**省ける括弧を省いた**キー列にする。

    省くのは**子の優先順位が親より真に大きいとき**だけである。同順位の入れ子
    (`(10-3)-2`)の括弧を省けるのは engine が左結合だからで、省いた瞬間に
    この関数が結合方向を知ることになる。**知りたくないので残す**(設計書 §3.1)。

    代償として、このコーパスは結合方向を検証しない。それは engine_table.rs の
    担当である。
    """
    if isinstance(node, Num):
        return [DIGIT_KEYS[int(digit)] for digit in str(node.value)]
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return [CONST_KEYS[node.name]]
    if isinstance(node, Typed | Imag):
        return list(node.keys)
    if isinstance(node, Un):
        return [*_unary_operand_keys(node.arg), UNARY_KEYS[node.fn]]
    if node.op not in BINARY_PRECEDENCE:
        raise ValueError(f"unknown binary op: {node.op!r}")
    parent = BINARY_PRECEDENCE[node.op]
    return [
        *_binary_operand_keys(node.left, parent),
        BINARY_KEYS[node.op],
        *_binary_operand_keys(node.right, parent),
    ]


def _binary_operand_keys(child: Node, parent_precedence: int) -> list[str]:
    """二項の子。**優先順位が真に大きいときだけ**括弧を省く。

    未知の演算子には大きな声で落ちる(to_keys_minimal / to_expr_text と同じ態度)。
    `BINARY_PRECEDENCE[child.op]` を素で引くと、子として来た未知の演算子が
    `to_keys_minimal` の明示的な `ValueError` ではなく素の `KeyError` になってしまう。
    """
    if isinstance(child, Bin):
        if child.op not in BINARY_PRECEDENCE:
            raise ValueError(f"unknown binary op: {child.op!r}")
        if BINARY_PRECEDENCE[child.op] <= parent_precedence:
            return ["lparen", *to_keys_minimal(child), "rparen"]
    return to_keys_minimal(child)


def _unary_operand_keys(child: Node) -> list[str]:
    """単項の子。**二項なら必ず括弧で囲む。**

    単項は後置なので、括弧を省くと直前の数だけに掛かる別の式になる——
    `1 add 2 sqrt` は `1 + √2` であって `√(1+2)` ではない。ここは優先順位の
    話ではなく、後置記法そのものの要請である。
    """
    if isinstance(child, Bin):
        return ["lparen", *to_keys_minimal(child), "rparen"]
    return to_keys_minimal(child)


def to_minimal_key_sequence(node: Node) -> list[str]:
    """corpus の `keys` に入る形(括弧を省いた版)。末尾の `=` まで含む。"""
    return [*to_keys_minimal(node), "eq"]


def to_expr_text(node: Node) -> str:
    """corpus の `expr` に入る形。**人が読んで検算できることが要件**である。

    投稿者はこの文字列を見て「この期待値で合っているか」を判断する。
    """
    if isinstance(node, Num):
        return str(node.value)
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return node.name
    if isinstance(node, Typed):
        return node.text
    if isinstance(node, Imag):
        # 表示と同じ書き方にする(`2j`)。読み手が engine の画面と見比べられる。
        return f"j{node.text}"
    if isinstance(node, Un):
        inner = to_expr_text(node.arg)
        if node.fn == "sqr":
            return f"({inner})^2"
        if node.fn == "neg":
            return f"-({inner})"
        if node.fn in ("sin", "cos", "tan"):
            # 角度が度であることを数式そのものに書く。読み違えを防ぐ。
            return f"{node.fn}(rad({inner}))"
        if node.fn == "sqrt":
            return f"sqrt({inner})"
        if node.fn in ("ln", "log10"):
            return f"{node.fn}({inner})"
        if node.fn == "exp_e":
            # `exp_e` はキーの綴り(EE キーと区別するための名前)。人が読む
            # 数式では標準的な `exp(...)` と書く(M3)。
            return f"exp({inner})"
        if node.fn == "recip":
            # 自身を括弧で包む。`neg`/`sqr` と同じく、周囲の演算子に
            # 生の `/` を漏らさない(I1)。
            return f"(1/({inner}))"
        if node.fn in ("asin", "acos", "atan"):
            # **結果が度である。** sin が引数側に rad(...) を書くのと対称に、
            # 逆関数は結果側に deg(...) を書く(設計書 §3.3)。
            return f"deg({node.fn}({inner}))"
        if node.fn == "fact":
            return f"({inner})!"
        raise ValueError(f"unknown unary fn: {node.fn!r}")
    if node.op not in BINARY_KEYS:
        raise ValueError(f"unknown binary op: {node.op!r}")
    return f"({to_expr_text(node.left)} {node.op} {to_expr_text(node.right)})"
