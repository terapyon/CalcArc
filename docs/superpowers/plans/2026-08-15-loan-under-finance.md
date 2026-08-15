# `loan` を `finance` の下へ（B）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crates/calcarc-core/src/loan/` を `finance/loan/` へ移す。機能は 1 つも変えない。

**Architecture:** `git mv` 1 回 + import のパス 5 か所 + 移動で嘘になった doc の訂正。**テストの検査内容は 1 行も動かない。**

**Tech Stack:** Rust のみ。web と Python は触らない。

**正本:** [`docs/superpowers/specs/2026-08-15-loan-under-finance-design.md`](../specs/2026-08-15-loan-under-finance-design.md)（ユーザー承認済み、2026-08-15）。

## Global Constraints

- **機能を足さない・変えない。** アルゴリズム、テストの assert、期待値、
  エラーの種類——どれも動かさない。
- **`testdata/` の差分ゼロ。** 完了報告に `git diff --stat -- testdata/` が空で
  あることを書く。
- **`web/` と `reference/` の差分ゼロ。** WASM のエクスポート名を変えないので
  TS からは何も変わらない。
- **`git mv` を使う**（`--follow` で履歴が追えること。spec §5-2）。
- 分岐元は **main（`5777360`）**。ブランチ名 `refactor/loan-under-finance`。
  コミットはブランチガード付き
  （`test "$(git branch --show-current)" = refactor/loan-under-finance || exit 1`）。
  **`git push` と PR 作成は行わない。** Co-Authored-By を付ける。
- ベースライン: Rust 203 / wasm 20 / golden 53 件。**すべて増減しない。**

---

### Task 1: 移動と import の追随

**Files:**
- Move: `crates/calcarc-core/src/loan/` → `crates/calcarc-core/src/finance/loan/`（7 ファイル）
- Modify: `crates/calcarc-core/src/lib.rs:11`
- Modify: `crates/calcarc-core/src/finance/mod.rs`
- Modify: `crates/calcarc-core/src/finance/compound.rs:11`
- Modify: `crates/calcarc-core/tests/finance_golden.rs`（`use` 行のみ）
- Modify: `crates/calcarc-wasm/src/lib.rs`（`use` 行のみ）

**Interfaces:**
- Consumes: なし
- Produces: `calcarc_core::finance::loan::*`。旧 `calcarc_core::loan::*` は消える。
  **再エクスポートを置かない**——両方の名前が使えると、どちらで書くかが
  ファイルごとにばらつく。

- [ ] **Step 1: 移動する**

```bash
git mv crates/calcarc-core/src/loan crates/calcarc-core/src/finance/loan
```

**7 ファイルが動く**: `mod.rs` `rate.rs` `schedule.rs` `closed_form.rs`
`forward.rs` `inverse.rs` `bonus.rs`。

**中は触らない。** `loan/` の中のファイルは `super::` で相互参照しているので
（`use super::rate::Rate` など）、移動しても無傷である。

- [ ] **Step 2: 赤を確認する**

Run: `cargo build --workspace`
Expected: FAIL。`lib.rs` がまだ `pub mod loan;` を宣言しており、その先の
ディレクトリが無い（`file not found for module 'loan'`）。

**この赤は「移動が効いている」ことの確認**である。緑のままなら、移動先が
どこからも参照されていない（＝別の場所に古いコピーが残っている）。

- [ ] **Step 3: 宣言を移す**

`crates/calcarc-core/src/lib.rs`——`pub mod loan;` の行を**消す**:

```rust
pub mod data_scale;
pub mod engine;
pub mod error;
pub mod finance;
pub mod numeric;
```

`crates/calcarc-core/src/finance/mod.rs`——`pub mod loan;` を足し、
**移動で嘘になった注記を消す**（詳細は Task 2。ここでは宣言だけ足す）:

```rust
pub mod compound;
pub mod loan;
pub mod tax;
```

- [ ] **Step 4: 内側の参照を直す**

`crates/calcarc-core/src/finance/compound.rs:11`:

```rust
use super::loan::rate::Rate;
```

（`crate::loan::rate::Rate` から。**`super::` にする**——同じ `finance` の中を
指すので、絶対パスで書くと兄弟モジュールであることが読めない。）

- [ ] **Step 5: 外側の参照を直す**

`crates/calcarc-core/tests/finance_golden.rs`:

```rust
use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward, inverse};
use calcarc_core::finance::{compound, tax};
```

`crates/calcarc-wasm/src/lib.rs`:

```rust
use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward, inverse, parse_yen};
use calcarc_core::finance::{compound, tax};
```

**`use` 行だけ**である。関数の呼び出し（`forward::compute(...)`）は
モジュール名で書かれているので変わらない。

- [ ] **Step 6: 緑を確認する**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

Expected: **Rust 203 passed（増減なし）**、clippy 警告なし。

```bash
git diff --stat -- testdata/ web/ reference/
```

Expected: **空**。

- [ ] **Step 7: テストの検査内容が動いていないことを示す**

```bash
git diff crates/calcarc-core/tests/finance_golden.rs
```

Expected: **変更が `use` 行だけ**。`assert` も期待値も入力の読み方も出てこない。
**この出力を完了報告に貼る**（spec §5-3 の完了条件そのもの）。

- [ ] **Step 8: wasm を回す**

```bash
wasm-pack test --headless --chrome crates/calcarc-wasm
```

Expected: **20 passed（増減なし）**。
**Chrome が使えない場合は `--firefox` に落とし、その事実を報告に書く**
（手元の chromedriver 不一致は既知。CI は chrome 固定）。

- [ ] **Step 9: コミット**

```bash
test "$(git branch --show-current)" = refactor/loan-under-finance || exit 1
git add -A
git commit
```

**移動と import の追随だけを 1 コミットに入れる。** doc の訂正（Task 2）は
混ぜない——`git log --follow` で「動いただけ」のコミットが読めるようにする。

---

### Task 2: 移動で嘘になった文を直す

**Files:**
- Modify: `crates/calcarc-core/src/finance/mod.rs`（doc コメント）
- Modify: `crates/calcarc-core/src/finance/loan/mod.rs`（doc コメントに 1 行）

**Interfaces:**
- Consumes: Task 1
- Produces: なし（散文のみ）

- [ ] **Step 1: `finance/mod.rs` の注記を書き換える**

いまの文は**移動しなかった理由**を説明している。移した以上、そのまま残すと
嘘になる:

```rust
//! Finance の計算コア。
//!
//! - `loan`: ローン(M6)。元利均等の正算・逆算 2 種・残価・ボーナス併用。
//! - `compound`: 複利と積立(F1)。
//! - `tax`: 源泉分離課税。
//!
//! **`loan` は F1 の時点では `crate::loan` に居た。** 移動と機能追加を同じ
//! 変更に混ぜないため、複利を足すときは動かさず、別 spec で移した
//! (設計書 2026-08-15、API 整理 PR #19 の方式)。
```

**「なぜ後から移したか」を残す。** 消してしまうと、次に同じ判断をする人が
「最初からここに置けばよかったのでは」と読む。

- [ ] **Step 2: `finance/loan/mod.rs` に 1 行足す**

冒頭の doc の最後（`Value`/`engine`/`data_scale` と相互 import しない、の下）に:

```rust
//! **`finance` の下に居る**(2026-08-15 に移動)。複利(`finance::compound`)とは
//! `Rate` を共有するが、償還表のロジックは共有しない。
```

- [ ] **Step 3: 過去の spec は訂正しない（判断の記録）**

`docs/superpowers/specs/2026-08-13-loan-design.md:268` に
`crates/calcarc-core/src/loan/` と書いてある。**これは直さない。**

M6 の spec は「そのとき何を作ったか」の記録であり、後の spec が構造を変えた
ことは**後の spec が持つ**（本 plan の正本である 2026-08-15 の設計書）。
M6 の spec に付いている【訂正】印は**実装が spec の記述を更新した**ときの
もので、性質が違う。

**この判断を plan に書いておくのは、レビューで「訂正印が要るのでは」と
聞かれるのを 1 往復ぶん省くためである。**

- [ ] **Step 4: 緑を再確認してコミット**

```bash
cargo test --workspace     # 203、増減なし
cargo fmt --check
test "$(git branch --show-current)" = refactor/loan-under-finance || exit 1
git add -A && git commit
```

---

# 完了条件（spec §5 の写し）

1. `crates/calcarc-core/src/finance/loan/` に 7 ファイルが居る。
   `crates/calcarc-core/src/loan/` は無い。
2. `git log --follow crates/calcarc-core/src/finance/loan/rate.rs` で
   **移動前の履歴が追える**。
3. **テストの検査内容が 1 行も動いていない**——`finance_golden.rs` の diff が
   `use` 行だけであることを実出力で示す。
4. `cargo test --workspace` が **203 件のまま緑**。`testdata/` の差分が空。
5. `wasm-pack test` が **20 件のまま緑**。
6. `web/` と `reference/` の差分が空。

# 赤確認について

**新設の検査が無いので、壊して赤を見る対象が無い**（spec §6）。

代わりに置く証明は 2 つ:

- **Task 1 Step 2 の赤**——移動が効いていることの確認。緑のままなら移動が
  空振りしている。
- **既存 203 件が検査内容を変えずに通ること**——移動が無害でなければ、
  コンパイルエラーかテスト失敗のどちらかになる。

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | 移動と import 5 か所 | cargo + wasm | §1/§2 |
| 2 | 嘘になった doc の訂正 | cargo | §1 |
