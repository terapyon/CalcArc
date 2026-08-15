"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import pathlib
import sys

import mpmath as mp

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
    assert "sympy" in shard["generated_by"]
    assert set(shard["tolerance"]) == {"abs", "rel"}


def test_every_case_performs_at_least_one_operation() -> None:
    # 裸のリテラル(`769 => 769.0`)は「押した桁が返る」ことしか確かめない。それは
    # engine_table.rs が既に仕様として持っている領域で、この重量級コーパスの
    # 仕事ではない(レビュー修正ラウンド 1)。線は「演算子か関数が 1 つ以上あるか」で、
    # `Un("neg", Num(5))` のような単項 1 つだけのケースは残す — `neg` キーを
    # 実際に叩いているので。
    shard = generate_corpus.build_shard(seed=7, count=200)
    for case in shard["cases"]:
        assert not case["expr"].lstrip("-").isdigit(), case["expr"]
