"""式木の評価。**キー列を一切見ない**——見た瞬間 engine の移植になる。"""

import math

import mpmath as mp
import pytest

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import Bin, Const, Num, Un


def test_arithmetic() -> None:
    assert evaluate(Bin("+", Num(1), Num(2))) == mp.mpf(3)
    assert evaluate(Bin("/", Num(1), Num(4))) == mp.mpf("0.25")


def test_square_root() -> None:
    assert evaluate(Un("sqrt", Num(2))) == mp.sqrt(2)


def test_trigonometry_is_in_degrees() -> None:
    # sin 30 度 = 1/2。弧度法で読むと 0.5 にならない。
    assert abs(evaluate(Un("sin", Num(30))) - mp.mpf("0.5")) < mp.mpf("1e-40")


def test_division_by_zero_is_out_of_this_shard() -> None:
    # エラーの扱いは段階 3 の主題。縦の 1 本では生成器が避ける。
    with pytest.raises(OutOfShard):
        evaluate(Bin("/", Num(1), Num(0)))


def test_the_square_root_of_a_negative_is_out_of_this_shard() -> None:
    # 複素数に落ちる。実部・虚部の比較は段階 3 で扱う。
    with pytest.raises(OutOfShard):
        evaluate(Un("sqrt", Un("neg", Num(4))))


def test_precision_is_higher_than_the_display_can_show() -> None:
    # 50 桁で評価する。表示が言えるのはその一部だが、参照側が
    # 表示精度に合わせて丸む理由はない(設計書 §6.3)。
    value = evaluate(Un("sqrt", Num(2)))
    assert mp.nstr(value, 30) != mp.nstr(mp.mpf(1.4142135623730951), 30)


def test_unknown_binary_op_raises_instead_of_silently_dividing() -> None:
    # "%" は BINARY_OPS に無い。かつて else 節が黙って除算に落ちていた
    # ——違う演算を実行して、それらしい数を返す壊れ方だった。
    with pytest.raises(ValueError, match="unknown binary op"):
        evaluate(Bin("%", Num(1), Num(2)))


def test_unknown_unary_fn_raises_instead_of_silently_using_mpmath() -> None:
    # "cbrt" は UNARY_FNS に無いが、mpmath 自身は cbrt を持つ。
    # getattr(mp, node.fn) に素通しすると、無関係な関数を実行して
    # それらしい数を返してしまう。
    with pytest.raises(ValueError, match="unknown unary fn"):
        evaluate(Un("cbrt", Num(8)))


def test_constants_are_the_mpmath_ones() -> None:
    assert evaluate(Const("pi")) == mp.pi
    assert evaluate(Const("e")) == mp.e


def test_an_unknown_constant_is_refused_loudly() -> None:
    with pytest.raises(ValueError):
        evaluate(Const("tau"))


def test_logarithms_need_a_positive_argument() -> None:
    assert evaluate(Un("ln", Num(1))) == 0
    with pytest.raises(OutOfShard):
        evaluate(Un("ln", Num(0)))
    with pytest.raises(OutOfShard):
        evaluate(Un("ln", Un("neg", Num(5))))
    with pytest.raises(OutOfShard):
        evaluate(Un("log10", Num(0)))


def test_reciprocal_of_zero_is_out_of_shard() -> None:
    assert evaluate(Un("recip", Num(4))) == mp.mpf(1) / 4
    with pytest.raises(OutOfShard):
        evaluate(Un("recip", Num(0)))


def test_inverse_trig_returns_degrees() -> None:
    # asin(1) は 90 度。**ラジアンではない**——engine が AngleMode で
    # 変換して返すので、参照側も度で持つ(設計書 §3.3)。
    assert evaluate(Un("asin", Num(1))) == 90
    assert evaluate(Un("acos", Num(1))) == 0
    assert evaluate(Un("atan", Num(0))) == 0


def test_inverse_trig_needs_an_argument_in_range() -> None:
    with pytest.raises(OutOfShard):
        evaluate(Un("asin", Num(2)))
    with pytest.raises(OutOfShard):
        evaluate(Un("acos", Num(2)))
    # atan は全実数で定義される。
    assert evaluate(Un("atan", Num(1000))) != 0


def test_factorial_is_exact_and_only_on_non_negative_integers() -> None:
    # **厳密な整数で計算する。** engine は f64 で反復積を取るが、
    # こちらが同じことをすると同じ誤差が両側に入る。
    assert evaluate(Un("fact", Num(20))) == mp.mpf(math.factorial(20))
    with pytest.raises(OutOfShard):
        evaluate(Un("fact", Un("neg", Num(1))))
    with pytest.raises(OutOfShard):
        evaluate(Un("fact", Un("recip", Num(2))))  # 0.5 は整数でない


def test_permutations_and_combinations_are_exact() -> None:
    assert evaluate(Bin("nPr", Num(5), Num(2))) == 20
    assert evaluate(Bin("nCr", Num(5), Num(2))) == 10
    # **これが engine の実装が苦労する場所である。**
    # 答は収まるが、掛けてから割ると途中で f64 を溢れる。
    assert evaluate(Bin("nCr", Num(1022), Num(511))) == mp.mpf(math.comb(1022, 511))


def test_combinations_need_non_negative_integers_with_r_at_most_n() -> None:
    with pytest.raises(OutOfShard):
        evaluate(Bin("nCr", Num(2), Num(5)))  # r > n
    with pytest.raises(OutOfShard):
        evaluate(Bin("nCr", Un("neg", Num(2)), Num(1)))


def test_power_has_a_real_value_only_sometimes() -> None:
    assert evaluate(Bin("^", Num(2), Num(3))) == 8
    assert evaluate(Bin("^", Num(0), Num(0))) == 1
    assert evaluate(Bin("^", Num(0), Num(5))) == 0
    with pytest.raises(OutOfShard):
        evaluate(Bin("^", Num(0), Un("neg", Num(1))))  # 0^(負)
    with pytest.raises(OutOfShard):
        # 底が負で指数が非整数。実数の範囲に答が無い。
        evaluate(Bin("^", Un("neg", Num(8)), Un("recip", Num(3))))


def test_an_unknown_function_is_refused_loudly() -> None:
    # mpmath がたまたま同名の関数を持っていると、無関係な値を返す。
    with pytest.raises(ValueError):
        evaluate(Un("cbrt", Num(8)))
    with pytest.raises(ValueError):
        evaluate(Bin("%", Num(5), Num(2)))
