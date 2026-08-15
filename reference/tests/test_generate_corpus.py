"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import pathlib
import random
import sys

import mpmath as mp

from calcarc_reference.corpus_eval import evaluate
from calcarc_reference.corpus_expr import Num, Un

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_corpus.py"
_SPEC = importlib.util.spec_from_file_location("generate_corpus", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
generate_corpus = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_corpus"] = generate_corpus
_SPEC.loader.exec_module(generate_corpus)


def test_the_same_seed_gives_the_same_shard() -> None:
    # 固定コーパスの土台。ここが崩れると「通った」の意味が毎回変わる。
    first = generate_corpus.build_shard(seed=1, count=20)
    second = generate_corpus.build_shard(seed=1, count=20)
    assert first == second


def test_a_different_seed_gives_a_different_shard() -> None:
    first = generate_corpus.build_shard(seed=1, count=20)
    second = generate_corpus.build_shard(seed=2, count=20)
    assert first != second


def test_ids_are_unique() -> None:
    shard = generate_corpus.build_shard(seed=3, count=200)
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)


def test_every_case_carries_both_notations() -> None:
    shard = generate_corpus.build_shard(seed=4, count=50)
    for case in shard["cases"]:
        assert case["kind"] == "value"
        assert case["keys"]
        assert case["expr"]
        assert "re" in case["expect"]


def test_every_value_stays_inside_the_plain_display_range() -> None:
    # 指数表記の解釈は段階 3 に送った。生成器がその範囲に踏み込まないこと。
    shard = generate_corpus.build_shard(seed=5, count=200)
    for case in shard["cases"]:
        magnitude = abs(mp.mpf(case["expect"]["re"]))
        assert magnitude == 0 or generate_corpus.MIN_ABS <= magnitude <= generate_corpus.MAX_ABS


def test_the_envelope_matches_the_existing_golden_convention() -> None:
    shard = generate_corpus.build_shard(seed=6, count=10)
    assert shard["schema"] == 1
    assert set(shard["tolerance"]) == {"abs", "rel"}


def test_the_provenance_names_only_what_actually_produced_the_values() -> None:
    # この生成器は corpus_eval.py の mpmath だけで評価しており、SymPy は値に
    # 一切触れていない。信頼を目的とした文書で、関与していない依存の版を
    # 素性に書くのは不正確である(レビュー修正ラウンド 2)。
    provenance = generate_corpus._provenance()
    assert "mpmath" in provenance
    assert "dps" in provenance
    assert "sympy" not in provenance.lower()


def test_every_case_performs_at_least_one_operation() -> None:
    # 裸のリテラル(`769 => 769.0`)は「押した桁が返る」ことしか確かめない。それは
    # engine_table.rs が既に仕様として持っている領域で、この重量級コーパスの
    # 仕事ではない(レビュー修正ラウンド 1)。線は「演算子か関数が 1 つ以上あるか」で、
    # `Un("neg", Num(5))` のような単項 1 つだけのケースは残す — `neg` キーを
    # 実際に叩いているので。
    shard = generate_corpus.build_shard(seed=7, count=200)
    for case in shard["cases"]:
        assert not case["expr"].lstrip("-").isdigit(), case["expr"]


def test_equivalence_cases_carry_two_sequences_and_no_expected_value() -> None:
    shard = generate_corpus.build_equivalences(seed=7, count=30)
    for case in shard["cases"]:
        assert case["kind"] == "equivalence"
        assert case["left"] and case["right"]
        assert "expect" not in case


def test_the_two_sides_are_never_the_same_keys() -> None:
    # 両辺が同じ経路に落ちると常に緑になる(設計書 §11)。生成器が
    # 自明な対を出さないことを、生成器自身のテストで見る。
    shard = generate_corpus.build_equivalences(seed=8, count=100)
    for case in shard["cases"]:
        assert case["left"] != case["right"]


def test_equivalences_are_deterministic() -> None:
    assert generate_corpus.build_equivalences(
        seed=9, count=20
    ) == generate_corpus.build_equivalences(seed=9, count=20)


def _is_bare_literal(keys: list[str]) -> bool:
    """キー列が数字と `=` だけでできているか。演算子も関数も括弧も無い形。"""
    return all(key.isdigit() or key == "eq" for key in keys)


def test_no_equivalence_pair_has_a_bare_literal_on_the_left() -> None:
    # `85 =` と `(85 + 0) =` が同じ表示に着くことを 3 桁の整数に対して何百回
    # 主張しても、「押した桁が返る」以上のことは何も言っていない。build_shard が
    # ラウンド 1 で同じ理由により棄却したのと同じ線を、同値側にも引く
    # (レビュー修正ラウンド 2)。
    shard = generate_corpus.build_equivalences(seed=10, count=200)
    for case in shard["cases"]:
        assert not _is_bare_literal(case["left"]), case["left"]


def test_the_same_pair_is_never_asserted_twice() -> None:
    # 同じ対を二度主張しても件数が増えるだけで、確かめたことは増えない。
    shard = generate_corpus.build_equivalences(seed=11, count=300)
    pairs = [(tuple(case["left"]), tuple(case["right"])) for case in shard["cases"]]
    assert len(set(pairs)) == len(pairs)


def test_negative_values_are_kept_for_the_pairs_that_survive_them() -> None:
    # `neg(neg(x))` と `x + 0` は負の x でも成り立つ。負の値を丸ごと捨てると
    # 同値シャードが負数を一切通らなくなる(レビュー修正ラウンド 2)。
    # キー列からは値が読めないので、生成器と同じ helper を同じ順で引いて見る。
    rng = random.Random(20260816)
    values = []
    for _ in range(2000):
        candidate = generate_corpus._equivalence_candidate(rng)
        if candidate is not None:
            values.append(candidate[2])
    assert any(value < 0 for value in values), "負の値が一つも残っていない"


def test_the_square_root_round_trip_is_the_only_form_that_needs_a_non_negative() -> None:
    # 負の x で √(x²) だけが戻らない(√((-5)²) = 5)。他の二つは戻る。
    node = Un("neg", Num(5))
    assert evaluate(node) == -5
    for which in (1, 2):
        left, right = generate_corpus._equivalent_pair(which, node)
        assert evaluate(left) == evaluate(right) == -5
    _, squared = generate_corpus._equivalent_pair(generate_corpus.SQRT_ROUND_TRIP, node)
    assert evaluate(squared) == 5
