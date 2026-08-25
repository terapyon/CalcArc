"""要求セルの代数(設計書 §4・§10・§11)。

**このモジュールは金融を知らない。** 因子表も水準表も引数で受け取る
——`corpus_calls` から import されるだけで、こちらからは import しない
(循環を作らないため)。第2段階の科学計算も同じ型を使う。

ここが担うのは 3 つだけである。

1. **綴り**: `cell_id` と水準の文字列。走行のたびに動くと、前回の除外記録と
   突き合わせられなくなる。
2. **数え方**: 要求セルの列挙(全組合せ / 2 因子ペアワイズ)。**行ではなくセルを
   数える**(設計書 §12.4)。
3. **検算**: `required = covered + excluded + unmet` と、被覆と除外の排他。
   破れていたらその場で落とす(設計書 §13.1)——**数え方が破れているのに
   緑になる**のが、この仕組みで一番避けたい壊れ方である。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
from itertools import combinations, product

#: `coverage` 自身のスキーマ番号。**15 枚が共有する `corpus_calls.SCHEMA` とは
#: 別物**(設計書 §11.1)。こちらを上げても、他のシャードの golden は動かない。
COVERAGE_SCHEMA = 1


class Reason(str, Enum):
    """除外の理由コード(設計書 §10.1)。

    **`other` は無い。** 未知の理由は生成器を落とす側の仕事で、ここに逃げ場を
    作らない——`other` があると、分類できなかったものが数だけ増えて通る。
    """

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
    """判断区分(設計書 §10.1)。**`accepted_risk` は「安全」を意味しない。**"""

    SAFE = "safe"
    REASONABLE = "reasonable"
    ACCEPTED_RISK = "accepted_risk"


#: 理由 → 判断区分は **1 対 1 に固定する**。呼び出し側に選ばせると、同じ理由が
#: 場所によって `safe` にも `accepted_risk` にもなり、表示が揺れる。
#:
#: `not_applicable` を `safe` ではなく `reasonable` に置くのは、**何も失って
#: いないが何も検証してもいない**からである。`safe`(同じ主張を別のケースが既に
#: 検証している)と同じ欄に並べると、読者が過大に読む。
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
    """水準の綴り。

    **`bool` を先に見る**——`bool` は `int` の派生なので、順番を逆にすると
    `True` が `"1"` になり、JSON を読む側の `tax=true` と食い違う。
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


@dataclass(frozen=True, order=True)
class Cell:
    """要求セル(設計書 §4.3)。

    `axes` は**宣言順**で持つ。並べ替えると `cell_id` の綴りが変わり、前回の
    除外記録と突き合わせられなくなる(設計書 §10.2 の「安定した順序・綴り」)。
    """

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
    """理由付き除外(設計書 §10.2)。

    `covered_elsewhere` は**補足であり、元のセルを被覆済みに変えない**
    ——「別の操作で同じ因子ペアを踏んでいる」は、その操作の被覆にはならない
    (設計書 §7.2)。
    """

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
    """全組合せ(設計書 §7.2 の「全組合せ」)。因子の宣言順を保つ。"""
    names = list(factors)
    return tuple(
        Cell(scope, tuple((name, level_text(value)) for name, value in zip(names, values)))
        for values in product(*(factors[name] for name in names))
    )


def pairwise_cells(scope: str, factors: Mapping[str, Sequence[object]]) -> tuple[Cell, ...]:
    """2 因子間ペアワイズの**要求セル**(設計書 §12.4 の注意——構成行ではない)。

    `pairwise()` が返す**行**は、1 行で複数のセルを踏む。ここで数えるのは
    踏まれる側で、因子の組ごとに水準の直積を取ったものである。**行を数えると
    単位が合わない**(除外した行数をそのまま除外セル数として出せない理由)。
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
    ——数え方が破れていたら、その場で落ちるほうがよい(設計書 §13.1)。
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
    """`coverage` の中身(設計書 §11.2)。

    **順序は決定的**——除外は `cell_id` で並べ、棄却は理由名で並べる。
    走行ごとに順序が動くと、固定コーパスがバイトで一致しない。

    `generation_rejections` は**乱択候補を捨てた試行回数**であって、要求セルの
    除外ではない(設計書 §10.3)。同じ入れ物に混ぜない。
    """
    known = {cell for requirement in requirements for cell in requirement.cells}
    stray_exclusions = [cell for cell in exclusions if cell not in known]
    if stray_exclusions:
        raise RuntimeError(
            f"モデルの外のセルを除外している: {sorted(cell.id for cell in stray_exclusions)[:3]}"
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
