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


def _value(
    terms: tuple, ops: tuple[str, ...], override: dict[tuple[int, ...], str] | None = None
) -> object:
    return evaluate(build_tree(terms, ops, override))


# --- R2: 訂正前の読み（最初に押した誤りの演算子の段・結合で読む） ---


def test_correction_anchor_8_minus_3_times_plus_2() -> None:
    # 8 − 3 × + 2: 押下は - のあと × を押し、+ で訂正した。
    terms = (8, 3, 2)
    ops = ("-", "+")
    assert _value(terms, ops) == 7
    # 訂正前は位置 1 を * の段(2)・左結合で読む。
    assert _value(terms, ops, {(1,): "*"}) == 3


def test_correction_anchor_3_minus_3_div_minus_3() -> None:
    # 3 − 3 ÷ − 3: 押下は - のあと ÷ を押し、- で訂正した。
    terms = (3, 3, 3)
    ops = ("-", "-")
    assert _value(terms, ops) == -3
    # 訂正前は位置 1 を ÷ の段(2)・左結合で読む。
    assert _value(terms, ops, {(1,): "/"}) == 3


def test_correction_anchor_8_div_2_pow_times_2() -> None:
    # 8 ÷ 2 xʸ × 2: 押下は ÷ のあと ^ を押し、× で訂正した。
    terms = (8, 2, 2)
    ops = ("/", "*")
    assert _value(terms, ops) == 8
    # 訂正前は位置 1 を ^ の段(4)・右結合で読む。
    assert _value(terms, ops, {(1,): "^"}) == 2


def test_correction_anchor_2_plus_3_plus_times_4() -> None:
    # 2 + 3 + × 4: 押下は + のあと + を押し(同じ)、× で訂正した。
    terms = (2, 3, 4)
    ops = ("+", "*")
    assert _value(terms, ops) == 14
    # 訂正前は位置 1 を + の段(1)・左結合で読む。
    assert _value(terms, ops, {(1,): "+"}) == 20


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


# --- R2 のパス: override が Group の中まで届く(fix round 1) ---


def test_correction_anchor_inside_parens() -> None:
    # 2 × (8 − 3 × + 2): 括弧の中は test_correction_anchor_8_minus_3_times_plus_2
    # と同じ鎖(8 − 3 × + 2)。訂正前の読みは、その中の位置 1 を
    # * の段(2)・左結合で読む——外側の 2 × ... の * ではなく、
    # 括弧の中で実際に最初に押された演算子(段はたまたま同じ * だが、
    # 別の押下)である。パスは (1, 1): 外側の項 1(Group)へ降り、
    # その鎖の演算子 1 を訂正前の段で読む。
    inner = Group(terms=(8, 3, 2), ops=("-", "+"))
    terms = (2, inner)
    ops = ("*",)
    assert _value(terms, ops) == 14
    assert _value(terms, ops, {(1, 1): "*"}) == 6


def test_correction_anchor_operator_right_after_a_closed_group() -> None:
    # (1 + 1) × + 3 × 4: 括弧を閉じた直後の演算子(位置 0、Group のすぐ後ろ)
    # が訂正されている——押下は × のあと + で訂正した。
    # 正しい読み: 2 + (3 × 4) = 14。
    # 訂正前の読み: 位置 0 を × の段(2)・左結合で読むと、次の演算子
    # (位置 1、実演算子 ×、段 2)を右辺に取り込めず (2 × ...) が先に閉じる
    # のではなく、逆に外側の + がすぐに畳まれて (2 + 3) が先に組まれ、
    # その後ろに × 4 が掛かる: (2 + 3) × 4 = 20。
    # うち value 2 は Group((1, 1), ("+",)) から来る——「括弧を閉じた
    # 直後の演算子」という状況そのものをアンカーにするための足場で、
    # 訂正の対象は位置 0 であって Group の中身ではない。
    group = Group(terms=(1, 1), ops=("+",))
    terms = (group, 3, 4)
    ops = ("+", "*")
    assert _value(terms, ops) == 14
    assert _value(terms, ops, {(0,): "*"}) == 20


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
