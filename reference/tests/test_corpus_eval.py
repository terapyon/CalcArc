"""式木の評価。**キー列を一切見ない**——見た瞬間 engine の移植になる。"""

import mpmath as mp
import pytest

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import Bin, Num, Un


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
