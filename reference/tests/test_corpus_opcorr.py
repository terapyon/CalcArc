"""公開の優先順位で鎖を木に組む(設計書 2026-09-16-operator-correction-shard Task 1)。

アンカー値は task-1-brief.md にある手計算の値。`evaluate()` を通して比較する
——このテストは木の形ではなく、木を評価した値が公開の約束と一致することを見る。
"""

from calcarc_reference.corpus_eval import evaluate
from calcarc_reference.corpus_opcorr import (
    LEVEL,
    RIGHT_ASSOCIATIVE,
    Group,
    build_tree,
    chain_keys,
)


def _value(terms: tuple, ops: tuple[str, ...], override: dict[int, str] | None = None) -> object:
    return evaluate(build_tree(terms, ops, override))


# --- R2: 訂正前の読み（最初に押した誤りの演算子の段・結合で読む） ---


def test_correction_anchor_8_minus_3_times_plus_2() -> None:
    # 8 − 3 × + 2: 押下は - のあと × を押し、+ で訂正した。
    terms = (8, 3, 2)
    ops = ("-", "+")
    assert _value(terms, ops) == 7
    # 訂正前は位置 1 を * の段(2)・左結合で読む。
    assert _value(terms, ops, {1: "*"}) == 3


def test_correction_anchor_3_minus_3_div_minus_3() -> None:
    # 3 − 3 ÷ − 3: 押下は - のあと ÷ を押し、- で訂正した。
    terms = (3, 3, 3)
    ops = ("-", "-")
    assert _value(terms, ops) == -3
    # 訂正前は位置 1 を ÷ の段(2)・左結合で読む。
    assert _value(terms, ops, {1: "/"}) == 3


def test_correction_anchor_8_div_2_pow_times_2() -> None:
    # 8 ÷ 2 xʸ × 2: 押下は ÷ のあと ^ を押し、× で訂正した。
    terms = (8, 2, 2)
    ops = ("/", "*")
    assert _value(terms, ops) == 8
    # 訂正前は位置 1 を ^ の段(4)・右結合で読む。
    assert _value(terms, ops, {1: "^"}) == 2


def test_correction_anchor_2_plus_3_plus_times_4() -> None:
    # 2 + 3 + × 4: 押下は + のあと + を押し(同じ)、× で訂正した。
    terms = (2, 3, 4)
    ops = ("+", "*")
    assert _value(terms, ops) == 14
    # 訂正前は位置 1 を + の段(1)・左結合で読む。
    assert _value(terms, ops, {1: "+"}) == 20


# --- 結合(すべて同じ段の 2 連鎖) ---


def test_associativity_pow_is_right_associative() -> None:
    assert _value((2, 3, 2), ("^", "^")) == 512


def test_associativity_minus_is_left_associative() -> None:
    assert _value((8, 3, 2), ("-", "-")) == 3


def test_associativity_div_is_left_associative() -> None:
    assert _value((12, 3, 2), ("/", "/")) == 2


def test_associativity_npr_ncr_is_left_associative() -> None:
    assert _value((5, 2, 2), ("nPr", "nCr")) == 190


# --- 混在(段が異なる 2 連鎖と括弧) ---


def test_mixed_add_then_mul_climbs_to_mul_first() -> None:
    assert _value((2, 3, 4), ("+", "*")) == 14


def test_mixed_mul_then_pow_climbs_to_pow_first() -> None:
    assert _value((2, 3, 2), ("*", "^")) == 18


def test_mixed_mul_then_ncr_climbs_to_ncr_first() -> None:
    assert _value((2, 5, 2), ("*", "nCr")) == 20


def test_group_is_parenthesised() -> None:
    group = Group(terms=(2, 3), ops=("+",))
    assert _value((group, 4), ("*",)) == 20


# --- 公開の表そのもの ---


def test_level_matches_the_documented_table() -> None:
    assert LEVEL == {"+": 1, "-": 1, "*": 2, "/": 2, "nPr": 3, "nCr": 3, "^": 4}


def test_only_pow_is_right_associative() -> None:
    assert frozenset({"^"}) == RIGHT_ASSOCIATIVE


# --- chain_keys: 括弧は Group の場所だけに付く ---


def test_chain_keys_has_no_parens_without_a_group() -> None:
    assert chain_keys((2, 3, 4), ("+", "*")) == ["2", "add", "3", "mul", "4"]


def test_chain_keys_parenthesises_only_the_group() -> None:
    group = Group(terms=(2, 3), ops=("+",))
    assert chain_keys((group, 4), ("*",)) == [
        "lparen",
        "2",
        "add",
        "3",
        "rparen",
        "mul",
        "4",
    ]
