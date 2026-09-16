# 0.9.2 検査側 PR D——10 億円の上限の見張り（実装計画）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 製品の上限（f64 の経路の月額・賞与額が 10 億円を超えたら `Overflow`）を、境界の golden と参照実装で見張る。

**Architecture:** golden（`testdata/loan_boundary.json`）に 3 種類の行を足す。native と wasm32 の両方で読む。
- **上限超え**: 理論 ≥ 上限 + 2 円で、`Overflow` を期待する。
- **対象外**: 年利 0%・1 回払いで上限を超え、値を期待する。
- **大きい残価の上位の段**。

参照の `loan_ref.monthly_payment` にも同じ上限を置く。数値方針に上限の範囲を 1 文足し、§4.7・§4.8 を実測で閉じる。

**Tech Stack:** Python（`reference/`、Fraction、uv）・Rust（`calcarc-core`／`calcarc-wasm` の統合テスト）・wasm-pack

**Spec:** `docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md` の §4.8、§4.7、§5。起点は calcarc-3d の枝 D（`fix/loan-monthly-cap` = `ba46116`、calcarc-1e が承認済み）。

## Global Constraints

- **期待値は Rust の移植にしない。** 理論値は `loan_ref.monthly_payment_exact`（Fraction）で出す。
- 許容と上限の数は `testdata/loan_boundary.json` だけが持つ。Rust のテストは JSON から読み、テストコードに 1 や 10 億を書かない。
- **上限の出どころは数値方針の 1 か所**（3d の方針）。検査側では「文書・JSON・コア」の 3 つが揃うことを見る:
  - 文書と JSON: 既存の `test_policy_matches_loan_boundary.py`
  - JSON とコア: 下の R1（振る舞いで）
- **比べた件数に下限を置き、壊して赤くなるのを見てから緑にする。** 戻しは再編集か再生成で行う。
- `uv` は `--no-config`（`run` も）。
- **重い段**（`wasm-pack test`・`pnpm heavy`）は、回す前に監視役 calcarc-e3 に知らせる。
- 共有ワークツリーには触らない。push と PR は利用者の手番。
- コミットの末尾は次の 2 行:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NbSckxyibTw2mVbKW34pYp
  ```
- **マージの条件**（PR の説明に書く）: 枝 D の直後に PR D をマージする。

## 計画を書く段の裁定

- **R1** コアの定数 `MAX_VERIFIED_MONTHLY_YEN` は `closed_form.rs` の非公開の `const` で、統合テストから import できない。そこで振る舞いで縛る:
  - golden の上限ちょうどの行（`Ok(1_000_000_000)`）と、上限超えの行（理論 ≥ 上限 + 2 → `Overflow`）の 2 つで挟む。
  - 定数を上げれば上限超えの行が、下げればちょうどの行が赤くなる。
  - 製品のコードを公開にする変更は、検査側からは頼まない。
- **R2** 上限超えの行は **理論月額 ≥ 上限 + 2 円**で選ぶ（3d の設計書 c765e8c §5.1 と同じ線）。
  - 理論が (上限, 上限 + 1) の入力は、f64 のずれで通ることもエラーになることもあるので、期待値を置かない。
- **R3** 対象外の行（年利 0%・1 回払いで上限を超える）は、値を期待する。
  - 利用者の裁定 2026-09-13「上限は f64 の経路だけ」を、golden が native と wasm32 で見張る。
  - 期待値は厳密経路の整数: 0% なら `P // n`、残価ありなら `(P − B) // (n − 1)`、1 回払いなら `P + floor(P·月利)`。
- **R4** 大きい残価の上位の段（年 0.0001%・2 回で B の上限の 95%・99%）は**足すだけ**にする。既存の 2,526 件はバイトが同じまま残る（生成器のテストで assert する）。
- **R5** 参照の `loan_ref.monthly_payment` にも上限を置く（§4.8）。
  - 重量級のコーパスは `PRINCIPAL_MAX = 500,000,000` で上限に届かない（calcarc-1e の読み）。したがって**コーパスのバイトは動かない**。再生成の検査がそれを見る。

---

### Task 1: 参照実装に上限を置く

**Files:**
- Modify: `reference/src/calcarc_reference/loan_ref.py`（`monthly_payment` と `monthly_payment_exact` の説明、定数 `MAX_VERIFIED_MONTHLY_YEN = 10**9`）
- Modify: `reference/src/calcarc_reference/loan_boundary.py`（`MAX_MONTHLY_YEN` を `loan_ref` の定数から取る）
- Test: `reference/tests/test_loan_ref.py`（無ければ、その関数を見る既存のテスト）

- [ ] **Step 1: 失敗するテストを書く。**
  - 正の年利・2 回以上で、理論 ≥ 上限 + 2 → `LoanError("Overflow")`。
  - ちょうど 10 億円（golden の `residual/exact/15/2/987654400/81` の入力）→ 1,000,000,000。
  - 年利 0%・600 回・元本 u64::MAX → 30,744,573,456,182,586（上限を掛けない）。
  - 1 回払いで上限を超える → 値。
- [ ] **Step 2:** FAIL を見る。
- [ ] **Step 3: 実装する。**
  - 上限は、f64 の経路に当たる枝（正の年利かつ n ≥ 2）で、切り捨てた月額 > 上限 のときだけ掛ける。
  - `_guard_boundary` の後に置く。0% と 1 回払いの枝は上限の前で返る（製品と同じ形。ただし手順は Decimal と Fraction）。
  - docstring の `独立:` の行は変えない（上限は公開の約束であって、手順ではない）。
- [ ] **Step 4:** `cd reference && uv run --no-config pytest -q`・ruff 2 つ・mypy。
  - `uv run --no-config python scripts/generate.py`
  - `uv run --no-config python scripts/generate_corpus.py`
  - その後で **`git status --porcelain testdata/ corpus/` が空**（R5）。
- [ ] **Step 5:** 赤の確認。上限を 5 億にすると Step 1 のテストが FAIL。戻しは再編集。
- [ ] **Step 6:** コミット `Put the ¥1bn cap in the reference loan, on the paths the product caps`

### Task 2: golden に上限超え・対象外・上位の段を足し、native と wasm32 で読む

**Files:**
- Modify: `reference/src/calcarc_reference/loan_boundary.py`（`_over_cap`・`_exempt` の生成、`_residual_js` の上位の段）
- Modify: `reference/tests/test_loan_boundary.py`
- Modify: `crates/calcarc-core/tests/loan_boundary_golden.rs`
- Modify: `crates/calcarc-wasm/tests/loan_boundary.rs`
- Modify（生成物）: `testdata/loan_boundary.json`

**行の形:**
- 上限超え: `set: "over_cap"`、`boundary: "over"`、`expect: {"error": "Overflow"}`。
  - `op` は `loan_forward`（残価なし・あり）か `loan_bonus_forward`（賞与分が上限超え）。
  - 正の年利・n ≥ 2。理論 ≥ 上限 + 2（R2）。月利の両端と期間の両端から数件ずつ。
- 対象外: `set: "exempt"`、`boundary: "over"`、`expect: {"monthly_floor": "..."}`（R3 の整数）。
  - 年利 0%（残価なし・あり）と 1 回払い。どれも上限を超える月額。
- 上位の段: `_residual_js` に上限の 95%・99% の段を足す（R4）。

- [ ] **Step 1: 失敗するテストを書く**（`test_loan_boundary.py`）:
  - `over_cap` と `exempt` のセルが空でない（下限: 各 5 件以上）。
  - `over_cap` の理論 ≥ 上限 + 2 をテストの中で再計算する。
  - `exempt` の期待値が厳密経路の整数と一致する。
  - (0.0001%, 2) の残価で、B ≥ B の上限の 0.95 が 1 件以上ある。
  - **既存の 2,526 件の id と中身が、新しい JSON の部分集合としてバイト同一**（R4。比べる相手は、`git show HEAD:testdata/loan_boundary.json` を読んだもの）。
- [ ] **Step 2: Rust の 2 本を先に直す（赤）。** `expect.error` を持つ行は `Err(CalcError::Overflow)` を期待する。wasm32 は `kind == "error"` かつ `code == "Overflow"`。
  - 値の行で Err が出たら、これまでどおり失敗の 1 件にする。
  - エラーの行で Ok が出たら、失敗の 1 件にする。
  - セルの被覆（`over_cap/over`・`exempt/over`）と `compared == cases.len()` を保つ。
  - **wasm32 にも `want ≤ cap` の assert を足す**（持ち越し T4、1e の注記 A）。対象は値を期待する行（対象外の行を除く）。
  - JSON を再生成する前に、native のテストが「セルが無い」で FAIL することを見る。
- [ ] **Step 3: 生成器を実装して再生成する**（`uv run --no-config python scripts/generate.py`）。`git status --porcelain testdata/` は `loan_boundary.json` だけ。
- [ ] **Step 4:** `cargo test -p calcarc-core --test loan_boundary_golden -- --nocapture`。集計の印字を報告に写す。上下 1 円の外が出たら止めて報告する。
  - `cargo fmt --all`・clippy。reference の全ゲート。
- [ ] **Step 5（重い段・監視役に知らせる）:** wasm32 を回す。
  - `wasm-pack test --headless --chrome --chromedriver ~/.cache/.wasm-pack/chromedriver-d65213741bcf1a26/chromedriver crates/calcarc-wasm`
  - その後、`--test loan_boundary -- --nocapture` で集計の印字を取る。
  - **環境変数 `CHROMEDRIVER` は wasm-pack に無視される**（calcarc-1e の実測）。フラグで渡す。
- [ ] **Step 6: 赤の確認。**
  - (a) 製品の `>` を `>=` にすると、native のちょうどの行が赤くなる。戻しは再編集（製品のファイルの一時の変更で、コミットしない）。
  - (b) 上限超えの 1 行の期待を値に書き換えると、赤くなる。戻しは再生成。
- [ ] **Step 7:** コミット `Watch the ¥1bn cap from both sides, and keep 0% and one payment outside it`

### Task 3: 文書を閉じる

**Files:**
- Modify: `docs/numerical-policy.md`（`:177` の文の後に、上限の範囲を 1 文）
- Modify: 設計書 §4.7（集計の表を測り直す）・§4.8（仮置き → 確定）
- Modify: `docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md`（§8 の持ち越し）

- [ ] 数値方針に足す文:
  > 上限は製品が計算した月額（切り捨て後）で判定し、f64 を通る経路（正の年利・2 回以上の前進の月額と賞与額）だけに掛ける。年利 0% と 1 回払いは厳密経路なので掛けない（利用者の裁定 2026-09-13）。理論月額が上限のすぐ上（10 億円〜10 億円 + 1 円）にある入力は、f64 のずれで通ることもエラーになることもある。

  - `:164` の 2 つの句は触らない。`test_policy_matches_loan_boundary.py` を回す。
- [ ] §4.7: native と wasm32 の [低い, 同じ, 高い] の表と、セル件数の表を、Task 2 の印字で書き換える。上位の段が埋まったことを書く（最終レビュー I-1 の (a) を閉じる）。
- [ ] §4.8: 「仮置き」を確定の文に換える。範囲（f64 の経路だけ）、R1〜R3 の見張り、参照の上限（R5）、コーパスが動かないこと。
- [ ] 台帳 §8: T4（wasm32 の上限）と I-1 の (a) を閉じた、と書く。残り（n ≥ 12 の残価）は残す。
- [ ] `node tools/check-citations.mjs`。コミット `Close the cap sections with what the tests now measure`

### Task 4: 枝の末尾のフルスイープ（controller、監視役に知らせる）

- [ ] PR A のときと同じ段を回す:
  1. cargo fmt・clippy・test --workspace
  2. web
  3. heavy test・typecheck・lint・`pnpm heavy`（コーパスは動いていないが、製品に上限が入った main 相当で緑を見る）
  4. reference の全ゲート
  5. tools 3 本
  6. 作業木が空
- [ ] `wasm-pack test` は Task 2 の結果を使う（重い段を 2 度回さない）。

## 残り

- **n ≥ 12 の残価**: 「c2·B を整数にする」作り方の限度。作り方を変えるのは 0.9.2 の外（台帳 §8）。
