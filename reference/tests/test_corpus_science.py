"""科学計算の因子表（`scientific-v1`）のテスト。

**この Task の成果物は因子表そのもの**なので、テストが守れる範囲は限られる
——データ定義に赤確認は置けない。**何が守れて、何が守れないかを書き分ける。**

- **重複**はここが赤くする（設計書 §15.1 の 1「全要求セルが一意に列挙される」）
- **取りこぼし（因子表に水準が無い）は、同じ因子表から列挙するテストには
  原理的に見えない**——列挙は因子表を正としてしまう。守るのは
  **Task 2 の「どの水準にも属さないケースが 1 件でもあれば落とす」**である
- **§14.2 の軸を書き忘れる取りこぼしは、機械では見つからない。**
  `SPEC_AXES` に設計書の文言を写し、**人が並べて読む**ためのテストだけを置く
"""

from __future__ import annotations

import collections

from calcarc_reference import corpus_expr, corpus_science


def test_every_required_cell_is_enumerated_once() -> None:
    """設計書 §15.1 の 1。**重複はここが赤くする。**"""
    for requirement in corpus_science.SCIENCE_REQUIREMENTS:
        ids = [cell.id for cell in requirement.cells]
        duplicated = [i for i, n in collections.Counter(ids).items() if n > 1]
        assert not duplicated, f"{requirement.id}: 同じセルが 2 度出ている: {duplicated[:3]}"


def test_the_factor_table_covers_the_nine_rows_of_the_design() -> None:
    """**§14.2 の 9 行と、因子表の領域が 1 対 1。**

    **軸を書き忘れる取りこぼしは、これでは見つからない**——見つかるのは
    「領域を丸ごと落とした」場合だけである。**軸の対応は人が読む**
    （`SPEC_AXES` に設計書の文言が写してある）。
    """
    assert set(corpus_science.SPEC_AXES) == set(corpus_science.SCIENCE_FACTORS)
    assert len(corpus_science.SPEC_AXES) == 9
    assert {r.scope for r in corpus_science.SCIENCE_REQUIREMENTS} == set(corpus_science.SPEC_AXES)


def test_only_angle_mode_takes_the_full_product() -> None:
    """§14.2 の被覆規則。**直積を作るのは `angle_mode` だけ**である。

    **9 領域のうち 8 つが 1-way** なのは §14.2 がそう書いているからで、
    こちらの都合ではない——「各水準1件以上」「各帯に最低件数」「各経路に
    最低件数」。**全軸の直積を作らない**（§14.2 の末尾）。
    """
    strength = {r.scope: r.strength for r in corpus_science.SCIENCE_REQUIREMENTS}
    assert strength["angle_mode"] == "all"
    assert all(s != "all" for k, s in strength.items() if k != "angle_mode")
    # `angle_mode` は 3 関数 × 2 モード = 6
    assert (
        len(next(r for r in corpus_science.SCIENCE_REQUIREMENTS if r.scope == "angle_mode").cells)
        == 6
    )


def test_the_selected_pair_is_the_one_the_measurement_named() -> None:
    """§14.2 は `inverse_trig` に「1-way 必須、**重要ペアを選択**」と言っている。

    **どのペアが重要かを決めるのは因子表の仕事である。** 選んだのは
    `angle_mode × function`——**`Rad × asin/acos/atan` がコーパス 18 枚のどこにも
    1 件も無い**（2026-08-30 実測）。**1-way だけだと「`angle_mode=Rad` が未達」の
    1 セルに畳まれ、どの関数が欠けているかが出ない。**
    """
    assert corpus_science.SELECTED_PAIRS["inverse_trig"] == (("angle_mode", "function"),)
    cells = next(r for r in corpus_science.SCIENCE_REQUIREMENTS if r.scope == "inverse_trig").cells
    pairs = [c for c in cells if len(c.axes) == 2]
    assert len(pairs) == 6, "2 モード × 3 関数"
    rad = [c for c in pairs if ("angle_mode", "Rad") in c.axes]
    assert len(rad) == 3, "Rad 側の 3 セルが、実測した穴に対応する"


def test_the_function_sets_are_not_copies() -> None:
    """**関数の集合は `corpus_expr` を指す。写しを作らない。**

    写しを置くと、片方を直したときにもう片方が古くなる——金融が因子表を
    一次資料にしたのと同じ規律である。
    """
    factors = corpus_science.SCIENCE_FACTORS
    assert factors["elementary"]["function"] is corpus_expr.ELEMENTARY_FNS
    assert factors["inverse_trig"]["function"] is corpus_expr.INVERSE_TRIG_FNS
    assert factors["combinatorics"]["function"] == (
        corpus_expr.COMBINATORICS_FNS + corpus_expr.COMBINATORICS_BINS
    )
    # 三角は `UNARY_FNS` から絞っている。**絞りの中身も固定する**
    # ——絞りは隠れ場所になりうる。
    assert corpus_science.TRIG_FNS == ("sin", "cos", "tan")
    assert all(fn in corpus_expr.UNARY_FNS for fn in corpus_science.TRIG_FNS)


def test_one_way_cells_have_a_single_axis() -> None:
    """**1-way のセルと直積のセルは、同じ scope でも混ざらない。**

    `Cell` は軸の並びで同一性が決まるので、`("band", "zero")` と
    `(("function","ln"),("band","zero"))` は別のセルである。
    """
    for requirement in corpus_science.SCIENCE_REQUIREMENTS:
        if requirement.strength == "all":
            continue
        one_way = [c for c in requirement.cells if len(c.axes) == 1]
        assert one_way, f"{requirement.id}: 1-way のセルが 1 つも無い"
