# 関数と定数を増やす（段階 3b-A）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未押下の 23 キーのうち 13 個（`pow` `ln` `log10` `exp_e` `recip` `asin` `acos` `atan` `n_fact` `n_p_r` `n_c_r` `pi` `e`）を、新しい 3 枚のシャードで押す。

**Architecture:** 既存の式木モジュールに**定数ノードと新しい関数名を足す**（既存の `UNARY_FNS` / `BINARY_OPS` タプルには触らない——触ると乱数の消費列が変わって既存 6000 件が総入れ替えになる）。系統ごとに独立した生成器と `random.Random(seed)` を持つ 3 枚のシャードを足す。定義域の判定は Python が mpmath と Python の厳密な整数で独立に行い、`crates/calcarc-core/src/scientific/mod.rs` の判定を写さない。

**Tech Stack:** Python 3（mpmath 50 dps、`math.factorial` / `math.perm` / `math.comb` の厳密整数）、TypeScript（Playwright の heavy スイート）。

**Spec:** [docs/superpowers/specs/2026-08-16-corpus-functions-design.md](../specs/2026-08-16-corpus-functions-design.md)（要件 R1〜R13）

## Global Constraints

- **`corpus_expr.py` の `BINARY_OPS` と `UNARY_FNS` の 2 つのタプルを変更しない。** 要素を足しても順序を変えてもいけない。既存 3 枚のシャードの乱数の土台であり、変えると `corpus/generated/*.json` が総入れ替えになる（設計書 §3.1）
- **`corpus/generated/scientific-000.json` / `equivalence-000.json` / `precedence-000.json` の 3 ファイルを変更しない。** 作業後に `git diff --stat <base> HEAD -- corpus/generated/scientific-000.json corpus/generated/equivalence-000.json corpus/generated/precedence-000.json` が空であること
- **許容誤差をテストコードに書かない**（CLAUDE.md）。`TOLERANCE = {"abs": 5e-10, "rel": 5e-10}` は `generate_corpus.py` の既存の定数をそのまま使い、**値を変えない**
- **`crates/` と `web/src/` を変更しない。** この計画は `reference/` と `web/tests/heavy/` と `docs/` だけを触る
- **`uv` は必ず `--no-config` を付ける。** `UV_NO_CONFIG=1 uv run --no-config pytest`。付けないと `uv.lock` が書き換わり CI の `uv sync --locked` が落ちる
- **`scientific/mod.rs` の定義域判定を写さない**（設計書 R3）。書いてよいのは**数学的な定義域**（「対数の引数は正」）であって、実装の分岐ではない
- コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **`git push` と PR 作成を行わない**

## ファイル構成

| ファイル | 役割 | 本計画での扱い |
|---|---|---|
| `reference/src/calcarc_reference/corpus_expr.py` | 式木と 2 つの直列化。計算しない | Task 1 で定数ノードと新しい関数名を足す |
| `reference/src/calcarc_reference/corpus_eval.py` | mpmath による評価。キー列を見ない | Task 2 で新しい関数を足す |
| `reference/scripts/generate_corpus.py` | シャードの生成 | Task 3〜5 で系統別の生成器を足す |
| `reference/tests/test_corpus_expr.py` | 直列化のテスト | Task 1 |
| `reference/tests/test_corpus_eval.py` | 評価のテスト | Task 2 |
| `reference/tests/test_generate_corpus.py` | 生成器のテスト | Task 3〜5 |
| `corpus/generated/elementary-000.json` | 新シャード | Task 3 で生成 |
| `corpus/generated/inverse-trig-000.json` | 新シャード | Task 4 で生成 |
| `corpus/generated/combinatorics-000.json` | 新シャード | Task 5 で生成 |
| `web/tests/heavy/report.ts` | 成果物のレポート | Task 6 で指数表記と右結合の項目を足す |
| `web/tests/heavy/corpus.spec.ts` | シャードごとの照合と集計 | Task 6 で指数表記の件数を数える |
| `docs/corpus-measurements.md` | 実測の記録 | Task 7 |

---

### Task 1: 式木に定数ノードと新しい関数名を足す

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_expr.py`
- Test: `reference/tests/test_corpus_expr.py`

**Interfaces:**
- Consumes: 既存の `Num` / `Bin` / `Un` / `Node` / `to_keys` / `to_expr_text` / `walk`
- Produces:
  - `class Const` — `Const(name: str)`、`name` は `"pi"` か `"e"`
  - `Node = Num | Const | Bin | Un`（union を拡張）
  - `CONST_NAMES = ("pi", "e")`
  - `ELEMENTARY_FNS = ("ln", "log10", "exp_e", "recip")`
  - `ELEMENTARY_BINS = ("^",)`
  - `INVERSE_TRIG_FNS = ("asin", "acos", "atan")`
  - `COMBINATORICS_FNS = ("fact",)`
  - `COMBINATORICS_BINS = ("nPr", "nCr")`
  - `to_keys` / `to_expr_text` / `walk` / `to_keys_minimal` が `Const` と新しい演算子を扱う

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_expr.py` の末尾に追加:

```python
from calcarc_reference.corpus_expr import (
    Bin,
    Const,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    to_keys,
    walk,
)


def test_a_constant_is_one_key_press() -> None:
    assert to_keys(Const("pi")) == ["pi"]
    assert to_keys(Const("e")) == ["e"]


def test_a_constant_reads_as_itself() -> None:
    assert to_expr_text(Const("pi")) == "pi"
    assert to_expr_text(Const("e")) == "e"


def test_an_unknown_constant_is_refused_loudly() -> None:
    # 未知の名前を通すと、キー列に存在しないトークンが載って
    # ブラウザ側で黙って読み飛ばされ、別の式が計算される。
    import pytest

    with pytest.raises(ValueError):
        to_keys(Const("tau"))
    with pytest.raises(ValueError):
        to_expr_text(Const("tau"))


def test_a_constant_is_a_leaf_when_walking() -> None:
    assert list(walk(Const("pi"))) == [Const("pi")]


def test_the_new_unary_functions_use_the_key_tokens_the_browser_knows() -> None:
    # 綴りは web/src/calc/types.ts の KEY_TOKENS が正。
    # `fact` だけ式木の名前とキーの綴りが違う（キーは `n_fact`）。
    assert to_keys(Un("ln", Num(5))) == ["5", "ln"]
    assert to_keys(Un("log10", Num(5))) == ["5", "log10"]
    assert to_keys(Un("exp_e", Num(5))) == ["5", "exp_e"]
    assert to_keys(Un("recip", Num(5))) == ["5", "recip"]
    assert to_keys(Un("asin", Num(0))) == ["0", "asin"]
    assert to_keys(Un("acos", Num(0))) == ["0", "acos"]
    assert to_keys(Un("atan", Num(0))) == ["0", "atan"]
    assert to_keys(Un("fact", Num(5))) == ["5", "n_fact"]


def test_the_new_binary_operators_use_the_key_tokens_the_browser_knows() -> None:
    assert to_keys(Bin("^", Num(2), Num(3))) == [
        "lparen", "2", "pow", "3", "rparen",
    ]
    assert to_keys(Bin("nPr", Num(5), Num(2))) == [
        "lparen", "5", "n_p_r", "2", "rparen",
    ]
    assert to_keys(Bin("nCr", Num(5), Num(2))) == [
        "lparen", "5", "n_c_r", "2", "rparen",
    ]


def test_the_new_operators_read_as_mathematics() -> None:
    assert to_expr_text(Bin("^", Num(2), Num(3))) == "(2 ^ 3)"
    assert to_expr_text(Un("fact", Num(5))) == "(5)!"
    assert to_expr_text(Un("ln", Num(5))) == "ln(5)"
    assert to_expr_text(Un("recip", Num(5))) == "1/(5)"
    # 逆三角関数は結果が度である。それを式そのものに書く——
    # sin が rad(...) と書いているのと対称。
    assert to_expr_text(Un("asin", Num(1))) == "deg(asin(1))"


def test_a_constant_inside_a_bigger_tree() -> None:
    tree = Bin("*", Const("pi"), Num(2))
    assert to_key_sequence(tree) == ["lparen", "pi", "mul", "2", "rparen", "eq"]
    assert to_expr_text(tree) == "(pi * 2)"
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_corpus_expr.py -q
```

Expected: FAIL — `ImportError: cannot import name 'Const'`。

- [ ] **Step 3: `Const` と新しい綴りを足す**

`reference/src/calcarc_reference/corpus_expr.py` を編集する。

**`BINARY_KEYS` と `UNARY_KEYS` に追記する（既存の項目は 1 つも変えない）:**

```python
BINARY_KEYS = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    # 段階 3b-A で追加。**綴りは web/src/calc/types.ts の KEY_TOKENS が正。**
    "^": "pow",
    "nPr": "n_p_r",
    "nCr": "n_c_r",
}
UNARY_KEYS = {
    "sqrt": "sqrt",
    "sqr": "sqr",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "neg": "neg",
    # 段階 3b-A で追加。`fact` だけ式木の名前とキーの綴りが違う。
    "ln": "ln",
    "log10": "log10",
    "exp_e": "exp_e",
    "recip": "recip",
    "asin": "asin",
    "acos": "acos",
    "atan": "atan",
    "fact": "n_fact",
}

# **定数のキー。1 打鍵で値が入る。**
CONST_KEYS = {"pi": "pi", "e": "e"}
CONST_NAMES = ("pi", "e")
```

**`BINARY_OPS` と `UNARY_FNS` は 1 文字も変えない。** その下に系統別のタプルを新設する:

```python
# **既存の BINARY_OPS / UNARY_FNS は乱数の土台なので触らない**(設計書 §3.1)。
# 系統ごとの選択肢はここに別に置く。
ELEMENTARY_FNS = ("ln", "log10", "exp_e", "recip")
ELEMENTARY_BINS = ("^",)
INVERSE_TRIG_FNS = ("asin", "acos", "atan")
COMBINATORICS_FNS = ("fact",)
COMBINATORICS_BINS = ("nPr", "nCr")
```

**`Const` を足し、`Node` を広げる:**

```python
@dataclass(frozen=True)
class Const:
    """1 打鍵で入る定数。`pi` と `e` の 2 つだけ。

    **現行のオペランドはすべて整数リテラルなので、これを入れるまで
    `current` に有理でない値が入ることが一度も起きていない**(設計書 §3.4)。
    """

    name: str


Node = Num | Const | Bin | Un
```

**`walk` に `Const` を足す**（葉なので自身だけ）:

```python
def walk(node: Node) -> Iterator[Node]:
    """自身と全ての部分木。生成器が中間値の範囲を検査するために使う。"""
    yield node
    if isinstance(node, Bin):
        yield from walk(node.left)
        yield from walk(node.right)
    elif isinstance(node, Un):
        yield from walk(node.arg)
```

（`Num` と同じく `Const` は追加の分岐が要らない。既存のままでよい。上の
テスト `test_a_constant_is_a_leaf_when_walking` がそれを固定する。）

**`to_keys` に `Const` の枝を足す**（`Num` の直後）:

```python
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return [CONST_KEYS[node.name]]
```

**`to_keys_minimal` にも同じ枝を足す**（`Num` の直後）。3c のシャードは定数を
使わないが、`Const` を渡すと `node.op` に落ちて `AttributeError` になるため:

```python
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return [CONST_KEYS[node.name]]
```

**`BINARY_PRECEDENCE` は変更しない。** `^` / `nPr` / `nCr` を足さないので、
`to_keys_minimal` にこれらを渡すと既存の `ValueError` で大きな声で落ちる。
**それが正しい**——3c の直列化はこれらを扱わないと宣言している（設計書 §3.5）。

**`to_expr_text` に `Const` と新しい関数を足す:**

```python
def to_expr_text(node: Node) -> str:
    if isinstance(node, Num):
        return str(node.value)
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return node.name
    if isinstance(node, Un):
        inner = to_expr_text(node.arg)
        if node.fn == "sqr":
            return f"({inner})^2"
        if node.fn == "neg":
            return f"-({inner})"
        if node.fn in ("sin", "cos", "tan"):
            # 角度が度であることを数式そのものに書く。読み違えを防ぐ。
            return f"{node.fn}(rad({inner}))"
        if node.fn == "sqrt":
            return f"sqrt({inner})"
        if node.fn in ("ln", "log10", "exp_e"):
            return f"{node.fn}({inner})"
        if node.fn == "recip":
            return f"1/({inner})"
        if node.fn in ("asin", "acos", "atan"):
            # **結果が度である。** sin が引数側に rad(...) を書くのと対称に、
            # 逆関数は結果側に deg(...) を書く(設計書 §3.3)。
            return f"deg({node.fn}({inner}))"
        if node.fn == "fact":
            return f"({inner})!"
        raise ValueError(f"unknown unary fn: {node.fn!r}")
    if node.op not in BINARY_KEYS:
        raise ValueError(f"unknown binary op: {node.op!r}")
    return f"({to_expr_text(node.left)} {node.op} {to_expr_text(node.right)})"
```

- [ ] **Step 4: テストを通す**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_corpus_expr.py -q
```

Expected: PASS。

- [ ] **Step 5: 既存シャードが 1 バイトも動いていないことを確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd .. && git status --porcelain corpus/generated/
```

Expected: **空**。既存タプルを触っていないので乱数の消費列は変わらない。
**空でなければ Step 3 でタプルを触っている。** 差分を捨てて `BINARY_OPS` /
`UNARY_FNS` の定義行を `git diff` で確かめること。

- [ ] **Step 6: 参照スイート全体と整形**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format . && UV_NO_CONFIG=1 uv run --no-config ruff check .
```

Expected: 全 PASS、`ruff check` が `All checks passed!`。
**`ruff format` は `--check` ではなく実際に整形する。** CI は
`ruff format --check` で落ちるが、それは直してくれない。

- [ ] **Step 7: コミット**

```bash
git add reference/src/calcarc_reference/corpus_expr.py reference/tests/test_corpus_expr.py
git commit -m "$(cat <<'EOF'
Teach the tree the constants and the new functions

BINARY_OPS と UNARY_FNS の 2 つのタプルは触っていない。あれは乱数の
土台なので、要素が増えると既存 6000 件が総入れ替えになる。系統ごとの
選択肢は別のタプルに置いた。

逆三角関数は結果が度なので、式のテキストに deg(...) と書く。sin が
引数側に rad(...) と書いているのと対称である。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 評価経路に新しい関数を足す

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_eval.py`
- Test: `reference/tests/test_corpus_eval.py`

**Interfaces:**
- Consumes: Task 1 の `Const` / `ELEMENTARY_FNS` / `INVERSE_TRIG_FNS` / `COMBINATORICS_FNS` / `ELEMENTARY_BINS` / `COMBINATORICS_BINS`
- Produces: `evaluate(node) -> mp.mpf` が定数と新しい関数を扱う。定義域外は `OutOfShard`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_eval.py` の末尾に追加:

```python
import math

import mpmath as mp
import pytest

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import Bin, Const, Num, Un


def test_constants_are_the_mpmath_ones() -> None:
    assert evaluate(Const("pi")) == mp.pi
    assert evaluate(Const("e")) == mp.e


def test_an_unknown_constant_is_refused_loudly() -> None:
    with pytest.raises(ValueError):
        evaluate(Const("tau"))


def test_logarithms_need_a_positive_argument() -> None:
    assert evaluate(Un("ln", Num(1))) == 0
    with pytest.raises(OutOfShard):
        evaluate(Un("ln", Num(0)))
    with pytest.raises(OutOfShard):
        evaluate(Un("ln", Un("neg", Num(5))))
    with pytest.raises(OutOfShard):
        evaluate(Un("log10", Num(0)))


def test_reciprocal_of_zero_is_out_of_shard() -> None:
    assert evaluate(Un("recip", Num(4))) == mp.mpf(1) / 4
    with pytest.raises(OutOfShard):
        evaluate(Un("recip", Num(0)))


def test_inverse_trig_returns_degrees() -> None:
    # asin(1) は 90 度。**ラジアンではない**——engine が AngleMode で
    # 変換して返すので、参照側も度で持つ(設計書 §3.3)。
    assert evaluate(Un("asin", Num(1))) == 90
    assert evaluate(Un("acos", Num(1))) == 0
    assert evaluate(Un("atan", Num(0))) == 0


def test_inverse_trig_needs_an_argument_in_range() -> None:
    with pytest.raises(OutOfShard):
        evaluate(Un("asin", Num(2)))
    with pytest.raises(OutOfShard):
        evaluate(Un("acos", Num(2)))
    # atan は全実数で定義される。
    assert evaluate(Un("atan", Num(1000))) != 0


def test_factorial_is_exact_and_only_on_non_negative_integers() -> None:
    # **厳密な整数で計算する。** engine は f64 で反復積を取るが、
    # こちらが同じことをすると同じ誤差が両側に入る。
    assert evaluate(Un("fact", Num(20))) == mp.mpf(math.factorial(20))
    with pytest.raises(OutOfShard):
        evaluate(Un("fact", Un("neg", Num(1))))
    with pytest.raises(OutOfShard):
        evaluate(Un("fact", Un("recip", Num(2))))  # 0.5 は整数でない


def test_permutations_and_combinations_are_exact() -> None:
    assert evaluate(Bin("nPr", Num(5), Num(2))) == 20
    assert evaluate(Bin("nCr", Num(5), Num(2))) == 10
    # **これが engine の実装が苦労する場所である。**
    # 答は収まるが、掛けてから割ると途中で f64 を溢れる。
    assert evaluate(Bin("nCr", Num(1022), Num(511))) == mp.mpf(
        math.comb(1022, 511)
    )


def test_combinations_need_non_negative_integers_with_r_at_most_n() -> None:
    with pytest.raises(OutOfShard):
        evaluate(Bin("nCr", Num(2), Num(5)))  # r > n
    with pytest.raises(OutOfShard):
        evaluate(Bin("nCr", Un("neg", Num(2)), Num(1)))


def test_power_has_a_real_value_only_sometimes() -> None:
    assert evaluate(Bin("^", Num(2), Num(3))) == 8
    assert evaluate(Bin("^", Num(0), Num(0))) == 1
    assert evaluate(Bin("^", Num(0), Num(5))) == 0
    with pytest.raises(OutOfShard):
        evaluate(Bin("^", Num(0), Un("neg", Num(1))))  # 0^(負)
    with pytest.raises(OutOfShard):
        # 底が負で指数が非整数。実数の範囲に答が無い。
        evaluate(Bin("^", Un("neg", Num(8)), Un("recip", Num(3))))


def test_an_unknown_function_is_refused_loudly() -> None:
    # mpmath がたまたま同名の関数を持っていると、無関係な値を返す。
    with pytest.raises(ValueError):
        evaluate(Un("cbrt", Num(8)))
    with pytest.raises(ValueError):
        evaluate(Bin("%", Num(5), Num(2)))
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_corpus_eval.py -q
```

Expected: FAIL — `ImportError: cannot import name 'Const'` か、`ValueError: unknown unary fn: 'ln'`。

- [ ] **Step 3: `evaluate` を広げる**

`reference/src/calcarc_reference/corpus_eval.py` を編集する。

**import と既知集合を追加:**

```python
from __future__ import annotations

import math

import mpmath as mp

from .corpus_expr import (
    BINARY_OPS,
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    CONST_KEYS,
    ELEMENTARY_BINS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_FNS,
    Bin,
    Const,
    Node,
    Num,
    Un,
)

mp.mp.dps = 50

# **未知の名前で落ちるための集合。** ここに無い fn / op を通すと、
# 下の分岐が黙って別の演算を実行するか、mpmath の同名関数に化ける。
KNOWN_UNARY_FNS = frozenset(
    UNARY_FNS + ELEMENTARY_FNS + INVERSE_TRIG_FNS + COMBINATORICS_FNS
)
KNOWN_BINARY_OPS = frozenset(BINARY_OPS + ELEMENTARY_BINS + COMBINATORICS_BINS)
```

**ヘルパを 2 つ足す**（`evaluate` の前）:

```python
def _as_non_negative_integer(value: mp.mpf, what: str) -> int:
    """**厳密な整数として取り出す。** 取り出せなければこのシャードの外。

    engine は f64 で判定しているが、こちらは Python の整数で持つ。
    同じ判定を写すのではなく、**数学的な定義域**をそのまま書いている。
    """
    if value < 0:
        raise OutOfShard(f"{what} of a negative number")
    if value != mp.floor(value):
        raise OutOfShard(f"{what} of a non-integer")
    return int(value)


def _degrees(radians: mp.mpf) -> mp.mpf:
    """逆三角関数の結果を度にする(設計書 §3.3)。"""
    return radians * 180 / mp.pi
```

**`evaluate` を書き直す**（既存の分岐は 1 つも意味を変えない）:

```python
def evaluate(node: Node) -> mp.mpf:
    if isinstance(node, Num):
        return mp.mpf(node.value)
    if isinstance(node, Const):
        if node.name not in CONST_KEYS:
            raise ValueError(f"unknown constant: {node.name!r}")
        return mp.pi if node.name == "pi" else mp.e
    if isinstance(node, Un):
        if node.fn not in KNOWN_UNARY_FNS:
            # 未知の fn を通すと、mpmath がたまたま同名の関数を持っていた
            # 場合に無関係な値を返してしまう(例: "cbrt" は mp.cbrt に化ける)。
            raise ValueError(f"unknown unary fn: {node.fn!r}")
        value = evaluate(node.arg)
        if node.fn == "sqrt":
            if value < 0:
                raise OutOfShard("sqrt of a negative number")
            return mp.sqrt(value)
        if node.fn == "sqr":
            return value * value
        if node.fn == "neg":
            return -value
        if node.fn in ("ln", "log10"):
            # 対数の引数は正。**数学の定義域であって、実装の分岐ではない。**
            if value <= 0:
                raise OutOfShard(f"{node.fn} of a non-positive number")
            return mp.log(value) if node.fn == "ln" else mp.log10(value)
        if node.fn == "exp_e":
            return mp.exp(value)
        if node.fn == "recip":
            if value == 0:
                raise OutOfShard("reciprocal of zero")
            return mp.mpf(1) / value
        if node.fn in ("asin", "acos"):
            if not (-1 <= value <= 1):
                raise OutOfShard(f"{node.fn} outside [-1, 1]")
            fn = mp.asin if node.fn == "asin" else mp.acos
            return _degrees(fn(value))
        if node.fn == "atan":
            return _degrees(mp.atan(value))
        if node.fn == "fact":
            # **厳密な整数で計算する。** engine は f64 の反復積なので、
            # 同じ形で書くと同じ誤差が両側に入る(CLAUDE.md)。
            return mp.mpf(math.factorial(_as_non_negative_integer(value, "factorial")))
        # ここに残るのは sin/cos/tan だけ。角度は度。ラジアンに直してから渡す。
        return getattr(mp, node.fn)(value * mp.pi / 180)
    if node.op not in KNOWN_BINARY_OPS:
        # 未知の op を通すと、下の節が黙って除算を実行してしまう
        # ——違う演算の名の下にそれらしい数を返す、一番静かな壊れ方。
        raise ValueError(f"unknown binary op: {node.op!r}")
    left = evaluate(node.left)
    right = evaluate(node.right)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if node.op == "^":
        return _power(left, right)
    if node.op in ("nPr", "nCr"):
        n = _as_non_negative_integer(left, node.op)
        r = _as_non_negative_integer(right, node.op)
        if r > n:
            raise OutOfShard(f"{node.op} with r greater than n")
        # **厳密な整数。** engine は f64 で段ごとに掛け割りするので、
        # こちらが同じ手順を踏むと独立性が消える。
        exact = math.perm(n, r) if node.op == "nPr" else math.comb(n, r)
        return mp.mpf(exact)
    if right == 0:
        raise OutOfShard("division by zero")
    return left / right


def _power(base: mp.mpf, exponent: mp.mpf) -> mp.mpf:
    """実数の範囲で答が一意に決まるものだけ返す。

    **これは数学の定義域であって、`scientific/mod.rs` の写しではない。**
    負の底に非整数の指数を当てると値は複素数になり、実数の電卓には答が無い。
    """
    if base == 0:
        if exponent > 0:
            return mp.mpf(0)
        if exponent == 0:
            # 0^0 = 1。電卓の慣行(設計書 §4.1)。
            return mp.mpf(1)
        raise OutOfShard("zero to a negative power")
    if base < 0 and exponent != mp.floor(exponent):
        raise OutOfShard("negative base with a non-integer exponent")
    return base**exponent
```

- [ ] **Step 4: テストを通す**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_corpus_eval.py -q
```

Expected: PASS。

- [ ] **Step 5: 既存シャードが動いていないことを確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd .. && git status --porcelain corpus/generated/
```

Expected: **空**。

- [ ] **Step 6: 参照スイート全体と整形**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format . && UV_NO_CONFIG=1 uv run --no-config ruff check .
```

- [ ] **Step 7: コミット**

```bash
git add reference/src/calcarc_reference/corpus_eval.py reference/tests/test_corpus_eval.py
git commit -m "$(cat <<'EOF'
Evaluate the new functions without copying the engine

定義域の判定は数学のほうを書いた。対数の引数は正、負の底に非整数の
指数は実数の答が無い、組合せは非負整数で r <= n。scientific/mod.rs の
分岐を写すと、同じバグが両側に入って検証の意味が消える。

階乗と順列と組合せは Python の厳密な整数で計算する。engine は f64 で
段ごとに掛け割りしているので、同じ手順を踏むと独立性が無くなる。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 系統別の生成器の土台と `elementary-000.json`

**Files:**
- Modify: `reference/scripts/generate_corpus.py`
- Test: `reference/tests/test_generate_corpus.py`
- Create: `corpus/generated/elementary-000.json`

**Interfaces:**
- Consumes: Task 1 の `Const` / `CONST_NAMES` / `ELEMENTARY_FNS` / `ELEMENTARY_BINS`、Task 2 の `evaluate`
- Produces:
  - `random_family_node(rng, depth, unary_fns, binary_ops, const_prob) -> Node`
  - `REJECTION_REASONS = ("bare", "domain", "division_by_zero", "overflow", "out_of_range", "dup")`
  - `build_family_shard(seed, count, prefix, unary_fns, binary_ops) -> dict`
  - `build_elementary_shard(seed, count) -> dict`
  - シャードの最上位に `rejections: dict[str, int]` が載る

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_generate_corpus.py` の末尾に追加:

```python
import json
import pathlib

from calcarc_reference.corpus_expr import Const, to_expr_text

CORPUS = pathlib.Path(__file__).resolve().parents[2] / "corpus" / "generated"


def test_the_elementary_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((CORPUS / "elementary-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    # 設計書 §3.1 が約束した 5 演算 + 定数 2 つ。
    for token in ("ln", "log10", "exp_e", "recip", "pow", "pi", "e"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_the_elementary_shard_records_why_it_threw_candidates_away() -> None:
    shard = json.loads((CORPUS / "elementary-000.json").read_text())
    rejections = shard["rejections"]
    # **理由ごとに数えていることが要件**(設計書 R9)。E の設計の入力になる。
    assert set(rejections) == {
        "bare",
        "domain",
        "division_by_zero",
        "overflow",
        "out_of_range",
        "dup",
    }
    assert sum(rejections.values()) > 0, "1 件も捨てていないのは疑わしい"


def test_every_elementary_case_lands_in_the_flat_display_band() -> None:
    # このシャードは既存の帯を使う(設計書 §3.2.1)。組合せ論だけが別。
    shard = json.loads((CORPUS / "elementary-000.json").read_text())
    for case in shard["cases"]:
        value = abs(case["expect"]["re"])
        assert value == 0 or 1e-6 <= value <= 1e9, case["id"]


def test_no_elementary_case_is_a_bare_literal_or_a_bare_constant() -> None:
    """裸のリテラルも裸の定数も、押した桁(あるいは定数)がそのまま返ることしか
    確かめない。`pi` を押すと 3.141592654 が出ることは engine_table.rs の領域である。

    **長さで判定してはいけない**——`5 0 0 eq` は 4 打鍵だが裸である。
    演算子か関数のトークンを 1 つ以上含むことを直接主張する。

    このテストを赤くする編集: build_family_shard の `isinstance(node, (Num, Const))`
    を `isinstance(node, Num)` に狭める(裸の定数が混ざるようになる)。
    """
    operators = {
        "add", "sub", "mul", "div", "pow",
        "ln", "log10", "exp_e", "recip",
        "sqrt", "sqr", "sin", "cos", "tan", "neg",
        "asin", "acos", "atan", "n_fact", "n_p_r", "n_c_r",
    }
    shard = json.loads((CORPUS / "elementary-000.json").read_text())
    for case in shard["cases"]:
        assert operators & set(case["keys"]), f"{case['id']} は裸: {case['keys']}"


def test_the_elementary_shard_actually_presses_the_constants() -> None:
    # 定数が 1 件も出ないと、`const_prob` が効いていないのに緑になる。
    shard = json.loads((CORPUS / "elementary-000.json").read_text())
    with_const = [
        c for c in shard["cases"] if "pi" in c["keys"] or "e" in c["keys"]
    ]
    assert len(with_const) > 50, f"定数を含むケースが {len(with_const)} 件しかない"
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_generate_corpus.py -q -k elementary
```

Expected: FAIL — `FileNotFoundError: corpus/generated/elementary-000.json`。

- [ ] **Step 3: 生成器を足す**

`reference/scripts/generate_corpus.py` の import に追加:

```python
from calcarc_reference.corpus_expr import (
    ELEMENTARY_BINS,
    ELEMENTARY_FNS,
    CONST_NAMES,
    Bin,
    Const,
    Node,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    walk,
)
```

（既存の import 行はそのまま残し、足りないものだけ足す。）

`build_precedence_shard` の後ろに追加:

```python
# 棄却の理由。**E(エラー経路)の設計の入力になる**ので、名前を engine の
# エラー名に寄せてある(設計書 §3.6)。`division_by_zero` を `domain` と
# 分けるのは engine が分けているからである。
REJECTION_REASONS = (
    "bare",
    "domain",
    "division_by_zero",
    "overflow",
    "out_of_range",
    "dup",
)


def random_family_node(
    rng: random.Random,
    depth: int,
    unary_fns: tuple[str, ...],
    binary_ops: tuple[str, ...],
    const_prob: float,
) -> Node:
    """系統ごとの選択肢から引く乱択。

    **既存の `random_node` を呼ばない。** あちらは既存 3 枚のシャードの
    乱数の消費列そのものなので、共有すると片方を変えたときにもう片方が
    総入れ替えになる(設計書 §3.1)。
    """
    if depth <= 0 or rng.random() < 0.35:
        if rng.random() < const_prob:
            return Const(rng.choice(CONST_NAMES))
        return Num(rng.randint(0, 999))
    if rng.random() < 0.45:
        return Un(
            rng.choice(unary_fns),
            random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
        )
    return Bin(
        rng.choice(binary_ops),
        random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
        random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
    )


def _classify_out_of_shard(reason: str) -> str:
    """`OutOfShard` の文言を棄却の理由に割り当てる。

    **文言で分けるのは脆い**が、`OutOfShard` に種別を持たせると
    `corpus_eval` が「シャードの都合」を知ることになる。境界はそのままにして、
    ここで読み替える。文言を変えたらここも変わる、という結合は残る——
    その結合は `test_every_out_of_shard_message_is_classified` が守る。
    """
    if "division by zero" in reason or "reciprocal of zero" in reason:
        return "division_by_zero"
    return "domain"


def build_family_shard(
    seed: int,
    count: int,
    prefix: str,
    unary_fns: tuple[str, ...],
    binary_ops: tuple[str, ...],
) -> dict:
    """系統別のシャードを積む。**帯は既存の `MIN_ABS`〜`MAX_ABS`。**

    組合せ論は帯が違うので、この関数を使わない(設計書 §3.2.1)。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections = dict.fromkeys(REJECTION_REASONS, 0)
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_family_node(rng, MAX_DEPTH, unary_fns, binary_ops, 0.2)
        if isinstance(node, (Num, Const)):
            # 裸のリテラルも裸の定数も、押した桁(あるいは定数)がそのまま
            # 返ることしか確かめない。engine_table.rs の領域である。
            rejections["bare"] += 1
            continue
        try:
            if not _within_range(node):
                rejections["out_of_range"] += 1
                continue
            value = evaluate(node)
        except OutOfShard as exc:
            rejections[_classify_out_of_shard(str(exc))] += 1
            continue
        except OverflowError:
            rejections["overflow"] += 1
            continue
        expr = to_expr_text(node)
        if expr in seen:
            rejections["dup"] += 1
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"{prefix}-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": float(value), "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "rejections": rejections,
        "cases": entries,
    }


def build_elementary_shard(seed: int, count: int) -> dict:
    return build_family_shard(
        seed, count, "elem", ELEMENTARY_FNS, ELEMENTARY_BINS
    )
```

`main()` の `write(...)` の並びに 1 行足す:

```python
    write("elementary-000.json", build_elementary_shard(seed=20260818, count=count))
```

- [ ] **Step 4: `OutOfShard` の文言が全部分類されることを固定するテストを足す**

`_classify_out_of_shard` は文言で分ける。**分類から漏れた文言が黙って
`domain` に落ちる**ので、`corpus_eval` が投げうる文言を数え上げて固定する。

`reference/tests/test_generate_corpus.py` に追加:

```python
def test_every_out_of_shard_message_is_classified() -> None:
    """`corpus_eval` が投げる文言と、生成器の分類が食い違わないこと。

    このテストを赤くする編集: corpus_eval.py の "reciprocal of zero" を
    "one over zero" に変える(分類が domain に落ちる)。
    """
    import generate_corpus

    division = [
        "division by zero",
        "reciprocal of zero",
    ]
    domain = [
        "sqrt of a negative number",
        "ln of a non-positive number",
        "log10 of a non-positive number",
        "asin outside [-1, 1]",
        "acos outside [-1, 1]",
        "factorial of a negative number",
        "factorial of a non-integer",
        "nPr of a negative number",
        "nCr with r greater than n",
        "zero to a negative power",
        "negative base with a non-integer exponent",
    ]
    for message in division:
        assert generate_corpus._classify_out_of_shard(message) == "division_by_zero"
    for message in domain:
        assert generate_corpus._classify_out_of_shard(message) == "domain"
```

- [ ] **Step 5: シャードを生成し、棄却率を報告する**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd .. && python3 -c "
import json
s=json.load(open('corpus/generated/elementary-000.json'))
r=s['rejections']; total=sum(r.values())
print('cases', len(s['cases']), 'rejected', total)
for k,v in sorted(r.items(), key=lambda kv:-kv[1]):
    print(f'  {k:18} {v:7}  {100*v/total if total else 0:5.2f}%')
"
```

**この数字を報告に必ず書くこと。** 棄却率が 95% を超えていたら、
`const_prob` か帯の設定が生成を絞りすぎている可能性がある。
**勝手に定数を調整せず、実測値を添えて報告すること。**

- [ ] **Step 6: 既存 3 シャードが動いていないことを確かめる**

```bash
git status --porcelain corpus/generated/
```

Expected: `?? corpus/generated/elementary-000.json` **だけ**。既存 3 枚に
`M` が付いていたら、Task 1 か 2 でタプルを触っている。

- [ ] **Step 7: テストを通し、heavy スイートを回す**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd ../web && CI=1 pnpm heavy
```

Expected: 参照 PASS。`pnpm heavy` は**新シャードが自動で乗る**
（`loadShards()` がディレクトリを列挙する）ので、テスト数が増えて全 PASS。

**不一致が出たら、それはこの作業が見つけたものである。** 勝手に許容を
緩めたり定義域を狭めたりせず、**失敗したケースの `id` / `expr` /
`expect` / 実際の表示を全件挙げて報告すること。**

- [ ] **Step 8: 整形とコミット**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format . && UV_NO_CONFIG=1 uv run --no-config ruff check .
cd .. && git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py corpus/generated/elementary-000.json
git commit -m "$(cat <<'EOF'
Add the shard where logs and powers get pressed

系統ごとに独立した生成器を置いた。既存の random_node は呼ばない——
あれは既存 3 枚の乱数の消費列そのものなので、共有すると片方を変えた
ときにもう片方が総入れ替えになる。

棄却を理由ごとに数えてシャードに載せた。統計のためではなく、次の段階
(エラー経路)がどの種類のエラーを何件扱うことになるのかを、いま誰も
知らないからである。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `inverse-trig-000.json`

**Files:**
- Modify: `reference/scripts/generate_corpus.py`
- Test: `reference/tests/test_generate_corpus.py`
- Create: `corpus/generated/inverse-trig-000.json`

**Interfaces:**
- Consumes: Task 3 の `build_family_shard`、Task 1 の `INVERSE_TRIG_FNS`
- Produces: `build_inverse_trig_shard(seed, count) -> dict`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_generate_corpus.py` に追加:

```python
def test_the_inverse_trig_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((CORPUS / "inverse-trig-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    for token in ("asin", "acos", "atan"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_inverse_trig_answers_are_angles_in_degrees() -> None:
    """`asin` / `acos` の結果は [-90, 90] と [0, 180] に収まる。

    **これは `deg(...)` を書き忘れた場合に赤くなる。** ラジアンで持つと
    `asin` の結果が [-1.571, 1.571] になり、下の 2 件目で落ちる。
    """
    shard = json.loads((CORPUS / "inverse-trig-000.json").read_text())
    # 単項が 1 つだけのケース(`x asin =`)を選んで確かめる。
    singles = [
        c
        for c in shard["cases"]
        if len(c["keys"]) >= 2 and c["keys"][-2] in ("asin", "acos", "atan")
    ]
    assert len(singles) > 20, f"asin/acos/atan で終わるケースが {len(singles)} 件しかない"
    degrees_seen = [abs(c["expect"]["re"]) for c in singles]
    assert max(degrees_seen) > 2, (
        "角度がすべて 2 未満。ラジアンのまま持っている疑いがある"
    )


def test_the_inverse_trig_shard_records_why_it_threw_candidates_away() -> None:
    shard = json.loads((CORPUS / "inverse-trig-000.json").read_text())
    rejections = shard["rejections"]
    assert set(rejections) == set(
        json.loads((CORPUS / "elementary-000.json").read_text())["rejections"]
    )
    # asin / acos は [-1, 1] の外を捨てる。乱択の葉は 0〜999 なので
    # **定義域による棄却が主要因になるはず**である。
    assert rejections["domain"] > 0
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_generate_corpus.py -q -k inverse
```

Expected: FAIL — `FileNotFoundError`。

- [ ] **Step 3: 生成器を足す**

`reference/scripts/generate_corpus.py` の import に `INVERSE_TRIG_FNS` を足し、
`build_elementary_shard` の後ろに追加:

```python
def build_inverse_trig_shard(seed: int, count: int) -> dict:
    """逆三角関数のシャード。

    **二項演算子には既存の 4 つを使う。** `asin` などは単項なので、
    式の骨格を作る演算子が別に要る。ここで `^` を混ぜると、この系統の
    棄却の内訳に `^` の定義域が混ざって読めなくなる(設計書 §3.6)。
    """
    return build_family_shard(
        seed, count, "itrig", INVERSE_TRIG_FNS, BINARY_OPS
    )
```

`main()` に 1 行足す:

```python
    write("inverse-trig-000.json", build_inverse_trig_shard(seed=20260819, count=count))
```

**注意:** `BINARY_OPS` を `random_family_node` の**引数として**渡すだけで、
タプル自体は触っていない。既存の `random_node` とは別の `Random` を使うので、
既存シャードの乱数には影響しない。

- [ ] **Step 4: シャードを生成し、棄却率を報告する**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd .. && python3 -c "
import json
s=json.load(open('corpus/generated/inverse-trig-000.json'))
r=s['rejections']; total=sum(r.values())
print('cases', len(s['cases']), 'rejected', total)
for k,v in sorted(r.items(), key=lambda kv:-kv[1]):
    print(f'  {k:18} {v:7}  {100*v/total if total else 0:5.2f}%')
"
```

**棄却率が 99% を超えたら報告して止まること。** `asin` の引数が `[-1, 1]`
なのに葉が 0〜999 なので、棄却が非常に高くなる可能性がある。
**その場合の対処は生成側の葉の引き方を変えることだが、分布を歪めるので
実測を見てから決める**（設計書 §6 のリスク）。**勝手に変えない。**

- [ ] **Step 5: 既存シャードが動いていないことを確かめ、全体を回す**

```bash
git status --porcelain corpus/generated/
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd ../web && CI=1 pnpm heavy
```

Expected: 新シャード 1 枚だけが `??`。参照 PASS。heavy 全 PASS。

- [ ] **Step 6: 整形とコミット**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format . && UV_NO_CONFIG=1 uv run --no-config ruff check .
cd .. && git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py corpus/generated/inverse-trig-000.json
git commit -m "$(cat <<'EOF'
Add the shard that answers in degrees

逆三角関数は結果を AngleMode に変換して返す。sin が引数側で変換して
いるのと対称で、参照側も度で持つ。テストは角度が 2 を超えることを
主張する——ラジアンのまま持つと asin の結果が 1.571 以下に収まるので、
書き忘れれば赤くなる。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `combinatorics-000.json`（帯が違う）

**Files:**
- Modify: `reference/scripts/generate_corpus.py`
- Test: `reference/tests/test_generate_corpus.py`
- Create: `corpus/generated/combinatorics-000.json`

**Interfaces:**
- Consumes: Task 1 の `COMBINATORICS_FNS` / `COMBINATORICS_BINS`、Task 2 の `evaluate`
- Produces: `build_combinatorics_shard(seed, count) -> dict`

**この課題だけ、他の 2 つと形が違う。** 理由が 2 つある。

1. **帯が違う。** `MIN_ABS`〜`MAX_ABS`（`1e-6`〜`1e9`）を当てると
   `C(50,25) ≈ 1.26e14` が既に外で、**溢れ近傍のケースが一件も出ない**。
   判定は「`float()` が `OverflowError` を出さないこと」だけ（設計書 §3.2.1）
2. **木が浅い。** オペランドは整数リテラルだけで、深さ 1。任意の部分木を
   オペランドにすると「非負整数で `r ≤ n`」を満たす確率が極めて低く、
   棄却率が実用にならない。**この系統が検証したいのは式の構造ではなく、
   組合せ計算そのものの正しさと溢れの境界である。**
3. **定数 `pi` / `e` を入れない。** オペランドは非負整数でなければならないので、
   混ぜても全件捨てられる。**棄却率を上げるだけで、定数のキーは 1 度も押されない**
   （設計書 R5 — 初稿の「3 枚すべてに混ぜる」は計画を書く過程で誤りと分かった）。

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_generate_corpus.py` に追加:

```python
def test_the_combinatorics_shard_presses_every_key_it_promises() -> None:
    shard = json.loads((CORPUS / "combinatorics-000.json").read_text())
    pressed = {k for case in shard["cases"] for k in case["keys"]}
    for token in ("n_fact", "n_p_r", "n_c_r"):
        assert token in pressed, f"{token} は一度も押されていない"


def test_the_combinatorics_shard_reaches_past_the_flat_display_band() -> None:
    """**この系統をやる目的そのもの。**

    既存の帯(1e9)に閉じ込めると C(50,25) すら入らず、溢れ近傍の
    ケースが一件も出ない(設計書 §3.2.1)。

    このテストを赤くする編集: build_combinatorics_shard の受理条件に
    `_within_range(node)` を足す。
    """
    shard = json.loads((CORPUS / "combinatorics-000.json").read_text())
    big = [c for c in shard["cases"] if abs(c["expect"]["re"]) > 1e9]
    assert len(big) > 100, f"1e9 を超えるケースが {len(big)} 件しかない"
    huge = [c for c in shard["cases"] if abs(c["expect"]["re"]) > 1e100]
    assert len(huge) > 0, "1e100 を超えるケースが 1 件も無い"


def test_every_combinatorics_answer_fits_in_f64() -> None:
    shard = json.loads((CORPUS / "combinatorics-000.json").read_text())
    for case in shard["cases"]:
        value = case["expect"]["re"]
        assert value == value, case["id"]  # NaN でない
        assert abs(value) != float("inf"), case["id"]


def test_the_combinatorics_shard_records_why_it_threw_candidates_away() -> None:
    shard = json.loads((CORPUS / "combinatorics-000.json").read_text())
    rejections = shard["rejections"]
    # **溢れの実測はこの系統から取る**(設計書 §6 — exp_e は帯で先に落ちる)。
    assert rejections["overflow"] > 0, (
        "溢れで捨てたケースが 0 件。n の上限が低すぎて境界に届いていない"
    )
    assert rejections["domain"] > 0, "r > n の棄却が 0 件"
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest tests/test_generate_corpus.py -q -k combinatorics
```

Expected: FAIL — `FileNotFoundError`。

- [ ] **Step 3: 生成器を足す**

`reference/scripts/generate_corpus.py` の import に `COMBINATORICS_BINS` /
`COMBINATORICS_FNS` を足し、`build_inverse_trig_shard` の後ろに追加:

```python
# 組合せ論の葉の上限。**`C(1022,511) ≈ 2.2e305` を含める必要がある**——
# 別セッションが実際に踏んだ「答は収まるのに途中で溢れる」ケースがその
# 近傍にあるので、そこに届かない上限を置くと検証したいものが落ちる。
COMBINATORICS_MAX_N = 1200


def build_combinatorics_shard(seed: int, count: int) -> dict:
    """階乗・順列・組合せのシャード。**帯も木の形も他の 2 つと違う。**

    帯: `float()` が溢れないことだけ。`MIN_ABS`/`MAX_ABS` を当てない
    (設計書 §3.2.1)。木: 整数リテラルに演算を 1 つ、深さ 1。任意の部分木を
    オペランドにすると「非負整数で r <= n」を満たす確率が実用にならない。

    **絞る条件に engine の途中値を持ち込まない**(設計書 §3.2)。答が f64 に
    収まる限り生成し、engine が返せなければ不一致として赤くなる。それが
    `ncr_does_not_overflow_on_the_way_to_an_answer_that_fits` を独立に
    検証するということである。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections = dict.fromkeys(REJECTION_REASONS, 0)
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        if rng.random() < 0.25:
            node: Node = Un(
                rng.choice(COMBINATORICS_FNS), Num(rng.randint(0, 200))
            )
        else:
            n = rng.randint(0, COMBINATORICS_MAX_N)
            r = rng.randint(0, COMBINATORICS_MAX_N)
            node = Bin(rng.choice(COMBINATORICS_BINS), Num(n), Num(r))
        try:
            value = evaluate(node)
        except OutOfShard as exc:
            rejections[_classify_out_of_shard(str(exc))] += 1
            continue
        try:
            landed = float(value)
        except OverflowError:
            rejections["overflow"] += 1
            continue
        if landed in (float("inf"), float("-inf")):
            rejections["overflow"] += 1
            continue
        expr = to_expr_text(node)
        if expr in seen:
            rejections["dup"] += 1
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"comb-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": landed, "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "rejections": rejections,
        "cases": entries,
    }
```

`main()` に 1 行足す:

```python
    write(
        "combinatorics-000.json",
        build_combinatorics_shard(seed=20260820, count=count),
    )
```

- [ ] **Step 4: シャードを生成し、分布と棄却率を報告する**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd .. && python3 -c "
import json
s=json.load(open('corpus/generated/combinatorics-000.json'))
r=s['rejections']; total=sum(r.values())
print('cases', len(s['cases']), 'rejected', total)
for k,v in sorted(r.items(), key=lambda kv:-kv[1]):
    print(f'  {k:18} {v:7}  {100*v/total if total else 0:5.2f}%')
vals=[abs(c['expect']['re']) for c in s['cases']]
import math
buckets={}
for v in vals:
    b = 'zero' if v==0 else f'1e{int(math.floor(math.log10(v)))//50*50}'
    buckets[b]=buckets.get(b,0)+1
print('magnitude buckets:', dict(sorted(buckets.items())))
print('max:', max(vals))
"
```

**報告に必ず含めること:** 棄却の内訳、桁の分布、最大値。
**`overflow` が 0 件なら `COMBINATORICS_MAX_N` が低すぎる**ので報告すること。

- [ ] **Step 5: 既存シャードが動いていないことを確かめ、全体を回す**

```bash
git status --porcelain corpus/generated/
cd reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd ../web && CI=1 pnpm heavy
```

**このシャードは指数表記の表示を初めて読む**（設計書 §3.2.1 の副産物）。
`parseDisplay` は指数表記を受け付けるが、実際に読んだことは一度も無い。
**ここで書式の問題が出たら、それがこの作業の発見である。** 勝手に直さず、
失敗したケースの実際の表示文字列を添えて報告すること。

- [ ] **Step 6: 整形とコミット**

```bash
cd reference && UV_NO_CONFIG=1 uv run --no-config ruff format . && UV_NO_CONFIG=1 uv run --no-config ruff check .
cd .. && git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py corpus/generated/combinatorics-000.json
git commit -m "$(cat <<'EOF'
Let the combinatorics run to where f64 gives out

このシャードだけ帯が違う。1e9 に閉じ込めると C(50,25) すら入らず、
溢れ近傍のケースが一件も出ない。判定は「答が f64 に収まる」だけで、
engine が途中で溢れるかは考えない。考えたら engine の実装を模倣する
ことになって独立性が消える。

答が収まる限り生成し、engine が返せなければ赤くなる。それが
ncr_does_not_overflow_on_the_way_to_an_answer_that_fits を規模で
独立に検証するということである。

副産物として、このシャードが指数表記の表示を初めて読む。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: レポートに 2 つの主張を足す

**Files:**
- Modify: `web/tests/heavy/corpus.spec.ts`
- Modify: `web/tests/heavy/report.ts`
- Test: `web/tests/heavy/report.spec.ts`

**Interfaces:**
- Consumes: Task 3〜5 の 3 枚のシャード
- Produces: `ShardSummary.exponentDisplayCases: number`

**既存の `precedenceCases` がそのまま手本になる。** 同じ形——`corpus.spec.ts` の
値ケースの集計で数え、`record(...)` に渡し、`report.ts` が実データから文を書き分ける。
**先に `precedenceCases` の実装を読んでから書くこと。**

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/report.spec.ts` に追加:

```ts
test("the report says how many answers were displayed in exponent notation", () => {
  const markdown = renderReport(
    [summary({ exponentDisplayCases: 372 })],
    PROVENANCE,
  );
  expect(markdown).toContain("372");
  expect(markdown).toContain("指数表記");
});

test("with no exponent-notation answers the report says the band was never left", () => {
  const markdown = renderReport(
    [summary({ exponentDisplayCases: 0 })],
    PROVENANCE,
  );
  expect(markdown).toContain("平坦表示の帯を一度も出ていない");
  expect(markdown).not.toContain("件が指数表記");
});

test("the report keeps saying that the power operator's associativity is untested", () => {
  const markdown = renderReport([summary({})], PROVENANCE);
  // `xʸ` はこのプロジェクト唯一の右結合。コーパスは括弧で囲むので踏まない
  // (設計書 2026-08-16-corpus-functions §3.5)。**踏んでいないと言い続ける。**
  expect(markdown).toContain("右結合");
});
```

`summary()` のデフォルトに `exponentDisplayCases: 0` を足すこと（既存のテストが
コンパイルできなくなるため）。

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && CI=1 pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
```

Expected: FAIL — `exponentDisplayCases` が `ShardSummary` に無い。

- [ ] **Step 3: 集計を足す**

`web/tests/heavy/report.ts` の `ShardSummary` に:

```ts
  /**
   * 答が指数表記で表示されたケースの件数。
   *
   * **段階 3b-A まで、この数は 0 だった**——生成器が値を `1e-6`〜`1e9` に
   * 閉じ込めていたためである(設計書 2026-08-16-corpus-functions §3.2.1)。
   * 組合せ論のシャードが帯を外したので、初めて 0 でなくなる。
   */
  exponentDisplayCases: number;
```

`web/tests/heavy/corpus.spec.ts` の値ケースの集計に:

```ts
    // 表示が指数表記になる境界は `|x| >= 1e10`(docs/numerical-policy.md)。
    // **表示そのものではなく期待値から数える**——表示から数えると、
    // 表示が壊れたときに件数も一緒に嘘になる。
    const exponentDisplayCases = values.filter(
      (c) => Math.abs(c.expect.re) >= 1e10,
    ).length;
```

`record({ ... })` に `exponentDisplayCases` を渡す。

- [ ] **Step 4: レポートの文を足す**

`report.ts` の「まだ一度も踏んでいない領域」の節に、`precedenceCases` の項目と
同じ書き分けで足す（0 件と 1 件以上で文を変える）。**`xʸ` の右結合について
踏んでいないと言い続ける文も足す**（設計書 R12）:

```ts
  const exponent = entries.reduce((sum, e) => sum + e.exponentDisplayCases, 0);
  const exponentItem =
    exponent === 0
      ? [
          "- **指数表記の表示。** 生成器が値を `1e-6`〜`1e9` に閉じ込めているので、",
          "  **平坦表示の帯を一度も出ていない**。`parseDisplay` は指数表記を受け付けるが、",
          "  受け付けることと実際に読んだことは違う。",
        ]
      : [
          `- **指数表記の表示——${exponent} 件が読んでいる。** 組合せ論のシャードが`,
          "  帯を外したので、答が `1e10` 以上になるケースが出るようになった。",
          "  表示は指数表記でも有効数字 10 桁なので、許容はそのまま効く。",
        ];
  const associativityItem = [
    "- **`xʸ` の右結合と優先順位 4。** `pow` は押されるが、キー列は二項を必ず",
    "  括弧で囲むので、**右結合も優先順位 4 も踏んでいない**。新しい関数の検証と",
    "  結合方向の検証を混ぜると、赤が出たときどちらが原因か分からなくなるため、",
    "  意図して分けている(設計書 2026-08-16-corpus-functions §3.5)。",
  ];
```

**この 2 項目は手書きの列挙から外れる**ので、節末尾の「この節は手で保守されている」
の但し書きから該当分を除くこと。

- [ ] **Step 5: テストが噛むことを変異で確かめる**

```bash
cd web
# (a) 0 件の枝を消して、0 件のテストが赤くなるか
#     report.ts の `exponent === 0` を `false` に置き換える
CI=1 pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
# (b) 集計を壊して、実データの主張が赤くなるか
#     corpus.spec.ts の `>= 1e10` を `>= 1e400` に置き換える
CI=1 pnpm heavy
```

**両方の変異で赤が出た件数を報告に書くこと。** 赤くならないなら、
そのテストは何も主張していない。戻すのは `git checkout` ではなく再編集で行う。

- [ ] **Step 6: 全体を回してコミット**

```bash
cd web && CI=1 pnpm heavy && pnpm typecheck && pnpm lint
cd .. && git add web/tests/heavy/corpus.spec.ts web/tests/heavy/report.ts web/tests/heavy/report.spec.ts
git commit -m "$(cat <<'EOF'
Count the answers that left the flat display band

段階 3b-A まで、この数は 0 だった。生成器が値を 1e-6..1e9 に閉じ込めて
いたためである。組合せ論のシャードが帯を外したので初めて 0 でなくなる。

期待値から数えて表示からは数えない。表示から数えると、表示が壊れた
ときに件数も一緒に嘘になる。

xʸ の右結合を踏んでいないことも書き続ける。pow は押されるが括弧で
囲んでいるので、結合方向にも優先順位 4 にも触っていない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 実測を記録し、非干渉を確かめる

**Files:**
- Modify: `docs/corpus-measurements.md`

**Interfaces:**
- Consumes: Task 3〜5 の 3 枚のシャードと `rejections`、Task 6 のレポート

- [ ] **Step 1: 実測値を集める**

**この課題の唯一の規則: 書く数字はすべて、実際に走らせたコマンドの出力から取る。
予想・見積り・記憶を書かない。測れなかったものは「測れなかった、理由はこれ」と書く。**

集めるもの（それぞれコマンドを添えて記録する）:

```bash
# 1. 件数とキー被覆
cd /home/terapyon/dev/CalcArc-e2e && python3 -c "
import json, glob, re, collections
used=collections.Counter()
total=0
for p in sorted(glob.glob('corpus/generated/*.json')):
    d=json.load(open(p)); cases=d['cases']
    total+=len(cases)
    for c in cases:
        for s in ([c['keys']] if 'keys' in c else [c['left'], c['right']]):
            used.update(s)
src=open('web/src/calc/types.ts').read()
m=re.search(r'KEY_TOKENS = \[(.*?)\] as const', src, re.S)
tokens=re.findall(r'\"([^\"]+)\"', m.group(1))
unpressed=[t for t in tokens if t not in used]
print('cases', total, 'pressed', len(used), 'of', len(tokens))
print('unpressed', len(unpressed), unpressed)
"

# 2. 棄却の内訳（3 枚それぞれ）
python3 -c "
import json
for name in ('elementary','inverse-trig','combinatorics'):
    s=json.load(open(f'corpus/generated/{name}-000.json'))
    r=s['rejections']; t=sum(r.values())
    print(name, 'accepted', len(s['cases']), 'rejected', t,
          'rate', f'{100*len(s[\"cases\"])/(len(s[\"cases\"])+t):.2f}%')
    print(' ', r)
"

# 3. 指数表記の表示を読んだ件数（設計書 R13）
python3 -c "
import json
n=0
for name in ('elementary','inverse-trig','combinatorics'):
    s=json.load(open(f'corpus/generated/{name}-000.json'))
    n+=sum(1 for c in s['cases'] if abs(c['expect']['re'])>=1e10)
print('cases whose answer displays in exponent notation:', n)
"

# 4. 生成時間と実行時間
cd reference && time UV_NO_CONFIG=1 uv run --no-config python scripts/generate_corpus.py
cd ../web && CI=1 pnpm heavy
```

- [ ] **Step 2: `docs/corpus-measurements.md` に節を足す**

末尾に `## 関数と定数を足した費用（2026-08-16 実測、段階 3b-A）` という節を作り、
Step 1 の 4 つの出力をそれぞれコマンドつきで書く。**必ず含めるもの:**

- 3 枚のシャードの件数と採択率
- **棄却の内訳（`domain` / `division_by_zero` / `overflow` / `out_of_range` / `bare` / `dup`）を系統ごとに。** これが次の段階（エラー経路）の設計の入力である、と明記する
- キー被覆が **23/46 から 10/46 に減った**こと。残る 10 個の一覧
- 指数表記の表示を読んだ件数（初めて踏んだ領域）
- 生成時間と `pnpm heavy` の実行時間の変化
- 必要になった `corpus/overrides.json` の件数（**0 件ならそう書く**）

- [ ] **Step 3: 非干渉を確かめる**

```bash
cd /home/terapyon/dev/CalcArc-e2e
git diff --stat 6ecc420 HEAD -- crates/ web/src/
git diff --stat 6ecc420 HEAD -- corpus/generated/scientific-000.json corpus/generated/equivalence-000.json corpus/generated/precedence-000.json
git diff --stat 6ecc420 HEAD -- reference/uv.lock
cd web && pnpm exec playwright test --list | grep -c heavy
```

Expected: 最初の 3 つは**空**、最後は **0**。

**`web/src/` に差分が出たら止まって報告すること。** この計画は
`web/src/` を触らない。

- [ ] **Step 4: CI の回せるジョブを回す**

```bash
cd /home/terapyon/dev/CalcArc-e2e
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
cd ../reference && UV_NO_CONFIG=1 uv run --no-config pytest -q
cd ../reference && UV_NO_CONFIG=1 uv run --no-config ruff format --check . && UV_NO_CONFIG=1 uv run --no-config ruff check .
```

**WASM 境界層は回せない**（ChromeDriver と Chrome の版が合わない。CLAUDE.md の既知の罠）。
**「全レイヤー緑」と書かないこと。** `.github/workflows/ci.yml` のジョブは 5 つで、
手元で回せるのは 4 つである。回せない 1 つについては
`git diff --stat <base> HEAD -- crates` が空であることを示し、
**それが構造的論証であってテスト実行ではない**と明記する。

- [ ] **Step 5: コミット**

```bash
git add docs/corpus-measurements.md
git commit -m "$(cat <<'EOF'
Record what the new functions cost, and which errors they surfaced

棄却の内訳を系統ごと・エラーの名前ごとに記録した。統計のためではなく、
次の段階(エラー経路)がどの種類のエラーを何件扱うことになるのかを、
これまで誰も知らなかったからである。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## この計画が積み残すもの

- **`pow` の右結合と優先順位 4**（設計書 §3.5）。`pow` は括弧で囲むので、
  結合方向も優先順位も踏まない。レポートがそう書き続ける
- **残る 10 キー**: `dot` `zeros3` `exp` `dms`（入力レジーム）、`ac` `del`（訂正操作）、
  `angle_toggle` `polar_toggle` `j` `eng`（モードと複素数）
- **エラー経路**（部分系 E）。本計画は定義域外を**捨てて数える**だけで、
  期待値としては表現しない。数えた内訳が E の設計の入力になる
- **組合せ論の木が深さ 1**（Task 5）。組合せ計算と溢れの境界を検証するが、
  式の構造の中に組合せを置いた形は試さない
