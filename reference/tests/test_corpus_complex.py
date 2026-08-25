"""複素数の評価器の検査（段階 J）。

**engine の答えを写さない。** ここが確かめるのは「評価器が数学どおりか」と
「engine が受け付けない形を捨てるか」である。engine との突き合わせは
E2E（`complex-000.json` の 2000 件）が行う。
"""

from __future__ import annotations

import math

import pytest

from calcarc_reference.corpus_complex import (
    COMPLEX_BINARY_OPS,
    COMPLEX_UNARY_FNS,
    NotComplexSafe,
    evaluate,
)
from calcarc_reference.corpus_expr import Bin, Imag, Typed, Un


def imag(text: str) -> Imag:
    return Imag(("j", *(c if c != "." else "dot" for c in text)), text)


def typed(text: str) -> Typed:
    return Typed(tuple(c if c != "." else "dot" for c in text), text)


def test_the_imaginary_leaf_is_on_the_imaginary_axis() -> None:
    assert evaluate(imag("2")) == (0.0, 2.0)
    assert evaluate(Un("neg", imag("2"))) == (0.0, -2.0)


def test_the_four_operations_stay_complex() -> None:
    assert evaluate(Bin("+", typed("3"), imag("4"))) == (3.0, 4.0)
    assert evaluate(Bin("-", typed("3"), imag("4"))) == (3.0, -4.0)
    # (3+4j) / (1+2j) = 2.2 - 0.4j。教科書の値である。
    quotient = Bin(
        "/",
        Bin("+", typed("3"), imag("4")),
        Bin("+", typed("1"), imag("2")),
    )
    re, im = evaluate(quotient)
    assert math.isclose(re, 2.2, rel_tol=1e-15)
    assert math.isclose(im, -0.4, rel_tol=1e-15)


def test_squaring_the_imaginary_unit_gives_minus_one() -> None:
    """`2j` の 2 乗は `-4`。**虚部は厳密に 0 になる。**"""
    assert evaluate(Un("sqr", imag("2"))) == (-4.0, 0.0)
    assert evaluate(Bin("*", imag("2"), imag("2"))) == (-4.0, 0.0)


def test_the_trigonometric_functions_take_complex_arguments() -> None:
    """**実測（2026-08-17）で engine が受け付ける。**

    `scientific/mod.rs` の `to_rad` が「複素数の引数でも実部・虚部の両方を
    同じ係数で変換する」と書いており、`sin` はそのまま複素の正弦になる。

    ここでは数学どおりであることだけを見る——虚軸上の正弦は純虚数である
    （sin(jy) = j·sinh(y)）。engine との一致は E2E が確かめる。
    """
    re, im = evaluate(Un("sin", imag("2")))
    assert re == 0.0, "虚軸上の正弦は実部を持たない"
    # 2 度 = 0.0349065850… ラジアン。sinh(0.03490658504) = 0.03491367424…
    assert math.isclose(im, math.sinh(math.radians(2.0)), rel_tol=1e-12)


def test_the_functions_the_engine_refuses_are_refused_here_too() -> None:
    """**engine が `DomainError` を返す形を、生成器が作らないようにする。**

    作っても全部捨てられるだけで、棄却率が上がる以外に何も確かめない
    （設計書 2026-08-17-complex §3.1）。黙って素通りさせると、生成器が
    engine の踏まない式を出してしまう。
    """
    for fn in ("sqrt", "ln", "log10", "recip", "fact", "asin", "exp_e"):
        with pytest.raises(NotComplexSafe):
            evaluate(Un(fn, imag("2")))
    for op in ("^", "nPr", "nCr"):
        with pytest.raises(NotComplexSafe):
            evaluate(Bin(op, imag("2"), typed("3")))


def test_the_allowed_lists_match_what_the_evaluator_accepts() -> None:
    """**一覧と実装が食い違わないこと。**

    生成器は `COMPLEX_UNARY_FNS` / `COMPLEX_BINARY_OPS` を見て木を組む。
    一覧に載っているのに評価器が拒む形があると、生成が延々と捨て続けて
    「gave up」で止まる——止まればまだよいが、確率が低ければ**遅いだけの
    生成器**になって気づかれない。
    """
    for fn in COMPLEX_UNARY_FNS:
        evaluate(Un(fn, imag("2")))
    for op in COMPLEX_BINARY_OPS:
        evaluate(Bin(op, Bin("+", typed("3"), imag("4")), typed("2")))


def test_division_by_zero_is_refused_rather_than_raising_something_else() -> None:
    with pytest.raises(NotComplexSafe):
        evaluate(Bin("/", imag("2"), typed("0")))


def test_the_whole_tree_is_exact_and_rounds_once() -> None:
    """**丸めるのは最後の 1 回だけ。**

    engine は演算ごとに f64 で丸める。こちらが同じことをすると、同じ丸め方を
    共有してしまい「両方が同じ誤差を持つ」状態になる——検証が成立しない。

    1/3 を 3 回足しても厳密に 1 になることで、途中で丸めていないと分かる。
    途中を f64 で丸めれば 0.9999999999999999 になる。
    """
    third = Bin("/", typed("1"), typed("3"))
    total = Bin("+", Bin("+", third, third), third)
    assert evaluate(Bin("*", total, imag("1"))) == (0.0, 1.0)
