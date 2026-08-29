"""式木の二つの直列化。**ここでは一切計算しない。**"""

import pytest

from calcarc_reference.corpus_expr import (
    BINARY_KEYS,
    BINARY_PRECEDENCE,
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    CONST_KEYS,
    CONST_NAMES,
    ELEMENTARY_BINS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_KEYS,
    Bin,
    Const,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    to_keys,
    to_keys_minimal,
    to_minimal_key_sequence,
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
    assert to_expr_text(Un("cos", Num(30))) == "cos(rad(30))"
    assert to_expr_text(Un("tan", Num(30))) == "tan(rad(30))"


def test_walk_visits_every_subtree() -> None:
    node = Bin("+", Num(1), Un("neg", Num(2)))
    assert len(list(walk(node))) == 4


def test_an_unknown_unary_fn_is_loud_not_silent() -> None:
    # to_keys は不正な fn に即座に KeyError を投げる。to_expr_text も同じ
    # 態度でなければならない——黙って sqrt(...) を描いてはいけない。
    with pytest.raises(ValueError, match="unknown unary fn"):
        to_expr_text(Un("cot", Num(2)))


def test_a_higher_precedence_child_loses_its_parentheses() -> None:
    # 1 + (2 * 3) → 1 + 2 * 3。子の優先順位が親より真に大きい。
    node = Bin("+", Num(1), Bin("*", Num(2), Num(3)))
    assert to_keys_minimal(node) == ["1", "add", "2", "mul", "3"]


def test_a_lower_precedence_child_keeps_its_parentheses() -> None:
    # (1 + 2) * 3。省くと別の式になる。
    node = Bin("*", Bin("+", Num(1), Num(2)), Num(3))
    assert to_keys_minimal(node) == [
        "lparen",
        "1",
        "add",
        "2",
        "rparen",
        "mul",
        "3",
    ]


def test_same_precedence_keeps_its_parentheses() -> None:
    # (10 - 3) - 2。**省けるのは左結合だからで、それを知りたくない。**
    # 同順位の入れ子は常に括弧を残す(設計書 §3.1)。
    node = Bin("-", Bin("-", Num(10), Num(3)), Num(2))
    assert to_keys_minimal(node) == [
        "lparen",
        "1",
        "0",
        "sub",
        "3",
        "rparen",
        "sub",
        "2",
    ]
    # 右側も同じ。
    right = Bin("-", Num(10), Bin("-", Num(3), Num(2)))
    assert to_keys_minimal(right) == [
        "1",
        "0",
        "sub",
        "lparen",
        "3",
        "sub",
        "2",
        "rparen",
    ]


def test_a_unary_always_parenthesises_a_binary_argument() -> None:
    # **単項は後置なので、二項の子は必ず括弧で囲む。**
    # 省くと sqrt が直前の数だけに掛かる別の式になる
    # (`1 add 2 sqrt` は 1 + √2 であって √(1+2) ではない)。
    node = Un("sqrt", Bin("+", Num(1), Num(2)))
    assert to_keys_minimal(node) == [
        "lparen",
        "1",
        "add",
        "2",
        "rparen",
        "sqrt",
    ]


def test_a_unary_child_of_a_binary_needs_no_parentheses() -> None:
    # √2 + 3。単項は後置で、括弧は要らない。
    node = Bin("+", Un("sqrt", Num(2)), Num(3))
    assert to_keys_minimal(node) == ["2", "sqrt", "add", "3"]


def test_the_minimal_sequence_ends_with_equals() -> None:
    assert to_minimal_key_sequence(Num(5)) == ["5", "eq"]


def test_the_precedence_table_matches_the_engine() -> None:
    # crates/calcarc-core/src/engine/state.rs:46 が正。
    # Add|Sub = 1、Mul|Div = 2 の 2 段。
    assert BINARY_PRECEDENCE == {"+": 1, "-": 1, "*": 2, "/": 2}


def test_an_unknown_binary_op_as_a_child_is_loud_not_silent() -> None:
    # 未知の演算子が子として来たときも、素の KeyError ではなく to_keys_minimal
    # 自身が投げるのと同じ ValueError で落ちる(このモジュールの作法に揃える)。
    node = Bin("+", Bin("%", Num(1), Num(2)), Num(3))
    with pytest.raises(ValueError, match="unknown binary op"):
        to_keys_minimal(node)


def test_a_higher_precedence_binary_child_of_a_unary_still_keeps_its_parentheses() -> None:
    # √(1×2)。単項の子は優先順位に関わらず必ず括弧を残す——もし単項側が
    # 優先順位の判定を混ぜていたら、ここで括弧が落ちて 1 × √2 という別の式に
    # なってしまう。危ないのは「単項の子が低い優先順位を持つ」逆方向ではなく、
    # こちら(高い優先順位の二項を単項の子に持つ形)である。
    node = Un("sqrt", Bin("*", Num(1), Num(2)))
    assert to_keys_minimal(node) == [
        "lparen",
        "1",
        "mul",
        "2",
        "rparen",
        "sqrt",
    ]


def test_dropping_parentheses_never_changes_the_tokens_that_are_not_parentheses() -> None:
    # **括弧以外は 1 つも変わらない。** 片方だけ直す事故への守り(設計書 §6)。
    node = Bin("+", Num(1), Bin("*", Num(2), Un("sqrt", Num(9))))

    def without_parens(keys: list[str]) -> list[str]:
        return [k for k in keys if k not in ("lparen", "rparen")]

    assert without_parens(to_keys_minimal(node)) == without_parens(to_keys(node))


def test_a_constant_is_one_key_press() -> None:
    assert to_keys(Const("pi")) == ["pi"]
    assert to_keys(Const("e")) == ["e"]


def test_a_constant_reads_as_itself() -> None:
    # `to_expr_text`'s Const arm returns `node.name` verbatim regardless of
    # which constant it is, so one example pins the whole branch; asserting
    # both "pi" and "e" here would exercise the identical line twice
    # (M5, Task 1 review round 1). `"e"` is still exercised via `to_keys`
    # in `test_a_constant_is_one_key_press`.
    assert to_expr_text(Const("pi")) == "pi"


def test_an_unknown_constant_is_refused_loudly() -> None:
    # 未知の名前を通すと、キー列に存在しないトークンが載って
    # ブラウザ側で黙って読み飛ばされ、別の式が計算される。
    with pytest.raises(ValueError, match="unknown constant"):
        to_keys(Const("tau"))
    with pytest.raises(ValueError, match="unknown constant"):
        to_expr_text(Const("tau"))


def test_a_constant_is_a_leaf_when_walking() -> None:
    assert list(walk(Const("pi"))) == [Const("pi")]


def test_the_new_unary_functions_use_the_key_tokens_the_browser_knows() -> None:
    # 綴りは web/src/calc/types.ts の KEY_TOKENS が正。
    # `fact` だけ式木の名前とキーの綴りが違う（キーは `n_fact`）。
    assert to_keys(Un("ln", Num(5))) == ["5", "ln"]
    assert to_keys(Un("log10", Num(5))) == ["5", "log10"]
    assert to_keys(Un("exp_e", Num(5))) == ["5", "exp_e"]
    assert to_keys(Un("recip", Num(5))) == ["5", "recip"]
    assert to_keys(Un("asin", Num(0))) == ["0", "asin"]
    assert to_keys(Un("acos", Num(0))) == ["0", "acos"]
    assert to_keys(Un("atan", Num(0))) == ["0", "atan"]
    assert to_keys(Un("fact", Num(5))) == ["5", "n_fact"]


def test_the_new_binary_operators_use_the_key_tokens_the_browser_knows() -> None:
    assert to_keys(Bin("^", Num(2), Num(3))) == [
        "lparen",
        "2",
        "pow",
        "3",
        "rparen",
    ]
    assert to_keys(Bin("nPr", Num(5), Num(2))) == [
        "lparen",
        "5",
        "n_p_r",
        "2",
        "rparen",
    ]
    assert to_keys(Bin("nCr", Num(5), Num(2))) == [
        "lparen",
        "5",
        "n_c_r",
        "2",
        "rparen",
    ]


def test_the_new_operators_read_as_mathematics() -> None:
    assert to_expr_text(Bin("^", Num(2), Num(3))) == "(2 ^ 3)"
    assert to_expr_text(Un("fact", Num(5))) == "(5)!"
    assert to_expr_text(Un("ln", Num(5))) == "ln(5)"
    # 自身を括弧で包む(I1、fix round 1)。周囲に生の `/` を漏らさない。
    assert to_expr_text(Un("recip", Num(5))) == "(1/(5))"
    # `exp_e` はキーの綴り。人が読む数式では標準的な `exp(...)`(M3)。
    assert to_expr_text(Un("exp_e", Num(5))) == "exp(5)"
    # 逆三角関数は結果が度である。それを式そのものに書く——
    # sin が rad(...) と書いているのと対称。
    assert to_expr_text(Un("asin", Num(1))) == "deg(asin(1))"


def test_recip_does_not_leak_a_bare_slash_into_the_surrounding_expression() -> None:
    # I1 (Task 1 review round 1). `recip` was the only unary that emitted a
    # bare binary operator at top level without wrapping itself, so composing
    # it read as a different expression than it computed:
    #   `(1 / 1/(5))` parses as `(1/1)/5` = 0.2, but the tree's value is 5.
    #   `(2 ^ 1/(5))` parses as `(2^1)/5` = 0.4, but the tree's value is
    #   2^(1/5) ~= 1.1487.
    # Both trees are reachable: `recip` is in ELEMENTARY_FNS, `^` is in
    # ELEMENTARY_BINS, `/` is in the untouched BINARY_OPS.
    assert to_expr_text(Bin("/", Num(1), Un("recip", Num(5)))) == "(1 / (1/(5)))"
    assert to_expr_text(Bin("^", Num(2), Un("recip", Num(5)))) == "(2 ^ (1/(5)))"


def test_a_constant_inside_a_bigger_tree() -> None:
    tree = Bin("*", Const("pi"), Num(2))
    assert to_key_sequence(tree) == ["lparen", "pi", "mul", "2", "rparen", "eq"]
    assert to_expr_text(tree) == "(pi * 2)"


def test_a_constant_is_a_leaf_in_the_minimal_serialization_too() -> None:
    # I2 (Task 1 review round 1). `to_keys_minimal`'s whole `Const` branch
    # was unprotected — deleting it, or just its unknown-name guard, left
    # all tests green. Without it, a `Const` falls through to `node.op` and
    # raises `AttributeError` instead of the module's usual `ValueError`.
    # 3c のシャードは定数を使わないが、この関数自体は Const を渡されたとき
    # 大きな声で扱う契約を持つ。
    assert to_keys_minimal(Const("pi")) == ["pi"]
    with pytest.raises(ValueError, match="unknown constant"):
        to_keys_minimal(Const("tau"))


def test_an_unknown_binary_op_is_loud_not_silent_in_expr_text() -> None:
    # M1 (Task 1 review round 1). `to_keys` and `to_keys_minimal` both raise
    # on an unknown binary op; `to_expr_text` must hold the same line
    # (symmetric with `test_an_unknown_unary_fn_is_loud_not_silent` above).
    with pytest.raises(ValueError, match="unknown binary op"):
        to_expr_text(Bin("%", Num(1), Num(2)))


def test_the_new_family_tuples_hold_exactly_what_they_promise() -> None:
    # M2 (Task 1 review round 1). These five tuples are this task's declared
    # deliverable — Tasks 3-5 draw their random choices from them. Nothing
    # asserted their contents, so removing an element (`recip` from
    # ELEMENTARY_FNS, `atan` from INVERSE_TRIG_FNS, `nCr` from
    # COMBINATORICS_BINS, `e` from CONST_NAMES) stayed green: a key the plan
    # promised would silently never be pressed, and the shard would still
    # look fine.
    assert ELEMENTARY_FNS == ("ln", "log10", "exp_e", "recip")
    assert ELEMENTARY_BINS == ("^",)
    assert INVERSE_TRIG_FNS == ("asin", "acos", "atan")
    assert COMBINATORICS_FNS == ("fact",)
    assert COMBINATORICS_BINS == ("nPr", "nCr")
    assert CONST_NAMES == ("pi", "e")

    # And the cross-check that actually matters: every member must be a key
    # the serializers can look up, so a typo here fails at generation time
    # rather than shipping a corpus that quietly never presses that key.
    for fn in ELEMENTARY_FNS + INVERSE_TRIG_FNS + COMBINATORICS_FNS:
        assert fn in UNARY_KEYS
    for op in ELEMENTARY_BINS + COMBINATORICS_BINS:
        assert op in BINARY_KEYS
    for name in CONST_NAMES:
        assert name in CONST_KEYS
