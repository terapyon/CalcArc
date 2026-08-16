"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import json
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

_CORPUS_GENERATED = pathlib.Path(__file__).resolve().parents[2] / "corpus" / "generated"


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


def _needs_precedence(keys: list[str]) -> bool:
    """同じ括弧の**組**の中に、優先順位の異なる二項演算子が 2 つ以上あるか。

    **括弧が省かれたことの観測可能な痕跡である。** 省くのは子の優先順位が親より
    真に大きいときだけなので、省いた結果は必ず「同じ組に異なる優先順位」になる。
    単項の子は決して省かないので、この判定に漏れは無い。

    **「組」であって「深さ」ではない。** 初版は「同じ括弧の深さ」で判定していたが、
    それは誤りだった——深さが同じでも別々の括弧の中なら、その 2 つの演算子は
    同じ式に並んでいない。実測した反例(`scientific-000.json` の `sci-000025`、
    `377 - ((553 / 982) / (189 - 996))`):`div` と `sub` はどちらも深さ 3 だが、
    `(553/982)` と `(189-996)` という**別の組**である。構造は括弧が完全に決めており、
    優先順位は一切要らない。深さで数えると、全二項を括弧で囲んでいる既存シャードから
    311 件の偽陽性が出た(`scientific` 191 件 + `equivalence` 4000 キー列中 120 件)。
    組で数えるとどちらも 0 件になる(設計書 §3.4)。TypeScript の双子
    (`web/tests/heavy/corpus.ts` の `needsPrecedence`)も同じ理由で同じ形に直した。

    実装は `lparen` で新しい組をスタックに push し、`rparen` で pop して確定させる。
    トップレベル(どの括弧の外)も 1 つの組として扱う。
    """
    from calcarc_reference.corpus_expr import BINARY_KEYS, BINARY_PRECEDENCE

    key_precedence = {BINARY_KEYS[op]: precedence for op, precedence in BINARY_PRECEDENCE.items()}
    stack: list[set[int]] = [set()]
    closed_groups: list[set[int]] = []
    for key in keys:
        if key == "lparen":
            stack.append(set())
        elif key == "rparen":
            closed_groups.append(stack.pop())
        elif key in key_precedence:
            stack[-1].add(key_precedence[key])
    return any(len(group) >= 2 for group in (*closed_groups, *stack))


def test_every_precedence_case_actually_drops_a_parenthesis() -> None:
    # 省くものが無い木を入れると、キー列が既存シャードと同一になり、
    # **新しいことを何も試さないケース**が混ざる(設計書 §3.3)。
    shard = generate_corpus.build_precedence_shard(seed=11, count=200)
    assert len(shard["cases"]) == 200
    for case in shard["cases"]:
        assert _needs_precedence(case["keys"]), (
            f"{case['id']} は括弧を 1 つも省いていない: {case['expr']}"
        )


def test_the_helper_itself_distinguishes_the_two_forms() -> None:
    # 上の判定が「常に真」を返す壊れ方をしていないことを固定する。
    assert _needs_precedence(["1", "add", "2", "mul", "3", "eq"]) is True
    assert _needs_precedence(["lparen", "1", "add", "2", "rparen", "mul", "3", "eq"]) is False
    assert _needs_precedence(["1", "add", "2", "eq"]) is False


def test_operators_in_different_parenthesis_groups_at_the_same_depth_do_not_need_precedence() -> None:
    # **Regression for the depth-based bug (fix round 1).** `div` と `sub` は
    # `377 - ((553 / 982) / (189 - 996))` でどちらも括弧の深さ 3 にあるが、
    # `(553 / 982)` と `(189 - 996)` という**別の組**である。深さだけで判定すると
    # ここが誤って真になり、`scientific-000.json` 単体で 191 件の偽陽性を出した。
    # 手で作らず、コミット済みの実シャードから該当ケースを読んで確かめる。
    with (_CORPUS_GENERATED / "scientific-000.json").open(encoding="utf-8") as f:
        shard = json.load(f)
    case = next(c for c in shard["cases"] if c["id"] == "sci-000025")
    assert case["expr"] == "(377 - ((553 / 982) / (189 - 996)))"
    assert _needs_precedence(case["keys"]) is False


def test_the_precedence_shard_is_deterministic() -> None:
    assert generate_corpus.build_precedence_shard(
        seed=12, count=50
    ) == generate_corpus.build_precedence_shard(seed=12, count=50)


def test_precedence_cases_are_value_cases_with_both_notations() -> None:
    shard = generate_corpus.build_precedence_shard(seed=13, count=50)
    for case in shard["cases"]:
        assert case["kind"] == "value"
        assert case["expr"]
        assert "re" in case["expect"]


def test_precedence_ids_are_unique() -> None:
    shard = generate_corpus.build_precedence_shard(seed=14, count=200)
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)


def test_the_precedence_envelope_matches_the_existing_convention() -> None:
    shard = generate_corpus.build_precedence_shard(seed=15, count=10)
    assert shard["schema"] == 1
    assert set(shard["tolerance"]) == {"abs", "rel"}
