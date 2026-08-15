"""式木の二つの直列化。**ここでは一切計算しない。**"""

from calcarc_reference.corpus_expr import (
    Bin,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    to_keys,
    walk,
)


def test_a_literal_becomes_its_digits() -> None:
    assert to_keys(Num(407)) == ["4", "0", "7"]


def test_a_binary_node_is_always_parenthesised() -> None:
    # 優先順位に頼らない。結合規則の検証は engine_table.rs の担当である。
    assert to_keys(Bin("+", Num(1), Num(2))) == [
        "lparen",
        "1",
        "add",
        "2",
        "rparen",
    ]


def test_a_unary_function_is_postfix() -> None:
    # 数を入れてから押す。
    assert to_keys(Un("sqrt", Num(2))) == ["2", "sqrt"]


def test_nesting_keeps_both_shapes_in_step() -> None:
    node = Bin("*", Un("sqrt", Num(2)), Num(3))
    assert to_keys(node) == ["lparen", "2", "sqrt", "mul", "3", "rparen"]
    assert to_expr_text(node) == "(sqrt(2) * 3)"


def test_the_sequence_ends_with_equals() -> None:
    assert to_key_sequence(Num(5)) == ["5", "eq"]


def test_trigonometry_says_the_angle_is_degrees() -> None:
    # コーパスの mode は Deg 固定。数式側にもそう書いておかないと、
    # 読んだ人が弧度法と取り違える。
    assert to_expr_text(Un("sin", Num(30))) == "sin(rad(30))"


def test_walk_visits_every_subtree() -> None:
    node = Bin("+", Num(1), Un("neg", Num(2)))
    assert len(list(walk(node))) == 4
