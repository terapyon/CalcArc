# Data Scale Calculator（M4）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** count × dimensions × datatype → バイト数と 10 進/2 進の両表示。2 つ目の Calculator モジュールと、初のナビゲーション。#7 を分離の決定で close。

**Architecture:** spec は docs/superpowers/specs/2026-08-11-data-scale-design.md。6 タスク: コア → 言語間検証 → WASM 境界 → フォーム UI → ナビゲーション → E2E＋最終スイープ。データの流れ: `data_scale::size_in_bytes`（u128 checked）→ `format`（商と剰余の整数丸め）→ wasm 純関数（文字列入出力）→ framework 非依存ラッパー → React フォーム。

**Tech Stack:** Rust（u128）、Python（組み込み int）、wasm-bindgen、React、Playwright。

## Global Constraints

- **数値型を共有しない**（spec §1、#7）。`data_scale` は `Value`/`engine` に触れない。共有は `CalcError`・表示原則・UI 基盤のみ。
- **換算経路に f64 を使わない**（spec §3）。u128 の商と剰余だけで丸める。
- **`calcarc-core` は panic しない。** u128 の演算はすべて checked。`unwrap`/`expect` 禁止（テスト以外）。
- **WASM 境界は例外を投げない。入出力とも文字列**（JS number は 2^53 で嘘になる）。
- **`web/src/datascale/` に React を import しない**（`calc/` と同じ境界規約）。
- **golden は完全一致・tolerance なし**。バイト数は JSON でも文字列。
- **検証段**（CONTRIBUTING の表）: コアのみ→cargo、testdata→+pytest+再生成、境界→+wasm、UI→+vitest、**ナビと a11y は E2E 必須**。フルスイープは Task 6 の 1 回。
- `uv run` は `--no-config`。コミット前に `cargo fmt`。`git push`/PR 禁止。
- コミット末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。
- ベースライン: Rust 125 / wasm 6 / vitest 31 / e2e 14 / Python 13。

---

### Task 1: 計算コア（`data_scale` モジュール）

**Files:**
- Create: `crates/calcarc-core/src/data_scale/mod.rs`
- Create: `crates/calcarc-core/src/data_scale/format.rs`
- Modify: `crates/calcarc-core/src/lib.rs`（`pub mod data_scale;` の 1 行のみ。**root 再エクスポートはしない**——api-style.md の玄関基準どおり、最上位モジュールの型は上げない）

**Interfaces:**
- Consumes: `crate::{CalcError, CalcResult}`
- Produces（Task 2・3 が使う）:
  - `data_scale::DataType`（9 種、`ALL: [DataType; 9]`、`from_token(&str) -> Option<DataType>`、`token() -> &'static str`、`bytes_per_element() -> u128`）
  - `data_scale::parse_count(&str) -> CalcResult<u128>`
  - `data_scale::size_in_bytes(count: u128, dimensions: u128, dtype: DataType) -> CalcResult<u128>`
  - `data_scale::format::group_digits(u128) -> String`（3 桁区切り）
  - `data_scale::format::format_decimal(u128) -> Option<String>`（`"307.2 GB"`。1000 bytes 未満は None）
  - `data_scale::format::format_binary(u128) -> Option<String>`（`"286.1 GiB"`。1024 bytes 未満は None）

- [ ] **Step 1: 失敗するテストを書く（mod.rs 側）**

`mod.rs` の `#[cfg(test)] mod tests` に:

```rust
#[test]
fn the_headline_case_in_bytes() {
    // 100M × 768 × float32（設計書 §0、base-spec §49 M4）
    let bytes = size_in_bytes(100_000_000, 768, DataType::Float32).unwrap();
    assert_eq!(bytes, 307_200_000_000);
}

#[test]
fn every_type_has_its_size() {
    let expect: [(DataType, u128); 9] = [
        (DataType::Int8, 1), (DataType::Uint8, 1), (DataType::Int16, 2),
        (DataType::Float16, 2), (DataType::Bfloat16, 2), (DataType::Int32, 4),
        (DataType::Float32, 4), (DataType::Int64, 8), (DataType::Float64, 8),
    ];
    for (t, size) in expect {
        assert_eq!(t.bytes_per_element(), size, "{:?}", t);
    }
}

#[test]
fn tokens_round_trip() {
    for t in DataType::ALL {
        assert_eq!(DataType::from_token(t.token()), Some(t), "{:?}", t);
    }
    assert_eq!(DataType::from_token("float128"), None);
    assert_eq!(DataType::from_token(""), None);
}

#[test]
fn overflow_is_an_error_not_a_wrap() {
    // 2^127 × 2 × 1 byte = 2^128 はあふれる（base-spec §25）。
    let big = 1u128 << 127;
    assert_eq!(size_in_bytes(big, 2, DataType::Uint8), Err(CalcError::Overflow));
    // ぎりぎり下は通る。
    assert!(size_in_bytes(big - 1, 2, DataType::Uint8).is_ok());
}

#[test]
fn parse_rejects_what_is_not_a_count() {
    assert_eq!(parse_count(""), Err(CalcError::SyntaxError));
    assert_eq!(parse_count("12a"), Err(CalcError::SyntaxError));
    assert_eq!(parse_count("-1"), Err(CalcError::SyntaxError));
    assert_eq!(parse_count("1.5"), Err(CalcError::SyntaxError));
    // u128 の上限を 1 だけ超える 10 進表記。
    assert_eq!(
        parse_count("340282366920938463463374607431768211456"),
        Err(CalcError::SyntaxError)
    );
    assert_eq!(parse_count("0"), Ok(0));
    assert_eq!(parse_count("007"), Ok(7)); // 先頭ゼロは可（設計書 §2）
}

#[test]
fn zero_count_is_a_valid_input() {
    assert_eq!(size_in_bytes(0, 768, DataType::Float32), Ok(0));
}
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `cargo test -p calcarc-core data_scale`
Expected: コンパイルエラー（モジュール未定義）

- [ ] **Step 3: `mod.rs` を実装する**

```rust
//! Data Scale Calculator の計算コア（base-spec §14〜§17）。
//!
//! Scientific とは数値型を共有しない（設計書 §1、issue #7 の決定）。
//! バイト数は Exact Integer（§24）であり、u128 の checked 演算で持つ。
//! あふれは黙って折り返さず Overflow にする（§25）。

use crate::{CalcError, CalcResult};

pub mod format;

/// 要素のデータ型（base-spec §16 の 9 種）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataType {
    Int8,
    Uint8,
    Int16,
    Float16,
    Bfloat16,
    Int32,
    Float32,
    Int64,
    Float64,
}

impl DataType {
    /// 境界（WASM / JS）とテストが参照する全体。
    pub const ALL: [DataType; 9] = [
        DataType::Int8,
        DataType::Uint8,
        DataType::Int16,
        DataType::Float16,
        DataType::Bfloat16,
        DataType::Int32,
        DataType::Float32,
        DataType::Int64,
        DataType::Float64,
    ];

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<DataType> {
        Some(match token {
            "int8" => DataType::Int8,
            "uint8" => DataType::Uint8,
            "int16" => DataType::Int16,
            "float16" => DataType::Float16,
            "bfloat16" => DataType::Bfloat16,
            "int32" => DataType::Int32,
            "float32" => DataType::Float32,
            "int64" => DataType::Int64,
            "float64" => DataType::Float64,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            DataType::Int8 => "int8",
            DataType::Uint8 => "uint8",
            DataType::Int16 => "int16",
            DataType::Float16 => "float16",
            DataType::Bfloat16 => "bfloat16",
            DataType::Int32 => "int32",
            DataType::Float32 => "float32",
            DataType::Int64 => "int64",
            DataType::Float64 => "float64",
        }
    }

    /// 要素 1 つのバイト数。
    pub fn bytes_per_element(self) -> u128 {
        match self {
            DataType::Int8 | DataType::Uint8 => 1,
            DataType::Int16 | DataType::Float16 | DataType::Bfloat16 => 2,
            DataType::Int32 | DataType::Float32 => 4,
            DataType::Int64 | DataType::Float64 => 8,
        }
    }
}

/// 10 進数字列を u128 にする。
///
/// 空・数字以外・u128 の上限超は SyntaxError。先頭ゼロは許す。
/// 符号・小数点・区切り文字は受け付けない（フォームの入力は数字だけ）。
pub fn parse_count(text: &str) -> CalcResult<u128> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CalcError::SyntaxError);
    }
    text.parse::<u128>().map_err(|_| CalcError::SyntaxError)
}

/// count × dimensions × 要素サイズ。あふれたら Overflow（base-spec §25）。
pub fn size_in_bytes(count: u128, dimensions: u128, dtype: DataType) -> CalcResult<u128> {
    count
        .checked_mul(dimensions)
        .and_then(|elements| elements.checked_mul(dtype.bytes_per_element()))
        .ok_or(CalcError::Overflow)
}
```

- [ ] **Step 4: format のテストを書く**

`format.rs` の `#[cfg(test)] mod tests` に:

```rust
#[test]
fn groups_digits_in_threes() {
    assert_eq!(group_digits(0), "0");
    assert_eq!(group_digits(999), "999");
    assert_eq!(group_digits(1000), "1,000");
    assert_eq!(group_digits(307_200_000_000), "307,200,000,000");
    assert_eq!(group_digits(u128::MAX), "340,282,366,920,938,463,463,374,607,431,768,211,455");
}

#[test]
fn the_headline_case_in_both_systems() {
    // 307.2 GB は厳密、286.1 GiB は 286.102294921875 の丸め（設計書 §0）。
    assert_eq!(format_decimal(307_200_000_000).as_deref(), Some("307.2 GB"));
    assert_eq!(format_binary(307_200_000_000).as_deref(), Some("286.1 GiB"));
}

#[test]
fn below_the_smallest_unit_there_is_no_line() {
    assert_eq!(format_decimal(999), None);
    assert_eq!(format_binary(1023), None);
    // 非対称の境界: 1000..=1023 は 10 進だけが出る。
    assert_eq!(format_decimal(1000).as_deref(), Some("1.0 KB"));
    assert_eq!(format_binary(1000), None);
    assert_eq!(format_binary(1024).as_deref(), Some("1.0 KiB"));
}

#[test]
fn trailing_zero_is_kept() {
    assert_eq!(format_decimal(5_000).as_deref(), Some("5.0 KB"));
}

#[test]
fn rounds_half_to_even_in_both_bases() {
    // 10 進: 1.05 GB はちょうど half。偶数側 1.0 に落ちる。
    assert_eq!(format_decimal(1_050_000_000).as_deref(), Some("1.0 GB"));
    // 1.15 GB もちょうど half。偶数側 1.2 に上がる。
    assert_eq!(format_decimal(1_150_000_000).as_deref(), Some("1.2 GB"));
    // 2 進: 1280 bytes = 1.25 KiB → 1.2、1792 bytes = 1.75 KiB → 1.8。
    assert_eq!(format_binary(1_280).as_deref(), Some("1.2 KiB"));
    assert_eq!(format_binary(1_792).as_deref(), Some("1.8 KiB"));
}

#[test]
fn a_carry_that_crosses_the_unit_boundary_reselects_the_unit() {
    // 単位選択時点では GB だが、丸めで 1000.0 に達する（設計書 §3）。
    // format_real の指数切替と同じく、判断は丸めた後の値で行う。
    assert_eq!(format_decimal(999_999_999_999).as_deref(), Some("1.0 TB"));
    // 2 進版: 1024^3 × 1023.95 以上、1024^4 未満。
    assert_eq!(format_binary(1_099_460_000_000).as_deref(), Some("1.0 TiB"));
}

#[test]
fn the_top_unit_does_not_reselect() {
    // TB より上は無い。1000.0 TB は連続的な表示であって異常ではない。
    // 999.95 TB ちょうどが half → 奇数の 9 なので繰り上がり → 1000.0 TB。
    assert_eq!(format_decimal(999_950_000_000_000).as_deref(), Some("1000.0 TB"));
    // その先も TB のまま伸びる。
    assert_eq!(format_decimal(5_000_000_000_000_000).as_deref(), Some("5000.0 TB"));
}

#[test]
fn the_section_25_example() {
    // 1e9 × 65536 × 8 bytes = 524,288,000,000,000（base-spec §25）。
    assert_eq!(format_decimal(524_288_000_000_000).as_deref(), Some("524.3 TB"));
    assert_eq!(format_binary(524_288_000_000_000).as_deref(), Some("476.8 TiB"));
}
```

- [ ] **Step 5: `format.rs` を実装する**

```rust
//! バイト数の表示。厳密整数と表示丸めの分離（設計書 §3、base-spec §26 の整数版）。
//!
//! 換算経路に f64 を使わない。商と剰余の u128 演算だけで小数第 1 位を
//! round-half-to-even に丸める。丸めで表示値が基数（1000 / 1024）に達したら
//! 単位を選び直す——判断は丸めた後の値で行う。`format_real` の指数表記切替と
//! 同じ設計思想である。

/// 10 進の単位。値が 1 以上になる最大の単位を選ぶ。
const DECIMAL_UNITS: [(&str, u128); 4] = [
    ("KB", 1_000),
    ("MB", 1_000_000),
    ("GB", 1_000_000_000),
    ("TB", 1_000_000_000_000),
];

/// 2 進の単位。
const BINARY_UNITS: [(&str, u128); 4] = [
    ("KiB", 1 << 10),
    ("MiB", 1 << 20),
    ("GiB", 1 << 30),
    ("TiB", 1 << 40),
];

/// 3 桁区切り。
pub fn group_digits(bytes: u128) -> String {
    let digits = bytes.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        // 残り桁数が 3 の倍数になる位置の直前に区切りを入れる。
        if i != 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

pub fn format_decimal(bytes: u128) -> Option<String> {
    scaled(bytes, &DECIMAL_UNITS, 1_000)
}

pub fn format_binary(bytes: u128) -> Option<String> {
    scaled(bytes, &BINARY_UNITS, 1_024)
}

/// 値が 1 以上になる最大の単位で `"307.2 GB"` の形にする。最小単位未満は None。
fn scaled(bytes: u128, units: &[(&str, u128); 4], base: u128) -> Option<String> {
    let mut index = units.iter().rposition(|(_, d)| bytes >= *d)?;
    loop {
        let (unit, divisor) = units[index];
        let (whole, tenth) = round_tenth(bytes, divisor);
        // 丸めで基数に達したら 1 つ上の単位で丸め直す。最上位に上は無い。
        if whole >= base && index + 1 < units.len() {
            index += 1;
            continue;
        }
        return Some(format!("{whole}.{tenth} {unit}"));
    }
}

/// bytes / divisor を小数第 1 位まで、round-half-to-even で。
///
/// 10 × r は r < divisor <= 2^40 なのであふれない（設計書 §3）。
fn round_tenth(bytes: u128, divisor: u128) -> (u128, u128) {
    let mut whole = bytes / divisor;
    let remainder = bytes % divisor;
    let numerator = remainder * 10;
    let mut tenth = numerator / divisor;
    let leftover = numerator % divisor;
    let round_up = match (leftover * 2).cmp(&divisor) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Equal => tenth % 2 == 1, // half は偶数側へ
        std::cmp::Ordering::Less => false,
    };
    if round_up {
        tenth += 1;
        if tenth == 10 {
            tenth = 0;
            whole += 1;
        }
    }
    (whole, tenth)
}
```

`group_digits` の区切り挿入は上の書き方に固執せず、「後ろから 3 桁ごと」が
素直に読める実装なら形は任せる（例: バイト列を逆順に 3 つずつ chunk して
join）。テストが仕様である。

- [ ] **Step 6: 検証してコミット**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 125 + 新規（mod 7 件 + format 8 件 = 15 件）= **140 件** PASS

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Give the platform its second core: byte counts in u128

count × dimensions × datatype, checked at every step — a byte count that
silently wrapped would be the exact overflow §25 forbids. The display
path never touches f64: quotient and remainder arithmetic rounds the
single decimal half-to-even, and when rounding carries into the base,
the unit is re-selected on the rounded value — the same design as
format_real's notation switch, written down this time before the bug.

This is #7's decision in code: no shared numeric type. The module talks
to the rest of the crate through CalcError and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: 言語間検証（Python 参照・testdata・golden リーダー）

**Files:**
- Create: `reference/src/calcarc_reference/data_scale_ref.py`
- Create: `reference/tests/test_data_scale_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`（`DATA_SCALE_INPUTS`）
- Modify: `reference/scripts/generate.py`（`build_data_scale()` と書き出し）
- Create: `crates/calcarc-core/tests/data_scale_golden.rs`
- Create: `testdata/data_scale.json`（生成物）

**Interfaces:**
- Consumes: Task 1 の全公開関数
- Produces: `testdata/data_scale.json`（schema 1、tolerance 無し、bytes は文字列、
  エラーケースは `expect: {"error": "Overflow" | "SyntaxError"}`）

- [ ] **Step 1: Python 参照実装を書く（TDD: テスト → ImportError → 実装）**

`test_data_scale_ref.py`:

```python
"""Data Scale 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.data_scale_ref import U128_MAX, compute


def test_headline_case() -> None:
    r = compute("100000000", "768", "float32")
    assert r == {
        "bytes": "307200000000",
        "bytes_grouped": "307,200,000,000",
        "decimal": "307.2 GB",
        "binary": "286.1 GiB",
    }


def test_overflow_is_the_u128_contract() -> None:
    # 積が 2^128 以上なら Rust 側は表現できない。これは §25 が定めた公開契約。
    half = str(1 << 127)
    assert compute(half, "2", "uint8") == {"error": "Overflow"}
    assert "error" not in compute(str((1 << 127) - 1), "2", "uint8")


def test_carry_reselects_the_unit() -> None:
    assert compute("999999999999", "1", "uint8")["decimal"] == "1.0 TB"


def test_below_the_smallest_unit_lines_are_absent() -> None:
    r = compute("999", "1", "uint8")
    assert r["decimal"] is None and r["binary"] is None
```

`data_scale_ref.py`:

```python
"""Data Scale の参照実装。

数値は Python の組み込み int（任意精度、base-spec §29）。u128 と自然に
手法が独立する。丸め規則（小数第 1 位・half-to-even・繰り上がり時の単位
再選択）と u128 の上限は、アルゴリズムではなく仕様として固定された公開契約
である（設計書 §5）——契約を知らなければ独立検証は書けない。
"""

from __future__ import annotations

U128_MAX = (1 << 128) - 1

BYTES_PER_ELEMENT = {
    "int8": 1,
    "uint8": 1,
    "int16": 2,
    "float16": 2,
    "bfloat16": 2,
    "int32": 4,
    "float32": 4,
    "int64": 8,
    "float64": 8,
}

DECIMAL_UNITS = [("KB", 10**3), ("MB", 10**6), ("GB", 10**9), ("TB", 10**12)]
BINARY_UNITS = [("KiB", 2**10), ("MiB", 2**20), ("GiB", 2**30), ("TiB", 2**40)]


def _parse(text: str) -> int | None:
    if not text or not text.isascii() or not text.isdigit():
        return None
    value = int(text)
    return value if value <= U128_MAX else None


def _round_tenth(size: int, divisor: int) -> tuple[int, int]:
    whole, remainder = divmod(size, divisor)
    tenth, leftover = divmod(remainder * 10, divisor)
    if leftover * 2 > divisor or (leftover * 2 == divisor and tenth % 2 == 1):
        tenth += 1
        if tenth == 10:
            tenth = 0
            whole += 1
    return whole, tenth


def _scaled(size: int, units: list[tuple[str, int]], base: int) -> str | None:
    candidates = [i for i, (_, d) in enumerate(units) if size >= d]
    if not candidates:
        return None
    index = candidates[-1]
    while True:
        unit, divisor = units[index]
        whole, tenth = _round_tenth(size, divisor)
        if whole >= base and index + 1 < len(units):
            index += 1
            continue
        return f"{whole}.{tenth} {unit}"


def compute(count: str, dimensions: str, dtype: str) -> dict:
    c = _parse(count)
    d = _parse(dimensions)
    per = BYTES_PER_ELEMENT.get(dtype)
    if c is None or d is None or per is None:
        return {"error": "SyntaxError"}
    size = c * d * per
    if size > U128_MAX:
        return {"error": "Overflow"}
    return {
        "bytes": str(size),
        "bytes_grouped": f"{size:,}",
        "decimal": _scaled(size, DECIMAL_UNITS, 1000),
        "binary": _scaled(size, BINARY_UNITS, 1024),
    }
```

（3 桁区切りは Python の `f"{size:,}"` — Rust とは別の道で同じ約束に着く。）

Run: `cd reference && uv run --no-config pytest`
Expected: 13 + 4 = 17 件 PASS

- [ ] **Step 2: `cases.py` に入力を足す**

```python
# (count, dimensions, dtype)。文字列なのは u128 の定義域を JSON/JS の
# number(2^53)で殺さないため(設計書 §4・§5)。
DATA_SCALE_INPUTS: list[tuple[str, str, str]] = [
    ("100000000", "768", "float32"),  # 基準例(§49 M4): 307.2 GB / 286.1 GiB
    ("1000000000", "65536", "int64"),  # base-spec §25 の例
    # 9 データ型それぞれ 1 件。1×1 なので bytes のみ(単位行は None)。
    ("1", "1", "int8"),
    ("1", "1", "uint8"),
    ("1", "1", "int16"),
    ("1", "1", "float16"),
    ("1", "1", "bfloat16"),
    ("1", "1", "int32"),
    ("1", "1", "float32"),
    ("1", "1", "int64"),
    ("1", "1", "float64"),
    ("0", "768", "float32"),  # 0 は正当な入力
    # 単位の境界(非対称: 1000..=1023 は 10 進だけが出る)
    ("999", "1", "uint8"),
    ("1000", "1", "uint8"),
    ("1023", "1", "uint8"),
    ("1024", "1", "uint8"),
    # half ちょうど(round-half-to-even の実証、10 進と 2 進)
    ("1050000000", "1", "uint8"),  # 1.05 GB -> 1.0 GB(偶数へ)
    ("1150000000", "1", "uint8"),  # 1.15 GB -> 1.2 GB(偶数へ)
    ("1280", "1", "uint8"),  # 1.25 KiB -> 1.2 KiB
    ("1792", "1", "uint8"),  # 1.75 KiB -> 1.8 KiB
    # 丸め繰り上がりが単位境界を越える(設計書 §3 の再選択規則、10 進と 2 進)
    ("999999999999", "1", "uint8"),  # -> 1.0 TB
    ("1099460000000", "1", "uint8"),  # -> 1.0 TiB
    # 最上位単位は再選択しない(999.95 TB の half が繰り上がって 1000.0 TB)
    ("999950000000000", "1", "uint8"),  # -> 1000.0 TB
    # u128 上限近傍の成功と、上限超の Overflow(u128 契約)
    (str((1 << 127) - 1), "2", "uint8"),
    (str(1 << 127), "2", "uint8"),  # 2^128 -> Overflow
    (str(1 << 64), str(1 << 64), "uint8"),  # 2^128 -> Overflow(積の経路違い)
    # パース不能(SyntaxError)
    ("abc", "1", "float32"),
    ("100", "1", "float128"),  # 未知のデータ型
]
```

- [ ] **Step 3: `generate.py` に `build_data_scale()` を足す**

```python
def build_data_scale() -> dict:
    entries = []
    for count, dimensions, dtype in cases.DATA_SCALE_INPUTS:
        result = data_scale_ref.compute(count, dimensions, dtype)
        entries.append(
            {
                "id": f"data_scale/{count}x{dimensions}x{dtype}",
                "op": "data_scale",
                "input": {"count": count, "dimensions": dimensions, "dtype": dtype},
                "expect": result,
            }
        )
    # 整数の完全一致なので tolerance を持たない(設計書 §5)。
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }
```

import に `data_scale_ref` を足し、`main()` に
`write("data_scale.json", build_data_scale())` を足す。

- [ ] **Step 4: Rust 側の golden リーダーを書く**

`crates/calcarc-core/tests/data_scale_golden.rs`:

```rust
//! data_scale の期待値を Python 参照実装と突き合わせる(base-spec §35)。
//!
//! 比較は完全一致。整数と決定的な丸めに許容誤差は存在しないので、
//! このファイルの golden は tolerance を持たない(設計書 §5)。
//! バイト数は JSON でも文字列——JSON number は 2^53 で精度を失う。

use std::path::PathBuf;

use calcarc_core::CalcError;
use calcarc_core::data_scale::{self, DataType, format};
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
    count: String,
    dimensions: String,
    dtype: String,
}

#[derive(Debug, Deserialize)]
struct Expect {
    #[serde(default)]
    bytes: Option<String>,
    #[serde(default)]
    bytes_grouped: Option<String>,
    #[serde(default)]
    decimal: Option<String>,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn load() -> Golden {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "testdata", "data_scale.json"]
        .iter()
        .collect();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("cannot read {}: {e}. Run reference/scripts/generate.py", path.display())
    });
    let golden: Golden = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
    assert_eq!(golden.schema, SCHEMA, "incompatible schema");
    assert!(!golden.cases.is_empty(), "no cases");
    golden
}

/// 入力 3 つから Rust 側の結果を出す。参照実装の compute と同じ形の分岐。
fn run(input: &Input) -> Result<(u128, String, Option<String>, Option<String>), CalcError> {
    let count = data_scale::parse_count(&input.count)?;
    let dimensions = data_scale::parse_count(&input.dimensions)?;
    let dtype = DataType::from_token(&input.dtype).ok_or(CalcError::SyntaxError)?;
    let bytes = data_scale::size_in_bytes(count, dimensions, dtype)?;
    Ok((
        bytes,
        format::group_digits(bytes),
        format::format_decimal(bytes),
        format::format_binary(bytes),
    ))
}

#[test]
fn data_scale_matches_the_reference() {
    let golden = load();
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        match (run(&case.input), &case.expect.error) {
            (Ok((bytes, grouped, decimal, binary)), None) => {
                assert_eq!(Some(bytes.to_string()), case.expect.bytes, "{}: bytes", case.id);
                assert_eq!(Some(grouped), case.expect.bytes_grouped, "{}: grouped", case.id);
                assert_eq!(decimal, case.expect.decimal, "{}: decimal", case.id);
                assert_eq!(binary, case.expect.binary, "{}: binary", case.id);
            }
            (Err(e), Some(expected)) => {
                let code = match e {
                    CalcError::Overflow => "Overflow",
                    CalcError::SyntaxError => "SyntaxError",
                    other => panic!("{}: unexpected error kind {other:?}", case.id),
                };
                assert_eq!(code, expected, "{}: error kind", case.id);
            }
            (Ok(_), Some(expected)) => panic!("{}: expected {expected} but succeeded", case.id),
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }
}
```

- [ ] **Step 5: 生成して噛み合わせる**

Run: `cd reference && uv run --no-config python scripts/generate.py`（2 回、2 回目差分ゼロ）
Run: `cargo test --workspace`
Expected: 140 + 1 = **141 件** PASS。data_scale.json は 28 ケース。

- [ ] **Step 6: 赤の実証 2 種（設計書 §5。新設検査なので必須）**

1. **1000↔1024 の取り違え**: `format.rs` の `format_decimal` を一時的に
   `BINARY_UNITS` で呼ぶよう書き換え、`cargo test -p calcarc-core --test data_scale_golden`
   が基準例で赤になることを確認して戻す（§17 の混同排除を golden が守る証拠）。
2. **half-up 化**: `round_tenth` の `Ordering::Equal` の腕を一時的に `true` に
   変え、half ちょうどのケース（1.05 GB / 1.25 KiB）で赤になることを確認して戻す。

**両方の赤の実出力を報告に貼る。** 戻した後の緑と `git diff` クリーンを確認。

- [ ] **Step 7: 検証してコミット**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && cd reference && uv run --no-config pytest`
Expected: Rust 141 / Python 17。`git status` で uv.lock 差分なし。

```bash
git add reference/ testdata/data_scale.json crates/calcarc-core/tests/data_scale_golden.rs
git commit -F - <<'EOF'
Cross-check byte counts against Python, exactly

The golden file for data_scale carries no tolerance field — integers and
deterministic rounding admit exact equality only — and byte counts travel
as strings, because JSON numbers lie past 2^53. Error cases live in the
golden too: the u128 ceiling is a published contract (§25), and the
reference checks the contract, not the algorithm — its arithmetic is
arbitrary-precision int and never overflows.

Both new checks were broken on purpose and watched failing: swapping the
1000/1024 tables reddens the headline case, and rounding half-up instead
of half-to-even reddens the tie cases in both bases.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: WASM 境界（純関数）

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`（`data_scale` 関数と結果型）
- Modify: `crates/calcarc-wasm/tests/web.rs`（境界テスト）

**Interfaces:**
- Consumes: Task 1 の `data_scale::{parse_count, size_in_bytes, DataType, format}`
- Produces（Task 4 の TS ラッパーが呼ぶ）:
  - `data_scale(count: &str, dimensions: &str, dtype: &str) -> JsValue`
  - 戻り値の形（serde、camelCase・null 化は既存の Step と同じ流儀）:
    `{ bytes: string|null, bytesGrouped: string|null, decimal: string|null, binary: string|null, error: "Overflow"|"SyntaxError"|null }`

- [ ] **Step 1: 実装する**

`lib.rs` に追加（既存の `to_js` の `serialize_missing_as_null` の理由コメントの
流儀を踏襲）:

```rust
use calcarc_core::data_scale::{self, DataType, format};

/// Data Scale の 1 回の計算結果。TypeScript 側の `DataScaleResult` に対応する。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataScaleResult {
    bytes: Option<String>,
    bytes_grouped: Option<String>,
    decimal: Option<String>,
    binary: Option<String>,
    error: Option<calcarc_core::CalcError>,
}

/// count × dimensions × dtype を計算する。純関数で、状態を持たない。
///
/// Scientific の reduce と違いキーストローク状態機械ではないので、
/// 状態の受け渡しをしない(設計書 §4)。入出力が文字列なのは、JS の
/// number が 2^53 を超えると u128 の定義域を境界で殺すため。
/// 例外は投げない。エラーは戻り値の一部である。
#[wasm_bindgen]
pub fn data_scale(count: &str, dimensions: &str, dtype: &str) -> JsValue {
    let outcome = data_scale::parse_count(count)
        .and_then(|c| Ok((c, data_scale::parse_count(dimensions)?)))
        .and_then(|(c, d)| {
            let t = DataType::from_token(dtype).ok_or(calcarc_core::CalcError::SyntaxError)?;
            data_scale::size_in_bytes(c, d, t)
        });
    let result = match outcome {
        Ok(bytes) => DataScaleResult {
            bytes: Some(bytes.to_string()),
            bytes_grouped: Some(format::group_digits(bytes)),
            decimal: format::format_decimal(bytes),
            binary: format::format_binary(bytes),
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
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    result.serialize(&serializer).unwrap_or(JsValue::NULL)
}
```

（`data_scale` モジュール名と関数名が衝突しないよう、モジュール側は
`calcarc_core::data_scale` のフルパスで呼ぶ。曖昧になるなら
`use calcarc_core::data_scale as core_data_scale;` の別名でよい——
コンパイラに従う。）

- [ ] **Step 2: 境界テストを書く**

`tests/web.rs` に追加（既存の流儀: js 値を取り出して検査）:

```rust
#[wasm_bindgen_test]
fn data_scale_crosses_the_boundary() {
    // 基準例。値はすべて文字列で往復する。
    let result = data_scale("100000000", "768", "float32");
    let bytes = js_sys::Reflect::get(&result, &"bytes".into()).unwrap();
    assert_eq!(bytes.as_string().as_deref(), Some("307200000000"));
    let decimal = js_sys::Reflect::get(&result, &"decimal".into()).unwrap();
    assert_eq!(decimal.as_string().as_deref(), Some("307.2 GB"));
}

#[wasm_bindgen_test]
fn data_scale_survives_values_beyond_js_numbers() {
    // 2^127 - 1。JS の number では表現できない桁が文字列で往復する。
    let result = data_scale("170141183460469231731687303715884105727", "1", "uint8");
    let bytes = js_sys::Reflect::get(&result, &"bytes".into()).unwrap();
    assert_eq!(
        bytes.as_string().as_deref(),
        Some("170141183460469231731687303715884105727")
    );
}

#[wasm_bindgen_test]
fn data_scale_errors_are_returned_not_thrown() {
    let result = data_scale("170141183460469231731687303715884105728", "2", "uint8");
    let error = js_sys::Reflect::get(&result, &"error".into()).unwrap();
    assert_eq!(error.as_string().as_deref(), Some("Overflow"));
    let bytes = js_sys::Reflect::get(&result, &"bytes".into()).unwrap();
    assert!(bytes.is_null(), "error results carry null, not undefined");
}
```

（`CalcError` の serde 表現が `"Overflow"` の文字列であることは既存の
`CalcErrorCode` 型が前提にしている。違ったらこのテストが教えてくれる。）

- [ ] **Step 3: 検証してコミット**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 141 件 PASS
Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 6 + 3 = **9 件** PASS

```bash
git add crates/calcarc-wasm/
git commit -F - <<'EOF'
Open the boundary for data_scale as one pure function

No reducer here: a form computes from its fields, holds no state, and
importing the keystroke machine would double-track every value. Inputs
and outputs are strings end to end, because a u128 dies in a JS number
past 2^53 — the boundary test walks 2^127 - 1 across and back intact.
Errors return, never throw, as everywhere else on this boundary.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: TS ラッパーとフォーム UI

**Files:**
- Create: `web/src/datascale/types.ts`
- Create: `web/src/datascale/index.ts`（framework 非依存。React import 禁止）
- Create: `web/src/ui/DataScale/DataScalePanel.tsx`
- Create: `web/src/ui/DataScale/DataScalePanel.module.css`
- Create: `web/src/ui/DataScale/DataScalePanel.test.tsx`

**Interfaces:**
- Consumes: Task 3 の wasm `data_scale`
- Produces（Task 5 が使う）: `<DataScalePanel />`（自己完結。ラッパーの初期化も
  内部で行う）、`initDataScale(): Promise<DataScaleCalc>`

- [ ] **Step 1: types.ts**

```typescript
/** calcarc-core の data_scale::DataType に対応するトークン。 */
export const DATA_TYPE_TOKENS = [
  "int8",
  "uint8",
  "int16",
  "float16",
  "bfloat16",
  "int32",
  "float32",
  "int64",
  "float64",
] as const;

export type DataTypeToken = (typeof DATA_TYPE_TOKENS)[number];

/** calcarc-wasm の DataScaleResult に対応。 */
export interface DataScaleResult {
  bytes: string | null;
  bytesGrouped: string | null;
  decimal: string | null;
  binary: string | null;
  error: "Overflow" | "SyntaxError" | null;
}
```

- [ ] **Step 2: index.ts（ラッパー）**

`web/src/calc/index.ts` と同じ形（キャッシュした ready、失敗時のキャッシュ破棄、
React import 禁止のヘッダコメント）で:

```typescript
import init, { data_scale } from "../wasm/calcarc_wasm.js";
import type { DataScaleResult, DataTypeToken } from "./types";

export type { DataScaleResult, DataTypeToken } from "./types";
export { DATA_TYPE_TOKENS } from "./types";

export interface DataScaleCalc {
  compute(count: string, dimensions: string, dtype: DataTypeToken): DataScaleResult;
}

let ready: Promise<DataScaleCalc> | null = null;

export function initDataScale(): Promise<DataScaleCalc> {
  ready ??= init()
    .then(
      (): DataScaleCalc => ({
        compute: (count, dimensions, dtype) =>
          data_scale(count, dimensions, dtype) as DataScaleResult,
      }),
    )
    .catch((cause: unknown) => {
      ready = null;
      throw cause;
    });
  return ready;
}
```

**確認事項（実装時に必ず見る）**: `web/src/wasm/calcarc_wasm.js` の生成された
`init`（`__wbg_init`）が **2 回目の呼び出しで再インスタンス化せず早期 return
するか**。calc 側と datascale 側の両方が `init()` を呼ぶため。近年の
wasm-bindgen は module キャッシュで早期 return する。**もし再インスタンス化する
生成になっていたら、この設計は二重の wasm メモリを作るので STOP して報告**
（共有ローダーへの変更は controller 判断）。

- [ ] **Step 3: フォームコンポーネント（vitest → 実装）**

`DataScalePanel.test.tsx` の要点（既存の `App.test.tsx`/`Keypad.test.tsx` の
流儀。wasm は vitest から呼べないので `initDataScale` を vi.mock する）:

```typescript
// 検査すること:
// 1. count / dimensions の <input> と dtype の <select> が <label> で結線
//    されている(getByLabelText で引ける)。
// 2. 全フィールドが埋まると結果领域(role="status")に bytes・decimal・
//    binary が出る(mock の返す値で検証)。
// 3. フィールドが空のあいだは中立表示——エラーが「出ていない」ことを検査
//    (設計書 §6: 未入力とエラーの区別)。
// 4. mock が error: "Overflow" を返したら結果領域にエラー表示が出る。
// 5. dtype の <select> に 9 個の option が DATA_TYPE_TOKENS の順で並ぶ。
```

`DataScalePanel.tsx` の設計:

```typescript
// - useState で count / dimensions / dtype(既定 "float32")を持つ。
// - initDataScale() は useEffect で 1 回。読めなければ既存 App と同じ
//   role="alert" の失敗表示。
// - count と dimensions の両方が非空のときだけ compute を呼ぶ(設計書 §6:
//   空は SyntaxError ではなく中立)。結果は導出値であり、useState に
//   持たない(入力から毎レンダー計算する。二重管理をしない)。
// - 入力は <input inputMode="numeric" autoComplete="off">。maxLength は
//   40(u128 の 10 進最大 39 桁 + 1。切り詰めはコアがエラーで教える)。
// - 結果領域: <output role="status"> に bytesGrouped + " bytes" の行、
//   decimal の行(null なら行ごと出さない)、binary の行(同)。
//   エラー時は既存の Math ERROR と同じ文字列表示の流儀。
// - スタイルは既存のデザイントークン(web/src/ui/tokens.css)を使い、
//   タッチターゲット 44px 以上。
```

- [ ] **Step 4: 検証してコミット**

Run: `cd web && pnpm wasm && pnpm test`
Expected: 31 + 新規（5 件前後）≈ 36 件 PASS
Run: `cargo test --workspace`（Rust 不触の確認）
Expected: 141 件 PASS

```bash
git add web/src/datascale/ web/src/ui/DataScale/
git commit -F - <<'EOF'
Build the Data Scale form: fields in, three lines out

The wrapper mirrors calc/'s shape — framework-free, cached init, a
thrown-away promise on failure — and the panel keeps no derived state:
results are computed from the fields on every render, because a stored
copy is a second source of truth waiting to disagree. Empty fields are
neutral, not errors; the core's SyntaxError is for text that claims to
be a number and is not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: ナビゲーションと App の再構成

**Files:**
- Create: `web/src/ui/Nav/Nav.tsx`、`Nav.module.css`、`Nav.test.tsx`
- Create: `web/src/ui/ScientificPanel.tsx`（既存 App の中身を移す）
- Modify: `web/src/App.tsx`（シェル化: ナビ + パネル切替）
- Modify: `web/src/App.test.tsx`（追従）

**Interfaces:**
- Consumes: Task 4 の `<DataScalePanel />`
- Produces: ハッシュルーティング（`#scientific` / `#data-scale`、既定は scientific）

- [ ] **Step 1: ScientificPanel の切り出し**

現在の `App.tsx` の中身（initCalc・step 状態・press・useKeyboard・Display・
Keypad・version 表示）を `ScientificPanel.tsx` にそのまま移す。**ロジックは
1 行も変えない——ファイルを分けるだけ。** 重要: `useKeyboard` がこの
コンポーネントの中に居ることで、**Data Scale 表示中はアンマウントされて
グローバルの keydown リスナが外れる**。フォームに数字を打つと裏の電卓が
動く、という漏れをマウント構造そのもので塞ぐ（後で E2E が固定する）。

- [ ] **Step 2: Nav（vitest → 実装）**

`Nav.test.tsx` の要点:

```typescript
// 1. <nav> ランドマークがアクセシブルネームを持つ(aria-label)。
// 2. リンクが 2 つ(Scientific / Data Scale)、href は "#scientific" /
//    "#data-scale"。
// 3. current に一致する側だけ aria-current="page" を持つ。
```

`Nav.tsx`:

```typescript
export type ModuleId = "scientific" | "data-scale";

const MODULES: { id: ModuleId; href: string; label: string }[] = [
  { id: "scientific", href: "#scientific", label: "Scientific" },
  { id: "data-scale", href: "#data-scale", label: "Data Scale" },
];

export function Nav({ current }: { current: ModuleId }) {
  return (
    <nav aria-label="Calculators" className={styles.nav}>
      {MODULES.map((m) => (
        <a
          key={m.id}
          href={m.href}
          aria-current={m.id === current ? "page" : undefined}
          className={styles.tab}
        >
          {m.label}
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: App のシェル化**

```typescript
// - location.hash から ModuleId を導く(不明・空は "scientific")。
// - hashchange を useEffect で購読して state を更新。リンクの href が
//   ハッシュを変えるので、クリックハンドラは書かない(ブラウザに任せる。
//   履歴・共有・リロードが標準動作で手に入る——設計書 §6 の理由)。
// - <Nav current={module} /> + { module === "scientific"
//     ? <ScientificPanel /> : <DataScalePanel /> }
```

`App.test.tsx` は「既定で Scientific が出る」「hash が #data-scale なら
フォームが出る」の 2 点に追従（jsdom で location.hash は設定可能）。

- [ ] **Step 4: 検証してコミット**

Run: `cd web && pnpm test`
Expected: 36 + 新規（Nav 3 + App 追従）≈ 40 件 PASS
Run: `cd web && pnpm build`（tsc を含む。切り出しの型漏れを捕まえる）
Expected: 成功

```bash
git add web/src/
git commit -F - <<'EOF'
Turn the app into a platform shell with its first navigation

Two tabs, plain anchors, the URL hash as the single source of module
state — the browser supplies history, reload survival and shareability
for free, and a router dependency for two modules would be weight
without work. The keyboard listener moves inside ScientificPanel, so
switching modules unmounts it: typing digits into the form cannot drive
the calculator behind it, by construction rather than by guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: E2E と最終スイープ

**Files:**
- Create: `web/tests/e2e/data-scale.spec.ts`
- Modify: `web/tests/e2e/vertical-slice.spec.ts`（既存テストがナビ追加で
  壊れる場合の追従のみ。期待値は変えない）

**Interfaces:**
- Consumes: すべて
- Produces: spec §9 の完了条件 1・4 の E2E 固定

- [ ] **Step 1: E2E を書く**

`data-scale.spec.ts`（既存 spec の流儀で）:

```typescript
// 1. ナビ切替: #scientific ⇔ #data-scale を両方向。aria-current が追従。
// 2. 基準例: count=100000000, dimensions=768, dtype=float32 と入力し、
//    結果領域に "307,200,000,000 bytes" と "307.2 GB" と "286.1 GiB" が
//    出る(完了条件 1。実 wasm なので mock ではない)。
// 3. 巨大値: count に 2^127-1 の 39 桁を入れて bytes がそのまま表示される
//    (JS number を経由していない証拠)。
// 4. Overflow: 2^127 × dimensions=2 でエラー表示。
// 5. フォームの a11y: getByLabelText で 3 フィールドが引ける。
// 6. 入力途中(dimensions 空)でエラーが出ていない(中立表示)。
// 7. フォームで数字キーを打っても Scientific の状態が動かない:
//    data-scale で "3" を打ち、scientific に戻って表示が "0" のまま。
// 8. タッチターゲット: ナビのタブが 44px 以上(既存テストの流儀)。
```

- [ ] **Step 2: フルスイープ（ブランチ唯一）**

```
cargo fmt && cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                                   # 141
wasm-pack test --headless --chrome crates/calcarc-wasm   # 9
cd web && pnpm wasm && pnpm test && pnpm e2e             # ~40 + 22 前後
cd reference && uv run --no-config pytest                # 17
uv run --no-config python scripts/generate.py && git diff --exit-code testdata/
git status
```

- [ ] **Step 3: コミット**

```bash
git add web/tests/
git commit -F - <<'EOF'
Pin the platform behaviors a DOM emulator cannot see

The navigation, the form labels, the focus behavior and the touch
targets live in the accessibility tree, and jsdom does not build one —
so the browser checks them. The headline case runs against the real
wasm: 100M × 768 × float32 shows 307.2 GB and 286.1 GiB, a 39-digit
count survives the boundary, and typing into the form leaves the
calculator behind it untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | close |
|---|---|---|---|
| 1 | data_scale コア（u128・整数丸め・単位再選択） | cargo（140 件） | — |
| 2 | Python 参照・data_scale.json・golden リーダー | cargo + pytest + 再生成（141/17） | — |
| 3 | wasm 純関数（文字列境界） | + wasm-pack（9 件） | — |
| 4 | TS ラッパーとフォーム | + vitest（~36 件） | — |
| 5 | ナビと App シェル化 | + vitest + build | — |
| 6 | E2E とフルスイープ | 全レイヤー | #7（spec §1 が根拠） |
