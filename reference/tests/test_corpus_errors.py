"""`corpus_errors.py`(エラー種別、設計書 §5.1)。

**ここでも値の正しさを再検算しない。** ただしこのシャードの主張は
「どの式がどの `CalcError` になるか」そのものなので、テストはその割り当てが
モジュールの docstring に書いた数学的な根拠と一致していることを固定する
(計画 2026-08-19-heavy-scientific-ui-report Task 2 Step 4)。
"""

from __future__ import annotations

from calcarc_reference.corpus_errors import (
    CALC_ERROR_KINDS,
    ERROR_TEXT,
    build_errors_shard,
    combinatorics_domain_cases,
    division_by_zero_cases,
    factorial_cases,
    inverse_trig_domain_cases,
    logarithm_domain_cases,
    sqrt_domain_cases,
    tan_pole_cases,
    unbalanced_parenthesis_cases,
    value_range_cases,
)

# 設計書 §5.1 が列挙した 9 経路。
SHAPES = (
    division_by_zero_cases,
    logarithm_domain_cases,
    sqrt_domain_cases,
    inverse_trig_domain_cases,
    tan_pole_cases,
    factorial_cases,
    combinatorics_domain_cases,
    value_range_cases,
    unbalanced_parenthesis_cases,
)


def test_every_shape_has_at_least_one_case() -> None:
    for shape in SHAPES:
        cases = shape()
        assert len(cases) >= 1, f"{shape.__name__} produced no cases"


def test_every_calc_error_kind_appears_at_least_once() -> None:
    # **種別ごとに 1 件以上**(計画 Task 2 Step 4)。5 種のどれかが欠けると、
    # そのシャードは「エラー種別を照合している」という顔をしながら、
    # 実は一部の種別を一度も踏んでいないことになる。
    shard = build_errors_shard()
    seen = {c["expect"]["error"] for c in shard["cases"] if "error" in c["expect"]}
    assert seen == set(CALC_ERROR_KINDS), (
        f"missing kinds: {set(CALC_ERROR_KINDS) - seen}, "
        f"unexpected kinds: {seen - set(CALC_ERROR_KINDS)}"
    )


def test_the_value_range_shape_asserts_the_overflow_underflow_asymmetry() -> None:
    # **この経路が主張の核心。** オーバーフローは Overflow になるが、
    # アンダーフローはエラーにならない(0.0 は f64 の値域の内側にあるので)。
    # 両方が揃っていないと、この非対称の主張が片側だけになる。
    cases = value_range_cases()
    with_error = [c for c in cases if "error" in c["expect"]]
    without_error = [c for c in cases if "error" not in c["expect"]]
    assert len(with_error) >= 1
    assert len(without_error) >= 1
    for case in with_error:
        assert case["expect"]["error"] == "Overflow"
    for case in without_error:
        # アンダーフローは「0 に丸まる」であって、Math ERROR ではない。
        assert case["expect"]["main"] != ERROR_TEXT


def test_factorial_separates_domain_from_range() -> None:
    # 階乗は「非負整数でない」(定義域)と「値が大きすぎる」(値域)の
    # 2 種類の違反を持ち、別の CalcError になる——同じ関数の docstring が
    # 両方の error.rs の説明を引いているので、実物でも両方を固定する。
    cases = factorial_cases()
    kinds = {c["expr"]: c["expect"]["error"] for c in cases}
    assert kinds["(-1)!"] == "DomainError"
    assert kinds["(1.5)!"] == "DomainError"
    assert kinds["(200)!"] == "Overflow"


def test_tan_pole_is_not_division_by_zero() -> None:
    # tan の極は分母(cos)が 0 になる構造上の極であって、除数として直接
    # 0 を渡す DivisionByZero とは error.rs が別の変種に分けている。
    cases = tan_pole_cases()
    assert len(cases) >= 1
    for case in cases:
        assert case["expect"]["error"] == "TrigPole"


def test_unbalanced_parenthesis_cases_do_not_wait_for_eq() -> None:
    # 対応しない ) は構文としてその場で不正なので、eq を待たずに
    # エラーになる(corpus_entry.py の小数点の 2 つ目と同じ形)。
    for case in unbalanced_parenthesis_cases():
        assert "eq" not in case["keys"]
        assert case["expect"]["error"] == "SyntaxError"


def test_combinatorics_domain_cases_all_end_with_eq() -> None:
    # nPr/nCr は二項演算子なので、右辺を打ち終えて eq を押すまでは
    # 演算が確定しない(単項の関数キーと違って即時には評価されない)。
    for case in combinatorics_domain_cases():
        assert case["keys"][-1] == "eq"
        assert case["expect"]["error"] == "DomainError"


def test_ids_are_unique_and_sequential() -> None:
    shard = build_errors_shard()
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)
    assert ids == [f"err-{i:06d}" for i in range(len(ids))]


def test_every_case_is_display_kind() -> None:
    shard = build_errors_shard()
    for case in shard["cases"]:
        assert case["kind"] == "display"
        assert case["keys"], f"{case['id']}: empty key sequence"
        assert case["mode"] == "Deg"
        assert "main" in case["expect"]


def test_the_shard_has_the_schema_and_no_tolerance() -> None:
    # 文字列の厳密一致で比べる表示シャードなので `tolerance` を持たない
    # (`web/tests/heavy/corpus.ts` の `DisplayShard` と合わせる)。
    shard = build_errors_shard()
    assert shard["schema"] == 1
    assert "tolerance" not in shard


def test_the_provenance_says_it_did_not_read_the_engine() -> None:
    shard = build_errors_shard()
    generated_by = shard["generated_by"]
    assert "error.rs" in generated_by
    assert "engine_table.rs" in generated_by
    # **「見ずに決めた」ことそのものを文中で言う。** レポートが「Rust の
    # 実装から作った期待値」と誤読しないための素性である。
    assert "見ず" in generated_by
