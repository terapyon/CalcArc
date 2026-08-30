"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import collections
import importlib.util
import json
import math
import pathlib
import random
import re
import sys
from fractions import Fraction

import mpmath as mp
import pytest

from calcarc_reference import corpus_calls, corpus_coverage, loan_ref
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
    空の状態で現れることになり、`pop()` に入る前の `if not stack` で
    明示的に例外を投げる(以前は空の `stack` を `pop()` しようとして
    `IndexError` になる、という偶然に頼っていた)。

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
    # **最後の `ac` より前は読まない。** `ac` は engine を初期状態に戻す
    # (`engine/mod.rs` の `reduce` 冒頭、`next = next.cleared()`)ので、
    # そこより前の括弧も演算子も、この列が最後に何を計算したかとは無関係。
    # TypeScript の双子(`needsPrecedence`)も同じ形に直してある。
    tail = keys[len(keys) - keys[::-1].index("ac") :] if "ac" in keys else keys
    for key in tail:
        if key == "lparen":
            stack.append(set())
        elif key == "rparen":
            if not stack:
                raise ValueError(
                    f'_needs_precedence: unmatched "rparen" (more rparen than lparen) in {keys!r}.'
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
    #
    # **These four are one guard, not four (fix round 4).** All four pin the
    # same single `raise` in `_needs_precedence`; deleting it reddens all four
    # at once, and no edit reddens one alone. They are kept as *shape*
    # coverage — the round-3 review found that two of these shapes (a trailing
    # unmatched `rparen`, and an extra `rparen` after a balanced group) used to
    # return a quiet `False` while the other two raised, so a future rewrite
    # that reintroduces a shape-dependent path is what the extra three catch.
    # Do not count them as independent guards.
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


def test_operators_in_different_parenthesis_groups_at_the_same_depth_do_not_need_precedence() -> (
    None
):
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
    # UNARY_KEYS は木の名前→キーの綴り。`fact` → `n_fact` で両者が食い違う
    # 唯一の項目なので、キー列から木を戻すにはここも BINARY_KEYS と同じく
    # 反転させる必要がある(name == token が偶然成り立っていた6件だけでは
    # 済まなくなった)。
    key_to_fn = {v: k for k, v in UNARY_KEYS.items()}

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
        while pos < len(keys) and keys[pos] in key_to_fn:
            node = Un(key_to_fn[keys[pos]], node)
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


def test_the_parser_inverts_unary_keys_not_just_binary_keys() -> None:
    # **F1 (Task 1 review round 1).** `UNARY_KEYS` maps tree name -> key
    # token. Indexing it directly with a key token (`UNARY_KEYS[keys[pos]]`)
    # was only ever correct because `name == token` held for the six original
    # unaries. `fact` -> `n_fact` breaks that coincidence: a `n_fact` token
    # in `keys` is not itself a valid tree-name lookup. This pins the fix
    # (inverting `UNARY_KEYS` the same way `key_to_op` inverts `BINARY_KEYS`
    # at line 313) using the one name where the coincidence does not hold.
    uniform = {key: 1 for key in BINARY_KEYS.values()}
    tree = _parse_with_precedence(["5", "n_fact"], uniform)
    assert tree == Un("fact", Num(5))


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
    # round 3).** The first version of this test re-ran the generator's own
    # loop in memory — with a literal copy of `main()`'s seed and count
    # (`generate_corpus.py`'s `build_precedence_shard(seed=20260817,
    # count=2000)`) — and never touched the committed file. Measured: change
    # the generator's seed and
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
    #
    # **`assert len(cases) > 0` used to stand here and was removed (fix round
    # 4).** It cannot fail in any state where `len(cases) == 2000` below
    # passes, so it constrained nothing; the round-3 review could not construct
    # an input that reddened it alone.
    with (_CORPUS_GENERATED / "precedence-000.json").open(encoding="utf-8") as f:
        shard = json.load(f)
    cases = shard["cases"]

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


def test_the_elementary_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    # 設計書 §3.1 が約束した 5 演算 + 定数 2 つ。
    for token in ("ln", "log10", "exp_e", "recip", "pow", "pi", "e"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_the_elementary_shard_records_why_it_threw_candidates_away() -> None:
    shard = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    rejections = shard["rejections"]
    # **理由ごとに数えていることが要件**(設計書 R9)。E の設計の入力になる。
    assert set(rejections) == {
        "bare",
        "domain",
        "division_by_zero",
        "overflow",
        "out_of_range",
        "dup",
    }
    assert sum(rejections.values()) > 0, "1 件も捨てていないのは疑わしい"


def test_every_elementary_case_lands_in_the_flat_display_band() -> None:
    # このシャードは既存の帯を使う(設計書 §3.2.1)。組合せ論だけが別。
    shard = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    for case in shard["cases"]:
        value = abs(case["expect"]["re"])
        assert value == 0 or 1e-6 <= value <= 1e9, case["id"]


def test_no_elementary_case_is_a_bare_literal_or_a_bare_constant() -> None:
    """裸のリテラルも裸の定数も、押した桁(あるいは定数)がそのまま返ることしか
    確かめない。`pi` を押すと 3.141592654 が出ることは engine_table.rs の領域である。

    **長さで判定してはいけない**——`5 0 0 eq` は 4 打鍵だが裸である。
    演算子か関数のトークンを 1 つ以上含むことを直接主張する。

    このテストを赤くする編集: build_family_shard の `isinstance(node, (Num, Const))`
    を `isinstance(node, Num)` に狭める(裸の定数が混ざるようになる)。
    """
    operators = {
        "add",
        "sub",
        "mul",
        "div",
        "pow",
        "ln",
        "log10",
        "exp_e",
        "recip",
        "sqrt",
        "sqr",
        "sin",
        "cos",
        "tan",
        "neg",
        "asin",
        "acos",
        "atan",
        "n_fact",
        "n_p_r",
        "n_c_r",
    }
    shard = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    for case in shard["cases"]:
        assert operators & set(case["keys"]), f"{case['id']} は裸: {case['keys']}"


def test_the_elementary_shard_actually_presses_the_constants() -> None:
    # 定数が 1 件も出ないと、`const_prob` が効いていないのに緑になる。
    shard = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    with_const = [c for c in shard["cases"] if "pi" in c["keys"] or "e" in c["keys"]]
    assert len(with_const) > 50, f"定数を含むケースが {len(with_const)} 件しかない"


def test_subtrees_are_yielded_leaves_first_not_root_first() -> None:
    """`_within_range` が `walk`(根が先)ではなく `_subtrees_leaves_first`
    (葉が先)を使うことを、順序そのもので固定する。

    `^` の入れ子(`999^(999^999)`)は根から評価すると最も高価な式を最初に
    評価してしまい、実測で 2.239 秒かかった。葉から見れば、既に範囲外の
    部分木(`999^999`)が先に見つかり、根そのものを評価せずに打ち切れる
    (実測 0.000 秒)。タイミングは脆いので、ここは構造だけを主張する:
    根が最後に、葉が最初に来ること。

    このテストを赤くする編集: `_subtrees_leaves_first` の再帰を「まず
    `yield node` してから子を再帰する」に変える(root-first に戻す)。
    """
    killer = Bin("^", Num(999), Bin("^", Num(999), Num(999)))
    order = list(generate_corpus._subtrees_leaves_first(killer))
    assert order[0] == Num(999), "先頭が葉ではない"
    assert order[-1] is killer, "末尾が根そのものではない"
    # 内側の Bin(^, 999, 999) も、自分の 2 枚の葉より後、外側の根より前。
    inner = killer.right
    assert order.index(inner) > order.index(order[0])
    assert order.index(inner) < order.index(killer)


def test_every_out_of_shard_message_is_classified() -> None:
    """`corpus_eval` が投げる文言と、生成器の分類が食い違わないこと。

    **ここは reference/src/calcarc_reference/corpus_eval.py を実際に読んで
    数え上げた列挙である。** ブリーフの下書きは `factorial`/`nPr`/`nCr` が
    共有する `_as_non_negative_integer` の "of a non-finite number" 分岐と、
    `nPr` の "of a non-integer" / "with r greater than n" を数え落としていた
    (`nCr` 側は挙げていたのに `nPr` 側は挙げていなかった、という非対称も
    あった)。全部 `domain` に落ちるので分類そのものにバグは無いが、
    数え落としたまま固定すると「将来 `division_by_zero` に化けても気付かない」
    穴になるので、ここで実装から数え直して埋める。

    このテストを赤くする編集: corpus_eval.py の "reciprocal of zero" を
    "one over zero" に変える(分類が domain に落ちる)。
    """
    division = [
        "division by zero",
        "reciprocal of zero",
    ]
    domain = [
        "sqrt of a negative number",
        "ln of a non-positive number",
        "log10 of a non-positive number",
        "asin outside [-1, 1]",
        "acos outside [-1, 1]",
        "factorial of a non-finite number",
        "factorial of a negative number",
        "factorial of a non-integer",
        "nPr of a non-finite number",
        "nPr of a negative number",
        "nPr of a non-integer",
        "nPr with r greater than n",
        "nCr of a non-finite number",
        "nCr of a negative number",
        "nCr of a non-integer",
        "nCr with r greater than n",
        "zero to a negative power",
        "negative base with a non-integer exponent",
    ]
    for message in division:
        assert generate_corpus._classify_out_of_shard(message) == "division_by_zero"
    for message in domain:
        assert generate_corpus._classify_out_of_shard(message) == "domain"


def test_the_inverse_trig_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((_CORPUS_GENERATED / "inverse-trig-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    for token in ("asin", "acos", "atan"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_inverse_trig_answers_are_angles_in_degrees() -> None:
    """`asin` / `acos` / `atan` の結果は度である(設計書 §3.3)。

    **ラジアンで持つと必ず落ちる。** ラジアンなら絶対値は π 以下、つまり
    3.15 未満に収まる。度なら 90 や 180 に届く。

    このテストを赤くする編集: `corpus_eval.py` の `_degrees` を恒等関数にする。
    """
    shard = json.loads((_CORPUS_GENERATED / "inverse-trig-000.json").read_text())
    singles = [
        c
        for c in shard["cases"]
        if len(c["keys"]) >= 2 and c["keys"][-2] in ("asin", "acos", "atan")
    ]
    assert len(singles) > 100, f"逆三角関数で終わるケースが {len(singles)} 件しかない"
    biggest = max(abs(c["expect"]["re"]) for c in singles)
    assert biggest > 3.15, (
        f"逆三角関数の答の最大値が {biggest} しかない。"
        "ラジアンのまま持っている疑いがある(度なら 90 や 180 に届く)"
    )


def test_the_inverse_trig_shard_records_why_it_threw_candidates_away() -> None:
    """棄却の内訳が `elementary` と同じ形で取れていること。

    **この系統は `domain` が主要因になる。** 葉は 0〜999 の整数だが
    `asin`/`acos` の定義域は `[-1, 1]` なので、大半がそこで落ちる。
    """
    shard = json.loads((_CORPUS_GENERATED / "inverse-trig-000.json").read_text())
    rejections = shard["rejections"]
    elementary = json.loads((_CORPUS_GENERATED / "elementary-000.json").read_text())
    assert set(rejections) == set(elementary["rejections"])
    assert rejections["domain"] > 0, "定義域による棄却が 0 件"
    assert rejections["domain"] > rejections["out_of_range"], (
        "定義域より範囲外のほうが多い。asin/acos の [-1,1] が効いていない疑い"
    )


def test_the_combinatorics_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((_CORPUS_GENERATED / "combinatorics-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    for token in ("n_fact", "n_p_r", "n_c_r"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_the_combinatorics_shard_reaches_past_the_flat_display_band() -> None:
    """**この系統をやる目的そのもの**(設計書 §3.2.1)。

    既存の帯(`1e9`)に閉じ込めると `C(50,25) ≈ 1.26e14` すら入らず、
    大きな桁のケースが一件も出ない。ここは指数表記の表示を読む唯一の経路でもある。

    このテストを赤くする編集: `build_combinatorics_shard` の受理条件に
    `_within_range(node)` を足す。
    """
    shard = json.loads((_CORPUS_GENERATED / "combinatorics-000.json").read_text())
    big = [c for c in shard["cases"] if abs(c["expect"]["re"]) > 1e9]
    assert len(big) > 100, f"1e9 を超えるケースが {len(big)} 件しかない"
    huge = [c for c in shard["cases"] if abs(c["expect"]["re"]) > 1e100]
    assert len(huge) > 0, "1e100 を超えるケースが 1 件も無い"


def test_every_combinatorics_answer_fits_in_f64() -> None:
    """`inf` や `NaN` が期待値に混ざっていないこと。

    mpmath は溢れても例外を投げず `inf` に飽和するので、`float()` の
    `OverflowError` に頼ると `inf` がそのままコーパスに載る。
    """
    shard = json.loads((_CORPUS_GENERATED / "combinatorics-000.json").read_text())
    for case in shard["cases"]:
        value = case["expect"]["re"]
        assert not math.isnan(value), f"{case['id']} が NaN"
        assert not math.isinf(value), f"{case['id']} が inf"


def test_the_combinatorics_shard_records_why_it_threw_candidates_away() -> None:
    """**溢れの実測はこの系統からしか取れない。**

    `elementary` は帯(`1e9`)が f64 の上限よりはるかに手前なので、
    溢れる前に `out_of_range` が捕まえてしまい `overflow` が 0 件になる。
    """
    shard = json.loads((_CORPUS_GENERATED / "combinatorics-000.json").read_text())
    rejections = shard["rejections"]
    assert rejections["overflow"] > 0, (
        "溢れで捨てたケースが 0 件。n の上限が低すぎて f64 の天井に届いていない"
    )
    assert rejections["domain"] > 0, "r > n の棄却が 0 件"


def _typed_text_of(keys: list[str]) -> str:
    """キー列の先頭の「打った数」を十進の文字列に戻す。`eq` の手前まで。

    **数字以外のキーも全部扱う。** 最初の版は `dot` だけを戻していて、
    `zeros3` を打ったケースで `'241zeros3'` という文字列を作り `float()` が
    落ちた——**キーを取りこぼしても、落ちるまでは静かに間違った文字列**を
    返すので、ここは網羅する。知らないキーは黙って通さず例外にする。
    """
    text = ""
    for key in keys[: keys.index("eq")]:
        if key.isdigit():
            text += key
        elif key == "dot":
            text += "."
        elif key == "zeros3":
            text += "000"
        elif key == "exp":
            text += "e"
        elif key == "neg":
            # 指数入力の途中の `+/-` は**指数の符号**を変える(engine の慣行)。
            head, _, exponent = text.partition("e")
            text = f"{head}e-{exponent}"
        else:
            raise AssertionError(f"打った数のキー列に未知のキー {key!r} がある")
    return text


def _is_bare_typed_number(keys: list[str]) -> bool:
    """`=` の手前が「数を打っただけ」か。演算子も関数も括弧も含まないこと。

    往復ケース(任意の式に `eng` を 2 回)と整形ケース(打った数に `eng` を
    1 回)は、どちらも末尾がトグルなので**末尾だけでは区別できない**。
    """
    if "eq" not in keys:
        return False
    literal = {"dot", "zeros3", "exp", "neg"}
    return all(key.isdigit() or key in literal for key in keys[: keys.index("eq")])


#: 入力バッファが受け付ける桁数。`engine/state.rs` の `MAX_ENTRY_LEN`。
#: **先頭のゼロも数える**(実測 2026-08-17)。
MAX_ENTRY_LEN = 12


def test_no_case_types_more_digits_than_the_buffer_accepts() -> None:
    """**打鍵が 12 桁を超えると、engine は超えたぶんを黙って捨てる。**

    実測(2026-08-17): `1234567890123` と打つと engine は `1.23456789e11` を
    出す——13 桁目が入らず、値は `123456789012` である。参照実装は打った
    文字列をそのまま評価するので、**「打ったはずの値」と「engine が持った値」
    が食い違う**。

    そのとき赤くなるのは計算でも整形でもなく**打鍵**であり、原因が分かりにくい。
    実際にこの探りで 1 件踏んで、整形の差だと勘違いしかけた。

    ここは全シャードのキー列を走査して、**連続した数字の並び**が上限を
    超えていないことを確かめる。`add` などの演算子で区切られるので、
    1 つの数に何桁打っているかはキー列から数えられる。

    **`entry-000.json` は対象外。** この検査が守っているのは「参照実装が
    打った文字列をそのまま評価する結果」と「engine が実際に持つ値」の
    食い違いであって、`entry-000.json` の期待値は評価などしていない
    ——実測した engine の表示そのものを写している(`corpus_entry.py`
    `_provenance`)。`max_entry_len_cases` が 20 個の `7` を打つ 1 件を
    **わざと**含む(engine が 12 桁で頭打ちになることを主張するケース)ので、
    ここで一緒に検査すると自分自身が守っている不変条件に自分で違反する。
    """
    offenders: list[str] = []
    for path in sorted(_CORPUS_GENERATED.glob("*.json")):
        if path.name == "entry-000.json":
            continue
        shard = json.loads(path.read_text())
        for case in shard["cases"]:
            sequences = (
                [case["keys"]] if "keys" in case else [case.get("left", []), case.get("right", [])]
            )
            for keys in sequences:
                run = 0
                for key in keys:
                    if key.isdigit():
                        run += 1
                    elif key == "zeros3":
                        run += 3
                    elif key in ("dot", "j", "neg"):
                        # 数の途中に来るが桁ではない。並びは切れない。
                        pass
                    else:
                        run = 0
                    if run > MAX_ENTRY_LEN:
                        offenders.append(f"{path.name}:{case['id']} ({run} 桁)")
                        break
    assert not offenders, (
        f"{len(offenders)} 件が入力バッファの上限({MAX_ENTRY_LEN} 桁)を超えて打っている: "
        f"{offenders[:5]}。engine は超えたぶんを捨てるので、参照が評価した値を"
        "engine は一度も持たない"
    )


def test_the_display_shard_carries_every_hand_picked_literal() -> None:
    """**手で選んだ値が、乱数の都合で消えていないこと。**

    `DISPLAY_EDGE_LITERALS` は工学表記と 60 進の分岐を狙って手で探した値で、
    乱数では踏めない場所にある。以前はこれらも抽選の 1 分岐だったため、
    1 つの値は多くても 1 回しか出ず、eng と dms のどちらに回るかも運任せだった。

    いまは生成器が先頭で**全部を、両方のトグルで**出す。この検査はそれが
    実際にシャードに載っていることを、コミット済みの JSON から確かめる
    ——生成器のコードではなく**結果**を見ることが要点である。
    """
    shard = json.loads((_CORPUS_GENERATED / "display-000.json").read_text())
    pressed: dict[str, set[str]] = {}
    for case in shard["cases"]:
        keys = case["keys"] if case["kind"] == "display" else case["right"]
        if keys[-1] not in ("eng", "dms") or not _is_bare_typed_number(keys):
            continue
        pressed.setdefault(_typed_text_of(keys), set()).add(keys[-1])

    missing = [
        text
        for text in generate_corpus.DISPLAY_EDGE_LITERALS
        if pressed.get(text) != {"eng", "dms"}
    ]
    assert not missing, (
        f"{len(missing)} 件の手選びの値が両方のトグルで踏まれていない: {missing[:5]}。"
        "生成器の先頭の並びが壊れている"
    )


def test_the_display_shard_actually_reaches_the_sexagesimal_carry() -> None:
    """**秒が 60 に繰り上がるケースが、実際に何件かあること。**

    繰り上がりは「秒を丸めてから 60 と比べる」規則でしか起きず、丸める前の
    値からは先読みできない。engine の `format_sexagesimal` はそのために
    順序を守っているが、**踏まないテストはその順序を何も主張しない。**

    検出力の測定(`web/scripts/detection-power.mjs` の `sexagesimal-no-carry`)で、
    最初の版がこの窓を 1 件しか持っていないことが分かった——検出が乱数 1 回に
    懸かっていたということである。ここで下限を置いて、次に減ったら赤くする。
    """
    shard = json.loads((_CORPUS_GENERATED / "display-000.json").read_text())
    carried = 0
    for case in shard["cases"]:
        if case["kind"] != "display" or case["keys"][-1] != "dms":
            continue
        if not _is_bare_typed_number(case["keys"]):
            continue
        a = Fraction(abs(float(_typed_text_of(case["keys"]))))
        degrees = a.numerator // a.denominator
        rest = (a - degrees) * 60
        minutes = rest.numerator // rest.denominator
        seconds = float((rest - minutes) * 60)
        # 丸める前の秒が 60 のすぐ手前なら、丸めで 60 になりうる。
        if seconds > 59.9:
            carried += 1
    assert carried >= 8, (
        f"秒が繰り上がりうるケースが {carried} 件しかない。この経路の検出が乱数任せになっている"
    )


def test_unclassified_reference_gave_up_stops_the_generator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ReferenceGaveUp` の理由は型で分ける(設計書 §4.9)。

    `loan_ref.NearYenBoundaryError` でも `compound_ref.DepositSearchLimitError`
    でもない素の `ValueError` は、どちらの型にも当てはまらない未分類の失敗
    である。**`other` として数だけ増やして通さない**——`_finance_entry` は
    ここで `RuntimeError` を上げ、生成器自体を落とす。
    """

    def _boom(op: str, params: dict) -> dict:
        raise ValueError("boom")

    monkeypatch.setattr(corpus_calls.loan_ref, "compute", _boom)
    with pytest.raises(RuntimeError, match="unclassified"):
        corpus_calls._finance_entry(
            0,
            "loan_forward",
            {"principal": "1", "rate": "0", "n": 1, "residual": "0"},
            "loan_forward/random",
        )


def test_the_current_generator_gives_up_only_for_one_classified_reason() -> None:
    """いまの生成器では、参照実装の棄却は `near_yen_boundary` だけに収まる
    (`other` は 0 件)。

    `compound_deposit_search_limit` は Task 2(`deposit_for` の種に税を
    織り込む改善)で 10 → 0 になった。種が税を見ずに組まれていたのが原因で、
    実測 10 件はすべて `tax: True` の `compound_deposit_for` だった
    （`reference/tests/test_compound_ref.py` の `TAX_SEED_MISS_CASES`）。

    `near_yen_boundary` は 3 → 5 になった(Task 6)。`loan_term` /
    `loan_principal` の乱択入力を正算の答から構成するようにしたことで、
    `loan_forward` / `loan_bonus_forward` の乱択列(同じ `rng` を共有する)が
    ずれ、円境界近接の棄却を引く回数がわずかに変わった——これは
    `_guard_boundary` 自体の挙動ではなく、乱数列の並びが変わっただけである。

    `near_yen_boundary` は 5 → 2 になった(Task 7)。名指し層の下限合計が
    281 件から 1306 件に増えたので(pairwise で約 1,020 件が名指しに移った)、
    乱択層は 1719 件から 694 件まで縮む。乱択の総試行回数が減れば、そこで
    引く円境界棄却の実測件数も比例して減る——`_guard_boundary` の挙動でも
    乱数列の並びでもなく、**乱択層そのものが小さくなった**ことの影響である。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    reasons = shard["rejections"]["reference_gave_up"]
    assert reasons["near_yen_boundary"] == 2
    assert reasons["compound_deposit_search_limit"] == 0
    assert reasons["other"] == 0


def test_every_finance_case_carries_a_known_stratum() -> None:
    """設計書 §4.11 の 10。**層の一覧は `corpus_calls.FINANCE_STRATA` から読む**
    ——テストに写しを持たない。乱択で作られたケースだけが `"{op}/random"` に
    入ることも合わせて確かめる。
    """
    known_keys = {stratum.key for stratum in corpus_calls.FINANCE_STRATA}
    random_keys = {f"{op}/random" for op in corpus_calls.LOAN_OPS + corpus_calls.COMPOUND_OPS}
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    strata_seen = {case["stratum"] for case in shard["cases"]}
    assert strata_seen <= known_keys | random_keys
    # 名指し層は全部使われている(骨格を移した Task で 1 件も落としていない)
    named_strata_seen = strata_seen & known_keys
    assert named_strata_seen == known_keys


def test_every_stratum_meets_its_minimum() -> None:
    """設計書 §4.11 の 1。**下限はこの Task ではすべて 0**(Task 3 のスコープ外の
    値は Task 6 で入る)。

    このテストが「1 つでも下限を満たさない層があれば落ちる」ことを主張できて
    いるかは、下限 0 のままでは検証できない——**反証可能性は架空の層を
    一時的に足して手元で確かめてあり**(実装報告に記録)、テスト本体には
    架空の層を残さない。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    counts: dict[str, int] = {}
    for case in shard["cases"]:
        counts[case["stratum"]] = counts.get(case["stratum"], 0) + 1
    for stratum in corpus_calls.FINANCE_STRATA:
        assert counts.get(stratum.key, 0) >= stratum.minimum, (
            f"{stratum.key} の下限 {stratum.minimum} を満たさない"
            f"(実測 {counts.get(stratum.key, 0)})"
        )


# --- Task 4: 因子と水準・名指し異常系 -------------------------------------


def _finance_stratum_mismatches(strata: tuple) -> list[tuple[str, str, str]]:
    """`strata` それぞれの `build()` が作る入力を参照実装へ通し、返ってきた
    種別が `expect` と食い違う層を集める。**「エラーになるはず」と書いた
    入力が実は正常だった、を緑のまま許さないガード**(設計書 §4.5 の末尾・
    Task 4 Step 4)。全 18+ 層(骨格 Task が作ったものを含む)に掛かる。
    """
    mismatches = []
    for stratum in strata:
        params = stratum.build(random.Random(0), 0)
        compute = (
            corpus_calls.loan_ref.compute
            if stratum.op.startswith("loan_")
            else corpus_calls.compound_ref.compute
        )
        result = compute(stratum.op, params)
        actual = result.get("error", "ok")
        if actual != stratum.expect:
            mismatches.append((stratum.key, stratum.expect, actual))
    return mismatches


def test_every_finance_stratum_expect_matches_the_reference_output() -> None:
    """設計書 §4.5 の末尾。全 finance 層(既存 18 + Task 4 で足した層)の
    `expect` を、参照実装が実際に返す種別と突き合わせる。
    """
    mismatches = _finance_stratum_mismatches(corpus_calls.FINANCE_STRATA)
    assert not mismatches, f"expect が実測と食い違う層: {mismatches}"


def test_the_expect_guard_actually_catches_a_wrong_expect() -> None:
    """反証可能性: 上のガードは、1 つの層の `expect` を意図的に間違えると
    本当に落ちるか。**架空に壊した層を直接このテストに食わせて確かめる**
    ——本体のガードには壊れた層を残さない。
    """
    real = corpus_calls.FINANCE_STRATA[0]
    wrong_expect = "SyntaxError" if real.expect == "ok" else "ok"
    broken = corpus_calls.Stratum(real.op, real.name, wrong_expect, real.minimum, real.build)
    mismatches = _finance_stratum_mismatches((broken,))
    assert mismatches == [(broken.key, wrong_expect, real.expect)]


def test_all_seventeen_error_paths_are_named_and_appear_in_the_corpus() -> None:
    """設計書 §4.5(2026-08-19 訂正後)・§4.11 の 4。経路は 17(16 ではない
    ——「残価に届く前に完済」の行番号訂正で 1 行が 2 行に分かれた)。各経路が
    `ERROR_PATH_STRATA` で層に対応づき、その層が生成されたコーパスに実際に
    現れることを確かめる。**表に無い経路を推測で足していない**——この表は
    Rust のガードから数え上げたもの。
    """
    assert len(corpus_calls.ERROR_PATHS) == 17
    assert set(corpus_calls.ERROR_PATH_STRATA) == {
        name for name, _source in corpus_calls.ERROR_PATHS
    }
    known_keys = {s.key for s in corpus_calls.FINANCE_STRATA}
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    strata_seen = {case["stratum"] for case in shard["cases"]}
    for name, _source in corpus_calls.ERROR_PATHS:
        stratum_keys = set(corpus_calls.ERROR_PATH_STRATA[name])
        assert stratum_keys, f"{name} に層が割り当てられていない"
        assert stratum_keys <= known_keys, (
            f"{name} の層が FINANCE_STRATA に無い: {stratum_keys - known_keys}"
        )
        assert stratum_keys & strata_seen, f"{name} がコーパスに1件も現れない"


def test_periods_per_year_four_never_appears_in_the_random_layer() -> None:
    """設計書 §4.11 の 5。`4` は乱択から外し、名指しのエラー層に移した
    (`rate.rs:32` が受け付けるのは 1・2・12 だけ)。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    compound_ops = set(corpus_calls.COMPOUND_OPS)
    for case in shard["cases"]:
        if case["stratum"].endswith("/random") and case["op"] in compound_ops:
            assert case["input"]["periods_per_year"] != 4


def test_periods_per_year_1_2_12_are_roughly_balanced_in_the_random_layer() -> None:
    """設計書 §4.11 の 5。しきい値は「最小の層が最大の層の 0.8 倍以上」。

    **数えるのは正常のケースだけである。** 設計書は「**正常の** 1・2・12 が
    ほぼ均等」と書いている。エラーまで混ぜると、測っているのは
    「引かれた回数の均等」ではなく「引かれた回数 × その周期での失敗率」に
    なる——`ppy=1` は同じ期数でも実時間が長く溢れやすいので(Task 6 で
    実測した偏りと同じ原因)、エラーを含めた数え方は `1` を厚く見せる。

    Task 7 でこのテストは一度 0.7 に緩められた。乱択層が 1719 件から 694 件に
    縮んで標本のばらつきが増えた、という理由づけだった。**実測すると、緩める
    必要は無かった。** エラーを含めた数え方では `{1: 99, 2: 80, 12: 76}` で
    比 0.768 だが、設計書どおり正常だけで数えると
    `{1: 85, 2: 76, 12: 76}` で **比 0.894** である。しきい値ではなく
    数え方のほうが設計書とずれていた。

    `4` が 1 件も無いこと(不均衡ではなく排除)は別テストが確かめる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    compound_ops = set(corpus_calls.COMPOUND_OPS)
    counts: dict[int, int] = {}
    for case in shard["cases"]:
        if "error" in case["expect"]:
            continue
        if case["stratum"].endswith("/random") and case["op"] in compound_ops:
            ppy = case["input"]["periods_per_year"]
            counts[ppy] = counts.get(ppy, 0) + 1
    assert set(counts) == {1, 2, 12}
    assert min(counts.values()) >= max(counts.values()) * 0.8, counts


def test_rate_covers_the_sub_0_1_percent_band_and_four_decimal_digits() -> None:
    """設計書 §4.11 の 6。`0 < r < 0.1` の正常が 1 件以上、小数 4 桁が 1 件以上。"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    low_rate_ok = 0
    four_decimal_ok = 0
    for case in shard["cases"]:
        if "error" in case["expect"]:
            continue
        rate = case["input"].get("rate")
        if rate is None:
            continue
        try:
            value = float(rate)
        except ValueError:
            continue
        if 0 < value < 0.1:
            low_rate_ok += 1
        if len(rate.partition(".")[2]) == 4:
            four_decimal_ok += 1
    assert low_rate_ok >= 1
    assert four_decimal_ok >= 1


def test_all_sixteen_named_term_levels_appear() -> None:
    """設計書 §4.11 の 7。名指し期間 16 種がすべて 1 件以上現れる。"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    seen_terms = {case["input"]["n"] for case in shard["cases"] if "n" in case["input"]}
    needed = {n for n, _expect in corpus_calls.TERM_LEVELS}
    assert needed <= seen_terms, needed - seen_terms


def test_loan_term_1201_is_ok_but_compound_periods_1201_is_syntax_error() -> None:
    """設計書 §4.2 の訂正の核心。loan の期間に上限のガードは無い
    (`MAX_TERM_MONTHS` は逆算探索の打ち切りであって入力の契約ではない)ので
    `1201` は loan では正常。複利は `compound.rs:33` が `periods > 1200` を
    見るので `1201` は SyntaxError。**この 2 つが食い違ったら実装ではなく
    この訂正を疑う。**
    """
    loan_result = corpus_calls.loan_ref.compute(
        "loan_forward", {"principal": "1000000", "rate": "2.0", "n": 1201, "residual": "0"}
    )
    assert "error" not in loan_result

    compound_result = corpus_calls.compound_ref.compute(
        "compound_grow",
        {
            "principal": "1000000",
            "deposit": "0",
            "rate": "2.0",
            "periods_per_year": 1,
            "periods": 1201,
            "tax": False,
        },
    )
    assert compound_result == {"error": "SyntaxError"}


# --- Task 5: 税の境界層 ---------------------------------------------------


def _tax_boundary_stratum(name: str) -> corpus_calls.Stratum:
    return next(
        s for s in corpus_calls.FINANCE_STRATA if s.op == "compound_grow" and s.name == name
    )


def _tax_boundary_result(name: str) -> dict:
    stratum = _tax_boundary_stratum(name)
    params = stratum.build(random.Random(0), 0)
    return corpus_calls.compound_ref.compute("compound_grow", params)


def test_the_named_tax_strata_span_the_national_tax_floor_jump() -> None:
    """設計書 §4.6。**件数ではなく跳びそのもの**を確かめる——`tax_interest_7`
    の元本を 1 桁でも書き間違えると、利息が 7 からずれて国税が 0→1 に跳ばなく
    なり、このテストが落ちる。「7 件入っている」だけを見るテストはこの間違いを
    素通りさせる。
    """
    six = _tax_boundary_result("tax_interest_6")
    seven = _tax_boundary_result("tax_interest_7")
    assert six["interest"] == "6"
    assert seven["interest"] == "7"
    assert six["national_tax"] == "0"
    assert seven["national_tax"] == "1"


def test_the_named_tax_strata_span_the_local_tax_floor_jump() -> None:
    """利息 19→20 で地方税の床が 0→1 に跳ぶ。国税と同じ理由で、跳びそのものを
    確かめる。
    """
    nineteen = _tax_boundary_result("tax_interest_19")
    twenty = _tax_boundary_result("tax_interest_20")
    assert nineteen["interest"] == "19"
    assert twenty["interest"] == "20"
    assert nineteen["local_tax"] == "0"
    assert twenty["local_tax"] == "1"


def test_the_simultaneous_tax_jump_stratum_crosses_both_floors_at_once() -> None:
    """`tax_simultaneous_jump` は決定的探索(乱数を使わない)で見つけた利息。
    その利息の 1 円手前と比べて、国税と地方税が両方跳ぶことを確かめる。
    """
    result = _tax_boundary_result("tax_simultaneous_jump")
    interest = int(result["interest"])
    prev_national, prev_local = corpus_calls.compound_ref.withholding_tax(interest - 1)
    assert int(result["national_tax"]) != prev_national
    assert int(result["local_tax"]) != prev_local


def test_the_tax_rounding_mismatch_stratum_differs_from_the_combined_floor() -> None:
    """`tax_rounding_mismatch` は、国税・地方税を別々に切り捨てた合計が、
    合計 20.315% を 1 回切り捨てた値と 1 円ずれる利息(`tax.rs` のユニット
    テストが持つ `2,648,906` を起点に、乱数を使わず決定的に探索した)。
    `tax.rs::the_two_taxes_are_floored_separately` と同じ数を主張する。
    """
    result = _tax_boundary_result("tax_rounding_mismatch")
    interest = int(result["interest"])
    assert interest == 2_648_906
    separate = int(result["national_tax"]) + int(result["local_tax"])
    combined = interest * 20315 // 100_000
    assert result["national_tax"] == "405679"
    assert result["local_tax"] == "132445"
    assert separate == 538_124
    assert combined == 538_125
    assert separate != combined


def test_the_tax_boundary_searches_are_deterministic_not_random() -> None:
    """設計書 §4.6・Task 5 Step 3。「探索は生成のたびに走ってよいが、乱数を
    使わないこと」——同じ起点からは常に同じ利息が出ることを確かめる。
    """
    assert corpus_calls._find_simultaneous_tax_jump(21) == corpus_calls._find_simultaneous_tax_jump(
        21
    )
    assert corpus_calls._find_tax_rounding_mismatch(
        2_648_906
    ) == corpus_calls._find_tax_rounding_mismatch(2_648_906)


# --- Task 6: 構成による正常生成(逆算 op と残価・ボーナス) ------------------


def test_each_op_has_at_least_100_normal_cases() -> None:
    """設計書 §4.11 の 2。各 op の正常が 100 件以上。

    `loan_term` / `loan_principal` / `compound_deposit_for` /
    `compound_periods_for` は、逆算の入力を正算の答から構成する(設計書
    §4.4)ようになったことで、乱択層でもほぼ確実に正常になる——`loan_term`
    はこの変更の前は乱択の正常率が 34% ほどで、100 件の下限を満たすのが
    ここでは危うかった。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    ok_counts: dict[str, int] = {}
    for case in shard["cases"]:
        if "error" not in case["expect"]:
            ok_counts[case["op"]] = ok_counts.get(case["op"], 0) + 1
    for op in corpus_calls.LOAN_OPS + corpus_calls.COMPOUND_OPS:
        assert ok_counts.get(op, 0) >= 100, f"{op} の正常が100件未満(実測 {ok_counts.get(op, 0)})"


def test_residual_zero_and_bonus_zero_are_all_normal_and_meet_their_floor() -> None:
    """設計書 §4.11 の 2。残価 0 の正常 100 件以上、ボーナス 0 の正常 30 件以上。

    `residual_zero` / `bonus_zero` は定義上すべて `expect == "ok"` の層なので
    (金利 0% に固定し、発散や払い切りの縮退を踏まない入力だけを `i` で振って
    いる)、単に件数を数えるだけでなく**実際に生成された各ケースが `ok` で
    あること**まで確かめる——`build` が誤って `expect` と食い違う入力を
    混ぜても、件数だけを見るテストでは気づけない。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    residual_zero_cases = [
        c for c in shard["cases"] if c["stratum"] == "loan_forward/residual_zero"
    ]
    bonus_zero_cases = [
        c for c in shard["cases"] if c["stratum"] == "loan_bonus_forward/bonus_zero"
    ]
    assert len(residual_zero_cases) >= 100
    assert all("error" not in c["expect"] for c in residual_zero_cases)
    assert len(bonus_zero_cases) >= 30
    assert all("error" not in c["expect"] for c in bonus_zero_cases)


# --- Task 7: ペアワイズ割付(IPOG) -----------------------------------------


def _full_cross_pairs(factors: dict) -> set:
    """`factors` の全交差から数え上げた、2 因子の水準の組の集合。
    `pairwise()` が返す行の網羅を測るときの基準(全交差そのもの)。
    """
    names = list(factors)
    pairs = set()
    for i, factor_a in enumerate(names):
        for factor_b in names[i + 1 :]:
            for level_a in factors[factor_a]:
                for level_b in factors[factor_b]:
                    pairs.add((factor_a, level_a, factor_b, level_b))
    return pairs


def _covered_pairs(rows: list, names: list) -> set:
    """`rows`(`pairwise()` の戻り値、または `name: level` の辞書の並び)が
    実際に覆っている 2 因子の水準の組の集合。
    """
    pairs = set()
    for row in rows:
        for i, factor_a in enumerate(names):
            for factor_b in names[i + 1 :]:
                pairs.add((factor_a, row[factor_a], factor_b, row[factor_b]))
    return pairs


def test_pairwise_covers_every_pair_of_a_small_3x3x3_factor_table() -> None:
    """Task 7 Step 2。3×3×3 の因子表で、**全交差から数え上げたペアの集合**と
    **`pairwise()` の行が覆うペアの集合**を突き合わせる。「ペアワイズで
    作った」という主張そのものを見張るテストの土台。
    """
    factors = {"x": (1, 2, 3), "y": ("a", "b", "c"), "z": (True, False, None)}
    rows = corpus_calls.pairwise(factors)
    names = list(factors)
    expected = _full_cross_pairs(factors)
    actual = _covered_pairs(rows, names)
    assert actual == expected
    # 3 因子の全交差は 27 行。ペアワイズはそれより少ない行数で全ペアを
    # 覆えているはず——全交差をそのまま返しているだけの実装ではないことの
    # 検算(行を返すだけで網羅していない実装とは逆に、ここは「全交差の
    # 手抜き」になっていないかを見る)。
    assert len(rows) < 27


def test_pairwise_is_deterministic_not_random() -> None:
    """設計書 §4.3・Task 7 Step 1。「同じ因子表からは常に同じ行が同じ順で
    出る」——2 回呼んで一致することで、乱数を使っていないことを主張する。
    """
    factors = {"x": (1, 2, 3), "y": ("a", "b", "c"), "z": (True, False, None)}
    assert corpus_calls.pairwise(factors) == corpus_calls.pairwise(factors)
    assert corpus_calls.pairwise(corpus_calls.PAIRWISE_LOAN_FACTORS) == corpus_calls.pairwise(
        corpus_calls.PAIRWISE_LOAN_FACTORS
    )


def test_pairwise_coverage_is_falsifiable_by_dropping_a_row() -> None:
    """反証可能性: 行を 1 本削ると、全ペア網羅の主張が本当に崩れるか。
    崩れなければ「ペアワイズを覆っている」と主張するテストが実は何も
    見ていない(「テストは何も主張しないことがある」)。
    """
    factors = {"x": (1, 2, 3), "y": ("a", "b", "c"), "z": (True, False, None)}
    rows = corpus_calls.pairwise(factors)
    names = list(factors)
    expected = _full_cross_pairs(factors)
    reduced = rows[:-1]
    assert _covered_pairs(reduced, names) != expected


def _pairwise_cases(shard: dict) -> list:
    """`shard["cases"]` のうち、pairwise 層(`"{op}/pairwise_NNNN"`)のもの。"""
    return [c for c in shard["cases"] if c["stratum"].rsplit("/", 1)[-1].startswith("pairwise_")]


def test_loan_ops_together_cover_every_rate_and_term_pair_in_the_corpus() -> None:
    """§4.11 の 3(コーパス全体に対して)。loan の pairwise 因子は金利・期間の
    2 つだけなので、`pairwise()` は全交差と一致する(2 因子なら 1 行が高々
    1 組しか覆えないため——上の 3×3×3 のテストとは違う理屈だが、これも
    `pairwise()` 自身の性質としてテストしている)。

    ここでは**独立に計算した全交差**と、**実際にコーパスへ入った入力**
    (`shard["cases"]`、参照実装を経て golden になったもの)を突き合わせる。
    `n` がそのまま入力になる 4 op(forward・principal・bonus_forward・
    bonus_principal)の合算で見る——`loan_term` は `n` が答なので合算に
    入れない(それでも集合が揃うことがこのテストの主張であり、揃わなければ
    `loan_term` の構成失敗がどこかの組を丸ごと消していたことになる)。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    literal_n_ops = {"loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal"}
    covered = set()
    for case in _pairwise_cases(shard):
        if case["op"] not in literal_n_ops:
            continue
        covered.add((case["input"]["rate"], case["input"]["n"]))
    expected = {
        (rate, n)
        for rate in corpus_calls.PAIRWISE_RATE_LEVELS
        for n in corpus_calls.PAIRWISE_LOAN_TERM_LEVELS
    }
    assert covered == expected


def test_compound_grow_pairwise_rows_cover_every_pair_of_its_four_factors() -> None:
    """§4.11 の 3。`compound_grow` は正算そのものなので pairwise の行を
    1 つも飛ばさない(探索が絡まないため)——**この op だけで**、金利・
    期間・複利周期・税の 4 因子・6 通りの 2 因子ペアすべてが揃っているはず。
    実際にコーパスへ入った入力を、独立に呼んだ `pairwise()` の出力と比べる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    names = list(corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS)
    rows = [case["input"] for case in _pairwise_cases(shard) if case["op"] == "compound_grow"]
    assert len(rows) == len(corpus_calls._PAIRWISE_COMPOUND_GROW_ROWS)
    actual = _covered_pairs(rows, names)
    expected = _full_cross_pairs(corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS)
    assert actual == expected


def test_compound_periods_for_pairwise_rows_cover_every_pair_of_its_three_factors() -> None:
    """§4.11 の 3。`compound_periods_for` は「期間」を答として持たない
    (§4.4)ので、因子は金利・複利周期・税の 3 つ(設計書の「その op が持たない
    因子を無理に入れない」)。この 3 因子・3 通りのペアすべてが実際のコーパス
    に現れることを確かめる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    names = list(corpus_calls.PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS)
    rows = [
        case["input"] for case in _pairwise_cases(shard) if case["op"] == "compound_periods_for"
    ]
    assert len(rows) == len(corpus_calls._PAIRWISE_COMPOUND_PERIODS_FOR_ROWS)
    actual = _covered_pairs(rows, names)
    expected = _full_cross_pairs(corpus_calls.PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS)
    assert actual == expected


def test_compound_grow_pairwise_coverage_is_falsifiable_by_dropping_a_case() -> None:
    """反証可能性(コーパス版)。実際に生成された `compound_grow` の pairwise
    ケースを 1 件取り除くと、上のテストが確かめている全ペア網羅は本当に
    崩れるか。崩れなければ、そのテストは件数を見ているだけで網羅を見ていない
    ことになる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    names = list(corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS)
    rows = [case["input"] for case in _pairwise_cases(shard) if case["op"] == "compound_grow"]
    expected = _full_cross_pairs(corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS)
    assert _covered_pairs(rows[:-1], names) != expected


def test_pairwise_rows_use_only_normal_levels() -> None:
    """Task 7 Step 3。ペアワイズの水準は正常値だけで組む(設計書 §4.3)。
    `100.0001`(金利の上限超)・期間 `0`・周期 `0`/`4`/`13` を因子の水準に
    混ぜていないことを、実際に使われた因子表そのもので確かめる——
    `expect` は個々の行では `ok` 以外(`SyntaxError`/`Overflow`)にもなり
    得る(高金利 × 長期間の発散・複利の Overflow、実装報告に記録)が、それは
    **正常値どうしの組み合わせが結果として発散・Overflow した**ためであり、
    エラー水準そのものを混ぜたのではない、という違いをこのテストが担う。
    """
    assert "100.0001" not in corpus_calls.PAIRWISE_RATE_LEVELS
    assert 0 not in corpus_calls.PAIRWISE_LOAN_TERM_LEVELS
    assert 0 not in corpus_calls.PAIRWISE_COMPOUND_TERM_LEVELS
    assert 1201 not in corpus_calls.PAIRWISE_COMPOUND_TERM_LEVELS
    assert set(corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS["periods_per_year"]) == {1, 2, 12}


def test_pairwise_rows_are_allocated_to_all_eight_ops() -> None:
    """Task 7 Step 4。8 op すべてに pairwise 層が割り付けられていること。
    因子表は op ごとに違う(loan は金利・期間の 2 つ、`compound_grow` /
    `compound_deposit_for` は金利・期間・周期・税の 4 つ、
    `compound_periods_for` は期間を持たないので金利・周期・税の 3 つ)。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    ops_seen = {case["op"] for case in _pairwise_cases(shard)}
    assert ops_seen == set(corpus_calls.LOAN_OPS + corpus_calls.COMPOUND_OPS)


# --- Task 8: 非単調層の決定的探索 -------------------------------------------


def _non_monotone_net_stratum() -> corpus_calls.Stratum:
    return next(
        s
        for s in corpus_calls.FINANCE_STRATA
        if s.op == "compound_periods_for" and s.name == "non_monotone_net"
    )


def test_the_non_monotone_net_search_is_deterministic_not_random() -> None:
    """設計書 §5.2・Task 8 Step 1。「探索は生成のたびに走ってよいが、乱数を
    使わないこと」——同じ入力からは常に同じ `(到達, 未達, 再到達)` の期が出る。
    """
    args = (
        corpus_calls._NON_MONOTONE_NET_PRINCIPAL,
        0,
        corpus_calls._NON_MONOTONE_NET_NUM,
        corpus_calls._NON_MONOTONE_NET_DEN,
    )
    first = corpus_calls._find_non_monotone_net_valley(*args, search_limit=200)
    second = corpus_calls._find_non_monotone_net_valley(*args, search_limit=200)
    assert first == second


def test_the_non_monotone_net_stratum_exists_because_mutation_9_needs_it() -> None:
    """設計書 §5.2・Task 8 Step 3。

    **これは件数を守るテストではない。** `compound_periods_for` の必要期間は
    期数について単調ではない——税の 2 つの床(国税 15.315%・地方税 5%)が
    同じ期に同時に跳ぶと、その期だけ手取りが前の期より下がることがある。
    Task 11 で入る Finance 変異 #9 は `compound_inverse.rs::periods_for` の
    前進 1 本の全走査を期数についての二分探索に置き換えるので、この谷を
    跨ぐ探索をすると誤った期を返す。**その谷を含むケースがコーパスに 1 件も
    無ければ、#9 はどのケースにも当たらず、静かに検出力を失う。** つまり
    このテストが守っているのは `non_monotone_net` 層の件数そのものではなく、
    **変異 #9 の検出力**である——件数だけでは単調なケースが紛れ込んでも
    緑になるので、谷の形そのものは下の
    `test_the_non_monotone_net_stratum_is_actually_a_valley` が assert する。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    cases = [c for c in shard["cases"] if c["stratum"] == "compound_periods_for/non_monotone_net"]
    assert len(cases) >= 1


def test_the_non_monotone_net_stratum_is_actually_a_valley() -> None:
    """設計書 §5.2・Task 8 Step 4。件数だけを見るテストは、単調なケースが
    紛れ込んでも緑になる。**参照実装(`compound_ref.reached`)を直接呼んで**、
    目標との比較(到達しているか)が 3 点で `True, False, True` になっている
    ことを確かめる——これが二分探索(変異 #9)を飛び越えさせる谷そのものである。
    """
    stratum = _non_monotone_net_stratum()
    params = stratum.build(random.Random(0), 0)
    principal = int(params["principal"])
    deposit = int(params["deposit"])
    target = int(params["target"])
    assert params["tax"] is True
    num, den = corpus_calls.compound_ref.rate_fraction(params["rate"], params["periods_per_year"])

    reached_period = corpus_calls._NON_MONOTONE_NET_REACHED_PERIOD
    dip_period = corpus_calls._NON_MONOTONE_NET_DIP_PERIOD
    recovery_period = corpus_calls._NON_MONOTONE_NET_RECOVERY_PERIOD
    assert dip_period == reached_period + 1
    assert recovery_period > dip_period

    def _is_reached(n: int) -> bool:
        return corpus_calls.compound_ref.reached(principal, deposit, num, den, n, True) >= target

    assert _is_reached(reached_period) is True
    assert _is_reached(dip_period) is False
    assert _is_reached(recovery_period) is True

    # `periods_for` 自身の答は「最初に到達する期」であって谷の期ではない
    # ——参照実装の全走査(`check_periods_certificate` と同じ定義)がそれを
    # 正しく守っていることも、ついでに確かめる。
    n = corpus_calls.compound_ref.periods_for(principal, deposit, num, den, target, True)
    assert n == reached_period


def test_a_bisection_over_this_case_returns_the_wrong_period() -> None:
    """設計書 §5.2・Task 8。上の 3 つのテストは「谷がある」ことしか言っていない
    ——**「その谷が変異 #9 を殺す」は主張であって測定ではない。** ここで測る。

    変異 #9 は `periods_for` の前進 1 本の全走査を、同じ述語
    (`手取り >= 目標`)についての二分探索に置き換える。その二分探索をここで
    参照実装の上に組んで走らせ、**正解と違う期を返すこと**を確かめる。
    谷があっても二分探索がたまたま正解に着地する入力はあり得るので、
    谷の存在だけでは #9 の検出力は保証されない。

    コメントで「飛び越えるはずだ」と書くとその根拠は静かに腐るが、この
    assert は入力が変わって谷が消えた瞬間に赤くなる。
    """
    stratum = _non_monotone_net_stratum()
    params = stratum.build(random.Random(0), 0)
    principal = int(params["principal"])
    target = int(params["target"])
    num, den = corpus_calls.compound_ref.rate_fraction(params["rate"], params["periods_per_year"])
    correct = corpus_calls._NON_MONOTONE_NET_REACHED_PERIOD

    def _is_reached(n: int) -> bool:
        return corpus_calls.compound_ref.reached(principal, 0, num, den, n, True) >= target

    # `MAX_PERIODS`(compound.rs)と同じ上限から下ろす、素直な下限二分探索。
    low, high = 0, 1200
    assert _is_reached(high)
    while high - low > 1:
        mid = low + (high - low) // 2
        if _is_reached(mid):
            high = mid
        else:
            low = mid

    assert high != correct
    # 実測値も焼き付ける——「違う」だけだと、谷の形が変わって別の誤り方に
    # なったことに気づけない。
    assert (high, correct) == (21, 19)


def test_finance_shard_refuses_to_silently_drop_a_stratum() -> None:
    """設計書 §4.7:「層の下限の合計が総件数を超えたら生成器がその場で落ちる
    (黙って層を削らない)」。総件数を定数で決め打たず、`FINANCE_STRATA` から
    実測した下限合計を 1 件だけ下回る `count` を渡して確かめる——ちょうど
    下限合計と同じ `count` は通ることも合わせて見て、境界のどちら側で落ちる
    かを固定する。
    """
    named_minimum_total = sum(max(1, stratum.minimum) for stratum in corpus_calls.FINANCE_STRATA)

    with pytest.raises(RuntimeError, match="下限合計"):
        corpus_calls.build_finance_shard(seed=1, count=named_minimum_total - 1)

    # 境界ちょうどでは落ちない(下限合計そのものは満たせる件数である)。
    shard = corpus_calls.build_finance_shard(seed=1, count=named_minimum_total)
    assert len(shard["cases"]) == named_minimum_total


def test_the_summary_line_counts_every_shard_not_just_the_cli_count(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """末尾の要約行の分母は、CLI 引数の `count` ではなく実際に書き出した総件数。

    以前のこの行は 15 シャード合計の経過時間を `count` で割っていた。件数の
    ほうも `count` をそのまま印字していたので、**印字された件数もケース
    あたりの時間も嘘だった**。finance だけ `FINANCE_COUNT` を渡す変更が入った
    時点で嘘になったが、緑のまま気づけなかった。この行は道具が印字する
    一次資料で、他所の台帳に事実として写される。

    `main` を実際に走らせて、書き出されたファイルを数え直して突き合わせる
    ——`_summary_line` を直接呼ぶだけでは、「`main` が総件数ではなく `count`
    を渡す」という元の壊れ方そのものを捕まえられない。

    finance は下限合計まで、残りは 5 件まで落として速く回す(分母の
    正しさは件数の大小によらない)。
    """
    monkeypatch.setattr(generate_corpus, "CORPUS", tmp_path)
    monkeypatch.setattr(
        generate_corpus,
        "FINANCE_COUNT",
        sum(max(1, stratum.minimum) for stratum in corpus_calls.FINANCE_STRATA),
    )
    cli_count = 5
    monkeypatch.setattr(sys, "argv", ["generate_corpus.py", str(cli_count)])

    generate_corpus.main()

    written = sorted(tmp_path.glob("*.json"))
    expected_total = sum(
        len(json.loads(path.read_text(encoding="utf-8"))["cases"]) for path in written
    )
    # 18 枚すべてが分母に入っていること。1 枚落ちても総件数は「それらしい」
    # 数字のままなので、枚数も見る。
    # **19 枚目は 2026-08-30 に増えた**（`combinatorics-display-000.json`）。
    # **数を持っているのはここだけではない**——`ALL_SHARDS`（heavy の検出力）と
    # `SCIENCE_SHARDS`、`COVERAGE_REQUIRED_SHARDS`、`DISPLAY_SHARD_PATTERN` が
    # それぞれ一覧を持つ。**足す日には全部が意識的な 1 行になる。**
    assert len(written) == 19
    # 総件数が CLI の `count` とも finance の件数とも一致しないこと——一致
    # する取り方では、どちらか一方を分母にする退行を捕まえられない。
    assert expected_total not in (cli_count, generate_corpus.FINANCE_COUNT)

    line = capsys.readouterr().out.strip().splitlines()[-1]
    match = re.fullmatch(r"generated (\d+) cases in ([\d.]+)ms \(([\d.]+)ms each\)", line)
    assert match is not None, line
    printed_total, elapsed_ms, each_ms = int(match[1]), float(match[2]), float(match[3])

    assert printed_total == expected_total
    # 印字した 2 つの数の割り算が、印字した 3 つ目と合うこと。
    #
    # **左辺は既に量子化されている。** `_summary_line` は経過を `.2f`(ミリ秒
    # 2 桁)で印字し、1 件あたりは**丸めていない**経過から `.4f` で出す。
    # つまりここで割れるのは 0.005ms まで刻まれた値で、右辺は刻まれる前の
    # 値から来ている。`round(..., 4) == each_ms` は**その差を無視して**
    # おり、`0.005 / total` が 4 桁目(5e-5)に届く件数で確率的に赤くなった
    # (実測 2026-08-20: 1 回赤、その後 5/5 緑。このテストは 14 枚を 5 件に
    # 落として回すので当たる。フルコーパス 33,567 件では 1.5e-7 で当たらない)。
    #
    # **これは許容を緩めているのではなく、左辺の量子化という事実を右辺に
    # 写す是正である。** 分母を取り違える退行(`count` で割る元の壊れ方)は
    # 桁違いのずれを出すので、この許容でも捕まる。
    quantization = 0.005 / printed_total  # 経過の `.2f` が捨てた分
    printing = 0.5e-4  # 1 件あたりの `.4f` が捨てた分
    assert abs(elapsed_ms / printed_total - each_ms) <= quantization + printing


# --- corrections-000.json に足した 2 形(計画 2026-08-19-heavy-scientific-ui-report
# Task 3、設計書 §5.2)。**この節は値を検算しない**——`ac`/`del` は値の意味を
# 持たないキーなので、正しさの根拠は `engine_table.rs` の
# `ac_recovers_from_an_error`(:189)・`keys_other_than_ac_are_ignored_while_in_error`
# (:194)・`del_removes_the_last_character`(:80)であって、ここは形が
# 壊れていないことだけを固定する。


def test_every_correction_stratum_has_at_least_one_case() -> None:
    # 計画 Task 3 Step 3: 新形(error-recovery・paren-edit)が 1 件以上あること
    # を固定する。既存 2 形(typo-del・ac-rebuild)も同じ枠組みで数える
    # (Task 3 Step 2、finance の stratum と同じ考え方)。
    shard = generate_corpus.build_corrections_shard(seed=1, count=200)
    counts: dict[str, int] = {}
    for case in shard["cases"]:
        counts[case["stratum"]] = counts.get(case["stratum"], 0) + 1
    assert set(counts) == set(generate_corpus.CORRECTION_STRATA)
    for stratum in generate_corpus.CORRECTION_STRATA:
        assert counts.get(stratum, 0) >= 1, f"{stratum} produced no cases"
    assert shard["strata"] == counts
    assert sum(counts.values()) == len(shard["cases"])


def test_no_correction_stratum_collapses_to_a_handful() -> None:
    """**「1 件以上」では、形が黙って痩せることを捕まえられない。**

    生成器は 4 形を等確率で選んでいるつもりだが、選んだあとに条件を満たさな
    かったケースを `continue` で捨てる。捨てられやすい形は結果として少なく
    なる——**再抽選は標本を偏らせる**（B+C Task 6 で同じ形を踏んだ。均等に
    したい因子はループの外で引くのが正しい直し方）。実測はいま
    `paren-edit` 790 / `ac-rebuild` 420 / `error-recovery` 418 /
    `typo-del` 372 で、等分の 500 からは離れているが、どの形も十分にある。

    偏り自体は仕様として許す（設計書も計画も均等を要求していない）。
    ここで見張るのは**崩壊**のほうである——ある形が生成しにくくなって
    数件まで痩せても、`>= 1` のテストは緑のままだからだ。実測の最小
    (372 = 18.6%) の半分を下限に置く。
    """
    shard = generate_corpus.build_corrections_shard(seed=20260825, count=2000)
    counts = shard["strata"]
    total = sum(counts.values())
    floor = total // 10
    thin = {name: n for name, n in counts.items() if n < floor}
    assert not thin, f"{thin} は総数 {total} の 10% ({floor} 件) に届かない"


def test_every_correction_case_carries_a_known_stratum() -> None:
    shard = generate_corpus.build_corrections_shard(seed=20260825, count=2000)
    known = set(generate_corpus.CORRECTION_STRATA)
    for case in shard["cases"]:
        assert case["stratum"] in known


def test_error_recovery_cases_actually_start_from_an_error() -> None:
    """`right` が、実在するエラー経路(`errors-000.json` の主張)で始まり、
    そのあとにエラー中の他のキー(`GARBAGE_KEYS`)を経て `ac` に至り、
    それ以降が `left`(正しい列)と一致すること。

    **「エラー中の他のキーが無視される」までを主張に含める**(設計書 §5.2)
    ——`ac` の直前に `GARBAGE_KEYS` が挟まっていることまで確かめる。挟まって
    いなければ、この形は「エラー後に ac で復帰する」しか主張しておらず、
    計画が要求する強い主張(エラー中に押した他のキーも無視される)を
    落としていることになる。
    """
    shard = generate_corpus.build_corrections_shard(seed=20260825, count=2000)
    error_starts = set(generate_corpus.ERROR_INDUCING_KEY_SEQUENCES)
    cases = [c for c in shard["cases"] if c["stratum"] == "error-recovery"]
    assert len(cases) >= 1
    for case in cases:
        right = case["right"]
        left = case["left"]
        assert right.count("ac") == 1, f"{case['id']}: expected exactly one ac"
        ac_index = right.index("ac")
        # `ac` より後ろは正しい列そのもの。
        assert right[ac_index + 1 :] == left
        # `ac` の直前に、生成器の GARBAGE_KEYS がそのまま挟まっている
        # (エラー中に押した他のキーが無視されることを、コーパスの規模で
        # 踏むための挿入)。
        garbage = list(generate_corpus.GARBAGE_KEYS)
        assert right[ac_index - len(garbage) : ac_index] == garbage
        # `ac` より前の残り(garbage の手前)は、実在するエラー経路の
        # キー列そのもの。
        error_prefix = tuple(right[: ac_index - len(garbage)])
        assert error_prefix in error_starts


def test_paren_edit_cases_delete_a_single_digit_inside_the_open_paren() -> None:
    """`[a, add, lparen, b, del, c, rparen, eq]` ≡ `[a, add, lparen, c, rparen, eq]`
    (設計書 §5.2)。`b` は必ず 1 個の数字キー——`del` が 1 回で完全に消えて
    初めて、`del_removes_the_last_character`(`engine_table.rs:80`,
    `main_of(&["3", "del"]) == "0"`)の主張どおりになる。
    """
    shard = generate_corpus.build_corrections_shard(seed=20260825, count=2000)
    cases = [c for c in shard["cases"] if c["stratum"] == "paren-edit"]
    assert len(cases) >= 1
    digits = set("0123456789")
    for case in cases:
        right = case["right"]
        left = case["left"]
        lparen_index = right.index("lparen")
        b_index = lparen_index + 1
        assert right[b_index] in digits, f"{case['id']}: b is not a single digit"
        assert right[b_index + 1] == "del"
        # `b, del` を取り除くと、正しい列そのものになる。
        rebuilt = right[:b_index] + right[b_index + 2 :]
        assert rebuilt == left


def test_error_inducing_pool_is_only_genuine_errors() -> None:
    # `errors-000.json` のアンダーフロー 2 件(`expect.error` を持たない)は
    # 「エラーにならない」という主張なので、エラー状態を作るためのプールに
    # 混ざっていてはいけない。
    from calcarc_reference.corpus_errors import build_errors_shard

    error_cases = build_errors_shard()["cases"]
    non_error_keys = {tuple(c["keys"]) for c in error_cases if not c["expect"].get("error")}
    assert len(non_error_keys) >= 1  # アンダーフロー 2 件が実在すること
    assert not (non_error_keys & set(generate_corpus.ERROR_INDUCING_KEY_SEQUENCES))
    assert len(generate_corpus.ERROR_INDUCING_KEY_SEQUENCES) >= 1


def test_error_inducing_pool_keeps_the_unbalanced_parenthesis_cases() -> None:
    """**プールは 9 経路を 1 つも欠かない。**

    実装中、対応の無い `rparen` を持つ経路(`unbalanced_parenthesis_cases`)を
    プールから除けば `pnpm heavy` が緑になることが分かった——`needsPrecedence`
    が `right` 全体を 1 本のキー列として括弧の対応を見ており、`ac` が engine を
    初期状態に戻すことを知らなかったからである。**除いたのは入力のほうでは
    なく、直すべきは判定のほうだった**(`ac` で組を捨てる)。除いていたら、
    「括弧の構文エラーから `ac` で復帰する」という形がコーパスから丸ごと
    抜けていた。

    9 経路のうちアンダーフローの 2 件は `expect.error` を持たない(丸め潰れは
    値域を外れたことにならない)ので、プールに入るのはエラーになる 28 件。
    """
    with_parens = [
        keys
        for keys in generate_corpus.ERROR_INDUCING_KEY_SEQUENCES
        if "lparen" in keys or "rparen" in keys
    ]
    assert len(with_parens) == 2, with_parens
    assert len(generate_corpus.ERROR_INDUCING_KEY_SEQUENCES) == 28


# --- 結合方向(`associativity-000.json`、計画 Task 4、設計書 §6) -------------


def _assoc_shard() -> dict:
    """テスト全体で 1 枚を作り直さずに使い回す。生成は 0.2 秒未満である。"""
    return generate_corpus.build_assoc_shard(seed=20260828, count=2000)


_ASSOC = _assoc_shard()
_ASSOC_KEY_OPS = {key: op for op, key in BINARY_KEYS.items()}


def _flat_chain_of(keys: list[str]) -> tuple[list, list[str]]:
    """平坦なキー列を項と演算子に戻す。**生成器の出力を読み直す側の実装。**

    生成器が持っている `terms`/`ops` をそのまま受け取ると、テストは生成器の
    内部状態を写すだけになる。ここはコミットされる JSON のキー列だけから
    組み直す——`keys` が壊れていれば、ここで戻せない。
    """
    terms: list = []
    ops: list[str] = []
    digits = ""
    for key in keys:
        if key == "eq":
            break
        if key.isdigit():
            digits += key
            continue
        if key not in _ASSOC_KEY_OPS:
            raise AssertionError(f"unexpected key {key!r} in a flat associativity chain: {keys!r}")
        terms.append(Num(int(digits)))
        digits = ""
        ops.append(_ASSOC_KEY_OPS[key])
    terms.append(Num(int(digits)))
    return terms, ops


def test_the_associativity_shard_is_deterministic() -> None:
    assert generate_corpus.build_assoc_shard(seed=20260828, count=200) == (
        generate_corpus.build_assoc_shard(seed=20260828, count=200)
    )


def test_every_associativity_case_carries_a_known_stratum() -> None:
    """層の名前は 5 つだけ。**知らない名前が入ると内訳が黙って崩れる。**"""
    known = {*generate_corpus.ASSOC_CHAINS, generate_corpus.ASSOC_CONTROL_STRATUM}
    seen = {case["stratum"] for case in _ASSOC["cases"]}
    assert seen == known, seen
    assert _ASSOC["strata"] == {
        stratum: sum(1 for case in _ASSOC["cases"] if case["stratum"] == stratum)
        for stratum in sorted(seen)
    }


def test_the_control_group_is_exactly_half_of_the_shard() -> None:
    """**対照群が痩せたら、この変異は「無差別に壊していない」と言えなくなる。**

    平坦なキー列 1 本につき全括弧の双子が 1 本。半分が対照群であることは、
    `associativity-flip` が**シャードの一部だけ**を赤くするという主張の土台
    である(設計書 §6)。
    """
    control = [
        case for case in _ASSOC["cases"] if case["stratum"] == generate_corpus.ASSOC_CONTROL_STRATUM
    ]
    assert len(control) * 2 == len(_ASSOC["cases"])
    assert len(_ASSOC["cases"]) == 2000


def test_every_chain_stratum_has_cases() -> None:
    """表に書いた形が 0 件、を許さない(`errors-000.json` と同じ規律)。"""
    for stratum in generate_corpus.ASSOC_CHAINS:
        assert _ASSOC["strata"].get(stratum, 0) >= 20, (stratum, _ASSOC["strata"])


def test_the_twins_differ_only_in_their_parentheses() -> None:
    """双子は**同じ式・同じ期待値**で、キー列だけが違う。

    片方は括弧を 1 つも打たず、もう片方は全部の二項を括弧で囲む。engine が
    同じ答えを出すべき理由が「結合方向」だけになる。
    """
    cases = _ASSOC["cases"]
    for flat, control in zip(cases[0::2], cases[1::2], strict=True):
        assert control["stratum"] == generate_corpus.ASSOC_CONTROL_STRATUM
        assert flat["stratum"] != generate_corpus.ASSOC_CONTROL_STRATUM
        assert flat["expr"] == control["expr"]
        assert flat["expect"] == control["expect"]
        assert "lparen" not in flat["keys"], flat
        # 全括弧の側は、二項演算子と同じ数だけ組を開く(`to_keys` は根も包む)。
        operators = sum(1 for key in flat["keys"] if key in _ASSOC_KEY_OPS)
        assert control["keys"].count("lparen") == operators, control
        assert control["keys"].count("rparen") == operators, control


def test_every_flat_chain_would_change_its_answer_if_the_folding_flipped() -> None:
    """**踏んだと言えるのは、二つの読み方が別の答えを出すときだけ。**

    加算と乗算は結合的なので `9 + 4 + 3` はどちらの読み方でも 16 になる。
    そういう列ばかりを積むと、シャードは大きいのに `associativity-flip` を
    1 件も捕まえられない——「大量に踏んだ」が「大量に何も試していない」に
    化ける。ここはコミットされるキー列そのものから両方の読みを組み直して、
    差が生成側のふるいの下限以上であることを確かめる。
    """
    flat_cases = [
        case for case in _ASSOC["cases"] if case["stratum"] != generate_corpus.ASSOC_CONTROL_STRATUM
    ]
    assert len(flat_cases) == 1000
    for case in flat_cases:
        terms, ops = _flat_chain_of(case["keys"])
        documented, other = generate_corpus._assoc_trees(terms, ops)
        value = evaluate(documented)
        alternative = evaluate(other)
        gap = abs(value - alternative) / max(abs(value), mp.mpf(1))
        assert gap >= generate_corpus.ASSOC_MIN_RELATIVE_GAP, (case["id"], case["expr"], gap)
        assert math.isclose(float(value), case["expect"]["re"], rel_tol=1e-15), case["id"]


def test_the_power_stratum_takes_the_whole_reachable_box() -> None:
    """`xʸ` の連鎖は数え上げられるほど狭いので、乱択せず全部使う。

    **箱の中で通るものが 1 つでも漏れていたら赤くする。** 乱択に戻した
    (あるいは箱を狭めた)ことに、件数が減るだけでは気づけない。
    """
    reachable = [
        generate_corpus._flat_key_sequence(terms, ops)
        for terms, ops in generate_corpus._power_chains()
        if generate_corpus.assoc_value(terms, ops) is not None
    ]
    in_shard = [case["keys"] for case in _ASSOC["cases"] if case["stratum"] == "power"]
    assert sorted(map(tuple, in_shard)) == sorted(map(tuple, reachable))
    assert len(reachable) == 27


def test_no_associativity_case_needs_precedence() -> None:
    """**このシャードは優先順位を踏まない。** 段を混ぜていないからである。

    混ざると `precedence-000.json` の担当と重なり、赤が出たときにどちらが
    原因か分からなくなる。`web/tests/heavy/corpus.spec.ts` は値シャードごとに
    「優先順位を踏んだ件数」を実データから数えて、`precedence-000.json` 以外は
    0 件であることを固定している——ここが崩れると向こうが赤くなる。
    """
    assert not [case["id"] for case in _ASSOC["cases"] if _needs_precedence(case["keys"])]


def test_the_model_enumerates_every_required_cell_exactly_once() -> None:
    """設計書 §7.2・§15.1 の 1。**要求セルは一意に列挙される。**

    実測(2026-08-25、コミット済みコーパス): loan 系 4 op と `loan_term` が各 150
    (金利 10 水準 × 期間 15 水準の全組合せ)、`compound_grow` と
    `compound_deposit_for` が各 266、`compound_periods_for` が 56
    (**行数ではなく 2 因子セルの数**)。
    """
    requirements = corpus_calls.FINANCE_REQUIREMENTS
    assert [r.scope for r in requirements] == [
        "loan_forward",
        "loan_principal",
        "loan_bonus_forward",
        "loan_bonus_principal",
        "loan_term",
        "compound_grow",
        "compound_deposit_for",
        "compound_periods_for",
    ]
    assert {r.scope: len(r.cells) for r in requirements} == {
        "loan_forward": 150,
        "loan_principal": 150,
        "loan_bonus_forward": 150,
        "loan_bonus_principal": 150,
        "loan_term": 150,
        "compound_grow": 266,
        "compound_deposit_for": 266,
        "compound_periods_for": 56,
    }
    for requirement in requirements:
        ids = [cell.id for cell in requirement.cells]
        assert len(ids) == len(set(ids)), f"{requirement.id} にセルの重複がある"


def test_the_model_reads_the_levels_from_the_factor_tables() -> None:
    """設計書 §7.1「既存水準をモデルの一次資料とする。写しを作ってはならない」。

    **因子表を直せば要求セルも動く**ことを確かめる。ここで水準を書き写して
    しまうと、因子表を直した日に片方だけが古くなる。
    """
    loan = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "loan_forward")
    assert {dict(cell.axes)["rate"] for cell in loan.cells} == set(
        corpus_calls.PAIRWISE_RATE_LEVELS
    )
    assert {dict(cell.axes)["n"] for cell in loan.cells} == {
        str(n) for n in corpus_calls.PAIRWISE_LOAN_TERM_LEVELS
    }
    grow = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "compound_grow")
    assert {dict(cell.axes).get("periods") for cell in grow.cells} >= {
        str(n) for n in corpus_calls.PAIRWISE_COMPOUND_TERM_LEVELS
    }


def test_loan_term_calls_its_second_factor_the_target() -> None:
    """設計書 §8.2。**`loan_term` の期間は入力ではなく答**なので、因子の名前を
    `n` と分ける。同じ `n` で通すと、被覆の集計が「入力に在った値」と
    「答として出た値」を混ぜてしまう。
    """
    term = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "loan_term")
    assert {name for cell in term.cells for name, _ in cell.axes} == {"rate", "target_n"}
    assert term.cells[0].id.startswith("loan_term/rate=")
    assert "target_n=" in term.cells[0].id


def test_the_model_counts_pairs_not_rows() -> None:
    """設計書 §12.4。**構成行と要求セルは同じ単位ではない。**
    `compound_grow` は 140 行で 266 セルを踏む。
    """
    grow = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "compound_grow")
    assert len(corpus_calls._PAIRWISE_COMPOUND_GROW_ROWS) == 140
    assert len(grow.cells) == 266
    assert all(len(cell.axes) == 2 for cell in grow.cells)


def test_coverage_is_recomputed_from_the_generated_cases() -> None:
    """設計書 §15.1 の 2 と 7。**被覆はケースから数え直せる。**

    1 件のケースは複数のセルを踏む(§9.3)——4 因子なら 2 因子の組が 6 通り。
    重複してケースを作らなくても、集合へ足すだけで済む。
    """
    one = {
        "kind": "call",
        "id": "fin-000000",
        "op": "compound_grow",
        "stratum": "compound_grow/pairwise_0000",
        "input": {"rate": "20", "periods": 12, "periods_per_year": 2, "tax": True},
        "expect": {},
    }
    assert len(corpus_calls.covered_cells_from_cases([one])) == 6


def test_values_outside_the_level_table_are_not_counted() -> None:
    """**水準表の外の値を 1 セルとして数えない。**

    乱択のケースは水準の外の値を持つ。素朴に数えると要求セルと単位が合わなく
    なる(実測 2026-08-25: `compound_deposit_for` の全 420 件は「因子と値の組」を
    1,491 通り踏んでいる。要求セルは 266 しかない)。
    """
    stray = {
        "kind": "call",
        "id": "fin-000001",
        "op": "compound_grow",
        "stratum": "compound_grow/random",
        "input": {"rate": "3.3", "periods": 7, "periods_per_year": 2, "tax": True},
        "expect": {},
    }
    covered = corpus_calls.covered_cells_from_cases([stray])
    assert all("rate=3.3" not in cell.id for cell in covered)
    # `periods=7` と `ppy=2` と `tax=true` は水準なので、その 3 つの組だけが残る。
    assert len(covered) == 3


def test_the_recount_actually_compares_something() -> None:
    """**「何も比較していないのに緑」を潰す**(監視役の指摘、2026-08-26)。

    水準へ写す判定が全件を素通しするようになっても、被覆の合計だけを見ていると
    気づけない。**踏んだ件数と弾いた件数の両方が 0 でないこと**を、実物の
    コーパスに対して測る。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    cases = [c for c in shard["cases"] if c["op"] in corpus_calls.COVERAGE_FACTORS]
    on_level = 0
    off_level = 0
    for case in cases:
        factors = corpus_calls.COVERAGE_FACTORS[case["op"]]
        keys = corpus_calls._COVERAGE_INPUT_KEYS.get(case["op"], ())
        if not keys:
            continue
        if all(key in case["input"] and case["input"][key] in factors[name] for name, key in keys):
            on_level += 1
        else:
            off_level += 1
    # **どちらの帯も実在する。** 片方が 0 なら、判定は何も分けていない。
    assert on_level >= 500, f"水準に載ったケースが {on_level} 件しかない"
    assert off_level >= 500, f"水準の外のケースが {off_level} 件しかない(判定が素通しでは)"


def test_loan_term_is_not_counted_from_its_input() -> None:
    """設計書 §8.2。**`loan_term` の期間は入力ではなく答**なので、この関数は
    `loan_term` のケースからセルを数えない(Task 4 の記録が担う)。
    """
    case = {
        "kind": "call",
        "id": "fin-000002",
        "op": "loan_term",
        "stratum": "loan_term/pairwise_0000",
        "input": {"principal": "20000000", "rate": "20", "payment": "300000"},
        "expect": {},
    }
    assert corpus_calls.covered_cells_from_cases([case]) == set()


def test_loan_term_records_target_and_actual_separately() -> None:
    """設計書 §8.2。**答が目標と一致した行だけが `covered`。**

    正算で作った月額を逆算へ戻すと、円単位の丸めのぶんだけ答がずれることがある。
    ずれた行は計算の照合には使えるが、**目標期間セルを被覆したことにはならない。**

    実測(2026-08-25、Task 4 の時点): covered 74 / unmet 59 / excluded 17。
    **その Task は挙動を変えず**、いまの構成のまま何が起きているかを記録した。

    **2026-08-29(Task 5)に covered 126 / unmet 0 / excluded 24 へ動いた。**
    決定的な構成探索(`_construct_loan_term_row`)が入り、**目標期間に乗る
    `(元本, 月額)` を固定順で探すようになった**ため。**基準を緩めたのではなく、
    ケースの作り方を変えた**——`unmet` が 0 になったのは、乗らなかった行を
    除外へ逃がしたからではなく、**52 行が実際に目標へ乗るようになった**からである
    (乗らない 7 行は `target_n = 1201` で、`MAX_TERM_MONTHS = 1200` である以上
    答になり得ない)。
    """
    facts = corpus_calls.LOAN_TERM_FACTS
    assert len(facts) == 150, "要求セルと同じ数だけ記録が要る(構成できなかった行も含めて)"
    states = collections.Counter(fact.state for fact in facts)
    assert states == {"covered": 126, "excluded": 24}
    for fact in facts:
        if fact.state == "covered":
            assert fact.actual_n == fact.target_n
        if fact.state == "unmet":
            assert fact.actual_n != fact.target_n
        if fact.state == "excluded":
            assert fact.actual_n is None


def test_loan_term_coverage_counts_only_the_matching_rows() -> None:
    """設計書 §15.1 の 8。**`actual_n == target_n` のときだけ目標期間セルを被覆する。**"""
    covered = corpus_calls.loan_term_covered_cells()
    # 74 → 126(2026-08-29、Task 5 の決定的構成探索)。**数え方は変えていない**
    # ——`actual_n == target_n` の行だけを数えるのは同じで、その行が増えた。
    assert len(covered) == 126
    facts = {(f.rate_level, str(f.target_n)): f for f in corpus_calls.LOAN_TERM_FACTS}
    for cell in covered:
        axes = dict(cell.axes)
        fact = facts[(axes["rate"], axes["target_n"])]
        assert fact.actual_n == fact.target_n


def test_the_recorded_rows_are_the_ones_the_corpus_actually_has() -> None:
    """**記録が絵空事でないこと。** `covered` と `unmet` の行の入力は、
    生成されたコーパスに実在するケースと一致していなければならない
    ——記録だけが独り歩きすると、被覆の主張が現物から離れる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    in_corpus = {
        (case["input"]["principal"], case["input"]["rate"], case["input"]["payment"])
        for case in shard["cases"]
        if case["op"] == "loan_term" and case["stratum"].startswith("loan_term/pairwise")
    }
    built = {
        (str(fact.principal), fact.rate_level, str(fact.payment))
        for fact in corpus_calls.LOAN_TERM_FACTS
        if fact.state != "excluded"
    }
    assert built == in_corpus, "記録した行と、コーパスに在るペアワイズのケースが食い違う"
    # 133 → 126(2026-08-29、Task 5)。**`unmet` が 0 になったので、
    # 「除外でない行」＝「被覆した行」になった**——以前は 74 の被覆に 59 の
    # 未達が混ざって 133 だった。**行が減ったのではなく、乗らない行が
    # コーパスから出て理由付きの除外になった。**
    assert len(in_corpus) == 126


def test_the_recorded_answers_come_from_the_reference() -> None:
    """**`actual_n` は参照実装が返した値そのものである。** 写し間違いを防ぐため、
    記録の全行を参照実装へ問い直して突き合わせる(133 行)。
    """
    checked = 0
    for fact in corpus_calls.LOAN_TERM_FACTS:
        if fact.state == "excluded":
            continue
        result = corpus_calls.loan_ref.compute(
            "loan_term",
            {
                "principal": str(fact.principal),
                "rate": fact.rate_level,
                "payment": str(fact.payment),
            },
        )
        if "error" in result:
            assert fact.actual_n is None
            assert fact.error == result["error"]
        else:
            assert fact.actual_n == int(result["n"])
        checked += 1
    # 133 → 126(2026-08-29、Task 5)。除外でない行がそのまま被覆した行になった。
    assert checked == 126, f"問い直した行が {checked} 行しかない"


def test_the_deterministic_search_moves_fifty_two_rows_into_coverage() -> None:
    """設計書 §8.3。**乱数を使わない固定順の候補列で目標期間を狙う。**

    空回しの実測(2026-08-29、コミット済みの生成器に対して): 150 行のうち
    **126 行が構成でき、24 行が構成できない。** 決め手の内訳は
    **月額 +0 円が 76 行・+1 円が 50 行**で、+0 の 76 は「もともと乗っていた
    74 行」＋「**別の元本で乗るようになった 2 行**」である
    ——**元本候補を最初の 1 つで打ち切らず、12 通り全部試すようになった**ため。

    **`unmet` が 0 であることがこの Task の主張である。** 被覆数はそこから
    導かれる量なので、両方を書く(片方だけだと、除外へ逃がして緑にできる)。
    """
    states = collections.Counter(fact.state for fact in corpus_calls.LOAN_TERM_FACTS)
    assert states["unmet"] == 0, "構成できなかった行は、除外として理由を付ける"
    assert states["covered"] == 126
    assert states["excluded"] == 24  # 17(正算が本物のエラー) + 7(1201 は答になり得ない)
    assert sum(states.values()) == 150


def test_the_unreachable_term_is_excluded_as_not_applicable() -> None:
    """`loan_ref.MAX_TERM_MONTHS` が 1200 なので、`loan_term` は 1201 を返せない。

    **構成の失敗ではなく、その操作にその水準が無い**——理由コードを取り違えない。
    `inverse_target_unconstructible` は「努力したが作れなかった」であり、
    こちらは「**そもそも答の範囲に無い**」である。
    """
    exclusions = corpus_calls.loan_term_exclusions()
    not_applicable = [
        e for e in exclusions.values() if e.reason is corpus_coverage.Reason.NOT_APPLICABLE
    ]
    # **10 であって 7 ではない**(2026-08-29、計画の数を訂正した)。計画のテストは
    # 7 を期待していたが、それは Task 4 の「探索が尽きた 7 行」を数えた値である。
    # **`target_n = 1201` の行は 10 ある**——7 行は探索が尽き、3 行は正算が本物の
    # エラーを返す。**後者も 1201 は答になり得ない**ので、理由は同じである。
    # **根拠が症状に勝つ**: 入力を作れないことは結果であって、覆えない理由ではない。
    assert len(not_applicable) == 10
    assert all("target_n=1201" in e.cell.id for e in not_applicable)
    assert all(str(loan_ref.MAX_TERM_MONTHS) in e.detail for e in not_applicable)
    # 1201 のセルが**ほかの理由に紛れていない**ことも見る(取り違えの逆向き)。
    assert not [
        e
        for e in exclusions.values()
        if "target_n=1201" in e.cell.id and e.reason is not corpus_coverage.Reason.NOT_APPLICABLE
    ]


def test_the_unconstructible_rows_say_the_forward_calculation_failed() -> None:
    """残り 17 は「正算が本物のエラー」である。**2 つの理由を混ぜない。**"""
    exclusions = corpus_calls.loan_term_exclusions()
    unconstructible = [
        e
        for e in exclusions.values()
        if e.reason is corpus_coverage.Reason.INVERSE_TARGET_UNCONSTRUCTIBLE
    ]
    assert len(unconstructible) == 14
    assert all("target_n=1201" not in e.cell.id for e in unconstructible)
    assert len(exclusions) == 24
    # **判断区分は動かない。** 両方 `reasonable` なので、10/14 と 7/17 のどちらに
    # 分けても「安全」欄の数は同じである——**変わるのは理由の綴りだけ**である。
    assert all(e.disposition is corpus_coverage.Disposition.REASONABLE for e in exclusions.values())


def test_a_constructed_row_really_hits_its_target() -> None:
    """設計書 §8.3 の「成功時は assert する」。

    **構成不能を黙って別の期間のケースへ置き換えていないこと**を、参照実装に
    聞いて確かめる。**探索が「見つけた」と言った行を、もう一度外から問い直す。**
    """
    checked = 0
    for fact in corpus_calls.LOAN_TERM_FACTS:
        if fact.state != "covered":
            continue
        result = loan_ref.compute(
            "loan_term",
            {
                "principal": str(fact.principal),
                "rate": fact.rate_level,
                "payment": str(fact.payment),
            },
        )
        assert "error" not in result, f"被覆と記録した行が逆算でエラーになる: {fact}"
        assert int(result["n"]) == fact.target_n
        checked += 1
    assert checked == 126, f"問い直した行が {checked} 行しかない"


def test_compound_deposit_for_coverage_uses_only_its_own_cases() -> None:
    """設計書 §15.1 の 9。**`compound_grow` が同じペアを踏んでいても数えない。**

    **258 であって 247 ではない**(2026-08-29、Task 6)。計画は 247 被覆 / 19 除外
    を見込んでいたが、**19 のうち 11 は溢れていなかった**——ペアワイズ 1 行が
    運ぶのはペア 6 組で、**期間で溢れて行ごと捨てると、期間を含まない組まで
    一緒に落ちていた。** `_deposit_for_construction` が周期を先に振るように
    なり、**溢れずに作れるものは作る**ようになった。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    mine = {cell for cell in covered if cell.scope == "compound_deposit_for"}
    assert len(mine) == 258
    grow_only = {
        corpus_coverage.Cell("compound_deposit_for", cell.axes)
        for cell in covered
        if cell.scope == "compound_grow"
    }
    assert grow_only - mine, "compound_grow だけが踏んでいるペアが在るはず(混ぜていない証拠)"


def test_the_overflowing_pairs_are_excluded_as_source_overflow() -> None:
    """正算が u64 を溢れさせるので、逆算の目標値が作れない(設計書 §10.1)。

    **積立額を最小の 1 円にしても溢れる**ことを、参照実装に聞いて確かめる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    exclusions = corpus_calls.compound_deposit_for_exclusions(covered)
    assert len(exclusions) == 8
    assert all(e.reason is corpus_coverage.Reason.SOURCE_OVERFLOW for e in exclusions.values())
    for cell in exclusions:
        axes = dict(cell.axes)
        assert (
            corpus_calls._compound_reached(0, 1, axes["rate"], 1, int(axes["periods"]), False)
            is None
        )
    # **整合式が閉じている。** 266 = 258 + 8 + 0。
    mine = {cell for cell in covered if cell.scope == "compound_deposit_for"}
    requirement = corpus_calls._REQUIREMENT_OF["compound_deposit_for"]
    assert len(requirement.cells) == len(mine) + len(exclusions)


def test_the_excluded_pairs_are_the_ones_no_construction_can_reach() -> None:
    """**除外の下限を、探索とは独立に確かめる。**

    除外の一覧は「いまの生成器が作れなかったもの」だが、それだけでは
    **生成器を弱くすれば除外を増やせてしまう。** ここは因子表の全通り
    (金利 × 期間 × 周期 × 税)を直接あたって、**どう構成しても正算が溢れる
    セル**を数える——**この 8 は生成器の都合ではなく、u64 の都合である。**
    """
    factors = corpus_calls.PAIRWISE_COMPOUND_GROW_FACTORS
    requirement = corpus_calls._REQUIREMENT_OF["compound_deposit_for"]
    unreachable = set()
    for cell in requirement.cells:
        axes = dict(cell.axes)
        rates = [axes["rate"]] if "rate" in axes else list(factors["rate"])
        periods = [int(axes["periods"])] if "periods" in axes else list(factors["periods"])
        per_years = (
            [int(axes["periods_per_year"])]
            if "periods_per_year" in axes
            else list(factors["periods_per_year"])
        )
        taxes = [axes["tax"] == "True"] if "tax" in axes else list(factors["tax"])
        if not any(
            corpus_calls._compound_reached(0, 1, str(r), int(p), int(n), bool(t)) not in (None, 0)
            for r in rates
            for n in periods
            for p in per_years
            for t in taxes
        ):
            unreachable.add(cell)
    assert len(unreachable) == 8
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    assert set(corpus_calls.compound_deposit_for_exclusions(covered)) == unreachable


def test_an_unexplained_gap_is_not_given_a_reason() -> None:
    """**説明できない未達に理由を貼らない**(設計書 §10、CLAUDE.md の「未分類理由」)。

    被覆の集合から 1 つ抜くと、その分だけ「構成できるはずなのに未達」が生まれる
    ——そこで `source_overflow` を貼れば表は綺麗になるが、**嘘になる。**
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    reachable = next(
        cell
        for cell in covered
        if cell.scope == "compound_deposit_for" and "periods" in dict(cell.axes)
    )
    with pytest.raises(RuntimeError, match="理由を説明できない"):
        corpus_calls.compound_deposit_for_exclusions(covered - {reachable})


def test_the_finance_shard_carries_its_coverage() -> None:
    """設計書 §11.2・§18。**空間の地図を、覆ったケースの隣に置く。**"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    cov = shard["coverage"]
    assert cov["schema"] == corpus_coverage.COVERAGE_SCHEMA
    assert cov["model"] == "finance-v1"
    assert [r["id"] for r in cov["requirements"]] == [
        r.id for r in corpus_calls.FINANCE_REQUIREMENTS
    ]
    for r in cov["requirements"]:
        assert r["required_cells"] == r["covered_cells"] + r["excluded_cells"] + r["unmet_cells"]
        assert r["unmet_cells"] == 0, f"{r['id']} に未達が残っている"
    assert cov["generation_rejections"]["oracle_search_limit"] == 0
    assert list(shard) == ["schema", "generated_by", "rejections", "coverage", "cases"]


def test_the_coverage_totals_are_the_ones_we_measured() -> None:
    """**8 対象それぞれの数を固定する。**

    合計だけを見ると、**片方が減って片方が増えた**走行を見逃す。実測
    (2026-08-29、Task 5・6 のあと): `loan_term` は 126 + 24、
    `compound_deposit_for` は 258 + 8、残る 6 対象は全被覆。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    got = {
        r["scope"]: (r["covered_cells"], r["excluded_cells"], r["required_cells"])
        for r in shard["coverage"]["requirements"]
    }
    assert got == {
        "loan_forward": (150, 0, 150),
        "loan_principal": (150, 0, 150),
        "loan_bonus_forward": (150, 0, 150),
        "loan_bonus_principal": (150, 0, 150),
        "loan_term": (126, 24, 150),
        "compound_grow": (266, 0, 266),
        "compound_deposit_for": (258, 8, 266),
        "compound_periods_for": (56, 0, 56),
    }


def test_the_rejections_are_copied_not_merged() -> None:
    """設計書 §10.3。**乱択候補の棄却と、要求セルの除外を同じ入れ物に混ぜない。**

    `rejections` の綴りは既存の読み手(`report.ts` の `renderGaveUp`)が使うので
    変えない——`coverage.generation_rejections` はその**写し**である。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    rejections, cov = shard["rejections"], shard["coverage"]
    assert cov["generation_rejections"]["candidate_duplicate"] == rejections["dup"]
    assert (
        cov["generation_rejections"]["oracle_near_yen_boundary"]
        == rejections["reference_gave_up"]["near_yen_boundary"]
    )
    # **除外セルは棄却の合計に入らない。** 混ざっていれば、この 2 つは一致しない。
    assert len(cov["excluded_cells"]) == 32
    assert cov["generation_rejections"]["candidate_duplicate"] != len(cov["excluded_cells"])


def test_generating_twice_is_byte_identical_including_coverage() -> None:
    """設計書 §15.1 の 10。**順序が走行ごとに動くと、固定コーパスが一致しない。**"""
    first = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    second = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    # **並びそのものも固定する。** `sort_keys` を通すと順序の崩れが隠れる。
    assert json.dumps(first) == json.dumps(second)


def test_dropping_one_required_cell_shows_up_as_unmet() -> None:
    """設計書 §15.1 の 5。**要求セルを 1 つ落とすと `unmet` になる。**

    緑のまま通ってしまうなら、この集計は何も主張していない。
    """
    requirement = corpus_calls._REQUIREMENT_OF["compound_grow"]
    covered = set(requirement.cells) - {requirement.cells[0]}
    summary = corpus_coverage.summarize(requirement, covered, {})
    assert summary["unmet_cells"] == 1
    assert summary["status"] == "incomplete"


def test_removing_one_exclusion_makes_the_generator_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """設計書 §15.1 の 6・§13.1。**除外を 1 つ消すと未達が残り、生成器が落ちる。**

    **変異はファイルではなく `monkeypatch` で当てる**——同じワークツリーに別の
    作業が居るので、書き換えて戻す手順は使わない。
    """
    monkeypatch.setattr(corpus_calls, "loan_term_exclusions", dict)
    with pytest.raises(RuntimeError, match="未達"):
        corpus_calls.build_finance_shard(seed=20260821, count=3500)


def test_an_unknown_reason_code_is_refused() -> None:
    """設計書 §13.1。**`other` は無い。** 文字列を理由として渡せない。"""
    cell = corpus_calls._REQUIREMENT_OF["loan_term"].cells[0]
    made_up = corpus_coverage.Exclusion(cell, "made_up_reason", "x")  # type: ignore[arg-type]
    with pytest.raises((KeyError, ValueError)):
        _ = made_up.disposition


def test_the_unconstructible_rows_really_have_no_principal_that_works() -> None:
    """**`inverse_target_unconstructible` の根拠を、実際に尽くして確かめる。**

    生成器はこの行で**最初の元本**が `LoanError` を返した時点で諦める
    ——`_pairwise_forward_result` がそう書いてある(元本を変えても消えない、
    という 2026-08-20 の実測に依拠している)。**依拠したままにしない。**
    ここで**元本 12 通りすべて**を試し、1 つも正算が通らないことを見る。

    **通る元本が 1 つでも見つかったら、この除外は根拠を失う**
    ——そのときは除外を消すのではなく、**その元本で行を作る**のが直しである。
    """
    unconstructible = [
        cell
        for cell, exclusion in corpus_calls.loan_term_exclusions().items()
        if exclusion.reason is corpus_coverage.Reason.INVERSE_TARGET_UNCONSTRUCTIBLE
    ]
    assert len(unconstructible) == 14
    for cell in unconstructible:
        axes = dict(cell.axes)
        rate, target = axes["rate"], int(axes["target_n"])
        num, den = loan_ref.rate_fraction(rate)
        for offset in corpus_calls._LOAN_PAIRWISE_PRINCIPAL_OFFSETS:
            principal = corpus_calls._LOAN_PAIRWISE_PRINCIPAL_BASE + offset
            try:
                loan_ref.forward(principal, num, den, target, 0)
            except loan_ref.LoanError, ValueError:
                continue
            raise AssertionError(
                f"{cell.id}: 元本 {principal} なら正算が通る。"
                "構成できないという除外の根拠が崩れている"
            )


def test_the_two_unconstructible_reasons_say_different_things(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**「正算が落ちた」と「探索が尽きた」を同じ文で書かない。**

    実データでは前者しか出ない(後者に当たる行はすべて `target_n = 1201` で
    `not_applicable` に吸われる)ので、**分岐を作り物で通す**——通らない枝は
    書いた本人しか読まないまま腐る。
    """
    facts = (
        corpus_calls.LoanTermFact("1.5", 12, 20_000_000, None, None, "Overflow", "excluded"),
        corpus_calls.LoanTermFact(
            "1.5", 13, 20_000_000, 100_000, None, "no-construction", "excluded"
        ),
    )
    monkeypatch.setattr(corpus_calls, "LOAN_TERM_FACTS", facts)
    details = {
        int(dict(cell.axes)["target_n"]): exclusion.detail
        for cell, exclusion in corpus_calls.loan_term_exclusions().items()
    }
    assert "正算が Overflow を返す" in details[12]
    assert "尽くしても" not in details[12], "走っていない探索を根拠にしている"
    assert "尽くしても" in details[13]
    assert "逆算が目標期間に乗らない" in details[13]


def test_every_covered_elsewhere_pointer_resolves_to_a_real_cell() -> None:
    """**補足のポインタが、モデルの中の実在するセルを指していること。**

    `covered_elsewhere` は「別の操作で同じ組を踏んでいる」という補足で、
    **元のセルを被覆済みには変えない**。ただの文字列なので、**因子表や
    `cell_id` の書式が変わると黙って腐る**——指す先が消えても誰も気づかない。

    **自分自身は指さない。** 指したら「別のところで踏んでいる」は嘘になる。
    """
    known = {cell.id for req in corpus_calls.FINANCE_REQUIREMENTS for cell in req.cells}
    exclusions = {
        **corpus_calls.loan_term_exclusions(),
        **corpus_calls.compound_deposit_for_exclusions(
            corpus_calls.covered_cells_from_cases(
                corpus_calls.build_finance_shard(seed=20260821, count=3500)["cases"]
            )
            | corpus_calls.loan_term_covered_cells()
        ),
    }
    pointers = [(cell, p) for cell, e in exclusions.items() for p in e.covered_elsewhere]
    assert len(pointers) == 32
    for cell, pointer in pointers:
        assert pointer in known, f"{cell.id} の covered_elsewhere が指す {pointer} が無い"
        assert pointer != cell.id, f"{cell.id} が自分自身を指している"
