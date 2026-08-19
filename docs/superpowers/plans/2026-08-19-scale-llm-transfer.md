# S-0 Scale 刷新（入力方式・LLM・Data Transfer） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale 系統に LLM メモリと Data Transfer の 2 カテゴリを足し、次元数の入力を「選択（既定）／手入力」の面の入れ替えにする。

**Architecture:** 計算は `calcarc-core` の新モジュール 2 つ（`data_scale/llm.rs`、`data_scale/transfer.rs`）に置き、内部はビットの u128 厳密整数で持って表示の直前にバイトへ切り上げる。表示器（`data_scale/format.rs`）と 3 桁区切りは既存を共有する。WASM は**追加のみ**（既存 `data_scale` の署名は 1 文字も変えない）。UI は既存の「面の入れ替え」機構だけで作り、新しい UI 部品を作らない。

**Tech Stack:** Rust（calcarc-core / calcarc-wasm、wasm-bindgen + serde）、TypeScript + React（CSS Modules）、Python（参照実装、uv + pytest）、Playwright（E2E）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-19-scale-llm-transfer-design.md`
**【訂正 2026-08-19】が 2 つ入っている。実装者は訂正のほうに従う**（Self-Review 4 に一覧）:
§2・§4.2 = 面の枠は 4 列 × 4 行ではなく **5 列 × 5 行**（`52ca5c8`）、
§3.4 = 2 つの切り上げは**いまのビット幅では必ず一致する**（`c950d56` ＋ 理由文の直し）。

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


def test_the_kv_side_is_always_a_whole_number_of_bytes() -> None:
    # spec §3.1: kv_bits = 2 × … × {4,8,16,32} bit は**常に 8 の倍数**である。
    # だから「それぞれ切り上げてから足す」（§3.4）と「まとめて割る」は、いまの
    # いまの精度では必ず一致する——**分けて書く理由は将来の精度**であって、
    # 現に食い違うからではない（§3.4 の【訂正 2026-08-19】）。
    # ここで測るのはその前提そのもの: KV 側に端数が出ないこと。
    # **コアは 5 つとも受ける**ので 5 つとも測る（盤面が KV に出すのは 4 つ）。
    # 端数が出ない根拠は「ビット幅が 4 の倍数」であって「4 以上」ではない
    # ——6 bit は 4 以上だが 2 × 6 = 12 で破れる。
    bits = {"fp32": 32, "fp16": 16, "bf16": 16, "int8": 8, "int4": 4}
    for kv, per in bits.items():
        r = compute("1", "int4", "3", "5", "7", "11", kv)
        assert int(r["kv"]["bytes"]) * 8 == 2 * 3 * 11 * 5 * 7 * per
    # 重み側だけは端が出る（int4 × 奇数パラメータ）。
    assert compute("1", "int4", "1", "1", "1", "1", "int8")["total"]["bytes"] == "3"


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


def test_the_ceiling_is_bracketed_from_both_sides() -> None:
    # int8 は 8 bit なので、ビット数が u128 に収まる最大のパラメータ数は
    # 2^125 - 1（(2^125 - 1) × 8 = 2^128 - 8）。**通る側とあふれる側を
    # 2 件で挟む**——片側だけだと、上限が動いてもどちらも緑のままになる。
    inside = compute(str((1 << 125) - 1), "int8", "1", "1", "1", "0", "fp16")
    assert inside["weight"]["bytes"] == str((1 << 125) - 1)
    assert compute(str(1 << 125), "int8", "1", "1", "1", "0", "fp16") == {
        "error": "Overflow"
    }
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
    # 重みと KV の両方が端数を持つ最小の構成（spec §3.4 の形が見える 1 件）
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
    # **u128 上限の直下は通る。** int8 は 1 パラメータ 8 bit なので、ビット数が
    # 上限に収まる最大のパラメータ数は 2^125 - 1（(2^125 - 1) × 8 = 2^128 - 8）。
    # **1 つ上の 2^125 は 2^128 ちょうどであふれる**——内側と外側で挟む。
    (str((1 << 125) - 1), "int8", "1", "1", "1", "0", "fp16"),
    (str(1 << 125), "int8", "1", "1", "1", "0", "fp16"),
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
Expected: `testdata/llm.json` だけが新規（**17 件**）。**`data_scale.json` に差分が出たら Step 3 の書き換えが値を変えている**——戻して原因を潰す。

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

from calcarc_reference.data_scale_ref import U128_MAX, lines, parse_u128

BANDWIDTH_FACTOR = {"bps": 1, "kbps": 10**3, "mbps": 10**6, "gbps": 10**9}
DURATION_FACTOR = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}

# **`parse_u128` は自分で書かない**（Task 1 のレビュー指摘）。u128 の定義域の
# 読み取りは 3 つの参照実装で 1 つである——写すと、上限が動いた日に片方だけ
# 直る。


def compute(
    bandwidth: str, bandwidth_unit: str, duration: str, duration_unit: str
) -> dict:
    value = parse_u128(bandwidth)
    seconds = parse_u128(duration)
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

---

### Task 3: Rust コア `llm.rs` と golden 突き合わせ

**Files:**
- Create: `crates/calcarc-core/src/data_scale/llm.rs`
- Create: `crates/calcarc-core/tests/llm_golden.rs`
- Modify: `crates/calcarc-core/src/data_scale/mod.rs`（`pub mod llm;`）

**Interfaces:**
- Consumes: `testdata/llm.json`（Task 1）、`crate::{CalcError, CalcResult}`、`data_scale::format::{format_binary, format_decimal, group_digits}`
- Produces:
  - `calcarc_core::data_scale::llm::Precision`（`Fp32|Fp16|Bf16|Int8|Int4`、`ALL: [Precision; 5]`、`from_token(&str) -> Option<Precision>`、`token(self) -> &'static str`、`bits(self) -> u128`）
  - `calcarc_core::data_scale::llm::LlmMemory { weight_bytes: u128, kv_bytes: u128, total_bytes: u128 }`
  - `calcarc_core::data_scale::llm::memory(parameters: u128, weight: Precision, layers: u128, kv_heads: u128, head_dim: u128, context_length: u128, kv: Precision) -> CalcResult<LlmMemory>`

**Note:** **Python の実装を読まずに書く。** 見るのは spec §3.2〜§3.4・§3.6 と、既存の `data_scale/mod.rs`（型と流儀の先例）だけである。golden はその 2 つが独立に同じ契約へ着地したかを見るためにある——片方を写したら、その検査は何も検査しなくなる。

- [ ] **Step 1: golden 突き合わせを書く（実装より先）**

```rust
// crates/calcarc-core/tests/llm_golden.rs
//! llm の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。整数と決定的な丸めに許容誤差は存在しないので、
//! このファイルの golden は tolerance を持たない(data_scale_golden と同じ)。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::data_scale::format::{format_binary, format_decimal, group_digits};
use calcarc_core::data_scale::llm::{self, Precision};
use calcarc_core::data_scale::parse_count;
use serde::Deserialize;

const SCHEMA: u32 = 1;

#[derive(Debug, Deserialize)]
struct Golden {
    schema: u32,
    generated_by: String,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    input: Input,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct Input {
    parameters: String,
    weight_precision: String,
    layers: String,
    kv_heads: String,
    head_dim: String,
    context_length: String,
    kv_precision: String,
}

#[derive(Debug, Deserialize)]
struct Lines {
    bytes: String,
    bytes_grouped: String,
    decimal: Option<String>,
    binary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    weight: Option<Lines>,
    #[serde(default)]
    kv: Option<Lines>,
    #[serde(default)]
    total: Option<Lines>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "testdata", "llm.json"]
        .iter()
        .collect();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e}. Run reference/scripts/generate.py",
            path.display()
        )
    });
    let golden: Golden = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
    assert_eq!(golden.schema, SCHEMA, "incompatible schema");
    assert!(!golden.cases.is_empty(), "no cases");
    golden
}

fn run(input: &Input) -> Result<llm::LlmMemory, CalcError> {
    let parameters = parse_count(&input.parameters)?;
    let layers = parse_count(&input.layers)?;
    let kv_heads = parse_count(&input.kv_heads)?;
    let head_dim = parse_count(&input.head_dim)?;
    let context_length = parse_count(&input.context_length)?;
    let weight = Precision::from_token(&input.weight_precision).ok_or(CalcError::SyntaxError)?;
    let kv = Precision::from_token(&input.kv_precision).ok_or(CalcError::SyntaxError)?;
    llm::memory(
        parameters,
        weight,
        layers,
        kv_heads,
        head_dim,
        context_length,
        kv,
    )
}

/// 1 組(bytes / 3 桁区切り / 10 進 / 2 進)を突き合わせる。
fn check(bytes: u128, expected: &Option<Lines>, id: &str, which: &str) {
    let expected = expected
        .as_ref()
        .unwrap_or_else(|| panic!("{id}: golden has no {which} block"));
    assert_eq!(bytes.to_string(), expected.bytes, "{id}: {which} bytes");
    assert_eq!(
        group_digits(bytes),
        expected.bytes_grouped,
        "{id}: {which} grouped"
    );
    assert_eq!(
        format_decimal(bytes),
        expected.decimal,
        "{id}: {which} decimal"
    );
    assert_eq!(format_binary(bytes), expected.binary, "{id}: {which} binary");
}

#[test]
fn llm_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    // **何件をどちらの枝で見たかを数える。** ループだけだと、全件が error 枝に
    // 落ちた日でもこのテストは緑を返す(tests-can-assert-nothing)。
    let mut ok = 0usize;
    let mut errors = 0usize;

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok(memory), None) => {
                check(memory.weight_bytes, &case.expect.weight, &case.id, "weight");
                check(memory.kv_bytes, &case.expect.kv, &case.id, "kv");
                check(memory.total_bytes, &case.expect.total, &case.id, "total");
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
    assert!(ok >= 12, "only {ok} successful cases compared");
    assert!(errors >= 4, "only {errors} error cases compared");
}
```

- [ ] **Step 2: 赤（コンパイルが通らない）を見る**

Run: `cargo test -p calcarc-core --test llm_golden`
Expected: FAIL（`unresolved import calcarc_core::data_scale::llm`）

- [ ] **Step 3: `llm.rs` を書く**

```rust
//! LLM のメモリ見積り(S-0 設計書 §3.2〜§3.4)。
//!
//! **内部はすべてビットで持ち、表示の直前にバイトへ切り上げる**(§3.1)。
//! バイト数は Exact Integer で、u128 の checked 演算で持つ。あふれは
//! 黙って折り返さず Overflow(§3.6)。**実行時メモリの推定はしない**——
//! 一時バッファもアロケータの挙動も、モデルの諸元からは決まらない(§8)。

use crate::{CalcError, CalcResult};

/// 重みと KV の精度。
///
/// **ビット幅は定義値である**(IEEE 754 の binary32 / binary16、bfloat16 の
/// 16 bit、整数型のビット幅)。INT4 は 4 bit = 0.5 byte の理論値で、GGUF 等の
/// 実ファイルとは一致しない——scale・zero point・メタデータ・アラインメントが
/// 載るためである(§3.2)。
///
/// **重みと KV で同じ型を使う。** 盤面が KV に出す候補は 4 つだが(§4.3)、
/// コアで 4 つに絞ると根拠のない定義域が計算層に生まれる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    Fp32,
    Fp16,
    Bf16,
    Int8,
    Int4,
}

impl Precision {
    /// 境界(WASM / JS)とテストが参照する全体。
    pub const ALL: [Precision; 5] = [
        Precision::Fp32,
        Precision::Fp16,
        Precision::Bf16,
        Precision::Int8,
        Precision::Int4,
    ];

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Precision> {
        Some(match token {
            "fp32" => Precision::Fp32,
            "fp16" => Precision::Fp16,
            "bf16" => Precision::Bf16,
            "int8" => Precision::Int8,
            "int4" => Precision::Int4,
            _ => return None,
        })
    }

    /// 境界へ渡す文字列トークン。`from_token` の逆写像。
    pub fn token(self) -> &'static str {
        match self {
            Precision::Fp32 => "fp32",
            Precision::Fp16 => "fp16",
            Precision::Bf16 => "bf16",
            Precision::Int8 => "int8",
            Precision::Int4 => "int4",
        }
    }

    /// 要素 1 つのビット数。
    pub fn bits(self) -> u128 {
        match self {
            Precision::Fp32 => 32,
            Precision::Fp16 | Precision::Bf16 => 16,
            Precision::Int8 => 8,
            Precision::Int4 => 4,
        }
    }
}

/// 1 回の見積り。**重みと KV は別々に切り上げてから足す**(§3.4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmMemory {
    pub weight_bytes: u128,
    pub kv_bytes: u128,
    pub total_bytes: u128,
}

fn mul(a: u128, b: u128) -> CalcResult<u128> {
    a.checked_mul(b).ok_or(CalcError::Overflow)
}

/// 重み ＋ KV cache。バッチサイズは 1 で固定する(§3.3、§8)。
///
/// `kv_heads` は **KV ヘッド数**であって、アテンションヘッド数ではない
/// ——GQA のモデルでは 32 → 8 のように減っており、取り違えると 4 倍ずれる。
pub fn memory(
    parameters: u128,
    weight: Precision,
    layers: u128,
    kv_heads: u128,
    head_dim: u128,
    context_length: u128,
    kv: Precision,
) -> CalcResult<LlmMemory> {
    let weight_bits = mul(parameters, weight.bits())?;
    // 並びは §3.3 のとおり。**左から順に checked_mul する**——あふれた後に
    // 0 が来ても救わないのが契約である(§3.6)。
    let mut kv_bits = 2u128;
    for factor in [layers, context_length, kv_heads, head_dim, kv.bits()] {
        kv_bits = mul(kv_bits, factor)?;
    }
    // **切り上げる**——4 bit の重みが 1 個だけあるとき「0 バイト」と
    // 言わないためである(§3.1)。KV 側は常に 8 の倍数なので、この
    // 切り上げは**重み側でしか発火しない**(§3.1 が実測で書いている)。
    let weight_bytes = weight_bits.div_ceil(8);
    let kv_bytes = kv_bits.div_ceil(8);
    // **この枝は到達しない。** どちらも ceil(u128::MAX / 8) = 2^125 以下
    // なので、和は 2^126 で頭打ちになる。それでも checked_add で書く
    // ——「到達不能だから素の +」は、証明が崩れた日に panic になる。
    let total_bytes = weight_bytes
        .checked_add(kv_bytes)
        .ok_or(CalcError::Overflow)?;
    Ok(LlmMemory {
        weight_bytes,
        kv_bytes,
        total_bytes,
    })
}
```

`data_scale/mod.rs` の `pub mod format;` の隣に `pub mod llm;` を足す。

- [ ] **Step 4: ユニットテストを `llm.rs` の末尾に書く**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_headline_case() {
        // 27B INT4 / 62 層 / KV 16 ヘッド / ヘッド次元 128 / 文脈長 8192 / KV FP16(§5)
        let m = memory(
            27_000_000_000,
            Precision::Int4,
            62,
            16,
            128,
            8192,
            Precision::Fp16,
        )
        .expect("headline case");
        assert_eq!(m.weight_bytes, 13_500_000_000);
        assert_eq!(m.kv_bytes, 4_160_749_568);
        assert_eq!(m.total_bytes, 17_660_749_568);
        assert_eq!(m.weight_bytes + m.kv_bytes, m.total_bytes);
    }

    #[test]
    fn kv_heads_is_not_the_attention_head_count() {
        // GQA: 32 → 8。取り違えるとちょうど 4 倍になる(§3.3)。
        let grouped = memory(
            8_000_000_000,
            Precision::Int8,
            32,
            8,
            128,
            4096,
            Precision::Fp16,
        )
        .expect("gqa");
        let mistaken = memory(
            8_000_000_000,
            Precision::Int8,
            32,
            32,
            128,
            4096,
            Precision::Fp16,
        )
        .expect("mha");
        assert_eq!(grouped.kv_bytes, 536_870_912);
        assert_eq!(mistaken.kv_bytes, grouped.kv_bytes * 4);
    }

    #[test]
    fn a_single_int4_parameter_is_one_byte_not_zero() {
        // 切り上げ(§3.1)。**重み側にしか無い端である。**
        let m = memory(1, Precision::Int4, 1, 8, 128, 0, Precision::Fp16).expect("edge");
        assert_eq!((m.weight_bytes, m.kv_bytes, m.total_bytes), (1, 0, 1));
    }

    #[test]
    fn the_kv_side_never_needs_the_ceiling() {
        // §3.1 の主張そのもの: kv_bits は常に 8 の倍数。5 つの精度で確かめる。
        for kv in Precision::ALL {
            let m = memory(1, Precision::Int8, 3, 5, 7, 11, kv).expect("kv");
            assert_eq!(
                m.kv_bytes * 8,
                2 * 3 * 11 * 5 * 7 * kv.bits(),
                "{kv:?} left a remainder"
            );
        }
    }

    #[test]
    fn every_precision_has_its_width() {
        let expect: [(Precision, u128); 5] = [
            (Precision::Fp32, 32),
            (Precision::Fp16, 16),
            (Precision::Bf16, 16),
            (Precision::Int8, 8),
            (Precision::Int4, 4),
        ];
        for (p, bits) in expect {
            assert_eq!(p.bits(), bits, "{p:?}");
        }
    }

    #[test]
    fn tokens_round_trip() {
        for p in Precision::ALL {
            assert_eq!(Precision::from_token(p.token()), Some(p), "{p:?}");
        }
        assert_eq!(Precision::from_token("fp8"), None);
        assert_eq!(Precision::from_token(""), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_wrap() {
        let big = 1u128 << 127;
        assert_eq!(
            memory(big, Precision::Fp32, 1, 1, 1, 0, Precision::Fp16),
            Err(CalcError::Overflow)
        );
        // **順序が効く。** 2 × layers であふれた時点で終わり、後ろの 0 は救わない。
        assert_eq!(
            memory(1, Precision::Int8, big, 1, 1, 0, Precision::Fp16),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn zero_context_is_a_valid_input() {
        let m = memory(1_000_000, Precision::Fp16, 10, 8, 64, 0, Precision::Fp16).expect("zero");
        assert_eq!(m.kv_bytes, 0);
        assert_eq!(m.total_bytes, m.weight_bytes);
    }
}
```

- [ ] **Step 5: 緑を見る**

```bash
cargo test -p calcarc-core llm
cargo test --workspace
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
```
Expected: すべて PASS。golden は **17 件**（成功 13 / エラー 4）を比較する

- [ ] **Step 6: 赤確認（spec §7 の 1〜3）**

**手順**: 変異の前に一時コミットを作り、戻すのは**変異箇所の再編集**である（`git checkout -- <file>` はこのファイルの他の作業も巻き戻す）。3 つとも `cargo test -p calcarc-core llm` を回して、**落ちたテスト名と件数を控える**。

| | 変異 | 落ちるはず |
|---|---|---|
| 1 | **【訂正 2026-08-19】** 当初は「`kv_heads` と `head_dim` を入れ替える」だったが、**掛け算は可換なので当てられない**（実際に入れ替えて 0 件失敗を確認した）。**代わりに `[layers, context_length, …]` を `[context_length, layers, …]` に入れ替える** | `llm_golden` の `llm/1xint8/170141183460469231731687303715884105728x1x1x0xfp16`。積は変わらないが**あふれの位置が変わる**——`2 × 0 = 0` を先に通してしまい、`Overflow` が `0` になる。**掛け算の可換性が届かないのは、あふれの位置だけである** |
| 2 | `let mut kv_bits = 2u128;` を `= 1u128;` に（K と V の 2 本を落とす） | `llm_golden` の KV を持つ全件と `the_headline_case` |
| 3 | `weight_bits.div_ceil(8)` を `weight_bits / 8` に（切り上げ → 切り捨て） | `a_single_int4_parameter_is_one_byte_not_zero` と `llm_golden` の `llm/1xint4/...` |

**3 が赤にならなければ、端の格子を 1 件も置いていない**——緑のまま何も主張しない検査になっている（spec §7）。

**なぜ 1 が差し替わったか**（Task 3 で実測して分かったこと）: `kv_heads` と `head_dim` は
`kv_bits` の中で**掛け合わされるだけ**なので、入れ替えても積は変わらない。**2 つを
取り違えても答えは 1 バイトも変わらない**——利用者が 2 つの欄を入れ違えて打っても
同じ数が出る。**取り違えを検出する検査は原理的に書けない**ので、区別を担うのは
盤面の言葉（キーのラベルと読み上げ名、Task 8・9）だけである。

- [ ] **Step 7: 変異を戻し、木が綺麗なことを確かめる**

```bash
git status --porcelain    # 空であること
cargo test -p calcarc-core llm
```

- [ ] **Step 8: コミット**

```bash
git add crates/calcarc-core
git commit   # 例: "Count the KV heads, which are not the attention heads"
```

---

### Task 4: Rust コア `transfer.rs` と golden 突き合わせ

**Files:**
- Create: `crates/calcarc-core/src/data_scale/transfer.rs`
- Create: `crates/calcarc-core/tests/transfer_golden.rs`
- Modify: `crates/calcarc-core/src/data_scale/mod.rs`（`pub mod transfer;`）

**Interfaces:**
- Consumes: `testdata/transfer.json`（Task 2）
- Produces:
  - `data_scale::transfer::BandwidthUnit`（`Bps|Kbps|Mbps|Gbps`、`ALL`、`from_token`、`token`、`bits_per_second(self) -> u128`）
  - `data_scale::transfer::DurationUnit`（`Second|Minute|Hour|Day`、`ALL`、`from_token`、`token`、`seconds(self) -> u128`）
  - `data_scale::transfer::transferred_bytes(bandwidth: u128, unit: BandwidthUnit, duration: u128, per: DurationUnit) -> CalcResult<u128>`

- [ ] **Step 1: golden 突き合わせを書く**

`llm_golden.rs` と同じ骨格で、`Input` は 4 つ、`Expect` は 1 組（`bytes` / `bytes_grouped` / `decimal` / `binary` / `error`）。`data_scale_golden.rs` の `Expect` をそのまま使える形である。**件数の下限も同じように主張する**（成功 ≥ 6、エラー ≥ 3）。

```rust
// crates/calcarc-core/tests/transfer_golden.rs（要点のみ。骨格は llm_golden.rs と同形）
#[derive(Debug, Deserialize)]
struct Input {
    bandwidth: String,
    bandwidth_unit: String,
    duration: String,
    duration_unit: String,
}

fn run(input: &Input) -> Result<u128, CalcError> {
    let bandwidth = parse_count(&input.bandwidth)?;
    let duration = parse_count(&input.duration)?;
    let unit = BandwidthUnit::from_token(&input.bandwidth_unit).ok_or(CalcError::SyntaxError)?;
    let per = DurationUnit::from_token(&input.duration_unit).ok_or(CalcError::SyntaxError)?;
    transfer::transferred_bytes(bandwidth, unit, duration, per)
}
```

- [ ] **Step 2: 赤（コンパイルが通らない）を見る**

Run: `cargo test -p calcarc-core --test transfer_golden`
Expected: FAIL（`unresolved import`）

- [ ] **Step 3: `transfer.rs` を書く**

```rust
//! Data Transfer(S-0 設計書 §3.5)。帯域幅 × 時間 → バイト数。
//!
//! **帯域幅は 10 進である**——`kbps` の `k` は 1024 ではない。出典は SI
//! 接頭辞(k = 10³、M = 10⁶、G = 10⁹)と、時間の 60 / 3600 / 86400 秒。
//! **入力は bit、表示は byte** で、ここが混同されやすい。
//!
//! **切り上げはここで実際に発火する**(1 bit は 1 byte に満たない)。
//! LLM 側の KV cache と違い、bit 数が 8 の倍数になる保証は無い。

use crate::{CalcError, CalcResult};

/// 帯域幅の単位。係数は 1 秒あたりのビット数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BandwidthUnit {
    Bps,
    Kbps,
    Mbps,
    Gbps,
}

impl BandwidthUnit {
    pub const ALL: [BandwidthUnit; 4] = [
        BandwidthUnit::Bps,
        BandwidthUnit::Kbps,
        BandwidthUnit::Mbps,
        BandwidthUnit::Gbps,
    ];

    pub fn from_token(token: &str) -> Option<BandwidthUnit> {
        Some(match token {
            "bps" => BandwidthUnit::Bps,
            "kbps" => BandwidthUnit::Kbps,
            "mbps" => BandwidthUnit::Mbps,
            "gbps" => BandwidthUnit::Gbps,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            BandwidthUnit::Bps => "bps",
            BandwidthUnit::Kbps => "kbps",
            BandwidthUnit::Mbps => "mbps",
            BandwidthUnit::Gbps => "gbps",
        }
    }

    /// 1 秒あたりのビット数。**10 進である**(1024 ではない)。
    pub fn bits_per_second(self) -> u128 {
        match self {
            BandwidthUnit::Bps => 1,
            BandwidthUnit::Kbps => 1_000,
            BandwidthUnit::Mbps => 1_000_000,
            BandwidthUnit::Gbps => 1_000_000_000,
        }
    }
}

/// 時間の単位。係数は秒。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DurationUnit {
    Second,
    Minute,
    Hour,
    Day,
}

impl DurationUnit {
    pub const ALL: [DurationUnit; 4] = [
        DurationUnit::Second,
        DurationUnit::Minute,
        DurationUnit::Hour,
        DurationUnit::Day,
    ];

    pub fn from_token(token: &str) -> Option<DurationUnit> {
        Some(match token {
            "second" => DurationUnit::Second,
            "minute" => DurationUnit::Minute,
            "hour" => DurationUnit::Hour,
            "day" => DurationUnit::Day,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            DurationUnit::Second => "second",
            DurationUnit::Minute => "minute",
            DurationUnit::Hour => "hour",
            DurationUnit::Day => "day",
        }
    }

    pub fn seconds(self) -> u128 {
        match self {
            DurationUnit::Second => 1,
            DurationUnit::Minute => 60,
            DurationUnit::Hour => 3_600,
            DurationUnit::Day => 86_400,
        }
    }
}

/// 転送量をバイトで返す。あふれたら Overflow(§3.6)。
pub fn transferred_bytes(
    bandwidth: u128,
    unit: BandwidthUnit,
    duration: u128,
    per: DurationUnit,
) -> CalcResult<u128> {
    // 左から順に checked_mul する(§3.6)。
    let mut bits = bandwidth;
    for factor in [unit.bits_per_second(), duration, per.seconds()] {
        bits = bits.checked_mul(factor).ok_or(CalcError::Overflow)?;
    }
    Ok(bits.div_ceil(8))
}
```

`data_scale/mod.rs` に `pub mod transfer;` を足す。

- [ ] **Step 4: ユニットテストを `transfer.rs` の末尾に書く**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_headline_case() {
        // 100 Mbps × 3 時間 = 135,000,000,000 bytes(§3.5)
        assert_eq!(
            transferred_bytes(100, BandwidthUnit::Mbps, 3, DurationUnit::Hour),
            Ok(135_000_000_000)
        );
    }

    #[test]
    fn kilo_is_a_thousand_not_1024() {
        assert_eq!(BandwidthUnit::Kbps.bits_per_second(), 1_000);
        assert_eq!(
            transferred_bytes(512, BandwidthUnit::Kbps, 30, DurationUnit::Minute),
            Ok(115_200_000)
        );
    }

    #[test]
    fn a_partial_byte_rounds_up() {
        assert_eq!(
            transferred_bytes(1, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(1)
        );
        assert_eq!(
            transferred_bytes(8, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(1)
        );
        assert_eq!(
            transferred_bytes(9, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(2)
        );
    }

    #[test]
    fn every_unit_has_its_factor() {
        let bandwidth: [(BandwidthUnit, u128); 4] = [
            (BandwidthUnit::Bps, 1),
            (BandwidthUnit::Kbps, 1_000),
            (BandwidthUnit::Mbps, 1_000_000),
            (BandwidthUnit::Gbps, 1_000_000_000),
        ];
        for (u, factor) in bandwidth {
            assert_eq!(u.bits_per_second(), factor, "{u:?}");
        }
        let duration: [(DurationUnit, u128); 4] = [
            (DurationUnit::Second, 1),
            (DurationUnit::Minute, 60),
            (DurationUnit::Hour, 3_600),
            (DurationUnit::Day, 86_400),
        ];
        for (u, seconds) in duration {
            assert_eq!(u.seconds(), seconds, "{u:?}");
        }
    }

    #[test]
    fn tokens_round_trip() {
        for u in BandwidthUnit::ALL {
            assert_eq!(BandwidthUnit::from_token(u.token()), Some(u), "{u:?}");
        }
        for u in DurationUnit::ALL {
            assert_eq!(DurationUnit::from_token(u.token()), Some(u), "{u:?}");
        }
        assert_eq!(BandwidthUnit::from_token("tbps"), None);
        assert_eq!(DurationUnit::from_token("week"), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_wrap() {
        assert_eq!(
            transferred_bytes(1u128 << 127, BandwidthUnit::Gbps, 1, DurationUnit::Second),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn zero_is_a_valid_input() {
        assert_eq!(
            transferred_bytes(0, BandwidthUnit::Gbps, 1, DurationUnit::Hour),
            Ok(0)
        );
    }
}
```

- [ ] **Step 5: 緑を見る**

```bash
cargo test -p calcarc-core transfer
cargo test --workspace
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
```

- [ ] **Step 6: 赤確認（spec §7 の 4）＋ もう 1 つ**

| | 変異 | 落ちるはず |
|---|---|---|
| 4 | `BandwidthUnit::Kbps => 1_000` を `1_024` に | `kilo_is_a_thousand_not_1024` と `transfer_golden` の `transfer/512kbpsx30minute` |
| 追加 | `bits.div_ceil(8)` を `bits / 8` に | `a_partial_byte_rounds_up` と `transfer_golden` の 1 bps / 9 bps の 2 件。**LLM 側と違い、ここは切り上げが実際に走る経路である** |

- [ ] **Step 7: 変異を戻し、`git status --porcelain` が空であることを確かめる**

- [ ] **Step 8: コミット**

```bash
git add crates/calcarc-core
git commit   # 例: "Bandwidth counts in thousands, and a stray bit still costs a byte"
```

---

### Task 5: WASM 境界・`UnitSet::Params`・TypeScript のラッパ

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`（**追加のみ**）
- Modify: `crates/calcarc-core/src/expr/mod.rs`（`UnitSet::Params`）
- Modify: `crates/calcarc-wasm/tests/token_parity.rs`（3 つの配列）
- Modify: `crates/calcarc-wasm/tests/web.rs`（境界を実ブラウザで 1 度通す）
- Modify: `web/src/datascale/types.ts`、`web/src/datascale/index.ts`

**Interfaces:**
- Consumes: Task 3・4 のコア API、`expr::UnitSet`
- Produces:
  - WASM: `llm_memory(parameters, weight_precision, layers, kv_heads, head_dim, context_length, kv_precision) -> JsValue`、`data_transfer(bandwidth, bandwidth_unit, duration, duration_unit) -> JsValue`（**引数はすべて `&str`**）
  - TS: `PRECISION_TOKENS` / `BANDWIDTH_UNIT_TOKENS` / `DURATION_UNIT_TOKENS` と `PrecisionToken` / `BandwidthUnitToken` / `DurationUnitToken`、`ByteLines`、`LlmResult`、`TransferResult`
  - TS: `DataScaleCalc.llm(...)` と `DataScaleCalc.transfer(...)`
  - コア: `expr::UnitSet::Params`（`B` = 10⁹ / `M` = 10⁶）と `unit_set_from_str("params")`

**Note:** **既存の `data_scale` は 1 文字も変えない**（Global Constraints 1）。触ったら `web/src/heavy-harness.ts` 経由のコーパスが壊れる。

- [ ] **Step 1: パラメータ数の単位表を足す（先にテスト）**

`crates/calcarc-core/src/expr/mod.rs` の `#[cfg(test)] mod tests` に足す:

```rust
    #[test]
    fn parameters_count_in_billions() {
        // **`B` は既存の `G` と係数が同じで、ラベルだけが違う**(spec §4.3)
        // ——Data Scale の件数は `G`、LLM のパラメータ数は `B` と呼ぶ慣習である。
        assert_eq!(
            UnitSet::Params.units(),
            vec![('B', 1_000_000_000), ('M', 1_000_000)]
        );
        assert_eq!(unit_set_from_str("params").unwrap(), UnitSet::Params);
        assert_eq!(
            evaluate_to_integer("27B", u128::MAX, UnitSet::Params).unwrap(),
            27_000_000_000
        );
    }
```

`the_unit_sets_are_ordered_downwards` の配列に `UnitSet::Params` を足す。

- [ ] **Step 2: 赤を見る**

Run: `cargo test -p calcarc-core expr`
Expected: FAIL（`no variant named Params`）

- [ ] **Step 3: `UnitSet::Params` を実装する**

```rust
    /// LLM のパラメータ数。**B = 10^9、M = 10^6**。`Count` と係数は同じだが、
    /// モデルカードの慣習では `G` ではなく `B` と呼ぶ(spec §4.3)。
    Params,
```
`units()` に `UnitSet::Params => vec![('B', 1_000_000_000), ('M', 1_000_000)],`、
`unit_set_from_str` に `"params" => Ok(UnitSet::Params),` を足す。

- [ ] **Step 4: 緑を見る**

Run: `cargo test -p calcarc-core expr`

- [ ] **Step 5: WASM の 2 本を足す**

`lib.rs` の `data_scale` の**直後**に置く（既存の関数は動かさない）。

```rust
/// バイト数 1 つぶんの表示 4 点。**LLM は 3 組を返す**ので、DataScaleResult を
/// そのまま 3 つ並べるのではなく、組を型にした(spec §6)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ByteLines {
    bytes: String,
    bytes_grouped: String,
    decimal: Option<String>,
    binary: Option<String>,
}

impl ByteLines {
    fn of(bytes: u128) -> ByteLines {
        ByteLines {
            bytes: bytes.to_string(),
            bytes_grouped: group_digits(bytes),
            decimal: format_decimal(bytes),
            binary: format_binary(bytes),
        }
    }
}

/// LLM の 1 回の見積り。TypeScript 側の `LlmResult` に対応する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmResult {
    weight: Option<ByteLines>,
    kv: Option<ByteLines>,
    total: Option<ByteLines>,
    error: Option<calcarc_core::CalcError>,
}

/// 重み ＋ KV cache を見積もる。純関数で、状態を持たない。
///
/// 入出力が文字列なのは data_scale と同じ理由(JS の number は 2^53 を超えると
/// u128 の定義域を境界で殺す)。**例外は投げない。**
#[wasm_bindgen]
pub fn llm_memory(
    parameters: &str,
    weight_precision: &str,
    layers: &str,
    kv_heads: &str,
    head_dim: &str,
    context_length: &str,
    kv_precision: &str,
) -> JsValue {
    let outcome = (|| {
        let parameters = data_scale::parse_count(parameters)?;
        let layers = data_scale::parse_count(layers)?;
        let kv_heads = data_scale::parse_count(kv_heads)?;
        let head_dim = data_scale::parse_count(head_dim)?;
        let context_length = data_scale::parse_count(context_length)?;
        let weight = Precision::from_token(weight_precision).ok_or(CalcError::SyntaxError)?;
        let kv = Precision::from_token(kv_precision).ok_or(CalcError::SyntaxError)?;
        llm::memory(
            parameters,
            weight,
            layers,
            kv_heads,
            head_dim,
            context_length,
            kv,
        )
    })();
    let result = match outcome {
        Ok(m) => LlmResult {
            weight: Some(ByteLines::of(m.weight_bytes)),
            kv: Some(ByteLines::of(m.kv_bytes)),
            total: Some(ByteLines::of(m.total_bytes)),
            error: None,
        },
        Err(e) => LlmResult {
            weight: None,
            kv: None,
            total: None,
            error: Some(e),
        },
    };
    to_js_value(&result)
}

/// 帯域幅 × 時間 → バイト数。**戻り値の形は data_scale と同じ**(spec §6)
/// ——同じ 4 点なので、TypeScript 側も同じ型で受ける。
#[wasm_bindgen]
pub fn data_transfer(
    bandwidth: &str,
    bandwidth_unit: &str,
    duration: &str,
    duration_unit: &str,
) -> JsValue {
    let outcome = (|| {
        let bandwidth_value = data_scale::parse_count(bandwidth)?;
        let duration_value = data_scale::parse_count(duration)?;
        let unit = BandwidthUnit::from_token(bandwidth_unit).ok_or(CalcError::SyntaxError)?;
        let per = DurationUnit::from_token(duration_unit).ok_or(CalcError::SyntaxError)?;
        transfer::transferred_bytes(bandwidth_value, unit, duration_value, per)
    })();
    let result = match outcome {
        Ok(bytes) => DataScaleResult {
            bytes: Some(bytes.to_string()),
            bytes_grouped: Some(group_digits(bytes)),
            decimal: format_decimal(bytes),
            binary: format_binary(bytes),
            error: None,
        },
        Err(e) => DataScaleResult {
            bytes: None,
            bytes_grouped: None,
            decimal: None,
            binary: None,
            error: Some(e),
        },
    };
    to_js_value(&result)
}
```

import に `use calcarc_core::data_scale::llm::{self, Precision};` と
`use calcarc_core::data_scale::transfer::{self, BandwidthUnit, DurationUnit};` を足す。

- [ ] **Step 6: TypeScript 側の型を足す**

`web/src/datascale/types.ts`（**この順で並べる**。`token_parity.rs` は
`export const X = [` の直後から次の `]` までを読む）:

```ts
/** calcarc-core の data_scale::llm::Precision に対応するトークン。 */
export const PRECISION_TOKENS = [
  "fp32",
  "fp16",
  "bf16",
  "int8",
  "int4",
] as const;

export type PrecisionToken = (typeof PRECISION_TOKENS)[number];

/** calcarc-core の data_scale::transfer::BandwidthUnit に対応するトークン。 */
export const BANDWIDTH_UNIT_TOKENS = ["bps", "kbps", "mbps", "gbps"] as const;

export type BandwidthUnitToken = (typeof BANDWIDTH_UNIT_TOKENS)[number];

/** calcarc-core の data_scale::transfer::DurationUnit に対応するトークン。 */
export const DURATION_UNIT_TOKENS = [
  "second",
  "minute",
  "hour",
  "day",
] as const;

export type DurationUnitToken = (typeof DURATION_UNIT_TOKENS)[number];

/** バイト数 1 つぶんの表示 4 点(calcarc-wasm の ByteLines)。 */
export interface ByteLines {
  bytes: string;
  bytesGrouped: string;
  decimal: string | null;
  binary: string | null;
}

/** calcarc-wasm の LlmResult に対応。3 組を返す(spec §6)。 */
export interface LlmResult {
  weight: ByteLines | null;
  kv: ByteLines | null;
  total: ByteLines | null;
  error: Extract<CalcErrorCode, "Overflow" | "SyntaxError"> | null;
}

/** 転送は data_scale と**同じ形**を返す(spec §6)。別名にするのは呼ぶ側の
 * 読みやすさのためで、構造は 1 つである。 */
export type TransferResult = DataScaleResult;
```

- [ ] **Step 7: ラッパに 2 本足す**

`web/src/datascale/index.ts`:

```ts
import init, { data_scale, data_transfer, llm_memory } from "../wasm/calcarc_wasm.js";

export interface DataScaleCalc {
  compute(count: string, dimensions: string, dtype: DataTypeToken): DataScaleResult;
  /** 重み ＋ KV cache。**引数はすべて 10 進の数字列**(u128 の定義域)。 */
  llm(
    parameters: string,
    weightPrecision: PrecisionToken,
    layers: string,
    kvHeads: string,
    headDim: string,
    contextLength: string,
    kvPrecision: PrecisionToken,
  ): LlmResult;
  transfer(
    bandwidth: string,
    bandwidthUnit: BandwidthUnitToken,
    duration: string,
    durationUnit: DurationUnitToken,
  ): TransferResult;
}
```
`init().then()` の中で 3 つのメソッドを返す。**新しい `init` の経路は作らない**——1 つの WASM モジュールに 3 本の関数がある、というだけである。

- [ ] **Step 8: トークンの二重管理を機械で突き合わせる**

`crates/calcarc-wasm/tests/token_parity.rs` に 3 本足す（既存の
`data_scale_tokens_match_between_typescript_and_rust` と同形）:

```rust
#[test]
fn precision_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/datascale/types.ts");
    let ts = tokens_in_ts_array(src, "export const PRECISION_TOKENS = [");
    let rust: Vec<String> = Precision::ALL.iter().map(|p| p.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/datascale/types.ts の PRECISION_TOKENS と Precision::ALL の token() が食い違っている"
    );
}
```
同じ形で `BANDWIDTH_UNIT_TOKENS` × `BandwidthUnit::ALL`、`DURATION_UNIT_TOKENS` × `DurationUnit::ALL`。

- [ ] **Step 9: 実ブラウザで境界を 1 度通す**

`crates/calcarc-wasm/tests/web.rs` に足す:

```rust
#[wasm_bindgen_test]
fn the_llm_headline_crosses_the_boundary() {
    let value = calcarc_wasm::llm_memory("27000000000", "int4", "62", "16", "128", "8192", "fp16");
    let total = get(&value, "total");
    assert_eq!(
        get(&total, "bytesGrouped").as_string().as_deref(),
        Some("17,660,749,568")
    );
    assert_eq!(get(&total, "decimal").as_string().as_deref(), Some("17.7 GB"));
}

#[wasm_bindgen_test]
fn a_transfer_error_is_a_value_not_an_exception() {
    let value = calcarc_wasm::data_transfer("1", "tbps", "1", "second");
    assert_eq!(
        get(&value, "error").as_string().as_deref(),
        Some("SyntaxError")
    );
}
```

- [ ] **Step 10: 回す**

```bash
cargo test --workspace
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
wasm-pack test --headless --chrome crates/calcarc-wasm
cd web && pnpm wasm && pnpm typecheck && pnpm lint
```
Expected: すべて緑。`pnpm wasm` を回さないと TS 側は新しい 2 本を知らない

- [ ] **Step 11: 赤確認（境界の綴り）**

`web/src/datascale/types.ts` の `PRECISION_TOKENS` の `"bf16"` を `"bfloat16"` に変える → `cargo test -p calcarc-wasm --test token_parity` が赤。**これが緑のままなら、parity テストは配列を掴めていない**（マーカー文字列が合っていない）。戻すのは再編集で。

- [ ] **Step 12: コミット**

```bash
git add crates web/src/datascale
git commit   # 例: "Add two functions at the boundary, and change none"
```

---

### Task 6: Scale の器（3 カテゴリと `<select>`）

**Files:**
- Modify: `web/src/route.ts`、`web/src/route.test.ts`
- Create: `web/src/ui/Scale/ScalePanel.tsx`、`ScalePanel.module.css`、`ScalePanel.test.tsx`
- Modify: `web/src/App.tsx`、`web/src/App.test.tsx`
- Create: `web/tests/e2e/scale-categories.spec.ts`

**Interfaces:**
- Consumes: `routeFromHash`（U-0）、`DataScalePanel`
- Produces:
  - `route.ts`: `export const SCALE_CATEGORIES = ["data-scale", "llm", "transfer"] as const;` と `export type ScaleCategory = (typeof SCALE_CATEGORIES)[number];`
  - `ScalePanel({ category }: { category: string | null })` — カテゴリの `<select>` と、`data-scale` / `llm` / `transfer` の振り分け
- **この時点で `llm` と `transfer` はまだパネルを持たない。** Task 9・10 が入るまでは「準備中」を出す——U-0 の `ConvertPanel` と同じ形にし、**押せて何も起きない面を作らない**（Global Constraints）

- [ ] **Step 1: route のテストを足す（赤にする）**

`web/src/route.test.ts` に:

```ts
  it("reads the three scale categories", () => {
    for (const category of ["data-scale", "llm", "transfer"]) {
      expect(routeFromHash(`#scale/${category}`)).toEqual({
        module: "scale",
        category,
      });
    }
  });
```
既存の `#scale/nope` と `#scale` の 2 件は `data-scale` に倒れたままである（**既定は変えない**。U-0 の裁定）。

- [ ] **Step 2: 赤を見る**

Run: `cd web && pnpm test route`
Expected: FAIL（`#scale/llm` が `data-scale` に倒れる）

- [ ] **Step 3: `route.ts` を直す**

```ts
/** Scale 系統のカテゴリ。**表はここが唯一の出所**——盤面の `<select>` も
 * この配列から起こす(U-0 §3 の「同じ画面に 2 つの URL を作らない」)。 */
export const SCALE_CATEGORIES = ["data-scale", "llm", "transfer"] as const;

export type ScaleCategory = (typeof SCALE_CATEGORIES)[number];
```
`CATEGORIES.scale` を `SCALE_CATEGORIES` にする。`DEFAULT_CATEGORY.scale` は `"data-scale"` のまま。

- [ ] **Step 4: 緑を見る**

Run: `cd web && pnpm test route`

- [ ] **Step 5: `ScalePanel` のテストを書く**

```tsx
// web/src/ui/Scale/ScalePanel.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScalePanel } from "./ScalePanel";

describe("ScalePanel", () => {
  it("shows the data scale panel for the default category", () => {
    render(<ScalePanel category="data-scale" />);
    expect(
      screen.getByRole("region", { name: "データスケール計算" }),
    ).toBeInTheDocument();
  });

  it("lists every category exactly once", () => {
    render(<ScalePanel category="data-scale" />);
    const select = screen.getByRole("combobox", { name: "計算の種類" });
    const labels = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    // **件数を主張する。** ループだけだと、選択肢が 0 個になった日も緑になる。
    expect(labels).toEqual(["データ量", "LLM のメモリ", "データ転送"]);
  });

  it("moves the hash when the category changes", async () => {
    render(<ScalePanel category="data-scale" />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "計算の種類" }),
      "llm",
    );
    // **画面を直接差し替えない。** hash を書き、購読が state を更新する
    // (U-0 の「hash が唯一の出所」)。
    expect(window.location.hash).toBe("#scale/llm");
  });
});
```

- [ ] **Step 6: 赤を見る**

Run: `cd web && pnpm test ScalePanel`
Expected: FAIL（モジュールが無い）

- [ ] **Step 7: `ScalePanel.tsx` を書く**

```tsx
import { type ScaleCategory, SCALE_CATEGORIES } from "../../route";
import { DataScalePanel } from "../DataScale/DataScalePanel";
import styles from "./ScalePanel.module.css";

/** カテゴリの表示名。**`Record` にするのは、カテゴリが増えたときに
 * ここを埋め忘れると型が落ちるからである**(Nav の MODULES と同じ流儀)。 */
const LABELS: Record<ScaleCategory, string> = {
  "data-scale": "データ量",
  llm: "LLM のメモリ",
  transfer: "データ転送",
};

function isCategory(text: string | null): text is ScaleCategory {
  return (SCALE_CATEGORIES as readonly string[]).includes(text ?? "");
}

export function ScalePanel({ category }: { category: string | null }) {
  // route が既定へ倒しているので null は来ないが、型の上では来る。
  const current: ScaleCategory = isCategory(category) ? category : "data-scale";

  return (
    <div className={styles.scale}>
      {/* **リンクではなく select である**(spec §4.1)——縦を 1 行しか
          使わないため。hash を書き換えるだけで、画面はハッシュの購読が
          差し替える(U-0 §3)。 */}
      <select
        className={styles.category}
        aria-label="計算の種類"
        value={current}
        onChange={(e) => {
          window.location.hash = `#scale/${e.target.value}`;
        }}
      >
        {SCALE_CATEGORIES.map((id) => (
          <option key={id} value={id}>
            {LABELS[id]}
          </option>
        ))}
      </select>
      {current === "data-scale" && <DataScalePanel />}
      {current === "llm" && <ComingSoon what="LLM のメモリ" />}
      {current === "transfer" && <ComingSoon what="データ転送" />}
    </div>
  );
}

/** Task 9・10 が入るまでの中身。**押せて何も起きない面を作らない**ため、
 * 選べば画面は変わる(U-0 §5 と同じ形)。 */
function ComingSoon({ what }: { what: string }) {
  return (
    <section className={styles.placeholder} aria-label={`${what}（準備中）`}>
      <p>{what}は準備中です。</p>
    </section>
  );
}
```

CSS は `.scale`（`display: flex; flex-direction: column; gap: 12px;`）、`.category`（`min-height: var(--touch-target-min)`、`font-size: var(--key-font-size-function)`、色は `--display-bg` / `--display-fg`）、`.placeholder`（`ConvertPanel.module.css` と同じ流儀）。**44px を割らない。**

- [ ] **Step 8: 緑を見る**

Run: `cd web && pnpm test ScalePanel`

- [ ] **Step 9: `App` を差し替える**

`App.tsx` の `{route.module === "scale" && <DataScalePanel />}` を
`{route.module === "scale" && <ScalePanel category={route.category} />}` に。
`App.test.tsx` に `#scale/llm` で ScalePanel が出ることの 1 件を足す。

- [ ] **Step 10: E2E を書く**

```ts
// web/tests/e2e/scale-categories.spec.ts
import { expect, type Page, test } from "@playwright/test";

const select = (page: Page) =>
  page.getByRole("combobox", { name: "計算の種類" });

test("every category has a deep link that lands on it", async ({ page }) => {
  const seen: string[] = [];
  for (const [category, name] of [
    ["data-scale", "データ量"],
    ["llm", "LLM のメモリ"],
    ["transfer", "データ転送"],
  ] as const) {
    await page.goto(`/#scale/${category}`);
    await expect(select(page)).toHaveValue(category);
    seen.push(name);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(3);
});

test("choosing a category moves the hash and the panel", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  await select(page).selectOption("transfer");
  await expect(page).toHaveURL(/#scale\/transfer$/);
  await expect(select(page)).toHaveValue("transfer");
  // 戻れる。
  await page.goBack();
  await expect(page).toHaveURL(/#scale\/data-scale$/);
});

test("the category select is large enough to touch", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  const box = await select(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 11: 回す**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
cd web && pnpm e2e scale-categories.spec.ts data-scale.spec.ts nav.spec.ts
```

- [ ] **Step 12: 赤確認（表が本当に入口を守っているか）**

`SCALE_CATEGORIES` から `"llm"` を落とす → `#scale/llm` が `data-scale` に倒れ、`scale-categories.spec.ts` の 1 件目と route の新テストが赤。**これが緑のままなら、深いリンクの検査は URL しか見ていない**。戻すのは再編集で。

- [ ] **Step 13: コミット**

```bash
git add web
git commit   # 例: "One list of categories, read by the router and the select alike"
```

---

### Task 7: 次元数の面（選択 ⇄ 手入力）

**Files:**
- Modify: `web/src/ui/Keypad/dataScale.ts`（トークン・候補面・往復キー・**古いコメントの訂正**）
- Modify: `web/src/ui/DataScale/DataScalePanel.tsx`、`DataScalePanel.module.css`、`DataScalePanel.test.tsx`
- Modify（**追随が要る既存テスト。grep で起こした一覧**）:
  - `web/tests/e2e/data-scale.spec.ts:114, 135, 146, 160, 199`
  - `web/tests/e2e/data-scale-keypad.spec.ts:128`
  - `web/tests/e2e/pwa.spec.ts:84`
  - `web/src/ui/DataScale/DataScalePanel.test.tsx:93`（`fillHeadline`）

**Interfaces:**
- Consumes: 既存の `Entry` API（`fromDigits` / `EMPTY` / `text`）、`KeypadSection`
- Produces:
  - `DataScaleKeyToken` に `` `dim:${DimensionCandidate}` ``、`"dims:manual"`、`"dims:choose"` が加わる
  - `DIMENSION_CANDIDATES = [384, 512, 768, 1024, 1536, 2048, 3072, 4096] as const`
  - `DIMENSION_SECTIONS`（候補面）と `DIMENSION_MANUAL_SECTIONS`（数字面＋「選択」キー）

**Note:** **既定は選択面である**（spec §1-2）。`DataScalePanel` に `dimensionsMode: "choose" | "manual"` という state が 1 つ増える。**保存はしない**（打鍵中の値は保存しない、P-1 の規律）。

- [ ] **Step 1: 盤面のテストを書く（赤にする）**

`DataScalePanel.test.tsx` に足す:

```tsx
  it("opens the dimension candidates by default, not the digits", async () => {
    await renderPanel();
    await press(["次元数を入力"]);
    expect(
      screen.getByRole("group", { name: "次元数の候補キー" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "数字と演算のキー" }),
    ).not.toBeInTheDocument();
  });

  it("a candidate lands in the same entry as typed digits", async () => {
    await renderPanel();
    await press(["件数を入力", "1", "次元数を入力", "768"]);
    expect(echo()).toHaveTextContent("次元数 768");
  });

  it("goes to the digits and back", async () => {
    await renderPanel();
    await press(["次元数を入力", "手入力"]);
    expect(
      screen.getByRole("group", { name: "数字と演算のキー" }),
    ).toBeInTheDocument();
    await press(["7", "6", "8"]);
    expect(echo()).toHaveTextContent("次元数 768");
    await press(["候補から選ぶ"]);
    expect(
      screen.getByRole("group", { name: "次元数の候補キー" }),
    ).toBeInTheDocument();
    // **打った値は面を戻しても消えない**——面は入口が 2 つあるだけである。
    expect(echo()).toHaveTextContent("次元数 768");
  });

  it("keeps the candidate face out of the other fields", async () => {
    await renderPanel();
    await press(["件数を入力"]);
    expect(
      screen.getByRole("group", { name: "数字と演算のキー" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "候補から選ぶ" })).toBeNull();
  });

  it("replaces a reserved slot, not a live key", () => {
    // 「選択」キーは数字面の**予約スロット**に入る(5 行 3 列目)。
    // 生きているキーを潰していないことを、位置ではなく事実で押さえる。
    expect(DATA_SCALE_SECTIONS[1]?.keys[22]?.token).toBeNull();
  });
```

- [ ] **Step 2: 赤を見る**

Run: `cd web && pnpm test DataScalePanel`
Expected: FAIL（候補面が存在しない）

- [ ] **Step 3: `dataScale.ts` に候補面を足し、古いコメントを直す**

冒頭コメントの **「数字面と型面は同じ 4 列 × 4 行の枠に載る」を「5 列 × 5 行」に直す**（spec §2 の【訂正 2026-08-19】。枠を押さえているのは `DataScalePanel.module.css` の `grid-template-rows: repeat(5, 1fr)` と `aspect-ratio: 1 / 1` である）。

```ts
/** 次元数の候補(spec §4.2)。**選択で入れた値も、手入力で打った値と同じ
 * `Entry` になる**——面は入り口が 2 つあるだけで、下流は 1 本である。 */
export const DIMENSION_CANDIDATES = [
  384, 512, 768, 1024, 1536, 2048, 3072, 4096,
] as const;

export type DimensionCandidate = (typeof DIMENSION_CANDIDATES)[number];
```

`DataScaleKeyToken` に `| `dim:${DimensionCandidate}` | "dims:manual" | "dims:choose"` を足す。

候補面は**型面と同じ骨格**（5 列 × 5 行の枠、DEL と AC は数字面と同じ位置）:

```ts
/** 次元数の候補面。DEL と AC は数字面・型面と同じ位置に置く。
 * **余ったセルにはボタンを置かない**(恒久の空き)。 */
const DIMENSIONS: KeypadSection<DataScaleKeyToken> = {
  ariaLabel: "次元数の候補キー",
  columns: 5,
  height: "square",
  keys: [
    { token: "dim:384", label: "384", ariaLabel: "384", variant: "function" },
    { token: "dim:512", label: "512", ariaLabel: "512", variant: "function" },
    { token: "dim:768", label: "768", ariaLabel: "768", variant: "function" },
    { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
    { token: "ac", label: "AC", ariaLabel: "この項目を消去", variant: "danger" },

    { token: "dim:1024", label: "1024", ariaLabel: "1024", variant: "function" },
    { token: "dim:1536", label: "1536", ariaLabel: "1536", variant: "function" },
    { token: "dim:2048", label: "2048", ariaLabel: "2048", variant: "function" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },

    { token: "dim:3072", label: "3072", ariaLabel: "3072", variant: "function" },
    { token: "dim:4096", label: "4096", ariaLabel: "4096", variant: "function" },
    // **手入力への入口。** 候補に無い次元数は打てなければならない。
    { token: "dims:manual", label: "手入力", ariaLabel: "手入力", variant: "operator" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
    { token: null, label: "—", ariaLabel: "空き", variant: "function" },
  ],
};

/** 数字面の 5 行 3 列目。**予約スロット**であって生きたキーではない
 * (DATA_SCALE_SECTIONS を見れば token が null であることが確かめられる)。 */
const BACK_TO_CHOICE_INDEX = 22;

/** 次元数の数字面。予約スロットに「選択に戻る」を載せる(spec §4.2)。
 * **件数の数字面には出さない**——件数に候補面は無い(spec §8)。 */
const DIMENSION_PAD: KeypadSection<DataScaleKeyToken> = {
  ...PAD,
  keys: PAD.keys.map((key, index) =>
    index === BACK_TO_CHOICE_INDEX
      ? {
          token: "dims:choose" as const,
          label: "選択",
          ariaLabel: "候補から選ぶ",
          variant: "operator" as const,
        }
      : key,
  ),
};

export const DIMENSION_SECTIONS: KeypadSection<DataScaleKeyToken>[] = [
  FIELDS,
  DIMENSIONS,
];

export const DIMENSION_MANUAL_SECTIONS: KeypadSection<DataScaleKeyToken>[] = [
  FIELDS,
  DIMENSION_PAD,
];
```

- [ ] **Step 4: `DataScalePanel.tsx` を繋ぐ**

```tsx
  // **既定は選択面**(spec §1-2)。保存はしない(打鍵中の値である)。
  const [dimensionsMode, setDimensionsMode] = useState<"choose" | "manual">(
    "choose",
  );

  const choosingDimensions = active === "dimensions" && dimensionsMode === "choose";
  // 数字が打てる面か。**型面と候補面では打てない。**
  const numberField = active !== "dtype" && !choosingDimensions;
```

`press` に足す（`token.startsWith("dtype:")` の分岐の隣）:

```tsx
    if (token.startsWith("dim:")) {
      // **選択も手入力も、同じ Entry に着地する**(spec §4.2)。
      setDimensions(fromDigits(token.slice("dim:".length)));
      return;
    }
    if (token === "dims:manual") {
      setDimensionsMode("manual");
      return;
    }
    if (token === "dims:choose") {
      setDimensionsMode("choose");
      return;
    }
```

`AC` の分岐: 候補面では `setDimensions(EMPTY)`（項目を最初に戻す。面は変えない）。
`Keypad` の `sections` は:

```tsx
        sections={
          active === "dtype"
            ? TYPE_SECTIONS
            : choosingDimensions
              ? DIMENSION_SECTIONS
              : active === "dimensions"
                ? DIMENSION_MANUAL_SECTIONS
                : DATA_SCALE_SECTIONS
        }
```

`keyPressed` に `dim:` の押下表示は**付けない**（トグルではない。数字キーと同じ扱い）。
`keyDisabled` の `del` は `!numberField` のままでよい（候補面では消すものが無い）。

CSS（`DataScalePanel.module.css`）の枠の指定に **`fieldset[aria-label="次元数の候補キー"]` を足す**。**足し忘れると面を入れ替えたときに枠が縮む**——Step 7 の E2E がそこを見る。ラベルが 4 桁で長いので、型面と同じく `font-size: 0.75rem` を当てる。

- [ ] **Step 5: 緑を見る**

Run: `cd web && pnpm test DataScalePanel`

- [ ] **Step 6: 既存テストを追随させる（一覧のとおり全部）**

**768 は候補にあるので候補キーを押す**（新しい入口を実際に通す）。**候補に無い値（1 / 2）は「手入力」を経由する。**

| 場所 | 変更 |
|---|---|
| `data-scale.spec.ts:114` | `["次元数を入力", "7", "6", "8"]` → `["次元数を入力", "768"]` |
| `data-scale.spec.ts:135` | `["次元数を入力", "1"]` → `["次元数を入力", "手入力", "1"]` |
| `data-scale.spec.ts:146, 160` | `["次元数を入力", "2"]` → `["次元数を入力", "手入力", "2"]` |
| `data-scale.spec.ts:199` | `["次元数を入力", "1"]` → `["次元数を入力", "手入力", "1"]` |
| `data-scale-keypad.spec.ts:128` | `["次元数を入力", "7", "6", "8"]` → `["次元数を入力", "768"]` |
| `pwa.spec.ts:84` | 同上 |
| `DataScalePanel.test.tsx:93`（`fillHeadline`） | `"次元数を入力", "7", "6", "8"` → `"次元数を入力", "768"` |

**周辺の説明コメントも直す**——「打ち方は変えていない」と書いてあるコメントは、変えた以上そのままにできない（`data-scale.spec.ts:109` の「変えたのは打ち方だけである」は 0.2.0 の電卓化を指しているので**そのまま**でよい。触るのは事実がずれる行だけ）。

- [ ] **Step 7: 面の入れ替えで枠が動かないことを E2E で見る**

`data-scale-keypad.spec.ts` の `swapping faces moves neither the frame nor DEL` を**3 面**に広げる。**元の検査は DEL の座標を面の前後で比べていた。その主張を落とさない**——名前が「と DEL」と言っているのに存在しか見ない検査は、名前より少ないことしか測っていない:

```ts
test("swapping faces moves neither the frame nor DEL", async ({ page }) => {
  // **同じ枠に載る**(spec §2 の【訂正】: 5 列 × 5 行)。候補面は 15 セルで
  // 3 行しか描かれないため、枠は CSS の aspect-ratio が押さえている。
  const seen: { face: string; box: { width: number; height: number } }[] = [];
  for (const [field, face] of [
    ["件数を入力", "数字と演算のキー"],
    ["次元数を入力", "次元数の候補キー"],
    ["データ型を選ぶ", "データ型のキー"],
  ] as const) {
    await press(page, [field]);
    const box = await face_(page, face).boundingBox();
    const del = await panel(page)
      .getByRole("button", { name: "1文字消去", exact: true })
      .boundingBox();
    seen.push({
      face,
      box: { width: box?.width ?? 0, height: box?.height ?? 0 },
      // **DEL の位置も控える。** 名前が「と DEL」と言っている以上、
      // 在ることではなく**動かないこと**を測る（元の検査がそうだった）。
      del: { x: del?.x ?? -1, y: del?.y ?? -1 },
    });
  }
  expect(seen).toHaveLength(3);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => `${s.del.x},${s.del.y}`));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  expect(seen[0]?.del.x, "DEL was never measured").toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 7b: 新しい面を、既存の面と同じだけ測る**

**面が 1 つ増えたら、面ごとの検査もそのぶん増える。** 増やさないと、新しい面だけ誰も測っていない状態になる:

- `data-scale-keypad.spec.ts` の `both faces keep 44px touch targets` を**3 面**に広げ、**測ったキーの件数も主張する**（0 件でも緑になる書き方をしない）
- 候補面の **DEL が押せない**こと（型面と同じ扱い）を、型面の検査と同じ形で置く
- 候補面の **AC が次元数を空に戻し、面は変えない**ことを置く

- [ ] **Step 8: 回す**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
cd web && pnpm e2e data-scale.spec.ts data-scale-keypad.spec.ts pwa.spec.ts scale-categories.spec.ts
```

- [ ] **Step 9: 赤確認（枠の CSS）**

`DataScalePanel.module.css` の枠指定から `fieldset[aria-label="次元数の候補キー"]` を外す → Step 7 の E2E が赤（枠が縮む）。**緑のままなら、あの検査は枠を測っていない。** 戻すのは再編集で。

- [ ] **Step 10: コミット**

```bash
git add web
git commit   # 例: "Offer the dimensions, and keep the digits one key away"
```

---

### Task 8: LLM のキー集合

**Files:**
- Create: `web/src/ui/Keypad/llm.ts`
- Create: `web/src/ui/Keypad/llm.test.ts`

**Interfaces:**
- Consumes: `KeypadSection`（`./types`）、`PrecisionToken`（`../../datascale/types`）
- Produces（Task 9 が使う）:
  - `LlmField = "parameters" | "weight" | "layers" | "kvHeads" | "headDim" | "context" | "kvPrecision"`
  - `LlmKeyToken`（下の表）
  - `LLM_FIELD_SECTION`、`CANDIDATE_SECTIONS: Record<Exclude<LlmField, "layers">, KeypadSection<LlmKeyToken>>`、`llmPad(field: LlmField): KeypadSection<LlmKeyToken>`
  - `LLM_FIELD_LABELS: Record<LlmField, string>`、`CANDIDATE_VALUES`（候補の実数値。**アクセシブルネームはここから作る**）

**Note:** このタスクは**データだけ**である。React には触らない。盤面の意味（どの面が出るか）は Task 9 が持つ。

**トークン:**

| 形 | 何 |
|---|---|
| `digit:0` … `digit:9` / `zeros3` | 数字（Data Scale と同じ綴り） |
| `unit:m` / `unit:b` | 手入力の接尾辞。**`B` = 10⁹、`M` = 10⁶**（spec §4.3）。係数はコアが持つ（`unit_set = "params"`） |
| `del` / `ac` / `add` / `sub` / `mul` / `div` / `lparen` / `rparen` / `eq` | Data Scale と同じ |
| `field:<LlmField>` | 項目の選択（7 つ） |
| `param:<値>` | パラメータ数の候補（`param:1000000000` など。**値は展開済みの整数**） |
| `heads:<値>` / `dim:<値>` / `ctx:<値>` | KV ヘッド数・ヘッド次元・文脈長の候補 |
| `precision:<PrecisionToken>` | 精度。**重みと KV で同じ族を使い、いま選んでいる項目に入る**（面が違うので取り違えない） |
| `entry:manual` / `entry:choose` | 面の往復。**いま選んでいる項目に効く** |

**候補（spec §4.3。ラベルと読み上げを分ける）:**

| 項目 | ラベル | 読み上げ（＝実数値） |
|---|---|---|
| パラメータ数 | `1B` `3B` `7B` `8B` `14B` `27B` `32B` `70B` | `1000000000` … `70000000000`（**`B` = 10⁹**） |
| 重みの精度 | `FP32` `FP16` `BF16` `INT8` `INT4` | 同じ |
| KV ヘッド数 | `1` `2` `4` `8` `16` `32` | 同じ |
| ヘッド次元 | `64` `80` `96` `128` `256` | 同じ |
| 文脈長 | `2K` `4K` `8K` `16K` `32K` `128K` `1M` | `2048` `4096` `8192` `16384` `32768` `131072` `1048576`（**`K` = 1024**） |
| KV の精度 | `FP16` `BF16` `FP32` `INT8` | 同じ |

- [ ] **Step 1: 表のテストを書く**

```ts
// web/src/ui/Keypad/llm.test.ts
import { describe, expect, it } from "vitest";
import { PRECISION_TOKENS } from "../../datascale/types";
import {
  CANDIDATE_SECTIONS,
  CANDIDATE_VALUES,
  LLM_FIELD_LABELS,
  LLM_FIELD_SECTION,
  type LlmKeyToken,
  llmPad,
} from "./llm";

// **絞り込みの述語は `t is LlmKeyToken` である。`t is string` と書かない**
// ——リテラル合併に対して `string` を主張すると TS2677 になり、逃げ道として
// 型を `string & {}` で開くと**合併が閉じなくなる**（Task 9 の `press` が
// 綴り間違いを検出できなくなる）。述語の側を直すのが正しい。

describe("LLM のキー集合", () => {
  it("puts all seven fields in one two-row section", () => {
    const tokens = LLM_FIELD_SECTION.keys
      .map((k) => k.token)
      .filter((t): t is LlmKeyToken => t !== null);
    expect(tokens).toHaveLength(7);
    expect(LLM_FIELD_SECTION.columns).toBe(4);
    // 4 列 × 2 段 = 8 セル。7 項目 + 恒久の空き 1。
    expect(LLM_FIELD_SECTION.keys).toHaveLength(8);
    for (const field of Object.keys(LLM_FIELD_LABELS)) {
      expect(tokens).toContain(`field:${field}`);
    }
  });

  it("says the number out loud where the label carries a suffix", () => {
    // **同じ字が 2 つの意味を持つ**(spec §4.3): パラメータ数の B は 10^9、
    // 文脈長の K は 1024。押す前に実際の数が分かるようにする。
    const params = CANDIDATE_SECTIONS.parameters.keys.filter((k) =>
      k.token?.startsWith("param:"),
    );
    expect(params.map((k) => k.label)).toEqual([
      "1B", "3B", "7B", "8B", "14B", "27B", "32B", "70B",
    ]);
    expect(params.map((k) => k.ariaLabel)).toEqual([
      "1000000000", "3000000000", "7000000000", "8000000000",
      "14000000000", "27000000000", "32000000000", "70000000000",
    ]);

    const context = CANDIDATE_SECTIONS.context.keys.filter((k) =>
      k.token?.startsWith("ctx:"),
    );
    expect(context.map((k) => k.label)).toEqual([
      "2K", "4K", "8K", "16K", "32K", "128K", "1M",
    ]);
    expect(context.map((k) => k.ariaLabel)).toEqual([
      "2048", "4096", "8192", "16384", "32768", "131072", "1048576",
    ]);
  });

  it("keeps the token and the spoken number in step", () => {
    // トークンにも展開済みの数が入る。ラベル・読み上げ・トークンの 3 つが
    // ずれたら、押した数と計算した数が食い違う。
    for (const section of Object.values(CANDIDATE_SECTIONS)) {
      for (const key of section.keys) {
        const token = key.token;
        if (token === null || !/^(param|heads|dim|ctx):/.test(token)) continue;
        expect(token.split(":")[1]).toBe(key.ariaLabel);
      }
    }
  });

  it("offers int4 for the weights and not for the KV cache", () => {
    // spec §4.3 の候補表。**コアは 5 つとも受ける**が、盤面は出さない。
    const of = (name: "weight" | "kvPrecision") =>
      CANDIDATE_SECTIONS[name].keys
        .map((k) => k.token)
        .filter((t): t is LlmKeyToken => t?.startsWith("precision:") ?? false)
        .map((t) => t.slice("precision:".length));
    expect(of("weight")).toEqual(["fp32", "fp16", "bf16", "int8", "int4"]);
    expect(of("kvPrecision")).toEqual(["fp16", "bf16", "fp32", "int8"]);
    for (const token of [...of("weight"), ...of("kvPrecision")]) {
      expect(PRECISION_TOKENS).toContain(token);
    }
  });

  it("every face rides the same five-by-five frame", () => {
    for (const [name, section] of Object.entries(CANDIDATE_SECTIONS)) {
      expect(section.columns, name).toBe(5);
      expect(section.height, name).toBe("square");
      expect(section.keys.length, name).toBeLessThanOrEqual(25);
      // DEL と AC は数字面と同じ位置に居る(面が変わっても消し方が動かない)。
      expect(section.keys[3]?.token, name).toBe("del");
      expect(section.keys[4]?.token, name).toBe("ac");
    }
  });

  it("shows the B and M keys only where they mean something", () => {
    const units = (field: Parameters<typeof llmPad>[0]) =>
      llmPad(field)
        .keys.map((k) => k.token)
        .filter((t): t is LlmKeyToken => t?.startsWith("unit:") ?? false);
    // パラメータ数の手入力にだけ接尾辞キーが立つ(spec §4.3)。
    expect(units("parameters")).toEqual(["unit:b", "unit:m"]);
    // 層数は手入力だけの項目で、単位を持たない。
    expect(units("layers")).toEqual([]);
  });

  it("offers the way back only where there is a face to go back to", () => {
    const back = (field: Parameters<typeof llmPad>[0]) =>
      llmPad(field).keys.some((k) => k.token === "entry:choose");
    expect(back("parameters")).toBe(true);
    expect(back("context")).toBe(true);
    // **層数には候補面が無い**(spec §4.3)。戻る先が無いキーは出さない。
    expect(back("layers")).toBe(false);
  });
});
```

- [ ] **Step 2: 赤を見る**

Run: `cd web && pnpm test llm.test`
Expected: FAIL（`./llm` が無い）

- [ ] **Step 3: `llm.ts` を書く**

- 候補値は `CANDIDATE_VALUES` に**数として**持ち、ラベル・読み上げ・トークンをそこから起こす（3 つがずれる余地を消す）
- 項目行は `columns: 4`・`height: "half"`・8 セル（7 項目 ＋ 恒久の空き 1）
- 各候補面は `columns: 5`・`height: "square"`・先頭行の 4・5 番目が `del` と `ac`
- `llmPad(field)` は Data Scale の `PAD` と同じ並びで、
  - 単位スロット（`G`・`M`・`K` の位置）は `parameters` のときだけ `unit:b`・`unit:m` を立て、それ以外は予約スロット（`token: null`、`—`、`空き`）
  - 5 行 3 列目の予約スロットは、候補面を持つ項目のときだけ `entry:choose`（ラベル「選択」、読み上げ「候補から選ぶ」）
- `del` / `ac` / 四則 / 括弧 / `eq` は Data Scale と同じ位置・同じ読み上げ名（**3 つのパネルで AC・DEL の位置を揃える**、S1 設計書 §4）

- [ ] **Step 4: 緑を見る**

Run: `cd web && pnpm test llm.test`

- [ ] **Step 5: 回してコミット**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
git add web/src/ui/Keypad && git commit   # 例: "Say 8192 where the key says 8K"
```

---

### Task 9: LLM パネル

**Files:**
- Create: `web/src/ui/Llm/LlmPanel.tsx`、`LlmPanel.module.css`、`LlmPanel.test.tsx`
- Create: `web/tests/e2e/llm.spec.ts`
- Modify: `web/src/ui/Scale/ScalePanel.tsx`（`ComingSoon` を `LlmPanel` に）

**Interfaces:**
- Consumes: `DataScaleCalc.llm(...)`（Task 5）、`initExpr().integer(text, max, "params")`、Task 8 の表、`Readout`、`Keypad`、`loadSettings().dataScale.primary`
- Produces: `LlmPanel()` — `<section aria-label="LLM のメモリ計算">`

**盤面と出力（spec §4.3・§5）:**

- 項目は 7 つ。**既定値を持つ**（画面が最初から答えを出せる状態にする）:
  パラメータ数 `7000000000`（`7B`）/ 重み `fp16` / 層数 空 / KV ヘッド数 `8` / ヘッド次元 `128` / 文脈長 `4096` / KV `fp16`
  **層数だけが空**である——ここが埋まるまで答えを出さない（Data Scale の「未入力の項目は出さない」と同じ）
- 結果は 3 行（重み・KV cache・合計）。各行に **バイト数（3 桁区切り）・10 進・2 進**を出す（§5 の形）
- `Readout` の主表示は**合計**。10 進と 2 進のどちらを出すかは `settings.dataScale.primary` を読む（**新しい設定は作らない**、計画時の裁定 2）
- **注意書きを必ず出す**（§5）。**設計書 §21 のリストを写さない**——この実装は KV cache を計算に入れているので、写すと画面が自分について嘘をつく:

```text
表示しているのは理論値です。
実際に必要なメモリはこれより大きくなります。
一時バッファ・実行時のオーバーヘッド・量子化のメタデータが加わります。
```

- [ ] **Step 1: パネルのテストを書く（vitest）**

`DataScalePanel.test.tsx` の作りに倣う（`renderPanel` で WASM を待ってから押す）。置く検査:

```tsx
  it("computes the headline case from the spec", async () => {
    await renderPanel();
    await press(["パラメータ数を選ぶ", "27B"]);
    await press(["重みの精度を選ぶ", "INT4"]);
    await press(["層数を入力", "6", "2"]);
    await press(["KV ヘッド数を選ぶ", "16"]);
    await press(["ヘッド次元を選ぶ", "128"]);
    await press(["文脈長を選ぶ", "8K"]);
    await press(["KV の精度を選ぶ", "FP16"]);

    const result = screen.getByTestId("llm-result");
    expect(result).toHaveTextContent("13,500,000,000 bytes");
    expect(result).toHaveTextContent("13.5 GB");
    expect(result).toHaveTextContent("4,160,749,568 bytes");
    expect(result).toHaveTextContent("17,660,749,568 bytes");
    expect(main()).toHaveTextContent("17.7 GB");
  });

  it("adds up on screen: the two lines make the total", async () => {
    // **見えている数が足し算になっている**(spec §3.4 が守っているもの)。
    // 画面から読んだ 3 つの数で確かめる——実装の式ではなく、出た数で。
    await renderPanel();
    await fillHeadline();
    const digits = (testId: string) =>
      BigInt(screen.getByTestId(testId).textContent?.replace(/[^0-9]/g, "") ?? "0");
    expect(digits("llm-weight-bytes") + digits("llm-kv-bytes")).toBe(
      digits("llm-total-bytes"),
    );
  });

  it("says nothing until the layers are known", async () => {
    await renderPanel();
    expect(screen.queryByTestId("llm-result")).toBeNull();
    expect(main()).toHaveTextContent("");
  });

  it("follows the saved primary system, which Data Scale owns", async () => {
    // **共有結合を 1 本で固定する**(監視役の推奨、2026-08-19)。LLM は
    // 自前の設定を持たず `settings.dataScale.primary` を読む(計画時の裁定 2)
    // ——つまり **Data Scale の設定が LLM の主表示を変える**。その向きが
    // 意図であることを、ここで見えるようにしておく。
    window.localStorage.clear();
    updateSettings((current) => ({
      ...current,
      dataScale: { ...current.dataScale, primary: "binary" },
    }));
    await renderPanel();
    await fillHeadline();
    expect(main()).toHaveTextContent("16.4 GiB");
  });

  it("keeps the notice honest about the KV cache", async () => {
    // 設計書 §21 のリストをそのまま写すと、KV cache を計算に入れている
    // この画面が自分について嘘をつく(spec §5)。
    await renderPanel();
    const notice = screen.getByTestId("llm-notice");
    expect(notice).toHaveTextContent("理論値");
    expect(notice).toHaveTextContent("一時バッファ");
    expect(notice.textContent).not.toContain("KV");
  });

  it("shows an overflow as an error, not as a number", async () => {
    await renderPanel();
    await press(["パラメータ数を選ぶ", "手入力"]);
    await type("340282366920938463463374607431768211455");
    await press(["重みの精度を選ぶ", "FP32"]);
    await press(["層数を入力", "1"]);
    expect(main()).toHaveTextContent("Math ERROR");
    expect(main()).toHaveAttribute("data-error", "Overflow");
  });

  it("expands 27B into digits, not into a rounded display value", async () => {
    await renderPanel();
    await press(["パラメータ数を選ぶ", "手入力", "2", "7", "十億"]);
    expect(echo()).toHaveTextContent("パラメータ数 27B");
    await press(["重みの精度を選ぶ", "INT8"]);
    await press(["層数を入力", "1"]);
    expect(screen.getByTestId("llm-weight-bytes")).toHaveTextContent(
      "27,000,000,000 bytes",
    );
  });
```

- [ ] **Step 2: 赤を見る**

Run: `cd web && pnpm test LlmPanel` → FAIL（モジュールが無い）

- [ ] **Step 3: `LlmPanel.tsx` を書く**

`DataScalePanel.tsx` と同じ骨格である。違うのは:

- state が項目ぶんある（`parameters: Entry` / `layers: Entry` / `kvHeads: Entry` / `headDim: Entry` / `context: Entry` と `weight: PrecisionToken` / `kvPrecision: PrecisionToken`、それに `mode: Record<CandidateField, "choose" | "manual">`）
- 数の着地は `expr.integer(text, MAX_COUNT, unitSet)`。**`unitSet` は `parameters` のとき `"params"`、他は `"none"`**（計算は 1 か所、単位表はコア）
- `calc.llm(...)` は**すべての数が揃ったときだけ**呼ぶ
- `<Keypad sections={...}>` は「項目行 ＋（候補面 or 数字面）」
- 結果欄は `data-testid="llm-result"`、各行は `llm-weight-bytes` / `llm-kv-bytes` / `llm-total-bytes`
- 注意書きは `data-testid="llm-notice"`。**`role="alert"` にしない**（エラーではない。Finance の免責と同じ扱い）

CSS は `DataScalePanel.module.css` を写し、**枠の指定に 7 つの面の aria-label をすべて並べる**（漏らすと面ごとに枠が伸び縮みする）。候補のラベルが長い面には `font-size: 0.75rem`。

- [ ] **Step 4: 緑を見る**

Run: `cd web && pnpm test LlmPanel`

- [ ] **Step 5: `ScalePanel` に繋ぐ**

`{current === "llm" && <ComingSoon what="LLM のメモリ" />}` を `<LlmPanel />` に。

**Task 6 が置いた「面ごとに中身が出る」検査が落ちます。それは意図どおりです**——`ScalePanel.test.tsx` の `shows a different panel for each category` と `scale-categories.spec.ts` の 2 本が、`LLM のメモリ（準備中）` という領域名を主張しています。**実物の領域名（`LLM のメモリ計算`）に直してください。** 落ちること自体が、面が実物になった事実をテストへ反映させる契機です。

- [ ] **Step 6: E2E を書く（実 WASM で headline を通す）**

```ts
// web/tests/e2e/llm.spec.ts
test("the headline case: 27B INT4 with an 8K context", async ({ page }) => {
  await page.goto("/#scale/llm");
  const panel = page.getByRole("region", { name: "LLM のメモリ計算" });
  for (const [field, value] of [
    ["パラメータ数を選ぶ", "27B"],
    ["重みの精度を選ぶ", "INT4"],
    ["KV ヘッド数を選ぶ", "16"],
    ["ヘッド次元を選ぶ", "128"],
    ["文脈長を選ぶ", "8K"],
    ["KV の精度を選ぶ", "FP16"],
  ] as const) {
    await panel.getByRole("button", { name: field, exact: true }).click();
    await panel.getByRole("button", { name: value, exact: true }).click();
  }
  await panel.getByRole("button", { name: "層数を入力", exact: true }).click();
  for (const digit of ["6", "2"]) {
    await panel.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(page.getByTestId("llm-result")).toContainText("17,660,749,568 bytes");
  await expect(page.getByTestId("display-main")).toHaveText("17.7 GB");
});

test("the keys hold 44px on every face", async ({ page }) => { /* 面を 7 つ回り、boundingBox を測る。件数の下限も主張する */ });

test("a candidate key says its number out loud", async ({ page }) => {
  // jsdom はアクセシビリティツリーを組み立てない(CLAUDE.md)。
  // 「8K と書いてあるキーの読み上げ名が 8192 である」は実ブラウザで見る。
  await page.goto("/#scale/llm");
  const panel = page.getByRole("region", { name: "LLM のメモリ計算" });
  await panel.getByRole("button", { name: "文脈長を選ぶ", exact: true }).click();
  await expect(panel.getByRole("button", { name: "8192", exact: true })).toHaveText("8K");
});
```

- [ ] **Step 7: 回す**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint
cd web && pnpm e2e llm.spec.ts scale-categories.spec.ts
```

- [ ] **Step 8: 赤確認（画面の足し算）**

`LlmPanel.tsx` の合計行を `total` ではなく `weight` を出すように変える → `adds up on screen` と headline の 2 件が赤。**緑のままなら、3 行のうち 1 行しか読んでいない。** 戻すのは再編集で。

- [ ] **Step 9: コミット**

```bash
git add web && git commit   # 例: "Answer how much memory 27B needs, and say what is left out"
```

---

### Task 10: Data Transfer（キー集合とパネル）

**Files:**
- Create: `web/src/ui/Keypad/transfer.ts`、`web/src/ui/Transfer/TransferPanel.tsx`、`.module.css`、`.test.tsx`
- Create: `web/tests/e2e/transfer.spec.ts`
- Modify: `web/src/ui/Scale/ScalePanel.tsx`

**Interfaces:**
- Consumes: `DataScaleCalc.transfer(...)`（Task 5）、`BANDWIDTH_UNIT_TOKENS` / `DURATION_UNIT_TOKENS`
- Produces: `TransferPanel()` — `<section aria-label="データ転送量計算">`

**盤面（spec §4.4）:** 項目は 4 つ（帯域幅の値・帯域幅の単位・時間の値・時間の単位）。値は手入力、単位は選択面。**既定は `mbps` と `hour`**（headline がそのまま出る組み合わせ）。ラベルは `bps` `kbps` `Mbps` `Gbps` と `秒` `分` `時` `日`、トークンは小文字である（Global Constraints の綴り表）。

- [ ] **Step 1: テストを書く**

```tsx
  it("computes the headline case: 100 Mbps for 3 hours", async () => {
    await renderPanel();
    await press(["帯域幅を入力", "1", "0", "0"]);
    await press(["帯域幅の単位を選ぶ", "Mbps"]);
    await press(["時間を入力", "3"]);
    await press(["時間の単位を選ぶ", "時"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "135,000,000,000 bytes",
    );
    expect(main()).toHaveTextContent("135.0 GB");
  });

  it("keeps the k of kbps decimal", async () => {
    // **1 kbps = 1,000 bps**(spec §3.5)。1024 だと 117,964,800 になる。
    await renderPanel();
    await press(["帯域幅を入力", "5", "1", "2"]);
    await press(["帯域幅の単位を選ぶ", "kbps"]);
    await press(["時間を入力", "3", "0"]);
    await press(["時間の単位を選ぶ", "分"]);
    expect(screen.getByTestId("transfer-result")).toHaveTextContent(
      "115,200,000 bytes",
    );
  });

  it("charges a whole byte for a single bit", async () => {
    await renderPanel();
    await press(["帯域幅を入力", "1"]);
    await press(["帯域幅の単位を選ぶ", "bps"]);
    await press(["時間を入力", "1"]);
    await press(["時間の単位を選ぶ", "秒"]);
    expect(main()).toHaveTextContent("1 bytes");
  });

  it("names every unit key in both systems", () => { /* 4 × 4 の候補が揃っていること。件数も主張する */ });
```

- [ ] **Step 2〜4: 赤 → 実装 → 緑**

`transfer.ts` は Data Scale の骨格をそのまま使う（項目行 `columns: 4`、単位面は 5 列 × 5 行、DEL・AC は同じ位置）。`TransferPanel.tsx` は `DataScalePanel.tsx` の縮小版で、結果は 1 組。CSS の枠指定に 3 つの面（数字面・帯域幅の単位面・時間の単位面）を並べる。

- [ ] **Step 5: `ScalePanel` に繋ぎ、`ComingSoon` を消す**

**この時点で `ComingSoon` は使われなくなる。関数ごと消す**——使われないコードを「あとで使うかも」で残さない。

**ここでも Task 6 の検査が落ちます**（`データ転送（準備中）` → 実物の `データ転送量計算`）。3 か所（`ScalePanel.test.tsx` 1 本、`scale-categories.spec.ts` 2 本）を実物の領域名に直してください。**`ComingSoon` が消えたあと、`準備中` という語がこのブランチの Scale 側に 1 つも残らないことを確かめる**——残っていたら、消し忘れか、検査が古い名前を見続けている。

- [ ] **Step 6: E2E**

`transfer.spec.ts` に headline 1 件、単位面の 44px 1 件、`#scale/transfer` の深いリンク 1 件。

- [ ] **Step 7: 回してコミット**

```bash
cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e transfer.spec.ts
git add web && git commit   # 例: "Three hours of a hundred megabits is 135 GB"
```

---

### Task 11: 縦の実測と記録、撮る

**Files:**
- Modify: `docs/definition-of-done.md`（未解決の表に 3 カテゴリを足す）
- Modify: `docs/superpowers/specs/2026-08-19-scale-llm-transfer-design.md`（§4.5 に【実測】を追記）
- 一時: スクリーンショット（**リポジトリにはコミットしない**。見て確かめるためのもの）

**Note:** **直すのはこの spec の仕事ではない**（spec §8）。**どれだけ悪くしたかを黙らない**のがこのタスクである。

- [ ] **Step 1: 実機ビルドを起こす**

```bash
cd web && pnpm wasm && pnpm build
cd web && pnpm preview --port 4180 --strictPort &
```
**4179 は使わない**（E2E が `--strictPort` で掴む港である）。

- [ ] **Step 2: 3 カテゴリ × 2 画面で測る**

`document.documentElement.scrollHeight - window.innerHeight` を、`#scale/data-scale` / `#scale/llm` / `#scale/transfer` について 390×844 と 360×640 で測る。**パネルが出てから測る**（`viewport-budget.spec.ts` の `waitForPanel` と同じ理由——出る前に測ると空のページを測って 0 になる）。0.2.1 の実測（Data Scale は 390×844 で 0、360×640 で 66）と**同じ列**に並べられる形で採る。

- [ ] **Step 3: 撮る**

3 カテゴリ × 2 画面幅、加えて**次元数の選択面と手入力面の両方**。
**目で見るのは 1 点**——「いま選択面に居るのか手入力面に居るのかが、見て分かるか」（spec §7）。分からなければ、**そのことを記録して次に渡す**（直すかどうかは別の裁定である）。

- [ ] **Step 4: preview を落とす**

```bash
kill %1   # 港を掴んだまま次の作業に入らない(4173 の再利用事故の教訓)
```

- [ ] **Step 5: 数を書く**

`docs/definition-of-done.md` の「縦が短い画面（0.2.1 で見つけた、未解決）」の表に **3 行**（Data Scale / LLM / Data Transfer）を足し、**0.3.0 で悪化した分をそのまま書く**。spec §4.5 にも【実測 2026-08-19】として同じ数を残す（U-0 §4 と同じ形）。

- [ ] **Step 6: 全部回す（ブランチ末尾の 1 回）**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
wasm-pack test --headless --chrome crates/calcarc-wasm
cd reference && uv run --no-config pytest
cd reference && uv run --no-config python scripts/generate.py && cd .. && git diff --exit-code testdata/
cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm e2e
```
**`git diff --exit-code testdata/` が肝**である——golden が生成物と一致していることを、CI と同じやり方で確かめる。

- [ ] **Step 7: コミット**

```bash
git add docs && git commit   # 例: "Measure what the third row cost, and write it down"
```

---

## Self-Review（計画作成時に実施済み）

**1. spec の網羅:**

| spec の節 | どのタスク |
|---|---|
| §3.1 単位・切り上げ | Task 1・3（重み側の端）、Task 2・4（転送側で実際に発火） |
| §3.2 重み | Task 1・3 |
| §3.3 KV cache（GQA） | Task 1・3（golden の GQA と対照値） |
| §3.4 合計 | Task 1・3（§3.4 の【訂正】に合わせ、KV 側に端数が出ないことを測る） |
| §3.5 Data Transfer | Task 2・4 |
| §3.6 あふれと定義域 | Task 1〜4（順序が効くケースを golden に置く） |
| §4.1 カテゴリ選択 | Task 6 |
| §4.2 次元数の面 | Task 7 |
| §4.3 LLM の項目行・接尾辞 | Task 8・9 |
| §4.4 Transfer の項目行 | Task 10 |
| §4.5 縦の予算 | Task 11 |
| §5 出力・注意書き | Task 9 |
| §6 境界 | Task 5 |
| §7 検証（段ゲート・golden・赤確認 4 つ・撮る） | Task 1〜4（赤確認 1〜4）、Task 11（撮る） |
| §8 スコープ外 | どのタスクも触らない |

**2. 置いていない穴:** 無し。TBD・「適切に」・「Task N と同様」は使っていない。

**3. 型の一貫性:** `Precision` / `BandwidthUnit` / `DurationUnit` の綴りは Global Constraints の表が唯一の出所で、Rust（`token()`）と TypeScript（`*_TOKENS`）の一致は Task 5 の parity テストが機械で見る。`LlmField` の綴りは Task 8 が定義し、Task 9 だけが使う。

**4. spec に見つけた誤りと、その扱い（2 件。どちらも実物で確認して訂正コミット済み）:**

| | 何 | コミット |
|---|---|---|
| §2・§4.2 | 面の枠は「4 列 × 4 行」ではなく **5 列 × 5 行**。spec は `dataScale.ts` の古いコメントを引いていた（枠を押さえているのは CSS 側で、そちらは正しい） | `52ca5c8` |
| §3.4 | 「まとめて割ると 1 バイトずれることがある」は**起こり得ない**。§3.1 が自分で書いているとおり `kv_bits` は常に 8 の倍数だからである。式を分ける規則は残し、理由を「**4 の倍数でない KV 精度**を足した日にずれる」に置き換えた | `c950d56` ＋ 理由文の直し |

**訂正の理由文を、さらに 1 度直した**（監視役の指摘）。最初に書いた根拠
「`bits_per_kv_element` は 4 以上だから 8 の倍数になる」は**含意が成り立たない**
——6 bit なら `2 × 6 = 12` で、条件を満たしたまま恒等式が黙って破れる。**この訂正が
戒めた壊れ方を、訂正の理由文自体がやっていた。** 正しい根拠は「**ビット幅が 4 の倍数**
であること」（`bits ≡ 0 mod 4 ⇒ 2 × bits ≡ 0 mod 8`）で、盤面が KV に出す 4 つ
（16 / 16 / 32 / 8）も、コアが受ける 5 つ目の INT4（`2 × 4 = 8`）も、これを満たす。
守り文も「2 bit を足した日」ではなく「**4 の倍数でない精度を足した日**」に広げた。

**4b. 監視役の裁定・指摘の反映（2026-08-19、代理承認時）:**

- **訂正 `c950d56` の理由文を直した**（上の表の下の段落）。指摘は正しく、実物で
  確かめた——`bits = 6` は「4 以上」を満たしたまま `2 × 6 = 12` で恒等式を破る
- **U-2 §0.0-4 は U-2 着手時に訂正印で直す**（裁定）。直し方は「16 → 23 に上限を
  上げる」ではなく、**「16 個以内」は枠の限界ではなく選んだスコープである、と理由を
  書き換える**（枠の実物は 5 × 5 = 25、DEL・AC を除いて 23 セル、と併記）。
  **単位の増減はしない**——それは承認済みの内容である
- **裁定 2 の共有結合にテストを 1 本置いた**（推奨。Task 9 Step 1 の
  `follows the saved primary system, which Data Scale owns`）

**5. spec より厚くした点（いずれも spec の最小要求を満たしたうえでの追加。減らしてはいない）:**

- 転送側に `1 bps × 1 秒 = 1 byte` を置いた——**切り上げが実際に走る唯一の経路**であり、spec §3.1 が「重み側にしかない」と書いた端の**対**になる
- あふれの**順序依存**（層数 2^127 × 文脈長 0）を golden に置いた。§3.6 の「どの積も checked_mul」は順序を含む契約である
- golden 突き合わせに**比較件数の下限**を入れた（全件が error 枝に落ちても緑になる書き方を避ける）
- 境界のトークン 3 種に parity テストを足した（既存の `DATA_TYPE_TOKENS` と同じ規律。spec は求めていないが、二重管理はここでも起きている）

---

## 実行方法

**Subagent-Driven（既定）。** タスクごとに新しい subagent を出し、あいだで 2 段レビューを通す。
