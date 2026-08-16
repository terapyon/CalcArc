# 括弧を省いたキー列 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ式木を「括弧を省いた」形でも直列化し、engine が優先順位から構造を復元できることを数千件で確かめる。

**Architecture:** 式木は変えない。`to_keys` の隣に `to_keys_minimal` を足し、**子の優先順位が親より真に大きいときだけ**括弧を省く。同順位の入れ子は括弧を残すので、直列化は結合方向を知らずに済む。生成物は新しいシャードに置き、既存 4000 件には触れない。

**Tech Stack:** Python（`reference/`）と TypeScript（`web/tests/heavy/`）。Rust は一切触らない。

**Spec:** `docs/superpowers/specs/2026-08-16-corpus-precedence-design.md`（要件 R1〜R11）

## Global Constraints

- **`corpus_expr.py` の `UNARY_FNS` / `BINARY_OPS` を触らない**（R5 の前提）。あのタプルは生成器の乱数の土台で、要素が増えると同じ種でも既存 4000 件が総入れ替えになる（複数の種で実測確認済み）。**新しい関数と新しい定数を足すだけ。**
- **`corpus/generated/scientific-000.json` と `equivalence-000.json` を書き換えない**（R4）。再生成一致ゲートがバイト単位の一致を毎回確かめている。
- **判定（`withinTolerance` / `classify`）を変えない。** 段階 3a で締めたものをそのまま使う。
- **許容の値をテストコードに書かない。** 合否に使う値は `corpus/**/*.json` から読む（CLAUDE.md）。関数自身の単体テストの入力リテラルは可。
- **`crates/` を一切触らない。**
- **`uv` は `UV_NO_CONFIG=1` を付ける。`uv.lock` に差分を出さない。**
- **結合方向を検証しない**（R2 の代償）。同順位の入れ子は括弧を残す。レポートにそう書き続ける（R11）。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。**`git push` と PR 作成は行わない。**

### 検証コマンドの母数について

`ci.yml` のジョブは **5 つ**である——`rust` / `wasm`（WASM boundary）/ `web` / `e2e` / `reference`。
このワークツリーで回せるのは 4 つで、**WASM 境界層（`wasm-pack test --headless --chrome`）は
ChromeDriver の版が手元の Chrome と合わず回せない**（CLAUDE.md 記載の既知の罠。CI はランナー
同梱の対で回避している）。

**回せないものは「触っていない」を示す。** この計画は `crates/` に一切触れないので、
`git diff --stat <base> HEAD -- crates` が空であることをもって影響し得ないことの証拠とする。
**「4 レイヤー全緑」という言い方をしない。**

## File Structure

| ファイル | 責務 |
|---|---|
| `reference/src/calcarc_reference/corpus_expr.py` | `BINARY_PRECEDENCE` と `to_keys_minimal` を足す（既存） |
| `reference/tests/test_corpus_expr.py` | 上のテスト（既存） |
| `reference/scripts/generate_corpus.py` | `build_precedence_shard` を足し、`main` で書き出す（既存） |
| `reference/tests/test_generate_corpus.py` | 上のテスト（既存） |
| `corpus/generated/precedence-000.json` | 新しいシャード（生成物） |
| `web/tests/heavy/corpus.ts` | `needsPrecedence` を足す（既存） |
| `web/tests/heavy/corpus.spec.ts` | 集計を `record` に渡す（既存） |
| `web/tests/heavy/report.ts` | 領域判定をデータから出す（既存） |
| `web/tests/heavy/report.spec.ts` | 上のテスト（既存） |
| `docs/corpus-measurements.md` | 実測値（既存） |

---

### Task 1: 括弧を省く直列化

式木は変えない。直列化の関数を 1 本足すだけ。**この時点でコーパスは 1 件も変わらない。**

**Files:**
- Modify: `reference/src/calcarc_reference/corpus_expr.py`
- Test: `reference/tests/test_corpus_expr.py`

**Interfaces:**
- Consumes: `Num` / `Bin` / `Un` / `Node` / `DIGIT_KEYS` / `BINARY_KEYS` / `UNARY_KEYS`（既存）
- Produces:
  - `BINARY_PRECEDENCE: dict[str, int]` — `{"+": 1, "-": 1, "*": 2, "/": 2}`
  - `to_keys_minimal(node: Node) -> list[str]`
  - `to_minimal_key_sequence(node: Node) -> list[str]` — 末尾に `eq` を付ける

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_corpus_expr.py` に追加:

```python
from calcarc_reference.corpus_expr import (
    BINARY_PRECEDENCE,
    to_keys_minimal,
    to_minimal_key_sequence,
)


def test_a_higher_precedence_child_loses_its_parentheses() -> None:
    # 1 + (2 * 3) → 1 + 2 * 3。子の優先順位が親より真に大きい。
    node = Bin("+", Num(1), Bin("*", Num(2), Num(3)))
    assert to_keys_minimal(node) == ["1", "add", "2", "mul", "3"]


def test_a_lower_precedence_child_keeps_its_parentheses() -> None:
    # (1 + 2) * 3。省くと別の式になる。
    node = Bin("*", Bin("+", Num(1), Num(2)), Num(3))
    assert to_keys_minimal(node) == [
        "lparen", "1", "add", "2", "rparen", "mul", "3",
    ]


def test_same_precedence_keeps_its_parentheses() -> None:
    # (10 - 3) - 2。**省けるのは左結合だからで、それを知りたくない。**
    # 同順位の入れ子は常に括弧を残す(設計書 §3.1)。
    node = Bin("-", Bin("-", Num(10), Num(3)), Num(2))
    assert to_keys_minimal(node) == [
        "lparen", "1", "0", "sub", "3", "rparen", "sub", "2",
    ]
    # 右側も同じ。
    right = Bin("-", Num(10), Bin("-", Num(3), Num(2)))
    assert to_keys_minimal(right) == [
        "1", "0", "sub", "lparen", "3", "sub", "2", "rparen",
    ]


def test_a_unary_always_parenthesises_a_binary_argument() -> None:
    # **単項は後置なので、二項の子は必ず括弧で囲む。**
    # 省くと sqrt が直前の数だけに掛かる別の式になる
    # (`1 add 2 sqrt` は 1 + √2 であって √(1+2) ではない)。
    node = Un("sqrt", Bin("+", Num(1), Num(2)))
    assert to_keys_minimal(node) == [
        "lparen", "1", "add", "2", "rparen", "sqrt",
    ]


def test_a_unary_child_of_a_binary_needs_no_parentheses() -> None:
    # √2 + 3。単項は後置で、括弧は要らない。
    node = Bin("+", Un("sqrt", Num(2)), Num(3))
    assert to_keys_minimal(node) == ["2", "sqrt", "add", "3"]


def test_the_minimal_sequence_ends_with_equals() -> None:
    assert to_minimal_key_sequence(Num(5)) == ["5", "eq"]


def test_the_precedence_table_matches_the_engine() -> None:
    # crates/calcarc-core/src/engine/state.rs:46 が正。
    # Add|Sub = 1、Mul|Div = 2 の 2 段。
    assert BINARY_PRECEDENCE == {"+": 1, "-": 1, "*": 2, "/": 2}


def test_dropping_parentheses_never_changes_the_tokens_that_are_not_parentheses() -> None:
    # **括弧以外は 1 つも変わらない。** 片方だけ直す事故への守り(設計書 §6)。
    node = Bin("+", Num(1), Bin("*", Num(2), Un("sqrt", Num(9))))
    def without_parens(keys: list[str]) -> list[str]:
        return [k for k in keys if k not in ("lparen", "rparen")]
    assert without_parens(to_keys_minimal(node)) == without_parens(to_keys(node))
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_corpus_expr.py -v
```

Expected: FAIL — `ImportError: cannot import name 'BINARY_PRECEDENCE'`

- [ ] **Step 3: 実装する**

`reference/src/calcarc_reference/corpus_expr.py` に追加:

```python
# **engine の優先順位。crates/calcarc-core/src/engine/state.rs:46 が正。**
# Add|Sub = 1、Mul|Div = 2 の 2 段。ここは計算ではなく**記法の約束**なので、
# 参照実装の移植には当たらない(設計書 §5.1 の「残る結合」)。ただし engine が
# 段を増やしたらここも直す必要がある、という結合は残る。
BINARY_PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2}


def to_keys_minimal(node: Node) -> list[str]:
    """式木を、**省ける括弧を省いた**キー列にする。

    省くのは**子の優先順位が親より真に大きいとき**だけである。同順位の入れ子
    (`(10-3)-2`)の括弧を省けるのは engine が左結合だからで、省いた瞬間に
    この関数が結合方向を知ることになる。**知りたくないので残す**(設計書 §3.1)。

    代償として、このコーパスは結合方向を検証しない。それは engine_table.rs の
    担当である。
    """
    if isinstance(node, Num):
        return [DIGIT_KEYS[int(digit)] for digit in str(node.value)]
    if isinstance(node, Un):
        return [*_unary_operand_keys(node.arg), UNARY_KEYS[node.fn]]
    if node.op not in BINARY_PRECEDENCE:
        raise ValueError(f"unknown binary op: {node.op!r}")
    parent = BINARY_PRECEDENCE[node.op]
    return [
        *_binary_operand_keys(node.left, parent),
        BINARY_KEYS[node.op],
        *_binary_operand_keys(node.right, parent),
    ]


def _binary_operand_keys(child: Node, parent_precedence: int) -> list[str]:
    """二項の子。**優先順位が真に大きいときだけ**括弧を省く。"""
    if (
        isinstance(child, Bin)
        and BINARY_PRECEDENCE[child.op] <= parent_precedence
    ):
        return ["lparen", *to_keys_minimal(child), "rparen"]
    return to_keys_minimal(child)


def _unary_operand_keys(child: Node) -> list[str]:
    """単項の子。**二項なら必ず括弧で囲む。**

    単項は後置なので、括弧を省くと直前の数だけに掛かる別の式になる——
    `1 add 2 sqrt` は `1 + √2` であって `√(1+2)` ではない。ここは優先順位の
    話ではなく、後置記法そのものの要請である。
    """
    if isinstance(child, Bin):
        return ["lparen", *to_keys_minimal(child), "rparen"]
    return to_keys_minimal(child)


def to_minimal_key_sequence(node: Node) -> list[str]:
    """corpus の `keys` に入る形（括弧を省いた版）。末尾の `=` まで含む。"""
    return [*to_keys_minimal(node), "eq"]
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_corpus_expr.py -v
```

Expected: PASS

- [ ] **Step 5: lint と format**

```bash
cd reference && UV_NO_CONFIG=1 uv run ruff check . && UV_NO_CONFIG=1 uv run ruff format --check .
```

- [ ] **Step 6: コーパスが 1 件も変わっていないことを確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_corpus_reproducibility.py -v
git status --short
```

Expected: 再生成一致ゲートが緑、`corpus/generated/` に差分なし。**関数を足しただけで
`UNARY_FNS` / `BINARY_OPS` に触れていないので、乱数の消費は変わらない。**

- [ ] **Step 7: コミット**

```bash
git add reference/src/calcarc_reference/corpus_expr.py reference/tests/test_corpus_expr.py
git commit -m "Write the same tree without the parentheses it does not need"
```

---

### Task 2: 新しいシャードを生成する

**Files:**
- Modify: `reference/scripts/generate_corpus.py`
- Test: `reference/tests/test_generate_corpus.py`
- Create: `corpus/generated/precedence-000.json`（生成物）

**Interfaces:**
- Consumes: `to_keys` / `to_keys_minimal` / `to_minimal_key_sequence` / `to_expr_text`（Task 1 と既存）、`random_node` / `_within_range` / `evaluate` / `OutOfShard` / `MAX_DEPTH` / `SCHEMA` / `TOLERANCE` / `_provenance` / `write`（既存）
- Produces: `build_precedence_shard(seed: int, count: int) -> dict`

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_generate_corpus.py` に追加:

```python
def _needs_precedence(keys: list[str]) -> bool:
    """同じ括弧の**組**の中に、優先順位の異なる二項演算子が 2 つ以上あるか。

    **括弧が省かれたことの観測可能な痕跡である。** 省くのは子の優先順位が親より
    真に大きいときだけなので、省いた結果は必ず「同じ組に異なる優先順位」になる。
    単項の子は決して省かないので、この判定に漏れは無い。

    **「組」であって「深さ」ではない。** 同じ深さでも別々の括弧の中なら、その
    2 つの演算子は同じ式に並んでいない——反例:`377 - ((553 / 982) / (189 - 996))`
    は `div` と `sub` がどちらも深さ 3 だが、`(553/982)` と `(189-996)` という
    別の組である。深さで数えると全二項を括弧で囲んだ既存シャードに偽陽性が出る
    (実装時の実測:311 件)。組で数えると 0 件になる(2026-08-16 §3.4)。
    """
    from calcarc_reference.corpus_expr import BINARY_KEYS, BINARY_PRECEDENCE

    key_precedence = {
        BINARY_KEYS[op]: precedence
        for op, precedence in BINARY_PRECEDENCE.items()
    }
    stack: list[set[int]] = [set()]
    closed_groups: list[set[int]] = []
    for key in keys:
        if key == "lparen":
            stack.append(set())
        elif key == "rparen":
            closed_groups.append(stack.pop())
        elif key in key_precedence:
            stack[-1].add(key_precedence[key])
    return any(len(group) >= 2 for group in (*closed_groups, *stack))


def test_every_precedence_case_actually_drops_a_parenthesis() -> None:
    # 省くものが無い木を入れると、キー列が既存シャードと同一になり、
    # **新しいことを何も試さないケース**が混ざる(設計書 §3.3)。
    shard = generate_corpus.build_precedence_shard(seed=11, count=200)
    assert len(shard["cases"]) == 200
    for case in shard["cases"]:
        assert _needs_precedence(case["keys"]), (
            f"{case['id']} は括弧を 1 つも省いていない: {case['expr']}"
        )


def test_the_helper_itself_distinguishes_the_two_forms() -> None:
    # 上の判定が「常に真」を返す壊れ方をしていないことを固定する。
    assert _needs_precedence(["1", "add", "2", "mul", "3", "eq"]) is True
    assert (
        _needs_precedence(
            ["lparen", "1", "add", "2", "rparen", "mul", "3", "eq"]
        )
        is False
    )
    assert _needs_precedence(["1", "add", "2", "eq"]) is False


def test_the_precedence_shard_is_deterministic() -> None:
    assert generate_corpus.build_precedence_shard(
        seed=12, count=50
    ) == generate_corpus.build_precedence_shard(seed=12, count=50)


def test_precedence_cases_are_value_cases_with_both_notations() -> None:
    shard = generate_corpus.build_precedence_shard(seed=13, count=50)
    for case in shard["cases"]:
        assert case["kind"] == "value"
        assert case["expr"]
        assert "re" in case["expect"]


def test_precedence_ids_are_unique() -> None:
    shard = generate_corpus.build_precedence_shard(seed=14, count=200)
    ids = [case["id"] for case in shard["cases"]]
    assert len(set(ids)) == len(ids)


def test_the_precedence_envelope_matches_the_existing_convention() -> None:
    shard = generate_corpus.build_precedence_shard(seed=15, count=10)
    assert shard["schema"] == 1
    assert set(shard["tolerance"]) == {"abs", "rel"}
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_generate_corpus.py -v
```

Expected: FAIL — `module 'generate_corpus' has no attribute 'build_precedence_shard'`

- [ ] **Step 3: 実装する**

`reference/scripts/generate_corpus.py` の import に `to_keys` / `to_keys_minimal` / `to_minimal_key_sequence` を足し、関数を追加:

```python
def build_precedence_shard(seed: int, count: int) -> dict:
    """**括弧を省いたキー列**のシャード。

    式も期待値も既存シャードと同じ作り方で、変わるのは直列化だけである。
    つまり「Rust が優先順位から構造を復元できるか」だけを分離して測れる。

    **省ける括弧が 1 つも無い木は捨てる。** 省くものが無ければキー列が
    括弧つきの形と同一になり、新しいことを何も試さないケースが混ざる
    (設計書 §3.3)。全件が必ず優先順位を踏む。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    attempts = 0
    dropped_nothing = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} "
                f"cases ({dropped_nothing} trees had no droppable parenthesis)"
            )
        node = random_node(rng, MAX_DEPTH)
        if isinstance(node, Num):
            continue
        minimal = to_keys_minimal(node)
        if minimal == to_keys(node):
            # 省くものが無い。この木は何も新しいことを試さない。
            dropped_nothing += 1
            continue
        try:
            if not _within_range(node):
                continue
            value = evaluate(node)
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"prec-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_minimal_key_sequence(node),
                "expr": expr,
                "expect": {"re": float(value), "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }
```

`main()` に 1 行足す:

```python
    write("precedence-000.json", build_precedence_shard(seed=20260817, count=count))
```

- [ ] **Step 4: テストを通す**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_generate_corpus.py -v
```

- [ ] **Step 5: 棄却率を測る**

```bash
cd reference && UV_NO_CONFIG=1 uv run python scripts/generate_corpus.py 2000
```

出力の生成時間を控える。そして**「省ける括弧が無い」で捨てられた割合**を測ること
（`build_precedence_shard` に一時的に print を入れるか、`dropped_nothing` を返す形に
してもよい。**最終的なコードに残さないこと**）。

**棄却率が高すぎて上限（`count * 200`）に当たったら、勝手に分布を変えず報告して止まる。**
設計書 §6 が名指ししているリスクである。

- [ ] **Step 6: 生成したシャードを目で読む**

```bash
python3 -c "
import json
d = json.load(open('corpus/generated/precedence-000.json'))
print(len(d['cases']))
for c in d['cases'][:8]:
    print(' ', c['id'], '|', ' '.join(c['keys'][:14]), '|', c['expr'][:50])
"
```

**括弧が本当に減っているか、そして式が多様かを目で確かめること。**

- [ ] **Step 7: 既存シャードが 1 バイトも変わっていないことを確かめる**

```bash
git status --short
git diff --stat -- corpus/generated/scientific-000.json corpus/generated/equivalence-000.json
```

Expected: 新規ファイル `precedence-000.json` だけが増え、既存 2 ファイルに差分なし。
**差分が出たら止まって報告すること**——`UNARY_FNS` / `BINARY_OPS` に触れた証拠である。

- [ ] **Step 8: 再生成一致ゲートが新シャードも見ていることを確かめる**

```bash
cd reference && UV_NO_CONFIG=1 uv run pytest tests/test_corpus_reproducibility.py -v
```

Expected: PASS。**ゲートはディレクトリを列挙する作りなので、新シャードは自動で対象に
入るはず。** 入っていなければ（テスト件数が増えていなければ）報告すること。

- [ ] **Step 9: lint と format、コミット**

```bash
cd reference && UV_NO_CONFIG=1 uv run ruff check . && UV_NO_CONFIG=1 uv run ruff format --check .
git add reference/scripts/generate_corpus.py reference/tests/test_generate_corpus.py corpus/generated/precedence-000.json
git commit -m "Grow a shard where the engine has to recover the structure"
```

---

### Task 3: レポートの領域判定をキー列から導く

**Files:**
- Modify: `web/tests/heavy/corpus.ts`
- Modify: `web/tests/heavy/corpus.spec.ts`
- Modify: `web/tests/heavy/report.ts`
- Test: `web/tests/heavy/report.spec.ts`

**Interfaces:**
- Consumes: `ShardSummary`（既存）
- Produces:
  - `needsPrecedence(keys: string[]): boolean`
  - `ShardSummary.precedenceCases: number`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/report.spec.ts` に追加:

```ts
import { needsPrecedence } from "./corpus";

test("a sequence with two precedence levels in one parenthesis group needs precedence", () => {
  // 1 + 2 × 3。トップレベルの組に優先順位 1 と 2 が並ぶ。
  expect(needsPrecedence(["1", "add", "2", "mul", "3", "eq"])).toBe(true);
});

test("parentheses separate the groups, so precedence is not needed", () => {
  // (1 + 2) × 3。add は括弧の中の組、mul はトップレベルの組——別の組。
  expect(
    needsPrecedence(["lparen", "1", "add", "2", "rparen", "mul", "3", "eq"]),
  ).toBe(false);
});

test("one operator alone never needs precedence", () => {
  expect(needsPrecedence(["1", "add", "2", "eq"])).toBe(false);
});

test("the report says how many cases exercised precedence", () => {
  const markdown = renderReport(
    [summary({ precedenceCases: 1500 })],
    PROVENANCE,
  );
  expect(markdown).toContain("1500");
  // 踏んだことを書いても、結合方向は踏んでいないと言い続ける。
  expect(markdown).toContain("結合方向");
});

test("zero precedence cases reads as never touched", () => {
  const markdown = renderReport([summary({ precedenceCases: 0 })], PROVENANCE);
  expect(markdown).toContain("一度も踏んでいない");
});
```

- [ ] **Step 2: テストを実行して失敗を確かめる**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
```

Expected: FAIL — `needsPrecedence` が export されていない。

- [ ] **Step 3: 判定を実装する**

`web/tests/heavy/corpus.ts` に追加:

```ts
/**
 * 二項演算子の優先順位。**判定には使わない——報告のためだけの目盛りである。**
 *
 * 正は `crates/calcarc-core/src/engine/state.rs` で、Add|Sub = 1、Mul|Div = 2。
 * ここが間違っていても合否は動かず、報告の件数がずれるだけである(合否を決めるのは
 * コーパスの期待値と `withinTolerance` で、この表は一切関与しない)。
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  add: 1,
  sub: 1,
  mul: 2,
  div: 2,
};

/**
 * **このキー列は、優先順位が無ければ正しく解釈できないか。**
 *
 * 判定は「同じ括弧の**組**の中に、優先順位の異なる二項演算子が 2 つ以上現れるか」。
 * 現れれば、engine は括弧ではなく優先順位で構造を決めたことになる。
 *
 * **「組」であって「深さ」ではない。** 同じ深さでも別々の括弧の中なら、その
 * 2 つの演算子は同じ式に並んでいない——反例:`377 - ((553 / 982) / (189 - 996))`
 * は `div` と `sub` がどちらも深さ 3 だが、`(553/982)` と `(189-996)` という
 * 別の組である。深さで数えると全二項を括弧で囲んだ既存シャードに偽陽性が出る
 * (実装時の実測:311 件)。組で数えると 0 件になる(2026-08-16 §3.4)。壊れた
 * 入力(対応の無い `rparen`)は静かに読み違えず、例外にする。
 *
 * レポートの「まだ踏んでいない領域」をこの関数から導く。手書きの否定は、次に
 * 領域が埋まったとき黙って嘘になる(設計書 §3.4)。
 */
export function needsPrecedence(keys: string[]): boolean {
  const topLevel = new Set<number>();
  const stack: Set<number>[] = [];
  const closedGroups: Set<number>[] = [];
  for (const key of keys) {
    if (key === "lparen") {
      stack.push(new Set<number>());
      continue;
    }
    if (key === "rparen") {
      const group = stack.pop();
      if (group === undefined) {
        throw new Error(
          `needsPrecedence: unmatched "rparen" (more rparen than lparen) in ` +
            `${JSON.stringify(keys)}.`,
        );
      }
      closedGroups.push(group);
      continue;
    }
    const precedence = BINARY_PRECEDENCE[key];
    if (precedence === undefined) {
      continue;
    }
    (stack[stack.length - 1] ?? topLevel).add(precedence);
  }
  return [...closedGroups, topLevel, ...stack].some(
    (group) => group.size >= 2,
  );
}
```

- [ ] **Step 4: 集計を `ShardSummary` に足す**

`web/tests/heavy/report.ts` の `ShardSummary` に追加:

```ts
  /**
   * 優先順位が無ければ解釈できないキー列の件数。
   * **レポートの「まだ踏んでいない領域」をここから導く**——手書きの否定は
   * 次に領域が埋まったとき黙って嘘になる(設計書 §3.4)。
   */
  precedenceCases: number;
```

`web/tests/heavy/corpus.spec.ts` の値ケースの集計で数え、`record` に渡す:

```ts
const precedenceCases = values.filter((c) => needsPrecedence(c.keys)).length;
```

同値ケースの `record` には、左右のキー列を合わせて数えた値を渡す。

- [ ] **Step 5: レポートの記述をデータから出す**

`web/tests/heavy/report.ts` の `renderCaveats` の「括弧を省いた式」の項目を、
`precedenceCases` の合計から書き分ける形に変える:

```ts
  const precedence = entries.reduce((sum, e) => sum + e.precedenceCases, 0);
  const parenthesisItem =
    precedence === 0
      ? [
          "- **括弧を省いた式。** キー列は二項演算を必ず括弧で囲む。したがって",
          "  演算子の優先順位と保留演算の意味論(`1 + 2 * 3` が 7 か 9 か)を",
          "  **一度も踏んでいない**。そこは `engine_table.rs` の担当である。",
        ]
      : [
          `- **括弧を省いた式——${precedence} 件が踏んでいる。** 優先順位が無ければ`,
          "  正しく解釈できないキー列(同じ括弧の組に優先順位の異なる二項演算子が",
          "  2 つ以上)がこれだけある。engine は括弧ではなく優先順位で構造を決めた。",
          "  **ただし結合方向は踏んでいない**——同順位の入れ子は括弧を残して生成して",
          "  いるので、`10 - 3 - 2` のような列が一件も無い。省けるのは左結合だからで、",
          "  省いた瞬間に生成側が結合方向を知ることになるため、意図して残している",
          "  (設計書 2026-08-16 §3.1)。結合方向は `engine_table.rs` の担当である。",
        ];
```

**この項目は手書きの列挙から外れる**ので、節末尾の「この節は手で保守されている」の
但し書きから「括弧なし式」を除くこと。

- [ ] **Step 6: テストを通し、全体を回す**

```bash
cd web && pnpm exec playwright test --config playwright.heavy.config.ts tests/heavy/report.spec.ts
cd web && pnpm heavy && pnpm typecheck && pnpm lint
```

**`pnpm heavy` で新シャード（2000 件）が回り、不一致が出ないことを確かめる。**

**不一致が出たら、それは優先順位の復元が食い違っているということで、この作業の
目的そのものが見つけたものである。勝手に判断せず、失敗ケースを全件挙げて報告すること。**

- [ ] **Step 7: レポートを目で読む**

```bash
cat web/heavy-report.md
```

「括弧を省いた式」の項目が件数つきになり、**結合方向は踏んでいないと書いてある**ことを
確かめる。

- [ ] **Step 8: コミット**

```bash
git add web/tests/heavy/corpus.ts web/tests/heavy/corpus.spec.ts web/tests/heavy/report.ts web/tests/heavy/report.spec.ts
git commit -m "Count the sequences that only precedence can read"
```

---

### Task 4: 文書を実測に合わせ、非干渉を確かめる

**Files:**
- Modify: `docs/corpus-measurements.md`

- [ ] **Step 1: 実測値を書く**

`docs/corpus-measurements.md` に節を足す:

- 新シャードの件数
- **「省ける括弧が無い」で捨てられた割合**（Task 2 Step 5 の実測）
- 生成時間
- 優先順位を踏んだケースの件数（レポートの値）
- 実行時間の変化（2000 件増えた分）

**実際に走らせて出た数字を写すこと。予想を書かない。**

- [ ] **Step 2: 非干渉を確かめる**

```bash
cd web && pnpm test && pnpm exec playwright test
cd ../reference && UV_NO_CONFIG=1 uv run pytest
cargo test --workspace
```

既存の `playwright test`（設定なし）が heavy を 1 件も拾わないこと:

```bash
cd web && pnpm exec playwright test --list | grep -c heavy
```

Expected: `0`

**WASM 境界層は回せない**（Global Constraints 参照）。代わりに触れていないことを示す:

```bash
git diff --stat f436438 HEAD -- crates
```

Expected: 空。（`f436438` はこの計画の設計書をコミットした地点。）

- [ ] **Step 3: コミット**

```bash
git add docs/corpus-measurements.md
git commit -m "Record what the parenthesis-free shard actually cost"
```

---

## この計画が積み残すもの

- **結合方向。** 同順位の入れ子は括弧を残すので、`10 - 3 - 2` のような列が一件も出ない。
  設計書 §3.1 の意図した代償である。レポートがそう書き続ける。
- **段階 3b（エラー経路・複素数・指数表記）と 3d（電卓の種類）。**
- **段階 4（UI 経路）と段階 5（外向き）。**
- **別セッションが入れる予定の変更**（3 桁カンマ、`sqrt(-4)` → `DomainError`、関数の追加、
  優先順位の 4 段化と `xʸ` の右結合）。**未観測の書式や意味論に備えるコードは書かない。**
  main に入ってから実測して直す。
