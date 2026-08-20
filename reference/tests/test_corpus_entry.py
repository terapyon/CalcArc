"""`corpus_entry.py`(入力途中の表示、設計書 §4.1)。

**ここでは値の正しさを再検算しない。** 正しさの根拠は
`crates/calcarc-core/tests/engine_table.rs`/`state.rs` であって、
このテストは「形ごとに 1 件以上あること」と「シャードの姿が壊れていないこと」
だけを固定する(計画 2026-08-19-heavy-scientific-ui-report Task 1 Step 4)。
"""

from __future__ import annotations

from calcarc_reference.corpus_entry import (
    build_entry_shard,
    exp_format_cases,
    leading_zero_cases,
    max_entry_len_cases,
    operator_pending_cases,
    paren_open_cases,
    second_decimal_point_cases,
    sign_toggle_cases,
)

# 計画 Task 1 Step 1 が列挙した 7 形。すべて `engine_table.rs`/`state.rs` に
# 根拠を持つ(各関数の docstring を見よ)。
SHAPES = (
    leading_zero_cases,
    second_decimal_point_cases,
    max_entry_len_cases,
    exp_format_cases,
    operator_pending_cases,
    paren_open_cases,
    sign_toggle_cases,
)

# `build_entry_shard` が実際に積む形。**計画 Task 2 Step 5 で全 7 形になった。**
# Task 1 時点は `second_decimal_point_cases` を欠いていた——
# `display-cases.spec.ts` がまだ `error` を照合できなかったため。Task 2 が
# `DisplayCase.expect.error` の照合を足したので、いまは積める
# (`corpus_entry.py` の `build_entry_shard` の docstring を見よ)。
BUILT_SHAPES = SHAPES


def test_every_shape_has_at_least_one_case() -> None:
    for shape in SHAPES:
        cases = shape()
        assert len(cases) >= 1, f"{shape.__name__} produced no cases"


def test_the_shard_carries_exactly_the_built_shapes() -> None:
    # **総件数が形の合計と一致すること。** 形が 1 つでも黙って落ちる/紛れ込む
    # と、この assert がまず気づく。
    shard = build_entry_shard()
    expected_total = sum(len(shape()) for shape in BUILT_SHAPES)
    assert len(shard["cases"]) == expected_total
    # **`second_decimal_point_cases` が静かに紛れ込んでいない**のではなく、
    # いまは**積まれていること**を固定する(Task 1 とは逆向きの主張。
    # 計画 Task 2 Step 5 が「積まれていないことを固定していたテストを、
    # 積まれていることに変える」と予告したのがここ)。
    built_keys = {tuple(c["keys"]) for c in shard["cases"]}
    for case in second_decimal_point_cases():
        assert tuple(case["keys"]) in built_keys


def test_every_case_is_display_kind_and_does_not_end_with_eq() -> None:
    # 打鍵の途中を主張するシャードなので、eq で終わるケースが 1 件でも
    # 混じると「確定した表示」を「途中の表示」と偽ることになる。
    shard = build_entry_shard()
    for case in shard["cases"]:
        assert case["kind"] == "display"
        assert case["keys"], f"{case['id']}: empty key sequence"
        assert case["keys"][-1] != "eq", f"{case['id']}: ends with eq"
        assert "main" in case["expect"]
        assert case["mode"] == "Deg"


def test_ids_are_unique_and_sequential() -> None:
    shard = build_entry_shard()
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)
    assert ids == [f"entry-{i:06d}" for i in range(len(ids))]


def test_the_provenance_names_the_calculator_spec_not_an_independent_reference() -> None:
    # **これがレポートの「仕様書からの写し」枠(第 3 枠)の根拠になる**
    # (設計書 §4.1・計画 Task 1 Step 3)。混ざると外部参照の件数が水増しされる。
    shard = build_entry_shard()
    generated_by = shard["generated_by"]
    assert "engine_table.rs" in generated_by
    assert "state.rs" in generated_by
    # 他の 15 枚の素性は `mpmath X.Y (N dps), Python 3.Z` /
    # `sympy X.Y (N dps), Python 3.Z` の版数の形をしている
    # (`generate_corpus.py` の `_provenance`/`_provenance_sympy`)。この
    # シャードはその形を取らない——版数を書けるほど何かを計算していない、
    # ということ自体が「仕様書からの写し」の証拠になる。
    assert "dps)" not in generated_by
    # 「独立に計算した値ではない」ことを文中で明言している。
    assert "独立" in generated_by
    # **仕様書の写しですらない 10 件を、素性が名指ししている。**
    # `max_entry_len` の 3 件目・`paren_open` の 4 件・`sign_toggle` の
    # 5 件は `engine_table.rs` に対応するテストが無く、実装(`state.rs`)から
    # 導いて engine を走らせて確かめた値である——engine の欠陥はその値に
    # そのまま写るので、この 10 件は欠陥を見つけられない(退行を留めるだけ)。
    # レポートが `generated_by` だけを読んで「仕様書からの写し 36 件」と
    # 書くと、その 10 件について実際より強い主張になる。
    assert "10 件" in generated_by
    assert "engine の欠陥は見つけられない" in generated_by
    # 名指しした 10 件が実際にその数であること。素性の文と実物がずれたら赤。
    weaker = len(max_entry_len_cases()[2:]) + len(paren_open_cases()) + len(sign_toggle_cases())
    assert weaker == 10


def test_the_shard_has_the_schema_and_no_tolerance() -> None:
    # 文字列の厳密一致で比べる表示シャードなので `tolerance` を持たない
    # (`web/tests/heavy/corpus.ts` の `DisplayShard` と合わせる)。
    shard = build_entry_shard()
    assert shard["schema"] == 1
    assert "tolerance" not in shard


def test_leading_zero_covers_00_and_the_bare_dot() -> None:
    keys_seen = {tuple(c["keys"]) for c in leading_zero_cases()}
    assert ("0", "0") in keys_seen
    assert ("dot",) in keys_seen


def test_second_decimal_point_is_an_error_before_eq() -> None:
    (case,) = second_decimal_point_cases()
    assert case["expect"]["main"] == "Math ERROR"
    assert case["expect"]["error"] == "SyntaxError"
    assert "eq" not in case["keys"]


def test_max_entry_len_caps_at_twelve_characters() -> None:
    for case in max_entry_len_cases():
        assert len(case["expect"]["main"]) <= 12


def test_exp_format_covers_the_open_exponent_and_its_del_stages() -> None:
    keys_seen = {tuple(c["keys"]) for c in exp_format_cases()}
    # del が指数の桁 → e マーカー → 仮数の文字、の 3 段で戻ること
    # (del_walks_out_of_the_exponent_one_stage_at_a_time)。
    assert ("1", "dot", "5", "exp", "3", "del") in keys_seen
    assert ("1", "dot", "5", "exp", "3", "del", "del") in keys_seen
    assert ("1", "dot", "5", "exp", "3", "del", "del", "del") in keys_seen


def test_sign_toggle_covers_a_fresh_entry_after_negation() -> None:
    # +/- の直後に打った桁は打ち直しであって、符号付きの続きにはならない。
    matches = [c for c in sign_toggle_cases() if c["keys"] == ["1", "2", "neg", "3"]]
    assert len(matches) == 1
    assert matches[0]["expect"]["main"] == "3"
