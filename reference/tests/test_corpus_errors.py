"""`corpus_errors.py`(エラー種別、設計書 §5.1)。

**ここでも値の正しさを再検算しない。** ただしこのシャードの主張は
「どの式がどの `CalcError` になるか」そのものなので、テストはその割り当てが
モジュールの docstring に書いた数学的な根拠と一致していることを固定する
(計画 2026-08-19-heavy-scientific-ui-report Task 2 Step 4)。
"""

from __future__ import annotations

from calcarc_reference.corpus_entry import build_entry_shard
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
    value_range_cases,
)

# 設計書 §5.1 が列挙した 9 経路のうち、いま実装が並べる 8 経路。
# **括弧の 1 経路は 0.9.3 の C-6 で退役した**(`corpus_errors.py` の
# `build_errors_shard` の手前の註)。**§5.1 が 9 を挙げた事実は動かない**ので、
# ここは「9 のうち 8」と書く。
SHAPES = (
    division_by_zero_cases,
    logarithm_domain_cases,
    sqrt_domain_cases,
    inverse_trig_domain_cases,
    tan_pole_cases,
    factorial_cases,
    combinatorics_domain_cases,
    value_range_cases,
)


def test_every_shape_has_at_least_one_case() -> None:
    for shape in SHAPES:
        cases = shape()
        assert len(cases) >= 1, f"{shape.__name__} produced no cases"


def test_every_calc_error_kind_appears_at_least_once() -> None:
    """**種別ごとに 1 件以上**(計画 Task 2 Step 4)。

    5 種のどれかが欠ければ、コーパスは「エラー種別を照合している」という顔を
    しながら、実は一部の種別を一度も踏んでいないことになる。

    **0.9.3 の C-6 で、数える範囲が 1 枚から 2 枚に広がった。** 括弧の経路を
    退役させたとき、**`SyntaxError` はこのシャードから消えた**——退役した
    2 件が、このシャードで唯一の `SyntaxError` だったからである。
    **しかし種別そのものは失われていない**: `error.rs:18` は
    「対応しない `)` や `.` の重複など」と**2 つの作り方を挙げており**、
    **`.` の重複のほうは `corpus_entry` が持っている**(`3 . .`)。
    **`)` を押せなくする D-2 は、`.` の重複には触らない。**

    **だから主張は弱めず、場所だけ動かす**——**「よそで見張っている」を
    散文で書かず、ここで両方を実際に数える。** このテストが緑であるためには、
    **`entry` 側の `SyntaxError` が実在しなければならない**(消えれば赤くなる)。
    """
    shard = build_errors_shard()
    seen = {c["expect"]["error"] for c in shard["cases"] if "error" in c["expect"]}

    entry = build_entry_shard()
    seen_in_entry = {
        c["expect"]["error"] for c in entry["cases"] if c.get("expect", {}).get("error")
    }

    # このシャードが持つ 4 種。**SyntaxError はここには無い**(上の docstring)。
    assert seen == set(CALC_ERROR_KINDS) - {"SyntaxError"}, (
        f"missing kinds: {set(CALC_ERROR_KINDS) - {'SyntaxError'} - seen}, "
        f"unexpected kinds: {seen - set(CALC_ERROR_KINDS)}"
    )
    # 残る 1 種の在り処を、名指しでなく**測って**押さえる。
    assert "SyntaxError" in seen_in_entry, (
        "`.` の重複による SyntaxError が entry シャードから消えた——"
        "C-6 のあと、SyntaxError はコーパスのどこにも無くなる"
    )
    # 2 枚を合わせれば、主張は退役の前と同じ強さで立っている。
    assert seen | seen_in_entry >= set(CALC_ERROR_KINDS)


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


# `test_unbalanced_parenthesis_cases_do_not_wait_for_eq` はここに在った。
# **0.9.3 の C-6 で、主張ごと退役した**——「対応しない `)` は eq を待たずに
# エラーになる」は、D-2 が `)` を押せなくすると**主張として成り立たなくなる**
# (押せないものに「押した後」は無い)。**後継は `engine_table.rs` の
# `an_unmatched_closing_paren_cannot_be_pressed` の `refused_after` 2 行**
# ——D-2 の枝 `fix/unmatched-rparen`、**`111e67f` の 1328〜1329 行に在ることを
# 読んで確かめた**(ただしその先端はまだ赤い)。


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
