"""式木を数として評価する経路(設計書 §5)。

**キー列を見てはならない。** ここが見るのは式木の数学的な意味だけで、
押した順の意味論(保留演算・括弧・角度モードの切り替え)には一切触れない。
触った瞬間 engine の移植になり、独立検証が壊れる。

精度は scientific_ref.py と同じ 50 桁。表示が言えるのはその一部だが、
参照側が表示に合わせて精度を落とす理由はない。
"""

from __future__ import annotations

import mpmath as mp

from .corpus_expr import Node, Num, Un

mp.mp.dps = 50


class OutOfShard(Exception):
    """このシャードが扱わない値に当たった。生成器はこれを見て捨てる。

    縦の 1 本では、エラー(ゼロ除算)と複素数(負数の平方根)を範囲外にする。
    どちらも扱えないからではなく、比較の形が違うので段階を分けたためである。
    """


def evaluate(node: Node) -> mp.mpf:
    if isinstance(node, Num):
        return mp.mpf(node.value)
    if isinstance(node, Un):
        value = evaluate(node.arg)
        if node.fn == "sqrt":
            if value < 0:
                raise OutOfShard("sqrt of a negative number")
            return mp.sqrt(value)
        if node.fn == "sqr":
            return value * value
        if node.fn == "neg":
            return -value
        # 角度は度。ラジアンに直してから渡す。
        return getattr(mp, node.fn)(value * mp.pi / 180)
    left = evaluate(node.left)
    right = evaluate(node.right)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if right == 0:
        raise OutOfShard("division by zero")
    return left / right
