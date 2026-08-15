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
BINARY_KEYS = {"+": "add", "-": "sub", "*": "mul", "/": "div"}
UNARY_KEYS = {
    "sqrt": "sqrt",
    "sqr": "sqr",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "neg": "neg",
}

BINARY_OPS = ("+", "-", "*", "/")
UNARY_FNS = ("sqrt", "sqr", "sin", "cos", "tan", "neg")


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


Node = Num | Bin | Un


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


def to_expr_text(node: Node) -> str:
    """corpus の `expr` に入る形。**人が読んで検算できることが要件**である。

    投稿者はこの文字列を見て「この期待値で合っているか」を判断する。
    """
    if isinstance(node, Num):
        return str(node.value)
    if isinstance(node, Un):
        inner = to_expr_text(node.arg)
        if node.fn == "sqr":
            return f"({inner})^2"
        if node.fn == "neg":
            return f"-({inner})"
        if node.fn in ("sin", "cos", "tan"):
            # 角度が度であることを数式そのものに書く。読み違えを防ぐ。
            return f"{node.fn}(rad({inner}))"
        return f"sqrt({inner})"
    return f"({to_expr_text(node.left)} {node.op} {to_expr_text(node.right)})"
