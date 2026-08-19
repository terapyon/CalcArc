"""生成器。**同じ種から常に同じコーパスが出ること**が最重要である。"""

import importlib.util
import json
import math
import pathlib
import random
import sys
from fractions import Fraction

import mpmath as mp
import pytest

from calcarc_reference import corpus_calls
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
    for key in keys:
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
    """
    offenders: list[str] = []
    for path in sorted(_CORPUS_GENERATED.glob("*.json")):
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
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    reasons = shard["rejections"]["reference_gave_up"]
    assert reasons["near_yen_boundary"] == 3
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
    """設計書 §4.11 の 5。最小の層が最大の層の 0.8 倍以上。"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=2000)
    compound_ops = set(corpus_calls.COMPOUND_OPS)
    counts: dict[int, int] = {}
    for case in shard["cases"]:
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
