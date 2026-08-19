# S-0 Scale 刷新（入力方式・LLM・Data Transfer） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale 系統に LLM メモリと Data Transfer の 2 カテゴリを足し、次元数の入力を「選択（既定）／手入力」の面の入れ替えにする。

**Architecture:** 計算は `calcarc-core` の新モジュール 2 つ（`data_scale/llm.rs`、`data_scale/transfer.rs`）に置き、内部はビットの u128 厳密整数で持って表示の直前にバイトへ切り上げる。表示器（`data_scale/format.rs`）と 3 桁区切りは既存を共有する。WASM は**追加のみ**（既存 `data_scale` の署名は 1 文字も変えない）。UI は既存の「面の入れ替え」機構だけで作り、新しい UI 部品を作らない。

**Tech Stack:** Rust（calcarc-core / calcarc-wasm、wasm-bindgen + serde）、TypeScript + React（CSS Modules）、Python（参照実装、uv + pytest）、Playwright（E2E）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-19-scale-llm-transfer-design.md`
（§2 と §4.2 に【訂正 2026-08-19】あり。枠は 4 列 × 4 行ではなく **5 列 × 5 行**）

**ベースブランチ:** `feature/nav-restructure`（`67013f8`）
**このブランチ:** `feature/scale-llm-transfer`（作成済み。`52ca5c8` = spec の訂正コミット）
**push と PR は行わない**（CLAUDE.md）。縦積みの下段が後で rebase されて SHA が変わりうることは織り込み済み。

---

## Global Constraints

spec §0.0 の 6 行がそのまま全タスクの要件である。**各タスクの実装者は、自分のタスクを読む前にここを読む。**

1. **既存の `data_scale(count, dimensions, dtype)` の WASM 署名を変えない。** コーパスの call シャードがこれを直接叩いている（`web/src/heavy-harness.ts:115`）
2. **`KEY_TOKENS`（Scientific）と `engine_table.rs` を触らない**
3. **バイト数は u128 の厳密整数。** あふれは黙って折り返さず `CalcError::Overflow`
4. **参照実装を Rust の移植にしない。** 式は spec §3 の公開仕様から独立に書き起こす
5. **計算は `calcarc-core` に置く。** web と wasm に式を書かない
6. **出せない数を出したふりをしない。** 実行時メモリの推定はしない

加えてリポジトリ全体の規律（CLAUDE.md）:

- `calcarc-core` は panic しない（`unwrap_used` / `expect_used` が deny）
- `web/src/calc/` と `web/src/datascale/` に React を import しない
- WASM 境界は JavaScript 例外を投げない。エラーは戻り値の一部
- **許容誤差をテストコードに書かない。** このタスク群の golden は**整数の完全一致**なので `tolerance` を持たない（`data_scale.json` と同じ）
- コミット前に `cargo fmt`。コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `uv` は `--no-config` を付ける
- **`git commit --amend` を使わない**（履歴を書き換えず、直しは新しいコミットで積む）

### 数の定義値（spec §3。全タスクで同じ値を使う）

| | |
|---|---|
| `bits_per_parameter` | `fp32`=32 / `fp16`=16 / `bf16`=16 / `int8`=8 / `int4`=4 |
| `weight_bits` | `parameters × bits_per_parameter` |
| `kv_bits` | `2 × layers × context_length × kv_heads × head_dim × bits_per_kv_element` |
| `total_bytes` | `ceil(weight_bits / 8) + ceil(kv_bits / 8)`（**それぞれ切り上げてから足す**） |
| 帯域幅の係数（bit/秒） | `bps`=1 / `kbps`=10³ / `mbps`=10⁶ / `gbps`=10⁹ |
| 時間の係数（秒） | `second`=1 / `minute`=60 / `hour`=3600 / `day`=86400 |
| 転送 | `bytes = ceil(bandwidth × bw_factor × duration × du_factor / 8)` |

### 境界の綴り（トークン）

**すべて小文字**にする（既存の `DataType::token()` と同じ流儀。UI のラベルは `Mbps` のように大文字を使うが、境界を渡るのは小文字である）。

| | |
|---|---|
| 精度 | `fp32` `fp16` `bf16` `int8` `int4` |
| 帯域幅の単位 | `bps` `kbps` `mbps` `gbps` |
| 時間の単位 | `second` `minute` `hour` `day` |
| Scale のカテゴリ（hash） | `data-scale` `llm` `transfer` |

---

## 計画時の裁定（spec が沈黙している点。実装者はここに従う）

1. **`Precision` は重みと KV で同じ 1 つの型にする。** UI は KV 面に `int4` を出さない（spec §4.3 の候補表）が、**コアは 5 つすべてを受ける**。コア側で KV だけ 4 つに絞ると、根拠のない定義域が計算層に生まれる
2. **LLM / Transfer は「主表示の切り替え」トグルを持たない。** 縦を 1 行増やさないため。`Readout` の主表示に使う単位系は**保存済みの `settings.dataScale.primary` を読む**（新しい設定項目は作らない）。結果欄は §5 のとおり 10 進と 2 進を両方出す
3. **カテゴリの `<select>` は `window.location.hash` を書き換える。** クリックハンドラで画面を差し替えない——U-0 が決めた「hash が唯一の出所」を守る（`hashchange` の購読が state を更新する）
4. **手入力面の上限はどの項目も u128 の上限**（`MAX_COUNT`）。項目ごとの上限は設けない。定義域の外れはコアの `Overflow` が言う
5. **`checked_add` の Overflow 枝は到達不能**（証明は Task 3 のコメント）。それでも `checked_add` で書く——「到達不能だから素の `+`」は、証明が崩れた日に panic になる

---

## ファイル構成

**新規:**

| ファイル | 責務 |
|---|---|
| `crates/calcarc-core/src/data_scale/llm.rs` | 重み・KV cache・合計。`Precision` の定義値表 |
| `crates/calcarc-core/src/data_scale/transfer.rs` | 帯域幅 × 時間。単位の係数表 |
| `crates/calcarc-core/tests/llm_golden.rs` | `testdata/llm.json` との突き合わせ |
| `crates/calcarc-core/tests/transfer_golden.rs` | `testdata/transfer.json` との突き合わせ |
| `reference/src/calcarc_reference/llm_ref.py` | LLM の独立実装（spec §3 から書く） |
| `reference/src/calcarc_reference/transfer_ref.py` | Transfer の独立実装（同上） |
| `reference/tests/test_llm_ref.py` / `test_transfer_ref.py` | 参照実装の健全性 |
| `testdata/llm.json` / `testdata/transfer.json` | 生成される期待値（コミットする） |
| `web/src/ui/Scale/ScalePanel.tsx` / `.module.css` / `.test.tsx` | Scale の器。カテゴリの `<select>` と 3 パネルの振り分け |
| `web/src/ui/Llm/LlmPanel.tsx` / `.module.css` / `.test.tsx` | LLM パネル |
| `web/src/ui/Transfer/TransferPanel.tsx` / `.module.css` / `.test.tsx` | Transfer パネル |
| `web/src/ui/Keypad/llm.ts` | LLM のキー集合（項目行・候補面・数字面） |
| `web/src/ui/Keypad/transfer.ts` | Transfer のキー集合 |
| `web/tests/e2e/scale-categories.spec.ts` | カテゴリ選択と 3 つの hash |
| `web/tests/e2e/llm.spec.ts` / `transfer.spec.ts` | 盤面と headline |

**変更:**

| ファイル | 何を |
|---|---|
| `crates/calcarc-core/src/data_scale/mod.rs` | `pub mod llm; pub mod transfer;` |
| `crates/calcarc-core/src/expr/mod.rs` | `UnitSet::Params`（`B`=10⁹ / `M`=10⁶）と `unit_set_from_str("params")` |
| `crates/calcarc-wasm/src/lib.rs` | `llm_memory` / `data_transfer` を**追加**（既存は不変） |
| `crates/calcarc-wasm/tests/token_parity.rs` | 新しい 3 つのトークン配列の一致検査 |
| `web/src/datascale/types.ts` | `PRECISION_TOKENS` / `BANDWIDTH_UNIT_TOKENS` / `DURATION_UNIT_TOKENS` と結果型 |
| `web/src/datascale/index.ts` | `llm()` と `transfer()` を `DataScaleCalc` に足す |
| `web/src/route.ts` / `route.test.ts` | `SCALE_CATEGORIES` を 3 つに |
| `web/src/App.tsx` / `App.test.tsx` | `DataScalePanel` の直呼びを `ScalePanel` に |
| `web/src/ui/Keypad/dataScale.ts` | 次元数の候補面・手入力への往復・**古いコメントの訂正** |
| `web/src/ui/DataScale/DataScalePanel.tsx` / `.module.css` / `.test.tsx` | 次元数の面の入れ替え |
| `web/tests/e2e/data-scale.spec.ts` / `data-scale-keypad.spec.ts` / `pwa.spec.ts` | 次元数の打ち方（Task 7 に一覧） |
| `docs/definition-of-done.md` | 縦の実測値（§4.5） |

**触らない:** `testdata/data_scale.json`（1 件も変えない）、`web/src/calc/`、`crates/calcarc-core/tests/engine_table.rs`、`web/src/heavy-harness.ts`、`web/tests/heavy/`。

---

### Task 1: LLM の参照実装と golden

**Files:**
- Create: `reference/src/calcarc_reference/llm_ref.py`
- Create: `reference/tests/test_llm_ref.py`
- Modify: `reference/src/calcarc_reference/data_scale_ref.py`（表示器を公開する）
- Modify: `reference/src/calcarc_reference/cases.py`（末尾に `LLM_INPUTS`）
- Modify: `reference/scripts/generate.py`（`build_llm` と `write`）
- Generated: `testdata/llm.json`

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces: `llm_ref.compute(parameters, weight_precision, layers, kv_heads, head_dim, context_length, kv_precision) -> dict`。成功は `{"weight": LINES, "kv": LINES, "total": LINES}`、失敗は `{"error": "Overflow" | "SyntaxError"}`。`LINES` は `{"bytes": str, "bytes_grouped": str, "decimal": str|None, "binary": str|None}`。`testdata/llm.json` の 1 件は `{"id","op":"llm","input":{...7 つ...},"expect":{...}}`

**Note:** **Rust の実装はまだ存在しない。** spec §3.2〜§3.4 と §3.6 だけを見て書く。既存の `data_scale_ref.py` は**表示器（丸め規則）を借りるためだけ**に読む——丸め規則は公開契約であり（spec §2、`data_scale_ref` の doc comment）、そこを二重に書くと今度は Python 内で 2 つの表示器がずれる。

- [ ] **Step 1: 参照実装の健全性テストを書く（先に赤にする）**

```python
# reference/tests/test_llm_ref.py
"""LLM 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.llm_ref import compute


def test_headline_case() -> None:
    # spec §5: 27B INT4 / 62 層 / KV 16 ヘッド / ヘッド次元 128 / 文脈長 8192 / KV は FP16
    r = compute("27000000000", "int4", "62", "16", "128", "8192", "fp16")
    assert r["weight"] == {
        "bytes": "13500000000",
        "bytes_grouped": "13,500,000,000",
        "decimal": "13.5 GB",
        "binary": "12.6 GiB",
    }
    assert r["kv"]["bytes"] == "4160749568"
    assert r["kv"]["decimal"] == "4.2 GB"
    assert r["total"] == {
        "bytes": "17660749568",
        "bytes_grouped": "17,660,749,568",
        "decimal": "17.7 GB",
        "binary": "16.4 GiB",
    }


def test_gqa_is_not_the_attention_head_count() -> None:
    # KV ヘッド 8（アテンションヘッド 32 のモデルを想定）。取り違えると 4 倍ずれる。
    grouped = compute("8000000000", "int8", "32", "8", "128", "4096", "fp16")
    mistaken = compute("8000000000", "int8", "32", "32", "128", "4096", "fp16")
    assert grouped["kv"]["bytes"] == "536870912"
    assert mistaken["kv"]["bytes"] == "2147483648"
    assert int(mistaken["kv"]["bytes"]) == 4 * int(grouped["kv"]["bytes"])


def test_a_single_int4_parameter_rounds_up_to_one_byte() -> None:
    # 切り上げ（spec §3.1）。**重み側にしか無い端である。**
    r = compute("1", "int4", "1", "8", "128", "0", "fp16")
    assert r["weight"]["bytes"] == "1"
    assert r["kv"]["bytes"] == "0"
    assert r["total"]["bytes"] == "1"


def test_the_two_ceilings_are_taken_separately() -> None:
    # spec §3.4: 合計は ceil(w/8) + ceil(kv/8)。まとめて割ると 1 バイトずれる。
    # 重み 1 bit（int4 の 1/4 パラメータは書けないので int4 × 1 = 4 bit）と
    # KV 4 bit を足す構成: 4 bit -> 1 byte、4 bit -> 1 byte、合計 2 byte。
    # まとめて割ると (4+4)/8 = 1 byte になり、画面の 2 行と合計が食い違う。
    r = compute("1", "int4", "1", "1", "1", "1", "int8")
    assert r["weight"]["bytes"] == "1"
    assert r["kv"]["bytes"] == "2"
    assert r["total"]["bytes"] == "3"


def test_zero_context_is_valid_not_an_error() -> None:
    r = compute("1000000", "fp16", "10", "8", "64", "0", "fp16")
    assert r["kv"]["bytes"] == "0"
    assert "error" not in r


def test_overflow_is_the_u128_contract() -> None:
    assert compute(str(1 << 127), "fp32", "1", "1", "1", "0", "fp16") == {
        "error": "Overflow"
    }
    # **積は左から順に検査する**（spec §3.6「どの積も checked_mul」）。
    # 2 × layers があふれた時点で Overflow——後ろに 0 が来ても救わない。
    assert compute("1", "int8", str(1 << 127), "1", "1", "0", "fp16") == {
        "error": "Overflow"
    }


def test_unknown_precision_is_a_syntax_error() -> None:
    assert compute("1", "fp8", "1", "1", "1", "1", "fp16") == {"error": "SyntaxError"}
    assert compute("1.5", "int8", "1", "1", "1", "1", "fp16") == {"error": "SyntaxError"}
```

- [ ] **Step 2: 赤を見る**

Run: `cd reference && uv run --no-config pytest tests/test_llm_ref.py -q`
Expected: FAIL（`ModuleNotFoundError: calcarc_reference.llm_ref`）

- [ ] **Step 3: 表示器を `data_scale_ref` から公開する**

`data_scale_ref.py` の末尾（`compute` の直前）に足し、`compute` をこれで書き直す。**返す辞書の中身は 1 文字も変わらない**（`testdata/data_scale.json` は不変でなければならない）。

```python
def lines(size: int) -> dict:
    """バイト数を画面の 1 組（bytes / 3 桁区切り / 10 進 / 2 進）にする。

    **表示器は 1 つである**（spec §2）。LLM も Transfer もここを通る——
    Rust 側で format.rs を共有しているのと同じ形にしておかないと、
    「Python では揃っているのに Rust ではずれている」を検出できない。
    """
    return {
        "bytes": str(size),
        "bytes_grouped": f"{size:,}",
        "decimal": _scaled(size, DECIMAL_UNITS),
        "binary": _scaled(size, BINARY_UNITS),
    }
```

`compute` の末尾を `return lines(size)` にする。

- [ ] **Step 4: `llm_ref.py` を書く**

```python
"""LLM のメモリ見積りの参照実装（spec §3.2〜§3.4）。

数値は Python の組み込み int（任意精度）。u128 の上限とあふれの規則、
切り上げ、合計の取り方は**仕様として固定された公開契約**であって
アルゴリズムではない（spec §3.6、§3.4）。

**Rust の実装は見ていない。** 式は spec §3 から書き起こしている。
"""

from __future__ import annotations

from calcarc_reference.data_scale_ref import U128_MAX, lines

# 定義値（IEEE 754 binary32 / binary16、bfloat16 の 16 bit、整数型のビット幅）。
BITS_PER_PARAMETER = {
    "fp32": 32,
    "fp16": 16,
    "bf16": 16,
    "int8": 8,
    "int4": 4,
}


def _parse(text: str) -> int | None:
    if not text or not text.isascii() or not text.isdigit():
        return None
    value = int(text)
    return value if value <= U128_MAX else None


def _product(factors: list[int]) -> int | None:
    """左から順に掛け、**その都度** u128 に収まるかを見る（spec §3.6）。

    最後にまとめて見るのとは違う——途中であふれた後に 0 が来る構成
    （層数 2^127 × 文脈長 0）では、答えが違う。契約は checked_mul である。
    """
    total = 1
    for factor in factors:
        total *= factor
        if total > U128_MAX:
            return None
    return total


def compute(
    parameters: str,
    weight_precision: str,
    layers: str,
    kv_heads: str,
    head_dim: str,
    context_length: str,
    kv_precision: str,
) -> dict:
    numbers = [_parse(t) for t in (parameters, layers, kv_heads, head_dim, context_length)]
    weight_bits_per = BITS_PER_PARAMETER.get(weight_precision)
    kv_bits_per = BITS_PER_PARAMETER.get(kv_precision)
    if any(n is None for n in numbers) or weight_bits_per is None or kv_bits_per is None:
        return {"error": "SyntaxError"}
    params, layer_count, heads, dim, context = numbers

    weight_bits = _product([params, weight_bits_per])
    # 並びは spec §3.3 のとおり: 2 × layers × context_length × kv_heads × head_dim × bits
    kv_bits = _product([2, layer_count, context, heads, dim, kv_bits_per])
    if weight_bits is None or kv_bits is None:
        return {"error": "Overflow"}

    # **それぞれ切り上げてから足す**（spec §3.4）。画面に出る 2 行の
    # 足し算が合計と一致することを優先する。
    weight_bytes = -(-weight_bits // 8)
    kv_bytes = -(-kv_bits // 8)
    total = weight_bytes + kv_bytes
    if total > U128_MAX:
        return {"error": "Overflow"}
    return {
        "weight": lines(weight_bytes),
        "kv": lines(kv_bytes),
        "total": lines(total),
    }
```

- [ ] **Step 5: 緑を見る**

Run: `cd reference && uv run --no-config pytest tests/test_llm_ref.py -q`
Expected: PASS（8 件）

- [ ] **Step 6: golden の入力を並べる**

`cases.py` の末尾に足す。**導出記録はここに書く**（spec §7 の要求。読む人が golden の隣で読める場所である）。

```python
# (parameters, weight_precision, layers, kv_heads, head_dim, context_length,
#  kv_precision)。文字列なのは u128 の定義域を JSON/JS の number(2^53)で
# 殺さないため（DATA_SCALE_INPUTS と同じ理由）。
#
# **GQA の対照値**（spec §7 の要求）: 2 件目は KV ヘッド 8 の構成である。
# 同じ諸元で「アテンションヘッド数 32」を KV ヘッド数に取り違えて計算すると
# KV は 2,147,483,648 bytes（2.1 GB）になり、正しい 536,870,912 bytes
# （536.9 MB）のちょうど 4 倍になる。**モデル名は書かない**——諸元を記憶から
# 書けば、それ自体が「持たないと決めた陳腐化する表」になる（spec §1-3、§7）。
# 必要なのは kv_heads < attention_heads という**形**であって、どのモデルかではない。
# 8 ≠ 128 なので、KV ヘッド数とヘッド次元の取り違えもこの 1 件が兼ねる。
LLM_INPUTS: list[tuple[str, str, str, str, str, str, str]] = [
    ("27000000000", "int4", "62", "16", "128", "8192", "fp16"),  # spec §5 の headline
    ("8000000000", "int8", "32", "8", "128", "4096", "fp16"),  # GQA と対照値
    # 切り上げの端。**重み側にしか無い**（kv_bits は常に 8 の倍数。spec §3.1）
    ("1", "int4", "1", "8", "128", "0", "fp16"),
    # 2 つの切り上げを別々に取ること（spec §3.4）。まとめて割ると 2 が 1 になる
    ("1", "int4", "1", "1", "1", "1", "int8"),
    # 重みの精度 5 つ（定義値の表。KV は文脈長 0 で黙らせる）
    ("1", "fp32", "1", "1", "1", "0", "fp16"),
    ("1", "fp16", "1", "1", "1", "0", "fp16"),
    ("1", "bf16", "1", "1", "1", "0", "fp16"),
    ("1", "int8", "1", "1", "1", "0", "fp16"),
    # KV の精度 4 つ（重みはパラメータ 0 で黙らせる。0 は正当な入力）
    ("0", "int8", "1", "1", "1", "1", "fp32"),
    ("0", "int8", "1", "1", "1", "1", "fp16"),
    ("0", "int8", "1", "1", "1", "1", "bf16"),
    ("0", "int8", "1", "1", "1", "1", "int8"),
    # u128 上限の直下は通る
    (str((1 << 127) - 1), "int8", "1", "1", "1", "0", "fp16"),
    # あふれ 2 つ。2 件目は**掛ける順序**が効く（後ろに 0 が来ても救わない）
    (str(1 << 127), "fp32", "1", "1", "1", "0", "fp16"),
    ("1", "int8", str(1 << 127), "1", "1", "0", "fp16"),
    # 綴りの知らない精度
    ("1", "fp8", "1", "1", "1", "1", "fp16"),
]
```

- [ ] **Step 7: 生成器に足す**

`generate.py` の import に `llm_ref` を加え、`build_data_scale` の直後に置く。

```python
def build_llm() -> dict:
    entries = []
    for case in cases.LLM_INPUTS:
        params, weight, layers, kv_heads, head_dim, context, kv = case
        result = llm_ref.compute(params, weight, layers, kv_heads, head_dim, context, kv)
        entries.append(
            {
                "id": f"llm/{params}x{weight}/{layers}x{kv_heads}x{head_dim}x{context}x{kv}",
                "op": "llm",
                "input": {
                    "parameters": params,
                    "weight_precision": weight,
                    "layers": layers,
                    "kv_heads": kv_heads,
                    "head_dim": head_dim,
                    "context_length": context,
                    "kv_precision": kv,
                },
                "expect": result,
            }
        )
    # 整数の完全一致なので tolerance を持たない（data_scale と同じ）。
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }
```

`main()` に `write("llm.json", build_llm())` を `data_scale.json` の次の行として足す。

- [ ] **Step 8: 生成して、既存の golden が動いていないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff --exit-code testdata/data_scale.json && echo "data_scale.json は不変"
git status --short testdata/
```
Expected: `testdata/llm.json` だけが新規（17 件）。**`data_scale.json` に差分が出たら Step 3 の書き換えが値を変えている**——戻して原因を潰す。

- [ ] **Step 9: 参照側を全部回す**

Run: `cd reference && uv run --no-config pytest -q`
Expected: 既存の 233 件 + 8 件がすべて PASS

- [ ] **Step 10: コミット**

```bash
git add reference testdata/llm.json
git commit   # 例: "Write the LLM estimate from the spec, not from Rust"
```

---

### Task 2: Transfer の参照実装と golden

**Files:**
- Create: `reference/src/calcarc_reference/transfer_ref.py`
- Create: `reference/tests/test_transfer_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`（`TRANSFER_INPUTS`）
- Modify: `reference/scripts/generate.py`（`build_transfer` と `write`）
- Generated: `testdata/transfer.json`

**Interfaces:**
- Consumes: `data_scale_ref.lines()` と `U128_MAX`（Task 1 が公開した）
- Produces: `transfer_ref.compute(bandwidth, bandwidth_unit, duration, duration_unit) -> dict`。成功は `lines()` そのもの（`{"bytes","bytes_grouped","decimal","binary"}`）、失敗は `{"error": ...}`

- [ ] **Step 1: 健全性テストを書く**

```python
# reference/tests/test_transfer_ref.py
"""Data Transfer 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.transfer_ref import compute


def test_headline_case() -> None:
    # spec §3.5: 100 Mbps × 3 時間 = 135,000,000,000 bytes
    assert compute("100", "mbps", "3", "hour") == {
        "bytes": "135000000000",
        "bytes_grouped": "135,000,000,000",
        "decimal": "135.0 GB",
        "binary": "125.7 GiB",
    }


def test_kilo_is_decimal_not_1024() -> None:
    # 512 kbps × 30 分 = 512,000 × 1800 bit = 115,200,000 bytes
    assert compute("512", "kbps", "30", "minute")["bytes"] == "115200000"


def test_bits_round_up_to_a_whole_byte() -> None:
    # **転送では切り上げが実際に発火する**（1 bit は 1 byte に満たない）。
    assert compute("1", "bps", "1", "second")["bytes"] == "1"
    assert compute("8", "bps", "1", "second")["bytes"] == "1"
    assert compute("9", "bps", "1", "second")["bytes"] == "2"


def test_a_day_of_a_gigabit() -> None:
    assert compute("1", "gbps", "1", "day")["decimal"] == "10.8 TB"


def test_zero_is_valid_not_an_error() -> None:
    r = compute("0", "gbps", "1", "hour")
    assert r["bytes"] == "0"
    assert r["decimal"] is None


def test_overflow_is_the_u128_contract() -> None:
    assert compute(str(1 << 127), "gbps", "1", "second") == {"error": "Overflow"}


def test_unknown_units_are_syntax_errors() -> None:
    assert compute("1", "tbps", "1", "second") == {"error": "SyntaxError"}
    assert compute("1", "bps", "1", "week") == {"error": "SyntaxError"}
```

- [ ] **Step 2: 赤を見る**

Run: `cd reference && uv run --no-config pytest tests/test_transfer_ref.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: `transfer_ref.py` を書く**

```python
"""Data Transfer の参照実装（spec §3.5）。

**帯域幅は 10 進である**（`kbps` の `k` は 1024 ではない）。出典は SI 接頭辞
（k = 10³、M = 10⁶、G = 10⁹）と、時間の 60 / 3600 / 86400 秒。
**入力は bit、表示は byte** で、切り上げはここで実際に発火する。

**Rust の実装は見ていない。** 式は spec §3.5 から書き起こしている。
"""

from __future__ import annotations

from calcarc_reference.data_scale_ref import U128_MAX, lines

BANDWIDTH_FACTOR = {"bps": 1, "kbps": 10**3, "mbps": 10**6, "gbps": 10**9}
DURATION_FACTOR = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def _parse(text: str) -> int | None:
    if not text or not text.isascii() or not text.isdigit():
        return None
    value = int(text)
    return value if value <= U128_MAX else None


def compute(
    bandwidth: str, bandwidth_unit: str, duration: str, duration_unit: str
) -> dict:
    value = _parse(bandwidth)
    seconds = _parse(duration)
    bw = BANDWIDTH_FACTOR.get(bandwidth_unit)
    du = DURATION_FACTOR.get(duration_unit)
    if value is None or seconds is None or bw is None or du is None:
        return {"error": "SyntaxError"}
    # 左から順に、その都度 u128 に収まるかを見る（spec §3.6）。
    total = 1
    for factor in (value, bw, seconds, du):
        total *= factor
        if total > U128_MAX:
            return {"error": "Overflow"}
    return lines(-(-total // 8))
```

- [ ] **Step 4: 緑を見る**

Run: `cd reference && uv run --no-config pytest tests/test_transfer_ref.py -q`
Expected: PASS（7 件）

- [ ] **Step 5: golden の入力を並べる**

`cases.py` の `LLM_INPUTS` の次に足す。

```python
# (bandwidth, bandwidth_unit, duration, duration_unit)。
# **4 つの帯域幅の単位と 4 つの時間の単位が、それぞれ 1 度以上現れる。**
TRANSFER_INPUTS: list[tuple[str, str, str, str]] = [
    ("100", "mbps", "3", "hour"),  # spec §3.5 の headline: 135.0 GB / 125.7 GiB
    ("512", "kbps", "30", "minute"),  # k は 10³（1024 ではない）
    ("1", "bps", "1", "second"),  # 1 bit -> 1 byte（切り上げが発火する）
    ("8", "bps", "1", "second"),  # ちょうど 1 byte（切り上げは発火しない）
    ("9", "bps", "1", "second"),  # 9 bit -> 2 byte
    ("1", "gbps", "1", "day"),  # 10.8 TB
    ("0", "gbps", "1", "hour"),  # 0 は正当な入力
    (str(1 << 127), "gbps", "1", "second"),  # Overflow
    ("1", "tbps", "1", "second"),  # 知らない単位は SyntaxError
    ("1", "bps", "1", "week"),
]
```

- [ ] **Step 6: 生成器に足す**

```python
def build_transfer() -> dict:
    entries = []
    for bandwidth, bandwidth_unit, duration, duration_unit in cases.TRANSFER_INPUTS:
        result = transfer_ref.compute(bandwidth, bandwidth_unit, duration, duration_unit)
        entries.append(
            {
                "id": f"transfer/{bandwidth}{bandwidth_unit}x{duration}{duration_unit}",
                "op": "transfer",
                "input": {
                    "bandwidth": bandwidth,
                    "bandwidth_unit": bandwidth_unit,
                    "duration": duration,
                    "duration_unit": duration_unit,
                },
                "expect": result,
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }
```

`main()` に `write("transfer.json", build_transfer())` を足す。import にも `transfer_ref` を加える。

- [ ] **Step 7: 生成して既存 golden の不変を確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff --exit-code testdata/data_scale.json testdata/llm.json && echo "既存 golden は不変"
```
Expected: `transfer.json` だけが新規（10 件）

- [ ] **Step 8: 参照側を全部回す**

Run: `cd reference && uv run --no-config pytest -q`
Expected: すべて PASS

- [ ] **Step 9: コミット**

```bash
git add reference testdata/transfer.json
git commit   # 例: "A kilobit per second is a thousand bits, not 1024"
```
