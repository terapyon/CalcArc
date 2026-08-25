"""要求セルの代数(設計書 §4・§10・§11)。**金融を知らない型のテスト。**

このモジュールは因子表も水準表も持たない。持たせると、金融の因子を直したときに
こちらの写しだけが古くなる——第2段階の科学計算も同じ型を使うので、**知らないままで
いられること自体が要件**である。
"""

import pytest

from calcarc_reference import corpus_coverage as cov


def test_cell_id_is_stable_and_spelled_as_the_spec_says() -> None:
    """設計書 §10.2 の例と同じ綴りになること。**綴りが動くと、除外の記録を
    前回の走行と突き合わせられなくなる。**"""
    cell = cov.Cell("loan_term", (("rate", "20"), ("target_n", "1200")))
    assert cell.id == "loan_term/rate=20,target_n=1200"


def test_level_text_spells_bool_as_json_does() -> None:
    """`True` を `"True"` と綴ると、JSON を読む側の `tax=true` と食い違う。
    **`bool` は `int` の派生**なので、見る順番を間違えると `True` が `"1"` になる。
    """
    assert cov.level_text(True) == "true"
    assert cov.level_text(False) == "false"
    assert cov.level_text(12) == "12"
    assert cov.level_text("0.0001") == "0.0001"


def test_all_combination_cells_is_the_product() -> None:
    cells = cov.all_combination_cells("loan_forward", {"rate": ("0", "20"), "n": (1, 12, 1200)})
    assert len(cells) == 6
    assert cells[0].id == "loan_forward/rate=0,n=1"
    assert len({cell.id for cell in cells}) == 6


def test_pairwise_cells_counts_two_factor_pairs_not_rows() -> None:
    """**行数ではなくセル数**(設計書 §12.4 の注意)。3 因子 (2,3,2) なら
    2*3 + 2*2 + 3*2 = 16。1 行のペアワイズは複数のセルを踏むので、
    行を数えると単位が合わなくなる。
    """
    cells = cov.pairwise_cells(
        "compound_periods_for",
        {"rate": ("0", "20"), "periods_per_year": (1, 2, 12), "tax": (False, True)},
    )
    assert len(cells) == 16
    assert len({cell.id for cell in cells}) == 16
    assert cov.Cell("compound_periods_for", (("rate", "0"), ("tax", "true"))) in cells


def test_summarize_holds_the_consistency_equation() -> None:
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1, 2, 3)}))
    covered = {req.cells[0]}
    exclusions = {req.cells[1]: cov.Exclusion(req.cells[1], cov.Reason.NOT_APPLICABLE, "測定用")}
    summary = cov.summarize(req, covered, exclusions)
    assert summary["required_cells"] == 3
    assert summary["covered_cells"] == 1
    assert summary["excluded_cells"] == 1
    assert summary["unmet_cells"] == 1
    assert summary["status"] == "incomplete"


def test_status_is_complete_only_without_exclusions() -> None:
    """設計書 §12.3。**「理由付き未実行あり」を「完全網羅」と書かない**の、
    データ側の担保である。"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1, 2)}))
    assert cov.summarize(req, set(req.cells), {})["status"] == "complete"
    exclusions = {req.cells[1]: cov.Exclusion(req.cells[1], cov.Reason.NOT_APPLICABLE, "測定用")}
    summary = cov.summarize(req, {req.cells[0]}, exclusions)
    assert summary["status"] == "accounted_with_exclusions"


def test_a_cell_cannot_be_covered_and_excluded_at_once() -> None:
    """設計書 §13.1。**両方に入ったら生成器を落とす。**"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    exclusions = {req.cells[0]: cov.Exclusion(req.cells[0], cov.Reason.NOT_APPLICABLE, "測定用")}
    with pytest.raises(RuntimeError, match="被覆と除外の両方"):
        cov.summarize(req, set(req.cells), exclusions)


def test_an_exclusion_outside_the_model_is_refused() -> None:
    """モデルに無いセルの除外を通すと、除外の合計だけが増えて分母が動かない
    ——「説明した」ように見えて何も説明していない状態になる。"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    stray = cov.Cell("op", (("a", "9"),))
    with pytest.raises(RuntimeError, match="モデルの外"):
        cov.build_payload(
            "test-v1",
            (req,),
            set(),
            {stray: cov.Exclusion(stray, cov.Reason.NOT_APPLICABLE, "x")},
            {},
        )


def test_a_covered_cell_outside_the_model_is_refused() -> None:
    """被覆の側も同じ。**数え方が破れているのに緑になる**のを許さない。"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    stray = cov.Cell("op", (("a", "9"),))
    with pytest.raises(RuntimeError, match="モデルの外"):
        cov.build_payload("test-v1", (req,), {stray}, {}, {})


def test_every_reason_has_a_fixed_disposition() -> None:
    """理由 → 判断区分は 1 対 1。**呼び出し側に選ばせない**——同じ理由が場所に
    よって `safe` にも `accepted_risk` にもなると、表示が揺れる。"""
    assert set(cov.DISPOSITION_OF) == set(cov.Reason)
    assert (
        cov.Exclusion(
            cov.Cell("op", (("a", "1"),)), cov.Reason.ORACLE_NEAR_YEN_BOUNDARY, "x"
        ).disposition
        is cov.Disposition.ACCEPTED_RISK
    )


def test_there_is_no_other_reason_to_hide_in() -> None:
    """設計書 §10.1・§13.1。**`other` という逃げ場を作らない。**"""
    assert "other" not in {reason.value for reason in cov.Reason}


def test_payload_carries_its_own_schema_and_model() -> None:
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    payload = cov.build_payload("test-v1", (req,), set(req.cells), {}, {"candidate_duplicate": 0})
    assert payload["schema"] == cov.COVERAGE_SCHEMA
    assert payload["model"] == "test-v1"
    assert payload["requirements"][0]["id"] == "r"
    assert payload["excluded_cells"] == []
    assert payload["generation_rejections"] == {"candidate_duplicate": 0}


def test_excluded_cells_are_written_in_a_stable_order() -> None:
    """設計書 §10.2「`cell_id` は安定した順序・綴りで生成する」。
    **順序が走行ごとに動くと、golden がバイトで一致しない。**"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (3, 1, 2)}))
    exclusions = {
        cell: cov.Exclusion(cell, cov.Reason.NOT_APPLICABLE, "測定用") for cell in req.cells
    }
    payload = cov.build_payload("test-v1", (req,), set(), exclusions, {})
    ids = [row["cell_id"] for row in payload["excluded_cells"]]
    assert ids == sorted(ids)
