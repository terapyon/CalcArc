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
        # **軸の並びは因子表の順に揃える**（`all_combination_cells` と同じ）。
        # 並びが違うと `Cell` の同一性が崩れ、**同じ意味のセルが別物になる。**
        first, second = (name for name in factors if name in (left, right))
        for a in factors[first]:
            for b in factors[second]:
                cells.append(
                    coverage.Cell(
                        scope,
                        ((first, coverage.level_text(a)), (second, coverage.level_text(b))),
                    )
                )
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


# ---------------------------------------------------------------------------
# 写す経路（Task 2）——**ケースから、観測できる水準だけを取り出す。**
#
# **観測と記録は別物である**（裁定 1 の (c)）。生成器は「この水準を狙って作った」
# と知っており（記録）、ここは「このケースは何を踏んでいるか」を読む（観測）。
# **両者の一致を assert するのが Task 3 の主番人**で、**この module は観測の側**
# だけを持つ。
# ---------------------------------------------------------------------------

#: **キーの綴り → 関数の名前。** 盤面のトークンと因子表の名前は綴りが違う
#: （`n_fact` と `fact`、`n_p_r` と `nPr`）。**変換表をここ 1 か所に置く。**
KEY_TO_FUNCTION: dict[str, str] = {
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "asin": "asin",
    "acos": "acos",
    "atan": "atan",
    "ln": "ln",
    "log10": "log10",
    "exp_e": "exp_e",
    "recip": "recip",
    "n_fact": "fact",
    "n_p_r": "nPr",
    "n_c_r": "nCr",
}

#: **演算子のキー → 演算子群**（`ASSOC_CHAINS` の分類に対応）。
KEY_TO_OPERATOR_GROUP: dict[str, str] = {
    "add": "additive",
    "sub": "additive",
    "mul": "multiplicative",
    "div": "multiplicative",
    "n_p_r": "combinatorial",
    "n_c_r": "combinatorial",
    "pow": "power",
}

#: **観測できない軸。** ここに挙げた軸は、**ケースを読んでも水準が出ない**
#: ——引数の値や式の構造が要る。
#:
#: **書き出す理由**: 裁定 1 の (c) は「記録と観測の一致を assert する」だが、
#: **観測できない軸は assert できない**。**どこまでが検算されているかを、
#: 読む人が知れなければならない**——「全部突き合わせている」と読ませない。
UNOBSERVABLE_AXES: dict[str, tuple[str, ...]] = {
    # 帯は引数の値で決まる。キー列からは、どの数がどの関数に入ったか分からない
    "elementary": ("band",),
    "inverse_trig": ("band",),
    "cancellation": ("shape", "band"),
    # 文法クラスは式の構造で決まる（括弧の有無だけは観測できる）
    "precedence": ("grammar_class",),
    # 演算種別は式の構造で決まる
    "complex": ("operation",),
    # 表示の境界は**リテラルの値**で決まる。キー列には数字が並ぶだけで、
    # 「指数がちょうど 3」「丸めで繰り上がる」はそこからは読めない
    # （2026-08-30、宣言が漏れていて `display/edge` の 5 セルが
    # 「本当の穴」に混ざっていた）。
    "display": ("edge",),
}


def case_keys(case: dict) -> tuple[str, ...]:
    """ケースのキー列。**等価ケースは 2 本持つ**ので連結する。

    **`keys` を持たないケースが 1,292 件ある**（`display` 621 /
    `complex-display` 671。2026-08-30 実測）——それらは `kind: "equivalence"` で、
    `left` と `right` の 2 本を持つ。**片方だけ読むと、押したキーの半分を
    見落とす。**
    """
    if "keys" in case:
        return tuple(case["keys"])
    return tuple(case.get("left", ())) + tuple(case.get("right", ()))


def observed_levels(case: dict) -> dict[str, dict[str, set[str]]]:
    """1 ケースが踏んでいる水準を、**観測できる軸についてだけ**返す。

    **キーを一次資料にする。`expr` は読まない。**

    実測（2026-08-30）: `expr` とキーで数が食い違う関数が 3 つあった
    （`nPr` 639/640・`nCr` 1711/1715・`recip` 902/903）。**食い違いは全部
    `errors-000.json` で、そこは `expr` が人間向けの散文である**
    （`P(5,6)`・`1/0 (逆数)`）。**キーは押した列そのもの**なので、こちらを正とする。

    **軸ごとに集合を返す。** 1 件が同じ軸で複数の水準を踏むことがある
    （`sin` と `cos` の両方を含む式）——**1 つしか持てない形にすると、
    後ろの 1 つで上書きして手前を落とす。**

    **1 件が複数の scope を踏むこともある**（設計書 §9.3）。三角関数を含む
    `precedence` のケースは、`angle_mode` の水準も踏んでいる。
    """
    keys = set(case_keys(case))
    mode = case.get("mode")
    out: dict[str, dict[str, set[str]]] = {}

    def put(scope: str, axis: str, level: object) -> None:
        out.setdefault(scope, {}).setdefault(axis, set()).add(coverage.level_text(level))

    functions = {KEY_TO_FUNCTION[k] for k in keys if k in KEY_TO_FUNCTION}

    for fn in sorted(functions & set(TRIG_FNS)):
        put("angle_mode", "function", fn)
    for fn in sorted(functions & set(INVERSE_TRIG_FNS)):
        put("inverse_trig", "function", fn)
    for fn in sorted(functions & set(ELEMENTARY_FNS)):
        put("elementary", "function", fn)
    for fn in sorted(functions & set(COMBINATORICS_FNS + COMBINATORICS_BINS)):
        put("combinatorics", "function", fn)

    if mode in ANGLE_MODES:
        if functions & set(TRIG_FNS):
            put("angle_mode", "angle_mode", mode)
        if functions & set(INVERSE_TRIG_FNS):
            put("inverse_trig", "angle_mode", mode)

    if functions & set(COMBINATORICS_FNS + COMBINATORICS_BINS):
        # **経路はエラーの種類で決まる**（§14.2「正常/定義域/Overflow近傍」）。
        error = case.get("expect", {}).get("error")
        put(
            "combinatorics",
            "path",
            "normal" if error is None else ("overflow_near" if error == "Overflow" else "domain"),
        )

    if "eng" in keys:
        put("display", "kind", "eng")
    if "dms" in keys:
        put("display", "kind", "dms")

    # **括弧の有無だけは観測できる。** 文法クラスは式の構造が要る。
    put("precedence", "parenthesis", "parenthesized" if "lparen" in keys else "bare")

    groups = {KEY_TO_OPERATOR_GROUP[k] for k in keys if k in KEY_TO_OPERATOR_GROUP}
    for group in sorted(groups):
        put("associativity", "operator_group", group)
    if groups:
        # 対照群の名前は生成器が層に書いている（`ASSOC_CONTROL_STRATUM`）。
        put(
            "associativity",
            "shape",
            "parenthesized" if case.get("stratum") == "parenthesized" else "flat",
        )

    if "j" in keys or "polar_toggle" in keys:
        put("complex", "form", "polar" if "polar_toggle" in keys else "rectangular")
        expect = case.get("expect", {})
        re_zero, im_zero = expect.get("re") == 0, expect.get("im") == 0
        put(
            "complex",
            "zero_part",
            "both_zero"
            if re_zero and im_zero
            else ("real_zero" if re_zero else ("imag_zero" if im_zero else "none")),
        )

    return out


def observed_cells(case: dict) -> set[coverage.Cell]:
    """観測できた水準を、要求セルの単位へ写す。

    **軸の並びは因子表の順に揃える。** アルファベット順で組むと
    `all_combination_cells` が作る `(function, angle_mode)` と食い違い、
    **同じ意味のセルが別物になって被覆が 0 になる**——2026-08-30 に実際に
    そうなった（`angle_mode` が 6 中 0 被覆。`Rad` のケースは 2,000 件在るのに）。

    `SCIENCE_REQUIREMENTS` に在るセルだけを返す——**モデルの外のセルを
    被覆として数えない**（`build_payload` が同じことを検算する）。
    """
    known = {cell for req in SCIENCE_REQUIREMENTS for cell in req.cells}
    found: set[coverage.Cell] = set()
    for scope, axes in observed_levels(case).items():
        for name, levels in axes.items():
            for level in levels:
                found.add(coverage.Cell(scope, ((name, level),)))
        ordered = [name for name in SCIENCE_FACTORS[scope] if name in axes]
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                left, right = ordered[i], ordered[j]
                for a in axes[left]:
                    for b in axes[right]:
                        found.add(coverage.Cell(scope, ((left, a), (right, b))))
    return found & known


# ---------------------------------------------------------------------------
# 記録と突合（Task 3）——**生成器が作った木を歩いて、水準を記録する。**
#
# **観測（`observed_levels`）はキー列を読む。記録はこの木を読む。** 2 つの経路が
# 食い違ったら生成を止める（裁定 1 の (c)）。**捕まえるのは「木 → キー」の描画と
# 「キー → 水準」の読みであって、木そのもののバグは捕まえない**
# ——正確には「意図と観測の突合」ではなく「同じ木の、2 つの読み経路の突合」である。
# ---------------------------------------------------------------------------


def _walk(node: object) -> list[object]:
    """木の全ノードを平らに並べる。**キー列を経由しない。**"""
    out = [node]
    for attr in ("arg", "left", "right"):
        child = getattr(node, attr, None)
        if child is not None:
            out.extend(_walk(child))
    return out


def recorded_levels(
    node: object, mode: str, stratum: str | None = None
) -> dict[str, dict[str, set[str]]]:
    """生成器が作った木から、踏んでいる水準を読む。

    **`observed_levels` と同じ形を返すが、読む先が違う**——あちらは
    `to_key_sequence` が描画したキー列、こちらは木そのもの。**2 つが食い違えば、
    描画か読みのどちらかが壊れている。**

    **観測できない軸（`UNOBSERVABLE_AXES`）はここでも読まない。** 木からは
    帯や文法クラスを出せる余地があるが、**出すと突合の相手が居なくなる**
    ——自己申告になり、(b) と同じになる。**この関数は突合できる軸だけを持つ。**
    """
    nodes = _walk(node)
    fns = {getattr(n, "fn", None) for n in nodes} - {None}
    ops = {getattr(n, "op", None) for n in nodes} - {None}
    out: dict[str, dict[str, set[str]]] = {}

    def put(scope: str, axis: str, level: str) -> None:
        out.setdefault(scope, {}).setdefault(axis, set()).add(level)

    for fn in sorted(fns & set(TRIG_FNS)):
        put("angle_mode", "function", str(fn))
    for fn in sorted(fns & set(INVERSE_TRIG_FNS)):
        put("inverse_trig", "function", str(fn))
    for fn in sorted(fns & set(ELEMENTARY_FNS)):
        put("elementary", "function", str(fn))
    for fn in sorted(fns & set(COMBINATORICS_FNS)):
        put("combinatorics", "function", str(fn))
    for op in sorted(ops & set(COMBINATORICS_BINS)):
        put("combinatorics", "function", str(op))

    if mode in ANGLE_MODES:
        if fns & set(TRIG_FNS):
            put("angle_mode", "angle_mode", mode)
        if fns & set(INVERSE_TRIG_FNS):
            put("inverse_trig", "angle_mode", mode)

    # **演算子群は木の演算子から。** キー側は `add`/`sub`… の綴りで読む。
    op_to_group = {
        "+": "additive",
        "-": "additive",
        "*": "multiplicative",
        "/": "multiplicative",
        "nPr": "combinatorial",
        "nCr": "combinatorial",
        "^": "power",
    }
    groups = {op_to_group[str(op)] for op in ops if str(op) in op_to_group}
    for group in sorted(groups):
        put("associativity", "operator_group", group)
    if groups:
        put("associativity", "shape", "parenthesized" if stratum == "parenthesized" else "flat")

    return out


def levels_as_json(levels: dict[str, dict[str, set[str]]]) -> dict[str, dict[str, list[str]]]:
    """コーパスに載る形。**並びを固定する**——走行ごとに動くとバイト一致しない。"""
    return {
        scope: {axis: sorted(vals) for axis, vals in sorted(axes.items())}
        for scope, axes in sorted(levels.items())
    }


#: **観測できるが、記録できない軸。**
#:
#: 木には無く、**期待値から出る**もの——`combinatorics` の `path` は
#: 「正常 / 定義域 / Overflow 近傍」で、**エラーの種類が決める**。木を歩いても
#: 出ない（2026-08-30、突合の assert が初回の実走で見つけた）。
#:
#: **軸には 3 つの類型がある**、と分かった:
#:
#: 1. **記録も観測もできる** → 突き合わせられる（(c) が成立する軸）
#: 2. **観測できない**（`UNOBSERVABLE_AXES`）→ 記録するしかない = (b)
#: 3. **観測できるが記録できない**（ここ）→ 観測するしかない。**突合の相手が居ない**
#:
#: **3 を宣言しないと、突合が「記録に無い」を食い違いとして毎回落とす。**
OBSERVATION_ONLY_AXES: dict[str, tuple[str, ...]] = {
    # 期待値のエラー種別から出る。木を歩いても出ない
    "combinatorics": ("path",),
    # `eng` / `dms` は**木の外で押す**——`to_key_sequence(node)` の後ろに足される
    "display": ("kind",),
    # キー列は**括弧を省いた形**なので、木の括弧とは対応しない
    "precedence": ("parenthesis",),
    # `polar_toggle` は木の外。ゼロ成分は期待値から出る
    "complex": ("form", "zero_part"),
}


class LevelsDisagree(RuntimeError):
    """記録と観測が食い違った。**生成を止める。**"""


def assert_record_matches_observation(case: dict, node: object) -> None:
    """**この段の主番人。** 記録と観測を、**1 本の assert で**突き合わせる。

    **どちらが正しいかは決めてある**（裁定 1 の (c) の代償）——**木が事実、
    キーからの読みが解釈**である。**一致しなければ射影を直す**（記録を
    観測に合わせて書き換えない）。

    **突合できる軸だけを見る。** `UNOBSERVABLE_AXES` に挙げた軸は観測側が
    出さないので、記録側も出していない（`recorded_levels` の docstring）。
    """
    recorded = levels_as_json(recorded_levels(node, case.get("mode", ""), case.get("stratum")))
    observed_all = observed_levels(case)
    # **突き合わせるのは、両方の経路が出す軸だけ**である。片方しか出さない軸を
    # 混ぜると、**突合が毎回落ちる**（初回の実走で `combinatorics/path` が
    # そうなった）——それは食い違いではなく、**相手が居ない**だけである。
    skip = {
        (scope, axis)
        for table in (UNOBSERVABLE_AXES, OBSERVATION_ONLY_AXES)
        for scope, axes in table.items()
        for axis in axes
    }
    observed = levels_as_json(
        {
            scope: {
                axis: vals
                for axis, vals in axes.items()
                # **`scope in recorded` で絞らない。** 絞ると、**記録が空の
                # ときに観測側も空になり、記録の欠落を捕まえられない**
                # ——2026-08-30、テストがこの穴を見つけた（木を関数の無いものに
                # 差し替えても assert が通った）。**絞りが番人を片側検査に
                # していた。**
                if (scope, axis) not in skip
            }
            for scope, axes in observed_all.items()
        }
    )
    observed = {scope: axes for scope, axes in observed.items() if axes}
    if recorded != observed:
        raise LevelsDisagree(
            f"{case.get('id')}: 木から読んだ水準と、キーから読んだ水準が違う。"
            f"木={recorded} / キー={observed}。"
            "**木が事実、キーからの読みが解釈である**——射影を直すこと"
        )
