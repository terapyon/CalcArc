# API 整理 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 命名と API 形状の整理。挙動は 1 ビットも変えずに、名前の嘘を直し、`Value` に演算を集約し、`complex/` をほどき、言語間トークン表の一致を機械検査する。

**Architecture:** spec は docs/superpowers/specs/2026-08-11-api-cleanup-design.md。決定済みの変更を 6 タスクに分ける: ドキュメント → 命名 → 再エクスポート → メソッド集約 → 平坦化 → 一致テスト＋最終スイープ。前のタスクが後のタスクの churn を減らす順序である（import を玄関経由にしてからモジュールを動かせば、移動時に import が壊れない）。

**Tech Stack:** Rust（calcarc-core / calcarc-wasm）、TypeScript（web）、wasm-pack、vitest、Playwright。

## Global Constraints

- **挙動は 1 ビットも変えない。** serde のフィールド名（`re`/`im`）、WASM 境界の関数名とトークン、表示文字列、計算結果はすべて不変（spec §0）。
- **既存テストの変更は「リネームへの追従」のみ。** 新規追加は Task 6 の一致テストに限る。期待値・キー列・許容誤差は 1 つも変えない（spec §3-1）。
- **`calcarc-core` は panic しない。** `unreachable!()` も panic なので書かない（CLAUDE.md）。
- **許容誤差をテストコードに書かない**（CLAUDE.md）。
- **コミット前に `cargo fmt` を実行する**（CLAUDE.md。`--check` は直してくれない）。
- **`git push` と PR 作成は行わない**（CLAUDE.md）。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。
- core を変えた後に web のテストを回すときは、先に `cd web && pnpm wasm` で `web/src/wasm/` を作り直す。古い wasm に対する緑は「間違った理由で通るテスト」である。
- ベースライン: Rust 124 / wasm 6 / vitest 31 / e2e 14。Task 6 完了時は Rust 125。

---

### Task 1: `docs/api-style.md` の新設と CONTRIBUTING からのリンク

**Files:**
- Create: `docs/api-style.md`
- Modify: `CONTRIBUTING.md`（「守ってほしいこと」の節の直後にリンクを足す）

**Interfaces:**
- Consumes: なし
- Produces: 後続タスクの判断基準文書。#13 はこのファイルの「import 方針」の項で決着する。

- [ ] **Step 1: `docs/api-style.md` を作る**

内容は次の全文（spec §4 と同一）。体裁の調整のみ可:

```markdown
# API スタイルガイド

命名と API 形状の判断基準。issue 単位で議論を再燃させないためにここに集約する。

## 原則

**std の慣習は「名前の嘘」を直すために採り、ドメイン語彙を消すためには採らない。**

- 名前の嘘 = 名前が std の契約や意味を偽っているもの。直す。
  例: Option を返さない `pop()`、述語に見える関門 `finite()`、
  `f64::to_radians` と同名で別動作のメソッド。
- ドメイン語彙 = 設計書・base-spec が定義した概念を指す名前。守る。
  例: `token`（境界トークン）、`sqr`（x² キー）、`CalcError`、
  `to_polar`/`from_polar`、`Buffer::text`（打鍵エコー）。

## 個別規約

- **Error 型**: クレート接頭辞付き（`CalcError`/`CalcResult`）を維持する。
  無修飾 import でも曖昧にならないことを優先する。
- **From/Into**: 「意味を持たない機械的変換」にのみ実装する。意味のある
  操作は名前付き関数にする（`to_polar` は From にしない）。
- **Display trait**: 値に正規の文字列表現が 1 つあるときだけ実装する。
  UI エコーや文脈依存の文字列化は名前付きメソッド（`text()` など）。
- **import 方針**: flat import（`format_real` を直接 use）を維持する。
  モジュール修飾呼び出しへの寄せ替え（`format::real()`）はしない。
- **述語**: `is_` / `has_` で始める。検査して返す関門は動詞で始める。
- **スタッター**: `module::module()` の形を避ける（関数名の変更で解消する。
  From 化は上の規約により不採用）。

## 運用

迷ったらこの基準で判断し、判断したらこのファイルに追記する。
基準で説明できない変更提案は「好み」であり、現状維持とする。
```

- [ ] **Step 2: CONTRIBUTING.md からリンクする**

「守ってほしいこと」の節の末尾に追記:

```markdown
- **命名と API 形状の判断は [docs/api-style.md](docs/api-style.md) に従う。**
  基準で説明できない変更提案は「好み」であり、現状維持とする。
```

- [ ] **Step 3: 確認してコミット**

Run: `cargo test --workspace`（ドキュメントのみの変更だが、壊れていないことの確認は安い）
Expected: 124 件 PASS

```bash
git add docs/api-style.md CONTRIBUTING.md
git commit -F - <<'EOF'
Write down the naming criterion so issues stop relitigating it

The rule: std conventions are adopted to fix a name that lies, never to
erase domain vocabulary. Decisions that the criterion cannot explain are
preferences, and preferences keep the status quo. This settles #13 (flat
imports stay) by recording it, not by changing code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: 名前の嘘を直す（#9 #11 #12 #16-4 と到達しない腕）

**Files:**
- Modify: `crates/calcarc-core/src/engine/state.rs`（`Buffer::pop` → `backspace`）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（呼び出し 1 箇所、`display::display` の呼び出し、`Key::Ac` 腕のコメント、`pub use`）
- Modify: `crates/calcarc-core/src/numeric/angle.rs`（`to_radians`/`from_radians` の改名）
- Modify: `crates/calcarc-core/src/numeric/format.rs:75,92`（`from_radians` → `angle_of`）
- Modify: `crates/calcarc-core/src/scientific/mod.rs:49`（`to_radians` → `radians_of`）
- Modify: `crates/calcarc-core/src/engine/display.rs`（`display` → `render`）
- Modify: `crates/calcarc-core/src/lib.rs`（`TEST_EPSILON` の可視性、`ROUNDTRIP_EPSILON` の rustdoc）
- Modify: `crates/calcarc-wasm/src/lib.rs:37`（`display` → `render`）
- Test 追従: `tests/engine_table.rs`、`tests/engine_robustness.rs`（`display::display` → `render` の import と呼び出し）

**Interfaces:**
- Consumes: なし
- Produces:
  - `Buffer::backspace(&mut self) -> Backspace`、`pub enum Backspace { Removed, Exhausted }`（state.rs）
  - `AngleMode::radians_of(self, v: f64) -> f64`、`AngleMode::angle_of(self, rad: f64) -> f64`
  - `engine::display::render(state: &EngineState) -> DisplayState`、`engine::render` に再エクスポート
  - `TEST_EPSILON` は `pub(crate)` になる（Task 3 以降の外部利用は不可）

名前は issue の一次提案を採用する。#9 は案 B（呼び出し側で真偽の意味が読める）、
#11 は提案どおり `radians_of`/`angle_of`（`f64::to_radians` と読み違えず、`from_*` を
Self 構築以外に使わない、という 2 要件を満たす）、#12 は代案の `render`
（モジュールはそのまま、関数名を動作にする。From 化は api-style.md の規約で不採用）。

- [ ] **Step 1: `Buffer::pop` → `backspace`（#9）**

`state.rs` の `pop` を置き換える。doc コメントは現行のものを引き継ぐ:

```rust
/// `backspace` が何を消したか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backspace {
    /// 1 文字消した。バッファはまだ生きている。
    Removed,
    /// 消すものが尽きた。呼び出し側はバッファごと破棄してよい。
    Exhausted,
}

/// 末尾 1 文字を削る。
///
/// 虚数入力では数字が尽きても j マーカーを残す。ここで一緒に捨てると
/// `3 + j4 DEL 5 =` が 3+j5 ではなく 3+5 になり、何を計算しているかが
/// 黙って変わる。j を消すにはもう一度 DEL を押す。
pub fn backspace(&mut self) -> Backspace {
    if self.digits.pop().is_some() {
        if self.digits.is_empty() && !self.imaginary {
            return Backspace::Exhausted;
        }
        return Backspace::Removed;
    }
    // 数字はもう無い。残っているのは j だけなので、これで破棄してよい。
    Backspace::Exhausted
}
```

`engine/mod.rs:173` の呼び出しを追従（`delete_one` 内）:

```rust
if let Some(buffer) = &mut state.buffer {
    // 1 段目と 2 段目は Buffer::backspace が担う。
    if buffer.backspace() == Backspace::Exhausted {
        state.buffer = None;
    }
    return;
}
```

`use state::{...}` に `Backspace` を足す。

- [ ] **Step 2: `AngleMode` の改名（#11）**

`angle.rs`: `to_radians` → `radians_of`、`from_radians` → `angle_of`。doc コメントは
「このモードでの数値をラジアンに直す」「ラジアンをこのモードでの数値に直す」のまま。
角度モジュール内のテスト 4 件の呼び出しも追従する。

呼び出し追従: `scientific/mod.rs:49`（2 箇所）、`numeric/format.rs:75,92`。

- [ ] **Step 3: `display::display` → `render`（#12）**

`display.rs:28` の関数名を `render` に。`engine/mod.rs` の回避コメント（1-7 行目の
`// 関数 display は再エクスポートしない…`）を消して:

```rust
pub use display::{DisplayState, render};
```

呼び出し追従: `engine/mod.rs:77`（`display::display(&next)` → `render(&next)`）、
`crates/calcarc-wasm/src/lib.rs:37`、`display.rs` 内テスト、`tests/engine_table.rs`、
`tests/engine_robustness.rs`（import と全呼び出し。機械置換でよい）。

- [ ] **Step 4: `TEST_EPSILON` の可視性（#16-4）**

`lib.rs`: `pub const TEST_EPSILON` → `pub(crate) const TEST_EPSILON`。
統合テスト（`tests/`）は使っていないことを確認済み（`roundtrip.rs` が使うのは
`ROUNDTRIP_EPSILON` のみ）。`ROUNDTRIP_EPSILON` の rustdoc の先頭に 1 行足す:

```rust
/// rect → polar → rect の往復で許す相対誤差。
///
/// 統合テスト（`tests/roundtrip.rs`）が使うための公開定数である。
/// （既存の説明は以下そのまま）
```

- [ ] **Step 5: 到達しない腕にコメント（台帳の残件）**

`engine/mod.rs:63` の `| Key::Ac => false,` の行に注記を付ける。腕は消せない
（match の網羅性）し、`unreachable!()` は panic なので書けない:

```rust
// Key::Ac はここに到達しない（reduce の冒頭で先に処理される）が、
// match の網羅性のために腕は残す。値はどちらでも同じ。
| Key::Ac => false,
```

- [ ] **Step 6: 全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 124 件 PASS。**件数が 124 のままであること**（増減はどちらも事故）。

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 6 件 PASS（lib.rs を触ったため必須）

Run: `cd web && pnpm wasm && pnpm test && pnpm e2e`
Expected: 31 + 14 件 PASS

- [ ] **Step 7: コミット**

```bash
git add crates/ 
git commit -F - <<'EOF'
Rename what lies about std contracts, keep what speaks the domain

pop promised an Option and delivered a bool that meant something else
entirely; it is now backspace, returning Removed or Exhausted so the one
caller reads what it acts on. AngleMode::to_radians shadowed
f64::to_radians in its own body with a different meaning; the pair is now
radians_of / angle_of. display::display stuttered enough that re-export
needed an apology comment; it is now render, and the comment is gone.
TEST_EPSILON drops to pub(crate) — nothing outside the crate reads it,
and ROUNDTRIP_EPSILON now says why it stays public.

Applies docs/api-style.md: every rename fixes a name-lie; no domain word
was harmed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: 再エクスポートを広げ、import を玄関経由にする（#8、#17 段階 1）

**Files:**
- Modify: `crates/calcarc-core/src/lib.rs`（再エクスポート追加）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`pub use` 追加、自身の import）
- Modify: 内部 import 全部: `engine/state.rs`、`engine/display.rs`、`scientific/mod.rs`、`complex/arith.rs`、`complex/polar.rs`、`numeric/format.rs`
- Modify: `crates/calcarc-wasm/src/lib.rs`（深いパスを玄関に）
- Test 追従: `tests/engine_table.rs`、`tests/engine_robustness.rs`、`tests/golden.rs`、`tests/roundtrip.rs`

**Interfaces:**
- Consumes: Task 2 の `render`
- Produces: crate root に `pub use engine::{DisplayState, EngineState, Key, reduce, render};` が
  加わる。以後のタスクとテストは `use calcarc_core::{reduce, render, EngineState, Key, DisplayState, Value, CalcError, CalcResult, AngleMode};` の形で書く。

- [ ] **Step 1: `engine/mod.rs` の玄関を揃える**

```rust
pub use display::{DisplayState, render};
pub use key::Key;
pub use state::EngineState;
```

（`Buffer`/`OpToken`/`BinOp`/`DisplayForm` は玄関に出さない。テストが使う分は
`engine::state::` 経由のままでよい——内部構造を知る必要があるのは robustness テスト
だけで、それは仕様上の観測点である。）

- [ ] **Step 2: `lib.rs` の玄関を揃える**

既存 3 行の下に:

```rust
pub use engine::{DisplayState, EngineState, Key, reduce, render};
```

- [ ] **Step 3: 内部 import を玄関経由に付け替える**

root 再エクスポートがあるものだけを付け替える。例:

```rust
// state.rs: 変更前
use crate::complex::value::Value;
use crate::error::{CalcError, CalcResult};
use crate::numeric::angle::AngleMode;
// 変更後
use crate::{AngleMode, CalcError, CalcResult, Value};
```

同様に `engine/mod.rs`、`engine/display.rs`、`scientific/mod.rs`、`complex/arith.rs`、
`complex/polar.rs`、`numeric/format.rs`。**root に無いもの（`complex::arith` の関数、
`complex::polar`、`numeric::format` の関数）は今のパスのまま**（arith は Task 4 で、
polar のパスは Task 5 で変わる。format は #13 の決定どおり flat のまま）。

- [ ] **Step 4: 利用側を玄関経由に付け替える**

`calcarc-wasm/src/lib.rs`:

```rust
// 変更前
use calcarc_core::engine::display::{DisplayState, render};
use calcarc_core::engine::key::Key;
use calcarc_core::engine::reduce;
use calcarc_core::engine::state::EngineState;
// 変更後
use calcarc_core::{DisplayState, EngineState, Key, reduce, render};
```

`tests/engine_table.rs`、`tests/engine_robustness.rs`、`tests/golden.rs`、
`tests/roundtrip.rs` も同様に、root に出たものは root から import する。
robustness テストが使う `engine::state::{Buffer, OpToken, ...}` はそのまま。

- [ ] **Step 5: 全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 124 件 PASS

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 6 件 PASS

- [ ] **Step 6: コミット**

```bash
git add crates/
git commit -F - <<'EOF'
Let the crate root be the doorway it claims to be

Consumers needed reduce, Key, EngineState and DisplayState, and the root
exported none of them, so every caller memorised the internal module
tree. Export them at the root and route the internal imports through it
too, so when the modules move next, nothing that imports them notices.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: 四則を `Value` に集約する（#17 段階 2、#10 の後始末）

**Files:**
- Modify: `crates/calcarc-core/src/complex/value.rs`（演算を吸収）
- Delete: `crates/calcarc-core/src/complex/arith.rs`
- Modify: `crates/calcarc-core/src/complex/mod.rs`（`pub mod arith;` を消す）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`apply_binop`）
- Modify: `crates/calcarc-core/src/scientific/mod.rs`（`finite`/`mul`/`div` の呼び出し）

**Interfaces:**
- Consumes: Task 3 の import 形
- Produces:
  - `Value::checked_add(self, rhs: Value) -> CalcResult<Value>`（sub/mul/div も同形）
  - `Value::checked_sqr(self) -> CalcResult<Value>` は作らない（`scientific::sqr` は
    `v.checked_mul(v)` を呼ぶだけになる）
  - `pub(crate) fn finalize(self) -> CalcResult<Value>`（旧 `finite`。scientific が
    構成した値の関門として使い続けるため pub(crate)。クレート外には出さない）

- [ ] **Step 1: `value.rs` に演算を移す**

`arith.rs` の本体を `impl Value` に写す。**数式は 1 文字も変えない**（Smith 法の
分岐、`without_negative_zero`、DivisionByZero の判定順を含む）:

```rust
impl Value {
    /// 非有限な結果を Overflow として弾き、-0.0 を均す関門。
    ///
    /// f64 の演算は溢れても panic せず inf / NaN を返すため、
    /// 表示に到達する前にここで捕まえる（base-spec §25、§27）。
    /// atan2 は零の符号で ±π を返し分けるため、-0.0 を残さない。
    pub(crate) fn finalize(self) -> CalcResult<Value> {
        if self.re.is_finite() && self.im.is_finite() {
            Ok(Value::new(
                without_negative_zero(self.re),
                without_negative_zero(self.im),
            ))
        } else {
            Err(CalcError::Overflow)
        }
    }

    pub fn checked_add(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re + rhs.re, self.im + rhs.im).finalize()
    }

    pub fn checked_sub(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re - rhs.re, self.im - rhs.im).finalize()
    }

    pub fn checked_mul(self, rhs: Value) -> CalcResult<Value> {
        Value::new(
            self.re * rhs.re - self.im * rhs.im,
            self.re * rhs.im + self.im * rhs.re,
        )
        .finalize()
    }

    /// 複素数の除算。
    ///
    /// （arith.rs にある Smith 法の doc コメントをそのまま移す）
    pub fn checked_div(self, rhs: Value) -> CalcResult<Value> {
        if rhs.re == 0.0 && rhs.im == 0.0 {
            return Err(CalcError::DivisionByZero);
        }
        if rhs.re.abs() >= rhs.im.abs() {
            let t = rhs.im / rhs.re;
            let d = rhs.re + rhs.im * t;
            Value::new((self.re + self.im * t) / d, (self.im - self.re * t) / d).finalize()
        } else {
            let t = rhs.re / rhs.im;
            let d = rhs.re * t + rhs.im;
            Value::new((self.re * t + self.im) / d, (self.im * t - self.re) / d).finalize()
        }
    }
}

/// -0.0 を +0.0 に均す。それ以外はそのまま返す。
fn without_negative_zero(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { x }
}
```

`value.rs` の先頭に `use crate::{CalcError, CalcResult};` を足す（移した本体が使う）。

`arith.rs` のテスト 12 件を `value.rs` の `mod tests` に移し、呼び出しをメソッド形に
追従（`add(a, b)` → `a.checked_add(b)`、`finite(v)` → `v.finalize()`）。
**アサーションの期待値は一切変えない。** 移し終えたら `arith.rs` を削除し、
`complex/mod.rs` から `pub mod arith;` を消す。

**フィールドの可視性について（spec §1-2 の「絞れるところまで」の結論）:**
`Value.re`/`im`、`Polar.r`/`theta_rad`、`EngineState`・`Buffer` の各フィールドは
**絞れない**。統合テスト（`tests/roundtrip.rs` の `back.re`、`tests/golden.rs`、
`engine_robustness.rs` の不変条件）がクレートの外からフィールドを直接読んでおり、
それらはテストの観測点そのものである。アクセサを足して回る変更は安全性を
1 つも足さずに churn だけ増やすので、spec の「深追いしない」に従い #6 本体に
委ねる。この結論を実装報告に書き残すこと（絞り忘れではなく判断である）。

- [ ] **Step 2: 呼び出し側を追従する**

`engine/mod.rs`（`use crate::complex::arith::...` を消す）:

```rust
fn apply_binop(op: BinOp, lhs: Value, rhs: Value) -> CalcResult<Value> {
    match op {
        BinOp::Add => lhs.checked_add(rhs),
        BinOp::Sub => lhs.checked_sub(rhs),
        BinOp::Mul => lhs.checked_mul(rhs),
        BinOp::Div => lhs.checked_div(rhs),
    }
}
```

`scientific/mod.rs`（`use crate::complex::arith::{div, finite, mul};` を消す）:
- `finite(Value::real(...))` → `Value::real(...).finalize()`（sqrt の 3 箇所）
- `finite(Value::new(...))` → `Value::new(...).finalize()`（sqrt/sin/cos）
- `sqr`: `mul(v, v)` → `v.checked_mul(v)`
- `tan`: `div(sin(...)?, cos(...)?)` → `sin(v, mode)?.checked_div(cos(v, mode)?)`

- [ ] **Step 3: 全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 124 件 PASS。golden（2 件）が通ることが「数式を 1 文字も変えていない」ことの
言語間検証になる。

- [ ] **Step 4: コミット**

```bash
git add crates/
git commit -F - <<'EOF'
Give Value its own arithmetic, and make the gate private

add(a, b) lived in a module that existed only because the type could not
hold its operations; the split forced pub fields and a pub finite() that
looked like a predicate but was a gate (#10). The four operations are now
checked_* methods on Value, the gate is a crate-private finalize, and the
Smith-method division moved verbatim — golden agrees the maths did not
change.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `complex/` をほどく（#17 段階 3）

**Files:**
- Move: `crates/calcarc-core/src/complex/value.rs` → `crates/calcarc-core/src/value.rs`
- Move: `crates/calcarc-core/src/complex/polar.rs` → `crates/calcarc-core/src/polar.rs`
- Delete: `crates/calcarc-core/src/complex/mod.rs`（残っているのは `pub mod` 2 行だけのはず）
- Modify: `crates/calcarc-core/src/lib.rs`（`pub mod complex;` → `pub mod polar; pub mod value;`、`pub use value::Value;`）
- Modify: `crates/calcarc-core/src/polar.rs`（`Value::to_polar` メソッド化）
- Modify: `crates/calcarc-core/src/scientific/mod.rs`（`to_polar(v)` → `v.to_polar()`）
- Test 追従: `tests/roundtrip.rs`、`tests/golden.rs`（`complex::polar` → `polar`、`to_polar` のメソッド形）

**Interfaces:**
- Consumes: Task 4 で arith が消えていること
- Produces:
  - パス: `calcarc_core::value`、`calcarc_core::polar`（`complex::` は消滅）
  - `Value::to_polar(self) -> Polar`（メソッド。free 関数 `to_polar` は削除）
  - `polar::from_polar(p: Polar) -> Value`（named のまま。From にはしない——api-style.md）

- [ ] **Step 1: ファイルを動かす**

```bash
git mv crates/calcarc-core/src/complex/value.rs crates/calcarc-core/src/value.rs
git mv crates/calcarc-core/src/complex/polar.rs crates/calcarc-core/src/polar.rs
git rm crates/calcarc-core/src/complex/mod.rs
```

`lib.rs`:

```rust
pub mod engine;
pub mod error;
pub mod numeric;
pub mod polar;
pub mod scientific;
pub mod value;

pub use error::{CalcError, CalcResult};
pub use numeric::angle::AngleMode;
pub use value::Value;
// engine の行は Task 3 のまま
```

- [ ] **Step 2: `to_polar` をメソッドにする**

`polar.rs` で free 関数 `to_polar` を `impl Value` に置き換える（`from_polar` は
named のまま）:

```rust
impl Value {
    /// 直交形式から極形式へ。
    ///
    /// atan2 を使うので四象限が正しく区別される（base-spec §33）。
    pub fn to_polar(self) -> Polar {
        Polar {
            r: self.re.hypot(self.im),
            theta_rad: self.im.atan2(self.re),
        }
    }
}
```

追従: `scientific/mod.rs`（`use crate::complex::polar::to_polar;` を消し、
`let p = to_polar(v);` → `let p = v.to_polar();`）、`polar.rs` 内テスト
（`to_polar(Value::new(...))` → `Value::new(...).to_polar()`）、
`tests/roundtrip.rs`（`use calcarc_core::polar::from_polar;` と
`from_polar(v.to_polar())`）、`tests/golden.rs`（同様に追従）。

- [ ] **Step 3: 全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 124 件 PASS

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 6 件 PASS（core の公開面が動いたので確認する）

- [ ] **Step 4: コミット**

```bash
git add crates/
git commit -F - <<'EOF'
Flatten complex/ now that the type carries its own operations

The directory existed to hold a type, its operations, and its polar
twin — a split by kind, not by subject. With the operations living on
Value, what remains is two modules that stand on their own: value and
polar. to_polar becomes a method for the rustdoc trail; from_polar stays
a named function, because the conversion means something and From would
erase the name that says it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: 言語間トークン表の一致テストと最終スイープ

**Files:**
- Create: `crates/calcarc-wasm/tests/token_parity.rs`
- Modify: `docs/superpowers/specs/2026-08-11-api-cleanup-design.md`（§1-7 の実施場所の文言）

**Interfaces:**
- Consumes: `calcarc_core::Key`（`Key::ALL`、`Key::token()`）
- Produces: `cargo test --workspace` で走る一致テスト 1 件（Rust 125 件目）

spec §1-7 は「wasm テストか E2E で」としていたが、実装はホストで走る native テスト
（`include_str!` で TS 側の実ファイルを読み込む）にする。ブラウザ不要で
`cargo test --workspace` に入り、TS 側のファイル移動はコンパイルエラーとして
即座に露見する——wasm テストにも E2E にもない性質である。spec の当該文言を
これに合わせて直す（実施場所の変更であり、要求そのものは変わらない）。

- [ ] **Step 1: 失敗するテストを書く（まず抽出の正しさから）**

`crates/calcarc-wasm/tests/token_parity.rs`:

```rust
//! KEY_TOKENS（TypeScript）と Key::ALL（Rust）の一致検査。
//!
//! 同じ 30 トークンが 2 言語で二重管理されている。未知トークンは
//! WASM 境界で黙って no-op になる設計なので、ずれてもどのテストも
//! 落ちずにキーが 1 つ死ぬ。ここで機械的に突き合わせる。
//!
//! wasm でも E2E でもなくホストの cargo test なのは意図的である。
//! include_str! は TS 側のファイル移動をコンパイルエラーに変える。

use calcarc_core::Key;

/// types.ts から KEY_TOKENS の文字列要素を抜き出す。
///
/// TS のパースではなく「`KEY_TOKENS = [` と次の `]` のあいだの
/// 引用符内」という構造依存の抽出。ファイルの形が変わったら
/// このテスト自体が落ちて知らせる。
fn tokens_in_types_ts() -> Vec<String> {
    let src = include_str!("../../../web/src/calc/types.ts");
    let after = src
        .split("KEY_TOKENS = [")
        .nth(1)
        .expect("types.ts に KEY_TOKENS の配列リテラルが見つからない");
    let body = after
        .split(']')
        .next()
        .expect("KEY_TOKENS の配列が閉じていない");
    body.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

#[test]
fn key_tokens_match_between_typescript_and_rust() {
    let ts = tokens_in_types_ts();
    let rust: Vec<String> = Key::ALL.iter().map(|k| k.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/calc/types.ts の KEY_TOKENS と Key::ALL の token() が食い違っている"
    );
}
```

- [ ] **Step 2: 実行して通ることを確認する**

Run: `cargo test -p calcarc-wasm --test token_parity`
Expected: PASS（現状は一致している）

- [ ] **Step 3: 赤くなることを確認する（完了条件 4）**

このブランチの流儀: 検査は壊して赤を見てから信じる。

1. `web/src/calc/types.ts` の `"pi",` を `"pie",` に変えて実行。
   Expected: FAIL（食い違いのメッセージに pie と pi の差が出る）
2. 戻して、今度は Rust 側 `key.rs` の `token()` で `"pi"` を返す行を `"pj"` に変えて実行。
   Expected: FAIL
3. 両方戻して PASS を確認。**この往復の出力を報告に貼ること。**

- [ ] **Step 4: spec の文言を直す**

`docs/superpowers/specs/2026-08-11-api-cleanup-design.md` §1-7 の
「wasm テストか E2E で、両者の集合一致を機械検査する」を
「ホストで走る native テスト（`include_str!` で TS 側の実リストを読み込む）で
両者の一致を機械検査する。ブラウザ不要で `cargo test --workspace` に入り、
TS 側のファイル移動はコンパイルエラーとして露見する」に置き換える。

- [ ] **Step 5: 最終スイープ（spec §3 完了条件 1）**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: **125 件** PASS（124 + 一致テスト）

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 6 件 PASS

Run: `cd web && pnpm wasm && pnpm test && pnpm e2e`
Expected: 31 + 14 件 PASS

Run: `cd reference && uv run --no-config pytest`
Expected: 10 件 PASS

Run: `cd reference && uv run --no-config python scripts/generate.py && git diff --exit-code testdata/`
Expected: 差分なし（golden が動いていない＝数値が 1 ビットも変わっていない証明）。
`git status` で `reference/uv.lock` に差分が出ていないことも確認する（出たら
CLAUDE.md の罠のとおり `--no-config` 漏れを疑う）。

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-wasm/tests/token_parity.rs docs/superpowers/specs/2026-08-11-api-cleanup-design.md
git commit -F - <<'EOF'
Check the two key tables against each other, where silence would hide it

KEY_TOKENS in TypeScript and Key::ALL in Rust promise the same thirty
tokens, and nothing enforced it: an unknown token is a silent no-op at
the WASM boundary, so a drift kills a key without failing a single test.
A host-side test now reads the actual TS source and compares. Verified
in both directions — a mutated token on either side goes red.

The spec said "wasm test or E2E"; this is neither and better: it runs in
cargo test --workspace with no browser, and a moved TS file becomes a
compile error instead of a stale copy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証手段 | close する issue |
|---|---|---|---|
| 1 | api-style.md | 目視 + 全テスト | #13 |
| 2 | backspace / radians_of / angle_of / render / ε可視性 | 124 件が件数据え置きで通る | #9 #11 #12 #16 |
| 3 | 玄関の再エクスポートと import 付け替え | 同上 + wasm 6 件 | #8 |
| 4 | Value::checked_* と finalize | golden が数式の不変を証明 | #17（段階 2）#10 の後始末 |
| 5 | complex/ 平坦化、Value::to_polar | 全テスト + wasm | #17（段階 3） |
| 6 | 言語間一致テスト + 最終スイープ | 125 件 + 全レイヤー + golden 再生成差分なし | — |
