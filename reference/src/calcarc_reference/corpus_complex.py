"""複素数の式木を評価する（段階 J）。

**`corpus_eval` とは別のモジュールである。** あちらは mpmath で実数を 50 桁
評価する。こちらは **SymPy の厳密な有理数**で複素数を組み立て、
**最後に 1 度だけ** f64 に落とす。

なぜ分けるか:

- **既存 12 シャードの評価器に手を入れない。** 24000 件の期待値がそこから
  出ている。複素数のために型を広げると、実数の経路にも影響が及びうる。
- **複素数の参照は既に SymPy にある**（`complex_ref`）。同じ道具で統一する。

engine は f64 の対で、演算ごとに丸める。こちらは木全体を厳密有理数で計算し、
最後に 1 度だけ丸める。**同じアルゴリズムを踏んでいない**ことが検証の土台である
（base-spec §30）。

## 三角関数について

engine の `sin`/`cos`/`tan` は**複素数を受け付ける**（`scientific/mod.rs:54`、
実測 2026-08-17）。`sqrt`/`ln`/`log10`/`recip`/`n_fact` は `real_arg` で
`DomainError` になるが、三角関数だけは実部・虚部の両方を同じ係数で
ラジアンに直してから複素の三角関数を計算する。

**その「両方を同じ係数で直す」という約束だけは共有する。** これは
`atan2(0, 0) = 0` と同じで、アルゴリズムではなく**単位の解釈**である
——約束が食い違うと突き合わせ自体が成立しない。計算そのもの
（SymPy の `sin(a + b*I)` と Rust の `sin(a)cosh(b) + i cos(a)sinh(b)`）は
共有していない。
"""

from __future__ import annotations

import sympy as sp

from calcarc_reference.corpus_expr import Const, Imag, Node, Num, Typed, Un

PRECISION = 50

#: engine が複素数を受け付ける単項。ここに無いものは `DomainError` になる。
COMPLEX_UNARY_FNS = ("neg", "sqr", "sin", "cos", "tan")

#: engine が複素数のまま扱う二項。四則すべて。
COMPLEX_BINARY_OPS = ("+", "-", "*", "/")


class NotComplexSafe(ValueError):
    """engine が `DomainError` を返す形。生成器が捨てるために使う。"""


def _leaf(node: Num | Const | Typed | Imag) -> sp.Expr:
    if isinstance(node, Num):
        return sp.Integer(node.value)
    if isinstance(node, Const):
        if node.name == "pi":
            return sp.pi
        if node.name == "e":
            return sp.E
        raise NotComplexSafe(f"unknown constant: {node.name!r}")
    if isinstance(node, Typed):
        # **文字列のまま読む。** `float()` を挟むと生成の時点で engine と
        # 同じ丸めが入り、両側が同じ誤差を持つ。
        return sp.Rational(node.text)
    # Imag: 虚部の大きさ。符号は Un("neg", ...) が付ける。
    return sp.Rational(node.text) * sp.I


def _to_radians(z: sp.Expr) -> sp.Expr:
    """度をラジアンに直す。**実部と虚部の両方に同じ係数を掛ける。**

    engine の `to_rad` と同じ解釈である（上のモジュール docstring を見よ）。
    """
    return z * sp.pi / 180


def evaluate_exact(node: Node) -> sp.Expr:
    """式木を厳密な SymPy 式にする。**丸めない。**"""
    if isinstance(node, Num | Const | Typed | Imag):
        return _leaf(node)
    if isinstance(node, Un):
        inner = evaluate_exact(node.arg)
        if node.fn == "neg":
            return -inner
        if node.fn == "sqr":
            return inner * inner
        if node.fn == "sin":
            return sp.sin(_to_radians(inner))
        if node.fn == "cos":
            return sp.cos(_to_radians(inner))
        if node.fn == "tan":
            return sp.tan(_to_radians(inner))
        # **黙って落とさない。** 知らない関数を素通りさせると、生成器が
        # engine の踏まない式を作ってしまう。
        raise NotComplexSafe(f"unary {node.fn!r} is not complex-safe")
    if node.op == "+":
        return evaluate_exact(node.left) + evaluate_exact(node.right)
    if node.op == "-":
        return evaluate_exact(node.left) - evaluate_exact(node.right)
    if node.op == "*":
        return evaluate_exact(node.left) * evaluate_exact(node.right)
    if node.op == "/":
        right = evaluate_exact(node.right)
        if right == 0:
            raise NotComplexSafe("division by zero")
        return evaluate_exact(node.left) / right
    raise NotComplexSafe(f"binary {node.op!r} is not complex-safe")


def evaluate(node: Node) -> tuple[float, float]:
    """式木を `(実部, 虚部)` の f64 にする。**丸めるのはここ 1 回だけ。**"""
    value = sp.N(evaluate_exact(node), PRECISION)
    re, im = value.as_real_imag()
    if not (re.is_finite and im.is_finite):
        raise NotComplexSafe(f"not finite: {value}")
    return float(re), float(im)


def to_polar(re: float, im: float) -> tuple[float, float]:
    """直交形式から極形式へ。**`complex_ref` をそのまま使う。**

    段階 J のために書き直さない——既に SymPy の厳密式で書かれており、
    `atan2(0, 0) = 0` の約束（IEEE 754 と同じ）も記録されている。
    """
    from calcarc_reference import complex_ref

    return complex_ref.rect_to_polar(re, im)
