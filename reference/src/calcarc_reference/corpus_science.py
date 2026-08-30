"""科学計算の試験空間モデル（`scientific-v1`）の因子表。

設計書 `docs/superpowers/specs/2026-08-25-coverage-model-design.md` の
**§14.2「初期モデル」**が 9 領域の要求軸と被覆規則を定めている。**この module が
足すのは、その軸に対する水準である**——§14.2 は軸を挙げるが、水準を定義していない。

## 水準はどこから起こしたか

**§14 の軸と、仕様が名指す境界から起こす。既存のコーパスからは起こさない。**

**コーパスを水準の出どころにすると、コーパスは定義上いつも満点になる**
——`Rad × 逆三角` が穴として見えるのは、**§14 が「角度モード」を軸に名指しして
いるから**である。データから起こした水準は、**データに無い穴を見つけない**。
これは「生成器を弱くすれば除外が増える」と同型の壊れ方である。

**データは「空の帯」を見つけるために当てる。** 実データが 1 件も入らない帯が
出たら、**それは帯を削る理由ではなく、発見である。**

## 一次資料（写しを作らない）

- **関数の集合**: `corpus_expr` の定数を **import する**。ここに写しを置くと、
  片方を直したときにもう片方が古くなる
- **定義域の帯**: `docs/numerical-policy.md` の「関数の定義域」の表。
  **`ln`/`log10` は `x > 0`、`asin`/`acos` は `−1 ≤ x ≤ 1`、`1/x` は `x ≠ 0`**——
  帯の切れ目はその表が決めている
- **演算子群・相殺形式・表示境界・複素の縁**: 生成器が名指ししている定数
  （`ASSOC_CHAINS` / `CANCELLATION_SHAPES` / `DISPLAY_EDGE_LITERALS` /
  `COMPLEX_EDGE_VALUES`）。**人が決めて名前を付けたもの**で、乱択の産物ではない

## 被覆規則（§14.2 の「初期の被覆規則」列）

**9 領域のうち 8 つは 1-way である。** §14.2 が「各水準 1 件以上」「各帯に最低件数」
「各経路に最低件数」と書いている。**直積を作るのは `angle_mode` だけ**
（「各組合せ 1 件以上」）。**これが金融との大きな違い**で、データが 5.7 倍でも
要求セルは金融より小さくなる。
"""

from __future__ import annotations

from calcarc_reference import corpus_coverage as coverage
from calcarc_reference.corpus_expr import (
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_FNS,
)

#: モデルの名前。`coverage.model` に載る。
SCIENCE_MODEL = "scientific-v1"

#: **§14.2 の 9 行を、そのまま写した対応表。**
#:
#: **人が読んで確かめるための表である。** 因子表の取りこぼし（軸を 1 本
#: 書き忘れる）は、**同じ因子表から列挙するテストには原理的に見えない**
#: ——列挙は因子表を正としてしまう。**設計書と因子表を突き合わせられるのは
#: 人だけ**なので、§14.2 の文言をここに置いて、下の `SCIENCE_FACTORS` と
#: 並べて読めるようにする。
SPEC_AXES: dict[str, tuple[str, str]] = {
    "elementary": ("関数種別 × 定義域帯", "各水準1件以上、境界近傍は名指し"),
    "inverse_trig": ("関数種別 × 角度モード × 境界帯", "1-way必須、重要ペアを選択"),
    "angle_mode": ("Deg/Rad × 三角関数", "各組合せ1件以上"),
    "precedence": ("優先順位関係 × 括弧有無", "各文法クラスに最低件数"),
    "associativity": ("演算子群 × 平坦/括弧対照", "既存層の最低件数を維持"),
    "cancellation": ("相殺形式 × 桁落ち強度帯", "各帯に最低件数"),
    "combinatorics": ("nPr/nCr × 正常/定義域/Overflow近傍", "各経路に最低件数"),
    "display": ("ENG/DMS × 表示境界", "名指し境界と最低件数"),
    "complex": ("演算種別 × 表示形式 × ゼロ成分", "各重要クラスに最低件数"),
}

#: 角度モード。**§14.2 が `angle_mode` と `inverse_trig` の両方で名指ししている。**
ANGLE_MODES = ("Deg", "Rad")

#: 定義域の帯。**`docs/numerical-policy.md` の「関数の定義域」の表から起こす。**
#:
#: 帯の切れ目は仕様が決めている——`ln`/`log10` は `x > 0` が境目、
#: `asin`/`acos` は `−1` と `1`、`1/x` は `0`。**「負・ゼロ・単位区間・小さい正・
#: 大きい正」で切るのは恣意ではなく、その表がそこでエラーの種類を変えているから
#: である。**
DOMAIN_BANDS = ("negative", "zero", "unit_interval", "positive_small", "positive_large")

#: 桁落ちの強度帯。**§14.2 は「各帯に最低件数」と言うだけで帯を定義していない**
#: ので、**ここで決めた**——`docs/numerical-policy.md` が桁落ちの許容として
#: 相対誤差 `1e-6` を名指ししており、**その手前・近傍・越えたところ**で 3 段に切る。
#: **これは許容誤差ではない**（合否には使わない。帯の名前である）。
CANCELLATION_BANDS = ("mild", "near_tolerance", "severe")

#: 相殺の形。**生成器が名指ししている 4 つ**（`CANCELLATION_SHAPES`）。
CANCELLATION_SHAPES = (
    "near_subtraction",
    "sqrt_difference",
    "log_near_one",
    "absorption",
)

#: 演算子群。**`ASSOC_CHAINS` のキー**（生成器の一次資料）。
ASSOC_GROUPS = ("additive", "multiplicative", "combinatorial", "power")

#: 平坦／括弧の対照。**`ASSOC_CONTROL_STRATUM` が対照群の名前**である。
ASSOC_SHAPES = ("flat", "parenthesized")

#: 組合せ関数の経路。**§14.2 が「正常/定義域/Overflow近傍」と名指ししている。**
COMBINATORICS_PATHS = ("normal", "domain", "overflow_near")

#: 表示の種別。**§14.2 が「ENG/DMS」と名指ししている。**
DISPLAY_KINDS = ("eng", "dms")

#: 表示の境界。**`DISPLAY_EDGE_LITERALS` の 14 個を、指数の位置で帯にまとめた。**
#: 14 個をそのまま水準にすると「境界を 1 つ足したら要求セルが 1 つ増える」だけの
#: 表になり、**何を確かめたいのかが読めなくなる。**
DISPLAY_EDGES = (
    "exponent_zero",
    "exponent_step",
    "rounding_carry",
    "sub_unit",
    "long_mantissa",
)

#: 優先順位の文法クラス。**§14.2 が「優先順位関係 × 括弧有無」と言っている。**
PRECEDENCE_CLASSES = (
    "mul_over_add",
    "power_over_mul",
    "unary_over_binary",
    "chained_same",
)
PRECEDENCE_PAREN = ("bare", "parenthesized")

#: 複素の演算種別・表示形式・ゼロ成分。**`COMPLEX_EDGE_VALUES` の分類**から
#: 起こす——あの表は「実軸の正／負」「虚軸の正／負」「虚部が 0」を
#: **コメントで名指ししている。**
COMPLEX_OPS = ("add_sub", "mul_div", "power", "unary_fn")
COMPLEX_FORMS = ("rectangular", "polar")
COMPLEX_ZERO_PARTS = ("none", "real_zero", "imag_zero", "both_zero")

#: 三角関数。**`UNARY_FNS` には `sqrt` / `sqr` / `neg` も入っている**ので絞る。
#: **絞った事実を書いておく**——絞りは隠れ場所になりうる。
TRIG_FNS = tuple(fn for fn in UNARY_FNS if fn in ("sin", "cos", "tan"))

SCIENCE_FACTORS: dict[str, dict[str, tuple]] = {
    "elementary": {"function": ELEMENTARY_FNS, "band": DOMAIN_BANDS},
    "inverse_trig": {
        "function": INVERSE_TRIG_FNS,
        "angle_mode": ANGLE_MODES,
        "band": DOMAIN_BANDS,
    },
    "angle_mode": {"function": TRIG_FNS, "angle_mode": ANGLE_MODES},
    "precedence": {
        "grammar_class": PRECEDENCE_CLASSES,
        "parenthesis": PRECEDENCE_PAREN,
    },
    "associativity": {"operator_group": ASSOC_GROUPS, "shape": ASSOC_SHAPES},
    "cancellation": {"shape": CANCELLATION_SHAPES, "band": CANCELLATION_BANDS},
    "combinatorics": {
        "function": COMBINATORICS_FNS + COMBINATORICS_BINS,
        "path": COMBINATORICS_PATHS,
    },
    "display": {"kind": DISPLAY_KINDS, "edge": DISPLAY_EDGES},
    "complex": {
        "operation": COMPLEX_OPS,
        "form": COMPLEX_FORMS,
        "zero_part": COMPLEX_ZERO_PARTS,
    },
}

#: **直積を作るのは `angle_mode` だけ**（§14.2 の「各組合せ1件以上」）。
ALL_COMBINATION_SCOPES = ("angle_mode",)

#: **§14.2 は `inverse_trig` に「1-way 必須、重要ペアを選択」と書いている。**
#: 1-way だけでは足りない——**どのペアが「重要」かを決めるのは、この表の仕事**である。
#:
#: **選んだのは `angle_mode × function`。** 理由は実測である——**`Rad × asin` /
#: `Rad × acos` / `Rad × atan` はコーパス 18 枚のどこにも 1 件も無い**
#: （2026-08-30、着手前）。**1-way だと「`angle_mode=Rad` が未達」という 1 セルに
#: 畳まれ、どの関数が欠けているかが出ない。** ペアにすると 3 セルとして出る。
#:
#: **`band` を含むペアは選ばない。** §14.2 が「1-way 必須」と言っているのは
#: 全軸であり、**ペアは「リスクのある軸に限定」**（§14.2 の末尾）——
#: 帯と関数の相互作用は、**まだ測っていないので名指しできない**。
SELECTED_PAIRS: dict[str, tuple[tuple[str, str], ...]] = {
    "inverse_trig": (("angle_mode", "function"),),
}


def _selected_pair_cells(scope: str, factors: dict[str, tuple]) -> tuple[coverage.Cell, ...]:
    """選んだ軸の組だけを直積にする。**全軸の直積は作らない**（§14.2）。"""
    cells: list[coverage.Cell] = []
    for left, right in SELECTED_PAIRS.get(scope, ()):
        for a in factors[left]:
            for b in factors[right]:
                axes = sorted(((left, coverage.level_text(a)), (right, coverage.level_text(b))))
                cells.append(coverage.Cell(scope, tuple(axes)))
    return tuple(cells)


SCIENCE_REQUIREMENTS: tuple[coverage.Requirement, ...] = tuple(
    coverage.Requirement(
        f"{scope}/{'-'.join(sorted(factors))}/"
        f"{'all' if scope in ALL_COMBINATION_SCOPES else 'one_way'}"
        f"{'+pairs' if scope in SELECTED_PAIRS else ''}",
        scope,
        "all"
        if scope in ALL_COMBINATION_SCOPES
        else ("one_way+pairs" if scope in SELECTED_PAIRS else "one_way"),
        coverage.all_combination_cells(scope, factors)
        if scope in ALL_COMBINATION_SCOPES
        else coverage.one_way_cells(scope, factors) + _selected_pair_cells(scope, factors),
    )
    for scope, factors in SCIENCE_FACTORS.items()
)
