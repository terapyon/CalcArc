# 境界の結果型を 2 択にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WASM 境界の 10 個の結果型を、無効な状態を表現できない 2 択の総称 `Outcome<T>` に置き換える。

**Architecture:** Rust の `CalcResult<T>` を潰さずに、内側 tag の総称 enum としてそのまま
serde に渡す。TS 側は総称 `Outcome<T, E>` を 1 つ置き、**名前は 10 個そのまま実体化する**。
段階 1 で payload がいちばん広い `LoanBonusForward`（7 フィールド）に通し、段階 2 で残り 9 に広げる。

**Tech Stack:** Rust / `serde` / `serde-wasm-bindgen` 0.6 / TypeScript / vitest / `wasm-pack test`

**Spec:** [docs/superpowers/specs/2026-08-28-boundary-outcome-design.md](../specs/2026-08-28-boundary-outcome-design.md)

## Global Constraints

- **`crates/calcarc-core` は panic しない**（`deny(clippy::unwrap_used, expect_used)`）。
  2026-08-28 から `calcarc-wasm` にも同じ宣言が在る
- **WASM 境界は JavaScript 例外を投げない**。計算エラーは戻り値の一部（base-spec §27）
- **`web/src/calc/` に React と `ui/` を import しない**（`tools/check-boundary.mjs` が見張る）
- **serde の tag は内側**。`{"kind":"ok", …payload}` / `{"kind":"error","code":"…"}`
- **`rename_all` は 2 か所が別々に効く。** enum のものは **tag の値**（`Ok` → `"ok"`）、
  payload のフィールド名は **payload 構造体自身**の `rename_all`（spec §4）
- **`DisplayState` を触らない**（spec §6）
- **日付の付いた過去の spec と plan を書き換えない。** 参照するだけ
- **`git push` と PR 作成は行わない。** コミット前に `git branch --show-current`

---

## File Structure

| ファイル | 責任 |
|---|---|
| `crates/calcarc-wasm/src/outcome.rs`（新規） | 総称 `Outcome<T>` と `From<CalcResult<T>>`。**ここだけが tag の形を知る** |
| `crates/calcarc-wasm/src/lib.rs`（変更） | payload 構造体（`Option` を外す）と、境界関数の `match` の除去 |
| `crates/calcarc-wasm/tests/web.rs`（変更） | 実ブラウザで JSON の実物を固定 |
| `crates/calcarc-wasm/tests/boundary_shape.rs`（新規） | §4 の番人（`rename_all` 漏れ）と §5 の番人（エラーの絞り） |
| `web/src/calc/types.ts`（変更） | 総称 `Outcome<T, E>`。**ここだけが union の形を知る** |
| `web/src/finance/loan/types.ts`（変更） | `LoanBonusForwardResult` の実体化 |
| `web/src/ui/Finance/FinancePanel.tsx`（変更） | 消費側を `kind` 判定に |

---

## 段階 1 — `LoanBonusForward`（payload 7）

### Task 1: `Outcome<T>` を置き、JSON の形を実ブラウザで固定する

**Files:**
- Create: `crates/calcarc-wasm/src/outcome.rs`
- Modify: `crates/calcarc-wasm/src/lib.rs`（`mod outcome;` を足す。`to_js_value` の可視性も）
- Test: `crates/calcarc-wasm/src/outcome.rs` の**インラインのテスト**

**Interfaces:**
- Produces: `pub(crate) enum Outcome<T>` と `impl<T> From<CalcResult<T>> for Outcome<T>`

- [ ] **Step 1: 失敗するテストを書く**

**`tests/web.rs` には置けない。** `Outcome` も `to_js_value` も crate 内部のもので、
統合テストは**別 crate**なので触れない。**`src/outcome.rs` のインラインのテスト**にする。

（副産物: この crate に初めてインラインのテストが入る。2026-08-28 の実測で
`#![cfg_attr(not(test), …)]` は**この crate では何も効いていなかった**——
インラインのテストが無かったからである。**ここで初めて効き始める。**）

`crates/calcarc-wasm/src/outcome.rs` の末尾に足す。

```rust
#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;
    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Probe { monthly_payment: String, bonus_rows: u32 }

    #[wasm_bindgen_test]
fn the_outcome_carries_its_kind_inside() {
    let ok: Outcome<Probe> = Ok(Probe {
        monthly_payment: "85000".into(),
        bonus_rows: 40,
    }).into();
    let json = js_sys::JSON::stringify(&to_js_value(&ok)).unwrap();
    assert_eq!(
        String::from(json),
        r#"{"kind":"ok","monthlyPayment":"85000","bonusRows":40}"#
    );

    let err: Outcome<Probe> = Err(CalcError::Overflow).into();
    let json = js_sys::JSON::stringify(&to_js_value(&err)).unwrap();
    assert_eq!(String::from(json), r#"{"kind":"error","code":"Overflow"}"#);
    }
}
```

**`to_js_value` は `lib.rs` の private 関数**なので、`super::*` では届かない。
**`outcome.rs` から使えるように `pub(crate)` にするか、テストの中で同じ
`serde_wasm_bindgen::Serializer` を組むこと**——どちらでもよいが、**選んだ理由を書くこと。**

- [ ] **Step 2: 落ちることを確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: FAIL — `cannot find type Outcome in this scope`

- [ ] **Step 3: 最小の実装を書く**

`crates/calcarc-wasm/src/outcome.rs`:

```rust
//! 境界を渡る結果の形。**tag の形を知っているのはこのファイルだけ**である。
//!
//! `CalcResult<T>` を潰さずにそのまま渡す。潰すと、payload と error が
//! 同時に在る／同時に無い状態を型が許してしまう(設計書 §0)。

use calcarc_core::{CalcError, CalcResult};
use serde::Serialize;

/// 境界を渡る 2 択。**内側 tag**——payload のフィールドは平らに並ぶ。
///
/// **`rename_all` はここでは tag の値しか決めない**(`Ok` → `"ok"`)。
/// payload のフィールド名は payload 構造体自身が決める(設計書 §4)。
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Outcome<T> {
    Ok(T),
    Error { code: CalcError },
}

impl<T> From<CalcResult<T>> for Outcome<T> {
    fn from(r: CalcResult<T>) -> Self {
        match r {
            Ok(v) => Outcome::Ok(v),
            Err(code) => Outcome::Error { code },
        }
    }
}
```

`crates/calcarc-wasm/src/lib.rs` に足す（既存の `mod` 宣言の並びへ）:

```rust
mod outcome;
use outcome::Outcome;
```

- [ ] **Step 4: 通ることを確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: PASS

**期待値を `"OVERFLOW"` に変えて、assert が噛むことも 1 度見ること。** 実物が印字される。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add crates/calcarc-wasm/src/outcome.rs crates/calcarc-wasm/src/lib.rs crates/calcarc-wasm/tests/web.rs && \
git commit -m "Carry the two cases across the boundary, instead of flattening them"
```

---

### Task 2: `LoanBonusForward` の payload から `Option` を外す

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs:296-309`（struct）と `:400-425`（境界関数）
- Test: `crates/calcarc-wasm/tests/web.rs`（境界関数は公開なのでここで見られる）

**Interfaces:**
- Consumes: `Outcome<T>`（Task 1）
- Produces: `struct LoanBonusForward`（**`Result` を外した名前**。`…Result` は TS 側の名前として残す）

- [ ] **Step 1: 失敗するテストを書く**

```rust
#[wasm_bindgen_test]
fn the_bonus_forward_answers_in_two_shapes() {
    let ok = loan_bonus_forward("30000000", "5000000", "1.5", 420);
    let json = String::from(js_sys::JSON::stringify(&ok).unwrap());
    assert!(json.starts_with(r#"{"kind":"ok","monthlyPayment":"#), "{json}");
    assert!(!json.contains("null"), "成功に null は出ない: {json}");

    // 金利の綴りが壊れていれば SyntaxError
    let err = loan_bonus_forward("30000000", "5000000", "x", 420);
    let json = String::from(js_sys::JSON::stringify(&err).unwrap());
    assert_eq!(json, r#"{"kind":"error","code":"SyntaxError"}"#);
}
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: FAIL — いまは `{"monthlyPayment":null,…,"error":"SyntaxError"}` が返る

- [ ] **Step 3: struct と境界関数を書き換える**

`lib.rs` の `LoanBonusForwardResult` を置き換える:

```rust
/// ボーナス併用の正算の結果。**`Outcome` の payload なので `Option` を持たない。**
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]     // ← 外すと monthly_payment のまま出る(設計書 §4)
struct LoanBonusForward {
    monthly_payment: String,
    bonus_payment: String,
    bonus_rows: u32,
    total_payment: String,
    total_interest: String,
    monthly_final_payment: String,
    bonus_final_payment: String,
}
```

境界関数の `match` を消す:

```rust
    })();
    let result: Outcome<LoanBonusForward> = outcome
        .map(|r| LoanBonusForward {
            monthly_payment: r.monthly_payment.to_string(),
            bonus_payment: r.bonus_payment.to_string(),
            bonus_rows: r.bonus_rows,
            total_payment: r.total_payment.to_string(),
            total_interest: r.total_interest.to_string(),
            monthly_final_payment: r.monthly_final_payment.to_string(),
            bonus_final_payment: r.bonus_final_payment.to_string(),
        })
        .into();
    to_js_value(&result)
```

**`Default` の derive は外す**——全フィールド必須になったので意味を持たない。

- [ ] **Step 4: 通ることを確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm` → PASS
Run: `cargo clippy --workspace --all-targets -- -D warnings` → 緑

- [ ] **Step 5: 本当に任意のフィールドが在ったか報告する**

**設計書 §3 が求めている確認**。`Option` を外して**コンパイルが通らないフィールドが在れば、
それは「失敗したから無い」ではなく「本当に任意」である**。在れば `Option` のまま残し、
**その旨を報告に書く**。無ければ「7 つとも潰しのための `Option` だった」と書く。

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add crates/calcarc-wasm/src/lib.rs crates/calcarc-wasm/tests/web.rs && \
git commit -m "Let the widest payload stop pretending its fields might be missing"
```

---

### Task 3: TS 側の総称と実体化

**Files:**
- Modify: `web/src/calc/types.ts`（総称を足す）
- Modify: `web/src/finance/loan/types.ts`（`LoanBonusForwardResult` を実体化）
- Test: `web/tests/unit/outcome.test.ts`（新規）

**Interfaces:**
- Produces: `export type Outcome<T, E>` と `export type LoanBonusForwardResult`

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/unit/outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/calc/types";
import type { LoanBonusForwardResult } from "../../src/finance/loan/types";

describe("Outcome", () => {
  it("成功の枝では payload が必ず在る", () => {
    const r: LoanBonusForwardResult = {
      kind: "ok",
      monthlyPayment: "85000",
      bonusPayment: "120000",
      bonusRows: 40,
      totalPayment: "36000000",
      totalInterest: "6000000",
      monthlyFinalPayment: "84999",
      bonusFinalPayment: "119998",
    };
    if (r.kind !== "ok") throw new Error("unreachable");
    // **`| null` が無いので、ここで null チェックが要らない**
    expect(r.monthlyPayment.length).toBeGreaterThan(0);
  });

  it("失敗の枝には payload が無い", () => {
    const r: LoanBonusForwardResult = { kind: "error", code: "Overflow" };
    expect(r.kind).toBe("error");
  });

  it("成功に error は混ざらない", () => {
    // @ts-expect-error 成功の枝に code は無い
    const bad: Outcome<{ text: string }, "Overflow"> = {
      kind: "ok", text: "1", code: "Overflow",
    };
    expect(bad).toBeDefined();
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm vitest run tests/unit/outcome.test.ts`
Expected: FAIL — `Outcome` が無い

- [ ] **Step 3: 型を書く**

`web/src/calc/types.ts` の末尾:

```ts
/**
 * 境界を渡る 2 択。**無効な状態を表現できない**——成功なら payload が全部在り、
 * 失敗なら `code` だけが在る(設計書 §0)。
 *
 * **規約はここ 1 箇所。名前は関数ごとに実体化して残す**——10 個を手で書くと、
 * 11 個目を書く人が写し間違える。
 */
export type Outcome<T, E> = ({ kind: "ok" } & T) | { kind: "error"; code: E };
```

`web/src/finance/loan/types.ts` の `LoanBonusForwardResult` を置き換える:

```ts
/** ボーナス併用の正算。金額はすべて文字列 —— 円は JS の number を超えうる。 */
export type LoanBonusForwardResult = Outcome<
  {
    monthlyPayment: string;
    bonusPayment: string;
    bonusRows: number;
    totalPayment: string;
    totalInterest: string;
    monthlyFinalPayment: string;
    bonusFinalPayment: string;
  },
  LoanErrorCode
>;
```

`import type { Outcome } from "../../calc/types";` を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm vitest run tests/unit/outcome.test.ts` → PASS
Run: `cd web && pnpm typecheck` → **`FinancePanel.tsx` が落ちる**（Task 4 で直す）

- [ ] **Step 5: コミット**

`typecheck` が赤のままコミットしてよい——**Task 4 と対で 1 つの変更**である。
コミット本文にその旨を書くこと。

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add web/src/calc/types.ts web/src/finance/loan/types.ts web/tests/unit/outcome.test.ts && \
git commit -m "Say the result is one of two things, in one place"
```

---

### Task 4: 消費側を `kind` 判定にする

**Files:**
- Modify: `web/src/ui/Finance/FinancePanel.tsx:742-759`
- Modify: `web/src/ui/Finance/FinancePanel.test.tsx:120`（モックの形）

**Interfaces:**
- Consumes: `LoanBonusForwardResult`（Task 3）

- [ ] **Step 1: モックを新しい形に直す**

`FinancePanel.test.tsx:120` の `bonusForward` のモックが返す値を、
`{ kind: "ok", monthlyPayment: …, … }` の形にする。**`error: null` は無くなる。**

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm vitest run src/ui/Finance/FinancePanel.test.tsx`
Expected: FAIL — 本体がまだ `r.error` を読んでいる

- [ ] **Step 3: 消費側を書き換える**

`FinancePanel.tsx:742` から:

```ts
        const r = calc.bonusForward(
          principalDigits,
          bonusDigits,
          rate,
          monthsNumber,
        );
        if (r.kind === "error") {
          error = r.code;
        } else {
          // **null チェックが要らない**——ok の枝では 7 つとも string である
          answer = `${grouped(r.monthlyPayment)} 円`;
          breakdown = [
            {
              label: "ボーナス回の返済額",
              value: `${grouped(r.bonusPayment)} 円`,
            },
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
```

**`&& r.monthlyPayment && r.bonusPayment` が消える**のが、この変更の目に見える成果である。

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm vitest run` → PASS
Run: `cd web && pnpm typecheck && pnpm lint` → 緑
Run: `cd web && pnpm e2e` → 192 passed

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add web/src/ui/Finance/FinancePanel.tsx web/src/ui/Finance/FinancePanel.test.tsx && \
git commit -m "Check which case it is, and stop guarding each field"
```

---

### Task 5: §4 の番人 — `rename_all` の宣言漏れを捕まえる

**Files:**
- Create: `crates/calcarc-wasm/tests/boundary_shape.rs`

**Interfaces:**
- Consumes: `Outcome<T>`（Task 1）、`LoanBonusForward`（Task 2）

- [ ] **Step 1: 失敗するテストを書く**

**payload 構造体が `camelCase` を宣言していることを、実際の JSON で見る。**
型では見られないので、**出た文字列に snake_case が混ざっていないこと**を主張する。

```rust
//! 境界が吐く JSON の形を見張る。
//!
//! **`rename_all` は 2 か所が別々に効かせている**(設計書 §4)——
//! enum のものは tag の値だけを決め、payload のフィールド名は payload 構造体
//! 自身が決める。**構造体側を書き忘れると `monthly_payment` のまま出る。**

#[wasm_bindgen_test]
fn no_boundary_field_is_written_in_snake_case() {
    let json = String::from(
        js_sys::JSON::stringify(&loan_bonus_forward("30000000", "5000000", "1.5", 420)).unwrap(),
    );
    let snake: Vec<&str> = json
        .split('"')
        .filter(|s| s.contains('_') && !s.contains(' '))
        .collect();
    assert_eq!(snake, Vec::<&str>::new(), "snake_case が漏れている: {json}");
}
```

- [ ] **Step 2: 落ちることを確かめる**

`LoanBonusForward` の `#[serde(rename_all = "camelCase")]` を**一時的に外して**走らせる。
Expected: FAIL — `snake_case が漏れている: {"kind":"ok","monthly_payment":…}`

**戻しは再編集で行うこと**（`git checkout` を使わない）。差分が空に戻ることを確かめる。

- [ ] **Step 3: 戻して緑を確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm` → PASS

- [ ] **Step 4: コミット**

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add crates/calcarc-wasm/tests/boundary_shape.rs && \
git commit -m "Watch that the payload spells its fields the way the TypeScript expects"
```

---

### Task 6: §5 の番人 — エラーの絞りが正しいことを見張る

**Files:**
- Modify: `crates/calcarc-wasm/tests/boundary_shape.rs`

**Interfaces:**
- Consumes: Task 5 のファイル

- [ ] **Step 1: 失敗するテストを書く**

**TS が「この関数はこのエラーしか返さない」と書いている。Rust はそれを保証していない。**
`token_parity.rs` が `KEY_TOKENS` と `Key::ALL` に対してやっているのと同じ形で突き合わせる。

```rust
/// TS の `LoanErrorCode` が挙げている綴り(実測: `Extract<CalcErrorCode, "Overflow" | "SyntaxError">`
/// —— **2 つだけ**)。**`web/src/finance/loan/types.ts` から写す。**
/// 写しである以上ずれうるので、**ずれたらこのテストが落ちる**のが役目である。
const LOAN_ERROR_CODES: &[&str] = &["Overflow", "SyntaxError"];

#[wasm_bindgen_test]
fn the_loan_boundary_returns_only_the_codes_typescript_knows() {
    // 綴りが壊れた入力、桁が溢れる入力、期間 0 —— 境界が返しうる失敗を実際に踏む
    for (p, b, r, m) in [
        ("30000000", "5000000", "x", 420u32),
        ("99999999999999999999", "5000000", "1.5", 420),
        ("30000000", "5000000", "1.5", 0),
    ] {
        let json = String::from(
            js_sys::JSON::stringify(&loan_bonus_forward(p, b, r, m)).unwrap(),
        );
        if let Some(code) = json.split(r#""code":""#).nth(1).and_then(|s| s.split('"').next()) {
            assert!(
                LOAN_ERROR_CODES.contains(&code),
                "TS が知らないエラーが境界を渡った: {code} ({json})",
            );
        }
    }
}
```

- [ ] **Step 2: 番人が噛むことを確かめる**

`LOAN_ERROR_CODES` から `"SyntaxError"` を**一時的に外して**走らせる。
Expected: FAIL — `TS が知らないエラーが境界を渡った: SyntaxError`

**戻しは再編集で。**

- [ ] **Step 3: 戻して緑を確かめる**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm` → PASS

- [ ] **Step 4: 3 つの入力が本当に別々のエラーを踏んでいるか報告する**

**踏んだ `code` を印字して数えること。** 3 つとも `SyntaxError` なら、
**この番人は 1 種類しか見ていない**——`tests-can-assert-nothing` の型である。
その場合は**踏み分けられる入力を探すか、見られないことを註に書く**。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = "feature/boundary-outcome" && \
git add crates/calcarc-wasm/tests/boundary_shape.rs && \
git commit -m "Make Rust prove the narrowing TypeScript claims"
```

---

### Task 7: 段階 1 の報告

- [ ] **Step 1: 全層を回す**

```bash
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
wasm-pack test --headless --chrome crates/calcarc-wasm
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

- [ ] **Step 2: 設計書 §10 の 2 つに答える**

1. **消費側の書き換え量**——`kind` の判定を足したのは何か所か
2. **`Outcome<T>` は読みにくかったか**——TS の交差型のエラーメッセージが
   実際にどう出たか。**耐えられないなら、ここで止めて設計書 ① に戻る**

- [ ] **Step 3: 監視役へ報告して止まる**

段階 2 に進む前に**一度止まること**。設計書 §7 の「1 つ目で止められる」はこのためにある。

---

## 段階 2 — 残り 9

**段階 1 と同じ手順を、payload の広い順に繰り返す。** 新しい設計判断は無い。

| 順 | 関数 | payload |
|---|---|---|
| 1 | `loan_bonus_principal` | 5 |
| 2 | `loan_forward` | 5 |
| 3 | `loan_principal` | 5 |
| 4 | `loan_term` | 4 |
| 5 | `data_scale` | 4 |
| 6 | `llm` | 3 |
| 7 | `compound`（2 つ） | 2 |
| 8 | `convert` | 1 |
| 9 | `expr`（`integer` / `percent`） | 1 |

**各関数につき Task 2〜4 と同じ 3 コミット**（payload / TS の実体化 / 消費側）。
**Task 1・5・6 は繰り返さない**——総称と番人は 1 つで足りる。

**ただし Task 5 の番人は、関数を足すたびに対象を広げること。**
いまは `loan_bonus_forward` 1 つしか見ていない。**見ていない関数は守られていない。**

**段階 2 の完了条件は設計書 §9 の 6 項目。**
