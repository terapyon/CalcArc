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
import json
import pathlib

import pytest

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


# ---------------------------------------------------------------------------
# 写す経路（Task 2）
# ---------------------------------------------------------------------------

CORPUS = pathlib.Path(__file__).resolve().parents[2] / "corpus" / "generated"
NINE_SHARDS = (
    "elementary-000.json",
    "inverse-trig-000.json",
    "angle-mode-000.json",
    "precedence-000.json",
    "associativity-000.json",
    "cancellation-000.json",
    "combinatorics-000.json",
    "display-000.json",
    "complex-000.json",
    "complex-display-000.json",
)


def _nine_domain_cases() -> list[dict]:
    return [
        case
        for name in NINE_SHARDS
        for case in json.loads((CORPUS / name).read_text(encoding="utf-8"))["cases"]
    ]


def test_every_case_lands_on_at_least_one_cell() -> None:
    """**どの水準にも属さないケースを、黙って捨てない。**

    金融の `unexplained` と同じ門である——**属さないケースが在るなら、
    因子表が実データを覆えていない**（取りこぼしは、因子表から列挙する
    テストには見えない。ここでしか見つからない）。

    実測（2026-08-30）: 20,001 件すべてが 1 つ以上のセルを踏む。
    """
    orphans = [
        case["id"] for case in _nine_domain_cases() if not corpus_science.observed_cells(case)
    ]
    assert not orphans, f"どの水準にも属さないケースが {len(orphans)} 件: {orphans[:3]}"


def test_the_keys_are_the_source_not_the_rendered_expression() -> None:
    """**キーを一次資料にする。`expr` は読まない。**

    `errors-000.json` の `expr` は人間向けの散文である（`P(5,6)`・`1/0 (逆数)`）
    ——**式で数えると 3 つの関数で件数がずれる**（2026-08-30 実測:
    `nPr` 639/640・`nCr` 1711/1715・`recip` 902/903）。
    """
    case = {"keys": ["5", "n_p_r", "3", "eq"], "expr": "まったく別の文字列", "mode": "Deg"}
    levels = corpus_science.observed_levels(case)
    assert levels["combinatorics"]["function"] == {"nPr"}


def test_a_case_can_carry_two_levels_on_one_axis() -> None:
    """**1 件が同じ軸で複数の水準を踏む。** 上書きすると手前を落とす。"""
    case = {"keys": ["3", "sin", "add", "4", "cos", "eq"], "mode": "Deg"}
    assert corpus_science.observed_levels(case)["angle_mode"]["function"] == {"sin", "cos"}
    ids = {c.id for c in corpus_science.observed_cells(case)}
    assert "angle_mode/function=sin,angle_mode=Deg" in ids
    assert "angle_mode/function=cos,angle_mode=Deg" in ids


def test_equivalence_cases_use_both_key_sequences() -> None:
    """**等価ケースは `keys` を持たず `left` と `right` を持つ**（1,292 件）。

    片方だけ読むと、押したキーの半分を見落とす。
    """
    case = {"left": ["1", "eq"], "right": ["2", "eng", "eq"], "mode": "Deg"}
    assert corpus_science.case_keys(case) == ("1", "eq", "2", "eng", "eq")
    assert corpus_science.observed_levels(case)["display"]["kind"] == {"eng"}


def test_the_axis_order_follows_the_factor_table() -> None:
    """**軸の並びが違うと、同じ意味のセルが別物になる。**

    2026-08-30 に実際に起きた——射影がアルファベット順で組み、要求セルが
    因子表の順（`function, angle_mode`）だったので、**`Rad` のケースが
    2,000 件在るのに `angle_mode` の被覆が 6 中 0 になった。**
    """
    case = {"keys": ["angle_toggle", "1", "cos", "eq"], "mode": "Rad"}
    ids = {c.id for c in corpus_science.observed_cells(case)}
    assert "angle_mode/function=cos,angle_mode=Rad" in ids


def test_unmet_splits_into_unobservable_and_real_holes() -> None:
    """**未達を 1 つの数に畳まない。**

    **観測できない軸の未達**（帯・文法クラス・演算種別・表示境界）は
    「データに無い」ではなく「**この経路では読めない**」である
    ——Task 3 が記録を足せば埋まる。**本当の穴と混ぜると、埋める判断を誤る。**

    実測（2026-08-30）: 未達 37 = 観測できない 30 + 本当の穴 7。
    """
    covered: set = set()
    for case in _nine_domain_cases():
        covered |= corpus_science.observed_cells(case)
    unobservable = {
        (scope, axis) for scope, axes in corpus_science.UNOBSERVABLE_AXES.items() for axis in axes
    }
    real, declared = [], []
    for requirement in corpus_science.SCIENCE_REQUIREMENTS:
        for cell in requirement.cells:
            if cell in covered:
                continue
            names = {name for name, _ in cell.axes}
            target = (
                declared
                if any((requirement.scope, name) in unobservable for name in names)
                else real
            )
            target.append(cell.id)
    assert len(declared) == 30
    assert sorted(real) == [
        "combinatorics/path=domain",
        "combinatorics/path=overflow_near",
        "complex/zero_part=both_zero",
        "inverse_trig/angle_mode=Rad",
        "inverse_trig/function=acos,angle_mode=Rad",
        "inverse_trig/function=asin,angle_mode=Rad",
        "inverse_trig/function=atan,angle_mode=Rad",
    ]


# ---------------------------------------------------------------------------
# 記録と突合（Task 3）
# ---------------------------------------------------------------------------


def test_the_two_paths_agree_on_a_tree_that_carries_several_functions() -> None:
    """**記録（木）と観測（キー列）が一致する。**"""
    node = corpus_expr.Bin(
        "+", corpus_expr.Un("sin", corpus_expr.Num(3)), corpus_expr.Un("ln", corpus_expr.Num(4))
    )
    case = {
        "id": "t-0",
        "mode": "Deg",
        "keys": corpus_expr.to_key_sequence(node),
        "expr": corpus_expr.to_expr_text(node),
    }
    corpus_science.assert_record_matches_observation(case, node)
    recorded = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
    assert recorded["angle_mode"]["function"] == ["sin"]
    assert recorded["elementary"]["function"] == ["ln"]


def test_the_assert_falls_when_the_record_is_wrong() -> None:
    """**記録側がずれたら落ちる。**（赤確認①）"""
    node = corpus_expr.Un("ln", corpus_expr.Num(4))
    case = {
        "id": "t-1",
        "mode": "Deg",
        "keys": corpus_expr.to_key_sequence(node),
        "expr": "x",
    }
    # 木から読んだ結果を、手で 1 つ落とした形で渡す
    wrong = corpus_expr.Num(4)  # 関数を持たない木
    with pytest.raises(corpus_science.LevelsDisagree):
        corpus_science.assert_record_matches_observation(case, wrong)


def test_the_assert_falls_when_the_observation_is_wrong() -> None:
    """**観測側がずれても、同じ assert が落ちる。**（赤確認②）

    **片方向だけ落ちる門は、突合ではなく片側検査である。**
    """
    node = corpus_expr.Un("ln", corpus_expr.Num(4))
    case = {
        "id": "t-2",
        "mode": "Deg",
        # キー列を手でずらす（`ln` を `log10` と読ませる）
        "keys": ["4", "log10", "eq"],
        "expr": "x",
    }
    with pytest.raises(corpus_science.LevelsDisagree):
        corpus_science.assert_record_matches_observation(case, node)


def test_axes_come_in_three_kinds_and_each_is_declared() -> None:
    """**軸には 3 つの類型がある。** 宣言しないと突合が毎回落ちる。

    2026-08-30、突合の assert が初回の実走で第 3 の類型を見つけた
    ——`combinatorics/path` は**観測できるが記録できない**（期待値の
    エラー種別から出るので、木を歩いても出ない）。

    **残り 4 つは、その後テストが見つけた**——`display/kind`（`eng`/`dms` は
    木の外で押す）・`precedence/parenthesis`（キー列は括弧を省いた形）・
    `complex/form`（`polar_toggle` は木の外）・`complex/zero_part`（期待値から出る）。
    **宣言せずに `scope in recorded` で絞っていたので、絞りが番人を
    片側検査にしていた。**
    """
    assert corpus_science.OBSERVATION_ONLY_AXES == {
        "combinatorics": ("path",),
        "display": ("kind",),
        "precedence": ("parenthesis",),
        "complex": ("form", "zero_part"),
    }
    overlap = {
        (scope, axis) for scope, axes in corpus_science.UNOBSERVABLE_AXES.items() for axis in axes
    } & {
        (scope, axis)
        for scope, axes in corpus_science.OBSERVATION_ONLY_AXES.items()
        for axis in axes
    }
    assert not overlap, "同じ軸が 2 つの類型に入っている"


def test_every_recorded_case_agrees_with_its_keys() -> None:
    """**コミット済みの golden 全件で、記録と観測が一致する。**

    生成時にも同じ assert が走るが、**それは生成器を信じている**
    ——ここはコミットされた成果物そのものを読み直す。
    """
    checked = 0
    for name in NINE_SHARDS:
        for case in json.loads((CORPUS / name).read_text(encoding="utf-8"))["cases"]:
            if "levels" not in case:
                continue
            unobservable = {
                (scope, axis)
                for table in (
                    corpus_science.UNOBSERVABLE_AXES,
                    corpus_science.OBSERVATION_ONLY_AXES,
                )
                for scope, axes in table.items()
                for axis in axes
            }
            observed = {
                scope: {
                    axis: sorted(vals)
                    for axis, vals in axes.items()
                    if (scope, axis) not in unobservable and scope in case["levels"]
                }
                for scope, axes in corpus_science.observed_levels(case).items()
            }
            observed = {s: a for s, a in observed.items() if a}
            assert case["levels"] == observed, f"{case['id']}: 記録と観測が食い違う"
            checked += 1
    assert checked == 17823, f"突き合わせたのが {checked} 件しかない"


# ---------------------------------------------------------------------------
# `coverage` を載せる（Task 4）
# ---------------------------------------------------------------------------


def test_a_declared_unmeasurable_axis_is_never_observed() -> None:
    """**★ 裁定 4 の番人。** 「測れない」と宣言した軸が、**本当に観測経路から
    出ない**ことを見る。

    **これが無いと、宣言が「緩めれば緑になるパラメータ」になる**——測れる軸を
    「測れない」と宣言すれば、その未達では門が落ちなくなる。このプロジェクトが
    何度も踏んでいる型である。

    **観測できるのに宣言した軸が 1 つでもあれば落ちる。**
    """
    declared = {
        (scope, axis) for scope, axes in corpus_science.UNOBSERVABLE_AXES.items() for axis in axes
    }
    seen: set[tuple[str, str]] = set()
    for case in _nine_domain_cases():
        for scope, axes in corpus_science.observed_levels(case).items():
            seen |= {(scope, axis) for axis in axes}
    wrongly = sorted(declared & seen)
    assert not wrongly, (
        f"観測できるのに「測れない」と宣言している軸がある: {wrongly}——宣言を外すか、射影を直すこと"
    )


def test_the_declaration_list_is_pinned() -> None:
    """**(ii) 宣言が黙って増えることを防ぐ**（(i) の保険）。

    (i) は「観測できるのに宣言した」を捕まえるが、**観測できない軸を新しく
    宣言することは捕まえない**——それは正しい宣言かもしれないし、**モデルを
    狭めて点を稼ぐ手**かもしれない。**増えたら人が読む。**
    """
    assert corpus_science.UNOBSERVABLE_AXES == {
        "elementary": ("band",),
        "inverse_trig": ("band",),
        "cancellation": ("shape", "band"),
        "precedence": ("grammar_class",),
        "complex": ("operation",),
        "display": ("edge",),
    }


def test_the_coverage_block_splits_unmet_by_kind() -> None:
    """**未達を種類で分けて載せる**（裁定 4）。

    **数だけでは読み手が分けられない**——`inverse_trig` は「測れない軸（帯）」と
    「本当の穴（Rad）」の**両方**を持つので、**軸の宣言だけで領域ごと見逃すと、
    穴が緑で通る。**
    """
    payload = json.loads((CORPUS / "elementary-000.json").read_text(encoding="utf-8"))["coverage"]
    by_scope = {r["scope"]: r for r in payload["requirements"]}
    assert by_scope["inverse_trig"]["unmet_cells"] == 9
    assert by_scope["inverse_trig"]["unmet_from_unmeasured_axes"] == 5
    assert len(by_scope["inverse_trig"]["unmet_real_cells"]) == 4
    real = sum(len(r["unmet_real_cells"]) for r in payload["requirements"])
    assert real == 7, "本当の穴は 7 件"
    assert len(payload["not_measured_axes"]) == 7


def test_all_ten_shards_carry_the_same_block_and_it_matches_a_fresh_count() -> None:
    """**写しが一致することだけを見ない**（裁定 5）。

    **10 個の写しが一致することだけを見るテストは、10 個とも同じように
    間違っていれば緑**である。**源と写しの一致**を見る——ここで数え直した
    ものと、載っているものが同じであること。
    """
    blocks = [
        json.loads((CORPUS / name).read_text(encoding="utf-8"))["coverage"] for name in NINE_SHARDS
    ]
    assert all(block == blocks[0] for block in blocks), "10 枚のブロックが揃っていない"
    fresh = corpus_science.build_science_coverage(
        {
            name: json.loads((CORPUS / name).read_text(encoding="utf-8"))["cases"]
            for name in NINE_SHARDS
        }
    )
    assert blocks[0] == json.loads(json.dumps(fresh)), (
        "載っているブロックが、いま数え直したものと違う"
    )
