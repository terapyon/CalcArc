"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import json
import pathlib
import random
import sys

import mpmath as mp

from calcarc_reference.corpus_eval import evaluate
from calcarc_reference.corpus_expr import (
    BINARY_KEYS,
    BINARY_PRECEDENCE,
    DIGIT_KEYS,
    UNARY_KEYS,
    Bin,
    Num,
    Un,
    to_expr_text,
)

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
    トップレベル(どの括弧の外)は `stack` に積まない別変数で持つ——**以前は
    トップレベルの組を `stack` の最初の要素として積んでいた**ため、対応の無い
    `rparen` がその要素まで pop してしまうと、後続の演算子が(`stack[-1]` が
    静かに存在しなくなるのではなく)ただ**次の binary key まで例外が起きない**
    という中途半端な壊れ方をしていた:直後に演算子が続けば `IndexError` で
    騒いで落ちるが、`rparen` の後に演算子が一つも無ければ(`["1","rparen","eq"]`
    のように)何も例外が起きず、`False` を静かに返していた。

    **M1(review round 2)は TypeScript 側だけを直したが、Python 側は直って
    いなかった。** N4(review round 3)が実測で反証: `["1","rparen","eq"]` と
    `["lparen","1","add","2","rparen","rparen","eq"]` はどちらも TypeScript 側は
    例外を投げるのに、この関数は `False` を返していた——`stack.pop()` が
    トップレベルの組を巻き込んで消せてしまうのが原因で、M1 が名指しした
    「壊れた入力を静かに読み違える」形そのものだった。トップレベルを pop
    できない別変数にしたことで、対応の無い `rparen` は**必ず** `stack` が
    空の状態で `pop()` を試みることになり、ここで明示的に例外を投げる。

    **双子について。** この関数は `test_every_precedence_case_actually_drops_a_parenthesis`
    が `precedence-000.json` を生成する側のゲートとして使い、TypeScript の
    `needsPrecedence`(`web/tests/heavy/corpus.ts`)が同じシャードを読んで報告書
    (`web/heavy-report.md`)の件数を出す側として使う。**どちらかを直したら
    両方直すこと。** ただし、二つが一致することはこの規則が正しいことの証拠には
    ならない——深さ規則のバグは、この双子が `scientific-000.json` /
    `equivalence-000.json` / `precedence-000.json` の 3 シャードで完全に一致した
    まま存在した(両方が同じ設計書の同じ誤った規則を実装していたから)。突き合わせは
    由来が独立でなければ何も保証しない。ここを正しいと確認したのは、双子の一致では
    なく、シリアライザの一次原理からの導出と独立な意味論パーサ(review round 2)
    だった。
    """
    from calcarc_reference.corpus_expr import BINARY_KEYS, BINARY_PRECEDENCE

    key_precedence = {BINARY_KEYS[op]: precedence for op, precedence in BINARY_PRECEDENCE.items()}
    top_level: set[int] = set()
    stack: list[set[int]] = []
    closed_groups: list[set[int]] = []
    for key in keys:
        if key == "lparen":
            stack.append(set())
        elif key == "rparen":
            if not stack:
                raise ValueError(
                    f'_needs_precedence: unmatched "rparen" (more rparen than '
                    f"lparen) in {keys!r}."
                )
            closed_groups.append(stack.pop())
        elif key in key_precedence:
            (stack[-1] if stack else top_level).add(key_precedence[key])
    return any(len(group) >= 2 for group in (*closed_groups, top_level, *stack))


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


def test_malformed_rparen_always_raises_not_only_when_an_operator_follows() -> None:
    # **N4 (review round 3).** Before this fix, an unmatched `rparen` raised
    # only *incidentally*, when a binary key happened to follow it (because
    # `stack.pop()` had already silently consumed the top-level group, and the
    # next `stack[-1]` was what actually failed). Two of the four probes the
    # reviewer used returned a quiet `False` instead: an unmatched `rparen`
    # with nothing after it, and an extra `rparen` right after a balanced
    # group. All four must now raise, matching the TypeScript twin
    # (`needsPrecedence`) on every one of them, not just the one probe a prior
    # round happened to name.
    import pytest

    with pytest.raises(ValueError, match='unmatched "rparen"'):
        _needs_precedence(["1", "rparen", "add", "2", "mul", "3", "eq"])
    with pytest.raises(ValueError, match='unmatched "rparen"'):
        _needs_precedence(["1", "rparen", "eq"])
    with pytest.raises(ValueError, match='unmatched "rparen"'):
        _needs_precedence(["lparen", "1", "add", "2", "rparen", "rparen", "eq"])
    with pytest.raises(ValueError, match='unmatched "rparen"'):
        _needs_precedence(["rparen", "1", "add", "2", "mul", "3", "eq"])
    # An *unclosed* `lparen` is not malformed in this sense — the open group
    # is still inspected, matching the TypeScript twin.
    assert _needs_precedence(["lparen", "1", "add", "2", "mul", "3", "eq"]) is True


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


def _parse_with_precedence(keys: list[str], precedence: dict[str, int]) -> object:
    """`keys`(末尾の `eq` を除く)を、与えた優先順位表と左結合で木に戻す。

    **後置単項は優先順位の話ではない。** `1 add 2 sqrt` は `1 + √2` であって
    `√(1 + 2)` ではない——`sqrt` は直前の被演算子(`2`)にだけ掛かる、という
    後置記法そのものの規則で、`precedence` に何を渡しても変わらない。ここを
    誤ると(累積値に後置単項を適用してしまうと)優先順位が要る件数を過大に
    数える。実測でこの誤りを踏んだ経緯があるので、`test_the_postfix_unary_trap`
    が単独でこれを固定する。

    優先順位クライミング法(Pratt parsing)そのもので、推測は無い——`min_prec`
    を跨がない限り右へ結合を伸ばし、越えたら親へ戻る、という教科書どおりの形。
    """
    key_to_op = {v: k for k, v in BINARY_KEYS.items()}

    def parse_atom(pos: int) -> tuple[object, int]:
        token = keys[pos]
        if token == "lparen":
            node, pos = parse_expr(pos + 1, 0)
            assert keys[pos] == "rparen", f"expected rparen at {pos} in {keys}"
            pos += 1
        elif token in DIGIT_KEYS:
            start = pos
            while pos < len(keys) and keys[pos] in DIGIT_KEYS:
                pos += 1
            node = Num(int("".join(keys[start:pos])))
        else:
            raise ValueError(f"unexpected token {token!r} at {pos} in {keys}")
        while pos < len(keys) and keys[pos] in UNARY_KEYS:
            node = Un(UNARY_KEYS[keys[pos]], node)
            pos += 1
        return node, pos

    def parse_expr(pos: int, min_prec: int) -> tuple[object, int]:
        left, pos = parse_atom(pos)
        while pos < len(keys) and keys[pos] in key_to_op and precedence[keys[pos]] >= min_prec:
            op_key = keys[pos]
            pos += 1
            right, pos = parse_expr(pos, precedence[op_key] + 1)
            left = Bin(key_to_op[op_key], left, right)
        return left, pos

    node, pos = parse_expr(0, 0)
    if pos != len(keys):
        raise ValueError(f"trailing tokens after parse: {keys[pos:]} (full: {keys})")
    return node


def test_the_postfix_unary_trap() -> None:
    # **Guard for the exact mistake the reviewer's own evaluator made** (fix
    # round 2, I1): applying a postfix unary to the accumulated value instead
    # of the current operand reads `1 add 2 sqrt` as `√(1 + 2)`. It is `1 + √2`
    # — `sqrt` binds only to the `2` that precedes it, regardless of precedence.
    #
    # **N8 (review round 3), informational.** This test cannot actually fail
    # for `_parse_with_precedence` as written: the mistake it names is not
    # expressible in a recursive precedence-climbing parser that consumes
    # postfix unaries inside `parse_atom` (there confirmed by trying to
    # relocate the unary loop into `parse_expr` — the result was semantically
    # identical). Keep it as executable documentation of the property; the
    # assert that actually is sensitive to this class of mistake is
    # `test_precedence_shard_reports_how_many_cases_change_meaning_without_precedence`'s
    # `changes_meaning == 1101` (verified: a wrong postfix rule gives 1598 on
    # this corpus, and a right-associativity mutation elsewhere in the same
    # parser gives 1131 — both move the number, so it is not inert).
    uniform = {key: 1 for key in BINARY_KEYS.values()}
    tree = _parse_with_precedence(["1", "add", "2", "sqrt"], uniform)
    assert tree == Bin("+", Num(1), Un("sqrt", Num(2)))
    assert tree != Un("sqrt", Bin("+", Num(1), Num(2)))


def test_precedence_shard_reports_how_many_cases_change_meaning_without_precedence() -> None:
    # **Step B of I1 (fix round 2).** R9's `needsPrecedence` proves the engine
    # *consulted* precedence (2000/2000) — it says nothing about whether
    # dropping precedence would have produced a *different* answer. Some drops
    # are left-heavy (`prec-000001`: `(541 / 138) + 748`) and read identically
    # under naive left-to-right parsing. This measures the stronger property
    # exactly: parse each case's own committed `keys` with *no* precedence
    # distinction (all binary operators equal, left-associative, parens and
    # postfix unaries honoured — see `test_the_postfix_unary_trap`) and compare
    # the result, structurally, to a real-precedence parse of the same keys.
    #
    # **Reads `corpus/generated/precedence-000.json` from disk (N3, review
    # round 3).** The first version of this test called
    # `generate_corpus._precedence_candidates(random.Random(20260817), 2000)`
    # directly — a literal copy of `main()`'s seed and count
    # (`generate_corpus.py:335`) that regenerated trees in memory and never
    # touched the committed file. Measured: change the generator's seed and
    # `test_corpus_reproducibility.py` correctly reddens (the committed shard
    # no longer matches a fresh generation) — but the old version of this test
    # stayed green, still asserting 1101 against a stream the committed shard
    # no longer came from. After someone regenerates the shard to clear the
    # reproducibility gate, the "1101" claim this test backs (and that
    # `web/heavy-report.md` prints) could be false with nothing saying so.
    #
    # Fixed by never regenerating: read the committed shard, and get "ground
    # truth" the same way the external reviewer who independently confirmed
    # 1101 did — parse each case's own `keys` with the engine's *real*
    # precedence table, then confirm that reparse round-trips back to the
    # committed `expr` string via `to_expr_text`. If the real-precedence parse
    # did not recover the tree `to_keys_minimal` was built from, it would not
    # render back to the same `expr`; checking every case's round-trip is the
    # ground-truth self-check, not an assumption. Only then is the same keys
    # list parsed a second time with *no* precedence distinction and compared,
    # structurally, to the ground-truth tree.
    with (_CORPUS_GENERATED / "precedence-000.json").open(encoding="utf-8") as f:
        shard = json.load(f)
    cases = shard["cases"]
    assert len(cases) > 0, "precedence-000.json carries no cases to check"

    real = {BINARY_KEYS[op]: prec for op, prec in BINARY_PRECEDENCE.items()}
    uniform = {key: 1 for key in BINARY_KEYS.values()}

    round_trip_mismatches: list[str] = []
    changes_meaning = 0
    for case in cases:
        keys = case["keys"][:-1]  # drop the trailing "eq"
        ground_truth = _parse_with_precedence(keys, real)
        if to_expr_text(ground_truth) != case["expr"]:
            round_trip_mismatches.append(case["id"])
            continue
        reparsed = _parse_with_precedence(keys, uniform)
        if reparsed != ground_truth:
            changes_meaning += 1

    # The ground-truth self-check must hold for every case, or the count below
    # is measured against a broken ground truth rather than the real one.
    assert round_trip_mismatches == [], (
        f"{len(round_trip_mismatches)} case(s) did not round-trip through "
        f"_parse_with_precedence with the real table: {round_trip_mismatches[:5]}"
    )
    assert len(cases) == 2000
    assert changes_meaning == 1101


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
