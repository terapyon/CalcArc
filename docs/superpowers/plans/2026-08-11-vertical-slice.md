# CalcArc Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザ上の電卓で `3` `+` `j` `4` `=` `▸∠` と打鍵すると `5 ∠ 53.13010235` が表示され、その計算が Rust → WASM → TypeScript → React を実際に経由し、期待値が Python によって独立に生成されている状態を作る。

**Architecture:** 電卓の状態機械を `calcarc-core` に純粋な reducer（`reduce(state, key) -> (state, display)`）として置き、Rust は状態を保持しない。TypeScript が状態を持ち、キー押下ごとに WASM 境界を越えて新しい状態と表示内容を受け取る。値はすべて複素数（実数は虚部 0）として保持し、`▸∠` は表示形式のトグルのみで再計算しない。

**Tech Stack:** Rust (calcarc-core / calcarc-wasm, wasm-bindgen, serde, proptest) / TypeScript + React + Vite + CSS Modules (pnpm) / Python 3.14 + SymPy + mpmath (uv) / GitHub Actions / Playwright / Cloudflare Pages

**参照仕様:** [docs/superpowers/specs/2026-08-11-vertical-slice-design.md](../specs/2026-08-11-vertical-slice-design.md)（以下「設計書」）。`§n` は [docs/base-spec.md](../../base-spec.md) の節番号。

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- **クレート名は `calcarc-core` / `calcarc-wasm`。** ディレクトリは `crates/calcarc-core/` / `crates/calcarc-wasm/`。
- **Rust edition は 2024。** workspace の `[workspace.package]` で一元管理する。
- **Python は 3.14。** `uv` で管理する。`uv sync` が通らない場合のみ 3.13 に退避してよい（設計書 §12）。
- **Node のパッケージマネージャは pnpm。** `npm` / `yarn` を使わない。
- **表示は有効数字 10 桁、丸めは round-half-to-even。** 指数表記への切替は `|x| >= 1e10` または `0 < |x| < 1e-9`。
- **目標表示文字列は `5 ∠ 53.13010235`。** `∠` は U+2220、前後に半角スペース1つずつ。
- **直交形式の表示は `3+j4` 形式。** `j` は数の前。演算子の前後にスペースを入れない。
- **許容誤差は 2 層に分ける（§36「散在させない」）。**
  - 言語間検証（golden）の誤差は `testdata/*.json` の `tolerance` から読む。既定は `abs: 1e-12`, `rel: 1e-12`。
  - Rust のユニットテストの誤差は `calcarc_core::TEST_EPSILON` に集約する。
  - どちらの層でも、個々のテストに誤差値を直書きしない。
- **`calcarc-core` は panic しない。** `reduce` は常に有効な状態を返す。`unwrap()` / `expect()` / 添字アクセスによる panic を書かない。
- **WASM 境界は JavaScript 例外を投げない**（§27）。計算エラーは戻り値の一部。
- **`calcarc-core` は WASM に依存しない。** `wasm-bindgen` を依存に加えない。
- **`web/src/calc/` は React に依存しない。** `react` を import しない。
- **ライセンスは Apache-2.0。**
- **Vite の `base` は `/`。** Cloudflare Pages のルート配信のため。
- **タッチターゲットは最小 44px。** `--touch-target-min` として定義する。
- **コミット前に `cargo fmt` を実行する。** この計画中の Rust コードブロックは rustfmt で整形されていないため、そのまま転記すると `cargo fmt --check` が落ちる。各タスクは検証の最後に `cargo fmt` を走らせ、整形結果を同じコミットに含めること。`--check` だけでは直らない。
- **`Cargo.lock` をリポジトリに追跡させる。** ワークスペースの再現性と CI のため。生成物ではあるが `.gitignore` に入れない。
- **git commit の末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。**
- **`git push` と PR 作成は行わない。** ブランチ作成とコミットのみ。

---

## File Structure

```
CalcArc/
├── Cargo.toml                                   workspace 定義
├── LICENSE                                      Apache-2.0
├── README.md
├── CONTRIBUTING.md
├── .gitignore
├── rust-toolchain.toml
├── .github/workflows/ci.yml                     5 ジョブ
│
├── crates/calcarc-core/
│   ├── Cargo.toml
│   ├── src/lib.rs                               公開 API の再エクスポート
│   ├── src/error.rs                             CalcError / CalcResult
│   ├── src/numeric/mod.rs
│   ├── src/numeric/angle.rs                     AngleMode と度⇄ラジアン
│   ├── src/numeric/format.rs                    表示フォーマット（10 桁）
│   ├── src/complex/mod.rs
│   ├── src/complex/value.rs                     Value（複素数）
│   ├── src/complex/arith.rs                     四則演算
│   ├── src/complex/polar.rs                     Rect ⇄ Polar
│   ├── src/scientific/mod.rs                    sqrt / sqr / neg / sin / cos / tan
│   ├── src/engine/mod.rs                        reduce の入口
│   ├── src/engine/key.rs                        Key とトークン変換
│   ├── src/engine/state.rs                      EngineState / Buffer / BinOp
│   ├── src/engine/display.rs                    DisplayState 生成
│   ├── tests/engine_table.rs                    キー列 → 表示 のテーブルテスト
│   ├── tests/golden.rs                          testdata/*.json 検証
│   └── tests/roundtrip.rs                       proptest
│
├── crates/calcarc-wasm/
│   ├── Cargo.toml
│   ├── src/lib.rs                               initial_state / reduce / core_version
│   └── tests/web.rs                             wasm-bindgen-test
│
├── web/
│   ├── package.json  pnpm-lock.yaml  tsconfig.json  vite.config.ts  biome.json
│   ├── index.html
│   ├── public/_headers  public/_redirects
│   ├── src/main.tsx
│   ├── src/App.tsx                              useReducer による配線
│   ├── src/calc/index.ts                        WASM ラッパー（React 非依存）
│   ├── src/calc/types.ts                        境界の型定義
│   ├── src/ui/tokens.css                        デザイントークン
│   ├── src/ui/Key/Key.tsx        Key.module.css
│   ├── src/ui/Display/Display.tsx Display.module.css
│   ├── src/ui/Keypad/Keypad.tsx  Keypad.module.css  layout.ts
│   ├── src/ui/useKeyboard.ts                    物理キーボード入力
│   └── tests/e2e/vertical-slice.spec.ts
│
├── reference/
│   ├── pyproject.toml
│   ├── src/calcarc_reference/complex_ref.py     SymPy による Rect→Polar
│   ├── src/calcarc_reference/scientific_ref.py  mpmath による関数群
│   ├── src/calcarc_reference/cases.py           入力ケース定義
│   ├── scripts/generate.py                      testdata/*.json 生成
│   └── tests/test_complex_ref.py  tests/test_scientific_ref.py
│
├── testdata/complex.json  testdata/scientific.json
└── docs/numerical-policy.md
```

**分割の方針:** `complex` は「値の定義」「演算」「極形式」で分ける。この3つは変更理由が異なる（型の拡張 / 演算の追加 / 表現の追加）。`engine` は「キーの語彙」「状態」「表示」「遷移」で分ける。表示は状態から導出される純関数であり、状態遷移とは独立にテストできる。

---

## フェーズ構成

| フェーズ | タスク | 対応 Milestone | 完了時に動くもの |
|---|---|---|---|
| 1 | 1–5 | M0 / M1 前半 | 複素数の演算・変換・表示が Rust ライブラリとして動く |
| 2 | 6–11 | M1 後半 | 電卓の状態機械が完成し、キー列から表示文字列が出る |
| 3 | 12–13 | M1 検証 | Python が期待値を生成し、Rust がそれを検証する |
| 4 | 14–15 | M2 | ブラウザから WASM 経由で `reduce` が呼べる |
| 5 | 16–20 | M3 | 電卓 UI が動き、E2E が通る |
| 6 | 21 | M0 仕上げ | CI 5 ジョブとドキュメントが揃う |

---

# フェーズ 1 — Rust 計算コア（数値層）

## Task 1: Rust workspace と Value 型

**Files:**
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `crates/calcarc-core/Cargo.toml`
- Create: `crates/calcarc-core/src/lib.rs`
- Create: `crates/calcarc-core/src/error.rs`
- Create: `crates/calcarc-core/src/complex/mod.rs`
- Test: `crates/calcarc-core/src/complex/value.rs`（`#[cfg(test)]` モジュール）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `calcarc_core::complex::value::Value { pub re: f64, pub im: f64 }`
  - `Value::new(re: f64, im: f64) -> Value`
  - `Value::real(re: f64) -> Value`
  - `Value::imag(im: f64) -> Value`
  - `Value::is_real(&self) -> bool`
  - `Value::ZERO: Value`
  - `calcarc_core::error::CalcError`（`DivisionByZero` / `Overflow` / `TrigPole` / `SyntaxError`）
  - `calcarc_core::error::CalcResult<T> = Result<T, CalcError>`

- [ ] **Step 1: workspace の骨格を作る**

`Cargo.toml`:

```toml
[workspace]
resolver = "3"
members = ["crates/calcarc-core", "crates/calcarc-wasm"]

[workspace.package]
edition = "2024"
version = "0.1.0"
license = "Apache-2.0"
repository = "https://github.com/terapyon/CalcArc"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`crates/calcarc-wasm` はまだ存在しないため、この時点では `members` から `crates/calcarc-wasm` を外し、`members = ["crates/calcarc-core"]` とする。Task 14 で追加する。

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```

`.gitignore`:

```
/target
node_modules/
web/dist/
web/src/wasm/
.venv/
__pycache__/
*.pyc
.pytest_cache/
test-results/
playwright-report/
.superpowers/
```

`LICENSE` は Apache License 2.0 の全文を入れる。取得元: <https://www.apache.org/licenses/LICENSE-2.0.txt>

- [ ] **Step 2: calcarc-core クレートを作る**

`crates/calcarc-core/Cargo.toml`:

```toml
[package]
name = "calcarc-core"
edition.workspace = true
version.workspace = true
license.workspace = true
repository.workspace = true
description = "Calculation core for CalcArc. No WASM or UI dependencies."

[dependencies]
serde = { workspace = true }
```

`crates/calcarc-core/src/lib.rs`:

```rust
//! CalcArc の計算コア。WASM と UI に依存しない。

pub mod complex;
pub mod error;

pub use complex::value::Value;
pub use error::{CalcError, CalcResult};
```

`crates/calcarc-core/src/error.rs`:

```rust
use serde::{Deserialize, Serialize};

/// 計算中に発生しうるエラー。UI に panic を露出させないため、
/// 計算コアは必ずこの型を通してエラーを返す（base-spec §27）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CalcError {
    /// 0 による除算。
    DivisionByZero,
    /// 結果が f64 の有限範囲を超えた。
    Overflow,
    /// tan の極（Deg モードの 90 + 180n 度）での評価。
    TrigPole,
    /// 対応しない `)` や `.` の重複など、入力列として不正。
    SyntaxError,
}

pub type CalcResult<T> = Result<T, CalcError>;
```

`crates/calcarc-core/src/complex/mod.rs`:

```rust
pub mod value;
```

- [ ] **Step 3: Value の失敗するテストを書く**

`crates/calcarc-core/src/complex/value.rs` の末尾に置く。

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_has_zero_imaginary_part() {
        let v = Value::real(3.0);
        assert_eq!(v.re, 3.0);
        assert_eq!(v.im, 0.0);
        assert!(v.is_real());
    }

    #[test]
    fn imag_has_zero_real_part() {
        let v = Value::imag(4.0);
        assert_eq!(v.re, 0.0);
        assert_eq!(v.im, 4.0);
        assert!(!v.is_real());
    }

    #[test]
    fn zero_is_real() {
        assert!(Value::ZERO.is_real());
        assert_eq!(Value::ZERO, Value::new(0.0, 0.0));
    }

    #[test]
    fn negative_zero_imaginary_still_counts_as_real() {
        // -0.0 == 0.0 は true なので実数扱いになる。
        // atan2 の符号が -0.0 で変わるため、この前提を明示的に固定しておく。
        assert!(Value::new(1.0, -0.0).is_real());
    }
}
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core`
Expected: FAIL。`cannot find type Value in this scope` などのコンパイルエラー。

- [ ] **Step 5: Value を実装する**

`crates/calcarc-core/src/complex/value.rs` の先頭に置く。

```rust
use serde::{Deserialize, Serialize};

/// 計算コアが扱う唯一の数値型。
///
/// 実数も虚部 0 の複素数として保持する（base-spec §10、設計書 D8）。
/// 実数型と複素数型を分けないことで、演算ごとの型分岐が生じない。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Value {
    pub re: f64,
    pub im: f64,
}

impl Value {
    pub const ZERO: Value = Value { re: 0.0, im: 0.0 };

    pub fn new(re: f64, im: f64) -> Value {
        Value { re, im }
    }

    pub fn real(re: f64) -> Value {
        Value { re, im: 0.0 }
    }

    pub fn imag(im: f64) -> Value {
        Value { re: 0.0, im }
    }

    /// 虚部が 0 のとき真。表示を実数として描画するかの判定に使う。
    pub fn is_real(&self) -> bool {
        self.im == 0.0
    }
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS（4 テスト）

Run: `cargo fmt --check && cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし、終了コード 0

- [ ] **Step 7: コミット**

```bash
git add Cargo.toml rust-toolchain.toml .gitignore LICENSE crates/
git commit -F - <<'EOF'
Add the Rust workspace and the Value type

Set up the cargo workspace, the Apache-2.0 licence, and the calcarc-core
crate with the single numeric type the whole core is built on.

Value keeps reals as complex numbers with a zero imaginary part rather
than introducing a separate real type, so no operation downstream needs
to branch on which kind of number it received.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: 複素数の四則演算

**Files:**
- Create: `crates/calcarc-core/src/complex/arith.rs`
- Modify: `crates/calcarc-core/src/complex/mod.rs`
- Test: `crates/calcarc-core/src/complex/arith.rs`（`#[cfg(test)]` モジュール）

**Interfaces:**
- Consumes: `Value`, `Value::new`, `Value::real`, `Value::ZERO`, `CalcError`, `CalcResult`（Task 1）
- Produces:
  - `calcarc_core::complex::arith::add(a: Value, b: Value) -> CalcResult<Value>`
  - `sub(a: Value, b: Value) -> CalcResult<Value>`
  - `mul(a: Value, b: Value) -> CalcResult<Value>`
  - `div(a: Value, b: Value) -> CalcResult<Value>`
  - `finite(v: Value) -> CalcResult<Value>`（非有限なら `Err(Overflow)`。他モジュールからも使う）

- [ ] **Step 1: 失敗するテストを書く**

`crates/calcarc-core/src/complex/arith.rs` の末尾に置く。

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_complex_numbers() {
        let r = add(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(4.0, 6.0));
    }

    #[test]
    fn subtracts_complex_numbers() {
        let r = sub(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(2.0, 2.0));
    }

    #[test]
    fn multiplies_complex_numbers() {
        // (3+j4)(1+j2) = 3 + j6 + j4 + j^2*8 = -5 + j10
        let r = mul(Value::new(3.0, 4.0), Value::new(1.0, 2.0)).unwrap();
        assert_eq!(r, Value::new(-5.0, 10.0));
    }

    #[test]
    fn divides_complex_numbers() {
        // (-5+j10) / (1+j2) = 3+j4
        let r = div(Value::new(-5.0, 10.0), Value::new(1.0, 2.0)).unwrap();
        crate::assert_close(r.re, 3.0);
        crate::assert_close(r.im, 4.0);
    }

    #[test]
    fn divides_reals() {
        let r = div(Value::real(7.0), Value::real(2.0)).unwrap();
        assert_eq!(r, Value::real(3.5));
    }

    #[test]
    fn division_by_zero_is_an_error() {
        assert_eq!(
            div(Value::real(1.0), Value::ZERO),
            Err(CalcError::DivisionByZero)
        );
        // 複素数のゼロでも同じ。
        assert_eq!(
            div(Value::new(1.0, 1.0), Value::new(0.0, 0.0)),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn overflow_is_an_error() {
        let big = Value::real(f64::MAX);
        assert_eq!(mul(big, Value::real(10.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn a_tiny_but_nonzero_divisor_is_not_treated_as_zero() {
        // b.re^2 は f64 の最小非正規数を下回って 0 に潰れるが、b はゼロではない。
        // 1e-200 / (1e-200 + j1e-200) = 1/(1+j) = 0.5 - j0.5
        let r = div(Value::real(1e-200), Value::new(1e-200, 1e-200)).unwrap();
        crate::assert_close(r.re, 0.5);
        crate::assert_close(r.im, -0.5);
    }

    #[test]
    fn a_huge_divisor_does_not_collapse_to_zero() {
        // 素朴な式では分母が inf になり、結果が 0 に潰れる。
        let r = div(Value::real(1.0), Value::real(1e200)).unwrap();
        assert!(r.re > 0.0, "expected a tiny positive value, got {}", r.re);
        // 相対誤差で見る。絶対誤差では 1e-200 と 0 の区別がつかない。
        crate::assert_close(r.re / 1e-200, 1.0);
        assert_eq!(r.im, 0.0);
    }

    #[test]
    fn finite_rejects_nan_and_infinity() {
        assert_eq!(finite(Value::real(f64::NAN)), Err(CalcError::Overflow));
        assert_eq!(finite(Value::new(1.0, f64::INFINITY)), Err(CalcError::Overflow));
        assert_eq!(finite(Value::real(1.0)), Ok(Value::real(1.0)));
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

`crates/calcarc-core/src/complex/mod.rs` に `pub mod arith;` を追記してから実行する。

Run: `cargo test -p calcarc-core`
Expected: FAIL。`cannot find function add in this scope` などのコンパイルエラー。

- [ ] **Step 3: 共通のテスト許容誤差を用意する**

`crates/calcarc-core/src/lib.rs` に追記する。誤差値をテストに散在させないための唯一の置き場になる（base-spec §36）。

```rust
/// ユニットテストの既定許容誤差。
///
/// 言語間検証（golden）の許容誤差はこれとは別で、
/// `testdata/*.json` の `tolerance` から読む。混同しないこと。
pub const TEST_EPSILON: f64 = 1e-12;

/// 浮動小数点の近似比較。個々のテストに誤差値を書かないためのヘルパー。
#[cfg(test)]
pub(crate) fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < TEST_EPSILON,
        "expected {expected}, got {actual}"
    );
}
```

- [ ] **Step 4: 四則演算を実装する**

`crates/calcarc-core/src/complex/arith.rs` の先頭に置く。

```rust
use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};

/// 非有限な結果を Overflow として弾く。
///
/// f64 の演算は溢れても panic せず inf / NaN を返すため、
/// 表示に到達する前にここで捕まえる（base-spec §25、§27）。
pub fn finite(v: Value) -> CalcResult<Value> {
    if v.re.is_finite() && v.im.is_finite() {
        Ok(v)
    } else {
        Err(CalcError::Overflow)
    }
}

pub fn add(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(a.re + b.re, a.im + b.im))
}

pub fn sub(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(a.re - b.re, a.im - b.im))
}

pub fn mul(a: Value, b: Value) -> CalcResult<Value> {
    finite(Value::new(
        a.re * b.re - a.im * b.im,
        a.re * b.im + a.im * b.re,
    ))
}

/// 複素数の除算。
///
/// 素朴な `(b.re² + b.im²)` を分母にすると、中間の二乗で溢れるか潰れる。
/// `b = (1e-200, 1e-200)` ではゼロでない除数の分母が 0 になって
/// DivisionByZero を返し、`b = (1e200, 0)` では分母が inf になって
/// 結果が 0 に潰れる。後者は最終値が有限なので `finite()` も捕まえられない。
/// base-spec §25 が禁じる「暗黙の overflow」がここで起きる。
///
/// そこで大きい方の成分で規格化してから割る（Smith 法）。
pub fn div(a: Value, b: Value) -> CalcResult<Value> {
    if b.re == 0.0 && b.im == 0.0 {
        return Err(CalcError::DivisionByZero);
    }
    if b.re.abs() >= b.im.abs() {
        let t = b.im / b.re;
        let d = b.re + b.im * t;
        finite(Value::new(
            (a.re + a.im * t) / d,
            (a.im - a.re * t) / d,
        ))
    } else {
        let t = b.re / b.im;
        let d = b.re * t + b.im;
        finite(Value::new(
            (a.re * t + a.im) / d,
            (a.im * t - a.re) / d,
        ))
    }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS（12 テスト）

Run: `cargo clippy -p calcarc-core --all-targets -- -D warnings`
Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add complex arithmetic to calcarc-core

Implement add, sub, mul, and div over Value, plus the finite() guard that
every operation routes its result through.

f64 arithmetic does not trap on overflow, it produces inf or NaN, so a
result that has left the finite range would otherwise reach the display
as a meaningless value. finite() turns that into CalcError::Overflow at
the point it happens.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Rect ⇄ Polar 変換

**Files:**
- Create: `crates/calcarc-core/src/complex/polar.rs`
- Modify: `crates/calcarc-core/src/complex/mod.rs`
- Modify: `crates/calcarc-core/Cargo.toml`（`proptest` を dev-dependency に追加）
- Test: `crates/calcarc-core/src/complex/polar.rs`（`#[cfg(test)]` モジュール）
- Test: `crates/calcarc-core/tests/roundtrip.rs`

**Interfaces:**
- Consumes: `Value`, `Value::new`, `CalcResult`（Task 1）
- Produces:
  - `calcarc_core::complex::polar::Polar { pub r: f64, pub theta_rad: f64 }`
  - `to_polar(v: Value) -> Polar`
  - `from_polar(p: Polar) -> Value`

- [ ] **Step 1: 失敗するテストを書く**

`crates/calcarc-core/src/complex/polar.rs` の末尾に置く。四象限と軸上を必ず含める（base-spec §33）。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_close as close;
    use std::f64::consts::PI;

    #[test]
    fn converts_the_headline_case() {
        // 3 + j4 -> 5 ∠ 53.13010235...°
        let p = to_polar(Value::new(3.0, 4.0));
        close(p.r, 5.0);
        close(p.theta_rad.to_degrees(), 53.13010235415598);
    }

    #[test]
    fn covers_all_four_quadrants() {
        close(to_polar(Value::new(1.0, 1.0)).theta_rad.to_degrees(), 45.0);
        close(to_polar(Value::new(-1.0, 1.0)).theta_rad.to_degrees(), 135.0);
        close(to_polar(Value::new(-1.0, -1.0)).theta_rad.to_degrees(), -135.0);
        close(to_polar(Value::new(1.0, -1.0)).theta_rad.to_degrees(), -45.0);
    }

    #[test]
    fn covers_the_axes() {
        close(to_polar(Value::new(1.0, 0.0)).theta_rad, 0.0);
        close(to_polar(Value::new(0.0, 1.0)).theta_rad, PI / 2.0);
        close(to_polar(Value::new(-1.0, 0.0)).theta_rad, PI);
        close(to_polar(Value::new(0.0, -1.0)).theta_rad, -PI / 2.0);
    }

    #[test]
    fn zero_has_zero_magnitude() {
        let p = to_polar(Value::ZERO);
        close(p.r, 0.0);
        // atan2(0, 0) は 0 を返す。NaN にならないことを固定しておく。
        close(p.theta_rad, 0.0);
    }

    #[test]
    fn magnitude_survives_inputs_that_would_overflow_naive_squaring() {
        // (re² + im²).sqrt() ならここで中間の二乗が inf になり r も inf になる。
        // hypot は溢れない。これが hypot を選んだ理由そのもの。
        let p = to_polar(Value::new(3e200, 4e200));
        assert!(p.r.is_finite(), "magnitude overflowed: {}", p.r);
        // 5e200 との比で見る。絶対誤差はこの桁では意味を持たない。
        close(p.r / 5e200, 1.0);
        close(p.theta_rad.to_degrees(), 53.13010235415598);
    }

    #[test]
    fn converts_back() {
        let v = from_polar(Polar { r: 5.0, theta_rad: 53.13010235415598_f64.to_radians() });
        close(v.re, 3.0);
        close(v.im, 4.0);
    }
}
```

`crates/calcarc-core/tests/roundtrip.rs`:

```rust
use calcarc_core::complex::polar::{from_polar, to_polar};
use calcarc_core::{Value, ROUNDTRIP_EPSILON};
use proptest::prelude::*;

proptest! {
    /// rect -> polar -> rect の往復で元の値に戻ることを確認する
    /// （base-spec §34）。
    #[test]
    fn rect_polar_roundtrip(re in -1e6f64..1e6, im in -1e6f64..1e6) {
        let v = Value::new(re, im);
        let back = from_polar(to_polar(v));
        let scale = v.re.abs().max(v.im.abs()).max(1.0);
        prop_assert!((back.re - v.re).abs() <= ROUNDTRIP_EPSILON * scale);
        prop_assert!((back.im - v.im).abs() <= ROUNDTRIP_EPSILON * scale);
    }

    /// 半径は常に非負。
    #[test]
    fn magnitude_is_non_negative(re in -1e6f64..1e6, im in -1e6f64..1e6) {
        prop_assert!(to_polar(Value::new(re, im)).r >= 0.0);
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

`crates/calcarc-core/src/complex/mod.rs` に `pub mod polar;` を追記し、`crates/calcarc-core/Cargo.toml` に以下を追記してから実行する。

```toml
[dev-dependencies]
proptest = "1"
```

Run: `cargo test -p calcarc-core`
Expected: FAIL。`cannot find function to_polar in this scope`。

- [ ] **Step 3: 変換を実装する**

`crates/calcarc-core/src/complex/polar.rs` の先頭に置く。

```rust
use crate::complex::value::Value;

/// 極形式。角度は常にラジアンで保持する。
///
/// 度への変換は表示層でのみ行う。内部表現の単位を 1 つに固定することで、
/// 角度モードの切り替えが保持している値に影響しない（設計書 D5）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Polar {
    pub r: f64,
    /// -PI 以上 PI 以下。atan2 の値域。
    pub theta_rad: f64,
}

/// 直交形式から極形式へ。
///
/// atan2 を使うので四象限が正しく区別される（base-spec §33）。
pub fn to_polar(v: Value) -> Polar {
    Polar {
        r: v.re.hypot(v.im),
        theta_rad: v.im.atan2(v.re),
    }
}

/// 極形式から直交形式へ。
pub fn from_polar(p: Polar) -> Value {
    Value::new(p.r * p.theta_rad.cos(), p.r * p.theta_rad.sin())
}
```

`hypot` を使うのは、`(re*re + im*im).sqrt()` が中間の二乗で溢れる入力（例: `re = 1e200`）でも正しく動くため。

`crates/calcarc-core/src/lib.rs` に往復誤差の定数を追記する。`tests/roundtrip.rs` は結合テストなので `#[cfg(test)]` の `assert_close` を使えず、公開定数を参照する。

```rust
/// rect → polar → rect の往復で許す相対誤差。
///
/// 三角関数と平方根を経由するぶん TEST_EPSILON より緩いが、
/// 実際の往復誤差は 1 ULP 程度（相対 2e-16）なので 4 桁の余裕がある。
/// これ以上緩めると、f32 相当（相対 1e-7）まで精度が落ちても
/// テストが通ってしまい、往復テストが精度を見張らなくなる。
pub const ROUNDTRIP_EPSILON: f64 = 1e-12;
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS。`roundtrip` の proptest 2 件を含む。

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add rectangular and polar conversion

to_polar uses hypot and atan2 rather than sqrt(re^2 + im^2), so inputs
near the top of the f64 range do not overflow in the intermediate square,
and all four quadrants come back distinct.

Polar stores its angle in radians only. Degrees appear at the display
layer, which keeps switching the angle mode from touching any value the
engine is holding.

Add a proptest covering the rect -> polar -> rect round trip.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: 角度モードと表示フォーマット

**Files:**
- Create: `crates/calcarc-core/src/numeric/mod.rs`
- Create: `crates/calcarc-core/src/numeric/angle.rs`
- Create: `crates/calcarc-core/src/numeric/format.rs`
- Modify: `crates/calcarc-core/src/lib.rs`
- Test: 各ファイルの `#[cfg(test)]` モジュール

**Interfaces:**
- Consumes: `Value`, `Value::is_real`（Task 1）、`to_polar`, `Polar`（Task 3）
- Produces:
  - `calcarc_core::numeric::angle::AngleMode`（`Deg` / `Rad`、`Serialize` + `Deserialize` + `Copy`）
  - `AngleMode::to_radians(self, v: f64) -> f64`
  - `AngleMode::from_radians(self, rad: f64) -> f64`
  - `AngleMode::toggled(self) -> AngleMode`
  - `calcarc_core::numeric::format::DISPLAY_DIGITS: usize`（値 10）
  - `format_real(x: f64) -> String`
  - `format_rect(v: Value) -> String`
  - `format_polar(v: Value, mode: AngleMode) -> String`

- [ ] **Step 1: AngleMode の失敗するテストを書く**

`crates/calcarc-core/src/numeric/angle.rs` の末尾に置く。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn deg_converts_to_radians() {
        crate::assert_close(AngleMode::Deg.to_radians(180.0), PI);
    }

    #[test]
    fn rad_passes_through() {
        assert_eq!(AngleMode::Rad.to_radians(1.5), 1.5);
        assert_eq!(AngleMode::Rad.from_radians(1.5), 1.5);
    }

    #[test]
    fn deg_converts_from_radians() {
        crate::assert_close(AngleMode::Deg.from_radians(PI), 180.0);
    }

    #[test]
    fn toggles_between_modes() {
        assert_eq!(AngleMode::Deg.toggled(), AngleMode::Rad);
        assert_eq!(AngleMode::Rad.toggled(), AngleMode::Deg);
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

`crates/calcarc-core/src/numeric/mod.rs` に `pub mod angle;` と `pub mod format;`、`crates/calcarc-core/src/lib.rs` に `pub mod numeric;` を追記する。`format.rs` は空ファイルで作っておく。

Run: `cargo test -p calcarc-core`
Expected: FAIL。`cannot find type AngleMode in this scope`。

- [ ] **Step 3: AngleMode を実装する**

`crates/calcarc-core/src/numeric/angle.rs` の先頭に置く。

```rust
use serde::{Deserialize, Serialize};

/// 三角関数の引数と極形式の角度表示に適用する単位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AngleMode {
    Deg,
    Rad,
}

impl AngleMode {
    /// このモードでの数値をラジアンに直す。
    pub fn to_radians(self, v: f64) -> f64 {
        match self {
            AngleMode::Deg => v.to_radians(),
            AngleMode::Rad => v,
        }
    }

    /// ラジアンをこのモードでの数値に直す。
    pub fn from_radians(self, rad: f64) -> f64 {
        match self {
            AngleMode::Deg => rad.to_degrees(),
            AngleMode::Rad => rad,
        }
    }

    pub fn toggled(self) -> AngleMode {
        match self {
            AngleMode::Deg => AngleMode::Rad,
            AngleMode::Rad => AngleMode::Deg,
        }
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core numeric::angle`
Expected: PASS（4 テスト）

- [ ] **Step 5: 表示フォーマットの失敗するテストを書く**

`crates/calcarc-core/src/numeric/format.rs` の末尾に置く。ここが表示仕様の唯一の定義箇所になる。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn shows_ten_significant_digits() {
        assert_eq!(format_real(53.13010235415598), "53.13010235");
        assert_eq!(format_real(PI), "3.141592654");
    }

    #[test]
    fn trims_trailing_zeros() {
        assert_eq!(format_real(5.0), "5");
        assert_eq!(format_real(0.5), "0.5");
        assert_eq!(format_real(-4.0), "-4");
    }

    #[test]
    fn formats_zero_without_a_sign() {
        assert_eq!(format_real(0.0), "0");
        assert_eq!(format_real(-0.0), "0");
    }

    #[test]
    fn switches_to_exponent_notation_at_the_thresholds() {
        assert_eq!(format_real(1e10), "1e10");
        assert_eq!(format_real(1e-9), "0.000000001");
        assert_eq!(format_real(1e-10), "1e-10");
        assert_eq!(format_real(-1.5e12), "-1.5e12");
    }

    #[test]
    fn keeps_ten_significant_digits_below_one() {
        // 小数は先頭の 0 を有効数字に数えない。1 未満でも 10 桁出す。
        assert_eq!(format_real(1.0 / 3.0), "0.3333333333");
        assert_eq!(format_real(0.0123456789012), "0.0123456789");
        assert_eq!(format_real(0.00123456789012), "0.00123456789");
    }

    #[test]
    fn rounding_that_carries_into_a_new_digit_switches_notation() {
        // 丸めると 1e10 に繰り上がる。表記の判断は丸めた後の値で行うので、
        // 11 桁の "10000000000" ではなく "1e10" になる。
        assert_eq!(format_real(9999999999.6), "1e10");
        assert_eq!(format_real(9999999999.4), "9999999999");
    }

    #[test]
    fn rounds_half_to_even_at_the_carry_boundary() {
        // 9999999999.5 は f64 でちょうど表現できる真のタイ。有効数字 10 桁目が
        // 奇数の 9 なので round-half-to-even は繰り上げを選び、指数表記に移る。
        assert_eq!(format_real(9999999999.5), "1e10");

        // 一方 0.99999999995 は 10 進の見た目こそタイだが、f64 にすると
        // 0.99999999994999999586 でタイより僅かに小さい。丸めの判定は
        // 書かれた 10 進表記ではなく f64 の実際の値で決まる。
        assert_eq!(format_real(0.99999999995), "0.9999999999");

        assert_eq!(format_real(0.99999999996), "1");
        assert_eq!(format_real(0.99999999994), "0.9999999999");
    }

    #[test]
    fn formats_rectangular_form() {
        assert_eq!(format_rect(Value::new(3.0, 4.0)), "3+j4");
        assert_eq!(format_rect(Value::new(3.0, -4.0)), "3-j4");
        assert_eq!(format_rect(Value::new(-5.0, 10.0)), "-5+j10");
        assert_eq!(format_rect(Value::real(5.0)), "5");
        assert_eq!(format_rect(Value::imag(2.0)), "j2");
        assert_eq!(format_rect(Value::imag(-2.0)), "-j2");
    }

    #[test]
    fn formats_polar_form() {
        // これが本スライスの目標表示。
        assert_eq!(
            format_polar(Value::new(3.0, 4.0), AngleMode::Deg),
            "5 ∠ 53.13010235"
        );
    }

    #[test]
    fn polar_form_follows_the_angle_mode() {
        assert_eq!(
            format_polar(Value::imag(1.0), AngleMode::Deg),
            "1 ∠ 90"
        );
        assert_eq!(
            format_polar(Value::imag(1.0), AngleMode::Rad),
            "1 ∠ 1.570796327"
        );
    }
}
```

- [ ] **Step 6: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core numeric::format`
Expected: FAIL。`cannot find function format_real in this scope`。

- [ ] **Step 7: 表示フォーマットを実装する**

`crates/calcarc-core/src/numeric/format.rs` の先頭に置く。

```rust
use crate::complex::polar::to_polar;
use crate::complex::value::Value;
use crate::numeric::angle::AngleMode;

/// 表示する有効数字の桁数。
pub const DISPLAY_DIGITS: usize = 10;

/// この 10 の冪以上で指数表記にする。`|x| >= 1e10` に対応する。
const EXP_HIGH_EXPONENT: i32 = 10;
/// この 10 の冪未満で指数表記にする。`|x| < 1e-9` に対応する。
const EXP_LOW_EXPONENT: i32 = -9;

/// 実数 1 つを表示文字列にする。
///
/// 丸めは Rust の書式化に従い round-half-to-even となる。
/// ここで丸めた結果を計算に戻さないことは engine 側で保証する（base-spec §26）。
///
/// 桁の数え方に log10 を使わない。`log10` は 10 の冪の近くで 1 桁ずれることがあり、
/// また丸めによる繰り上がり（`9999999999.6` → `1e10`）を先読みできない。
/// 代わりに Rust の指数表記書式に有効数字 10 桁で 1 度整形させ、そこから
/// 指数を読む。この指数は丸めた後の値のものなので、表記の選択も桁数の計算も
/// これ 1 つで決まる。
pub fn format_real(x: f64) -> String {
    if x == 0.0 {
        // -0.0 も "0" として表示する。
        return "0".to_string();
    }
    let scientific = format!("{:.*e}", DISPLAY_DIGITS - 1, x);
    let (mantissa, exponent_text) = match scientific.split_once('e') {
        Some(parts) => parts,
        // Rust の LowerExp は必ず 'e' を含むため、ここには来ない。
        None => return scientific,
    };
    let exponent: i32 = exponent_text.parse().unwrap_or(0);

    if !(EXP_LOW_EXPONENT..EXP_HIGH_EXPONENT).contains(&exponent) {
        return format!("{}e{}", trim_zeros(mantissa), exponent_text);
    }
    // 小数点以下の桁数 = 有効数字 10 桁 - 整数部の桁数。
    // 指数が -1 なら 0.ddd… なので 10 桁ぶん小数が要る。
    let decimals = (DISPLAY_DIGITS as i32 - 1 - exponent).max(0) as usize;
    trim_zeros(&format!("{:.*}", decimals, x))
}

fn trim_zeros(s: &str) -> String {
    if !s.contains('.') {
        return s.to_string();
    }
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// 直交形式で表示する。`3+j4` のように j を数の前に置く。
pub fn format_rect(v: Value) -> String {
    if v.is_real() {
        return format_real(v.re);
    }
    let im = format_real(v.im.abs());
    if v.re == 0.0 {
        let sign = if v.im < 0.0 { "-" } else { "" };
        return format!("{sign}j{im}");
    }
    let sign = if v.im < 0.0 { "-" } else { "+" };
    format!("{}{sign}j{im}", format_real(v.re))
}

/// 極形式で表示する。角度は与えられたモードの単位で描画する。
pub fn format_polar(v: Value, mode: AngleMode) -> String {
    let p = to_polar(v);
    format!(
        "{} ∠ {}",
        format_real(p.r),
        format_real(mode.from_radians(p.theta_rad))
    )
}
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 9: lib.rs の再エクスポートを整える**

`crates/calcarc-core/src/lib.rs`:

```rust
//! CalcArc の計算コア。WASM と UI に依存しない。

pub mod complex;
pub mod error;
pub mod numeric;

pub use complex::value::Value;
pub use error::{CalcError, CalcResult};
pub use numeric::angle::AngleMode;
```

Run: `cargo test -p calcarc-core`
Expected: PASS

- [ ] **Step 10: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add angle modes and display formatting

format_real is the single place the ten-significant-digit rule lives, so
the rounding policy is defined once and pinned by tests rather than
reimplemented at each call site.

Polar stores radians and format_polar converts on the way out, which is
what lets the angle mode be switched without disturbing any held value.

The headline case is covered directly: 3+j4 renders as "5 ∠ 53.13010235".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: 単項関数（sqrt / sqr / neg / sin / cos / tan）

**Files:**
- Create: `crates/calcarc-core/src/scientific/mod.rs`
- Modify: `crates/calcarc-core/src/lib.rs`
- Test: `crates/calcarc-core/src/scientific/mod.rs`（`#[cfg(test)]` モジュール）

**Interfaces:**
- Consumes: `Value`, `Value::new`, `Value::real`, `Value::imag`, `Value::is_real`, `CalcError`, `CalcResult`（Task 1）、`finite`, `div`（Task 2）、`to_polar`（Task 3）、`AngleMode`（Task 4）
- Produces:
  - `calcarc_core::scientific::sqrt(v: Value) -> CalcResult<Value>`
  - `sqr(v: Value) -> CalcResult<Value>`
  - `neg(v: Value) -> Value`
  - `sin(v: Value, mode: AngleMode) -> CalcResult<Value>`
  - `cos(v: Value, mode: AngleMode) -> CalcResult<Value>`
  - `tan(v: Value, mode: AngleMode) -> CalcResult<Value>`

- [ ] **Step 1: 失敗するテストを書く**

`crates/calcarc-core/src/scientific/mod.rs` の末尾に置く。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_close as close;
    use std::f64::consts::PI;

    #[test]
    fn square_root_of_a_positive_real() {
        assert_eq!(sqrt(Value::real(4.0)).unwrap(), Value::real(2.0));
    }

    #[test]
    fn square_root_of_a_negative_real_is_exactly_imaginary() {
        // 極形式を経由すると実部に 1.2e-16 が残る。実数の負値は
        // 専用の経路で扱い、ちょうど j2 を返す。
        assert_eq!(sqrt(Value::real(-4.0)).unwrap(), Value::imag(2.0));
    }

    #[test]
    fn square_root_of_a_complex_number() {
        // sqrt(3+j4) = 2+j1
        let r = sqrt(Value::new(3.0, 4.0)).unwrap();
        close(r.re, 2.0);
        close(r.im, 1.0);
    }

    #[test]
    fn squares_a_complex_number() {
        // (3+j4)^2 = -7+j24
        assert_eq!(sqr(Value::new(3.0, 4.0)).unwrap(), Value::new(-7.0, 24.0));
    }

    #[test]
    fn negates() {
        assert_eq!(neg(Value::new(3.0, -4.0)), Value::new(-3.0, 4.0));
    }

    #[test]
    fn sine_in_degrees() {
        close(sin(Value::real(30.0), AngleMode::Deg).unwrap().re, 0.5);
    }

    #[test]
    fn sine_in_radians() {
        close(sin(Value::real(PI / 6.0), AngleMode::Rad).unwrap().re, 0.5);
    }

    #[test]
    fn cosine_in_degrees() {
        close(cos(Value::real(60.0), AngleMode::Deg).unwrap().re, 0.5);
    }

    #[test]
    fn tangent_in_degrees() {
        close(tan(Value::real(45.0), AngleMode::Deg).unwrap().re, 1.0);
    }

    #[test]
    fn tangent_at_a_pole_is_an_error() {
        // f64 の tan(PI/2) は無限大ではなく 1.6e16 を返すため、
        // Deg モードでは極を明示的に検出する（設計書 §4.6）。
        assert_eq!(
            tan(Value::real(90.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        assert_eq!(
            tan(Value::real(270.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        assert_eq!(
            tan(Value::real(-90.0), AngleMode::Deg),
            Err(CalcError::TrigPole)
        );
        // 極でない値は通る。
        assert!(tan(Value::real(89.0), AngleMode::Deg).is_ok());
    }

    #[test]
    fn trig_accepts_complex_arguments() {
        // sin(z) = sin(a)cosh(b) + j cos(a)sinh(b)
        let r = sin(Value::new(0.0, 1.0), AngleMode::Rad).unwrap();
        close(r.re, 0.0);
        close(r.im, 1.0_f64.sinh());
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

`crates/calcarc-core/src/lib.rs` に `pub mod scientific;` を追記してから実行する。

Run: `cargo test -p calcarc-core`
Expected: FAIL。`cannot find function sqrt in this scope`。

- [ ] **Step 3: 単項関数を実装する**

`crates/calcarc-core/src/scientific/mod.rs` の先頭に置く。

```rust
use crate::complex::arith::{div, finite, mul};
use crate::complex::polar::to_polar;
use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;

/// 平方根の主値。
///
/// 実数は専用の経路で扱う。負の実数を極形式経由で計算すると
/// 実部に 1.2e-16 程度の残差が出て `1.224646799e-16+j2` と表示されるため、
/// 実数のときは虚軸上の値をそのまま構成する。
pub fn sqrt(v: Value) -> CalcResult<Value> {
    if v.is_real() {
        return if v.re >= 0.0 {
            finite(Value::real(v.re.sqrt()))
        } else {
            finite(Value::imag((-v.re).sqrt()))
        };
    }
    let p = to_polar(v);
    let r = p.r.sqrt();
    let half = p.theta_rad / 2.0;
    finite(Value::new(r * half.cos(), r * half.sin()))
}

pub fn sqr(v: Value) -> CalcResult<Value> {
    mul(v, v)
}

pub fn neg(v: Value) -> Value {
    Value::new(-v.re, -v.im)
}

/// 角度モードに従って引数をラジアンに直す。
///
/// 複素数の引数でも実部・虚部の両方を同じ係数で変換する。
/// これは z を単位付きの量とみなす解釈で、実数のときに
/// 通常の度数法と一致する。
fn to_rad(v: Value, mode: AngleMode) -> Value {
    Value::new(mode.to_radians(v.re), mode.to_radians(v.im))
}

pub fn sin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    finite(Value::new(
        z.re.sin() * z.im.cosh(),
        z.re.cos() * z.im.sinh(),
    ))
}

pub fn cos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let z = to_rad(v, mode);
    finite(Value::new(
        z.re.cos() * z.im.cosh(),
        -z.re.sin() * z.im.sinh(),
    ))
}

/// tan は sin / cos として求める。
///
/// Deg モードの実数引数については、極（90 + 180n 度）を先に検出する。
/// f64 の tan(PI/2) は無限大ではなく 1.633e16 という有限値を返すため、
/// Overflow の検査では捕まらない。
pub fn tan(v: Value, mode: AngleMode) -> CalcResult<Value> {
    if is_tan_pole(v, mode) {
        return Err(CalcError::TrigPole);
    }
    div(sin(v, mode)?, cos(v, mode)?)
}

fn is_tan_pole(v: Value, mode: AngleMode) -> bool {
    if !v.is_real() || mode != AngleMode::Deg {
        return false;
    }
    let a = v.re.abs();
    a >= 90.0 && (a - 90.0) % 180.0 == 0.0
}
```

**既知の制約（このスライスでは対応しない）:**
- Rad モードでは `PI / 2` が f64 で厳密に表現できないため、`tan` の極を検出できない。`1.633123935e16` が表示される。
- `sin(180°)` は `1.224646799e-16` を返し、0 に丸められない。CASIO は 0 を表示する。この「極近傍のゼロ吸着」は Milestone 3 後半で扱う。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 5: 既知の制約をドキュメントに残す**

`docs/numerical-policy.md` を新規作成する。

```markdown
# Numerical Policy

CalcArc が数値をどう扱うかの規則。実装より先にここを読むこと。

## 内部表現

すべての値を複素数 `Value { re: f64, im: f64 }` として保持する。実数は虚部 0
の複素数である。実数型と複素数型を分けないため、演算に型分岐が生じない。

角度は内部では常にラジアンで保持する。度への変換は表示層でのみ行う。

## 表示

- 有効数字 10 桁。
- 丸めは round-half-to-even（Rust の書式化に一致）。
- `|x| >= 1e10` または `0 < |x| < 1e-9` で指数表記。
- 直交形式は `3+j4`、極形式は `5 ∠ 53.13010235`。

表示のための丸めは表示文字列を作るときにのみ行い、保持している値には
書き戻さない。`▸∠` は表示形式を切り替えるだけで再計算しない。したがって
表示上の丸め値が次の計算の入力になることはない。

## エラー

| エラー | 条件 |
|---|---|
| `DivisionByZero` | 除数が 0 |
| `Overflow` | 結果が f64 の有限範囲外（inf / NaN） |
| `TrigPole` | Deg モードの `tan(90 + 180n)` |
| `SyntaxError` | 対応しない `)`、`.` の重複 |

計算コアは panic しない。すべてのエラーは `Result` を通る。

## 既知の制約

- Rad モードの `tan` は極を検出できない。`PI / 2` が f64 で厳密に表現できず、
  `tan` が有限の巨大値を返すため。Deg モードでのみ検出する。
- `sin(180°)` は `1.224646799e-16` を返す。極近傍のゼロ吸着は
  Milestone 3 後半で扱う。
- `sqrt` の負の実数は専用経路で扱い、`sqrt(-4) = j2` をちょうど返す。
  一般の複素数は極形式を経由する。

## 許容誤差

Rust と Python の突き合わせに使う許容誤差は `testdata/*.json` の
`tolerance` に置く。テストコードに誤差値を書かない。
```

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/ docs/numerical-policy.md
git commit -F - <<'EOF'
Add the unary scientific functions

sqrt, sqr, neg, sin, cos, and tan, all defined over complex arguments so
they compose with the rest of the core without special-casing reals.

Two places need care and both are covered by tests. sqrt of a negative
real takes a direct path instead of going through polar form, which
would leave a 1.2e-16 residue in the real part and display sqrt(-4) as
"1.224646799e-16+j2" instead of "j2". tan checks for its poles before
evaluating, because f64 tan(PI/2) returns 1.633e16 rather than infinity
and so slips past the overflow guard.

Record the rounding rules, the error conditions, and the known limits in
docs/numerical-policy.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# フェーズ 2 — 電卓の状態機械

このフェーズの各タスクは `crates/calcarc-core/tests/engine_table.rs` にテストケースを積み増していく。このファイルが「キー列 → 表示文字列」という形で電卓の挙動仕様そのものになる（設計書 §8）。

## Task 6: Key・EngineState・数値入力・DisplayState

**Files:**
- Create: `crates/calcarc-core/src/engine/mod.rs`
- Create: `crates/calcarc-core/src/engine/key.rs`
- Create: `crates/calcarc-core/src/engine/state.rs`
- Create: `crates/calcarc-core/src/engine/display.rs`
- Create: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `crates/calcarc-core/src/lib.rs`

**Interfaces:**
- Consumes: `Value`, `CalcError`, `CalcResult`（Task 1）、`format_rect`, `format_polar`（Task 4）、`AngleMode`（Task 4）
- Produces:
  - `calcarc_core::engine::key::Key`（全 21 種のキー）
  - `Key::from_token(token: &str) -> Option<Key>`
  - `Key::token(self) -> &'static str`
  - `calcarc_core::engine::state::EngineState`（`initial()` / `STATE_SCHEMA: u32`）
  - `calcarc_core::engine::state::Buffer`（`value()` / `text()` / `push_digit()` / `push_dot()` / `pop()`）
  - `calcarc_core::engine::state::{DisplayForm, BinOp, OpToken}`
  - `calcarc_core::engine::display::DisplayState`
  - `calcarc_core::engine::display(state: &EngineState) -> DisplayState`
  - `calcarc_core::engine::reduce(state: &EngineState, key: Key) -> (EngineState, DisplayState)`

- [ ] **Step 1: キーの語彙を定義する**

`crates/calcarc-core/src/engine/key.rs`:

```rust
use serde::{Deserialize, Serialize};

/// 電卓が受け取るキー。
///
/// 画面上のボタンと物理キーボードの両方がこの型に写像される。
/// 境界（WASM / JS）では `token()` の文字列で表現する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Digit(u8),
    Dot,
    Pi,
    Add,
    Sub,
    Mul,
    Div,
    Eq,
    LParen,
    RParen,
    J,
    PolarToggle,
    Sqrt,
    Sqr,
    Sin,
    Cos,
    Tan,
    Neg,
    Ac,
    Del,
    AngleToggle,
}

impl Key {
    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Key> {
        Some(match token {
            "0" => Key::Digit(0),
            "1" => Key::Digit(1),
            "2" => Key::Digit(2),
            "3" => Key::Digit(3),
            "4" => Key::Digit(4),
            "5" => Key::Digit(5),
            "6" => Key::Digit(6),
            "7" => Key::Digit(7),
            "8" => Key::Digit(8),
            "9" => Key::Digit(9),
            "dot" => Key::Dot,
            "pi" => Key::Pi,
            "add" => Key::Add,
            "sub" => Key::Sub,
            "mul" => Key::Mul,
            "div" => Key::Div,
            "eq" => Key::Eq,
            "lparen" => Key::LParen,
            "rparen" => Key::RParen,
            "j" => Key::J,
            "polar_toggle" => Key::PolarToggle,
            "sqrt" => Key::Sqrt,
            "sqr" => Key::Sqr,
            "sin" => Key::Sin,
            "cos" => Key::Cos,
            "tan" => Key::Tan,
            "neg" => Key::Neg,
            "ac" => Key::Ac,
            "del" => Key::Del,
            "angle_toggle" => Key::AngleToggle,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            Key::Digit(0) => "0",
            Key::Digit(1) => "1",
            Key::Digit(2) => "2",
            Key::Digit(3) => "3",
            Key::Digit(4) => "4",
            Key::Digit(5) => "5",
            Key::Digit(6) => "6",
            Key::Digit(7) => "7",
            Key::Digit(8) => "8",
            Key::Digit(9) => "9",
            Key::Digit(_) => "0",
            Key::Dot => "dot",
            Key::Pi => "pi",
            Key::Add => "add",
            Key::Sub => "sub",
            Key::Mul => "mul",
            Key::Div => "div",
            Key::Eq => "eq",
            Key::LParen => "lparen",
            Key::RParen => "rparen",
            Key::J => "j",
            Key::PolarToggle => "polar_toggle",
            Key::Sqrt => "sqrt",
            Key::Sqr => "sqr",
            Key::Sin => "sin",
            Key::Cos => "cos",
            Key::Tan => "tan",
            Key::Neg => "neg",
            Key::Ac => "ac",
            Key::Del => "del",
            Key::AngleToggle => "angle_toggle",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_round_trip() {
        let all = [
            Key::Digit(0), Key::Digit(7), Key::Digit(9), Key::Dot, Key::Pi,
            Key::Add, Key::Sub, Key::Mul, Key::Div, Key::Eq,
            Key::LParen, Key::RParen, Key::J, Key::PolarToggle,
            Key::Sqrt, Key::Sqr, Key::Sin, Key::Cos, Key::Tan, Key::Neg,
            Key::Ac, Key::Del, Key::AngleToggle,
        ];
        for key in all {
            assert_eq!(Key::from_token(key.token()), Some(key), "{:?}", key);
        }
    }

    #[test]
    fn unknown_tokens_are_rejected() {
        assert_eq!(Key::from_token("nope"), None);
        assert_eq!(Key::from_token(""), None);
    }
}
```

- [ ] **Step 2: 状態を定義する**

`crates/calcarc-core/src/engine/state.rs`:

```rust
use serde::{Deserialize, Serialize};

use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;

/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 本スライスでは保存しないが、後から足すと既存データが扱えなくなるため
/// 最初から持たせておく（設計書 §4.4）。
pub const STATE_SCHEMA: u32 = 1;

/// 入力欄に打ち込める最大文字数。
const MAX_ENTRY_LEN: usize = 12;

/// 表示形式。`▸∠` で切り替わる。値そのものには影響しない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayForm {
    Rect,
    Polar,
}

impl DisplayForm {
    pub fn toggled(self) -> DisplayForm {
        match self {
            DisplayForm::Rect => DisplayForm::Polar,
            DisplayForm::Polar => DisplayForm::Rect,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
}

impl BinOp {
    /// 大きいほど先に評価される（設計書 D9）。
    pub fn precedence(self) -> u8 {
        match self {
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul | BinOp::Div => 2,
        }
    }
}

/// 演算子スタックに積まれるもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpToken {
    Op(BinOp),
    OpenParen,
}

/// 入力中の数値。確定するまで Value にならない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Buffer {
    /// 打鍵された文字列。`"3"`, `"3.1"`, `""`（j の直後）。
    pub digits: String,
    /// `j` が押されて虚部として入力中か。
    pub imaginary: bool,
}

impl Buffer {
    pub fn imaginary() -> Buffer {
        Buffer { digits: String::new(), imaginary: true }
    }

    /// 確定値。`j` だけで数字がなければ j1 と解釈する（設計書 §4.3）。
    pub fn value(&self) -> Value {
        let n = if self.digits.is_empty() {
            1.0
        } else {
            self.digits.parse::<f64>().unwrap_or(0.0)
        };
        if self.imaginary {
            Value::imag(n)
        } else {
            Value::real(n)
        }
    }

    /// 入力中に表示する文字列。打鍵した通りに見せる。
    pub fn text(&self) -> String {
        if self.imaginary {
            format!("j{}", self.digits)
        } else if self.digits.is_empty() {
            "0".to_string()
        } else {
            self.digits.clone()
        }
    }

    pub fn push_digit(&mut self, d: u8) {
        if self.digits.len() >= MAX_ENTRY_LEN {
            return;
        }
        // 先頭の 0 は次の数字で置き換える。"0" -> "5" であって "05" ではない。
        if self.digits == "0" {
            self.digits.clear();
        }
        self.digits.push((b'0' + d) as char);
    }

    pub fn push_dot(&mut self) -> CalcResult<()> {
        if self.digits.contains('.') {
            return Err(CalcError::SyntaxError);
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return Ok(());
        }
        if self.digits.is_empty() {
            self.digits.push('0');
        }
        self.digits.push('.');
        Ok(())
    }

    /// 末尾 1 文字を削る。空になったら true を返し、呼び出し側が
    /// Buffer 自体を破棄する。
    pub fn pop(&mut self) -> bool {
        self.digits.pop();
        self.digits.is_empty()
    }
}

/// 電卓の全状態。Rust はこれを保持せず、呼び出しごとに受け渡す（設計書 D7）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineState {
    pub schema: u32,
    /// 入力中の数値。None なら `current` が表示される。
    pub buffer: Option<Buffer>,
    /// 確定している現在値。
    pub current: Value,
    /// 保留中の被演算数。
    pub operands: Vec<Value>,
    /// 保留中の演算子と開き括弧。
    pub operators: Vec<OpToken>,
    pub angle: AngleMode,
    pub form: DisplayForm,
    /// Some のあいだは AC 以外のキーを受け付けない。
    pub error: Option<CalcError>,
}

impl EngineState {
    pub fn initial() -> EngineState {
        EngineState {
            schema: STATE_SCHEMA,
            buffer: None,
            current: Value::ZERO,
            operands: Vec::new(),
            operators: Vec::new(),
            angle: AngleMode::Deg,
            form: DisplayForm::Rect,
            error: None,
        }
    }

    /// 角度モードと表示形式は利用者の設定なので AC で戻さない。
    pub fn cleared(&self) -> EngineState {
        EngineState {
            angle: self.angle,
            form: self.form,
            ..EngineState::initial()
        }
    }

    pub fn is_valid(&self) -> bool {
        self.schema == STATE_SCHEMA
    }
}
```

- [ ] **Step 3: 表示の導出を定義する**

`crates/calcarc-core/src/engine/display.rs`:

```rust
use serde::{Deserialize, Serialize};

use crate::error::CalcError;
use crate::numeric::angle::AngleMode;
use crate::numeric::format::{format_polar, format_rect};

use super::state::{BinOp, DisplayForm, EngineState, OpToken};

/// エラー時にメイン表示に出す文字列。
pub const ERROR_TEXT: &str = "Math ERROR";

/// 状態から導出される表示内容。状態の一部ではない。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayState {
    pub main: String,
    pub angle: AngleMode,
    pub form: DisplayForm,
    pub pending_op: Option<BinOp>,
    pub pending_depth: usize,
    pub error: Option<CalcError>,
}

/// 表示は状態の純粋な関数である。
///
/// 丸めはここでしか起きない。`EngineState` に書き戻さないため、
/// 表示された値が次の計算の入力になることはない（base-spec §26）。
pub fn display(state: &EngineState) -> DisplayState {
    let main = if state.error.is_some() {
        ERROR_TEXT.to_string()
    } else if let Some(buffer) = &state.buffer {
        buffer.text()
    } else {
        match state.form {
            DisplayForm::Rect => format_rect(state.current),
            DisplayForm::Polar => format_polar(state.current, state.angle),
        }
    };

    DisplayState {
        main,
        angle: state.angle,
        form: state.form,
        pending_op: state.operators.iter().rev().find_map(|t| match t {
            OpToken::Op(op) => Some(*op),
            OpToken::OpenParen => None,
        }),
        pending_depth: state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::OpenParen))
            .count(),
        error: state.error,
    }
}
```

- [ ] **Step 4: 失敗するテーブルテストを書く**

`crates/calcarc-core/tests/engine_table.rs`:

```rust
//! 電卓の挙動仕様。キー列を打鍵したときのメイン表示を固定する。
//!
//! このファイルの各行が仕様そのものである。挙動を変えるときは
//! まずここを変えること。

use calcarc_core::engine::display::{display, DisplayState};
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::EngineState;

/// キー列を打鍵した結果の表示を返す。
fn run(keys: &[&str]) -> DisplayState {
    let mut state = EngineState::initial();
    for token in keys {
        let key = Key::from_token(token).unwrap_or_else(|| panic!("unknown key: {token}"));
        state = reduce(&state, key).0;
    }
    display(&state)
}

fn main_of(keys: &[&str]) -> String {
    run(keys).main
}

#[test]
fn starts_at_zero() {
    assert_eq!(main_of(&[]), "0");
}

#[test]
fn accumulates_digits() {
    assert_eq!(main_of(&["3"]), "3");
    assert_eq!(main_of(&["1", "2", "3"]), "123");
}

#[test]
fn replaces_a_leading_zero() {
    assert_eq!(main_of(&["0", "5"]), "5");
    assert_eq!(main_of(&["0"]), "0");
}

#[test]
fn accepts_a_decimal_point() {
    assert_eq!(main_of(&["3", "dot", "1"]), "3.1");
    assert_eq!(main_of(&["dot", "5"]), "0.5");
}

#[test]
fn a_second_decimal_point_is_a_syntax_error() {
    assert_eq!(main_of(&["3", "dot", "dot"]), "Math ERROR");
}

#[test]
fn j_starts_an_imaginary_entry() {
    assert_eq!(main_of(&["j", "4"]), "j4");
    assert_eq!(main_of(&["j"]), "j");
}

#[test]
fn del_removes_the_last_character() {
    assert_eq!(main_of(&["3", "1", "del"]), "3");
    assert_eq!(main_of(&["3", "del"]), "0");
}

#[test]
fn ac_clears_everything() {
    assert_eq!(main_of(&["3", "1", "ac"]), "0");
}

#[test]
fn ac_recovers_from_an_error() {
    assert_eq!(main_of(&["3", "dot", "dot", "ac"]), "0");
}

#[test]
fn keys_other_than_ac_are_ignored_while_in_error() {
    assert_eq!(main_of(&["3", "dot", "dot", "5"]), "Math ERROR");
}
```

- [ ] **Step 5: テストが失敗することを確認する**

`crates/calcarc-core/src/lib.rs` に `pub mod engine;` を追記する。`crates/calcarc-core/src/engine/mod.rs` は空で作っておく。

Run: `cargo test -p calcarc-core --test engine_table`
Expected: FAIL。`cannot find function reduce in calcarc_core::engine`。

- [ ] **Step 6: reduce を実装する**

`crates/calcarc-core/src/engine/mod.rs`:

```rust
pub mod display;
pub mod key;
pub mod state;

// 関数 `display` は再エクスポートしない。モジュール名と衝突して
// 呼び出し側の import が曖昧になるため、`engine::display::display` で使う。
pub use display::DisplayState;

use crate::error::CalcResult;
use key::Key;
use state::{Buffer, EngineState};

/// 電卓の唯一の遷移関数。
///
/// 状態を持たず、渡された状態から新しい状態を作って返す。決して panic せず、
/// エラーは戻り値の状態に載る（設計書 D7、base-spec §27）。
pub fn reduce(state: &EngineState, key: Key) -> (EngineState, DisplayState) {
    let mut next = if state.is_valid() {
        state.clone()
    } else {
        // スキーマ不一致の状態を渡された場合は初期状態から始める。
        EngineState::initial()
    };

    if key == Key::Ac {
        next = next.cleared();
    } else if next.error.is_some() {
        // エラー中は AC 以外を受け付けない。
    } else if let Err(err) = apply(&mut next, key) {
        next.error = Some(err);
    }

    let shown = display::display(&next);
    (next, shown)
}

/// キー 1 つ分の遷移。Err を返した場合、呼び出し側がエラー状態にする。
fn apply(state: &mut EngineState, key: Key) -> CalcResult<()> {
    match key {
        Key::Digit(d) => {
            state.buffer.get_or_insert_with(Buffer::default).push_digit(d);
        }
        Key::Dot => {
            state.buffer.get_or_insert_with(Buffer::default).push_dot()?;
        }
        Key::J => {
            // j は常に新しい虚部入力を開始する。
            state.buffer = Some(Buffer::imaginary());
        }
        Key::Del => {
            if let Some(buffer) = &mut state.buffer
                && buffer.pop()
            {
                state.buffer = None;
            }
        }
        // 残りのキーは Task 7 以降で実装する。
        _ => {}
    }
    Ok(())
}
```

`if let ... && ...`（let chains）は Rust 2024 edition で使える。使えない場合は入れ子の `if` に書き換える。

- [ ] **Step 7: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 8: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add the key vocabulary, engine state, and number entry

reduce() is the calculator's only transition function. It holds no state
of its own: it takes a state, returns a new one, and never panics, so an
error becomes part of the returned value rather than something the caller
has to catch.

display() derives the shown text from the state as a pure function. All
rounding happens there and is never written back, which is what stops a
rounded display value from becoming the input to the next calculation.

Start tests/engine_table.rs, where each key sequence and its expected
display is the behavioural spec for the calculator.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: 二項演算と優先順位

**Files:**
- Modify: `crates/calcarc-core/src/engine/mod.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `EngineState`, `Buffer`, `BinOp`, `OpToken`（Task 6）、`add`, `sub`, `mul`, `div`（Task 2）
- Produces:
  - `apply_binop(op: BinOp, lhs: Value, rhs: Value) -> CalcResult<Value>`（`engine` 内部）
  - `Key::Add` / `Sub` / `Mul` / `Div` / `Eq` の遷移

- [ ] **Step 1: 失敗するテストを追記する**

`crates/calcarc-core/tests/engine_table.rs` の末尾に追記する。

```rust
#[test]
fn adds_two_numbers() {
    assert_eq!(main_of(&["3", "add", "4", "eq"]), "7");
}

#[test]
fn shows_the_left_operand_while_an_operator_is_pending() {
    assert_eq!(main_of(&["3", "add"]), "3");
}

#[test]
fn respects_operator_precedence() {
    // CASIO の代数方式。左から順の 20 ではない（設計書 D9）。
    assert_eq!(main_of(&["2", "add", "3", "mul", "4", "eq"]), "14");
}

#[test]
fn reduces_same_precedence_left_to_right() {
    // 2 つ目の + を押した時点で 2+3 が確定して 5 が表示される。
    assert_eq!(main_of(&["2", "add", "3", "add"]), "5");
    assert_eq!(main_of(&["2", "add", "3", "add", "4", "eq"]), "9");
}

#[test]
fn subtracts_and_divides() {
    assert_eq!(main_of(&["1", "0", "sub", "4", "eq"]), "6");
    assert_eq!(main_of(&["7", "div", "2", "eq"]), "3.5");
}

#[test]
fn builds_a_complex_number() {
    // 本スライスの目標入力。
    assert_eq!(main_of(&["3", "add", "j", "4", "eq"]), "3+j4");
}

#[test]
fn multiplies_a_complex_number_by_a_real() {
    // = で 3+j4 が確定したあと、その値がそのまま次の演算に入る。
    assert_eq!(main_of(&["3", "add", "j", "4", "eq", "mul", "2", "eq"]), "6+j8");
}

#[test]
fn an_operator_folds_the_pending_product_before_the_next_term_is_typed() {
    // 3+j4 = × 1 + j2 = は (3+j4)×(1+j2) にならない。
    // + を押した時点で優先順位の高い × が畳まれ、(3+j4)×1 が確定してから
    // j2 が足されるので 3+j6 になる。CASIO の代数方式として正しい挙動で、
    // 2 つの複素数の積を書くには括弧が要る（Task 8 で扱う）。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "mul", "1", "add", "j", "2", "eq"]),
        "3+j6"
    );
}

#[test]
fn j_alone_means_one_times_j() {
    // j の直後に数字がなければ j1 と解釈する。format_rect は虚部の
    // 絶対値をそのまま整形するので "3+j1" になる（"3+j" ではない）。
    assert_eq!(main_of(&["3", "add", "j", "eq"]), "3+j1");
}

#[test]
fn division_by_zero_is_an_error() {
    assert_eq!(main_of(&["1", "div", "0", "eq"]), "Math ERROR");
}

#[test]
fn equals_without_an_operator_keeps_the_entry() {
    assert_eq!(main_of(&["3", "eq"]), "3");
}

#[test]
fn reports_the_pending_operator() {
    use calcarc_core::engine::state::BinOp;
    assert_eq!(run(&["3", "add"]).pending_op, Some(BinOp::Add));
    assert_eq!(run(&["3", "add", "4", "eq"]).pending_op, None);
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core --test engine_table`
Expected: FAIL。`adds_two_numbers` で `assertion failed: left: "4", right: "7"`（`add` と `eq` がまだ何もしないため、最後に入力した 4 が残る）。

- [ ] **Step 3: 二項演算を実装する**

`crates/calcarc-core/src/engine/mod.rs` に追記する。`use` を足す。

```rust
use crate::complex::arith::{add, div, mul, sub};
use crate::complex::value::Value;
use crate::error::CalcError;
use state::{BinOp, OpToken};
```

関数を追加する。

```rust
fn apply_binop(op: BinOp, lhs: Value, rhs: Value) -> CalcResult<Value> {
    match op {
        BinOp::Add => add(lhs, rhs),
        BinOp::Sub => sub(lhs, rhs),
        BinOp::Mul => mul(lhs, rhs),
        BinOp::Div => div(lhs, rhs),
    }
}

/// 入力中のバッファを確定して `current` に移す。
fn commit_entry(state: &mut EngineState) {
    if let Some(buffer) = state.buffer.take() {
        state.current = buffer.value();
    }
}

/// 演算子スタックの先頭 1 つを適用する。
fn reduce_top(state: &mut EngineState) -> CalcResult<()> {
    let op = match state.operators.pop() {
        Some(OpToken::Op(op)) => op,
        _ => return Err(CalcError::SyntaxError),
    };
    let rhs = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    let lhs = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    state.operands.push(apply_binop(op, lhs, rhs)?);
    Ok(())
}

/// 二項演算子が押されたときの遷移。
///
/// 同じか高い優先順位の演算子が保留されていれば先に畳む。これにより
/// `2 + 3 +` の時点で 5 が表示され、`2 + 3 ×` では畳まれない。
fn push_binop(state: &mut EngineState, op: BinOp) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    // `state.operators.last()` の借用を while の条件式で終わらせてから
    // `reduce_top(&mut state)` を呼ぶ。matches! の中に閉じ込めるのがその手段。
    while matches!(
        state.operators.last(),
        Some(OpToken::Op(top)) if top.precedence() >= op.precedence()
    ) {
        reduce_top(state)?;
    }
    state.operators.push(OpToken::Op(op));
    state.current = *state.operands.last().ok_or(CalcError::SyntaxError)?;
    Ok(())
}

/// `=` が押されたときの遷移。保留中のものをすべて畳む。
fn finish(state: &mut EngineState) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    // OpToken は Copy なので copied() で借用を切ってから分岐する。
    while let Some(top) = state.operators.last().copied() {
        match top {
            OpToken::Op(_) => reduce_top(state)?,
            // 閉じ忘れた括弧は自動的に閉じる。
            OpToken::OpenParen => {
                state.operators.pop();
            }
        }
    }
    state.current = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    state.operands.clear();
    Ok(())
}
```

`apply` の `match` に分岐を追加する。`_ => {}` の前に置く。

```rust
        Key::Add => push_binop(state, BinOp::Add)?,
        Key::Sub => push_binop(state, BinOp::Sub)?,
        Key::Mul => push_binop(state, BinOp::Mul)?,
        Key::Div => push_binop(state, BinOp::Div)?,
        Key::Eq => finish(state)?,
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

エラーが発生した状態では `operands` に途中の値が残るが、`AC` が `cleared()` で全体を捨てるため次の計算に影響しない。

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add binary operators with algebraic precedence

Pressing an operator folds any pending operator of equal or higher
precedence before pushing its own, so 2 + 3 + shows 5 the way a CASIO
does, while 2 + 3 × leaves the addition pending and 2 + 3 × 4 = gives 14
rather than 20.

The same path carries complex values with no special casing, so a
complex value settled by = flows into the next operation unchanged and
3 + j4 = × 2 = gives 6+j8.

That folding is also why 3 + j4 = × 1 + j2 = gives 3+j6 rather than the
product of the two complex numbers: the × is folded when + is pressed.
Writing that product needs parentheses, which the next task adds.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: 括弧

**Files:**
- Modify: `crates/calcarc-core/src/engine/mod.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `push_binop`, `reduce_top`, `commit_entry`, `finish`（Task 7）、`OpToken::OpenParen`（Task 6）
- Produces: `Key::LParen` / `Key::RParen` の遷移

- [ ] **Step 1: 失敗するテストを追記する**

`crates/calcarc-core/tests/engine_table.rs` の末尾に追記する。

```rust
#[test]
fn parentheses_override_precedence() {
    assert_eq!(
        main_of(&["2", "mul", "lparen", "3", "add", "4", "rparen", "eq"]),
        "14"
    );
    assert_eq!(
        main_of(&["lparen", "2", "add", "3", "rparen", "mul", "4", "eq"]),
        "20"
    );
}

#[test]
fn nested_parentheses() {
    assert_eq!(
        main_of(&[
            "2", "mul", "lparen", "1", "add", "lparen", "3", "mul", "4",
            "rparen", "rparen", "eq"
        ]),
        "26"
    );
}

#[test]
fn equals_closes_unclosed_parentheses() {
    assert_eq!(main_of(&["2", "mul", "lparen", "3", "add", "4", "eq"]), "14");
}

#[test]
fn an_unmatched_closing_paren_is_a_syntax_error() {
    assert_eq!(main_of(&["rparen"]), "Math ERROR");
    assert_eq!(main_of(&["3", "add", "4", "rparen"]), "Math ERROR");
}

#[test]
fn reports_the_parenthesis_depth() {
    assert_eq!(run(&["lparen", "lparen"]).pending_depth, 2);
    assert_eq!(run(&["lparen", "1", "rparen"]).pending_depth, 0);
}

#[test]
fn the_pending_operator_shown_inside_parens_is_the_enclosing_one() {
    use calcarc_core::engine::state::BinOp;
    // `3 + (` の時点で、深さは 1 で、表示する保留演算子は外側の + とする。
    // display は開き括弧を読み飛ばして直近の演算子を探すので、括弧の中に
    // 入っても「何の計算の途中か」が見えたままになる。
    let shown = run(&["3", "add", "lparen"]);
    assert_eq!(shown.pending_depth, 1);
    assert_eq!(shown.pending_op, Some(BinOp::Add));
}

#[test]
fn parentheses_carry_complex_values() {
    assert_eq!(
        main_of(&[
            "lparen", "3", "add", "j", "4", "rparen", "mul",
            "lparen", "1", "add", "j", "2", "rparen", "eq"
        ]),
        "-5+j10"
    );
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core --test engine_table`
Expected: FAIL。`parentheses_override_precedence` で `left: "20", right: "14"`（括弧が無視され左から順に評価されるため）。

- [ ] **Step 3: 括弧を実装する**

`crates/calcarc-core/src/engine/mod.rs` に関数を追加する。

```rust
/// `(` が押されたときの遷移。
///
/// 新しい被演算数の文脈を開く。入力途中の数値があっても破棄する。
/// `3 (` のような打鍵は意味を持たないため、暗黙の乗算にはしない。
fn open_paren(state: &mut EngineState) {
    state.buffer = None;
    state.current = Value::ZERO;
    state.operators.push(OpToken::OpenParen);
}

/// `)` が押されたときの遷移。対応する `(` まで畳む。
fn close_paren(state: &mut EngineState) -> CalcResult<()> {
    commit_entry(state);
    state.operands.push(state.current);
    loop {
        // copied() で借用を切らないと、分岐の中で state を可変借用できない。
        match state.operators.last().copied() {
            Some(OpToken::Op(_)) => reduce_top(state)?,
            Some(OpToken::OpenParen) => {
                state.operators.pop();
                break;
            }
            None => return Err(CalcError::SyntaxError),
        }
    }
    state.current = state.operands.pop().ok_or(CalcError::SyntaxError)?;
    Ok(())
}
```

`apply` の `match` に分岐を追加する。

```rust
        Key::LParen => open_paren(state),
        Key::RParen => close_paren(state)?,
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add parentheses to the engine

An opening paren pushes a marker the operator folding stops at, so a
pending × outside the parens survives while the addition inside reduces
first. Equals folds through any markers left standing, which closes
unclosed parens the way a pocket calculator does.

A closing paren with no marker to match is a syntax error rather than a
silently ignored keystroke.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: 後置関数・π・角度モード切替

**Files:**
- Modify: `crates/calcarc-core/src/engine/mod.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `commit_entry`（Task 7）、`sqrt`, `sqr`, `neg`, `sin`, `cos`, `tan`（Task 5）、`AngleMode::toggled`（Task 4）
- Produces: `Key::Sqrt` / `Sqr` / `Sin` / `Cos` / `Tan` / `Neg` / `Pi` / `AngleToggle` の遷移

- [ ] **Step 1: 失敗するテストを追記する**

`crates/calcarc-core/tests/engine_table.rs` の末尾に追記する。

```rust
#[test]
fn functions_apply_immediately_to_the_displayed_value() {
    // 関数は後置。式には積まれない（設計書 D6）。
    assert_eq!(main_of(&["3", "0", "sin"]), "0.5");
    assert_eq!(main_of(&["6", "0", "cos"]), "0.5");
    assert_eq!(main_of(&["4", "5", "tan"]), "1");
    assert_eq!(main_of(&["4", "sqrt"]), "2");
    assert_eq!(main_of(&["3", "sqr"]), "9");
}

#[test]
fn square_root_of_a_negative_gives_an_imaginary_result() {
    // 従来機が Math ERROR を返す入力に、複素数対応の電卓は答えられる。
    assert_eq!(main_of(&["4", "neg", "sqrt"]), "j2");
}

#[test]
fn negation_applies_to_the_committed_value() {
    assert_eq!(main_of(&["4", "neg"]), "-4");
    assert_eq!(main_of(&["4", "neg", "neg"]), "4");
}

#[test]
fn functions_compose_with_operators() {
    assert_eq!(main_of(&["3", "add", "4", "sqrt", "eq"]), "5");
}

#[test]
fn pi_is_a_value_not_an_entry() {
    assert_eq!(main_of(&["pi"]), "3.141592654");
    assert_eq!(main_of(&["pi", "sqr"]), "9.869604401");
}

#[test]
fn the_angle_mode_toggles() {
    use calcarc_core::AngleMode;
    assert_eq!(run(&[]).angle, AngleMode::Deg);
    assert_eq!(run(&["angle_toggle"]).angle, AngleMode::Rad);
    assert_eq!(run(&["angle_toggle", "angle_toggle"]).angle, AngleMode::Deg);
}

#[test]
fn trig_follows_the_angle_mode() {
    assert_eq!(main_of(&["angle_toggle", "pi", "cos"]), "-1");
}

#[test]
fn tangent_at_a_pole_is_an_error() {
    assert_eq!(main_of(&["9", "0", "tan"]), "Math ERROR");
}
```

`main_of(&["pi", "sqr"])` の期待値 `9.869604401` は π² = 9.869604401089358 を有効数字 10 桁に丸めた値。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core --test engine_table`
Expected: FAIL。`functions_apply_immediately_to_the_displayed_value` で `left: "30", right: "0.5"`。

- [ ] **Step 3: 単項関数の遷移を実装する**

`crates/calcarc-core/src/engine/mod.rs` に追記する。`use` を足す。

```rust
use crate::scientific;
```

関数を追加する。

```rust
/// 後置関数の遷移。入力中の値を確定してから、その値に即座に適用する。
///
/// 式には積まれない。`30` `sin` は打鍵した瞬間に 0.5 になる（設計書 D6）。
fn apply_unary<F>(state: &mut EngineState, f: F) -> CalcResult<()>
where
    F: FnOnce(Value) -> CalcResult<Value>,
{
    commit_entry(state);
    state.current = f(state.current)?;
    Ok(())
}
```

`apply` の `match` に分岐を追加する。

```rust
        Key::Sqrt => apply_unary(state, scientific::sqrt)?,
        Key::Sqr => apply_unary(state, scientific::sqr)?,
        Key::Neg => apply_unary(state, |v| Ok(scientific::neg(v)))?,
        Key::Sin => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::sin(v, mode))?;
        }
        Key::Cos => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::cos(v, mode))?;
        }
        Key::Tan => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::tan(v, mode))?;
        }
        Key::Pi => {
            state.buffer = None;
            state.current = Value::real(std::f64::consts::PI);
        }
        Key::AngleToggle => {
            // 保持している値は変えない。表示と以後の三角関数にだけ効く。
            state.angle = state.angle.toggled();
        }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 5: `_ => {}` を外す**

`apply` の `match` から `_ => {}` を削除し、残る 2 つのキーを明示する。

```rust
        // Task 10 で実装する。
        Key::PolarToggle => {}
        // AC は reduce 側で処理済みなので、ここでは何もしない。
        // 網羅性のために腕だけ置く。
        Key::Ac => {}
```

これで `match` が網羅的になり、キーを追加したときにコンパイラが実装漏れを指摘するようになる。全 21 種の `Key` がいずれかの腕で扱われていることを確認すること。

Run: `cargo test -p calcarc-core`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add postfix functions, pi, and the angle mode toggle

Functions act on the displayed value the moment they are pressed rather
than being built into an expression, so 30 sin shows 0.5 immediately.

Toggling the angle mode leaves every held value untouched: it changes
how a polar angle is rendered and what unit the next trig call reads,
nothing more.

Drop the catch-all arm from the key match so the compiler now reports any
key left unimplemented.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: 極形式の表示切替

**Files:**
- Modify: `crates/calcarc-core/src/engine/mod.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `DisplayForm::toggled`（Task 6）
- Produces: `Key::PolarToggle` の遷移

- [ ] **Step 1: 失敗するテストを追記する**

`crates/calcarc-core/tests/engine_table.rs` の末尾に追記する。

```rust
#[test]
fn the_headline_case() {
    // このスライスが成立したことを示す 1 行。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "polar_toggle"]),
        "5 ∠ 53.13010235"
    );
}

#[test]
fn the_polar_toggle_is_idempotent_in_pairs() {
    // 2 回押すと元の表示に戻る。表示の切替であって計算ではないため。
    assert_eq!(
        main_of(&["3", "add", "j", "4", "eq", "polar_toggle", "polar_toggle"]),
        "3+j4"
    );
}

#[test]
fn the_polar_toggle_does_not_feed_rounded_values_forward() {
    // 極形式で表示すると角度は 53.13010235 に丸められるが、保持している
    // 値は 3+j4 のままなので、続く乗算は丸めの影響を受けない
    // （base-spec §26、設計書 D5）。
    assert_eq!(
        main_of(&[
            "3", "add", "j", "4", "eq", "polar_toggle",
            "mul", "lparen", "1", "add", "j", "2", "rparen", "eq",
            "polar_toggle"
        ]),
        "-5+j10"
    );
}

#[test]
fn the_polar_form_follows_the_angle_mode() {
    assert_eq!(
        main_of(&["angle_toggle", "3", "add", "j", "4", "eq", "polar_toggle"]),
        "5 ∠ 0.927295218"
    );
}

#[test]
fn the_entry_text_wins_over_the_display_form() {
    // 入力中は打鍵した通りに見せる。極形式は確定値にのみ適用する。
    assert_eq!(main_of(&["polar_toggle", "3"]), "3");
    assert_eq!(main_of(&["polar_toggle", "3", "eq"]), "3 ∠ 0");
}

#[test]
fn reports_the_display_form() {
    use calcarc_core::engine::state::DisplayForm;
    assert_eq!(run(&[]).form, DisplayForm::Rect);
    assert_eq!(run(&["polar_toggle"]).form, DisplayForm::Polar);
}
```

`5 ∠ 0.927295218` は 53.13010235415598° をラジアンにした 0.9272952180016122 を有効数字 10 桁に丸めた値。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core --test engine_table`
Expected: FAIL。`the_headline_case` で `left: "3+j4", right: "5 ∠ 53.13010235"`。

- [ ] **Step 3: 表示切替を実装する**

`crates/calcarc-core/src/engine/mod.rs` の `Key::PolarToggle` の分岐を差し替える。

```rust
        Key::PolarToggle => {
            // 表示形式だけを入れ替える。current には触れない。
            // これがあるから丸めた値が次の計算に流れ込まない。
            state.form = state.form.toggled();
        }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS。`the_headline_case` を含む。

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 出力なし

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Add the polar display toggle

The toggle swaps a display form and touches nothing else. The value the
engine holds after 3 + j4 = is the same value whether it is being shown
as 3+j4 or as 5 ∠ 53.13010235, so multiplying afterwards uses the exact
number rather than the eight decimal places that were on screen.

This is the whole reason the conversion is a display concern and not a
calculation: there is no rounded intermediate for it to leak.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 11: エラー挙動の固定と無 panic の保証

**Files:**
- Create: `crates/calcarc-core/tests/engine_robustness.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `reduce`, `display`, `EngineState`, `Key`, `STATE_SCHEMA`（Task 6–10）
- Produces: なし（テストのみ。実装の欠陥が見つかった場合のみ `engine/mod.rs` を修正する）

- [ ] **Step 1: エラー挙動のテストを追記する**

`crates/calcarc-core/tests/engine_table.rs` の末尾に追記する。

```rust
#[test]
fn overflow_becomes_an_error() {
    // 9 を繰り返し二乗すると f64 の範囲を出る。
    let mut keys = vec!["9"];
    keys.extend(std::iter::repeat_n("sqr", 10));
    assert_eq!(main_of(&keys), "Math ERROR");
}

#[test]
fn every_error_kind_reaches_the_display() {
    use calcarc_core::CalcError;
    assert_eq!(run(&["1", "div", "0", "eq"]).error, Some(CalcError::DivisionByZero));
    assert_eq!(run(&["9", "0", "tan"]).error, Some(CalcError::TrigPole));
    assert_eq!(run(&["rparen"]).error, Some(CalcError::SyntaxError));
    let mut keys = vec!["9"];
    keys.extend(std::iter::repeat_n("sqr", 10));
    assert_eq!(run(&keys).error, Some(CalcError::Overflow));
}

#[test]
fn ac_restores_a_usable_calculator() {
    // エラー後に AC を押したら、保留中の演算も一緒に消える。
    assert_eq!(main_of(&["2", "mul", "1", "div", "0", "eq", "ac", "7", "eq"]), "7");
}

#[test]
fn the_entry_buffer_stops_accepting_digits_at_its_limit() {
    // MAX_ENTRY_LEN は 12。超えた打鍵は無視され、エラーにはしない。
    // 打ち過ぎで電卓が止まるより、入らないほうが電卓らしい。
    let keys = vec!["7"; 20];
    let shown = run(&keys);
    assert_eq!(shown.main, "777777777777");
    assert!(shown.error.is_none());
}

#[test]
fn ac_keeps_the_user_set_modes() {
    use calcarc_core::engine::state::DisplayForm;
    use calcarc_core::AngleMode;
    let state = run(&["angle_toggle", "polar_toggle", "3", "ac"]);
    assert_eq!(state.angle, AngleMode::Rad);
    assert_eq!(state.form, DisplayForm::Polar);
}
```

`std::iter::repeat_n` は Rust 1.82 以降。使えない場合は `vec!["sqr"; 10]` に置き換える。

- [ ] **Step 1b: エラー中は保留状態を表示しない**

エラーが起きた時点で `operators` には途中の演算子が残る。`2` `+` `1` `÷` `0` `=` は `operators = [Op(Add)]` を残したままエラーになるため、`display` はそのまま読むと `Math ERROR` の横に `+` を出してしまう。エラー中に「何かの計算の途中である」と示すのは誤りなので、保留状態は伏せる。

まずテストを `crates/calcarc-core/tests/engine_table.rs` に追記する。

```rust
#[test]
fn an_error_hides_the_pending_state() {
    // エラー時点で operators には Add が残っているが、
    // Math ERROR の横に保留中の演算子を出すのは誤解を招く。
    let shown = run(&["2", "add", "1", "div", "0", "eq"]);
    assert_eq!(shown.main, "Math ERROR");
    assert_eq!(shown.pending_op, None);
    assert_eq!(shown.pending_depth, 0);
}
```

Run: `cargo test -p calcarc-core --test engine_table an_error_hides`
Expected: FAIL。`pending_op` が `Some(Add)` になる。

`crates/calcarc-core/src/engine/display.rs` の `display` を直す。`main` を決める分岐でエラーを見ているので、保留状態も同じ判断に揃える。

```rust
pub fn display(state: &EngineState) -> DisplayState {
    let has_error = state.error.is_some();
    let main = if has_error {
        ERROR_TEXT.to_string()
    } else if let Some(buffer) = &state.buffer {
        buffer.text()
    } else {
        match state.form {
            DisplayForm::Rect => format_rect(state.current),
            DisplayForm::Polar => format_polar(state.current, state.angle),
        }
    };

    DisplayState {
        main,
        angle: state.angle,
        form: state.form,
        // エラー中は保留状態を伏せる。スタックには途中の演算子が
        // 残っているが、それを見せても利用者にできることはない。
        pending_op: if has_error {
            None
        } else {
            state.operators.iter().rev().find_map(|t| match t {
                OpToken::Op(op) => Some(*op),
                OpToken::OpenParen => None,
            })
        },
        pending_depth: if has_error {
            0
        } else {
            state
                .operators
                .iter()
                .filter(|t| matches!(t, OpToken::OpenParen))
                .count()
        },
        error: state.error,
    }
}
```

Run: `cargo test -p calcarc-core --test engine_table`
Expected: PASS

- [ ] **Step 2: 無 panic の proptest を書く**

`crates/calcarc-core/tests/engine_robustness.rs`:

```rust
//! reduce がどんな入力に対しても panic しないことを確認する。
//!
//! UI に panic を露出させないという要求（base-spec §27）は、
//! 個別のテストケースでは保証しきれないため無作為な打鍵列で検査する。

use calcarc_core::engine::display::display;
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::{EngineState, OpToken, STATE_SCHEMA};
use proptest::prelude::*;

const TOKENS: &[&str] = &[
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "dot", "pi", "add", "sub", "mul", "div", "eq", "lparen", "rparen",
    "j", "polar_toggle", "sqrt", "sqr", "sin", "cos", "tan", "neg",
    "ac", "del", "angle_toggle",
];

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    /// 任意の打鍵列を与えても panic せず、常に表示可能な状態が返る。
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..TOKENS.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            let key = Key::from_token(TOKENS[i]).expect("token table is out of sync");
            let (next, shown) = reduce(&state, key);
            prop_assert!(!shown.main.is_empty());
            prop_assert_eq!(next.schema, STATE_SCHEMA);

            // 構造の健全性も見る。panic の有無だけを見ていると、
            // スタックがずれたまま Ok を返す退行を見逃す。
            // エラーが立っていない限り、被演算数の数は保留中の
            // 二項演算子の数と一致していなければならない。
            if next.error.is_none() {
                let pending_ops = next
                    .operators
                    .iter()
                    .filter(|t| matches!(t, OpToken::Op(_)))
                    .count();
                prop_assert_eq!(next.operands.len(), pending_ops);
            }

            state = next;
        }
        prop_assert!(!display(&state).main.is_empty());
    }

    /// AC はどんな状態からでも初期表示に戻す。
    #[test]
    fn ac_always_recovers(indices in prop::collection::vec(0usize..TOKENS.len(), 0..40)) {
        let mut state = EngineState::initial();
        for i in indices {
            state = reduce(&state, Key::from_token(TOKENS[i]).unwrap()).0;
        }
        let (cleared, shown) = reduce(&state, Key::Ac);
        prop_assert!(cleared.error.is_none());
        prop_assert!(cleared.operands.is_empty());
        prop_assert!(cleared.operators.is_empty());
        // 表示形式が Polar のままなら "0 ∠ 0"、Rect なら "0"。
        prop_assert!(shown.main == "0" || shown.main == "0 ∠ 0");
    }
}
```

- [ ] **Step 3: スキーマ不一致の扱いをテストする**

`crates/calcarc-core/tests/engine_robustness.rs` に追記する。

```rust
#[test]
fn a_state_with_the_wrong_schema_is_discarded() {
    let mut stale = EngineState::initial();
    stale.schema = STATE_SCHEMA + 1;
    stale.current = calcarc_core::Value::real(999.0);

    // 例外にせず、初期状態から再開する（設計書 §5）。
    let (next, shown) = reduce(&stale, Key::from_token("3").unwrap());
    assert_eq!(next.schema, STATE_SCHEMA);
    assert_eq!(shown.main, "3");
}
```

- [ ] **Step 4: テストを実行する**

Run: `cargo test -p calcarc-core`
Expected: PASS

失敗した場合は proptest が反例を出力する。その打鍵列を `engine_table.rs` に固定のテストとして追加してから `engine/mod.rs` を修正すること。反例をそのまま捨てない。

- [ ] **Step 5: フェーズ 2 の全体確認**

Run: `cargo test -p calcarc-core && cargo fmt --check && cargo clippy -p calcarc-core --all-targets -- -D warnings`
Expected: すべて成功

- [ ] **Step 5b: panic しないことを lint で強制する**

`crates/calcarc-core/src/lib.rs` の先頭（`//!` コメントの直後）に追記する。

```rust
// 本番経路で panic しないことをコンパイラに守らせる(base-spec §27)。
// テストコードでは unwrap を使うため、not(test) で限定する。
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
```

Run: `cargo clippy -p calcarc-core -- -D warnings`
Expected: 成功。失敗する場合、`src/` 配下の本番経路に `unwrap()` か `expect()` が残っている。`Result` を返すか、既定値にフォールバックする形に直すこと。grep ではなくこの lint が唯一の判定基準になる。

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Pin the error behaviour and prove the engine cannot panic

Fixed tests cover each error kind reaching the display and AC restoring a
usable calculator without discarding the user's angle mode or display
form.

Add proptests over random key sequences. Not exposing a panic to the UI
is a claim about every possible input, which enumerated cases cannot
establish; the property tests exercise arbitrary sequences and check that
a displayable state always comes back. A stale state carrying the wrong
schema is discarded rather than throwing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# フェーズ 3 — Python Reference Validation

## Task 12: Python reference プロジェクトと golden 生成

**Files:**
- Create: `reference/pyproject.toml`
- Create: `reference/src/calcarc_reference/__init__.py`
- Create: `reference/src/calcarc_reference/complex_ref.py`
- Create: `reference/src/calcarc_reference/scientific_ref.py`
- Create: `reference/src/calcarc_reference/cases.py`
- Create: `reference/scripts/generate.py`
- Create: `reference/tests/test_complex_ref.py`
- Create: `reference/tests/test_scientific_ref.py`
- Create: `testdata/complex.json`（生成物）
- Create: `testdata/scientific.json`（生成物）

**Interfaces:**
- Consumes: なし（Rust から独立している）
- Produces:
  - `calcarc_reference.complex_ref.rect_to_polar(re: float, im: float) -> tuple[float, float]`（r, theta_deg）
  - `calcarc_reference.complex_ref.polar_to_rect(r: float, theta_deg: float) -> tuple[float, float]`（re, im）
  - `calcarc_reference.scientific_ref.sin/cos/tan(x: float, mode: str) -> float`（mode は `"Deg"` / `"Rad"`）
  - `calcarc_reference.scientific_ref.sqrt_real(x: float) -> tuple[float, float]`（re, im）
  - `testdata/complex.json` と `testdata/scientific.json`（下記のスキーマ）

- [ ] **Step 1: uv プロジェクトを作り疎通を確認する**

`reference/pyproject.toml`:

```toml
[project]
name = "calcarc-reference"
version = "0.1.0"
description = "Independent reference implementation used to validate the CalcArc calculation core."
requires-python = ">=3.14"
dependencies = ["sympy>=1.13", "mpmath>=1.3"]

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/calcarc_reference"]

[tool.ruff]
line-length = 100

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Run: `cd reference && uv sync`
Expected: 成功し、`reference/uv.lock` が作られる。

**ここで失敗したら Python 3.14 で SymPy / mpmath が入らないということなので、`requires-python` を `>=3.13` に下げて再実行し、その旨をコミットメッセージに残す**（設計書 §12）。深追いしない。

- [ ] **Step 2: 参照実装の失敗するテストを書く**

`reference/tests/test_complex_ref.py`:

```python
"""参照実装そのものの健全性テスト。

Rust と突き合わせる前に、SymPy の使い方が正しいことを確認する。
"""

import math

from calcarc_reference.complex_ref import polar_to_rect, rect_to_polar


def test_headline_case() -> None:
    r, theta_deg = rect_to_polar(3.0, 4.0)
    assert r == 5.0
    assert math.isclose(theta_deg, 53.13010235415598, rel_tol=1e-15)


def test_all_four_quadrants() -> None:
    assert math.isclose(rect_to_polar(1.0, 1.0)[1], 45.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, 1.0)[1], 135.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, -1.0)[1], -135.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(1.0, -1.0)[1], -45.0, abs_tol=1e-12)


def test_axes() -> None:
    assert rect_to_polar(1.0, 0.0)[1] == 0.0
    assert math.isclose(rect_to_polar(0.0, 1.0)[1], 90.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(-1.0, 0.0)[1], 180.0, abs_tol=1e-12)
    assert math.isclose(rect_to_polar(0.0, -1.0)[1], -90.0, abs_tol=1e-12)


def test_round_trip() -> None:
    re, im = polar_to_rect(5.0, 53.13010235415598)
    assert math.isclose(re, 3.0, abs_tol=1e-12)
    assert math.isclose(im, 4.0, abs_tol=1e-12)


def test_the_origin_has_a_defined_angle() -> None:
    """原点の偏角は数学的には未定義だが、約束として 0 に固定する。

    SymPy の atan2(0, 0) は nan を返す。Rust の f64::atan2 は IEEE 754 に
    従って +0 を返す。両者が食い違ったままでは golden 検証が成立しないので、
    参照実装も IEEE 754 の約束に合わせる。nan は JSON としても不正である。
    """
    assert rect_to_polar(0.0, 0.0) == (0.0, 0.0)
```

`reference/tests/test_scientific_ref.py`:

```python
import math

from calcarc_reference.scientific_ref import cos, sin, sqrt_real, tan


def test_sine_in_degrees() -> None:
    assert math.isclose(sin(30.0, "Deg"), 0.5, abs_tol=1e-15)


def test_sine_of_a_half_turn_is_zero() -> None:
    # mpmath は 50 桁で評価してから f64 に落とすので、Rust の
    # libm が返す 1.22e-16 とは異なりちょうど 0 になる。
    # この差は tolerance の abs 側で吸収される。
    assert abs(sin(180.0, "Deg")) < 1e-30


def test_cosine_and_tangent() -> None:
    assert math.isclose(cos(60.0, "Deg"), 0.5, abs_tol=1e-15)
    assert math.isclose(tan(45.0, "Deg"), 1.0, abs_tol=1e-15)


def test_radian_mode() -> None:
    assert math.isclose(sin(math.pi / 6, "Rad"), 0.5, abs_tol=1e-15)


def test_square_root_of_a_negative_is_imaginary() -> None:
    assert sqrt_real(-4.0) == (0.0, 2.0)
    assert sqrt_real(4.0) == (2.0, 0.0)
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd reference && uv run pytest`
Expected: FAIL。`ModuleNotFoundError: No module named 'calcarc_reference'`。

- [ ] **Step 4: 参照実装を書く**

`reference/src/calcarc_reference/__init__.py`: 空ファイル。

`reference/src/calcarc_reference/complex_ref.py`:

```python
"""直交形式と極形式の相互変換の参照実装。

Rust は f64 の hypot と atan2 を直接呼ぶ。ここでは SymPy で厳密式を
組み立て、50 桁で評価してから f64 に落とす。同じ手順を踏まないことで、
同一の実装バグが両方に入る確率を下げる(base-spec §30)。
"""

from __future__ import annotations

import sympy as sp

PRECISION = 50


def _exact(x: float) -> sp.Rational:
    """float を厳密な有理数にする。

    str を経由するのは、sp.Rational(0.1) が二進表現をそのまま
    有理数化してしまうのを避けるため。
    """
    return sp.Rational(str(x))


def rect_to_polar(re: float, im: float) -> tuple[float, float]:
    """直交形式から極形式へ。角度は度で返す。"""
    a, b = _exact(re), _exact(im)
    if a == 0 and b == 0:
        # 原点の偏角は数学的には未定義で、SymPy の atan2(0, 0) は nan を返す。
        # IEEE 754 は atan2(+0, +0) = +0 と定めており、Rust の f64::atan2 は
        # それに従う。参照実装も同じ約束を採る。
        #
        # これはアルゴリズムの共有ではなく、未定義値に対する約束の統一である。
        # 約束が食い違ったままでは突き合わせ自体が成立しない。また nan は
        # RFC 8259 の JSON として不正なので、書き出す前にここで潰す。
        return 0.0, 0.0
    r_expr = sp.sqrt(a**2 + b**2)
    theta_expr = sp.atan2(b, a) * 180 / sp.pi
    return float(sp.N(r_expr, PRECISION)), float(sp.N(theta_expr, PRECISION))


def polar_to_rect(r: float, theta_deg: float) -> tuple[float, float]:
    """極形式から直交形式へ。角度は度で受け取る。"""
    radius = _exact(r)
    theta = _exact(theta_deg) * sp.pi / 180
    return (
        float(sp.N(radius * sp.cos(theta), PRECISION)),
        float(sp.N(radius * sp.sin(theta), PRECISION)),
    )
```

`reference/src/calcarc_reference/scientific_ref.py`:

```python
"""単項関数の参照実装。

Rust は libm の f64 実装を使う。ここでは mpmath の任意精度実装を
50 桁で評価してから f64 に落とす。
"""

from __future__ import annotations

import mpmath as mp

mp.mp.dps = 50


def _to_radians(x: float, mode: str) -> mp.mpf:
    v = mp.mpf(str(x))
    if mode == "Deg":
        return v * mp.pi / 180
    if mode == "Rad":
        return v
    raise ValueError(f"unknown angle mode: {mode}")


def sin(x: float, mode: str) -> float:
    return float(mp.sin(_to_radians(x, mode)))


def cos(x: float, mode: str) -> float:
    return float(mp.cos(_to_radians(x, mode)))


def tan(x: float, mode: str) -> float:
    return float(mp.tan(_to_radians(x, mode)))


def sqrt_real(x: float) -> tuple[float, float]:
    """実数の平方根。負なら虚部として返す。"""
    v = mp.mpf(str(x))
    if v >= 0:
        return float(mp.sqrt(v)), 0.0
    return 0.0, float(mp.sqrt(-v))
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd reference && uv run pytest -v`
Expected: PASS（9 テスト）

Run: `cd reference && uv run ruff check . && uv run ruff format --check .`
Expected: 出力なし

- [ ] **Step 6: テストケースの一覧を定義する**

`reference/src/calcarc_reference/cases.py`:

```python
"""Rust と突き合わせる入力ケース。

境界を重点的に含める(base-spec §33)。ゼロ、負数、四象限すべて、
実軸上と虚軸上、極めて大きい値と小さい値。
"""

from __future__ import annotations

# (re, im)
RECT_INPUTS: list[tuple[float, float]] = [
    (3.0, 4.0),
    (1.0, 0.0),
    (0.0, 1.0),
    (-1.0, 0.0),
    (0.0, -1.0),
    (1.0, 1.0),
    (-1.0, 1.0),
    (-1.0, -1.0),
    (1.0, -1.0),
    (0.0, 0.0),
    (-5.0, 10.0),
    (1e-8, 1e-8),
    (1e8, -1e8),
    (0.1, 0.2),
    (123456.789, -987654.321),
]

# (r, theta_deg)
POLAR_INPUTS: list[tuple[float, float]] = [
    (5.0, 53.13010235415598),
    (1.0, 0.0),
    (1.0, 90.0),
    (1.0, 180.0),
    (1.0, -90.0),
    (1.0, 45.0),
    (2.0, -135.0),
    (0.0, 30.0),
    (1e6, 1.0),
    (1e-8, 45.0),
]

# (関数名, 引数, 角度モード)
UNARY_INPUTS: list[tuple[str, float, str]] = [
    ("sin", 0.0, "Deg"),
    ("sin", 30.0, "Deg"),
    ("sin", 90.0, "Deg"),
    ("sin", 180.0, "Deg"),
    ("sin", -30.0, "Deg"),
    ("sin", 0.5235987755982988, "Rad"),
    ("cos", 0.0, "Deg"),
    ("cos", 60.0, "Deg"),
    ("cos", 180.0, "Deg"),
    ("cos", 3.141592653589793, "Rad"),
    ("tan", 0.0, "Deg"),
    ("tan", 45.0, "Deg"),
    ("tan", -45.0, "Deg"),
    ("tan", 89.0, "Deg"),
    # 極めて大きい値・小さい値（base-spec §33）。
    #
    # ラジアンは f64 の値をそのまま使うので、libm の引数削減と mpmath の
    # 任意精度評価は全桁一致する（1e6 まで測定して差 0）。
    # 度は f64 で π/180 を掛ける段階で誤差が入り、角度が大きいほど増幅する。
    # 実測した差は 1e5 度で 9.1e-15、1e6 度で 3.3e-13、1e7 度で 1.8e-12。
    # 許容誤差 1e-12 を超えるのは 1e6 と 1e7 のあいだなので、golden には
    # 余裕のある 1e5 を使う。この限界は numerical-policy.md に記録する。
    ("sin", 100000.0, "Deg"),
    ("sin", 1e-8, "Deg"),
    ("cos", 1e-8, "Deg"),
    ("sin", 1000000.0, "Rad"),
    ("cos", 1e-8, "Rad"),
    ("tan", 100000.0, "Rad"),
]

# sqrt の入力（実数のみ）
SQRT_INPUTS: list[float] = [0.0, 1.0, 4.0, 2.0, 0.25, -4.0, -1.0, 1e-8, 1e8]
```

- [ ] **Step 7: golden 生成スクリプトを書く**

`reference/scripts/generate.py`:

```python
"""testdata/*.json を生成する。

このスクリプトの出力はリポジトリにコミットされ、Rust テストが読む。
CI では再生成して差分が出ないことを確認する(設計書 §7.1)。
"""

from __future__ import annotations

import json
import pathlib
import sys

import mpmath
import sympy

from calcarc_reference import cases, complex_ref, scientific_ref

SCHEMA = 1
TOLERANCE = {"abs": 1e-12, "rel": 1e-12}
TESTDATA = pathlib.Path(__file__).resolve().parents[2] / "testdata"


def _provenance() -> str:
    return (
        f"sympy {sympy.__version__} / mpmath {mpmath.__version__}, "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )


def build_complex() -> dict:
    entries = []
    for re, im in cases.RECT_INPUTS:
        r, theta_deg = complex_ref.rect_to_polar(re, im)
        entries.append(
            {
                "id": f"rect_to_polar/{re}/{im}",
                "op": "rect_to_polar",
                "input": {"re": re, "im": im},
                "expect": {"r": r, "theta_deg": theta_deg},
            }
        )
    for r, theta_deg in cases.POLAR_INPUTS:
        re, im = complex_ref.polar_to_rect(r, theta_deg)
        entries.append(
            {
                "id": f"polar_to_rect/{r}/{theta_deg}",
                "op": "polar_to_rect",
                "input": {"r": r, "theta_deg": theta_deg},
                "expect": {"re": re, "im": im},
            }
        )
    return _envelope(entries)


def build_scientific() -> dict:
    entries = []
    for name, x, mode in cases.UNARY_INPUTS:
        fn = getattr(scientific_ref, name)
        entries.append(
            {
                "id": f"{name}/{mode}/{x}",
                "op": name,
                "mode": mode,
                "input": {"x": x},
                "expect": {"re": fn(x, mode), "im": 0.0},
            }
        )
    for x in cases.SQRT_INPUTS:
        re, im = scientific_ref.sqrt_real(x)
        entries.append(
            {
                "id": f"sqrt/{x}",
                "op": "sqrt",
                "mode": "Deg",
                "input": {"x": x},
                "expect": {"re": re, "im": im},
            }
        )
    return _envelope(entries)


def _envelope(entries: list[dict]) -> dict:
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


def write(name: str, payload: dict) -> None:
    path = TESTDATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # 差分が安定するよう整形して書く。末尾改行を付ける。
    # allow_nan=False にするのは、nan / inf が RFC 8259 の JSON として
    # 不正であり、serde_json が解析できないため。黙って不正な golden を
    # 書き出すより、生成時に ValueError で落ちるほうがよい。
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def main() -> None:
    write("complex.json", build_complex())
    write("scientific.json", build_scientific())


if __name__ == "__main__":
    main()
```

- [ ] **Step 8: golden を生成して中身を確認する**

Run: `cd reference && uv run python scripts/generate.py`
Expected: `wrote .../testdata/complex.json (24 cases)` と `wrote .../testdata/scientific.json (23 cases)`

Run: `grep -A4 '"rect_to_polar/3.0/4.0"' testdata/complex.json`
Expected: `"theta_deg": 53.13010235415598` を含むこと。この値が本スライスの目標表示の根拠になる。

- [ ] **Step 9: 再生成が冪等であることを確認する**

Run: `cd reference && uv run python scripts/generate.py && cd .. && git diff --stat testdata/`
Expected: `testdata/` に差分なし（2 回目の生成で同じ内容になる）

差分が出る場合は浮動小数点の書き出しが非決定的ということなので、`json.dumps` の設定を見直す。

- [ ] **Step 10: コミット**

```bash
git add reference/ testdata/
git commit -F - <<'EOF'
Add the Python reference implementation and generate the golden files

The reference deliberately does not mirror the Rust. Where the core calls
f64 hypot and atan2, complex_ref builds the expression exactly in SymPy
and evaluates it to fifty digits before dropping to f64; where the core
calls libm, scientific_ref uses mpmath's arbitrary-precision routines.
Taking a different route is the point: a transliteration would carry the
same bug into both sides and validate nothing.

The generated expectations are committed rather than computed at test
time, so a change to a rounding rule shows up as a reviewable diff.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 13: Rust による golden 検証

**Files:**
- Create: `crates/calcarc-core/tests/golden.rs`
- Modify: `crates/calcarc-core/Cargo.toml`（`serde_json` を dev-dependency に追加）

**Interfaces:**
- Consumes: `Value`（Task 1）、`to_polar`, `from_polar`, `Polar`（Task 3）、`AngleMode`（Task 4）、`scientific::sin/cos/tan/sqrt`（Task 5）、`testdata/*.json`（Task 12）
- Produces: なし（テストのみ）

- [ ] **Step 1: dev-dependency を追加する**

`crates/calcarc-core/Cargo.toml` の `[dev-dependencies]` に追記する。

```toml
serde_json = { workspace = true }
```

- [ ] **Step 2: golden 検証テストを書く**

`crates/calcarc-core/tests/golden.rs`:

```rust
//! Python が生成した期待値と Rust の結果を突き合わせる(base-spec §35)。
//!
//! 許容誤差は JSON の `tolerance` から読む。テストコードに誤差値を
//! 書かないこと(base-spec §36)。

use std::path::PathBuf;

use calcarc_core::complex::polar::{from_polar, to_polar, Polar};
use calcarc_core::numeric::angle::AngleMode;
use calcarc_core::{scientific, Value};
use serde::Deserialize;

const SCHEMA: u32 = 1;

#[derive(Debug, Deserialize)]
struct Golden {
    schema: u32,
    generated_by: String,
    tolerance: Tolerance,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct Tolerance {
    abs: f64,
    rel: f64,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    op: String,
    #[serde(default)]
    mode: Option<String>,
    input: serde_json::Value,
    expect: serde_json::Value,
}

fn load(name: &str) -> Golden {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "testdata", name]
        .iter()
        .collect();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}. Run reference/scripts/generate.py", path.display()));
    let golden: Golden = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()));
    assert_eq!(
        golden.schema, SCHEMA,
        "{name} was generated with an incompatible schema"
    );
    assert!(!golden.cases.is_empty(), "{name} has no cases");
    golden
}

fn field(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key)
        .and_then(|x| x.as_f64())
        .unwrap_or_else(|| panic!("missing numeric field {key} in {v}"))
}

/// 絶対誤差か相対誤差のどちらかを満たせば合格とする。
/// 0 近傍では相対誤差が使えず、大きな値では絶対誤差が使えないため。
fn close(actual: f64, expected: f64, tol: Tolerance, id: &str, what: &str) {
    let diff = (actual - expected).abs();
    let ok = diff <= tol.abs || diff <= tol.rel * expected.abs();
    assert!(
        ok,
        "{id} / {what}: got {actual}, expected {expected} (diff {diff}, abs tol {}, rel tol {})",
        tol.abs, tol.rel
    );
}

fn angle_mode(case: &Case) -> AngleMode {
    match case.mode.as_deref() {
        Some("Rad") => AngleMode::Rad,
        // mode を持たないケースは度として扱う。
        Some("Deg") | None => AngleMode::Deg,
        // 綴り違いを黙って度に倒さない。ラジアンのケースが誤ったモードで
        // 評価されると「差が大きい」という分かりにくい失敗になり、
        // golden ファイルの不備が数値の不一致に化けてしまう。
        // このファイルの他の箇所（field / load）と同じく、不備は不備として落とす。
        Some(other) => panic!("{}: unknown angle mode {other:?}", case.id),
    }
}

#[test]
fn complex_conversions_match_the_reference() {
    let golden = load("complex.json");
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        match case.op.as_str() {
            "rect_to_polar" => {
                let v = Value::new(field(&case.input, "re"), field(&case.input, "im"));
                let p = to_polar(v);
                close(p.r, field(&case.expect, "r"), golden.tolerance, &case.id, "r");
                close(
                    p.theta_rad.to_degrees(),
                    field(&case.expect, "theta_deg"),
                    golden.tolerance,
                    &case.id,
                    "theta_deg",
                );
            }
            "polar_to_rect" => {
                let p = Polar {
                    r: field(&case.input, "r"),
                    theta_rad: field(&case.input, "theta_deg").to_radians(),
                };
                let v = from_polar(p);
                close(v.re, field(&case.expect, "re"), golden.tolerance, &case.id, "re");
                close(v.im, field(&case.expect, "im"), golden.tolerance, &case.id, "im");
            }
            other => panic!("{}: unknown op {other}", case.id),
        }
    }
}

#[test]
fn scientific_functions_match_the_reference() {
    let golden = load("scientific.json");
    println!("validating against {}", golden.generated_by);

    for case in &golden.cases {
        let x = Value::real(field(&case.input, "x"));
        let mode = angle_mode(case);
        let actual = match case.op.as_str() {
            "sin" => scientific::sin(x, mode),
            "cos" => scientific::cos(x, mode),
            "tan" => scientific::tan(x, mode),
            "sqrt" => scientific::sqrt(x),
            other => panic!("{}: unknown op {other}", case.id),
        }
        .unwrap_or_else(|e| panic!("{}: unexpected error {e:?}", case.id));

        close(actual.re, field(&case.expect, "re"), golden.tolerance, &case.id, "re");
        close(actual.im, field(&case.expect, "im"), golden.tolerance, &case.id, "im");
    }
}
```

- [ ] **Step 3: テストを実行する**

Run: `cargo test -p calcarc-core --test golden -- --nocapture`
Expected: PASS。`validating against sympy ... / mpmath ..., Python 3.14` が出力される。

**失敗した場合の切り分け:** どちらが正しいかを判断してから直すこと。Python 側が高精度なので、差が `1e-12` を大きく超えるなら Rust の実装を疑う。差が `1e-16` 程度で `tan(89°)` のような大きな値のケースだけなら相対誤差の問題なので、`generate.py` の `TOLERANCE` にケース別の上書きを足す方が妥当なこともある。その場合は `Case` に `tolerance` フィールド（`Option<Tolerance>`）を足して個別に読む。

- [ ] **Step 4: 全テストが通ることを確認する**

Run: `cargo test -p calcarc-core && cargo clippy -p calcarc-core --all-targets -- -D warnings`
Expected: すべて成功

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Validate the core against the Python golden files

The Rust tests read testdata/*.json and compare against the expectations
SymPy and mpmath produced, taking the tolerance from the file's own
metadata rather than from constants in the test code, so the numerical
policy stays in one place.

A case passes on either absolute or relative error. Neither alone covers
the range: relative error is meaningless near zero, absolute error is
meaningless at 1e8.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# フェーズ 4 — WASM 境界と Web の土台

## Task 14: calcarc-wasm

**Files:**
- Create: `crates/calcarc-wasm/Cargo.toml`
- Create: `crates/calcarc-wasm/src/lib.rs`
- Create: `crates/calcarc-wasm/tests/web.rs`
- Modify: `Cargo.toml`（workspace の `members` に追加）

**Interfaces:**
- Consumes: `EngineState::initial`, `EngineState::is_valid`, `Key::from_token`, `reduce`, `display`, `DisplayState`（Task 6–10）
- Produces（JS から見える名前）:
  - `initial_state(): { state, display }`
  - `reduce(state: unknown, key: string): { state, display }`
  - `core_version(): string`

- [ ] **Step 1: クレートを作る**

ルートの `Cargo.toml` の `members` を `["crates/calcarc-core", "crates/calcarc-wasm"]` に戻す。

`crates/calcarc-wasm/Cargo.toml`:

```toml
[package]
name = "calcarc-wasm"
edition.workspace = true
version.workspace = true
license.workspace = true
repository.workspace = true
description = "WebAssembly adapter for calcarc-core. Holds no calculation logic."

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
calcarc-core = { path = "../calcarc-core" }
serde = { workspace = true }
serde-wasm-bindgen = "0.6"
wasm-bindgen = "0.2"
console_error_panic_hook = { version = "0.1", optional = true }

[features]
default = ["console_error_panic_hook"]
console_error_panic_hook = ["dep:console_error_panic_hook"]

[dev-dependencies]
js-sys = "0.3"
wasm-bindgen-test = "0.3"
```

- [ ] **Step 2: 失敗する wasm-bindgen-test を書く**

`crates/calcarc-wasm/tests/web.rs`:

```rust
//! ブラウザ上で WASM 境界が実際に動くことを確認する(Layer 5)。
//!
//! Run: wasm-pack test --headless --chrome crates/calcarc-wasm

#![cfg(target_arch = "wasm32")]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn get(value: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(value, &JsValue::from_str(key))
        .unwrap_or_else(|_| panic!("missing field {key}"))
}

fn main_text(step: &JsValue) -> String {
    get(&get(step, "display"), "main")
        .as_string()
        .expect("main should be a string")
}

fn press(step: JsValue, keys: &[&str]) -> JsValue {
    let mut current = step;
    for key in keys {
        current = calcarc_wasm::reduce_key(get(&current, "state"), key);
    }
    current
}

#[wasm_bindgen_test]
fn starts_at_zero() {
    assert_eq!(main_text(&calcarc_wasm::initial_state()), "0");
}

#[wasm_bindgen_test]
fn the_headline_case_crosses_the_boundary() {
    let step = press(
        calcarc_wasm::initial_state(),
        &["3", "add", "j", "4", "eq", "polar_toggle"],
    );
    assert_eq!(main_text(&step), "5 ∠ 53.13010235");
}

#[wasm_bindgen_test]
fn an_unknown_key_is_ignored() {
    let step = press(calcarc_wasm::initial_state(), &["3", "nonsense"]);
    assert_eq!(main_text(&step), "3");
}

#[wasm_bindgen_test]
fn an_unusable_state_falls_back_to_the_initial_one() {
    // localStorage の破損などを模す。例外にはせず初期状態から再開する。
    let step = calcarc_wasm::reduce_key(JsValue::from_str("garbage"), "3");
    assert_eq!(main_text(&step), "3");
}

#[wasm_bindgen_test]
fn errors_are_returned_not_thrown() {
    let step = press(calcarc_wasm::initial_state(), &["1", "div", "0", "eq"]);
    assert_eq!(main_text(&step), "Math ERROR");
    assert_eq!(
        get(&get(&step, "display"), "error").as_string().as_deref(),
        Some("DivisionByZero")
    );
}
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: FAIL。`cannot find function initial_state in crate calcarc_wasm`。

`wasm-pack` が未導入なら `cargo install wasm-pack` で入れる。Chrome / Chromium が必要。

- [ ] **Step 4: 境界を実装する**

`crates/calcarc-wasm/src/lib.rs`:

```rust
//! calcarc-core を WebAssembly から使うための adapter。
//!
//! 計算ロジックを持たない。責務は型変換と export のみ(base-spec §6.2)。
//! JavaScript 例外を投げない。計算エラーは戻り値の一部である(base-spec §27)。

use calcarc_core::engine::display::{display, DisplayState};
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::EngineState;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// 1 回の遷移の結果。TypeScript 側の `Step` に対応する。
#[derive(Serialize)]
struct Step {
    state: EngineState,
    display: DisplayState,
}

#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// 開発時に panic を可視化するためのフック以外では、panic は起きない想定。
/// 万一シリアライズに失敗したら null を返し、呼び出し側が初期化し直す。
fn to_js(step: &Step) -> JsValue {
    serde_wasm_bindgen::to_value(step).unwrap_or(JsValue::NULL)
}

fn step_of(state: EngineState) -> Step {
    let shown = display(&state);
    Step { state, display: shown }
}

#[wasm_bindgen]
pub fn initial_state() -> JsValue {
    to_js(&step_of(EngineState::initial()))
}

/// キーを 1 つ適用する。
///
/// 渡された状態が読めない、あるいはスキーマが合わない場合は
/// 初期状態から始める。未知のキートークンは無視して現状を返す。
/// どちらの場合も例外にしない。
#[wasm_bindgen(js_name = reduce)]
pub fn reduce_key(state: JsValue, key: &str) -> JsValue {
    let current = serde_wasm_bindgen::from_value::<EngineState>(state)
        .ok()
        .filter(EngineState::is_valid)
        .unwrap_or_else(EngineState::initial);

    let Some(parsed) = Key::from_token(key) else {
        return to_js(&step_of(current));
    };

    let (next, shown) = reduce(&current, parsed);
    to_js(&Step { state: next, display: shown })
}

#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

`EngineState::is_valid` は `&self` を取るので `.filter(EngineState::is_valid)` がそのまま使える。

- [ ] **Step 5: テストが通ることを確認する**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: PASS（5 テスト）

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: 出力なし

- [ ] **Step 6: WASM をビルドできることを確認する**

Run: `wasm-pack build crates/calcarc-wasm --target web --out-dir ../../web/src/wasm`
Expected: `web/src/wasm/calcarc_wasm.js` と `calcarc_wasm_bg.wasm`、`calcarc_wasm.d.ts` が生成される

`web/src/wasm/` は `.gitignore` 済み（Task 1）。生成物はコミットしない。

- [ ] **Step 7: コミット**

```bash
git add Cargo.toml crates/calcarc-wasm/
git commit -F - <<'EOF'
Add the WASM adapter

calcarc-wasm converts types and exports three functions. It holds no
calculation logic, so there is nothing here that could disagree with the
core about what a calculation means.

Nothing crosses the boundary as an exception. A calculation error arrives
as a field on the returned display, an unreadable or stale state falls
back to a fresh one, and an unrecognised key token leaves the state
alone. The browser test exercises each of those paths along with the
headline conversion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 15: web プロジェクトと計算ラッパー

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/biome.json`
- Create: `web/playwright.config.ts`
- Create: `web/index.html`
- Create: `web/public/_headers`
- Create: `web/public/_redirects`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/calc/types.ts`
- Create: `web/src/calc/index.ts`
- Test: `web/tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `initial_state`, `reduce`, `core_version`（Task 14）
- Produces:
  - `web/src/calc/types.ts`: `AngleMode`, `DisplayForm`, `CalcErrorCode`, `BinOpName`, `KeyToken`, `KEY_TOKENS`, `DisplayState`, `EngineState`, `Step`
  - `web/src/calc/index.ts`: `initCalc(): Promise<Calc>`、`Calc { initial(): Step; dispatch(state: EngineState, key: KeyToken): Step; version(): string }`

- [ ] **Step 1: pnpm プロジェクトを作る**

`web/package.json`:

```json
{
  "name": "calcarc-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "wasm": "wasm-pack build ../crates/calcarc-wasm --target web --out-dir ../../web/src/wasm",
    "dev": "pnpm wasm && vite",
    "build": "pnpm wasm && tsc --noEmit && vite build",
    "preview": "vite preview --port 4173",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@playwright/test": "^1.50.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-plugin-top-level-await": "^1.4.0",
    "vite-plugin-wasm": "^3.4.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `cd web && pnpm install`
Expected: `web/pnpm-lock.yaml` が作られる

Run: `cd web && pnpm exec playwright install --with-deps chromium`
Expected: Chromium が入る

- [ ] **Step 2: 設定ファイルを置く**

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"],
  "exclude": ["src/wasm", "tests/e2e"]
}
```

`src/wasm` を除外するのは、`wasm-pack` の生成する `.d.ts` が `noUnusedParameters` などに引っかかるため。境界の型は `src/calc/types.ts` で自前に定義する。

`web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // Cloudflare Pages はルート配信なので base はそのまま。
  base: "/",
  plugins: [react(), wasm(), topLevelAwait()],
  build: { target: "es2022" },
});
```

`web/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "includes": ["src/**", "tests/**", "*.ts"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

`src/wasm` は `files.includes` に入れていないので lint 対象外になる。

`web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "mobile",
      // スマートフォン第一(base-spec §42)。既定の viewport を縦持ちにする。
      use: { viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>CalcArc</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/public/_headers`:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`web/public/_redirects`:

```
/*    /index.html   200
```

- [ ] **Step 3: 失敗する smoke テストを書く**

`web/tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("the calculator loads and shows zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the core version is reported", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("core-version")).toContainText("0.1.0");
});
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cd web && pnpm e2e`
Expected: FAIL。ビルドが通らないか、`display-main` が見つからない。

- [ ] **Step 5: 境界の型を定義する**

`web/src/calc/types.ts`:

```ts
/** calcarc-core の numeric::angle::AngleMode に対応。 */
export type AngleMode = "Deg" | "Rad";

/** calcarc-core の engine::state::DisplayForm に対応。 */
export type DisplayForm = "Rect" | "Polar";

/** calcarc-core の error::CalcError に対応。 */
export type CalcErrorCode = "DivisionByZero" | "Overflow" | "TrigPole" | "SyntaxError";

/** calcarc-core の engine::state::BinOp に対応。 */
export type BinOpName = "Add" | "Sub" | "Mul" | "Div";

/**
 * calcarc-core の engine::key::Key に対応するトークン。
 * 画面のボタンと物理キーボードの両方がここに写像される。
 */
export const KEY_TOKENS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "dot", "pi",
  "add", "sub", "mul", "div", "eq", "lparen", "rparen",
  "j", "polar_toggle",
  "sqrt", "sqr", "sin", "cos", "tan", "neg",
  "ac", "del", "angle_toggle",
] as const;

export type KeyToken = (typeof KEY_TOKENS)[number];

/** calcarc-core の engine::display::DisplayState に対応。 */
export interface DisplayState {
  main: string;
  angle: AngleMode;
  form: DisplayForm;
  pendingOp: BinOpName | null;
  pendingDepth: number;
  error: CalcErrorCode | null;
}

/**
 * 電卓の状態。中身は calcarc-core の所有物なので不透明に扱う。
 * TypeScript 側は受け取ってそのまま返すだけで、構造に依存しない。
 */
export type EngineState = { readonly __engineState: unique symbol };

/** 1 回の遷移の結果。 */
export interface Step {
  state: EngineState;
  display: DisplayState;
}
```

- [ ] **Step 6: WASM ラッパーを書く**

`web/src/calc/index.ts`:

```ts
/**
 * calcarc-wasm の薄いラッパー。
 *
 * UI Framework に依存しない(base-spec §4.3)。ここに react を
 * import してはならない。
 */

import init, {
  core_version,
  initial_state,
  reduce,
} from "../wasm/calcarc_wasm.js";
import type { EngineState, KeyToken, Step } from "./types";

export type { BinOpName, DisplayState, EngineState, KeyToken, Step } from "./types";
export { KEY_TOKENS } from "./types";

export interface Calc {
  /** 初期状態とその表示。 */
  initial(): Step;
  /** キーを 1 つ適用する。 */
  dispatch(state: EngineState, key: KeyToken): Step;
  /** 計算コアのバージョン。 */
  version(): string;
}

let ready: Promise<Calc> | null = null;

/**
 * WASM を読み込んで Calc を返す。複数回呼んでも初期化は 1 度だけ。
 */
export function initCalc(): Promise<Calc> {
  ready ??= init().then(() => ({
    initial: () => asStep(initial_state()),
    dispatch: (state: EngineState, key: KeyToken) => asStep(reduce(state, key)),
    version: () => core_version(),
  }));
  return ready;
}

/**
 * WASM 側はシリアライズに失敗したときだけ null を返す。実際には
 * 起きない経路だが、起きたら初期状態から作り直す。
 */
function asStep(value: unknown, retry = true): Step {
  if (value !== null && typeof value === "object") {
    return value as Step;
  }
  if (retry) {
    return asStep(initial_state(), false);
  }
  throw new Error("calc: the WASM module returned an unusable state");
}
```

- [ ] **Step 7: 最小の App を書く**

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing #root");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { type Calc, initCalc, type Step } from "./calc";

export function App() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    let cancelled = false;
    initCalc().then((loaded) => {
      if (cancelled) return;
      setCalc(loaded);
      setStep(loaded.initial());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!calc || !step) {
    return <p>Loading…</p>;
  }

  return (
    <main>
      <output data-testid="display-main">{step.display.main}</output>
      <p data-testid="core-version">calcarc-core {calc.version()}</p>
    </main>
  );
}
```

キーパッドと配線は Task 18 で足す。ここでは WASM が読み込まれて初期表示が出ることだけを担保する。

- [ ] **Step 8: テストが通ることを確認する**

Run: `cd web && pnpm build`
Expected: 成功。`web/dist/` が生成される

Run: `cd web && pnpm typecheck && pnpm lint`
Expected: 出力なし

Run: `cd web && pnpm e2e`
Expected: PASS（2 テスト）

- [ ] **Step 9: コミット**

```bash
git add web/ .gitignore
git commit -F - <<'EOF'
Add the web project and the calculation wrapper

web/src/calc wraps the three WASM exports and imports nothing from React,
so the calculation path stays usable if the UI framework is ever
replaced. The engine state is typed as an opaque value because it belongs
to the core; TypeScript receives it and hands it back without depending
on its shape.

App renders only the initial display and the core version for now. That
is enough to prove the browser is reaching Rust through WASM, which is
what the smoke test checks.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# フェーズ 5 — 電卓 UI

## Task 16: デザイントークンと Key コンポーネント

**Files:**
- Modify: `web/package.json`（テスト用の依存を追加）
- Modify: `web/vite.config.ts`（vitest 設定を追加）
- Create: `web/tests/setup.ts`
- Create: `web/src/ui/tokens.css`
- Create: `web/src/ui/Key/Key.tsx`
- Create: `web/src/ui/Key/Key.module.css`
- Test: `web/src/ui/Key/Key.test.tsx`

**Interfaces:**
- Consumes: `KeyToken`（Task 15）
- Produces:
  - `web/src/ui/Key/Key.tsx`: `Key`, `KeyVariant = "digit" | "operator" | "function" | "danger"`, `KeyProps { token, label, ariaLabel?, variant?, onPress }`
  - `web/src/ui/tokens.css`: 全デザイントークン

- [ ] **Step 1: テスト環境を整える**

`web/package.json` の `devDependencies` に追記する。

```json
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^26.0.0",
```

`web/vite.config.ts` を差し替える。

```ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // Cloudflare Pages はルート配信なので base はそのまま。
  base: "/",
  plugins: [react(), wasm(), topLevelAwait()],
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // E2E は Playwright が回すので vitest からは外す。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

`web/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Run: `cd web && pnpm install`
Expected: 成功

- [ ] **Step 2: デザイントークンを書く**

`web/src/ui/tokens.css`:

```css
/*
 * デザイントークン。色・寸法・書体をここに集約する。
 *
 * テーマの切り替えはトークンの差し替えだけで行い、コンポーネント側の
 * CSS は変更しない(設計書 §3.4)。
 */

:root {
  color-scheme: light dark;

  /* タッチターゲットとレイアウト(base-spec §43) */
  --touch-target-min: 44px;
  --key-gap: 8px;
  --shell-max-width: 480px;
  --radius: 12px;

  /* 配色 */
  --surface-bg: #f2f2f7;
  --display-bg: #ffffff;
  --display-fg: #1c1c1e;
  --display-status-fg: #6c6c70;
  --key-bg: #ffffff;
  --key-fg: #1c1c1e;
  --key-accent-bg: #d8e6ff;
  --key-accent-fg: #0b3d91;
  --key-function-bg: #e8e8ed;
  --key-function-fg: #1c1c1e;
  --key-danger-bg: #ffd8d8;
  --key-danger-fg: #8b1a1a;
  --error-fg: #b00020;

  /* タイポグラフィ */
  --display-font: ui-monospace, SFMono-Regular, Menlo, monospace;
  --display-size-main: clamp(1.75rem, 8vw, 2.5rem);
  --display-size-status: 0.75rem;
  --key-font-size: 1.125rem;

  /* フォーカス(base-spec §43) */
  --focus-ring: 3px solid #0b57d0;
  --focus-offset: 2px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-bg: #000000;
    --display-bg: #1c1c1e;
    --display-fg: #f2f2f7;
    --display-status-fg: #98989d;
    --key-bg: #2c2c2e;
    --key-fg: #f2f2f7;
    --key-accent-bg: #143a75;
    --key-accent-fg: #cfe0ff;
    --key-function-bg: #3a3a3c;
    --key-function-fg: #f2f2f7;
    --key-danger-bg: #5c1a1a;
    --key-danger-fg: #ffd8d8;
    --error-fg: #ff6b6b;
    --focus-ring: 3px solid #8ab4f8;
  }
}

/* ハイコントラスト(base-spec §43) */
@media (prefers-contrast: more) {
  :root {
    --surface-bg: #ffffff;
    --display-bg: #ffffff;
    --display-fg: #000000;
    --display-status-fg: #000000;
    --key-bg: #ffffff;
    --key-fg: #000000;
    --key-accent-bg: #ffffff;
    --key-accent-fg: #000000;
    --key-function-bg: #ffffff;
    --key-function-fg: #000000;
    --key-danger-bg: #ffffff;
    --key-danger-fg: #000000;
    --error-fg: #000000;
    --focus-ring: 4px solid #000000;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--surface-bg);
  color: var(--display-fg);
  font-family: system-ui, sans-serif;
  /* スマートフォンでのダブルタップ拡大を抑える。 */
  touch-action: manipulation;
}
```

- [ ] **Step 3: Key の失敗するテストを書く**

`web/src/ui/Key/Key.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Key } from "./Key";

describe("Key", () => {
  it("renders a real button element", () => {
    render(<Key token="7" label="7" onPress={() => {}} />);
    // div にクリックハンドラを付けない(base-spec §43)。
    expect(screen.getByRole("button", { name: "7" })).toBeInTheDocument();
  });

  it("uses the accessible label when the visible label is a symbol", () => {
    render(<Key token="polar_toggle" label="▸∠" ariaLabel="極形式に切り替え" onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "極形式に切り替え" })).toHaveTextContent("▸∠");
  });

  it("reports the token it was pressed with", async () => {
    const onPress = vi.fn();
    render(<Key token="add" label="+" ariaLabel="足す" onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "足す" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("add");
  });

  it("exposes the token for tests and for the keyboard highlight", () => {
    render(<Key token="eq" label="=" ariaLabel="計算する" onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "計算する" })).toHaveAttribute("data-token", "eq");
  });
});
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `cd web && pnpm test`
Expected: FAIL。`Failed to resolve import "./Key"`。

- [ ] **Step 5: Key を実装する**

`web/src/ui/Key/Key.module.css`:

```css
.key {
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: var(--key-bg);
  color: var(--key-fg);
  font-family: inherit;
  font-size: var(--key-font-size);
  cursor: pointer;
  /* 長押しの選択・コンテキストメニューを抑える。 */
  user-select: none;
  -webkit-user-select: none;
}

.key:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.key:active {
  filter: brightness(0.92);
}

.digit {
  background: var(--key-bg);
  color: var(--key-fg);
}

.operator {
  background: var(--key-accent-bg);
  color: var(--key-accent-fg);
  font-weight: 600;
}

.function {
  background: var(--key-function-bg);
  color: var(--key-function-fg);
  font-size: 1rem;
}

.danger {
  background: var(--key-danger-bg);
  color: var(--key-danger-fg);
  font-weight: 600;
}
```

`web/src/ui/Key/Key.tsx`:

```tsx
import type { KeyToken } from "../../calc";
import styles from "./Key.module.css";

export type KeyVariant = "digit" | "operator" | "function" | "danger";

export interface KeyProps {
  /** calcarc-core に渡すトークン。 */
  token: KeyToken;
  /** 画面に出す文字。記号でよい。 */
  label: string;
  /**
   * 読み上げ用の名前。記号キーには必ず与える(base-spec §43)。
   * 省略時は label をそのまま使う。
   */
  ariaLabel?: string;
  variant?: KeyVariant;
  onPress: (token: KeyToken) => void;
}

export function Key({ token, label, ariaLabel, variant = "digit", onPress }: KeyProps) {
  return (
    <button
      type="button"
      className={`${styles.key} ${styles[variant]}`}
      aria-label={ariaLabel ?? label}
      data-token={token}
      onClick={() => onPress(token)}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd web && pnpm test`
Expected: PASS（4 テスト）

Run: `cd web && pnpm typecheck && pnpm lint`
Expected: 出力なし

- [ ] **Step 7: コミット**

```bash
git add web/
git commit -F - <<'EOF'
Add the design tokens and the Key component

Every colour, size, and focus style the calculator uses is defined once
in tokens.css. Dark mode and the high-contrast preference redefine those
tokens and nothing else, so neither theme needs a component to change.

Key renders a real button with an accessible name, which is what lets a
screen reader announce "極形式に切り替え" for a key whose face reads ▸∠.
The minimum touch target is the token, not a number typed into this
component.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 17: Display コンポーネント

**Files:**
- Create: `web/src/ui/Display/Display.tsx`
- Create: `web/src/ui/Display/Display.module.css`
- Test: `web/src/ui/Display/Display.test.tsx`

**Interfaces:**
- Consumes: `DisplayState`（Task 15）
- Produces: `web/src/ui/Display/Display.tsx`: `Display`, `DisplayProps { display: DisplayState }`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/Display/Display.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../../calc";
import { Display } from "./Display";

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return {
    main: "0",
    angle: "Deg",
    form: "Rect",
    pendingOp: null,
    pendingDepth: 0,
    error: null,
    ...overrides,
  };
}

describe("Display", () => {
  it("shows the main value", () => {
    render(<Display display={state({ main: "5 ∠ 53.13010235" })} />);
    expect(screen.getByTestId("display-main")).toHaveTextContent("5 ∠ 53.13010235");
  });

  it("announces changes to a screen reader", () => {
    // 結果は視覚以外でも伝わる必要がある(base-spec §43)。
    render(<Display display={state()} />);
    expect(screen.getByTestId("display-main")).toHaveAttribute("aria-live", "polite");
  });

  it("shows the angle mode", () => {
    render(<Display display={state({ angle: "Deg" })} />);
    expect(screen.getByTestId("display-angle")).toHaveTextContent("DEG");
    render(<Display display={state({ angle: "Rad" })} />);
    expect(screen.getAllByTestId("display-angle")[1]).toHaveTextContent("RAD");
  });

  it("marks the polar display form", () => {
    render(<Display display={state({ form: "Polar" })} />);
    expect(screen.getByTestId("display-form")).toHaveTextContent("∠");
  });

  it("leaves the form indicator empty in rectangular form", () => {
    render(<Display display={state({ form: "Rect" })} />);
    expect(screen.getByTestId("display-form")).toBeEmptyDOMElement();
  });

  it("shows the pending operator and parenthesis depth", () => {
    render(<Display display={state({ pendingOp: "Mul", pendingDepth: 2 })} />);
    expect(screen.getByTestId("display-pending")).toHaveTextContent("((");
    expect(screen.getByTestId("display-pending")).toHaveTextContent("×");
  });

  it("marks an error state", () => {
    render(<Display display={state({ main: "Math ERROR", error: "DivisionByZero" })} />);
    const main = screen.getByTestId("display-main");
    expect(main).toHaveTextContent("Math ERROR");
    expect(main).toHaveAttribute("data-error", "DivisionByZero");
  });

  it("has no error attribute when there is no error", () => {
    render(<Display display={state()} />);
    expect(screen.getByTestId("display-main")).not.toHaveAttribute("data-error");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd web && pnpm test`
Expected: FAIL。`Failed to resolve import "./Display"`。

- [ ] **Step 3: Display を実装する**

`web/src/ui/Display/Display.module.css`:

```css
.display {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--display-bg);
  color: var(--display-fg);
  font-family: var(--display-font);
}

.status {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-height: 1.2em;
  color: var(--display-status-fg);
  font-size: var(--display-size-status);
  letter-spacing: 0.08em;
}

.main {
  overflow-x: auto;
  font-size: var(--display-size-main);
  text-align: right;
  white-space: nowrap;
}

.main[data-error] {
  color: var(--error-fg);
}
```

`web/src/ui/Display/Display.tsx`:

```tsx
import type { BinOpName, DisplayState } from "../../calc";
import styles from "./Display.module.css";

const OP_SYMBOL: Record<BinOpName, string> = {
  Add: "+",
  Sub: "−",
  Mul: "×",
  Div: "÷",
};

export interface DisplayProps {
  display: DisplayState;
}

export function Display({ display }: DisplayProps) {
  const pending = `${"(".repeat(display.pendingDepth)}${
    display.pendingOp ? OP_SYMBOL[display.pendingOp] : ""
  }`;

  return (
    <section className={styles.display}>
      <div className={styles.status}>
        <span data-testid="display-angle">{display.angle === "Deg" ? "DEG" : "RAD"}</span>
        <span data-testid="display-pending">{pending}</span>
        <span data-testid="display-form">{display.form === "Polar" ? "∠" : ""}</span>
      </div>
      <output
        className={styles.main}
        data-testid="display-main"
        // 結果が変わったことを読み上げる。polite なので操作を妨げない。
        aria-live="polite"
        {...(display.error ? { "data-error": display.error } : {})}
      >
        {display.main}
      </output>
    </section>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd web && pnpm test`
Expected: PASS（12 テスト）

Run: `cd web && pnpm typecheck && pnpm lint`
Expected: 出力なし

- [ ] **Step 5: コミット**

```bash
git add web/
git commit -F - <<'EOF'
Add the Display component

The display renders what the engine reports and computes nothing. The
angle mode, the pending operator, the parenthesis depth, and the polar
indicator all come straight from DisplayState, so the screen cannot drift
out of step with the calculator.

The main value is an aria-live region, which is how a result reaches
someone who is not looking at the screen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 18: Keypad と App の配線

**Files:**
- Create: `web/src/ui/Keypad/layout.ts`
- Create: `web/src/ui/Keypad/Keypad.tsx`
- Create: `web/src/ui/Keypad/Keypad.module.css`
- Create: `web/src/App.module.css`
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`（`tokens.css` を読み込む）
- Test: `web/src/ui/Keypad/Keypad.test.tsx`
- Test: `web/tests/e2e/smoke.spec.ts`（打鍵の確認を追加）

**Interfaces:**
- Consumes: `Key`, `KeyVariant`（Task 16）、`Display`（Task 17）、`initCalc`, `KeyToken`, `KEY_TOKENS`, `Step`（Task 15）
- Produces:
  - `web/src/ui/Keypad/layout.ts`: `KeyDef { token, label, ariaLabel, variant }`, `KEYPAD_LAYOUT: KeyDef[]`
  - `web/src/ui/Keypad/Keypad.tsx`: `Keypad`, `KeypadProps { onPress: (token: KeyToken) => void }`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/Keypad/Keypad.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KEY_TOKENS } from "../../calc";
import { Keypad } from "./Keypad";
import { KEYPAD_LAYOUT } from "./layout";

describe("Keypad", () => {
  it("offers every key the core accepts, exactly once", () => {
    // レイアウトから漏れたキーは押しようがない。網羅をテストで固定する。
    const laidOut = KEYPAD_LAYOUT.map((k) => k.token).sort();
    expect(laidOut).toEqual([...KEY_TOKENS].sort());
  });

  it("gives every key an accessible label", () => {
    for (const key of KEYPAD_LAYOUT) {
      expect(key.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("renders one button per key", () => {
    render(<Keypad onPress={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(KEY_TOKENS.length);
  });

  it("reports the token of the key that was pressed", async () => {
    const onPress = vi.fn();
    render(<Keypad onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "虚数単位" }));
    expect(onPress).toHaveBeenCalledExactlyOnceWith("j");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd web && pnpm test`
Expected: FAIL。`Failed to resolve import "./Keypad"`。

- [ ] **Step 3: レイアウトを定義する**

`web/src/ui/Keypad/layout.ts`:

```ts
import type { KeyToken } from "../../calc";
import type { KeyVariant } from "../Key/Key";

export interface KeyDef {
  token: KeyToken;
  /** 画面に出す文字。 */
  label: string;
  /** 読み上げ用の名前。記号キーには必須(base-spec §43)。 */
  ariaLabel: string;
  variant: KeyVariant;
}

/**
 * 5 列 6 行のキー配置。スマートフォン縦持ちを前提とする(base-spec §42)。
 *
 * 既存製品のキー配置を写したものではない。よく使う数字を下段中央に寄せ、
 * 複素数まわり(j と ▸∠)を右列の手前に置いている(base-spec §12)。
 */
export const KEYPAD_LAYOUT: KeyDef[] = [
  { token: "sin", label: "sin", ariaLabel: "サイン", variant: "function" },
  { token: "cos", label: "cos", ariaLabel: "コサイン", variant: "function" },
  { token: "tan", label: "tan", ariaLabel: "タンジェント", variant: "function" },
  { token: "sqrt", label: "√", ariaLabel: "平方根", variant: "function" },
  { token: "sqr", label: "x²", ariaLabel: "2乗", variant: "function" },

  { token: "ac", label: "AC", ariaLabel: "全消去", variant: "danger" },
  { token: "del", label: "DEL", ariaLabel: "1文字消去", variant: "danger" },
  { token: "lparen", label: "(", ariaLabel: "開き括弧", variant: "function" },
  { token: "rparen", label: ")", ariaLabel: "閉じ括弧", variant: "function" },
  { token: "div", label: "÷", ariaLabel: "割る", variant: "operator" },

  { token: "7", label: "7", ariaLabel: "7", variant: "digit" },
  { token: "8", label: "8", ariaLabel: "8", variant: "digit" },
  { token: "9", label: "9", ariaLabel: "9", variant: "digit" },
  { token: "j", label: "j", ariaLabel: "虚数単位", variant: "function" },
  { token: "mul", label: "×", ariaLabel: "掛ける", variant: "operator" },

  { token: "4", label: "4", ariaLabel: "4", variant: "digit" },
  { token: "5", label: "5", ariaLabel: "5", variant: "digit" },
  { token: "6", label: "6", ariaLabel: "6", variant: "digit" },
  { token: "pi", label: "π", ariaLabel: "円周率", variant: "function" },
  { token: "sub", label: "−", ariaLabel: "引く", variant: "operator" },

  { token: "1", label: "1", ariaLabel: "1", variant: "digit" },
  { token: "2", label: "2", ariaLabel: "2", variant: "digit" },
  { token: "3", label: "3", ariaLabel: "3", variant: "digit" },
  { token: "polar_toggle", label: "▸∠", ariaLabel: "極形式と直交形式を切り替え", variant: "function" },
  { token: "add", label: "+", ariaLabel: "足す", variant: "operator" },

  { token: "0", label: "0", ariaLabel: "0", variant: "digit" },
  { token: "dot", label: ".", ariaLabel: "小数点", variant: "digit" },
  { token: "neg", label: "+/−", ariaLabel: "符号を反転", variant: "function" },
  { token: "angle_toggle", label: "DRG", ariaLabel: "角度の単位を切り替え", variant: "function" },
  { token: "eq", label: "=", ariaLabel: "計算する", variant: "operator" },
];
```

- [ ] **Step 4: Keypad を実装する**

`web/src/ui/Keypad/Keypad.module.css`:

```css
.keypad {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--key-gap);
}

.keypad > button {
  aspect-ratio: 1 / 1;
}
```

`web/src/ui/Keypad/Keypad.tsx`:

```tsx
import type { KeyToken } from "../../calc";
import { Key } from "../Key/Key";
import styles from "./Keypad.module.css";
import { KEYPAD_LAYOUT } from "./layout";

export interface KeypadProps {
  onPress: (token: KeyToken) => void;
}

export function Keypad({ onPress }: KeypadProps) {
  return (
    <div className={styles.keypad} role="group" aria-label="電卓キーパッド">
      {KEYPAD_LAYOUT.map((key) => (
        <Key
          key={key.token}
          token={key.token}
          label={key.label}
          ariaLabel={key.ariaLabel}
          variant={key.variant}
          onPress={onPress}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: App を配線する**

`web/src/App.module.css`:

```css
.shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: var(--shell-max-width);
  margin: 0 auto;
  padding: 12px;
  /* iOS のホームインジケータを避ける。 */
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.version {
  margin: 0;
  color: var(--display-status-fg);
  font-size: var(--display-size-status);
  text-align: center;
}
```

`web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { type Calc, initCalc, type KeyToken, type Step } from "./calc";
import styles from "./App.module.css";
import { Display } from "./ui/Display/Display";
import { Keypad } from "./ui/Keypad/Keypad";

export function App() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    let cancelled = false;
    initCalc().then((loaded) => {
      if (cancelled) return;
      setCalc(loaded);
      setStep(loaded.initial());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const press = useCallback(
    (token: KeyToken) => {
      // 状態は不変値なので、直前の状態から次を作るだけでよい。
      setStep((previous) => (calc && previous ? calc.dispatch(previous.state, token) : previous));
    },
    [calc],
  );

  if (!calc || !step) {
    return <p>Loading…</p>;
  }

  return (
    <main className={styles.shell}>
      <Display display={step.display} />
      <Keypad onPress={press} />
      <p className={styles.version} data-testid="core-version">
        calcarc-core {calc.version()}
      </p>
    </main>
  );
}
```

`web/src/main.tsx` の先頭に追記する。

```tsx
import "./ui/tokens.css";
```

- [ ] **Step 6: E2E に打鍵の確認を足す**

`web/tests/e2e/smoke.spec.ts` の末尾に追記する。

```ts
test("a pressed key reaches the calculation core", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "3" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3");
});
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `cd web && pnpm test`
Expected: PASS（16 テスト）

Run: `cd web && pnpm typecheck && pnpm lint && pnpm e2e`
Expected: すべて成功（E2E 3 テスト）

- [ ] **Step 8: コミット**

```bash
git add web/
git commit -F - <<'EOF'
Add the keypad and wire it to the calculation core

A test asserts the layout covers every token the core accepts, exactly
once. A key that exists in the engine but not on the keypad is
unreachable, and that is the kind of gap nobody notices by looking.

App holds the state and hands it back to the core on each press. Because
the state is an immutable value, advancing the calculator is a functional
update and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 19: 物理キーボード入力

**Files:**
- Create: `web/src/ui/useKeyboard.ts`
- Modify: `web/src/App.tsx`
- Test: `web/src/ui/useKeyboard.test.tsx`

**Interfaces:**
- Consumes: `KeyToken`（Task 15）
- Produces: `web/src/ui/useKeyboard.ts`: `useKeyboard(onPress: (token: KeyToken) => void): void`, `KEYBOARD_MAP: Readonly<Record<string, KeyToken>>`

- [ ] **Step 1: 失敗するテストを書く**

`web/src/ui/useKeyboard.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KeyToken } from "../calc";
import { useKeyboard } from "./useKeyboard";

function Harness({ onPress }: { onPress: (token: KeyToken) => void }) {
  useKeyboard(onPress);
  return <div>harness</div>;
}

describe("useKeyboard", () => {
  it("maps digits", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("3");
    expect(onPress).toHaveBeenCalledExactlyOnceWith("3");
  });

  it("maps the arithmetic operators", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("+-*/");
    expect(onPress.mock.calls.flat()).toEqual(["add", "sub", "mul", "div"]);
  });

  it("maps Enter and equals to the same key", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Enter}=");
    expect(onPress.mock.calls.flat()).toEqual(["eq", "eq"]);
  });

  it("maps editing keys", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Backspace}{Escape}");
    expect(onPress.mock.calls.flat()).toEqual(["del", "ac"]);
  });

  it("maps j in either case", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("jJ");
    expect(onPress.mock.calls.flat()).toEqual(["j", "j"]);
  });

  it("ignores unmapped keys", async () => {
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("qz");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("leaves browser shortcuts alone", async () => {
    // Ctrl+R などを電卓が食べてしまわないこと。
    const onPress = vi.fn();
    render(<Harness onPress={onPress} />);
    await userEvent.keyboard("{Control>}3{/Control}");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    const onPress = vi.fn();
    const { unmount } = render(<Harness onPress={onPress} />);
    unmount();
    await userEvent.keyboard("3");
    expect(onPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd web && pnpm test`
Expected: FAIL。`Failed to resolve import "./useKeyboard"`。

- [ ] **Step 3: フックを実装する**

`web/src/ui/useKeyboard.ts`:

```ts
import { useEffect } from "react";
import type { KeyToken } from "../calc";

/**
 * 物理キーボードのキーと calcarc-core のトークンの対応。
 *
 * 画面のボタンと同じトークンに写像するため、engine から見れば
 * どちらの経路で押されたかの区別は存在しない(設計書 §3.4)。
 */
export const KEYBOARD_MAP: Readonly<Record<string, KeyToken>> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  ".": "dot",
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "=": "eq",
  Enter: "eq",
  Backspace: "del",
  Escape: "ac",
  "(": "lparen",
  ")": "rparen",
  j: "j",
  J: "j",
};

/**
 * 物理キーボードからの入力を受け付ける(base-spec §43、§50)。
 */
export function useKeyboard(onPress: (token: KeyToken) => void): void {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      // ブラウザのショートカットを奪わない。
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const token = KEYBOARD_MAP[event.key];
      if (!token) {
        return;
      }
      // "/" のクイック検索や Backspace の戻るを抑える。
      event.preventDefault();
      onPress(token);
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onPress]);
}
```

- [ ] **Step 4: App から呼ぶ**

`web/src/App.tsx` に追記する。`press` の定義の直後に置く。

```tsx
  useKeyboard(press);
```

import を追加する。

```tsx
import { useKeyboard } from "./ui/useKeyboard";
```

`useKeyboard` はフックなので、早期 return（`if (!calc || !step)`）より前に呼ぶこと。`press` は `calc` が null のとき何もしないので、読み込み中に押されても安全である。

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd web && pnpm test`
Expected: PASS（24 テスト）

Run: `cd web && pnpm typecheck && pnpm lint`
Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add web/
git commit -F - <<'EOF'
Add physical keyboard input

Desktop is one of the platforms the calculator has to be usable on, and a
calculator you can only operate by clicking is not usable there.

Keystrokes map to the same tokens the on-screen buttons produce, so the
engine sees no difference between the two routes and there is no second
behaviour to keep in step. Modified keys are left alone so the browser
keeps its own shortcuts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 20: End-to-End テスト

**Files:**
- Create: `web/tests/e2e/vertical-slice.spec.ts`
- Modify: `web/tests/e2e/smoke.spec.ts`（重複を整理）

**Interfaces:**
- Consumes: 完成した UI（Task 15–19）
- Produces: なし（テストのみ）

- [ ] **Step 1: Vertical Slice の E2E を書く**

`web/tests/e2e/vertical-slice.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";

/** 画面のボタンを順に押す。 */
async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

const main = (page: Page) => page.getByTestId("display-main");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
});

test("the headline case: 3 + j4 becomes 5 ∠ 53.13010235", async ({ page }) => {
  await press(page, ["3", "足す", "虚数単位", "4", "計算する"]);
  await expect(main(page)).toHaveText("3+j4");

  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");
});

test("the same calculation from the physical keyboard", async ({ page }) => {
  // デスクトップで使えること(base-spec §50)。
  await page.keyboard.type("3+j4");
  await page.keyboard.press("Enter");
  await expect(main(page)).toHaveText("3+j4");

  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");
});

test("the polar toggle is a display change, not a calculation", async ({ page }) => {
  await press(page, ["3", "足す", "虚数単位", "4", "計算する"]);
  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");

  // 表示は 8 桁に丸められているが、保持している値は 3+j4 のまま。
  await press(page, ["掛ける", "開き括弧", "1", "足す", "虚数単位", "2", "閉じ括弧", "計算する"]);
  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("-5+j10");
});

test("operator precedence follows the algebraic convention", async ({ page }) => {
  await page.keyboard.type("2+3*4=");
  await expect(main(page)).toHaveText("14");
});

test("functions apply to the displayed value immediately", async ({ page }) => {
  await press(page, ["3", "0", "サイン"]);
  await expect(main(page)).toHaveText("0.5");
});

test("the square root of a negative number is imaginary", async ({ page }) => {
  await press(page, ["4", "符号を反転", "平方根"]);
  await expect(main(page)).toHaveText("j2");
});

test("an error is shown and cleared with AC", async ({ page }) => {
  await page.keyboard.type("1/0=");
  await expect(main(page)).toHaveText("Math ERROR");
  await expect(main(page)).toHaveAttribute("data-error", "DivisionByZero");

  await press(page, ["全消去"]);
  await expect(main(page)).toHaveText("0");
  await expect(main(page)).not.toHaveAttribute("data-error");

  await page.keyboard.type("7=");
  await expect(main(page)).toHaveText("7");
});

test("the angle mode is shown and switchable", async ({ page }) => {
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");
});

test("every key is a button with an accessible name", async ({ page }) => {
  // base-spec §43。div にハンドラを付けた実装を弾く。
  const buttons = page.getByRole("group", { name: "電卓キーパッド" }).getByRole("button");
  await expect(buttons).toHaveCount(30);
  for (const button of await buttons.all()) {
    const name = await button.getAttribute("aria-label");
    expect(name?.length ?? 0).toBeGreaterThan(0);
  }
});

test("touch targets are large enough", async ({ page }) => {
  // --touch-target-min は 44px。
  const key = page.getByRole("button", { name: "7", exact: true });
  const box = await key.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 2: smoke.spec.ts の重複を落とす**

`web/tests/e2e/smoke.spec.ts` から `a pressed key reaches the calculation core` を削除する。`vertical-slice.spec.ts` が同じことをより厳密に検証しているため。読み込みとバージョン表示の 2 テストだけ残す。

- [ ] **Step 3: E2E を実行する**

Run: `cd web && pnpm e2e`
Expected: PASS（12 テスト）

`the physical keyboard` のテストが落ちる場合、`page.keyboard.type("3+j4")` が `j` を `Key::J` に写像できているか確認する。`useKeyboard` が `window` に登録しているので、フォーカスが body にあれば届く。

- [ ] **Step 4: 実機に近い条件で目視確認する**

Run: `cd web && pnpm build && pnpm preview`

ブラウザの開発者ツールでスマートフォンの画面サイズ（390×844）にして以下を確認する。

- キーパッドが横スクロールせずに収まる
- `3` `+` `j` `4` `=` `▸∠` で `5 ∠ 53.13010235` が出る
- Tab キーでフォーカスリングが見える
- OS のダークモードを切り替えると配色が追随する

- [ ] **Step 5: コミット**

```bash
git add web/
git commit -F - <<'EOF'
Add the end-to-end tests for the vertical slice

The headline conversion is verified twice, once through the on-screen
buttons and once from the physical keyboard, because those are the two
routes a user actually has and desktop support depends on the second.

One test multiplies after switching to polar form and checks the answer
is exact. That is the observable consequence of the toggle being a
display change: if a rounded angle were feeding forward, the product
would be wrong in the last digits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# フェーズ 6 — CI とドキュメント

## Task 21: CI・README・完了条件の確認

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: 全タスクの成果物
- Produces: なし

- [ ] **Step 1: CI を書く**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rust:
    name: Rust core
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      # Layer 1-4: unit / engine table / proptest / golden
      - run: cargo test --workspace

  wasm:
    name: WASM boundary
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
      - uses: jetli/wasm-pack-action@v0.4.0
      - name: Use the runner's ChromeDriver
        # wasm-pack は既定で自前の ChromeDriver を取りに行くが、それが
        # ランナーの Chrome とバージョン不一致になると起動に失敗する。
        # Task 14 の実装中に実際にこれが起きた（Chrome 135 に対して
        # ChromeDriver 151 が降ってきた）。ランナー同梱の対になっている
        # ものを使わせる。
        run: echo "CHROMEDRIVER=$(which chromedriver)" >> "$GITHUB_ENV"
      - run: wasm-pack build crates/calcarc-wasm --target web --out-dir ../../web/src/wasm
      # Layer 5
      - run: wasm-pack test --headless --chrome crates/calcarc-wasm
      - uses: actions/upload-artifact@v4
        with:
          name: wasm-pkg
          path: web/src/wasm/

  web:
    name: Web build and unit tests
    runs-on: ubuntu-latest
    needs: wasm
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - uses: actions/download-artifact@v4
        with:
          name: wasm-pkg
          path: web/src/wasm/
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      # wasm は artifact から取得済みなので、ビルドだけ行う。
      - run: pnpm exec vite build

  e2e:
    name: End-to-end
    runs-on: ubuntu-latest
    needs: wasm
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - uses: actions/download-artifact@v4
        with:
          name: wasm-pkg
          path: web/src/wasm/
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      # Layer 6
      - run: pnpm exec playwright test
        env:
          PLAYWRIGHT_BUILD_COMMAND: vite build
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: web/playwright-report/

  reference:
    name: Python reference
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          python-version: "3.14"
      - run: uv sync --locked
        working-directory: reference
      - run: uv run ruff check .
        working-directory: reference
      - run: uv run ruff format --check .
        working-directory: reference
      - run: uv run pytest
        working-directory: reference
      - run: uv run python scripts/generate.py
        working-directory: reference
      - name: The committed golden files must match a fresh generation
        run: git diff --exit-code testdata/
```

E2E ジョブでは `playwright.config.ts` の `webServer.command` が `pnpm build && pnpm preview` になっており、`pnpm build` が `pnpm wasm`（wasm-pack）を呼んでしまう。artifact から取得済みなので不要かつ Rust が入っていない。`playwright.config.ts` の `webServer.command` を次に変える。

```ts
  webServer: {
    // wasm は事前に用意されている前提。ローカルでは pnpm wasm を先に実行する。
    command: "pnpm exec vite build && pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
```

これに伴い、ローカルで E2E を回すときは `pnpm wasm && pnpm e2e` の順で実行する。`package.json` の `e2e` スクリプトを `"e2e": "pnpm wasm && playwright test"` に変更しておくと手順が減る。CI では `playwright test` を直接呼ぶので `pnpm wasm` は走らない。

CI に置いた `env: PLAYWRIGHT_BUILD_COMMAND` は使っていないので削除する。

- [ ] **Step 2: README を書く**

`README.md`:

```markdown
# CalcArc

ブラウザで動く計算ツール群。計算は端末内で完結し、サーバへ送信しない。

計算コアは Rust で実装し、WebAssembly としてブラウザから呼び出す。計算結果の
正しさは Rust のテストだけに頼らず、Python による独立した参照実装と突き合わせて
検証する。

## 現状

最初の Vertical Slice を実装中。Scientific Calculator の複素数と極座標変換が
動く段階にある。Data Scale Calculator と Loan Calculator は未着手。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `crates/calcarc-core` | 計算コア。WASM と UI に依存しない |
| `crates/calcarc-wasm` | WASM adapter。計算ロジックを持たない |
| `web` | React + Vite の UI |
| `reference` | Python による参照実装。期待値を生成する |
| `testdata` | 参照実装が生成した期待値 |
| `docs` | 仕様と数値方針 |

## Numerical Policy

数値の扱いは [docs/numerical-policy.md](docs/numerical-policy.md) に定める。
要点は次のとおり。

- すべての値を複素数として保持する。実数は虚部 0 の複素数である。
- 表示は有効数字 10 桁、丸めは round-half-to-even。
- 表示のための丸めは保持している値に書き戻さない。極形式への切り替えは
  表示の変更であって計算ではないため、丸めた値が次の計算に入り込まない。
- 計算コアは panic しない。すべてのエラーは `Result` を通り、UI には
  戻り値として届く。

## 開発

必要なもの: Rust (stable)、wasm-pack、Node.js + pnpm、uv。

```bash
# 計算コアのテスト
cargo test --workspace

# WASM 境界のテスト
wasm-pack test --headless --chrome crates/calcarc-wasm

# Web
cd web && pnpm install && pnpm dev

# 参照実装と期待値の再生成
cd reference && uv sync && uv run pytest
cd reference && uv run python scripts/generate.py
```

`crates/calcarc-core` の数値を変更したときは期待値の再生成が必要になる。
再生成せずに `testdata/` を手で書き換えないこと。

## ライセンス

Apache License 2.0。[LICENSE](LICENSE) を参照。
```

- [ ] **Step 3: CONTRIBUTING を書く**

`CONTRIBUTING.md`:

```markdown
# Contributing

## 原則

このプロジェクトは UI の多機能化よりも次を優先する。

1. 計算仕様が明確であること
2. 数値表現と丸め規則が明確であること
3. 計算コアが UI から独立していること
4. Python による独立検証が可能であること

## 守ってほしいこと

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に
  計算を書かない。
- **`calcarc-core` で panic しない。** `unwrap()` と `expect()` を書かない。
  エラーは `CalcError` を返す。
- **`web/src/calc/` に React を import しない。** ここは UI Framework から
  独立している必要がある。
- **許容誤差をテストコードに書かない。** `testdata/*.json` の `tolerance`
  から読む。
- **参照実装を Rust の移植にしない。** 同じアルゴリズムを両方に書くと、
  同じバグが両方に入って検証の意味がなくなる。別のライブラリや別の手法を使う。

## 電卓の挙動を変えるとき

`crates/calcarc-core/tests/engine_table.rs` が挙動の仕様書である。
キー列と期待される表示の対応を先に変えてから実装を直すこと。

## 数値を変えるとき

`reference/scripts/generate.py` を実行して `testdata/` を再生成し、
差分を確認してからコミットする。CI が再生成の差分を検査する。
```

- [ ] **Step 4: CI をローカルで再現できる範囲で確認する**

Run: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: すべて成功

Run: `cd reference && uv run ruff check . && uv run ruff format --check . && uv run pytest`
Expected: すべて成功

Run: `cd reference && uv run python scripts/generate.py && cd .. && git diff --exit-code testdata/`
Expected: 差分なし、終了コード 0

Run: `cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm wasm && pnpm e2e`
Expected: すべて成功

- [ ] **Step 5: 完了条件を 1 つずつ確認する**

設計書 §11 の 9 項目を確認し、満たしていないものがあれば対応する。

1. スマートフォン相当の画面で `3` `+` `j` `4` `=` `▸∠` が `5 ∠ 53.13010235` を表示する → `vertical-slice.spec.ts`
2. Rust → WASM → TypeScript → React を経由している → `web/src/calc/index.ts` が `init()` 経由でのみ計算する
3. 物理キーボードから同じ計算ができる → `vertical-slice.spec.ts`
4. すべてのキーが `<button>` で `aria-label` を持つ → `vertical-slice.spec.ts`
5. Layer 1–6 が CI で通る → `ci.yml` の 5 ジョブ
6. `testdata/*.json` が Python 生成で Rust が検証している → `golden.rs` と `reference` ジョブ
7. `docs/numerical-policy.md` がある → Task 5
8. `README.md` に概要と Numerical Policy への導線がある → Step 2
9. `LICENSE` に Apache-2.0 → Task 1

- [ ] **Step 6: コミット**

```bash
git add .github/ README.md CONTRIBUTING.md web/playwright.config.ts web/package.json
git commit -F - <<'EOF'
Add CI, README, and contributor guidance

Five jobs cover the six test layers. The wasm job builds the module once
and passes it to the web and e2e jobs as an artifact, so neither needs a
Rust toolchain and neither rebuilds it.

The reference job regenerates the golden files and fails if the result
differs from what is committed. Forgetting to regenerate after changing a
numeric rule is the failure mode that would otherwise let the expectations
drift away from the implementation silently.

Python is needed only by that one job, so contributors working on the
Rust side alone do not need uv.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証手段 |
|---|---|---|
| 1 | workspace, `Value`, `CalcError` | `cargo test` |
| 2 | 複素数の四則演算 | `cargo test` |
| 3 | Rect ⇄ Polar | `cargo test` + proptest |
| 4 | 角度モード、表示フォーマット | `cargo test` |
| 5 | 単項関数、`numerical-policy.md` | `cargo test` |
| 6 | Key, EngineState, 数値入力, DisplayState | `engine_table.rs` |
| 7 | 二項演算と優先順位 | `engine_table.rs` |
| 8 | 括弧 | `engine_table.rs` |
| 9 | 後置関数、π、角度切替 | `engine_table.rs` |
| 10 | 極形式の表示切替 | `engine_table.rs`（目標表示） |
| 11 | エラー挙動、無 panic | proptest |
| 12 | Python 参照実装、golden 生成 | `pytest` |
| 13 | golden 検証 | `cargo test --test golden` |
| 14 | WASM 境界 | `wasm-pack test` |
| 15 | web 骨格、計算ラッパー | Playwright smoke |
| 16 | デザイントークン、Key | `vitest` |
| 17 | Display | `vitest` |
| 18 | Keypad、App 配線 | `vitest` + Playwright |
| 19 | 物理キーボード入力 | `vitest` |
| 20 | E2E | Playwright |
| 21 | CI、README、CONTRIBUTING | CI 5 ジョブ |
