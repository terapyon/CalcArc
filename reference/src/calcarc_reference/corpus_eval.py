"""式木を数として評価する経路(設計書 §5)。

**キー列を見てはならない。** ここが見るのは式木の数学的な意味だけで、
押した順の意味論(保留演算・括弧・角度モードの切り替え)には一切触れない。
触った瞬間 engine の移植になり、独立検証が壊れる。

精度は scientific_ref.py と同じ 50 桁。表示が言えるのはその一部だが、
参照側が表示に合わせて精度を落とす理由はない。
"""

from __future__ import annotations

import math

import mpmath as mp

from .corpus_expr import (
    BINARY_OPS,
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    CONST_KEYS,
    ELEMENTARY_BINS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_FNS,
    Const,
    Node,
    Num,
    Typed,
    Un,
)

mp.mp.dps = 50

# **未知の名前で落ちるための集合。** ここに無い fn / op を通すと、
# 下の分岐が黙って別の演算を実行するか、mpmath の同名関数に化ける。
KNOWN_UNARY_FNS = frozenset(UNARY_FNS + ELEMENTARY_FNS + INVERSE_TRIG_FNS + COMBINATORICS_FNS)
KNOWN_BINARY_OPS = frozenset(BINARY_OPS + ELEMENTARY_BINS + COMBINATORICS_BINS)


class OutOfShard(Exception):
    """このシャードが扱わない値に当たった。生成器はこれを見て捨てる。

    縦の 1 本では、エラー(ゼロ除算)と複素数(負数の平方根)を範囲外にする。
    どちらも扱えないからではなく、比較の形が違うので段階を分けたためである。
    """


def _as_non_negative_integer(value: mp.mpf, what: str) -> int:
    """**厳密な整数として取り出す。** 取り出せなければこのシャードの外。

    engine は f64 で判定しているが、こちらは Python の整数で持つ。
    同じ判定を写すのではなく、**数学的な定義域**をそのまま書いている。
    """
    if not mp.isfinite(value):
        # +inf はここまで通り抜ける——`< 0` は False、`floor(inf) == inf`
        # で整数判定も通る。`int()` はここで裸の `ValueError` を投げるが、
        # それは evaluate が「未知の名前」の合図に使っている型と同じなので、
        # 区別が付かなくなる。ここで OutOfShard として先に止める。
        raise OutOfShard(f"{what} of a non-finite number")
    if value < 0:
        raise OutOfShard(f"{what} of a negative number")
    if value != mp.floor(value):
        raise OutOfShard(f"{what} of a non-integer")
    return int(value)


def _degrees(radians: mp.mpf) -> mp.mpf:
    """逆三角関数の結果を度にする(設計書 §3.3)。"""
    return radians * 180 / mp.pi


def _power(base: mp.mpf, exponent: mp.mpf) -> mp.mpf:
    """実数の範囲で答が一意に決まるものだけ返す。

    **これは数学の定義域であって、`scientific/mod.rs` の写しではない。**
    負の底に非整数の指数を当てると値は複素数になり、実数の電卓には答が無い。
    """
    if base == 0:
        if exponent > 0:
            return mp.mpf(0)
        if exponent == 0:
            # 0^0 = 1。電卓の慣行
            # (2026-08-16-scientific-real-functions-design.md §4.1)。
            return mp.mpf(1)
        raise OutOfShard("zero to a negative power")
    if base < 0 and exponent != mp.floor(exponent):
        raise OutOfShard("negative base with a non-integer exponent")
    return base**exponent


def evaluate(node: Node) -> mp.mpf:
    if isinstance(node, Num):
        return mp.mpf(node.value)
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return mp.pi if node.name == "pi" else mp.e
    if isinstance(node, Typed):
        # **文字列のまま読む。** `float(node.text)` を挟むと、生成の時点で
        # engine と同じ丸めが入り、**両側が同じ誤差を持つ**——桁落ちを測る
        # シャードでは、測りたいものがそこで消える(設計書 2026-08-17 §3.2)。
        return mp.mpf(node.text)
    if isinstance(node, Un):
        if node.fn not in KNOWN_UNARY_FNS:
            # 未知の fn を通すと、mpmath がたまたま同名の関数を持っていた
            # 場合に無関係な値を返してしまう(例: "cbrt" は mp.cbrt に化ける)。
            raise ValueError(f"unknown unary fn: {node.fn!r}")
        value = evaluate(node.arg)
        if node.fn == "sqrt":
            if value < 0:
                raise OutOfShard("sqrt of a negative number")
            return mp.sqrt(value)
        if node.fn == "sqr":
            return value * value
        if node.fn == "neg":
            return -value
        if node.fn in ("ln", "log10"):
            # 対数の引数は正。**数学の定義域であって、実装の分岐ではない。**
            if value <= 0:
                raise OutOfShard(f"{node.fn} of a non-positive number")
            return mp.log(value) if node.fn == "ln" else mp.log10(value)
        if node.fn == "exp_e":
            return mp.exp(value)
        if node.fn == "recip":
            if value == 0:
                raise OutOfShard("reciprocal of zero")
            return mp.mpf(1) / value
        if node.fn in ("asin", "acos"):
            if not (-1 <= value <= 1):
                raise OutOfShard(f"{node.fn} outside [-1, 1]")
            fn = mp.asin if node.fn == "asin" else mp.acos
            return _degrees(fn(value))
        if node.fn == "atan":
            return _degrees(mp.atan(value))
        if node.fn == "fact":
            # **厳密な整数で計算する。** engine は f64 の反復積なので、
            # 同じ形で書くと同じ誤差が両側に入る(CLAUDE.md)。
            return mp.mpf(math.factorial(_as_non_negative_integer(value, "factorial")))
        if node.fn in ("sin", "cos", "tan"):
            # 角度は度。ラジアンに直してから渡す。
            return getattr(mp, node.fn)(value * mp.pi / 180)
        # KNOWN_UNARY_FNS に名前はあるのに、ここまでのどの分岐にも
        # 一致しなかった。四系統のタプルは後続の段階が増やしていくので、
        # 名前だけ足して分岐を足し忘れると、かつてここが `getattr(mp, ...)`
        # に素通ししていた形に戻ってしまう——mpmath がたまたま同名の関数を
        # 持っていれば、無関係な値を静かに返す。最後の網としてここで落ちる。
        raise ValueError(f"unary fn {node.fn!r} is known but has no dispatch branch")
    if node.op not in KNOWN_BINARY_OPS:
        # 未知の op を通すと、下の節が黙って除算を実行してしまう
        # ——違う演算の名の下にそれらしい数を返す、一番静かな壊れ方。
        raise ValueError(f"unknown binary op: {node.op!r}")
    left = evaluate(node.left)
    right = evaluate(node.right)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if node.op == "^":
        return _power(left, right)
    if node.op in ("nPr", "nCr"):
        n = _as_non_negative_integer(left, node.op)
        r = _as_non_negative_integer(right, node.op)
        if r > n:
            raise OutOfShard(f"{node.op} with r greater than n")
        # **厳密な整数。** engine は f64 で段ごとに掛け割りするので、
        # こちらが同じ手順を踏むと独立性が消える。
        exact = math.perm(n, r) if node.op == "nPr" else math.comb(n, r)
        return mp.mpf(exact)
    if node.op == "/":
        if right == 0:
            raise OutOfShard("division by zero")
        return left / right
    # KNOWN_BINARY_OPS に名前はあるのに、ここまでのどの分岐にも一致しな
    # かった。同上——名前だけ足して分岐を足し忘れると、かつてここが
    # 黙って除算を実行していた形に戻ってしまう。最後の網としてここで落ちる。
    raise ValueError(f"binary op {node.op!r} is known but has no dispatch branch")
