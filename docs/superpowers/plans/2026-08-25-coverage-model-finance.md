# Heavy テスト空間モデル（第1段階 `finance-v1`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 金融コーパスが「何を必須の試験空間と定めたか / そのうち何を実行したか / 実行しなかったものはなぜか」を機械可読データと Heavy レポートの両方で説明できるようにする。

**Architecture:** 要求セルの代数（型・列挙・整合検査）を新しい純粋モジュール `corpus_coverage.py` に置き、金融の因子表を持つ `corpus_calls.py` がそれを**呼ぶ側**になる（逆向きに import しない——循環を作らないため、因子表は引数で渡す）。生成器は `coverage` を `finance-000.json` のトップレベルに書き、TypeScript 側は**読んで検証するだけ**で数え直さない。被覆は入力の実値ではなく**水準へ写してから**数える。

**Tech Stack:** Python 3（`uv`）／TypeScript（vitest・Playwright）／既存の重量級ハーネス

**Spec:** `docs/superpowers/specs/2026-08-25-coverage-model-design.md`（§21 に着手前の実測と座標の訂正がある）

## Global Constraints

仕様 §3（非目的）と CLAUDE.md から、**すべての Task に暗黙に掛かる**制約。

- **計算ロジックを `calcarc-core` の外に書かない。** この計画は `reference/` と `heavy/` だけを触り、`crates/` と `web/src/` を 1 行も変えない。
- **参照実装を Rust の移植にしない。** 被覆の判定に製品側の値を使わない。
- **許容誤差と精度判定を変えない。** `tolerance` に触る Task は 1 つも無い。
- **Heavy レポートの既存の判定語句・変異表・許容誤差表を変えない。** 追加は「関数呼び出しの内訳」の中だけ。
- **レポートへ手書きの実測値を埋めない。** 数はすべて読み込んだデータから算出する（既存の作法。`report.spec.ts` が見張っている）。
- **未分類理由を `other` として通さない。** 未知の例外・未知の理由コードは生成器を落とす。
- **乱択候補の棄却（`generation_rejections`）を要求セルの除外と同じ合計に混ぜない。**
- **`SCHEMA`（15 シャード共有の値）を上げない。** `coverage` は独自の `schema` を持つ。
- **既存シャード 17 枚の golden をバイトで動かさない。** 変わってよいのは `finance-000.json` だけ。
- コミット末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。`git push` と PR 作成は行わない。
- **作業ディレクトリは `/home/terapyon/dev/CalcArc-e2e`。** 全コマンドを `...` の形で打つ。`/home/terapyon/dev/CalcArc` は別セッションのもので触らない。
- Python は `cd reference && uv run --no-config pytest`、重量級は `cd heavy && pnpm ...`、web は `cd web && pnpm ...`。

## 着手前に実測で分かっていること（この計画の前提）

`.superpowers/sdd/2026-08-25-coverage-model/preflight.md` に測り方がある。**推定ではなく実測である。**

**8 対象すべてを実測した（2026-08-25、コミット済みコーパスから）。**

| 対象 | 要求セル | いまの被覆 | いまの未達 |
|---|---:|---:|---:|
| `loan_forward` | 150 | **150** | 0 |
| `loan_principal` | 150 | **150** | 0 |
| `loan_bonus_forward` | 150 | **150** | 0 |
| `loan_bonus_principal` | 150 | **150** | 0 |
| `loan_term` | 150 | **74** | **59** |
| `compound_grow` | 266 | **266** | 0 |
| `compound_deposit_for` | 266 | **247** | **19** |
| `compound_periods_for` | 56 | **56** | 0 |

**未達があるのは 2 対象だけである。** 他の 6 対象は、いまのコーパスが既に全被覆している
——この計画が足すのは「そう言えること」であって、被覆そのものではない。

**`loan_term` の 59 未達は、決定的な候補探索で 52 が被覆へ動く**（実測。50 件は月額 +1 円、2 件は別の元本）。
**残る 7 はすべて `target_n = 1201`** で、`loan_ref.MAX_TERM_MONTHS = 1200` である以上
`loan_term` は 1201 を返しようがない——`not_applicable` に分類する。

**この計画は `finance-000.json` を作り直す。** 金融の入力が 52 行変わるので、golden も
変異検出件数も動きうる。**動いた分は Task 12 で測って記録する**（仕様 §15.4）。

## File Structure

| ファイル | 責務 |
|---|---|
| `reference/src/calcarc_reference/corpus_coverage.py`（新規） | 要求セルの代数。型・ID の綴り・理由コード・判断区分・整合検査・`coverage` payload の組み立て。**金融を知らない**（因子表は引数で受ける）ので、第2段階の科学計算からも同じ型が使える |
| `reference/src/calcarc_reference/corpus_calls.py`（変更） | 金融の因子表から要求セルを列挙し、生成の実測（被覆・除外）を集めて `build_finance_shard` の出力へ載せる |
| `reference/tests/test_corpus_coverage.py`（新規） | 代数そのもののテスト（整合式・ID の安定・未知理由の拒否） |
| `reference/tests/test_generate_corpus.py`（変更） | 金融モデルのテスト（仕様 §15.1 の 10 項目＋反証可能性） |
| `heavy/tests/corpus/corpus.ts`（変更） | `Coverage` の型・`assertCoverageIsSound`・`CallBreakdown` への搭載 |
| `heavy/tests/corpus/calls.spec.ts`（変更） | Heavy の合否（§13.2）。`unmet > 0` などで落とす |
| `heavy/tests/corpus/corpus.spec.ts`（変更） | 読取の拒否（未知 schema / 未知 model / 整合不一致 / 未知理由） |
| `heavy/tests/corpus/report.ts`（変更） | 網羅表・除外表・注意文。「関数呼び出しの内訳」の op 表の直後 |
| `heavy/tests/corpus/report.spec.ts`（変更） | 仕様 §15.3 の 10 状態＋実物 `finance-000.json` |
| `docs/corpus-measurements.md`（変更） | 実装後の実測と判断理由 |

---

### Task 1: 要求セルの代数（`corpus_coverage.py`）

**Files:**
- Create: `reference/src/calcarc_reference/corpus_coverage.py`
- Test: `reference/tests/test_corpus_coverage.py`

**Interfaces:**
- Consumes: なし（このモジュールは何も import しない。標準ライブラリのみ）
- Produces: `COVERAGE_SCHEMA: int`、`Reason`（Enum）、`Disposition`（Enum）、`DISPOSITION_OF: dict[Reason, Disposition]`、`level_text(value) -> str`、`Cell(scope, axes)` と `Cell.id`、`Requirement(id, scope, strength, cells)`、`all_combination_cells(scope, factors) -> tuple[Cell, ...]`、`pairwise_cells(scope, factors) -> tuple[Cell, ...]`、`Exclusion(cell, reason, detail, covered_elsewhere)` と `.disposition` / `.as_json()`、`summarize(requirement, covered, exclusions) -> dict`、`build_payload(model, requirements, covered, exclusions, generation_rejections) -> dict`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_coverage.py`:

```python
"""要求セルの代数(設計書 §4・§10・§11)。**金融を知らない型のテスト。**"""

import pytest

from calcarc_reference import corpus_coverage as cov


def test_cell_id_is_stable_and_spelled_as_the_spec_says() -> None:
    """設計書 §10.2 の例と同じ綴りになること。**綴りが動くと除外の記録が
    前回と突き合わせられなくなる。**"""
    cell = cov.Cell("loan_term", (("rate", "20"), ("target_n", "1200")))
    assert cell.id == "loan_term/rate=20,target_n=1200"


def test_level_text_spells_bool_as_json_does() -> None:
    """`True` を `"True"` と綴ると、JSON を読む側の `tax=true` と食い違う。"""
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
    """**行数ではなくセル数。** 3 因子 (2,3,2) なら 2*3 + 2*2 + 3*2 = 16。"""
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
    exclusions = {
        req.cells[1]: cov.Exclusion(req.cells[1], cov.Reason.NOT_APPLICABLE, "測定用")
    }
    summary = cov.summarize(req, covered, exclusions)
    assert summary["required_cells"] == 3
    assert summary["covered_cells"] == 1
    assert summary["excluded_cells"] == 1
    assert summary["unmet_cells"] == 1
    assert summary["status"] == "incomplete"


def test_status_is_complete_only_without_exclusions() -> None:
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1, 2)}))
    assert cov.summarize(req, set(req.cells), {})["status"] == "complete"
    exclusions = {
        req.cells[1]: cov.Exclusion(req.cells[1], cov.Reason.NOT_APPLICABLE, "測定用")
    }
    summary = cov.summarize(req, {req.cells[0]}, exclusions)
    assert summary["status"] == "accounted_with_exclusions"


def test_a_cell_cannot_be_covered_and_excluded_at_once() -> None:
    """設計書 §13.1。**両方に入ったら生成器を落とす。**"""
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    exclusions = {req.cells[0]: cov.Exclusion(req.cells[0], cov.Reason.NOT_APPLICABLE, "測定用")}
    with pytest.raises(RuntimeError, match="被覆と除外の両方"):
        cov.summarize(req, set(req.cells), exclusions)


def test_an_exclusion_outside_the_model_is_refused() -> None:
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    stray = cov.Cell("op", (("a", "9"),))
    with pytest.raises(RuntimeError, match="モデルの外"):
        cov.build_payload(
            "test-v1", (req,), set(), {stray: cov.Exclusion(stray, cov.Reason.NOT_APPLICABLE, "x")}, {}
        )


def test_every_reason_has_a_fixed_disposition() -> None:
    """理由 → 判断区分は 1 対 1。**呼び出し側に選ばせない**(同じ理由が場所に
    よって `safe` にも `accepted_risk` にもなると、表示が揺れる)。"""
    assert set(cov.DISPOSITION_OF) == set(cov.Reason)
    assert cov.Exclusion(
        cov.Cell("op", (("a", "1"),)), cov.Reason.ORACLE_NEAR_YEN_BOUNDARY, "x"
    ).disposition is cov.Disposition.ACCEPTED_RISK


def test_payload_carries_its_own_schema_and_model() -> None:
    req = cov.Requirement("r", "op", "all", cov.all_combination_cells("op", {"a": (1,)}))
    payload = cov.build_payload("test-v1", (req,), set(req.cells), {}, {"candidate_duplicate": 0})
    assert payload["schema"] == cov.COVERAGE_SCHEMA
    assert payload["model"] == "test-v1"
    assert payload["requirements"][0]["id"] == "r"
    assert payload["excluded_cells"] == []
    assert payload["generation_rejections"] == {"candidate_duplicate": 0}
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_corpus_coverage.py -q`
Expected: FAIL（`ModuleNotFoundError: calcarc_reference.corpus_coverage`）

- [ ] **Step 3: 実装する**

`reference/src/calcarc_reference/corpus_coverage.py`:

```python
"""要求セルの代数(設計書 §4・§10・§11)。

**このモジュールは金融を知らない。** 因子表も水準表も引数で受け取る
——`corpus_calls` から import されるだけで、こちらからは import しない
(循環を作らないため)。第2段階の科学計算も同じ型を使う。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
from itertools import combinations, product

#: `coverage` 自身のスキーマ番号。**15 枚が共有する `corpus_calls.SCHEMA` とは
#: 別物**(設計書 §11.1)。こちらを上げても他のシャードの golden は動かない。
COVERAGE_SCHEMA = 1


class Reason(str, Enum):
    """除外の理由コード(設計書 §10.1)。**`other` は無い**——未知の理由は
    生成器を落とす側の仕事で、ここに逃げ場を作らない。"""

    DUPLICATE_EQUIVALENT = "duplicate_equivalent"
    NOT_APPLICABLE = "not_applicable"
    INVERSE_TARGET_UNCONSTRUCTIBLE = "inverse_target_unconstructible"
    SOURCE_OVERFLOW = "source_overflow"
    ORACLE_NEAR_YEN_BOUNDARY = "oracle_near_yen_boundary"
    ORACLE_SEARCH_LIMIT = "oracle_search_limit"
    CANDIDATE_DOMAIN = "candidate_domain"
    CANDIDATE_OUT_OF_RANGE = "candidate_out_of_range"
    CANDIDATE_OVERFLOW = "candidate_overflow"
    CANDIDATE_DUPLICATE = "candidate_duplicate"


class Disposition(str, Enum):
    """判断区分(設計書 §10.1)。`accepted_risk` は「安全」ではない。"""

    SAFE = "safe"
    REASONABLE = "reasonable"
    ACCEPTED_RISK = "accepted_risk"


#: 理由 → 判断区分は **1 対 1 に固定する**。呼び出し側に選ばせると、同じ理由が
#: 場所によって `safe` にも `accepted_risk` にもなり、表示が揺れる。
#: `not_applicable` を `safe` ではなく `reasonable` に置くのは、**何も失って
#: いないが何も検証してもいない**からで、`safe`(同じ主張を別のケースが検証
#: 済み)と同じ欄に並べると読者が過大に読む。
DISPOSITION_OF: dict[Reason, Disposition] = {
    Reason.DUPLICATE_EQUIVALENT: Disposition.SAFE,
    Reason.NOT_APPLICABLE: Disposition.REASONABLE,
    Reason.INVERSE_TARGET_UNCONSTRUCTIBLE: Disposition.REASONABLE,
    Reason.SOURCE_OVERFLOW: Disposition.REASONABLE,
    Reason.ORACLE_NEAR_YEN_BOUNDARY: Disposition.ACCEPTED_RISK,
    Reason.ORACLE_SEARCH_LIMIT: Disposition.ACCEPTED_RISK,
    Reason.CANDIDATE_DOMAIN: Disposition.SAFE,
    Reason.CANDIDATE_OUT_OF_RANGE: Disposition.SAFE,
    Reason.CANDIDATE_OVERFLOW: Disposition.SAFE,
    Reason.CANDIDATE_DUPLICATE: Disposition.SAFE,
}


def level_text(value: object) -> str:
    """水準の綴り。**`bool` を先に見る**——`bool` は `int` の派生なので、
    順番を逆にすると `True` が `"1"` になり、JSON 側の `tax=true` と食い違う。
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


@dataclass(frozen=True, order=True)
class Cell:
    """要求セル(設計書 §4.3)。`axes` は**宣言順**で持つ——並べ替えると
    `cell_id` の綴りが変わり、前回の除外記録と突き合わせられなくなる。"""

    scope: str
    axes: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        names = [name for name, _ in self.axes]
        if len(names) != len(set(names)):
            raise RuntimeError(f"同じ因子が 2 度入っている: {self.scope} {names}")

    @property
    def id(self) -> str:
        return f"{self.scope}/" + ",".join(f"{name}={level}" for name, level in self.axes)


@dataclass(frozen=True)
class Requirement:
    """1 つの被覆規則(設計書 §11.2 の `requirements[]`)。"""

    id: str
    scope: str
    strength: str  # "all" | "pairwise"
    cells: tuple[Cell, ...]


@dataclass(frozen=True)
class Exclusion:
    """理由付き除外(設計書 §10.2)。"""

    cell: Cell
    reason: Reason
    detail: str
    covered_elsewhere: tuple[str, ...] = ()

    @property
    def disposition(self) -> Disposition:
        return DISPOSITION_OF[self.reason]

    def as_json(self) -> dict[str, object]:
        return {
            "cell_id": self.cell.id,
            "scope": self.cell.scope,
            "reason": self.reason.value,
            "disposition": self.disposition.value,
            "detail": self.detail,
            "covered_elsewhere": list(self.covered_elsewhere),
        }


def all_combination_cells(scope: str, factors: Mapping[str, Sequence[object]]) -> tuple[Cell, ...]:
    """全組合せ(設計書 §7.2 の「全組合せ」)。"""
    names = list(factors)
    return tuple(
        Cell(scope, tuple((name, level_text(value)) for name, value in zip(names, values)))
        for values in product(*(factors[name] for name in names))
    )


def pairwise_cells(scope: str, factors: Mapping[str, Sequence[object]]) -> tuple[Cell, ...]:
    """2 因子間ペアワイズの**要求セル**(設計書 §12.4 の注意——構成行ではない)。

    `pairwise()` が返す**行**は 1 行で複数のセルを踏む。ここで数えるのは
    踏まれる側のセルで、因子の組ごとに水準の直積を取ったものである。
    """
    names = list(factors)
    cells: list[Cell] = []
    for left, right in combinations(names, 2):
        for a, b in product(factors[left], factors[right]):
            cells.append(Cell(scope, ((left, level_text(a)), (right, level_text(b)))))
    return tuple(cells)


def summarize(
    requirement: Requirement,
    covered: set[Cell],
    exclusions: Mapping[Cell, Exclusion],
) -> dict[str, object]:
    """1 つの被覆規則の集計(設計書 §11.2・§11.3)。

    **整合式 `required = covered + excluded + unmet` はここで検算する**
    ——数え方が破れていたら、その場で落ちるほうがよい(§13.1)。
    """
    cells = set(requirement.cells)
    mine_covered = covered & cells
    mine_excluded = {cell for cell in exclusions if cell in cells}
    both = mine_covered & mine_excluded
    if both:
        raise RuntimeError(
            f"{requirement.id}: 被覆と除外の両方に入ったセルがある: "
            f"{sorted(cell.id for cell in both)[:3]}"
        )
    required = len(cells)
    unmet = required - len(mine_covered) - len(mine_excluded)
    if len(mine_covered) + len(mine_excluded) + unmet != required:
        raise RuntimeError(f"{requirement.id}: 整合式が成立しない")
    if unmet:
        status = "incomplete"
    elif mine_excluded:
        status = "accounted_with_exclusions"
    else:
        status = "complete"
    return {
        "id": requirement.id,
        "scope": requirement.scope,
        "strength": requirement.strength,
        "required_cells": required,
        "covered_cells": len(mine_covered),
        "excluded_cells": len(mine_excluded),
        "unmet_cells": unmet,
        "status": status,
    }


def build_payload(
    model: str,
    requirements: Sequence[Requirement],
    covered: set[Cell],
    exclusions: Mapping[Cell, Exclusion],
    generation_rejections: Mapping[str, int],
) -> dict[str, object]:
    """`coverage` の中身(設計書 §11.2)。**順序は決定的**——`cell_id` で並べる。"""
    known = {cell for requirement in requirements for cell in requirement.cells}
    stray_exclusions = [cell for cell in exclusions if cell not in known]
    if stray_exclusions:
        raise RuntimeError(
            "モデルの外のセルを除外している: "
            f"{sorted(cell.id for cell in stray_exclusions)[:3]}"
        )
    stray_covered = [cell for cell in covered if cell not in known]
    if stray_covered:
        raise RuntimeError(
            "モデルの外のセルを被覆として数えている: "
            f"{sorted(cell.id for cell in stray_covered)[:3]}"
        )
    return {
        "schema": COVERAGE_SCHEMA,
        "model": model,
        "requirements": [summarize(r, covered, exclusions) for r in requirements],
        "excluded_cells": [
            exclusions[cell].as_json() for cell in sorted(exclusions, key=lambda c: c.id)
        ],
        "generation_rejections": dict(sorted(generation_rejections.items())),
    }
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_corpus_coverage.py -q`
Expected: PASS（11 passed）

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc-e2e
test "$(git branch --show-current)" = feature/coverage-model && \
git add reference/src/calcarc_reference/corpus_coverage.py reference/tests/test_corpus_coverage.py && \
git commit -m "Give required cells a vocabulary of their own"
```

---

### Task 2: 金融の因子表から要求セルを列挙する

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`（`FINANCE_STRATA` の定義より後、末尾の `SCHEMA` より前）
- Test: `reference/tests/test_generate_corpus.py`（追記）

**Interfaces:**
- Consumes: Task 1 の `corpus_coverage`（`Cell` / `Requirement` / `all_combination_cells` / `pairwise_cells`）
- Produces: `corpus_calls.FINANCE_MODEL = "finance-v1"`、`corpus_calls.COVERAGE_FACTORS: dict[str, dict[str, tuple[object, ...]]]`（scope → 因子名 → 水準列）、`corpus_calls.FINANCE_REQUIREMENTS: tuple[Requirement, ...]`

**要点:** **水準の写しを作らない。** `PAIRWISE_RATE_LEVELS` / `PAIRWISE_LOAN_TERM_LEVELS` /
`PAIRWISE_COMPOUND_TERM_LEVELS` / `PERIODS_PER_YEAR_OK` から組み立てる（仕様 §7.1「一次資料とする。
写しを作ってはならない」）。`loan_term` の第 2 因子だけ名前が `target_n` になる（入力ではなく答だから）。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_the_model_enumerates_every_required_cell_exactly_once() -> None:
    """設計書 §15.1 の 1。**要求セルは一意**。実測(2026-08-25)の内訳:
    loan 系 4 op が各 150、`loan_term` が 150、`compound_grow` と
    `compound_deposit_for` が各 266、`compound_periods_for` が 56。
    """
    requirements = corpus_calls.FINANCE_REQUIREMENTS
    assert [r.scope for r in requirements] == [
        "loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal",
        "loan_term", "compound_grow", "compound_deposit_for", "compound_periods_for",
    ]
    sizes = {r.scope: len(r.cells) for r in requirements}
    assert sizes == {
        "loan_forward": 150, "loan_principal": 150, "loan_bonus_forward": 150,
        "loan_bonus_principal": 150, "loan_term": 150,
        "compound_grow": 266, "compound_deposit_for": 266, "compound_periods_for": 56,
    }
    for requirement in requirements:
        ids = [cell.id for cell in requirement.cells]
        assert len(ids) == len(set(ids)), f"{requirement.id} にセルの重複がある"


def test_the_model_reads_the_levels_from_the_factor_tables() -> None:
    """設計書 §7.1。**写しを持たない**——因子表を 1 つ削れば、要求セルも減る。"""
    rate_levels = {level for level in corpus_calls.PAIRWISE_RATE_LEVELS}
    loan = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "loan_forward")
    assert {dict(cell.axes)["rate"] for cell in loan.cells} == rate_levels
    term = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "loan_term")
    assert {dict(cell.axes)["target_n"] for cell in term.cells} == {
        str(n) for n in corpus_calls.PAIRWISE_LOAN_TERM_LEVELS
    }
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "the_model" -q`
Expected: FAIL（`AttributeError: module 'calcarc_reference.corpus_calls' has no attribute 'FINANCE_REQUIREMENTS'`）

- [ ] **Step 3: 実装する**

```python
from . import corpus_coverage as coverage  # ファイル冒頭の import に足す

FINANCE_MODEL = "finance-v1"

#: scope → 因子名 → 水準列(設計書 §7.2)。**水準は因子表から読む**——ここに
#: 数字を書き写すと、因子表を直したときに片方だけが動く。
COVERAGE_FACTORS: dict[str, dict[str, tuple[object, ...]]] = {
    op: {"rate": PAIRWISE_RATE_LEVELS, "n": PAIRWISE_LOAN_TERM_LEVELS}
    for op in ("loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal")
} | {
    # `loan_term` の第 2 因子は**入力ではなく答**なので名前を変える(§8.2)。
    "loan_term": {"rate": PAIRWISE_RATE_LEVELS, "target_n": PAIRWISE_LOAN_TERM_LEVELS},
    "compound_grow": dict(PAIRWISE_COMPOUND_GROW_FACTORS),
    "compound_deposit_for": dict(PAIRWISE_COMPOUND_GROW_FACTORS),
    "compound_periods_for": dict(PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS),
}

#: 被覆規則(設計書 §7.2)。loan 系は全組合せ、compound 系は 2 因子ペアワイズ。
FINANCE_REQUIREMENTS: tuple[coverage.Requirement, ...] = (
    *(
        coverage.Requirement(
            f"{op}/rate-n/all", op, "all",
            coverage.all_combination_cells(op, COVERAGE_FACTORS[op]),
        )
        for op in ("loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal")
    ),
    coverage.Requirement(
        "loan_term/rate-target_n/all", "loan_term", "all",
        coverage.all_combination_cells("loan_term", COVERAGE_FACTORS["loan_term"]),
    ),
    coverage.Requirement(
        "compound_grow/rate-periods-ppy-tax/pairwise", "compound_grow", "pairwise",
        coverage.pairwise_cells("compound_grow", COVERAGE_FACTORS["compound_grow"]),
    ),
    coverage.Requirement(
        "compound_deposit_for/rate-periods-ppy-tax/pairwise", "compound_deposit_for", "pairwise",
        coverage.pairwise_cells("compound_deposit_for", COVERAGE_FACTORS["compound_deposit_for"]),
    ),
    coverage.Requirement(
        "compound_periods_for/rate-ppy-tax/pairwise", "compound_periods_for", "pairwise",
        coverage.pairwise_cells("compound_periods_for", COVERAGE_FACTORS["compound_periods_for"]),
    ),
)
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "the_model" -q`
Expected: PASS（2 passed）

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Name the finite test space the finance corpus aims at"
```

---

### Task 3: 生成済みケースから被覆セルを数え直す

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 2 の `COVERAGE_FACTORS` / `FINANCE_REQUIREMENTS`
- Produces: `corpus_calls.covered_cells_from_cases(cases) -> set[coverage.Cell]`

**要点:** **入力の実値ではなく水準へ写してから数える**（着手前の実測: 素朴に数えると
`compound_deposit_for` だけで 1,491 通りになり、要求セルと単位が合わない）。水準表に無い値は
**数えない**。`loan_term` はここでは扱わない——`target_n` が入力に無いので Task 4 が担う。
1 件のケースが複数のセルを踏む（仕様 §9.3）ことは、集合へ足すだけで自然に成り立つ。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_coverage_is_recomputed_from_the_generated_cases() -> None:
    """設計書 §15.1 の 2 と 7。**1 件のケースは複数のセルを踏む。**"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=corpus_calls_count())
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    grow = next(r for r in corpus_calls.FINANCE_REQUIREMENTS if r.scope == "compound_grow")
    assert set(grow.cells) <= covered, "compound_grow の 266 セルは全部踏まれているはず"
    one = {"kind": "call", "op": "compound_grow", "stratum": "compound_grow/pairwise_0000",
           "input": {"rate": "20", "periods": 12, "periods_per_year": 2, "tax": True},
           "expect": {}}
    assert len(corpus_calls.covered_cells_from_cases([one])) == 6  # 4 因子の 2 因子組は 6 通り


def test_values_outside_the_level_table_are_not_counted() -> None:
    """乱択のケースは水準表の外の値を持つ。**それを 1 セルとして数えない。**"""
    stray = {"kind": "call", "op": "compound_grow", "stratum": "compound_grow/random",
             "input": {"rate": "3.3", "periods": 7, "periods_per_year": 2, "tax": True},
             "expect": {}}
    covered = corpus_calls.covered_cells_from_cases([stray])
    assert all("rate=3.3" not in cell.id for cell in covered)
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "recomputed or outside_the_level" -q`
Expected: FAIL（`AttributeError: ... covered_cells_from_cases`）

- [ ] **Step 3: 実装する**

```python
#: scope → (因子名, `case["input"]` の鍵)。**`loan_term` はここに置かない**
#: ——`target_n` は入力に無く、答であるため(§8.2、Task 4 が扱う)。
_COVERAGE_INPUT_KEYS: dict[str, tuple[tuple[str, str], ...]] = {
    op: (("rate", "rate"), ("n", "n"))
    for op in ("loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal")
} | {
    "compound_grow": (("rate", "rate"), ("periods", "periods"),
                      ("periods_per_year", "periods_per_year"), ("tax", "tax")),
    "compound_deposit_for": (("rate", "rate"), ("periods", "periods"),
                             ("periods_per_year", "periods_per_year"), ("tax", "tax")),
    "compound_periods_for": (("rate", "rate"),
                             ("periods_per_year", "periods_per_year"), ("tax", "tax")),
}


def covered_cells_from_cases(cases: Sequence[dict]) -> set[coverage.Cell]:
    """生成済みのケースが踏んだ要求セル(設計書 §15.1 の 2)。

    **入力の実値ではなく水準へ写してから数える。** 水準表に無い値は数えない
    ——乱択のケースは水準の外の値を持つので、素朴に数えると要求セルと単位が
    合わなくなる(実測: `compound_deposit_for` だけで 1,491 通り)。

    **1 件が複数のセルを踏む**(§9.3)。集合へ足すので、重複生成は要らない。
    """
    covered: set[coverage.Cell] = set()
    for case in cases:
        axes = _COVERAGE_INPUT_KEYS.get(case["op"])
        if axes is None:
            continue
        factors = COVERAGE_FACTORS[case["op"]]
        present: list[tuple[str, str]] = []
        for name, key in axes:
            if key not in case["input"]:
                break
            value = case["input"][key]
            if value not in factors[name]:
                break
            present.append((name, coverage.level_text(value)))
        else:
            requirement = _REQUIREMENT_OF[case["op"]]
            if requirement.strength == "all":
                covered.add(coverage.Cell(case["op"], tuple(present)))
            else:
                for left, right in combinations(present, 2):
                    covered.add(coverage.Cell(case["op"], (left, right)))
    return covered


_REQUIREMENT_OF: dict[str, coverage.Requirement] = {r.scope: r for r in FINANCE_REQUIREMENTS}
```

（`from itertools import combinations` と `from collections.abc import Sequence` を冒頭の import へ足す。）

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "recomputed or outside_the_level" -q`
Expected: PASS（2 passed）

- [ ] **Step 5: 実測して記録する（この Task の成果物）**

Run:

```bash
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config python -c "
from calcarc_reference import corpus_calls as cc
shard = cc.build_finance_shard(seed=20260821, count=3500)
covered = cc.covered_cells_from_cases(shard['cases'])
for r in cc.FINANCE_REQUIREMENTS:
    mine = covered & set(r.cells)
    print(f'{r.scope:24s} 要求 {len(r.cells):4d}  被覆 {len(mine):4d}  未達 {len(r.cells)-len(mine):4d}')
"
```

**この表を Task 12 の記録に使う。** `loan_term` はここでは 0 被覆になる（Task 4 が扱う）。

- [ ] **Step 6: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Count coverage in levels, not in the values that happened to appear"
```

---

### Task 4: `loan_term` の目標期間と実結果を分ける

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`（`_pairwise_loan_term_strata`）
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 2 の `FINANCE_REQUIREMENTS`、Task 1 の `Cell` / `Exclusion` / `Reason`
- Produces: `corpus_calls.LoanTermFact`（dataclass: `rate_level: str`、`target_n: int`、`principal: int`、`payment: int | None`、`actual_n: int | None`、`error: str | None`、`state: str`）、`corpus_calls.LOAN_TERM_FACTS: tuple[LoanTermFact, ...]`（`_pairwise_loan_term_strata()` が組み立てる際に埋める）

**要点:** 仕様 §8.2。`state` は `covered`（`actual_n == target_n`）／`excluded`（正算が本物の
エラーで入力を構成できない）／`unmet`（ケースは作れたが目標を満たしていない）の 3 値。
**この Task では挙動を変えない**——いまの構成のまま、何が起きているかを記録するだけ。
着手前の実測どおり `covered` 74・`unmet` 59・`excluded` 17 になるはずで、**ならなければ
実測か実装のどちらかが間違っている。**

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_loan_term_records_target_and_actual_separately() -> None:
    """設計書 §8.2。**答が目標と一致した行だけが `covered`。**
    実測(2026-08-25、この Task の時点): covered 74 / unmet 59 / excluded 17。
    """
    facts = corpus_calls.LOAN_TERM_FACTS
    assert len(facts) == 150, "要求セルと同じ数だけ記録が要る(構成できなかった行も含めて)"
    states = collections.Counter(fact.state for fact in facts)
    assert states == {"covered": 74, "unmet": 59, "excluded": 17}
    for fact in facts:
        if fact.state == "covered":
            assert fact.actual_n == fact.target_n
        if fact.state == "unmet":
            assert fact.actual_n != fact.target_n or fact.error is not None


def test_loan_term_coverage_counts_only_the_matching_rows() -> None:
    """設計書 §15.1 の 8。**`actual_n == target_n` のときだけ目標期間セルを被覆する。**"""
    covered = corpus_calls.loan_term_covered_cells()
    assert len(covered) == 74
    for cell in covered:
        axes = dict(cell.axes)
        fact = next(
            f for f in corpus_calls.LOAN_TERM_FACTS
            if f.rate_level == axes["rate"] and str(f.target_n) == axes["target_n"]
        )
        assert fact.actual_n == fact.target_n
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "loan_term_records or loan_term_coverage" -q`
Expected: FAIL（`AttributeError: ... LOAN_TERM_FACTS`）

- [ ] **Step 3: 実装する**

`_pairwise_loan_term_strata()` を、層と一緒に記録も作るように変える。

```python
@dataclass(frozen=True)
class LoanTermFact:
    """`loan_term` の 1 行が、目標期間に対して何をしたか(設計書 §8.2)。

    **`target_n` は入力ではなく答である。** 正算で作った月額を逆算へ戻すと、
    円単位の丸めのぶんだけ答がずれることがある——ずれた行は計算の照合には
    使えるが、**目標期間セルを被覆したことにはならない。**
    """

    rate_level: str
    target_n: int
    principal: int
    payment: int | None
    actual_n: int | None
    error: str | None
    state: str  # "covered" | "unmet" | "excluded"


_LOAN_TERM_FACTS: list[LoanTermFact] = []


def _pairwise_loan_term_strata() -> tuple[Stratum, ...]:
    strata = []
    index = 0
    infeasible = 0
    for row in _PAIRWISE_LOAN_ROWS:
        rate, n = row["rate"], row["n"]
        resolved = _pairwise_forward_result(rate, n)
        if resolved is None or resolved[2] != "ok":
            infeasible += 1
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, resolved[0] if resolved else 0, None, None,
                             resolved[2] if resolved else "no-candidate", "excluded")
            )
            continue
        principal, payment, _ = resolved
        params = {"principal": str(principal), "rate": rate, "payment": str(payment)}
        if not _claim_pairwise_signature("loan_term", params):
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, principal, payment, None, "duplicate", "unmet")
            )
            continue
        result = loan_ref.compute("loan_term", params)
        expect = result.get("error", "ok")
        actual = None if "error" in result else int(result["n"])
        _LOAN_TERM_FACTS.append(
            LoanTermFact(rate, n, principal, payment, actual,
                         None if actual is not None else expect,
                         "covered" if actual == n else "unmet")
        )
        strata.append(Stratum("loan_term", f"pairwise_{index:04d}", expect, 0,
                              lambda rng, i, params=params: params))
        index += 1
    assert infeasible == PAIRWISE_LOAN_TERM_SKIPPED_COUNT, (...)   # 既存のまま
    return tuple(strata)


LOAN_TERM_FACTS: tuple[LoanTermFact, ...] = tuple(_LOAN_TERM_FACTS)  # FINANCE_STRATA の直後で凍らせる


def loan_term_covered_cells() -> set[coverage.Cell]:
    """設計書 §8.2。**一致した行だけ。**"""
    return {
        coverage.Cell("loan_term", (("rate", fact.rate_level), ("target_n", str(fact.target_n))))
        for fact in LOAN_TERM_FACTS
        if fact.state == "covered"
    }
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -q`
Expected: PASS（既存の全テストも緑のまま。**`FINANCE_STRATA` の中身は 1 件も変えていない**）

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Tell the target term apart from the term the reference returned"
```

---

### Task 5: `loan_term` の決定的構成探索（未達 59 → 7）

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 4 の `LoanTermFact` / `LOAN_TERM_FACTS`
- Produces: `corpus_calls._LOAN_TERM_PAYMENT_DELTAS: tuple[int, ...]`、`corpus_calls.loan_term_exclusions() -> dict[coverage.Cell, coverage.Exclusion]`

**要点:** 仕様 §8.3。**乱数を使わない・候補順が固定・試行上限を持つ・成功時は
`actual_n == target_n` を assert する。** 着手前の実測では、元本候補
（`_LOAN_PAIRWISE_PRINCIPAL_OFFSETS` の 12 通り）× 月額の増分
`(0, +1, -1, +2, -2)` の固定順で **52 行が被覆へ動く**（50 行は `+1`、2 行は別の元本の `+0`）。
**残る 7 行はすべて `target_n = 1201`** で、`loan_ref.MAX_TERM_MONTHS = 1200` である以上
`loan_term` は 1201 を返しようがない——`not_applicable` で除外する（`inverse_target_unconstructible`
ではない。構成の努力の問題ではなく、その操作にその水準が存在しないため）。

**この Task が `finance-000.json` を動かす。** 52 行の入力（月額）が変わり、
`_claim_pairwise_signature` の並びも変わるので、乱択の末尾がずれる。**Task 12 で測る。**

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_the_deterministic_search_moves_fifty_two_rows_into_coverage() -> None:
    """設計書 §8.3。**乱数を使わない固定順の候補列で目標期間を狙う。**
    実測(2026-08-25): 52 行が動く(50 行は月額 +1 円、2 行は別の元本)。
    """
    states = collections.Counter(fact.state for fact in corpus_calls.LOAN_TERM_FACTS)
    assert states["covered"] == 126
    assert states["unmet"] == 0
    assert states["excluded"] == 24  # 17(正算が本物のエラー) + 7(1201 は答になり得ない)


def test_the_unreachable_term_is_excluded_as_not_applicable() -> None:
    """`loan_ref.MAX_TERM_MONTHS` が 1200 なので、`loan_term` は 1201 を返せない。
    **構成の失敗ではなく、その操作にその水準が無い**——理由コードを取り違えない。
    """
    exclusions = corpus_calls.loan_term_exclusions()
    not_applicable = [e for e in exclusions.values() if e.reason is coverage.Reason.NOT_APPLICABLE]
    assert len(not_applicable) == 7
    assert all("1201" in e.cell.id for e in not_applicable)
    assert all(str(loan_ref.MAX_TERM_MONTHS) in e.detail for e in not_applicable)


def test_a_constructed_row_really_hits_its_target() -> None:
    """設計書 §8.3 の「成功時は assert する」。**構成不能を黙って別の期間の
    ケースへ置き換えていないこと**を、参照実装に聞いて確かめる。"""
    for fact in corpus_calls.LOAN_TERM_FACTS:
        if fact.state != "covered":
            continue
        result = loan_ref.compute("loan_term", {
            "principal": str(fact.principal), "rate": fact.rate_level, "payment": str(fact.payment)
        })
        assert int(result["n"]) == fact.target_n
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "fifty_two or not_applicable or really_hits" -q`
Expected: FAIL（`covered` が 74 のまま、`loan_term_exclusions` が無い）

- [ ] **Step 3: 実装する**

```python
#: 月額の増分の候補。**固定順**(設計書 §8.3)。円単位に丸めた月額を逆算へ
#: 戻すと 1 期ぶん長く出ることが多いので、`+1` を先に試す(実測: 52 行のうち
#: 50 行が `+1` で目標に乗る)。
_LOAN_TERM_PAYMENT_DELTAS: tuple[int, ...] = (0, 1, -1, 2, -2)


def _construct_loan_term_row(rate: str, target: int) -> tuple[int, int] | None:
    """`actual_n == target` になる `(principal, payment)` を固定順で探す。

    **乱数を使わない。候補順は `_LOAN_PAIRWISE_PRINCIPAL_OFFSETS` ×
    `_LOAN_TERM_PAYMENT_DELTAS` の 12 × 5 = 60 通りで、上限もこれである。**
    `LoanError` は元本を変えても消えない本物の結果なので、その場で諦める
    (`_pairwise_forward_result` と同じ判断)。
    """
    num, den = loan_ref.rate_fraction(rate)
    for offset in _LOAN_PAIRWISE_PRINCIPAL_OFFSETS:
        principal = _LOAN_PAIRWISE_PRINCIPAL_BASE + offset
        try:
            forward = loan_ref.forward(principal, num, den, target, 0)
        except loan_ref.LoanError:
            return None
        except ValueError:
            continue  # 円境界の番人。次の元本へ
        for delta in _LOAN_TERM_PAYMENT_DELTAS:
            payment = forward["monthly_payment"] + delta
            if payment <= 0:
                continue
            result = loan_ref.compute(
                "loan_term", {"principal": str(principal), "rate": rate, "payment": str(payment)}
            )
            if "error" not in result and int(result["n"]) == target:
                return principal, payment
    return None
```

`_pairwise_loan_term_strata()` の中で、`_pairwise_forward_result` が `ok` を返した行について
**まず `_construct_loan_term_row` を呼び**、返ってきた `(principal, payment)` で層を作る。
返らなかった行は `state="unmet"` のまま残し、`loan_term_exclusions()` が理由を付ける。

```python
def loan_term_exclusions() -> dict[coverage.Cell, coverage.Exclusion]:
    """構成できなかった目標期間セルに理由を付ける(設計書 §8.3・§10)。"""
    out: dict[coverage.Cell, coverage.Exclusion] = {}
    for fact in LOAN_TERM_FACTS:
        if fact.state == "covered":
            continue
        cell = coverage.Cell(
            "loan_term", (("rate", fact.rate_level), ("target_n", str(fact.target_n)))
        )
        if fact.target_n > loan_ref.MAX_TERM_MONTHS:
            out[cell] = coverage.Exclusion(
                cell, coverage.Reason.NOT_APPLICABLE,
                f"loan_term は {loan_ref.MAX_TERM_MONTHS} か月を上限に探索するので、"
                f"{fact.target_n} か月は答になり得ない",
                (f"loan_forward/rate={fact.rate_level},n={fact.target_n}",),
            )
        else:
            out[cell] = coverage.Exclusion(
                cell, coverage.Reason.INVERSE_TARGET_UNCONSTRUCTIBLE,
                "決定的な候補(元本 12 通り × 月額の増分 5 通り)を尽くしても、"
                "正算が本物のエラーになり逆算の入力を作れない",
                (f"loan_forward/rate={fact.rate_level},n={fact.target_n}",),
            )
    return out
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -q`
Expected: PASS。**`test_the_current_generator_gives_up_only_for_one_classified_reason` が
赤くなる可能性がある**（乱択列がずれて `near_yen_boundary` の実測が動く）。
**その場合は数を測り直し、テストの docstring に「Task 5 で 52 行の月額が変わり、
乱択層の並びがずれた」と理由を書いて更新する**——理由を書かずに数だけ差し替えない。

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Aim the inverse rows at the term they were supposed to hit"
```

---

### Task 6: `compound_deposit_for` の操作単体の被覆と、溢れた 19 ペアの除外

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 3 の `covered_cells_from_cases`
- Produces: `corpus_calls.compound_deposit_for_exclusions(covered) -> dict[coverage.Cell, coverage.Exclusion]`

**着手前の実測（仕様の数字を 1 つ訂正する）:** 仕様 §9.1 は「266 中 246 被覆・残り 20」と書くが、
**それはペアワイズ層のケースだけを数えた値である。** 仕様 §9.3 の規則（1 件が複数セルを被覆する／
層はケースの生成目的にすぎない）に従って `compound_deposit_for` の**全ケース**から数えると
**247 被覆・欠け 19**になる。差の 1 ペア（`rate=0 × periods=1`）は、ペアワイズ行としては
重複で落ちているが、**同じ入力のケースが名指し層として実在する**。

**残る 19 ペアは 1 つ残らず、`_compound_reached(0, 1, …)` が u64 を溢れさせた 17 行**が
運んでいたものである（`rate=100`／`20`／`99.9999` × 長期間、および `rate=100 × ppy=12`）。
積立額を最小の 1 円にしても `(1+r)^n` 自体が溢れるので、§9.2 の代替構成（元本・積立額・
基準期間を振る）では救えない——**`source_overflow`（reasonable）で除外する。**

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_compound_deposit_for_coverage_uses_only_its_own_cases() -> None:
    """設計書 §15.1 の 9。**`compound_grow` が同じペアを踏んでいても数えない。**"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    mine = {cell for cell in covered if cell.scope == "compound_deposit_for"}
    assert len(mine) == 247
    grow_only = {
        corpus_coverage.Cell("compound_deposit_for", cell.axes)
        for cell in covered if cell.scope == "compound_grow"
    }
    assert grow_only - mine, "compound_grow だけが踏んでいるペアが在るはず(混ぜていない証拠)"


def test_the_overflowing_pairs_are_excluded_as_source_overflow() -> None:
    """正算が u64 を溢れさせるので、逆算の目標値が作れない(設計書 §10.1)。
    **積立額を最小の 1 円にしても溢れる**ことを、参照実装に聞いて確かめる。
    """
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    covered = corpus_calls.covered_cells_from_cases(shard["cases"])
    exclusions = corpus_calls.compound_deposit_for_exclusions(covered)
    assert len(exclusions) == 19
    assert all(e.reason is corpus_coverage.Reason.SOURCE_OVERFLOW for e in exclusions.values())
    for cell in exclusions:
        axes = dict(cell.axes)
        if "periods" not in axes:
            continue
        assert corpus_calls._compound_reached(
            0, 1, axes["rate"], 1, int(axes["periods"]), False
        ) is None
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "deposit_for_coverage or overflowing_pairs" -q`
Expected: FAIL（`compound_deposit_for_exclusions` が無い）

- [ ] **Step 3: 実装する**

```python
def compound_deposit_for_exclusions(
    covered: set[coverage.Cell],
) -> dict[coverage.Cell, coverage.Exclusion]:
    """踏めなかったペアに理由を付ける(設計書 §9.1・§10)。

    **踏めなかった原因は 1 つに収束する**——目標値は `_compound_reached` が
    正算で作るので、そこが u64 を溢れると逆算の入力そのものが作れない。
    積立額は既に最小(1 円)なので、`(1+r)^n` が溢れる組は元本や積立額を
    どう振っても救えない(§9.2 の代替構成の外にある)。
    """
    requirement = _REQUIREMENT_OF["compound_deposit_for"]
    out: dict[coverage.Cell, coverage.Exclusion] = {}
    for cell in requirement.cells:
        if cell in covered:
            continue
        axes = dict(cell.axes)
        out[cell] = coverage.Exclusion(
            cell,
            coverage.Reason.SOURCE_OVERFLOW,
            "積立 1 円でも正算が u64 を溢れるので、逆算の目標値を作れない",
            (f"compound_grow/{','.join(f'{k}={v}' for k, v in cell.axes)}",),
        )
    return out
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Say why nineteen deposit pairs have no case to stand on"
```

---

### Task 7: `coverage` を `finance-000.json` へ載せる

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_calls.py`（`build_finance_shard`）
- Test: `reference/tests/test_generate_corpus.py`

**Interfaces:**
- Consumes: Task 1〜6 のすべて
- Produces: `build_finance_shard()` の戻り値に `"coverage"` キー（`schema` / `model` / `requirements` / `excluded_cells` / `generation_rejections`）。**`cases` より前に置く**（仕様 §11.2 の並び）

**要点:** `generation_rejections` は**乱択候補の棄却**であり、要求セルの除外とは別の入れ物である
（仕様 §10.3）。既存の `rejections` はそのまま残し、`coverage.generation_rejections` へは
仕様 §11.2 の綴り（`candidate_duplicate` / `oracle_near_yen_boundary` / `oracle_search_limit`）で
**写して**入れる——`rejections` の綴りは既存の読み手（`report.ts` の `renderGaveUp`）が使っている
ので変えない。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_the_finance_shard_carries_its_coverage() -> None:
    """設計書 §11.2・§18。"""
    shard = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    cov = shard["coverage"]
    assert cov["schema"] == corpus_coverage.COVERAGE_SCHEMA
    assert cov["model"] == "finance-v1"
    assert [r["id"] for r in cov["requirements"]] == [r.id for r in corpus_calls.FINANCE_REQUIREMENTS]
    for r in cov["requirements"]:
        assert r["required_cells"] == r["covered_cells"] + r["excluded_cells"] + r["unmet_cells"]
        assert r["unmet_cells"] == 0, f"{r['id']} に未達が残っている"
    assert cov["generation_rejections"]["oracle_search_limit"] == 0
    assert list(shard) == ["schema", "generated_by", "rejections", "coverage", "cases"]


def test_generating_twice_is_byte_identical_including_coverage() -> None:
    """設計書 §15.1 の 10。"""
    first = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    second = corpus_calls.build_finance_shard(seed=20260821, count=3500)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "carries_its_coverage or byte_identical" -q`
Expected: FAIL（`KeyError: 'coverage'`）

- [ ] **Step 3: 実装する**

`build_finance_shard` の戻り値の直前へ:

```python
    covered = covered_cells_from_cases(entries) | loan_term_covered_cells()
    exclusions = {**loan_term_exclusions(), **compound_deposit_for_exclusions(covered)}
    gave_up = rejections["reference_gave_up"]
    coverage_payload = coverage.build_payload(
        FINANCE_MODEL,
        FINANCE_REQUIREMENTS,
        covered,
        exclusions,
        {
            # **綴りは設計書 §11.2 のもの。** 既存の `rejections` の綴りは
            # 読み手が使っているので変えない——ここは写しである。
            "candidate_duplicate": rejections["dup"],
            "oracle_near_yen_boundary": gave_up["near_yen_boundary"],
            "oracle_search_limit": gave_up["compound_deposit_search_limit"],
        },
    )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "rejections": rejections,
        "coverage": coverage_payload,
        "cases": entries,
    }
```

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Write the map of the space beside the cases it covers"
```

---

### Task 8: Python 側の反証可能性テスト

**Files:**
- Test: `reference/tests/test_generate_corpus.py`（追記のみ。**実装は変えない**）

**Interfaces:**
- Consumes: Task 7 までのすべて
- Produces: なし（テストだけ）

**要点:** 仕様 §15.1 の 4・5・6 と「本当に赤くなるか」の確認。**変異は `monkeypatch` で当てる**
——ファイルを書き換えて戻す手順は使わない（同じワークツリーに別の作業がある。
[[red-check-procedure]] の轍を踏まない）。

- [ ] **Step 1: テストを書く（この Task はテストが成果物）**

```python
def test_dropping_one_required_cell_shows_up_as_unmet(monkeypatch) -> None:
    """設計書 §15.1 の 5。**要求セルを 1 つ落とすと `unmet` になる。**
    緑のまま通ってしまうなら、この集計は何も主張していない。
    """
    requirement = corpus_calls._REQUIREMENT_OF["compound_grow"]
    covered = set(requirement.cells) - {requirement.cells[0]}
    summary = corpus_coverage.summarize(requirement, covered, {})
    assert summary["unmet_cells"] == 1
    assert summary["status"] == "incomplete"


def test_removing_one_exclusion_makes_the_generator_fail(monkeypatch) -> None:
    """設計書 §15.1 の 6・§13.1。**除外を 1 つ消すと未達が残り、生成器が落ちる。**"""
    monkeypatch.setattr(corpus_calls, "loan_term_exclusions", dict)
    with pytest.raises(RuntimeError, match="未達"):
        corpus_calls.build_finance_shard(seed=20260821, count=3500)


def test_an_unknown_reason_code_is_refused(monkeypatch) -> None:
    """設計書 §13.1。**`other` は無い。** 文字列を理由として渡せない。"""
    cell = corpus_calls._REQUIREMENT_OF["loan_term"].cells[0]
    with pytest.raises((KeyError, ValueError)):
        corpus_coverage.Exclusion(cell, "made_up_reason", "x").disposition
```

**`build_finance_shard` に「未達が残っていたら落ちる」門を足す**（§13.1 の
「必須セルが、被覆・除外・未達のどれにも分類されない」／未達を黙って通さない）:

```python
    for summary in coverage_payload["requirements"]:
        if summary["unmet_cells"]:
            raise RuntimeError(
                f"{summary['id']}: 未達セルが {summary['unmet_cells']} 件ある"
                "(被覆にも理由付き除外にも入っていない。設計書 §13.1)"
            )
```

- [ ] **Step 2: 3 本とも本当に赤くなることを確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest tests/test_generate_corpus.py -k "dropping_one or removing_one or unknown_reason" -q`
Expected: 門を足す**前**は `removing_one` が緑になってしまう（＝何も主張していない）。
**門を足してから赤→緑の順で確かめること。**

- [ ] **Step 3: 全部緑にする**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest -q`
Expected: PASS（既存 362 + 追加分）

- [ ] **Step 4: コミット**

```bash
git add reference/src/calcarc_reference/corpus_calls.py reference/tests/test_generate_corpus.py
git commit -m "Prove the coverage count can go red"
```

---

### Task 9: コーパスを作り直し、固定コーパスの再現性を通す

**Files:**
- Modify: `corpus/generated/finance-000.json`（生成物。手で編集しない）
- Test: `reference/tests/test_generate_corpus.py`（既存の再現性テスト）

**Interfaces:**
- Consumes: Task 7 の `coverage` 付き `build_finance_shard`
- Produces: `coverage` を持つ `finance-000.json`（以降の TypeScript の Task はこれを読む）

**要点:** 仕様 §17 は再現性を 11 番目に置くが、**TypeScript 側の Task は実物の
`finance-000.json` を読む**ので、ここで作り直しておく。**他の 17 枚が 1 バイトも
動いていないこと**を差分で確かめる（Global Constraints）。

- [ ] **Step 1: 作り直す**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config python scripts/generate.py`

- [ ] **Step 2: 動いたのが 1 枚だけであることを確かめる**

Run: `git status --short corpus/ testdata/`
Expected: `M corpus/generated/finance-000.json` の 1 行だけ

- [ ] **Step 3: 何がどう動いたかを測る**

Run:

```bash
cd /home/terapyon/dev/CalcArc-e2e && python3 - <<'PY'
import json, subprocess, collections
new = json.load(open('corpus/generated/finance-000.json'))
old = json.loads(subprocess.run(
    ['git', 'show', 'HEAD:corpus/generated/finance-000.json'],
    capture_output=True, text=True).stdout)
o = {c['id']: c for c in old['cases']}
n = {c['id']: c for c in new['cases']}
changed = [i for i in o if i in n and o[i] != n[i]]
print('ケース数:', len(old['cases']), '->', len(new['cases']))
print('中身が動いたケース:', len(changed))
print('op 別:', collections.Counter(n[i]['op'] for i in changed))
print('rejections:', old['rejections'], '->', new['rejections'])
for r in new['coverage']['requirements']:
    print(f"  {r['scope']:24s} 要求 {r['required_cells']:4d} 被覆 {r['covered_cells']:4d} "
          f"除外 {r['excluded_cells']:3d} 未達 {r['unmet_cells']:3d} {r['status']}")
PY
```

**この出力を Task 12 の記録に使う。**

- [ ] **Step 4: 再現性テストを通す**

Run: `cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest -q`
Expected: PASS（コミット済みコーパスと生成結果の厳密一致を見るテストを含む）

- [ ] **Step 5: コミット**

```bash
git add corpus/generated/finance-000.json
git commit -m "Regenerate the finance shard with its coverage"
```

---

### Task 10: TypeScript 側の読取・拒否・Heavy の合否

**Files:**
- Modify: `heavy/tests/corpus/corpus.ts`
- Modify: `heavy/tests/corpus/corpus.spec.ts`（拒否のテスト）
- Modify: `heavy/tests/corpus/calls.spec.ts`（Heavy の合否）

**Interfaces:**
- Consumes: Task 9 の `finance-000.json`
- Produces: `corpus.ts` の `KNOWN_COVERAGE_SCHEMA = 1`、`SUPPORTED_COVERAGE_MODELS = new Set(["finance-v1"])`、`COVERAGE_REASONS`（仕様 §10.1 の 10 個）、`COVERAGE_DISPOSITIONS`、`COVERAGE_STATUSES`、`interface Coverage` / `CoverageRequirement` / `CoverageExclusion`、`CallShard.coverage?: Coverage`、`CallBreakdown.coverage: Coverage | null`、`assertCoverageIsSound(name: string, shard: CallShard): void`、`COVERAGE_REQUIRED_SHARDS = new Set(["finance-000.json"])`

**要点:** 仕様 §13.2 と §15.2。**読み手は数え直さない**——シャードが宣言した数の
**整合だけ**を見る（既存の `renderGaveUp` と同じ作法）。`unmet_cells > 0` /
`incomplete` / `not_measured` / 未知 schema / 未知 model / 未知理由 / 整合不一致 は
**Heavy を落とす**。`accepted_risk` は**警告**で、成功ケースへ加算しない。

- [ ] **Step 1: 失敗するテストを書く（`corpus.spec.ts`）**

```typescript
const sound = (): CallShard => ({
  schema: 1, generated_by: "test", cases: [],
  coverage: {
    schema: 1, model: "finance-v1",
    requirements: [{ id: "r", scope: "op", strength: "all",
      required_cells: 3, covered_cells: 2, excluded_cells: 1, unmet_cells: 0,
      status: "accounted_with_exclusions" }],
    excluded_cells: [{ cell_id: "op/a=1", scope: "op", reason: "not_applicable",
      disposition: "reasonable", detail: "x", covered_elsewhere: [] }],
    generation_rejections: { candidate_duplicate: 0 },
  },
});

it("未知の coverage.schema を拒む", () => {
  const shard = sound();
  shard.coverage!.schema = 2;
  expect(() => assertCoverageIsSound("finance-000.json", shard)).toThrow(/schema/);
});

it("未知の model を拒む", () => { /* model = "finance-v2" → toThrow(/model/) */ });

it("件数の整合が取れないシャードを拒む", () => {
  const shard = sound();
  shard.coverage!.requirements[0].covered_cells = 3;   // 3 + 1 + 0 ≠ 3
  expect(() => assertCoverageIsSound("finance-000.json", shard)).toThrow(/整合/);
});

it("未知の除外理由を拒む", () => {
  const shard = sound();
  shard.coverage!.excluded_cells[0].reason = "other";
  expect(() => assertCoverageIsSound("finance-000.json", shard)).toThrow(/理由/);
});

it("未達が残っているシャードを拒む", () => { /* unmet_cells = 1, status incomplete → toThrow(/未達/) */ });

it("not_measured を拒む", () => { /* status = "not_measured" → toThrow(/測定/) */ });

it("finance-000.json が coverage を持たないことを拒む", () => {
  const shard = sound();
  delete shard.coverage;
  expect(() => assertCoverageIsSound("finance-000.json", shard)).toThrow(/coverage/);
});

it("coverage を要求しないシャードには何も言わない", () => {
  const shard = sound();
  delete shard.coverage;
  expect(() => assertCoverageIsSound("data-scale-000.json", shard)).not.toThrow();
});
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test corpus.spec.ts`
Expected: FAIL（`assertCoverageIsSound` が export されていない）

- [ ] **Step 3: 実装する（`corpus.ts`）**

```typescript
/** `coverage` 自身のスキーマ。**15 枚が共有する `KNOWN_SCHEMA` とは別物**(設計書 §11.1)。 */
export const KNOWN_COVERAGE_SCHEMA = 1;
export const SUPPORTED_COVERAGE_MODELS = new Set(["finance-v1"]);
/** 設計書 §10.1 の理由コード。**`other` は無い。** */
export const COVERAGE_REASONS = new Set([
  "duplicate_equivalent", "not_applicable", "inverse_target_unconstructible",
  "source_overflow", "oracle_near_yen_boundary", "oracle_search_limit",
  "candidate_domain", "candidate_out_of_range", "candidate_overflow", "candidate_duplicate",
]);
export const COVERAGE_DISPOSITIONS = new Set(["safe", "reasonable", "accepted_risk"]);
export const COVERAGE_STATUSES = new Set([
  "complete", "accounted_with_exclusions", "incomplete", "not_measured",
]);
/** `coverage` を必ず持つシャード(第1段階は金融だけ。設計書 §11.1)。 */
export const COVERAGE_REQUIRED_SHARDS = new Set(["finance-000.json"]);

export interface CoverageRequirement {
  id: string; scope: string; strength: string;
  required_cells: number; covered_cells: number; excluded_cells: number; unmet_cells: number;
  status: string;
}
export interface CoverageExclusion {
  cell_id: string; scope: string; reason: string; disposition: string;
  detail: string; covered_elsewhere: string[];
}
export interface Coverage {
  schema: number; model: string;
  requirements: CoverageRequirement[];
  excluded_cells: CoverageExclusion[];
  generation_rejections: Record<string, number>;
}

/**
 * **読み手は数え直さない。** シャードが宣言した数の整合だけを見る
 * (設計書 §13.2)。数え直せるのは生成の時点だけで、ここでできるのは
 * 「宣言が自分自身と矛盾していないか」の検算である。
 */
export function assertCoverageIsSound(name: string, shard: CallShard): void {
  const coverage = shard.coverage;
  if (coverage === undefined) {
    if (COVERAGE_REQUIRED_SHARDS.has(name)) {
      throw new Error(`${name}: coverage を持たない(設計書 §13.2)`);
    }
    return;
  }
  if (coverage.schema !== KNOWN_COVERAGE_SCHEMA) {
    throw new Error(`${name}: 未知の coverage.schema ${coverage.schema}`);
  }
  if (!SUPPORTED_COVERAGE_MODELS.has(coverage.model)) {
    throw new Error(`${name}: 未知の model ${coverage.model}`);
  }
  for (const requirement of coverage.requirements) {
    const { required_cells, covered_cells, excluded_cells, unmet_cells, status, id } = requirement;
    if (!COVERAGE_STATUSES.has(status)) {
      throw new Error(`${name}/${id}: 未知の status ${status}`);
    }
    if (covered_cells + excluded_cells + unmet_cells !== required_cells) {
      throw new Error(
        `${name}/${id}: 件数の整合が取れない(${covered_cells}+${excluded_cells}+${unmet_cells}≠${required_cells})`,
      );
    }
    if (unmet_cells > 0 || status === "incomplete") {
      throw new Error(`${name}/${id}: 未達セルが ${unmet_cells} 件ある`);
    }
    if (status === "not_measured") {
      throw new Error(`${name}/${id}: 測定していない`);
    }
  }
  for (const exclusion of coverage.excluded_cells) {
    if (!COVERAGE_REASONS.has(exclusion.reason)) {
      throw new Error(`${name}: 未知の除外理由 ${exclusion.reason}`);
    }
    if (!COVERAGE_DISPOSITIONS.has(exclusion.disposition)) {
      throw new Error(`${name}: 未知の判断区分 ${exclusion.disposition}`);
    }
  }
}
```

`summarizeCallShard` に `coverage: shard.coverage ?? null` を足し、`CallBreakdown` に
`coverage: Coverage | null` を宣言する（**宣言は実物と合っていること**——既存の
`rejections` が `Record<string, number>` と嘘をついていた轍を踏まない）。

- [ ] **Step 4: Heavy の合否につなぐ（`calls.spec.ts`）**

```typescript
it("金融のシャードは自分の試験空間を宣言し、未達を残していない", () => {
  for (const { name, shard } of loadCallShards()) {
    assertCoverageIsSound(name, shard);
  }
});
```

- [ ] **Step 5: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test && pnpm typecheck && pnpm lint`
Expected: すべて緑

- [ ] **Step 6: コミット**

```bash
git add heavy/tests/corpus/corpus.ts heavy/tests/corpus/corpus.spec.ts heavy/tests/corpus/calls.spec.ts
git commit -m "Refuse a corpus that will not say what it covered"
```

---

### Task 11: Heavy レポートの網羅表・除外表・注意文

**Files:**
- Modify: `heavy/tests/corpus/report.ts`（`renderCallBreakdowns` の中、op 表の直後）
- Modify: `heavy/tests/corpus/report.spec.ts`

**Interfaces:**
- Consumes: Task 10 の `CallBreakdown.coverage`
- Produces: `report.ts` の `renderCoverage(breakdown: CallBreakdown): string[]`（内部関数でよい。`report.spec.ts` から呼ぶ場合のみ export する）、`COVERAGE_STATUS_LABELS: Record<string, string>`

**要点:** 仕様 §12。**挿入位置は「関数呼び出しの内訳」の op 表の直後、`renderStrata` の前。**
既存の判定表・変異表・許容誤差表に触らない。**数はすべて `breakdown.coverage` から取る**
——文字列に焼かない（既存の作法）。状態の日本語は §12.3 の表のとおりで、
**「理由付き未実行あり」を「完全網羅」と書かない。**

- [ ] **Step 1: 失敗するテストを書く（§15.3 の 10 状態）**

`report.spec.ts` に、`coverage` を差し替えた架空の `CallBreakdown` を 10 個作って固定する。

```typescript
const withCoverage = (coverage: Coverage | null): CallBreakdown => ({
  byOp: { op: { ok: 1 } }, byStratum: {}, gaveUp: null, coverage,
});
const requirement = (over: Partial<CoverageRequirement>): CoverageRequirement => ({
  id: "op/a/all", scope: "op", strength: "all",
  required_cells: 10, covered_cells: 10, excluded_cells: 0, unmet_cells: 0,
  status: "complete", ...over,
});

it("1. 全セル被覆・除外 0 は「完全網羅」と書く", () => {
  const lines = renderCoverage(withCoverage(base([requirement({})], [])));
  expect(lines.join("\n")).toContain("| 10 | 10 | 0 | 0 | 完全網羅 |");
});

it("2. 安全な重複除外は safe として並ぶ", () => { /* reason: duplicate_equivalent */ });
it("3. reasonable の除外は「理由付き未実行あり」になる", () => {
  const lines = renderCoverage(withCoverage(base(
    [requirement({ covered_cells: 9, excluded_cells: 1, status: "accounted_with_exclusions" })],
    [exclusion({ reason: "source_overflow", disposition: "reasonable" })],
  )));
  expect(lines.join("\n")).toContain("理由付き未実行あり");
  expect(lines.join("\n")).not.toContain("完全網羅");
});
it("4. accepted risk は「未検証」と書く", () => {
  const lines = renderCoverage(withCoverage(base(
    [requirement({ covered_cells: 9, excluded_cells: 1, status: "accounted_with_exclusions" })],
    [exclusion({ reason: "oracle_near_yen_boundary", disposition: "accepted_risk" })],
  )));
  expect(lines.join("\n")).toContain("未検証");
});
it("5. 未達があれば「不足」と書く", () => { /* unmet_cells: 1, status: "incomplete" */ });
it("6. coverage が無いシャードは「測定していない」と書き、表を出さない", () => {
  expect(renderCoverage(withCoverage(null)).join("\n")).toContain("測定していない");
});
it("7. 未知理由は行を落とさずそのまま出す", () => { /* 読み手が拒否済みでも、表示は落とさない */ });
it("8. 合計が合わないときはその旨を書く", () => { /* 10 ≠ 9+0+0 */ });
it("9. 候補棄却 0 のときも節を出す", () => { /* generation_rejections すべて 0 */ });
it("10. 候補棄却があるとき、単位が「生成候補」と書かれる", () => {
  const lines = renderCoverage(withCoverage(base([requirement({})], [], {
    candidate_duplicate: 12, oracle_near_yen_boundary: 7, oracle_search_limit: 0,
  })));
  expect(lines.join("\n")).toContain("生成候補");
  expect(lines.join("\n")).toContain("未検証空間の大きさではない");
});

it("実物の finance-000.json でも表が出る", () => {
  const { shard } = loadCallShards().find((e) => e.name === "finance-000.json")!;
  const lines = renderCoverage(summarizeCallShard(shard));
  expect(lines.join("\n")).toContain("`finance-v1`");
  expect(lines.join("\n")).toContain("loan_term");
});
```

- [ ] **Step 2: 赤を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test report.spec.ts`
Expected: FAIL（`renderCoverage` が無い）

- [ ] **Step 3: 実装する（`report.ts`）**

```typescript
/** 設計書 §12.3。**「理由付き未実行あり」を「完全網羅」と書かない。** */
const COVERAGE_STATUS_LABELS: Record<string, string> = {
  complete: "完全網羅",
  accounted_with_exclusions: "理由付き未実行あり",
  incomplete: "不足",
  not_measured: "測定していない",
};

/**
 * 試験空間の網羅(設計書 §12.2・§12.4・§12.5)。
 *
 * **数はシャードが宣言したものをそのまま出す。** 割合も率も足さない
 * ——「網羅率」を作ると、有限のモデルに対する被覆が、入力空間全体に対する
 * 被覆に見える。§12.5 の注意文を必ず添えるのはそのためである。
 */
function renderCoverage(breakdown: CallBreakdown): string[] {
  const coverage = breakdown.coverage;
  if (coverage === null) {
    return ["**このシャードは試験空間を宣言していない(測定していない)。**", ""];
  }
  const lines = ["", `#### テスト空間 \`${coverage.model}\``, "",
    "| 対象 | 被覆規則 | 必須セル | 実行 | 理由付き除外 | 未達 | 状態 |",
    "|---|---|---:|---:|---:|---:|---|"];
  for (const r of coverage.requirements) {
    const consistent = r.covered_cells + r.excluded_cells + r.unmet_cells === r.required_cells;
    lines.push(
      `| \`${r.scope}\` | ${r.strength === "all" ? "全組合せ" : "2 因子ペアワイズ"} | ` +
      `${r.required_cells} | ${r.covered_cells} | ${r.excluded_cells} | ${r.unmet_cells} | ` +
      `${COVERAGE_STATUS_LABELS[r.status] ?? r.status}${consistent ? "" : "(**合計が合わない**)"} |`,
    );
  }
  lines.push("", "**完全網羅は、ここで定義した有限の因子・水準・組合せに対する表現であり、",
    "金融入力全体を数学的に全列挙したことを意味しない。**", "");
  // 理由付き除外(要求セルの単位)
  if (coverage.excluded_cells.length > 0) {
    const byReason = new Map<string, CoverageExclusion[]>();
    for (const e of coverage.excluded_cells) {
      byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
    }
    lines.push("#### 理由付き除外", "", "| 理由 | 判断 | 対象数 | 単位 | 例 |", "|---|---|---:|---|---|");
    for (const [reason, list] of [...byReason].sort(([a], [b]) => a.localeCompare(b))) {
      const risky = list[0].disposition === "accepted_risk";
      lines.push(
        `| \`${reason}\` | ${list[0].disposition}${risky ? "(**未検証**)" : ""} | ${list.length} | ` +
        `要求セル | ${list.slice(0, 3).map((e) => `\`${e.cell_id}\``).join(" / ")} |`,
      );
    }
    lines.push("");
  }
  // 生成候補の棄却(**要求セルとは別の単位**。設計書 §10.3)
  const rejections = Object.entries(coverage.generation_rejections).sort(([a], [b]) => a.localeCompare(b));
  lines.push("#### 生成候補の棄却", "",
    "**これは乱択候補の試行回数であり、未検証空間の大きさではない。**",
    "要求セルの除外(上の表)とは単位が違うので、足し合わせない。", "",
    ...rejections.map(([reason, n]) => `- \`${reason}\`: ${n} 生成候補`), "");
  return lines;
}
```

`renderCallBreakdowns` の中の `lines.push("", ...renderStrata(breakdown), ...renderGaveUp(breakdown));`
を `lines.push("", ...renderCoverage(breakdown), ...renderStrata(breakdown), ...renderGaveUp(breakdown));`
に変える。

- [ ] **Step 4: 緑を確かめる**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test && pnpm typecheck && pnpm lint`
Expected: すべて緑（既存のレポートテストも緑のまま＝既存の節を壊していない）

- [ ] **Step 5: 実物のレポートを目で見る**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm heavy` の後 `sed -n '/テスト空間/,/生成候補の棄却/p' ../web/heavy-report.md`
Expected: 8 行の網羅表・除外表・注意文が出ている

- [ ] **Step 6: コミット**

```bash
git add heavy/tests/corpus/report.ts heavy/tests/corpus/report.spec.ts
git commit -m "Show the map beside the score"
```

---

### Task 12: 変異 10 種の再実行・全スイープ・記録

**Files:**
- Modify: `docs/corpus-measurements.md`（実測と判断理由）
- Test: 走らせるだけ（コードは変えない）

**Interfaces:**
- Consumes: Task 1〜11 のすべて
- Produces: 実測の記録（次の Task／第2段階が読む一次資料）

**要点:** 仕様 §15.4・§18。**Task 5 が 52 行の入力を変えたので、変異の検出件数が動きうる。**
動いたら「意図した被覆変更か」を判断して記録する（**足し合わせない**——網羅セル数と
変異検出件数は別の量である）。

- [ ] **Step 1: 変異 10 種を測り直す**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm heavy:power:exact`（実測 4 分）
Expected: **10/10 ok**。検出件数が移動前と違ったら、差分を控える

- [ ] **Step 2: 18 変異の検出力を測り直す**

Run: `cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm heavy:power`（実測 11 分）
Expected: **18/18 ok**。`finance-000.json` を触ったので Finance の 10 変異の件数は動きうる。
**下限(`minRate`)を割ったら、下限を緩めるのではなく理由を先に説明すること**
（下限は実測率の半分と決めてある。割るなら被覆が実際に落ちている）

- [ ] **Step 3: 残りのスイープ**

```bash
cd /home/terapyon/dev/CalcArc-e2e/reference && uv run --no-config pytest -q
cargo test --workspace
cd /home/terapyon/dev/CalcArc-e2e/web && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e
cd /home/terapyon/dev/CalcArc-e2e/heavy && pnpm test && pnpm heavy && pnpm heavy:ui
```

Expected: すべて緑。`cargo` と `web` は**この計画が 1 行も触っていない**ので、
赤くなる理由が無い（赤くなったら、触っていないという前提のほうが間違っている）

- [ ] **Step 4: 記録する**

`docs/corpus-measurements.md` の末尾に節を足す。**書くのは道具が印字した数だけ。**

- 8 つの対象それぞれの 要求／被覆／除外／未達 と状態
- `loan_term` が 74 → 126 に動いた理由（決定的構成で 52 行、月額 +1 円が 50 行）
- 除外 24 件の内訳（`inverse_target_unconstructible` 17 / `not_applicable` 7）と、
  `not_applicable` を選んだ理由（`MAX_TERM_MONTHS = 1200`）
- `compound_deposit_for` の 247 + 19（`source_overflow`）と、
  **仕様 §9.1 の「246 / 20」との差が数え方の違いである**こと
- 変異 10 種・18 種の検出件数の前後（**動いていないならそう書く**）
- `rejections` の前後

- [ ] **Step 5: コミット**

```bash
git add docs/corpus-measurements.md
git commit -m "Record what the space model measured, and what it did not"
```

---

## Self-Review（この計画を書いた側の点検）

**仕様の網羅:** §7（モデル）→ Task 2、§8（`loan_term`）→ Task 4・5、§9（`compound_deposit_for`）
→ Task 6、§10（除外理由）→ Task 1・5・6、§11（機械可読形式）→ Task 1・7、§12（レポート）
→ Task 11、§13.1（生成器の合否）→ Task 8、§13.2（Heavy の合否）→ Task 10、§15.1 → Task 3・4・7・8、
§15.2 → Task 10、§15.3 → Task 11、§15.4 → Task 12、§18（完了条件）→ Task 12。
**§14（科学計算）は第2段階なので、この計画に無い**（仕様 §6.2 の指示どおり）。

**型の一貫性:** `Cell` / `Requirement` / `Exclusion` / `Reason` / `Disposition` は Task 1 で定義し、
Task 2 以降は同じ名前で使う。TypeScript 側の `Coverage` / `CoverageRequirement` /
`CoverageExclusion` は Task 10 で定義し、Task 11 が読む。Python の `build_payload` が出す鍵と
TypeScript の `interface Coverage` の鍵は同じ綴りである（`required_cells` / `covered_cells` /
`excluded_cells` / `unmet_cells` / `status` / `cell_id` / `disposition` / `covered_elsewhere`）。

**埋めていない穴:** 無い。自己点検の時点で残っていた「他の 6 対象が本当に全被覆か」は、
**その場で測って塞いだ**（150 × 4 / 266 / 56 がすべて全被覆）。したがって除外の理由を
作る Task は `loan_term`(Task 5) と `compound_deposit_for`(Task 6) の 2 つで足りる。

**この計画が前提にしている実測はすべてコミット済みコーパスに対するもので、Task 5 が
コーパスを動かすと変わりうる。** Task 9 の Step 3 が前後を測り直す段になっている
——**前提が崩れていたらそこで止まる**。
