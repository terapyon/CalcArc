# U-1 Unit Engine（Length / Mass / Temperature） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 長さ・質量・温度の単位換算を、厳密有理数で誤差なく計算し、Convert パネルの「準備中」を電卓の盤面に置き換える。

**Architecture:** すべての単位を**アフィン変換 1 本**（`base = value × factor + offset`）で表し、**必ず基準単位を経由**する（N × N の表を持たない）。係数は既存の `Rational`（i128 有界の既約分数）で持ち、f64 を一度も経由しない。表示は `docs/numerical-policy.md` の既存規則をそのまま採り、**有理数から 10 進を作る経路だけを新しく書く**（Scientific は f64、Convert は有理数。規則の文言は共有し、実装は別）。

**Tech Stack:** Rust（`calcarc-core` / `calcarc-wasm`）、Python 3（`fractions.Fraction`、参照実装）、TypeScript + React（`web`）、Playwright / vitest / pytest。

**Spec:** `docs/superpowers/specs/2026-08-19-unit-engine-design.md`（**ユーザー承認済み**。この計画は spec から論じる。実装者は両方を読む）

## Global Constraints

spec と CLAUDE.md / CONTRIBUTING.md の全タスク共通の要求。**各タスクの要求はこの節を暗黙に含む。**

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない。
- **`calcarc-core` は panic しない。** `#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]` が強制する。
- **`web/src/calc/` に React を import しない。**
- **WASM 境界は JavaScript 例外を投げない。** 計算エラーは戻り値の一部。
- **許容誤差をテストコードに書かない。** `testdata/convert.json` は**厳密一致で、`tolerance` を持たない**（誤差の概念が無い）。
- **参照実装を Rust の移植にしない。** 係数は spec §3.2 の**定義値の表**から書き起こす。表示の規則は `docs/numerical-policy.md` から書き起こす。**Rust の実装を読まない。**
- **`KEY_TOKENS`（Scientific）と `crates/calcarc-core/tests/engine_table.rs` を触らない**（spec §0.0-3）。
- **既存の WASM 署名を 1 つも変えない。足すだけ**（spec §0.0-4）。
- **N × N の換算表を持たない。必ず基準単位を経由する**（spec §0.0-5）。
- **温度は「点」である。** 温度差の換算はしない（spec §0.0-6、§3.4）。
- **絶対零度より下も止めない。** `−300 °C` は計算できる（spec §3.5、裁定として明記）。
- **コミット前に `cargo fmt --all`。** `--check` は直さない。
- **`uv` は必ず `--no-config`**（手元の `exclude-newer` がロックファイルに混ざり CI が落ちる）。
- **コミットメッセージ末尾**: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`git push` と PR 作成は行わない。**
- **共有ワークツリー**: `git checkout` / `git rebase` / `git commit --amend` / ブランチ切り替えを行わない。コミット前に `git branch --show-current` が `feature/unit-engine` であることを確認する。**赤確認の変異を戻すときは再編集する**（`git checkout -- <file>` は同じファイルの別作業を巻き戻す）。

### 表示の規則（`docs/numerical-policy.md` の「表示」節。逐語）

```
- 有効数字 10 桁。
- 丸めは round-half-to-even（Rust の書式化に一致）。
- `|x| >= 1e10` または `0 < |x| < 1e-9` で指数表記。
- 整数部には 3 桁ごとにカンマを入れる（`1,234,567`）。**既定で常に入る。**
  小数部には入れない（`1,234.5678`）。指数表記の仮数・指数部にも入らない
```

**出力の形は既に画面に出ているものと同じである**（Scientific の表示）。この計画が固定する形:

| 入力 | 出力 |
|---|---|
| 0 | `0` |
| 25.4 | `25.4`（**末尾の 0 は落とす**。`25.40000000` にしない） |
| 1234567 | `1,234,567` |
| 1234.5678 | `1,234.5678` |
| 10¹² | `1e12`（**`+` も先行 0 も付けない**） |
| 1.5 × 10⁻¹⁵ | `1.5e-15` |
| 負値 | 先頭に `-`（カンマの外側） |

**境の判定は丸めた後の値で行う**（spec §3.3）。`9,999,999,999.5` は丸めると 10¹⁰ に達するので**指数表記になる**。

### トークンの綴り（**この計画の裁定 1**）

spec §3.2 の表は単位を `µm` `°C` `°F` と書いているが、**トークンは ASCII の小文字に倒す**。ラベル（画面・読み上げ）が記号を持つ。

| カテゴリ | トークン（Rust・TS・hash・golden で共通） | ラベル |
|---|---|---|
| length | `nm` `um` `mm` `cm` `m` `km` `in` `ft` `yd` `mi` `nmi` | `nm` `µm` `mm` `cm` `m` `km` `in` `ft` `yd` `mi` `nmi` |
| mass | `mg` `g` `kg` `t` `lb` `oz` `st` | 同じ綴り |
| temperature | `k` `degc` `degf` | `K` `°C` `°F` |
| カテゴリ | `length` `mass` `temperature` | `長さ` `質量` `温度` |

**なぜ**: トークンは URL の hash・JSON の golden・`token_parity.rs` の逐語比較を通る。非 ASCII を混ぜると、正規化の違い（`µ` は U+00B5 と U+03BC の 2 通りがある）で**同じに見えて一致しない**事故が起きる。S-0 が単位のトークンを小文字に倒したのと同じ規律である。
**間違えたときの代償**: 綴りが 1 つずれると、その単位だけが黙って `SyntaxError` になる。`token_parity.rs` の検査（Task 8）がこれを機械で見張る。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `reference/src/calcarc_reference/convert_ref.py` | **新設**。係数表（`Fraction`）とアフィン換算、有理数 → 10 進文字列 |
| `reference/src/calcarc_reference/cases.py` | 末尾に `CONVERT_INPUTS` を追記 |
| `reference/scripts/generate.py` | `build_convert()` を追加、`main()` に 1 行 |
| `reference/tests/test_convert_ref.py` | **新設**。参照実装の健全性テスト |
| `testdata/convert.json` | **新設**（生成物、コミットする）。`tolerance` を持たない |
| `crates/calcarc-core/src/expr/mod.rs` | `evaluate_to_rational` を**追加のみ**。構文解析器は 1 行も変えない |
| `crates/calcarc-core/src/convert/mod.rs` | **新設**。`Category` / `Unit` / `convert()`。基準単位経由 |
| `crates/calcarc-core/src/convert/format.rs` | **新設**。`Rational` → 10 進文字列 |
| `crates/calcarc-core/src/lib.rs` | `pub mod convert;` を 1 行追加 |
| `crates/calcarc-core/tests/convert_golden.rs` | **新設**。golden 突き合わせ + 件数下限 |
| `crates/calcarc-wasm/src/lib.rs` | `convert` / `convert_units` を**追加のみ** |
| `crates/calcarc-wasm/tests/token_parity.rs` | 単位トークンの一致検査を 1 本追加 |
| `web/src/convert/types.ts` | **新設**。`CONVERT_UNIT_TOKENS` ほかの定数と型 |
| `web/src/convert/index.ts` | **新設**。wasm のラッパ（`ConvertCalc`）。React を import しない |
| `web/src/convert/entry.ts` | **新設**。`units/entry.ts` の再輸出（`datascale/entry.ts` に倣う） |
| `web/src/route.ts` | `CONVERT_CATEGORIES` を追加、`CATEGORIES.convert` と `DEFAULT_CATEGORY.convert` を埋める |
| `web/src/ui/Nav/Nav.tsx` | `#convert` → `#convert/length` |
| `web/src/ui/Keypad/convert.ts` | **新設**。キー集合（`ConvertKeyToken`） |
| `web/src/ui/Convert/ConvertPanel.tsx` | 準備中パネルを**器**（`<select>` + 分岐）に置き換え |
| `web/src/ui/Convert/UnitPanel.tsx` | **新設**。換算の盤面本体（3 カテゴリで共有する 1 つ） |
| `web/src/App.tsx` | `<ConvertPanel category={route.category} />` に変える |
| `web/tests/e2e/convert.spec.ts` | **新設** |
| `web/tests/e2e/convert-placeholder.spec.ts` | 準備中の 2 本を削除、`#data-scale` の 1 本を移設 |

**`UnitPanel` を 1 つにする理由**: 3 カテゴリは**単位の表が違うだけ**で、盤面の構造（値 / 変換元 / 変換先 / ⇅、数字面と単位面の入れ替え）は同一である。カテゴリごとにパネルを作ると、同じバグを 3 回直すことになる。**S-0 が LLM と Transfer を別パネルにしたのは、項目の数も結果の形も違ったからである**——ここは違う。

---

## 入力の値の形（**この計画の裁定 2**）

**spec §6 は `−40 °C = −40 °F` を golden の名指しケースにしているが、既存の式評価器は負数を読めない。**
実測: `crates/calcarc-core/src/expr/parse.rs:119-131` の `factor()` が受けるのは `(` 式 `)` と数リテラルだけで、
**単項マイナスの枝が無い**。`-40` はいま `SyntaxError` になる。

**裁定: 単項マイナスは `convert` の入口が担う。構文解析器は 1 行も変えない**（spec §4.3 の約束を守る）。

```text
convert の入口:
  1. 先頭の `-` を **1 つだけ** 剥がす（`--40` は SyntaxError）
  2. 残りを evaluate_to_rational に渡す（式でよい。`-5*12` は −60）
  3. 剥がしていたら符号を反転する
```

**なぜ**: spec §0.0 の「触らない」約束は構文解析器に掛かっており、`convert` は新設のモジュールである。
入口 1 か所で済むうえ、`-5*12` の優先順位（`-(5*12)`）も自然に出る。
**間違えたときの代償**: ここを飛ばすと、温度の**不動点 `−40` が 1 件も打てない**——
spec が「factor と offset の両方が同時に効く唯一の点」と呼んだケースが、盤面から到達不能になる。

**golden の `value` は 10 進リテラルに限る**（`-?\d+(\.\d+)?`）。式（`5*12`）が通ることは
既存の expr の検査が持っており、golden で二重に持たない。**盤面で式が打てることは Task 11 の UI テストが見る。**

---

### Task 1: Python 参照 — 係数表とアフィン換算

**Files:**
- Create: `reference/src/calcarc_reference/convert_ref.py`
- Create: `reference/tests/test_convert_ref.py`

**Interfaces:**
- Produces: `convert_ref.CATEGORIES: dict[str, dict[str, tuple[Fraction, Fraction]]]`（カテゴリ → トークン → `(factor, offset)`）、`convert_ref.to_base(value, factor, offset)`、`convert_ref.from_base(base, factor, offset)`、`convert_ref.convert_value(value: Fraction, category: str, src: str, dst: str) -> Fraction`（不正なカテゴリ・単位は `KeyError` ではなく `None` を返す）
- Consumes: `fractions.Fraction` のみ。**`data_scale_ref` の部品は使わない**（u128 の定義域はここに無い）

**【必読】この Task は spec §3.1・§3.2 だけを見て書く。`crates/calcarc-core/` を開かないこと。** Rust 側はまだ存在しないが、存在しても読まない——同じアルゴリズムを両方に書くと、同じバグが両方に入って検証の意味が消える（CLAUDE.md）。

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_convert_ref.py`:

```python
"""単位換算 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from fractions import Fraction

from calcarc_reference.convert_ref import convert_value


def test_the_inch_is_exactly_25_point_4_millimetres() -> None:
    # 1959 年の国際ヤード・ポンド協定。**定義値であって測定値ではない。**
    assert convert_value(Fraction(1), "length", "in", "mm") == Fraction(254, 10)


def test_the_pound_is_exactly_0_point_45359237_kilograms() -> None:
    assert convert_value(Fraction(1), "mass", "lb", "kg") == Fraction(45359237, 10**8)


def test_minus_forty_is_the_fixed_point_of_the_two_scales() -> None:
    # **factor と offset の両方が同時に効く唯一の点。**
    # offset を落とすと、この 1 件だけが動く。
    assert convert_value(Fraction(-40), "temperature", "degc", "degf") == Fraction(-40)
    assert convert_value(Fraction(-40), "temperature", "degf", "degc") == Fraction(-40)


def test_the_offsets_check_out() -> None:
    assert convert_value(Fraction(0), "temperature", "degc", "k") == Fraction(5463, 20)
    assert convert_value(Fraction(32), "temperature", "degf", "degc") == Fraction(0)


def test_a_round_trip_returns_exactly_where_it_started() -> None:
    # **有理数でなければ通らない。** f64 なら 99.99999999999999 になる。
    miles = convert_value(Fraction(100), "length", "km", "mi")
    assert convert_value(miles, "length", "mi", "km") == Fraction(100)


def test_temperature_converts_points_not_differences() -> None:
    # spec §3.4: 10 °C の差は 18 °F の差だが、この換算は点を変換する。
    assert convert_value(Fraction(10), "temperature", "degc", "degf") == Fraction(50)


def test_crossing_categories_is_not_a_conversion() -> None:
    assert convert_value(Fraction(1), "length", "km", "kg") is None
    assert convert_value(Fraction(1), "mass", "km", "kg") is None


def test_unknown_tokens_are_rejected() -> None:
    assert convert_value(Fraction(1), "length", "km", "furlong") is None
    assert convert_value(Fraction(1), "loudness", "db", "db") is None


def test_below_absolute_zero_is_not_stopped() -> None:
    # spec §3.5 の裁定。物理の妥当性は単位換算器の仕事ではない。
    assert convert_value(Fraction(-300), "temperature", "degc", "k") == Fraction(-537, 20)
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd reference && uv run --no-config pytest tests/test_convert_ref.py -q
```
期待: `ModuleNotFoundError: No module named 'calcarc_reference.convert_ref'`

- [ ] **Step 3: 実装する**

`reference/src/calcarc_reference/convert_ref.py`:

```python
"""単位換算の参照実装（U-1 spec §3.1〜§3.5）。

数値は `fractions.Fraction`（任意精度の厳密有理数）。**係数はすべて定義値であって
測定値ではない**——出典は国際ヤード・ポンド協定（1959）と SI。式は spec §3.2 の表から
書き起こしている。

**Rust の実装は見ていない。**

**すべての単位はアフィン変換 1 本で表す**（spec §3.1）:

    base  = value × factor + offset
    value = (base − offset) ÷ factor

**換算は必ず基準単位を経由する**（spec §0.0-5）。N 個の単位に N × N の式を持たない。

**温度は「点」である**（spec §3.4）。温度差の換算はしない。
"""

from __future__ import annotations

from fractions import Fraction

_ZERO = Fraction(0)
_ONE = Fraction(1)

# (factor, offset)。基準単位は factor = 1、offset = 0。
# **spec §3.2 の表をそのまま書く。** 掛け算で導ける行も、導かずに定義値で書く
# ——`ft = 12 × in` を式で書くと、in を直した日に ft が黙って付いてくる。
# **それは正しい振る舞いだが、表が「何が定義値か」を語らなくなる。**
CATEGORIES: dict[str, dict[str, tuple[Fraction, Fraction]]] = {
    "length": {  # 基準: メートル
        "nm": (Fraction(1, 10**9), _ZERO),
        "um": (Fraction(1, 10**6), _ZERO),
        "mm": (Fraction(1, 1000), _ZERO),
        "cm": (Fraction(1, 100), _ZERO),
        "m": (_ONE, _ZERO),
        "km": (Fraction(1000), _ZERO),
        "in": (Fraction(127, 5000), _ZERO),  # ちょうど 25.4 mm（1959）
        "ft": (Fraction(381, 1250), _ZERO),  # ちょうど 0.3048 m
        "yd": (Fraction(1143, 1250), _ZERO),  # ちょうど 0.9144 m
        "mi": (Fraction(201168, 125), _ZERO),  # ちょうど 1609.344 m
        "nmi": (Fraction(1852), _ZERO),  # 海里。ちょうど 1852 m
    },
    "mass": {  # 基準: キログラム
        "mg": (Fraction(1, 10**6), _ZERO),
        "g": (Fraction(1, 1000), _ZERO),
        "kg": (_ONE, _ZERO),
        "t": (Fraction(1000), _ZERO),  # メートルトン
        "lb": (Fraction(45359237, 10**8), _ZERO),  # ちょうど 0.45359237 kg（1959）
        "oz": (Fraction(45359237, 10**8 * 16), _ZERO),  # 常衡オンス = lb / 16
        "st": (Fraction(45359237 * 14, 10**8), _ZERO),  # ストーン = 14 lb
    },
    "temperature": {  # 基準: ケルビン
        "k": (_ONE, _ZERO),
        "degc": (_ONE, Fraction(5463, 20)),  # 273.15
        "degf": (Fraction(5, 9), Fraction(45967, 180)),  # K = (F + 459.67) × 5/9
    },
}


def to_base(value: Fraction, factor: Fraction, offset: Fraction) -> Fraction:
    return value * factor + offset


def from_base(base: Fraction, factor: Fraction, offset: Fraction) -> Fraction:
    return (base - offset) / factor


def convert_value(value: Fraction, category: str, src: str, dst: str) -> Fraction | None:
    """換算する。**知らないカテゴリ・単位は `None`**（例外にしない——呼び出し側が
    `{"error": "SyntaxError"}` に落とす）。

    **カテゴリをまたぐ換算は存在しない。** `km → kg` は「知らない単位」と同じ扱いで、
    表の引き方が自然にそうなる（カテゴリの表に `kg` は無い）。
    """
    table = CATEGORIES.get(category)
    if table is None:
        return None
    if src not in table or dst not in table:
        return None
    base = to_base(value, *table[src])
    return from_base(base, *table[dst])
```

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd reference && uv run --no-config pytest tests/test_convert_ref.py -q
```
期待: 9 passed

- [ ] **Step 5: コミット**

```bash
git add reference/src/calcarc_reference/convert_ref.py reference/tests/test_convert_ref.py
git commit   # 例: "An inch is 25.4 millimetres, exactly"
```

---

### Task 2: Python 参照 — 有理数から 10 進文字列

**Files:**
- Modify: `reference/src/calcarc_reference/convert_ref.py`（`format_rational` と `compute` を追加）
- Modify: `reference/tests/test_convert_ref.py`（書式のテストを追加）

**Interfaces:**
- Consumes: Task 1 の `convert_value`
- Produces: `convert_ref.format_rational(value: Fraction) -> str`、`convert_ref.compute(value: str, category: str, src: str, dst: str) -> dict`（`{"text": str}` または `{"error": "SyntaxError"}`）

**【必読】書式の規則は `docs/numerical-policy.md` の「表示」節から書き起こす。** `crates/calcarc-core/src/numeric/format.rs` を開かない——あれは f64 の経路で、**同じ規則の別実装**である。読むと移植になる。

**規則**（Global Constraints の表を再掲）: 有効数字 10 桁 / round-half-to-even /
`|x| ≥ 10¹⁰` または `0 < |x| < 10⁻⁹` で指数表記 / 整数部だけ 3 桁カンマ / 末尾の 0 は落とす /
**境の判定は丸めた後の値で行う**。

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_convert_ref.py` の末尾に追記:

```python
from calcarc_reference.convert_ref import compute, format_rational


def test_a_short_value_keeps_its_own_length() -> None:
    # **末尾の 0 は落とす。** 25.40000000 にしない。
    assert format_rational(Fraction(254, 10)) == "25.4"
    assert format_rational(Fraction(0)) == "0"
    assert format_rational(Fraction(-40)) == "-40"


def test_ten_significant_digits_is_the_ceiling() -> None:
    # 100 km は 62.13711922 mi（spec §4.1 の盤面図の値）。10 桁。
    assert format_rational(Fraction(100000, 1) / Fraction(201168, 125)) == "62.13711922"


def test_commas_go_in_the_integer_part_only() -> None:
    assert format_rational(Fraction(1234567)) == "1,234,567"
    assert format_rational(Fraction(12345678, 10000)) == "1,234.5678"
    assert format_rational(Fraction(-1234567)) == "-1,234,567"


def test_the_big_boundary_is_ten_to_the_tenth() -> None:
    # 10^10 ちょうどは指数表記、その 1 つ下は固定小数点。
    assert format_rational(Fraction(10**10)) == "1e10"
    assert format_rational(Fraction(10**10 - 1)) == "9,999,999,999"


def test_the_boundary_is_judged_after_rounding() -> None:
    # **9,999,999,999.5 は丸めると 10^10 に達するので指数表記になる**(spec §3.3)。
    # half-to-even なので 9999999999.5 は偶数側の 10000000000 へ上がる。
    assert format_rational(Fraction(99999999995, 10)) == "1e10"


def test_the_small_boundary_is_ten_to_the_minus_ninth() -> None:
    assert format_rational(Fraction(1, 10**9)) == "0.000000001"
    assert format_rational(Fraction(1, 10**10)) == "1e-10"


def test_half_to_even_rounds_toward_the_even_digit() -> None:
    # 11 桁目がちょうど 5 で、10 桁目が偶数なら**上げない**。
    assert format_rational(Fraction(123456789_25, 10**9)) == "123.4567892"
    # 10 桁目が奇数なら上げる。
    assert format_rational(Fraction(123456789_35, 10**9)) == "123.4567894"


def test_compute_is_the_entry_point() -> None:
    assert compute("100", "length", "km", "mi") == {"text": "62.13711922"}
    assert compute("-40", "temperature", "degc", "degf") == {"text": "-40"}
    assert compute("1", "length", "km", "kg") == {"error": "SyntaxError"}
    assert compute("", "length", "km", "m") == {"error": "SyntaxError"}
    assert compute("1e3", "length", "km", "m") == {"error": "SyntaxError"}
    assert compute("--1", "length", "km", "m") == {"error": "SyntaxError"}
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd reference && uv run --no-config pytest tests/test_convert_ref.py -q
```
期待: `ImportError: cannot import name 'compute'`

- [ ] **Step 3: 実装する**

`convert_ref.py` の末尾に追記:

```python
import re

_DIGITS = 10
# **受け付ける値は 10 進リテラルだけ**（式は Rust 側の評価器が持つ。golden で
# 二重に持たない）。指数表記の入力は受けない——盤面にその打ち方が無い。
_LITERAL = re.compile(r"\A-?\d+(\.\d+)?\Z")


def format_rational(value: Fraction) -> str:
    """有効数字 10 桁の 10 進文字列にする（numerical-policy の「表示」節）。

    **log10 を使わない。** 10 の冪の近くで 1 桁ずれるうえ、丸めの繰り上がり
    （`9999999999.5` → `1e10`）を先読みできない。10 倍・1/10 倍で正規化して
    **丸めた後の指数**を持つ。
    """
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    v = -value if value < 0 else value

    # 1 <= v < 10 に正規化し、そのとき動かした冪を exponent に持つ。
    exponent = 0
    while v >= 10:
        v /= 10
        exponent += 1
    while v < 1:
        v *= 10
        exponent -= 1

    # 有効数字 10 桁 = 整数部 1 桁 + 小数 9 桁。10^9 倍して丸める。
    scaled = v * 10 ** (_DIGITS - 1)
    whole, rest = divmod(scaled.numerator, scaled.denominator)
    twice = 2 * rest
    if twice > scaled.denominator or (twice == scaled.denominator and whole % 2 == 1):
        whole += 1
    if whole == 10**_DIGITS:  # 繰り上がりで 11 桁になった
        whole //= 10
        exponent += 1

    digits = str(whole)  # ちょうど 10 桁

    # **境の判定は丸めた後の指数で行う**(spec §3.3)。
    if exponent >= 10 or exponent <= -10:
        mantissa = _trim(digits[0] + "." + digits[1:])
        return f"{sign}{mantissa}e{exponent}"

    if exponent >= 0:
        integer, fraction = digits[: exponent + 1], digits[exponent + 1 :]
    else:
        integer, fraction = "0", "0" * (-exponent - 1) + digits
    body = _trim(integer + "." + fraction) if fraction else integer
    return sign + _group(body)


def _trim(text: str) -> str:
    """末尾の 0 と、裸になった小数点を落とす。"""
    return text.rstrip("0").rstrip(".") if "." in text else text


def _group(text: str) -> str:
    """整数部だけ 3 桁ごとに区切る。**小数部には入れない**（numerical-policy）。"""
    integer, dot, fraction = text.partition(".")
    grouped = f"{int(integer):,}"
    return grouped + dot + fraction


def compute(value: str, category: str, src: str, dst: str) -> dict:
    """入口。**エラーは例外ではなく戻り値**（他の参照実装と同じ流儀）。"""
    if not _LITERAL.match(value):
        return {"error": "SyntaxError"}
    landed = convert_value(Fraction(value), category, src, dst)
    if landed is None:
        return {"error": "SyntaxError"}
    return {"text": format_rational(landed)}
```

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd reference && uv run --no-config pytest -q
```
期待: 既存 248 件 + 新規（Task 1 の 9 件 + この Task の 9 件）が全部緑

- [ ] **Step 5: コミット**

```bash
git add reference
git commit   # 例: "Turn an exact fraction into ten honest digits"
```

**この Task の申し送り**: `format_rational` の正規化ループは指数に比例して回る。
`nm → mi` のような比の大きい換算でも冪は 20 程度なので実害は無いが、**指数表記の
入力を受け付けるようになったら**（この計画は受け付けない）見直すこと。

---

### Task 3: ケースと golden の生成

**Files:**
- Modify: `reference/src/calcarc_reference/cases.py`（末尾に `CONVERT_INPUTS`）
- Modify: `reference/scripts/generate.py`（import 1 行、`build_convert()`、`main()` に 1 行）
- Create: `testdata/convert.json`（生成物。**コミットする**）

**Interfaces:**
- Consumes: Task 2 の `convert_ref.compute`
- Produces: `testdata/convert.json`（`schema` / `generated_by` / `cases[]`。**`tolerance` を持たない**）、Task 7 の `convert_golden.rs` が読む

- [ ] **Step 1: ケースを書く**

`cases.py` の末尾に追記。**spec §6 の「名指しで置くケース」の表を 1 行ずつ写し、なぜ置くかを残す**:

```python
# (value, category, from, to)。**値は 10 進リテラルに限る**（式は expr の検査が持つ）。
# spec §6 の「名指しで置くケース」がそのまま並ぶ。
CONVERT_INPUTS: list[tuple[str, str, str, str]] = [
    # 定義値そのもの（1959 年の国際ヤード・ポンド協定）
    ("1", "length", "in", "mm"),
    ("1", "mass", "lb", "kg"),
    # **温度のアフィン変換の不動点。** factor と offset の両方が同時に効く唯一の点
    ("-40", "temperature", "degc", "degf"),
    ("-40", "temperature", "degf", "degc"),
    # offset の検算（spec §3.2 で手計算したもの）
    ("0", "temperature", "degc", "k"),
    ("32", "temperature", "degf", "degc"),
    # **往復。有理数でなければ厳密には戻らない**（2 件で 1 組）
    ("100", "length", "km", "mi"),
    ("62.13711922", "length", "mi", "km"),  # 上の答えを打ち直した値
    # 盤面図の headline（spec §4.1）
    ("100", "length", "km", "mi"),
    # 指数表記の**小さい側**の境（1 nm = 1e-12 km）
    ("1", "length", "nm", "km"),
    # 指数表記の**大きい側**の境（10^4 km = 1e10 mm）。
    # **上側を 1 件も置かないと赤確認 4 が空振りする**
    ("10000", "length", "km", "mm"),
    # **half-even の tie。** 11 桁目がちょうど 5 で 10 桁目が偶数
    ("1.00000000005", "length", "m", "m"),
    # カンマが入る 1 件（整数部だけに入り、小数部には入らないこと）
    ("1234.5678", "length", "km", "km"),
    # 温度は「点」である（10 °C の差ではなく 10 °C という点）
    ("10", "temperature", "degc", "degf"),
    # **絶対零度より下も止めない**（spec §3.5 の裁定）
    ("-300", "temperature", "degc", "k"),
    # 質量の残り（st と oz が 1 度以上現れる）
    ("1", "mass", "st", "lb"),
    ("16", "mass", "oz", "lb"),
    # 長さの残り（SI 接頭辞と海里が 1 度以上現れる）
    ("1", "length", "nmi", "m"),
    ("1", "length", "um", "nm"),
    ("1", "length", "ft", "in"),
    ("1", "length", "yd", "ft"),
    ("1", "length", "cm", "mm"),
    # エラー 3 件。**カテゴリをまたぐ / 知らない単位 / 値が式でない**
    ("1", "length", "km", "kg"),
    ("1", "length", "km", "furlong"),
    ("1e3", "length", "km", "m"),
]
```

**注意**: `("100", "length", "km", "mi")` が 2 度出てくる（往復の片割れと headline）。
`generate.py` の `id` は入力から作るので**重複する**。**片方を消すこと**——`build_convert` に
重複検査を入れる（下の Step 2）ので、消し忘れれば生成時に落ちる。

- [ ] **Step 2: golden を組み立てる**

`generate.py` の import 群に `convert_ref` を足し、`build_transfer` の隣に:

```python
def build_convert() -> dict:
    entries = []
    for value, category, src, dst in cases.CONVERT_INPUTS:
        result = convert_ref.compute(value, category, src, dst)
        entries.append(
            {
                "id": f"convert/{category}/{value}{src}to{dst}",
                "op": "convert",
                "input": {
                    "value": value,
                    "category": category,
                    "from": src,
                    "to": dst,
                },
                "expect": result,
            }
        )
    ids = [entry["id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("convert の id が重複している")
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }
```

`main()` に 1 行:

```python
write("convert.json", build_convert())
```

**`tolerance` を入れないこと**（`_envelope()` を通さない）。誤差の概念が無い（spec §6）。

- [ ] **Step 3: 生成して中身を見る**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && python3 -c "
import json; d=json.load(open('testdata/convert.json'))
print('cases', len(d['cases']), 'tolerance' in d)
for c in d['cases']: print(' ', c['id'], '->', c['expect'])
"
```
**目で確かめること**（機械が代わりにやってくれない）:
- `1inTomm` が `25.4`、`1lbTokg` が `0.45359237`
- `-40degcTodegf` が `-40`
- `1nmTokm` が `1e-12`、`10000kmTomm` が `1e10`（**指数表記の両側**）
- `1234.5678kmTokm` が `1,234.5678`（**カンマは整数部だけ**）
- エラーが 3 件（`{"error": "SyntaxError"}`）
- **`tolerance` が無い**（上の出力の 2 つ目が `False`）

- [ ] **Step 4: pytest を回す**

```bash
cd reference && uv run --no-config pytest -q
```

- [ ] **Step 5: コミット**

```bash
git add reference testdata/convert.json
git commit   # 例: "Write down what a converted value must look like"
```

---

### Task 4: `evaluate_to_rational`（有理数のまま受け取る着地）

**Files:**
- Modify: `crates/calcarc-core/src/expr/mod.rs`（**追加のみ**）

**Interfaces:**
- Consumes: `expr::parse::evaluate(text: &str, units: UnitSet) -> CalcResult<Rational>`（既存、`parse.rs:185`）
- Produces: `pub fn evaluate_to_rational(text: &str, units: UnitSet) -> CalcResult<Rational>`

**いま在るもの**（実測）: 出口は `evaluate_to_integer`（`expr/mod.rs:75`、床関数で u128）と
`evaluate_to_percent`（`:82`）の 2 つで、**有理数のまま受け取る出口が無い**。
足りないのは着地だけである（spec §2）。

**構文解析器（`parse.rs`）を 1 行も変えないこと**（spec §4.3）。

- [ ] **Step 1: 失敗するテストを書く**

`crates/calcarc-core/src/expr/mod.rs` の `#[cfg(test)] mod tests` に追記:

```rust
#[test]
fn a_rational_lands_without_being_floored() {
    // **`evaluate_to_integer` は床関数で落とす。** 換算は落としてはいけない。
    let value = evaluate_to_rational("25.4", UnitSet::None).unwrap();
    assert_eq!(value.parts(), (127, 5));
}

#[test]
fn an_expression_lands_as_a_rational() {
    let value = evaluate_to_rational("5*12", UnitSet::None).unwrap();
    assert_eq!(value.parts(), (60, 1));
}

#[test]
fn a_third_stays_a_third() {
    // **f64 を経由しない**ことがここで見える。1/3 は 10 進で終わらない。
    let value = evaluate_to_rational("1/3", UnitSet::None).unwrap();
    assert_eq!(value.parts(), (1, 3));
}

#[test]
fn the_empty_text_is_a_syntax_error() {
    assert_eq!(
        evaluate_to_rational("", UnitSet::None),
        Err(CalcError::SyntaxError)
    );
}

#[test]
fn a_leading_minus_is_still_not_the_parsers_job() {
    // **単項マイナスは構文解析器に無い**(parse.rs:119-131)。この事実を固定する
    // ——`convert` の入口が符号を担う理由がここにある(計画の裁定 2)。
    // この検査が赤くなったら、parse.rs が変わったということである。
    assert_eq!(
        evaluate_to_rational("-40", UnitSet::None),
        Err(CalcError::SyntaxError)
    );
}
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cargo test -p calcarc-core expr:: 2>&1 | tail -20
```
期待: `cannot find function 'evaluate_to_rational'`

- [ ] **Step 3: 実装する**

`expr/mod.rs` の `evaluate_to_integer` の隣に:

```rust
/// 式を評価して**有理数のまま**返す。
///
/// `evaluate_to_integer` は床関数で u128 に落とし、`evaluate_to_percent` は
/// 4 桁の文字列に落とす。**単位換算はどちらの着地もできない**——落とした時点で
/// 換算の意味が消える(U-1 spec §1-1)。**ここは着地しないための出口である。**
pub fn evaluate_to_rational(text: &str, units: UnitSet) -> CalcResult<Rational> {
    parse::evaluate(text, units)
}
```

`Rational` を公開する必要がある（`convert` から使う）。`expr/mod.rs` に既にある
`pub mod rational;` でよい——`crate::expr::rational::Rational` で届く。**re-export を足さない**
（既存の呼び出し口を増やさない）。

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cargo test -p calcarc-core expr::
```

- [ ] **Step 5: 赤確認**

`evaluate_to_rational` の中身を `parse::evaluate(text, units)?.floor_to_u128().and_then(Rational::from_i128 ...)` のような
「一度落として戻す」形に変異させると、`a_rational_lands_without_being_floored` と `a_third_stays_a_third` が赤くなること。
**実出力を報告に貼る。** 戻すのは再編集（`git checkout --` を使わない）。

- [ ] **Step 6: コミット**

```bash
cargo fmt --all && git add crates/calcarc-core/src/expr/mod.rs
git commit   # 例: "Let a value leave the evaluator without landing"
```

---

### Task 5: `convert/` — 単位表とアフィン換算

**Files:**
- Create: `crates/calcarc-core/src/convert/mod.rs`
- Modify: `crates/calcarc-core/src/lib.rs`（`pub mod convert;` を 1 行）

**Interfaces:**
- Consumes: `crate::expr::rational::Rational`（`from_ratio`/`from_i128`/`checked_add`/`checked_sub`/`checked_mul`/`checked_div`）、Task 4 の `evaluate_to_rational`
- Produces:
  - `pub enum Category { Length, Mass, Temperature }` — `ALL: [Category; 3]`、`from_token(&str) -> Option<Category>`、`token(self) -> &'static str`、`units(self) -> &'static [Unit]`
  - `pub enum Unit { … 21 バリアント … }` — `ALL: [Unit; 21]`、`from_token(&str) -> Option<Unit>`、`token(self) -> &'static str`、`category(self) -> Category`
  - `pub fn convert(value: &str, category: Category, from: Unit, to: Unit) -> CalcResult<Rational>`
- Task 6 が `Rational` を文字列にする。Task 7 が golden で突き合わせる。Task 8 が WASM に出す。

**係数は spec §3.2 の表から書く。`reference/src/calcarc_reference/convert_ref.py` を開かない**
——参照実装を写したら、独立検証ではなくなる。

**トークンの綴りは Global Constraints の裁定 1 の表**（`um` `k` `degc` `degf`。ASCII の小文字）。

- [ ] **Step 1: 失敗するテストを書く**

`convert/mod.rs` の `#[cfg(test)] mod tests`:

```rust
use super::*;
use crate::expr::rational::Rational;

fn r(num: i128, den: i128) -> Rational {
    Rational::from_ratio(num, den).unwrap()
}

#[test]
fn the_inch_is_exactly_25_point_4_millimetres() {
    assert_eq!(convert("1", Category::Length, Unit::In, Unit::Mm), Ok(r(254, 10)));
}

#[test]
fn the_pound_is_exactly_0_point_45359237_kilograms() {
    assert_eq!(
        convert("1", Category::Mass, Unit::Lb, Unit::Kg),
        Ok(r(45359237, 100_000_000))
    );
}

#[test]
fn minus_forty_is_the_fixed_point_of_the_two_scales() {
    // **factor と offset の両方が同時に効く唯一の点**(spec §6)。
    assert_eq!(
        convert("-40", Category::Temperature, Unit::DegC, Unit::DegF),
        Ok(r(-40, 1))
    );
    assert_eq!(
        convert("-40", Category::Temperature, Unit::DegF, Unit::DegC),
        Ok(r(-40, 1))
    );
}

#[test]
fn the_offsets_check_out() {
    assert_eq!(
        convert("0", Category::Temperature, Unit::DegC, Unit::Kelvin),
        Ok(r(5463, 20))
    );
    assert_eq!(
        convert("32", Category::Temperature, Unit::DegF, Unit::DegC),
        Ok(r(0, 1))
    );
}

#[test]
fn a_round_trip_returns_exactly_where_it_started() {
    // **有理数でなければ通らない。**
    let miles = convert("100", Category::Length, Unit::Km, Unit::Mi).unwrap();
    let (num, den) = miles.parts();
    let back = from_base(to_base(miles, Unit::Mi).unwrap(), Unit::Km).unwrap();
    assert_eq!(back, r(100, 1), "{num}/{den} が戻らない");
}

#[test]
fn an_expression_is_a_valid_value() {
    // spec §4.3: `5*12` と打って inch を選べば 60 inch。
    assert_eq!(
        convert("5*12", Category::Length, Unit::In, Unit::In),
        Ok(r(60, 1))
    );
}

#[test]
fn one_leading_minus_is_allowed_and_two_are_not() {
    assert_eq!(convert("-5*12", Category::Length, Unit::M, Unit::M), Ok(r(-60, 1)));
    assert_eq!(
        convert("--1", Category::Length, Unit::M, Unit::M),
        Err(CalcError::SyntaxError)
    );
}

#[test]
fn crossing_categories_is_not_a_conversion() {
    assert_eq!(
        convert("1", Category::Length, Unit::Km, Unit::Kg),
        Err(CalcError::SyntaxError)
    );
}

#[test]
fn every_token_round_trips() {
    for unit in Unit::ALL {
        assert_eq!(Unit::from_token(unit.token()), Some(unit), "{unit:?}");
    }
    for category in Category::ALL {
        assert_eq!(Category::from_token(category.token()), Some(category), "{category:?}");
    }
    assert_eq!(Unit::from_token("furlong"), None);
    assert_eq!(Category::from_token("loudness"), None);
}

#[test]
fn every_unit_belongs_to_exactly_one_category_and_that_category_lists_it() {
    // **表が 2 つある**（`Unit::category()` と `Category::units()`）。
    // 片方だけ直すと、単位が盤面から消えるか、二重に出る。
    let mut counted = 0usize;
    for category in Category::ALL {
        for unit in category.units() {
            assert_eq!(unit.category(), category, "{unit:?}");
            counted += 1;
        }
    }
    assert_eq!(counted, Unit::ALL.len(), "どこにも載っていない単位がある");
}

#[test]
fn the_unit_counts_match_the_spec() {
    assert_eq!(Category::Length.units().len(), 11);
    assert_eq!(Category::Mass.units().len(), 7);
    assert_eq!(Category::Temperature.units().len(), 3);
}

#[test]
fn a_ratio_too_wide_for_i128_is_an_overflow_not_a_wrap() {
    // spec §3.5: **あふれは実際に起きる。** 黙って f64 に落ちるより Overflow と言う。
    let huge = "99999999999999999999999999999999999";
    assert_eq!(
        convert(huge, Category::Length, Unit::Nm, Unit::Mi),
        Err(CalcError::Overflow)
    );
}

#[test]
fn below_absolute_zero_is_not_stopped() {
    // spec §3.5 の裁定。物理の妥当性は単位換算器の仕事ではない。
    assert_eq!(
        convert("-300", Category::Temperature, Unit::DegC, Unit::Kelvin),
        Ok(r(-537, 20))
    );
}
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cargo test -p calcarc-core convert:: 2>&1 | tail -20
```
期待: `unresolved module 'convert'`

- [ ] **Step 3: 実装する**

`lib.rs` の `pub mod data_scale;` の隣に `pub mod convert;`（アルファベット順で `convert` が先）。

`crates/calcarc-core/src/convert/mod.rs` の骨格。**係数は spec §3.2 の表を写す**:

```rust
//! 単位換算の計算コア(U-1 設計書 §3)。
//!
//! **すべての単位はアフィン変換 1 本で表す**(§3.1):
//!
//! ```text
//! base  = value × factor + offset
//! value = (base − offset) ÷ factor
//! ```
//!
//! **換算は必ず基準単位を経由する**(§0.0-5)。N 個の単位に N × N の式を持たない
//! ——直接の係数を 1 つでも書くと、表と式の 2 か所が真実になる。
//! **この約束は数で守れない**（値が合っていればテストは緑になる）。**レビューで守る**(§6 の赤確認 5)。
//!
//! **係数はすべて定義値である**(§3.2)。出典は国際ヤード・ポンド協定(1959)と SI。
//! f64 を一度も経由しない——`Rational` は i128 有界の既約分数である。
//!
//! **温度は「点」である**(§3.4)。温度差の換算はしない。

use crate::expr::rational::Rational;
use crate::expr::{UnitSet, evaluate_to_rational};
use crate::{CalcError, CalcResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Length,
    Mass,
    Temperature,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    // Length（基準: メートル）
    Nm, Um, Mm, Cm, M, Km, In, Ft, Yd, Mi, Nmi,
    // Mass（基準: キログラム）
    Mg, G, Kg, T, Lb, Oz, St,
    // Temperature（基準: ケルビン）
    Kelvin, DegC, DegF,
}

impl Unit {
    pub const ALL: [Unit; 21] = [ /* 上の並びのまま */ ];

    pub fn token(self) -> &'static str {
        match self {
            Unit::Nm => "nm",
            Unit::Um => "um",   // **µ は使わない**（正規化の 2 通りで一致しなくなる。計画の裁定 1）
            // …
            Unit::Kelvin => "k",
            Unit::DegC => "degc",
            Unit::DegF => "degf",
        }
    }

    pub fn from_token(token: &str) -> Option<Unit> {
        Unit::ALL.into_iter().find(|u| u.token() == token)
    }

    pub fn category(self) -> Category { /* match */ }

    /// `(factor, offset)`。**spec §3.2 の表の値をそのまま持つ。**
    /// 掛け算で導ける行も式で書かない——表が「何が定義値か」を語らなくなる。
    fn affine(self) -> CalcResult<(Rational, Rational)> {
        let zero = Rational::from_i128(0)?;
        Ok(match self {
            Unit::In => (Rational::from_ratio(127, 5000)?, zero),      // ちょうど 25.4 mm
            Unit::Ft => (Rational::from_ratio(381, 1250)?, zero),      // ちょうど 0.3048 m
            Unit::Yd => (Rational::from_ratio(1143, 1250)?, zero),     // ちょうど 0.9144 m
            Unit::Mi => (Rational::from_ratio(201168, 125)?, zero),    // ちょうど 1609.344 m
            Unit::Lb => (Rational::from_ratio(45359237, 100_000_000)?, zero),
            Unit::DegC => (Rational::from_i128(1)?, Rational::from_ratio(5463, 20)?),
            Unit::DegF => (Rational::from_ratio(5, 9)?, Rational::from_ratio(45967, 180)?),
            // …残り
        })
    }
}

impl Category {
    pub const ALL: [Category; 3] = [Category::Length, Category::Mass, Category::Temperature];
    pub fn token(self) -> &'static str { /* "length" | "mass" | "temperature" */ }
    pub fn from_token(token: &str) -> Option<Category> { /* ALL から探す */ }
    pub fn units(self) -> &'static [Unit] { /* 上の並びの部分スライス */ }
}

/// 基準単位へ上げる。
pub fn to_base(value: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    value.checked_mul(factor)?.checked_add(offset)
}

/// 基準単位から下ろす。
pub fn from_base(base: Rational, unit: Unit) -> CalcResult<Rational> {
    let (factor, offset) = unit.affine()?;
    base.checked_sub(offset)?.checked_div(factor)
}

/// 入口。**値は式でよい**(§4.3)。
///
/// **単項マイナスは構文解析器に無い**ので、ここで 1 つだけ剥がす(計画の裁定 2)。
/// `parse.rs` は 1 行も変えない。
pub fn convert(value: &str, category: Category, from: Unit, to: Unit) -> CalcResult<Rational> {
    if from.category() != category || to.category() != category {
        return Err(CalcError::SyntaxError);
    }
    let (text, negate) = match value.strip_prefix('-') {
        Some(rest) => (rest, true),
        None => (value, false),
    };
    let mut parsed = evaluate_to_rational(text, UnitSet::None)?;
    if negate {
        parsed = Rational::from_i128(0)?.checked_sub(parsed)?;
    }
    from_base(to_base(parsed, from)?, to)
}
```

**`UnitSet::None` を使うこと。** 単位の接尾辞（`K` / `M` / `G`）を式に持ち込まない
——`km` の `k` と衝突して、同じ字が 2 つの意味を持つ（S-0 が潰した罠）。

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cargo test -p calcarc-core convert::
cargo clippy -p calcarc-core --all-targets -- -D warnings
```

- [ ] **Step 5: 赤確認（3 件、実出力を報告に貼る）**

1. **`In` の factor を `127/5000` → `254/10000` に。** **緑のままなのが正しい**
   ——約分前後で値は同じである。**これは対照確認で、赤確認の失敗例ではない**
   （spec §6 の赤確認 1。**台帳に「緑が 1 件」と書かないこと**）。`Rational` が既約分数を
   持つ意味を機械で確かめる 1 件である。**最初に走らせる。**
2. **`In` の factor を `127/5000` → `1270001/50000000`（25.40002 mm）に。** 定義値のテストが赤。
3. **`DegC` の offset を `5463/20` → `0` に。** **`minus_forty_is_the_fixed_point_of_the_two_scales` が赤**
   ——不動点は factor だけでは動かない。

- [ ] **Step 6: コミット**

```bash
cargo fmt --all && git add crates/calcarc-core/src/convert crates/calcarc-core/src/lib.rs
git commit   # 例: "Every unit is one affine step from its base"
```

---

### Task 6: `convert/format.rs` — 有理数から 10 進文字列

**Files:**
- Create: `crates/calcarc-core/src/convert/format.rs`
- Modify: `crates/calcarc-core/src/convert/mod.rs`（`pub mod format;` を 1 行）

**Interfaces:**
- Consumes: `Rational::parts() -> (i128, i128)`（分母は常に正）
- Produces: `pub fn format_rational(value: Rational) -> CalcResult<String>`

**規則は `docs/numerical-policy.md` の「表示」節。** `crates/calcarc-core/src/numeric/format.rs` は
**同じ規則の f64 版**である。**開いてもよいが写さない**——あちらは Rust の `{:e}` 書式に丸めを
任せており、有理数では使えない（f64 を経由した時点で厳密性が消える）。**規則の文言を共有し、実装は別**（spec §3.3）。

- [ ] **Step 1: 失敗するテストを書く**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::expr::rational::Rational;

    fn f(num: i128, den: i128) -> String {
        format_rational(Rational::from_ratio(num, den).unwrap()).unwrap()
    }

    #[test]
    fn zero_is_a_single_digit() {
        assert_eq!(f(0, 1), "0");
    }

    #[test]
    fn trailing_zeros_are_dropped() {
        // **25.40000000 にしない。**
        assert_eq!(f(254, 10), "25.4");
        assert_eq!(f(-40, 1), "-40");
    }

    #[test]
    fn ten_significant_digits_is_the_ceiling() {
        // 100 km = 62.13711922 mi（spec §4.1 の盤面図の値）
        assert_eq!(f(100_000 * 125, 201_168), "62.13711922");
    }

    #[test]
    fn commas_go_in_the_integer_part_only() {
        assert_eq!(f(1_234_567, 1), "1,234,567");
        assert_eq!(f(12_345_678, 10_000), "1,234.5678");
        assert_eq!(f(-1_234_567, 1), "-1,234,567");
    }

    #[test]
    fn the_big_boundary_is_ten_to_the_tenth() {
        assert_eq!(f(10_000_000_000, 1), "1e10");
        assert_eq!(f(9_999_999_999, 1), "9,999,999,999");
    }

    #[test]
    fn the_boundary_is_judged_after_rounding() {
        // **丸めると 10^10 に達するので指数表記**(spec §3.3)。
        // half-to-even: 9999999999.5 は偶数側 10000000000 へ。
        assert_eq!(f(99_999_999_995, 10), "1e10");
    }

    #[test]
    fn the_small_boundary_is_ten_to_the_minus_ninth() {
        assert_eq!(f(1, 1_000_000_000), "0.000000001");
        assert_eq!(f(1, 10_000_000_000), "1e-10");
    }

    #[test]
    fn half_to_even_rounds_toward_the_even_digit() {
        // 11 桁目がちょうど 5。10 桁目が偶数なら上げない、奇数なら上げる。
        assert_eq!(f(12_345_678_925, 100_000_000), "123.4567892");
        assert_eq!(f(12_345_678_935, 100_000_000), "123.4567894");
    }

    #[test]
    fn a_carry_moves_the_exponent() {
        // 9.9999999995 は 10 桁に丸めると 10 になる。桁が 1 つ増える。
        assert_eq!(f(99_999_999_995, 10_000_000_000), "10");
    }
}
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cargo test -p calcarc-core convert::format 2>&1 | tail -20
```

- [ ] **Step 3: 実装する**

```rust
//! 有理数を 10 進の表示文字列にする(numerical-policy の「表示」節)。
//!
//! **有効数字 10 桁 / round-half-to-even / `|x| ≥ 1e10` または `0 < |x| < 1e-9` で
//! 指数表記 / 整数部だけ 3 桁カンマ。**
//!
//! **`numeric::format` と規則は同じで実装は別である。** あちらは f64 を Rust の
//! `{:e}` 書式に渡して丸めさせる。ここは有理数なので使えない——f64 を経由した
//! 時点で厳密性が消える(U-1 spec §3.3)。
//!
//! **log10 を使わない。** 10 の冪の近くで 1 桁ずれ、丸めの繰り上がり
//! (`9999999999.5` → `1e10`)を先読みできない(`numeric::format` と同じ理由)。
//!
//! **境の判定は丸めた後の値で行う**(spec §3.3)。丸めと境の適用順で 2 通りの
//! 答えが出るのを防ぐ。

use crate::expr::rational::Rational;
use crate::{CalcError, CalcResult};

const DIGITS: usize = 10;

pub fn format_rational(value: Rational) -> CalcResult<String> {
    let (num, den) = value.parts();
    if num == 0 {
        return Ok("0".to_string());
    }
    let negative = num < 0;
    let mut p = num.unsigned_abs();
    // 分母は常に正(`Rational` の不変条件)。
    let mut q = den.unsigned_abs();

    // 1 ≤ p/q < 10 に正規化する。**分母を上げる向きを先にやる**
    // ——`checked_mul` が None を返したら、それ以上大きい分母は p を超えるので
    // ループはそこで終わってよい(あふれではない)。
    let mut exponent: i32 = 0;
    while let Some(bigger) = q.checked_mul(10) {
        if p < bigger {
            break;
        }
        q = bigger;
        exponent += 1;
    }
    // こちらは**あふれたら Overflow**。p を 10 倍する側で、値を失う。
    // 到達するのは分母が u128::MAX/10 を超える場合で、この spec の係数表からは
    // 作れない(分母は 10^9・16·10^8・5000・125・180・9 の積までしか育たない)が、
    // **証明をコメントに置いて検査は残す**——証明が崩れた日に黙って折り返さない。
    while p < q {
        p = p.checked_mul(10).ok_or(CalcError::Overflow)?;
        exponent -= 1;
    }

    // 10 桁を 1 桁ずつ取り出す。
    let mut digits = Vec::with_capacity(DIGITS);
    let mut rest = p;
    for i in 0..DIGITS {
        let d = rest / q;
        digits.push(d as u8);
        rest -= d * q;
        if i + 1 < DIGITS {
            rest = rest.checked_mul(10).ok_or(CalcError::Overflow)?;
        }
    }

    // **round-half-to-even。** `2 * rest` を作らない(あふれる)——
    // `rest` と `q - rest` を比べる。
    let up = match rest.cmp(&(q - rest)) {
        core::cmp::Ordering::Greater => true,
        core::cmp::Ordering::Equal => digits[DIGITS - 1] % 2 == 1,
        core::cmp::Ordering::Less => false,
    };
    if up {
        exponent += carry(&mut digits);
    }

    Ok(render(negative, &digits, exponent))
}

/// 末尾から繰り上げる。全部繰り上がったら `[1, 0, …]` にして 1 を返す。
fn carry(digits: &mut [u8]) -> i32 { /* 実装 */ }

/// 桁列と指数から文字列を作る。**境の判定はここ**(丸めた後の指数を見ている)。
fn render(negative: bool, digits: &[u8], exponent: i32) -> String { /* 実装 */ }
```

**`render` が守ること**:
- `exponent >= 10 || exponent <= -10` → `{仮数}e{指数}`。仮数は `d.ddd…` から末尾の 0 を落とす。**`+` も先行 0 も付けない**（`1e10`、`1e-10`）
- それ以外 → 小数点を `exponent + 1` 桁目の後ろに置く。`exponent < 0` なら `0.` の後ろに `-exponent - 1` 個の 0
- 末尾の 0 と裸の小数点を落とす
- **整数部だけ**に 3 桁カンマ。負号はカンマの外側

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cargo test -p calcarc-core convert::
cargo clippy -p calcarc-core --all-targets -- -D warnings
```

- [ ] **Step 5: 赤確認（2 件、実出力を報告に貼る）**

1. **round-half-to-even を half-up に**（`Ordering::Equal` の枝を `true` に固定）
   → `half_to_even_rounds_toward_the_even_digit` の前半が赤（spec §6 の赤確認 4）
2. **境の判定を丸める前に動かす**（正規化の直後に `exponent` を見る形へ）
   → `the_boundary_is_judged_after_rounding` が赤

- [ ] **Step 6: コミット**

```bash
cargo fmt --all && git add crates/calcarc-core/src/convert
git commit   # 例: "Ten digits, and the boundary decided after the rounding"
```

---

### Task 7: golden の突き合わせ

**Files:**
- Create: `crates/calcarc-core/tests/convert_golden.rs`

**Interfaces:**
- Consumes: `testdata/convert.json`（Task 3）、`convert::{Category, Unit, convert}`（Task 5）、`convert::format::format_rational`（Task 6）

**先例は `crates/calcarc-core/tests/transfer_golden.rs`**（構造・`load()`・件数下限の形をそのまま使う）。
**`tolerance` を読まない**（この golden は持たない）。

- [ ] **Step 1: テストを書く**

```rust
//! convert の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。**係数はすべて定義値で、経路は有理数のまま**なので、
//! 許容誤差という概念が存在しない(U-1 spec §6)。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::convert::format::format_rational;
use calcarc_core::convert::{Category, Unit, convert};
use serde::Deserialize;

const SCHEMA: u32 = 1;

#[derive(Debug, Deserialize)]
struct Golden { schema: u32, generated_by: String, cases: Vec<Case> }

#[derive(Debug, Deserialize)]
struct Case { id: String, input: Input, expect: Expect }

#[derive(Debug, Deserialize)]
struct Input {
    value: String,
    category: String,
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden { /* transfer_golden.rs:52-73 と同じ形。"convert.json" を読む */ }

fn run(input: &Input) -> Result<String, CalcError> {
    let category = Category::from_token(&input.category).ok_or(CalcError::SyntaxError)?;
    let from = Unit::from_token(&input.from).ok_or(CalcError::SyntaxError)?;
    let to = Unit::from_token(&input.to).ok_or(CalcError::SyntaxError)?;
    format_rational(convert(&input.value, category, from, to)?)
}

#[test]
fn convert_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    // **何件をどちらの枝で見たかを数える。** ループだけだと、全件が error 枝に
    // 落ちた日でもこのテストは緑を返す(tests-can-assert-nothing)。
    let mut ok = 0usize;
    let mut errors = 0usize;

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok(text), None) => {
                assert_eq!(Some(text), case.expect.text, "{}: text", case.id);
                ok += 1;
            }
            (Err(e), Some(expected)) => {
                let code = match e {
                    CalcError::Overflow => "Overflow",
                    CalcError::SyntaxError => "SyntaxError",
                    other => panic!("{}: unexpected error kind {other:?}", case.id),
                };
                assert_eq!(code, expected, "{}: error kind", case.id);
                errors += 1;
            }
            (Ok(_), Some(expected)) => panic!("{}: expected {expected} but succeeded", case.id),
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }

    assert_eq!(ok + errors, golden.cases.len(), "some case was not compared");
    // **下限は Task 3 が実際に置いた件数から決める。** 数え直して書くこと
    // ——「だいたい」で書くと、ケースが消えた日に緑のまま通る。
    assert!(ok >= 18, "only {ok} successful cases compared");
    assert!(errors >= 3, "only {errors} error cases compared");
}
```

- [ ] **Step 2: 走らせる**

```bash
cargo test -p calcarc-core --test convert_golden
```
**ここで落ちたら、それは 2 つの独立実装が食い違ったということである。** どちらが正しいかを
**spec §3.2 の定義値と numerical-policy の表示規則に照らして**決める。片方に合わせて他方を
書き換える前に、**必ず spec に戻ること。**

- [ ] **Step 3: 件数の下限を実測で埋める**

```bash
cargo test -p calcarc-core --test convert_golden -- --nocapture 2>&1 | grep -c .
python3 -c "
import json; d=json.load(open('testdata/convert.json'))
ok=sum(1 for c in d['cases'] if 'error' not in c['expect'])
print('ok', ok, 'errors', len(d['cases'])-ok)"
```
出た数を `assert!` に書く（**その数以上**、ではなく**その数ちょうど**を下限にする）。

- [ ] **Step 4: 赤確認（spec §6 の 5 件を通しでやる。実出力を報告に貼る）**

| # | 変異 | 期待 |
|---|---|---|
| 1 | `In` の factor を `127/5000` → `254/10000` | **緑のまま**（対照。約分前後で同値）。**失敗例ではない** |
| 2 | `In` の factor を 25.4 mm → 25.4001 mm | golden が赤 |
| 3 | `DegC` の offset を `5463/20` → `0` | **`-40` の不動点**が赤 |
| 4 | round-half-to-even → half-up | **境の 1 件**が赤。赤にならなければ、境の格子を 1 件も置いていない |
| 5 | `km → mi` に直接の係数を書く（基準を経由しない） | **赤にならない。** §0.0-5 は構造の約束であって数で守れない——**レビューで守る**（この行を報告に明記すること） |

- [ ] **Step 5: コミット**

```bash
cargo fmt --all && git add crates/calcarc-core/tests/convert_golden.rs
git commit   # 例: "Two implementations, one table of definitions"
```

---

### Task 8: WASM 境界と、トークンの一致検査

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`（**追加のみ**）
- Modify: `crates/calcarc-wasm/tests/token_parity.rs`（検査を 2 本追加）
- Create: `web/src/convert/types.ts`（TS 側のトークン表。**この Task で作る**——`token_parity.rs` が読むため）

**Interfaces:**
- Consumes: `convert::{Category, Unit, convert}`、`convert::format::format_rational`
- Produces:
  - `pub fn convert(value: &str, category: &str, from: &str, to: &str) -> JsValue` → `{ text: string | null, error: CalcError | null }`
  - `pub fn convert_units(category: &str) -> JsValue` → `{ units: string[] | null, error: CalcError | null }`
  - `web/src/convert/types.ts`: `CONVERT_UNIT_TOKENS` / `CONVERT_CATEGORY_TOKENS` と、そこから起こした型

**既存の署名を 1 つも変えないこと**（spec §0.0-4）。**例外を投げない**——`to_js_value` と
即時実行クロージャの形（`lib.rs:634-674` の `to_expr_result`）をそのまま踏襲する。

**Rust の関数名 `convert` はモジュール名 `convert` と衝突する。** `use calcarc_core::convert as convert_core;`
のように別名で入れるか、`calcarc_core::convert::convert(...)` とフルパスで呼ぶこと。
**`#[wasm_bindgen]` の関数名は spec §5 が `convert` と決めているので変えない。**

- [ ] **Step 1: TS 側のトークン表を書く**

`web/src/convert/types.ts`。**`web/src/datascale/types.ts` の書き方に倣う**
（`as const` の配列 → `(typeof X)[number]` で型を起こす）:

```ts
/**
 * 単位換算のトークン。
 *
 * **Rust の `Unit::ALL` / `Category::ALL` と二重管理である。** ずれると未知の
 * トークンは黙って `SyntaxError` になり、ずれが静かに沈む——
 * `crates/calcarc-wasm/tests/token_parity.rs` が機械で突き合わせる。
 *
 * **綴りは ASCII の小文字**（`um` `k` `degc` `degf`）。画面のラベルは別に持つ
 * ——`µ` は U+00B5 と U+03BC の 2 通りがあり、同じに見えて一致しない。
 */
export const CONVERT_CATEGORY_TOKENS = ["length", "mass", "temperature"] as const;
export type ConvertCategoryToken = (typeof CONVERT_CATEGORY_TOKENS)[number];

export const CONVERT_UNIT_TOKENS = [
  "nm", "um", "mm", "cm", "m", "km", "in", "ft", "yd", "mi", "nmi",
  "mg", "g", "kg", "t", "lb", "oz", "st",
  "k", "degc", "degf",
] as const;
export type ConvertUnitToken = (typeof CONVERT_UNIT_TOKENS)[number];
```

**並びは `Unit::ALL` と同じにすること**（`token_parity.rs` は順序も含めて比較する）。

- [ ] **Step 2: 一致検査を書いて、落ちることを見る**

`token_parity.rs` に追記（既存の形をそのまま使う）:

```rust
#[test]
fn convert_unit_tokens_match_between_typescript_and_rust() {
    let ts = tokens_in_ts_array(
        include_str!("../../../web/src/convert/types.ts"),
        "export const CONVERT_UNIT_TOKENS = [",
    );
    let rust: Vec<String> = Unit::ALL.iter().map(|u| u.token().to_owned()).collect();
    assert_eq!(ts, rust, "単位トークンが TypeScript と Rust でずれている");
}

#[test]
fn convert_category_tokens_match_between_typescript_and_rust() {
    let ts = tokens_in_ts_array(
        include_str!("../../../web/src/convert/types.ts"),
        "export const CONVERT_CATEGORY_TOKENS = [",
    );
    let rust: Vec<String> = Category::ALL.iter().map(|c| c.token().to_owned()).collect();
    assert_eq!(ts, rust, "カテゴリのトークンが TypeScript と Rust でずれている");
}
```

```bash
cargo test -p calcarc-wasm --test token_parity
```
期待: この 2 本が赤（TS 側は Step 1 で在るので、**並びか綴りがずれていれば**ここで出る。
両方合っていれば緑になる——そのときは Step 4 の赤確認で意味を確かめる）

- [ ] **Step 3: WASM に出す**

```rust
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConvertResult {
    text: Option<String>,
    error: Option<CalcError>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConvertUnitsResult {
    units: Option<Vec<String>>,
    error: Option<CalcError>,
}

/// 単位換算(U-1 設計書 §5)。**例外を投げない。**
#[wasm_bindgen]
pub fn convert(value: &str, category: &str, from: &str, to: &str) -> JsValue {
    let outcome: CalcResult<String> = (|| {
        let category = convert_core::Category::from_token(category).ok_or(CalcError::SyntaxError)?;
        let from = convert_core::Unit::from_token(from).ok_or(CalcError::SyntaxError)?;
        let to = convert_core::Unit::from_token(to).ok_or(CalcError::SyntaxError)?;
        convert_core::format::format_rational(convert_core::convert(value, category, from, to)?)
    })();
    let result = match outcome {
        Ok(text) => ConvertResult { text: Some(text), error: None },
        Err(e) => ConvertResult { error: Some(e), ..Default::default() },
    };
    to_js_value(&result)
}

/// カテゴリの単位トークンを並び順で返す。**盤面はこの順に並べる。**
#[wasm_bindgen]
pub fn convert_units(category: &str) -> JsValue { /* 同型 */ }
```

- [ ] **Step 4: wasm のテストを書く**

`crates/calcarc-wasm/tests/`（`#[wasm_bindgen_test]` の既存ファイルに倣う）:

```rust
#[wasm_bindgen_test]
fn a_conversion_crosses_the_boundary_as_text() {
    let value = convert("100", "length", "km", "mi");
    // 例外を投げず、text が入っていること
}

#[wasm_bindgen_test]
fn an_unknown_unit_is_an_error_in_the_return_value_not_an_exception() {
    let value = convert("1", "length", "km", "furlong");
    // error が "SyntaxError"、text が null
}

#[wasm_bindgen_test]
fn the_unit_list_comes_back_in_the_order_the_panel_shows() {
    let value = convert_units("length");
    // 11 件、先頭が "nm"、末尾が "nmi"
}
```

- [ ] **Step 5: 走らせる**

```bash
cargo test -p calcarc-wasm --test token_parity
cargo clippy --workspace --all-targets -- -D warnings
wasm-pack test --headless --firefox crates/calcarc-wasm
```
**手元は firefox、CI は chrome である**（同じコードを別のブラウザで見ている）。

- [ ] **Step 6: 赤確認（実出力を報告に貼る）**

1. **`web/src/convert/types.ts` の `"degf"` を `"degF"` に。** → `convert_unit_tokens_match…` が赤。
   **これが赤くならなければ、マーカー文字列が配列を掴めていない**（`tokens_in_ts_array` は
   宣言の先頭からの完全一致で探す）
2. **`Unit::ALL` の並びを 2 つ入れ替える。** → 同じテストが赤（順序も契約である）

- [ ] **Step 7: コミット**

```bash
cargo fmt --all && git add crates/calcarc-wasm web/src/convert/types.ts
git commit   # 例: "Send a conversion across the boundary without throwing"
```

---

### Task 9: TS のラッパと、ルーティングに `#convert/length` を足す

**Files:**
- Create: `web/src/convert/index.ts`
- Create: `web/src/convert/entry.ts`
- Modify: `web/src/route.ts`
- Modify: `web/src/route.test.ts`
- Modify: `web/src/ui/Nav/Nav.tsx`（`#convert` → `#convert/length`）
- Modify: `web/src/App.tsx`（`<ConvertPanel category={route.category} />`）

**Interfaces:**
- Consumes: Task 8 の `convert` / `convert_units`、Task 8 の `web/src/convert/types.ts`
- Produces:
  - `ConvertCalc { convert(value, category, from, to): ConvertResult; units(category): string[] }`、`initConvert(): Promise<ConvertCalc>`
  - `CONVERT_CATEGORIES: readonly ConvertCategoryToken[]`（`route.ts` から export）
- Task 11 の `UnitPanel` が両方を使う

**`web/src/calc/` に React を import しない**（規約）。`web/src/convert/` も同じ扱いにする。

**いま在るもの**（実測）:
- `route.ts:29-34` の `CATEGORIES` は `convert: []`、`:37-42` の `DEFAULT_CATEGORY` は `convert: null`
- `route.ts:7-8` の冒頭コメントが「**U-1 が `#convert/length` を足すときに、ここの構造は変わらず、下の表に行が増えるだけになる**」と予告している
- `Nav.test.tsx:69-100` の round-trip テストが「**convert に既定カテゴリが付いた瞬間、`href: "#convert"` は違反になる。そのとき赤くなるのはここだけである**」と書いている

- [ ] **Step 1: 失敗するテストを書く**

`web/src/route.test.ts` に追記。**U-0 から持ち越した検査がここで埋まる**（spec §6）:

```ts
it("keeps convert's own categories, which are not the default one", () => {
  // **U-0 の時点では CATEGORIES と DEFAULT_CATEGORY を区別できなかった**
  // ——scale の唯一のカテゴリが既定値と同じ値だったので、CATEGORIES を空に
  // しても振る舞いが 1 つも変わらなかった(U-1 spec §6)。
  // **`#convert/mass` は既定(`length`)とは違う値なので、ここで穴が埋まる。**
  expect(routeFromHash("#convert/mass")).toEqual({ module: "convert", category: "mass" });
  expect(routeFromHash("#convert/temperature")).toEqual({
    module: "convert",
    category: "temperature",
  });
});

it("falls back to length when the category is unknown", () => {
  expect(routeFromHash("#convert/furlong")).toEqual({ module: "convert", category: "length" });
  expect(routeFromHash("#convert")).toEqual({ module: "convert", category: "length" });
});
```

- [ ] **Step 2: 走らせて落ちることを見る**

```bash
cd web && pnpm test route
```

- [ ] **Step 3: 実装する**

`route.ts`:
```ts
export const CONVERT_CATEGORIES = ["length", "mass", "temperature"] as const;
export type ConvertCategory = (typeof CONVERT_CATEGORIES)[number];
```
`CATEGORIES.convert` を `CONVERT_CATEGORIES` に、`DEFAULT_CATEGORY.convert` を `"length"` に。

`Nav.tsx` の `href="#convert"` を `href="#convert/length"` に。**round-trip テストが守っている**
（`Nav.test.tsx:77-100`）。

`App.tsx` の `<ConvertPanel />` を `<ConvertPanel category={route.category} />` に。

`web/src/convert/index.ts` は **`web/src/datascale/index.ts:72-111` の `ready ??=` メモ化パターンを写す**
（キャッシュに失敗したら `ready = null; throw cause;` まで含めて同じ形にすること——
初期化に一度失敗したあと二度と回復しない罠を、既に一度潰してある）。

`web/src/convert/entry.ts` は `web/src/datascale/entry.ts:11-29` と同じ再輸出
（`units/entry.ts` の `Entry` / `pushDigit` / `pushOperator` / `backspace` / `EMPTY` / `isEmpty`）。
**値は式で打てる**（spec §4.3）ので、演算子と括弧も再輸出する。

- [ ] **Step 4: 走らせて通ることを見る**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
```
**`Nav.test.tsx` の round-trip が赤くなっていないこと**を確かめる（`#convert` のままだと赤い）。

- [ ] **Step 5: 赤確認（spec §6 が名指しした 1 件。実出力を報告に貼る）**

**`route.ts` の `CATEGORIES.convert` を `[]` に戻す。**
→ `keeps convert's own categories…` が赤になること。
**これが赤くならなければ、2 つの表（`CATEGORIES` と `DEFAULT_CATEGORY`）を持つ意味が
誰にも守られていない**——U-0 から持ち越した債務は、まだ埋まっていない。

- [ ] **Step 6: コミット**

```bash
git add web/src
git commit   # 例: "Give convert a category that is not the default"
```

---

### Task 10: キー集合（`Keypad/convert.ts`）

**Files:**
- Create: `web/src/ui/Keypad/convert.ts`
- Create: `web/src/ui/Keypad/convert.test.ts`

**Interfaces:**
- Consumes: `web/src/ui/Keypad/types.ts` の `KeyDef<T>` / `KeypadSection<T>`、Task 8 の `CONVERT_UNIT_TOKENS`
- Produces: `ConvertKeyToken`、`CONVERT_SECTIONS`（数字面）、`unitSections(category)`（単位面）、`UNIT_LABELS`、`CATEGORY_LABELS`
- Task 11 の `UnitPanel` が使う

**`ConvertKeyToken` は Convert パネル固有の型で、Scientific の `KEY_TOKENS` とは別物である**（spec §6）。

**先例は `web/src/ui/Keypad/dataScale.ts`。** 枠の規律をそのまま踏襲する:
- **数字面も単位面も同じ 5 列 × 5 行**（`columns: 5`、`height: "square"`）
- **DEL と AC は全ての面で同じ位置**（1 行目の 4 列目・5 列目）
- 余ったセルは恒久の予約スロット `{ token: null, label: "—", ariaLabel: "空き", variant: "function" }`
- 項目行は `columns: 4`、`height: "half"`

**項目は 4 つ**（spec §4.1）: 値 / 変換元 / 変換先 / ⇅。

**【S-0 の教訓】テストのボタン名は、キー集合が実際に出している `ariaLabel` である。**
`getByRole("button", { name })` が見るのは**アクセシブルネーム**であって画面のラベルではない。
**キー定義（`ariaLabel`）を先に決めてからテストを書く。**

**【S-0 の教訓】既定値のある項目を手入力に切り替えたときの挙動を決めておく。**
Convert の値の欄は**空から始まる**ので継ぎ足し事故は起きないが、**⇅ を押したときに
値をどうするかは決まっている**——spec §4.2 が「**入力値はそのまま残す**」と書いている。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from "vitest";
import { CONVERT_UNIT_TOKENS } from "../../convert/types";
import { CONVERT_SECTIONS, UNIT_LABELS, unitSections } from "./convert";

describe("Convert のキー集合", () => {
  it("names every unit of every category exactly once", () => {
    // **ラベル・読み上げ・トークンを手で 3 つ並べない。** いつか 1 つだけずれる。
    let seen = 0;
    for (const category of ["length", "mass", "temperature"] as const) {
      const keys = unitSections(category)[1].keys.filter((k) => k.token !== null);
      for (const key of keys) {
        expect(CONVERT_UNIT_TOKENS).toContain(key.token?.replace("unit:", ""));
        seen += 1;
      }
    }
    expect(seen).toBe(CONVERT_UNIT_TOKENS.length); // 21。1 つも余らず、1 つも欠けない
  });

  it("puts DEL and AC in the same place on every face", () => {
    // **枠が動かないことは E2E が見る。** ここで見るのは定義の位置である。
    const faces = [
      CONVERT_SECTIONS[1],
      unitSections("length")[1],
      unitSections("mass")[1],
      unitSections("temperature")[1],
    ];
    let checked = 0;
    for (const face of faces) {
      expect(face.columns).toBe(5);
      expect(face.keys[3]?.token).toBe("del");
      expect(face.keys[4]?.token).toBe("ac");
      checked += 1;
    }
    expect(checked).toBe(4);
  });

  it("spells the degree signs in the label, not in the token", () => {
    // **トークンは ASCII の小文字**（計画の裁定 1）。記号はラベルだけが持つ。
    expect(UNIT_LABELS.degc).toBe("°C");
    expect(UNIT_LABELS.degf).toBe("°F");
    expect(UNIT_LABELS.um).toBe("µm");
    expect(UNIT_LABELS.k).toBe("K");
  });

  it("offers the four fields the spec asks for", () => {
    const fields = CONVERT_SECTIONS[0];
    expect(fields.columns).toBe(4);
    expect(fields.keys.map((k) => k.token)).toEqual([
      "field:value",
      "field:from",
      "field:to",
      "swap",
    ]);
  });

  it("lets the value be an expression", () => {
    // spec §4.3: `5*12` と打って inch を選べば 60 inch。
    const tokens = CONVERT_SECTIONS[1].keys.map((k) => k.token);
    for (const op of ["add", "sub", "mul", "div", "lparen", "rparen", "eq"]) {
      expect(tokens).toContain(op);
    }
  });
});
```

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

`dataScale.ts` の `PAD` を骨格に、`K`/`M`/`G` を予約スロットに置き換える
（**単位は別の項目が持つ**ので、値の欄に単位の接尾辞は要らない。S-0 の Transfer と同じ判断）。
単位面は `dataScale.ts:135-208` の `TYPES` と同じ組み方（3 列ぶんに単位、4・5 列目に DEL/AC、残りは予約）。

**`unitSections(category)` は `CONVERT_UNIT_TOKENS` から `.map` で起こすこと**——手で並べない。

- [ ] **Step 5: コミット**

```bash
cd web && pnpm test convert && pnpm typecheck && pnpm lint
git add web/src/ui/Keypad
git commit   # 例: "Lay out the units on the same five by five frame"
```

---

### Task 11: Convert パネル（器と盤面）

**Files:**
- Modify: `web/src/ui/Convert/ConvertPanel.tsx`（準備中を**器**に置き換え）
- Modify: `web/src/ui/Convert/ConvertPanel.module.css`
- Modify: `web/src/ui/Convert/ConvertPanel.test.tsx`
- Create: `web/src/ui/Convert/UnitPanel.tsx`
- Create: `web/src/ui/Convert/UnitPanel.module.css`
- Create: `web/src/ui/Convert/UnitPanel.test.tsx`

**Interfaces:**
- Consumes: Task 9 の `initConvert` / `CONVERT_CATEGORIES`、Task 10 のキー集合
- Produces: `<section aria-label="単位変換">`（`UnitPanel`）と、その中の `data-testid="convert-result"`

**器は `web/src/ui/Scale/ScalePanel.tsx:19-47` と同じ形**（`<select aria-label="計算の種類">` で
`window.location.hash = "#convert/${id}"` を書く）。**行を増やさない**（縦の予算。S-0 で 1 行増えた分が
既に効いている）。

**盤面は `UnitPanel` 1 つを 3 カテゴリで共有する**（File Structure の理由）。カテゴリは prop で渡す。

**消えるもの**: `aria-label="単位変換（準備中）"` の `<section>`、`単位変換は準備中です。` の `<p>`、
`.heading` / `.detail` の CSS、`ConvertPanel.test.tsx` の 2 本、`web/tests/e2e/convert-placeholder.spec.ts` の
準備中の 2 本。**`convert-placeholder.spec.ts:39-47` の「`#data-scale` は Scientific に落ちる」は
Convert と無関係なので、消さずに `web/tests/e2e/scale-categories.spec.ts` へ移す。**

**⇅ の先例は無い**（実測。`DataScalePanel` にも `dataScale.ts` にも 2 つの選択を入れ替えるものは無い）。
**新規実装である。** 罠は 1 つ:

```tsx
// **これは正しい**（React の setState は次の描画で反映されるので、両方が古い値を読む）
setFrom(to);
setTo(from);
// **これは壊れる**（`from` を更新したつもりの値を、同じ描画の中で読み直そうとする形）
```
**値はそのまま残す**（spec §4.2）。

- [ ] **Step 1: 失敗するテストを書く**

`UnitPanel.test.tsx`（`web/src/ui/Transfer/TransferPanel.test.tsx` のモックの形に倣う。
**モックは wasm の配線を確かめるスタブであって golden の代わりではない**——換算の正しさは
`convert_golden.rs` が持つ）:

```tsx
it("converts a hundred kilometres into miles", async () => { /* headline */ });

it("hands the core the lowercase tokens, not the labels", () => {
  // 画面は `°C`、境界へ渡るのは `degc`（計画の裁定 1）
});

it("swaps the two units and keeps the value", async () => {
  // spec §4.2。**⇅ は入力値を残す。**
});

it("lets the value be an expression", async () => {
  // spec §4.3: `5*12` を打って inch を選ぶ
});

it("shows an error instead of a number when the units do not match", async () => {});

it("says nothing until a value is typed", async () => {});

it("AC empties the value and puts the units back to their defaults", async () => {});

it("names every unit key of the category it is showing", () => {
  // 件数を `toBe` で固定する（0 件でも緑になる形を作らない）
});
```

`ConvertPanel.test.tsx`（器）:

```tsx
it("shows the panel for the category in the route", () => {});
it("falls back to length when the category is unknown", () => {});
it("moves the hash when the select changes", () => {});
it("no longer says 準備中", () => {
  expect(screen.queryByText(/準備中/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

既定の単位は **`km` → `mi`**（length）、**`kg` → `lb`**（mass）、**`degc` → `degf`**（temperature）。
**なぜ**: どれも「日本の単位からヤード・ポンドへ」で、換算器を開く動機のいちばん多い向きである。
spec は既定を決めていない——**決めたことを報告に書くこと**（間違えたときの代償: 使い始めに毎回 2 回押す）。

- [ ] **Step 5: 「準備中」が Convert 側に 1 つも残らないことを確かめる**

```bash
grep -rn 準備中 web/src/ui/Convert web/tests/e2e/convert-placeholder.spec.ts
```
**空になること。** 残るのは Scientific の第 2 面だけである（別件）。

- [ ] **Step 6: コミット**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
git add web
git commit   # 例: "A hundred kilometres is 62.13711922 miles"
```

---

### Task 12: E2E、実測、撮影、フルスイープ

**Files:**
- Create: `web/tests/e2e/convert.spec.ts`
- Modify: `web/tests/e2e/convert-placeholder.spec.ts`（準備中の 2 本を削除。ファイルごと消えるなら消す）
- Modify: `web/tests/e2e/scale-categories.spec.ts`（`#data-scale` の 1 本を受け取る）
- Modify: `docs/definition-of-done.md`（縦の表に Convert の行）
- Modify: `docs/superpowers/specs/2026-08-19-unit-engine-design.md`（§6 に【実測】を追記）

- [ ] **Step 1: E2E を書く**

**`web/tests/e2e/data-scale-keypad.spec.ts:25-51` と `:62-94` の 2 本を移植する**
（44px と「枠が動かない」）。面は **3 つ**（数字面・変換元の単位面・変換先の単位面）。

**【S-0 の教訓】番兵を置く。** 計測できなかったときに `-1` が 1 通りに揃って
**緑のまま通る**——`box` / `del` / `ac` の**3 つとも**番兵を書くこと（S-0 では `ac` が 1 行落ちていた）。

**【S-0 の教訓】件数の下限を主張する。** ループが 0 回でも緑になる形を作らない。

深いリンクは 3 件（`#convert/length` `#convert/mass` `#convert/temperature`）。
`scale-categories.spec.ts:6-22` の形をそのまま使う。

さらに 1 本: **単位面の 44px**（spec §6 の「撮る」が名指ししている。⇅ も 44px あること）。

- [ ] **Step 2: 走らせる**

```bash
cd web && pnpm e2e convert.spec.ts scale-categories.spec.ts
```
**終わったら preview の港を確かめる**（`ss -ltn | grep -E '417[0-9]|418[0-9]'` が空）。

- [ ] **Step 3: 縦を測る**

**4179 と 4173 を使わない**（E2E が `--strictPort` で掴む）。

```bash
cd web && pnpm wasm && pnpm build
cd web && pnpm preview --port 4180 --strictPort &
```
`document.documentElement.scrollHeight - window.innerHeight` を
`#convert/length` `#convert/mass` `#convert/temperature` × 390×844 と 360×640 で。

**パネルが出てから測る。** 待たずに測ると空のページを測って 0 になる——
**S-0 で実際に対照を採り、6 route すべてが 0 かつ `body.innerText` が空文字になることを確かめてある。**
`viewport-budget.spec.ts` の `waitForPanel` と同じ待ち方をすること。

- [ ] **Step 4: 撮る**

3 カテゴリ × 2 画面幅。加えて**単位面**（11 キーの length と 3 キーの temperature）。
**目で見るのは 2 点**（spec §6）: **単位面が枠に収まっているか**、**⇅ が押せる大きさか**。
**撮ったら preview を落とす**（港の再利用事故）。**スクリーンショットはコミットしない。**

- [ ] **Step 5: 数を書く**

`docs/definition-of-done.md` の「0.3.0 で悪化した分」の表に Convert の行を足す。
**`viewport-budget.spec.ts` の `TABS` は `#convert` を巡回している**（Scale と違って
カテゴリ無しの代表が既に在る）——**ただし `#convert/length` に既定が付いた後もそれで足りるか**を
確かめて、足りなければそう書くこと。**緑を「収まっている」と読ませない。**

spec §6 の末尾に【実測 YYYY-MM-DD】として同じ数と、目で見た 2 点の結果を残す。

- [ ] **Step 6: 全部回す（ブランチ末尾の 1 回）**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
wasm-pack test --headless --firefox crates/calcarc-wasm
cd reference && uv run --no-config pytest
cd reference && uv run --no-config python scripts/generate.py && cd .. && git diff --exit-code testdata/
cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e
```
**`git diff --exit-code testdata/` が肝である**——golden が生成物と一致していることを CI と同じやり方で確かめる。
完了記録に **「ローカル wasm = Firefox / CI = Chrome」** の 1 行を必ず入れる。

- [ ] **Step 7: コミット**

```bash
git add web/tests docs
git commit   # 例: "Measure what the converter costs, and write it down"
```

---

## Self-Review（計画作成時に実施済み）

**1. spec の網羅**

| spec の節 | どのタスク |
|---|---|
| §0.0-1 誤差を入れない | Task 1・5（`Fraction` / `Rational`。f64 を経由しない）、Task 7（往復が厳密に戻る golden） |
| §0.0-2 参照を移植にしない | Task 1・2 の冒頭に「Rust を開かない」を明記 |
| §0.0-3 `KEY_TOKENS` と `engine_table.rs` を触らない | 全タスクの Files に登場しない。Task 10 が `ConvertKeyToken` を別型で作る |
| §0.0-4 既存 WASM 署名を変えない | Task 8（**追加のみ**） |
| §0.0-5 N × N を持たない | Task 5（`to_base` / `from_base` の 2 段）、Task 7 の赤確認 5（**数で守れないと明記**） |
| §0.0-6 温度は点 | Task 1 の `test_temperature_converts_points_not_differences`、Task 5 |
| §1-1 厳密有理数 | Task 4・5 |
| §1-2 パネルは電卓に揃える | Task 10・11 |
| §3.1 アフィン 1 本 | Task 1・5 |
| §3.2 定義値の表 | Task 1・5（両方が spec の表から独立に書く） |
| §3.3 表示 | Task 2・6（**規則は共有、実装は別**）、Task 7 の赤確認 4 |
| §3.4 温度は点 | Task 1・5 |
| §3.5 あふれと定義域・負値・絶対零度以下 | Task 5（`a_ratio_too_wide_for_i128…`、`below_absolute_zero_is_not_stopped`）、計画の裁定 2 |
| §4.1 パネル | Task 10・11 |
| §4.2 カテゴリ 3 つ | Task 9（route）、Task 11（器） |
| §4.3 値は式で打てる | Task 4、Task 10 の `lets the value be an expression`、Task 11 |
| §5 WASM 境界・トークンの一致検査 | Task 8 |
| §6 golden の名指しケース | Task 3（**表を 1 行ずつ写した**） |
| §6 U-0 から持ち越した検査 | Task 9 の Step 5（**赤確認つき**） |
| §6 赤確認 1〜5 | Task 5（1〜3）、Task 6（4）、Task 7（通しで 5 件） |
| §6 段付け・撮る | Task 12 |
| §7 スコープ外 | どのタスクにも登場しない（温度差・絶対零度の制限・U-2 のカテゴリ・通貨・畳・URL state・Favorite） |

**2. 埋めていない穴（この計画が自分で決めたこと。実装者は変えてよいが、変えたら報告に書くこと）**

- **裁定 1**: トークンは ASCII 小文字（`um` `k` `degc` `degf`）。ラベルが記号を持つ
- **裁定 2**: 単項マイナスは `convert` の入口が 1 つだけ剥がす。`parse.rs` は触らない
- **既定の単位**（Task 11）: `km→mi` / `kg→lb` / `degc→degf`
- **`UnitPanel` を 3 カテゴリで共有する**（パネルを 3 つ作らない）
- **golden の `value` は 10 進リテラルに限る**（式は expr の検査が持つ）

**3. 型の一貫性**（後のタスクが前のタスクの名前を使えているか）

`Category` / `Unit` / `to_base` / `from_base` / `convert` / `format_rational`（Rust）、
`convert_value` / `format_rational` / `compute` / `CATEGORIES`（Python）、
`CONVERT_UNIT_TOKENS` / `CONVERT_CATEGORY_TOKENS` / `CONVERT_CATEGORIES` / `ConvertCalc` /
`initConvert` / `CONVERT_SECTIONS` / `unitSections` / `UNIT_LABELS`（TS）——
Task 5 → 6 → 7 → 8 → 9 → 10 → 11 の消費側で綴りが一致していることを確認した。

**注意**: Python の `format_rational` と Rust の `format_rational` は**同名の別実装**である。
**これは意図である**（同じ規則の 2 つの独立実装）。片方を見ながらもう片方を書かないこと。
