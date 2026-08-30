"""`scripts/corpus_diff.py` の突き合わせを見る。

**道具にも番人が要る。** この道具は「差分が読める形を保つ」ために置いたので、
**道具のほうが黙って嘘をつくと、保とうとしたものが崩れる。**
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from corpus_diff import compare, outer_fields  # noqa: E402


def _case(case_id: str, **fields: object) -> dict:
    return {"id": case_id, "expect": {"re": 1.0}, **fields}


def test_it_reports_the_field_that_moved_and_not_the_ones_that_did_not() -> None:
    """**これが本題である。** 2026-08-30 に `levels` だけが 2,609 件で動き、
    **`git diff` の 8,000 行からはそれが読めなかった。**
    """
    old = [_case("a"), _case("b")]
    new = [_case("a", levels={"elementary": {"band": ["zero"]}}), _case("b")]
    report = compare(old, new)
    assert report["changed_fields"] == {"levels": 1}
    assert report["unchanged"] == 1
    assert report["added"] == [] and report["removed"] == []


def test_it_matches_by_id_not_by_position() -> None:
    """**位置で合わせると、1 件挿入しただけで「全件が変わった」と出る。**

    末尾に足す運用（`_append_rad_boundaries` ほか）では位置が保たれるが、
    **保たれることに寄りかからない**——寄りかかると、**先頭に 1 件足した日に
    差分が読めなくなる。**
    """
    old = [_case("a"), _case("b")]
    new = [_case("z"), _case("a"), _case("b")]
    report = compare(old, new)
    assert report["added"] == ["z"]
    assert report["changed"] == []
    assert report["unchanged"] == 2


def test_it_names_every_field_that_moved() -> None:
    """**1 つ見つけて満足しない。** 期待値も動いていれば、それは別の話である。"""
    old = [_case("a", keys=["1"], levels={})]
    new = [_case("a", keys=["2"], levels={"x": 1}, expect={"re": 2.0})]
    report = compare(old, new)
    assert report["changed_fields"] == {"keys": 1, "levels": 1, "expect": 1}


def test_a_removed_case_is_never_silent() -> None:
    """**削除は一番読み落としやすい。** 追加と変更だけ見ていると気づかない。"""
    report = compare([_case("a"), _case("b")], [_case("a")])
    assert report["removed"] == ["b"]


def test_it_sees_what_lives_outside_the_cases() -> None:
    """**`coverage` はシャード階層に在る。** ケース単位の比較には現れない。

    **2026-08-30、理由の文言を 1 行直した走行で、道具が「動いたフィールドは
    無し」と印字した**——ケースは本当に 1 件も動いていなかったが、
    **10 枚の `coverage` が動いていた。** **見ない道具は、見ていないと
    言わずに「無い」と言う。**
    """
    old = {"cases": [], "coverage": {"model": "scientific-v1"}, "schema": 1}
    new = {"cases": [], "coverage": {"model": "scientific-v2"}, "schema": 1}
    assert outer_fields(old, new) == ["coverage"]
    assert outer_fields(old, old) == []
