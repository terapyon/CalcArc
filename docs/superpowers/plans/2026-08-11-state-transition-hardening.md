# 状態遷移バグの系統的な潰し込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 電卓の状態機械について、キー列に潜む遷移バグを網羅列挙と強化したランダム探索で系統的に潰す。新機能は足さない（DEL の括弧削除を除く）。

**Architecture:** 不変条件を「1 回の遷移が満たすべき局所的な条件」として 1 か所に書き、網羅列挙とランダム探索の両方から呼ぶ。局所的に成り立てば列全体でも成り立ち、反例の切り分けも容易になる。網羅は等価類に畳んだ代表キーで短い列を全数検査し、ランダムは長い列を担当する。

**Tech Stack:** Rust 2024 / proptest / `calcarc-core` の `engine`

**参照仕様:** [docs/superpowers/specs/2026-08-11-state-transition-hardening-design.md](../specs/2026-08-11-state-transition-hardening-design.md)（以下「設計書」）

## Global Constraints

- **コミット前に `cargo fmt` を実行する。** 計画中のコードは rustfmt 整形済みではない。`--check` は直してくれない。
- **`calcarc-core` は panic しない。** `#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]` が強制する。テストコードは panic してよい。
- **成立していない性質を不変条件として書かない。** 落ちたら、まず実装のバグか期待の誤りかを切り分ける。期待の誤りなら計画を直し、実装を歪めない。
- **反例が出たら `engine_table.rs` に固定テストとして書いてから直す。** 反例を捨てない。
- **既存の 114 件の Rust テストはすべて通り続ける。**
- **網羅列挙 2 種の合計は 6 秒以内**（debug）。
- 電卓の挙動を変えるときは `crates/calcarc-core/tests/engine_table.rs` を先に変える。
- 毎コミットの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- **`git push` と PR 作成は行わない。**
- **作業ブランチを切る。** `main` に直接コミットしない。前回と同じく、PR でレビューの関門を通してからマージする。

---

## File Structure

```
crates/calcarc-core/
├── src/engine/
│   ├── state.rs        Buffer::pop は変更なし（3 段のうち 1・2 段目を既に担う）
│   └── mod.rs          delete_one を新設。reduce の operator_pending 判定を直す
└── tests/
    ├── engine_table.rs        DEL の 3 段と括弧削除の固定テストを追記
    └── engine_robustness.rs   不変条件の関数群、網羅列挙 2 種、強化した proptest

docs/numerical-policy.md        I3 と I3b を性質として追記
```

`engine_robustness.rs` が本計画の中心になる。不変条件は `mod invariants` に閉じ、網羅列挙とランダム探索の両方がそこだけを呼ぶ。

---

## Task 1: DEL が閉じられていない開き括弧を消せるようにする

**Files:**
- Modify: `crates/calcarc-core/src/engine/mod.rs`
- Test: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Consumes: `EngineState { buffer, operators, .. }`, `Buffer::pop() -> bool`, `OpToken::OpenParen`（既存）
- Produces: `fn delete_one(state: &mut EngineState)`（`engine/mod.rs` 内の私有関数）

- [ ] **Step 1: 失敗するテストを `engine_table.rs` の末尾に追記する**

```rust
#[test]
fn del_removes_an_unclosed_paren() {
    // ( が入力中の 3 を捨てたうえ、閉じていない括弧だけが残る。
    // その状態を DEL で片付けられるようにする。
    assert_eq!(main_of(&["3", "lparen", "del"]), "0");
    assert_eq!(run(&["3", "lparen", "del"]).pending_depth, 0);

    // 押し間違いが綺麗に戻る。
    assert_eq!(main_of(&["3", "add", "lparen", "del", "4", "eq"]), "7");
}

#[test]
fn del_walks_the_three_tiers_in_order() {
    // 数字 → j マーカー → 開き括弧（設計書 I7）。
    assert_eq!(main_of(&["3", "add", "lparen", "j", "4", "del"]), "j");
    assert_eq!(
        run(&["3", "add", "lparen", "j", "4", "del", "del"]).pending_depth,
        1,
        "2 段目では括弧はまだ残る"
    );
    assert_eq!(
        run(&["3", "add", "lparen", "j", "4", "del", "del", "del"]).pending_depth,
        0,
        "3 段目で括弧が消える"
    );
}

#[test]
fn del_does_not_remove_an_operator() {
    use calcarc_core::engine::state::BinOp;
    // 演算子を消せるようにすると、確定済みの入力を復元する必要が生じて
    // undo になる。境界はここ。
    assert_eq!(run(&["3", "add", "del"]).pending_op, Some(BinOp::Add));

    // 括弧の内側で演算子が保留中なら、その括弧も消さない。
    assert_eq!(run(&["lparen", "3", "add", "del"]).pending_depth, 1);
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cargo test -p calcarc-core --test engine_table del_`
Expected: FAIL。`del_removes_an_unclosed_paren` が `pending_depth` を `1` と報告する（現在の DEL は消すものが無いとき何もしない）。

- [ ] **Step 3: `delete_one` を実装する**

`crates/calcarc-core/src/engine/mod.rs` に関数を追加する。

```rust
/// DEL の 1 回分。数字 → `j` マーカー → 閉じられていない開き括弧の順に、
/// ひとつだけ消す。どれも無ければ何もしない（設計書 I7）。
///
/// 演算子は消さない。消せるようにすると、確定済みの入力を復元する必要が
/// 生じて undo になる。undo は状態に履歴スタックを要求し、EngineState が
/// 毎打鍵で WASM 境界を往復する設計（D7）に正面から効く。
fn delete_one(state: &mut EngineState) {
    if let Some(buffer) = &mut state.buffer {
        // 1 段目と 2 段目は Buffer::pop が担う。数字が残っていれば末尾を
        // 消し、数字が尽きていれば j ごとバッファを捨てる。
        if buffer.pop() {
            state.buffer = None;
        }
        return;
    }
    // 3 段目。演算子が保留されていれば last は Op なので、この分岐には
    // 入らない。括弧を演算子の下から抜くことはない。
    if matches!(state.operators.last(), Some(OpToken::OpenParen)) {
        state.operators.pop();
    }
}
```

`apply` の `Key::Del` の分岐を差し替える。

```rust
        Key::Del => delete_one(state),
```

- [ ] **Step 4: `operator_pending` の判定を直す**

`reduce` の `Key::Del if !had_buffer => was_pending` は、「DEL は何も消さなかったのだから、直前が演算子だったという事実は残る」という判定である。DEL が括弧も消せるようになった以上、**バッファの有無だけでは足りない**。

`crates/calcarc-core/src/engine/mod.rs` の `reduce` を直す。`had_buffer` を捨て、消せるものがあったかで判定する。

```rust
    } else {
        let was_pending = next.operator_pending;
        // DEL が何も消さないかどうかは、適用の前に見ておく必要がある。
        // 消さなかったなら「直前が二項演算子だった」という事実は残る。
        let del_changes_nothing = next.buffer.is_none()
            && !matches!(next.operators.last(), Some(OpToken::OpenParen));

        if let Err(err) = apply(&mut next, key) {
            next.error = Some(err);
        }
        next.operator_pending = next.error.is_none()
            && match key {
                Key::Add | Key::Sub | Key::Mul | Key::Div => true,
                // 表示だけを変えるキーは「直前が演算子だった」事実を消さない。
                Key::AngleToggle | Key::PolarToggle => was_pending,
                // 何も消さなかった DEL も同じ。
                Key::Del if del_changes_nothing => was_pending,
                _ => false,
            };
    }
```

実際には、`operator_pending` が真のとき `operators.last()` は必ず `Op` なので `del_changes_nothing` は `buffer.is_none()` と一致する。それでも明示するのは、この対応関係が `push_binop` の実装に依存しており、将来崩れても気づけないためである。

- [ ] **Step 5: テストが通ることを確認する**

Run: `cargo test -p calcarc-core`
Expected: PASS。新規 3 件を含め全件。とくに既存の `del_removes_the_last_character`、`del_on_an_imaginary_entry_keeps_the_j`、`a_key_that_changes_nothing_does_not_defeat_operator_replacement` が通り続けること。

Run: `cargo clippy -p calcarc-core --all-targets -- -D warnings`
Expected: 出力なし

Run: `cargo fmt && cargo fmt --check`
Expected: 出力なし

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: PASS（6 件）。このタスクは `reduce` の挙動を変えるので、
ブラウザ側から同じ関数を叩いているテストも通ることを確かめる。

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Let DEL remove an unclosed parenthesis

Pressing ( discards whatever was being typed, so 3 ( left the 3 gone and
a parenthesis pending with no way to clear it short of AC. The key is
labelled "delete one character" and did nothing at all in that state.

DEL now works down three tiers — digits, then the j marker, then an
unclosed opening parenthesis. Operators stay out of reach: deleting one
would mean restoring the entry it already consumed, which is undo, and
undo wants a history stack in a state that crosses the WASM boundary on
every keystroke.

The operator_pending check moves from "was there a buffer" to "was there
anything to delete", since those stopped being the same question.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: 不変条件を 1 か所にまとめる

**Files:**
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`
- Modify: `docs/numerical-policy.md`

**Interfaces:**
- Consumes: `reduce`, `display`, `Key`, `EngineState`, `OpToken`, `Value`, `Buffer`（既存の公開 API）
- Produces: `mod invariants` — `pub fn check(before: &EngineState, key: Key, after: &EngineState) -> Result<(), String>`

- [ ] **Step 1: 不変条件のモジュールを書く**

`crates/calcarc-core/tests/engine_robustness.rs` の `use` 群の直後に追加する。

```rust
/// 不変条件。網羅列挙とランダム探索の両方がここだけを呼ぶ。
///
/// 同じ性質を 2 か所に書くと、片方だけ直されて食い違う。検査はすべて
/// 「1 回の遷移」に対する局所的な条件として書く。局所的に成り立てば列
/// 全体でも成り立ち、反例が出たときにどの 1 手が壊したかがすぐ分かる。
mod invariants {
    use calcarc_core::engine::display::display;
    use calcarc_core::engine::key::Key;
    use calcarc_core::engine::state::{EngineState, OpToken};
    use calcarc_core::Value;

    /// 遷移 1 回が満たすべき条件をすべて検査する。
    pub fn check(before: &EngineState, key: Key, after: &EngineState) -> Result<(), String> {
        check_state(after)?;
        error_is_latched(before, key, after)?;
        real_axis_is_closed(before, key, after)?;
        operator_press_replaces(before, key, after)?;
        del_removes_at_most_one_thing(before, key, after)?;
        Ok(())
    }

    /// 状態だけで判定できる条件。打鍵が 1 度も起きない列（長さ 0）でも
    /// 初期状態を検査できるように、遷移とは別に呼べる形にしておく。
    pub fn check_state(state: &EngineState) -> Result<(), String> {
        renderable(state)?;
        operand_count_matches(state)?;
        Ok(())
    }

    /// I1: 表示は常に作れる。
    fn renderable(after: &EngineState) -> Result<(), String> {
        if display(after).main.is_empty() {
            return Err("I1: display is empty".to_string());
        }
        Ok(())
    }

    fn count_ops(state: &EngineState) -> usize {
        state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::Op(_)))
            .count()
    }

    fn count_parens(state: &EngineState) -> usize {
        state
            .operators
            .iter()
            .filter(|t| matches!(t, OpToken::OpenParen))
            .count()
    }

    /// I2: 被演算数の数 = 保留中の二項演算子の数。
    fn operand_count_matches(after: &EngineState) -> Result<(), String> {
        if after.error.is_some() {
            return Ok(());
        }
        let ops = count_ops(after);
        if after.operands.len() != ops {
            return Err(format!(
                "I2: {} operands against {} pending operators",
                after.operands.len(),
                ops
            ));
        }
        Ok(())
    }

    /// I5: エラー中は AC 以外のどのキーでも状態が変わらない。
    fn error_is_latched(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if before.error.is_none() || key == Key::Ac {
            return Ok(());
        }
        if after != before {
            return Err(format!(
                "I5: {} changed the state while an error was showing",
                key.token()
            ));
        }
        Ok(())
    }

    /// 状態が実数だけで構成されているか。
    fn all_real(state: &EngineState) -> bool {
        state.current.im == 0.0
            && state.operands.iter().all(|v| v.im == 0.0)
            && state.buffer.as_ref().is_none_or(|b| !b.imaginary)
    }

    /// この打鍵が作用する値。入力中なら確定前のバッファの値。
    fn acting_on(state: &EngineState) -> Value {
        state.buffer.as_ref().map_or(state.current, |b| b.value())
    }

    /// I3 / I3b: 実軸は演算で閉じており、虚軸への出口は 2 つだけ。
    ///
    /// 出口 1 は `j` キーで、これは入力なので「実数のみの入力」という
    /// 前提から外れる。出口 2 は負の実数の sqrt で、`sqrt(-4) = j2` を
    /// 返すのは設計上の機能である（Vertical Slice 設計書 §4.1）。
    /// この 2 つを例外として認めないと、網羅列挙が `+/−` `√` を踏んだ
    /// 瞬間にバグでないものが落ちるテストになる。
    fn real_axis_is_closed(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if !all_real(before) || after.error.is_some() {
            return Ok(());
        }
        if key == Key::J {
            // j は入力を始めるだけで、確定済みの値には触れない。免除を
            // 「何をしても素通し」にしないため、そこだけ確かめる。
            return if after.current == before.current {
                Ok(())
            } else {
                Err(format!(
                    "I3: j changed the committed value ({:?} -> {:?})",
                    before.current, after.current
                ))
            };
        }
        if key == Key::Sqrt && acting_on(before).re < 0.0 {
            // I3b: 純虚数でなければならない。極形式を経由する実装だと
            // 実部に 1.2e-16 が残り、j2 が 1.224646799e-16+j2 になる。
            return if after.current.re == 0.0 {
                Ok(())
            } else {
                Err(format!(
                    "I3b: sqrt of a negative real left re={}",
                    after.current.re
                ))
            };
        }
        if !all_real(after) {
            return Err(format!(
                "I3: a real-only state produced im={} after {}",
                after.current.im,
                key.token()
            ));
        }
        Ok(())
    }

    fn is_binop(key: Key) -> bool {
        matches!(key, Key::Add | Key::Sub | Key::Mul | Key::Div)
    }

    /// I4: 二項演算子を続けて押したら、最後の 1 つだけが残る。
    ///
    /// 局所的に言い換える。直前が二項演算子だったなら、次の二項演算子は
    /// 積むのではなく差し替えでなければならず、被演算数も演算子も増えては
    /// ならない。累算すると 3 + + 4 = が 10 になる。
    ///
    /// 同種・異種を問わない。また表示だけを変えるキーや、何も消さない DEL を
    /// 挟んでも operator_pending は落ちないので、この検査はその形も覆う。
    /// 実際に起きたバグは `3 + × 4 =` と `3 + DEL + 4 =` であって、
    /// 同種の連打ではなかった。
    fn operator_press_replaces(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if !before.operator_pending || !is_binop(key) || after.error.is_some() {
            return Ok(());
        }
        // **長さで比べてはならない。** 優先順位が同じか降順のときは、
        // 誤って積んだ被演算数が直後の畳み込みで戻されるため長さが変わらない。
        // 3 + + 4 = が 10 になるバグはまさにこの経路で、長さ比較では
        // 素通りする（operands も operators も 1 -> 1 のまま）。
        // 積まれたかどうかは内容にしか現れない。
        if after.operands != before.operands {
            return Err(format!(
                "I4: {} after a pending operator changed the operands ({:?} -> {:?})",
                key.token(),
                before.operands,
                after.operands
            ));
        }
        if after.current != before.current {
            return Err(format!(
                "I4: {} after a pending operator changed the value ({:?} -> {:?})",
                key.token(),
                before.current,
                after.current
            ));
        }
        if after.operators.len() != before.operators.len() {
            return Err(format!(
                "I4: {} after a pending operator grew the operator stack ({} -> {})",
                key.token(),
                before.operators.len(),
                after.operators.len()
            ));
        }
        Ok(())
    }

    /// I7: DEL は 3 段のうち 1 つだけを消す。演算子と被演算数は動かさない。
    fn del_removes_at_most_one_thing(
        before: &EngineState,
        key: Key,
        after: &EngineState,
    ) -> Result<(), String> {
        if key != Key::Del || before.error.is_some() {
            return Ok(());
        }
        if after.operands != before.operands {
            return Err("I7: DEL moved the operand stack".to_string());
        }
        if count_ops(after) != count_ops(before) {
            return Err("I7: DEL removed an operator".to_string());
        }
        let (open_before, open_after) = (count_parens(before), count_parens(after));
        if open_after > open_before {
            return Err("I7: DEL added a parenthesis".to_string());
        }
        if open_before - open_after > 1 {
            return Err(format!(
                "I7: DEL removed {} parentheses at once",
                open_before - open_after
            ));
        }
        Ok(())
    }
}
```

- [ ] **Step 2: 既存の proptest から呼ぶ**

`never_panics` の本体にある「表示が空でない」「被演算数と演算子の数が一致する」という手書きの検査を、`invariants::check` の呼び出しに置き換える。同じ性質を 2 か所に書かないためである。

```rust
    #[test]
    fn never_panics(indices in prop::collection::vec(0usize..Key::ALL.len(), 0..40)) {
        let mut state = EngineState::initial();
        // 長さ 0 の列ではループが 1 度も回らない。初期状態だけは見ておく。
        if let Err(why) = invariants::check_state(&state) {
            return Err(TestCaseError::fail(why));
        }
        for i in indices {
            let key = Key::ALL[i];
            let (next, _) = reduce(&state, key);
            prop_assert_eq!(next.schema, STATE_SCHEMA);
            if let Err(why) = invariants::check(&state, key, &next) {
                return Err(TestCaseError::fail(why));
            }
            state = next;
        }
    }
```

`TestCaseError` を `use proptest::test_runner::TestCaseError;` で取り込む。

- [ ] **Step 3: テストが通ることを確認する**

Run: `cargo test -p calcarc-core --test engine_robustness`
Expected: PASS

**落ちた場合は反例を捨てないこと。** proptest が出す最小反例のキー列を `engine_table.rs` に固定テストとして書き、実装のバグか期待の誤りかを切り分けてから直す。期待の誤りであれば計画を直し、実装を歪めない。

- [ ] **Step 4: `docs/numerical-policy.md` に I3 と I3b を書く**

「既知の制約」の節ではなく、性質として独立した節を設ける。制約ではなく利用者への約束だからである。

```markdown
## 実軸は演算で閉じている

実数だけを入力した計算は、実数のまま返る。出力の虚部は近似的にではなく
**厳密に 0** である。`5` と表示されるべき値が `5+j1e-16` になることはない。

虚軸への出口は 2 つだけで、どちらも意図したものである。

- `j` キー
- **負の実数の平方根。** `sqrt(-4)` は `j2` を返す。従来の関数電卓が
  `Math ERROR` を返す入力に、複素数を扱うこの電卓は答えられる。このとき
  実部は厳密に 0 である（極形式を経由する実装では 1.2e-16 が残るため、
  負の実数には専用の経路を用意している）

この性質は個々の関数の実装詳細に支えられている。`mul` の虚部が
`a.re*b.im + a.im*b.re` なので両虚部が 0 なら厳密に 0 になること、`div` が
`b.im == 0` のとき第 1 分岐で `t = 0` になること、`sin` / `cos` の
`sinh(0)` を負ゼロの均しが吸収すること、`tan` が実数どうしの `div` に
帰着すること。`ln` / `exp` / `asin` / `acos` / `atan` / `xʸ` を足すと
自明でなくなるため、テストで固定してある。
```

- [ ] **Step 5: 整形して確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy -p calcarc-core --all-targets -- -D warnings && cargo test -p calcarc-core`
Expected: すべて成功

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/ docs/numerical-policy.md
git commit -F - <<'EOF'
Gather the engine's invariants into one place

The property test checked that nothing panicked and that the two stacks
stayed in step, written inline. Both the exhaustive walks and the random
search need those checks, and a property written twice gets fixed once.

Each invariant is stated as a condition on a single transition rather
than on a whole sequence. That composes — holding at every step means
holding for the sequence — and it tells you which keystroke broke it.

Three are new. The real axis is closed under every operation, with two
deliberate exits to the imaginary one: the j key, and the square root of
a negative real, which returns j2 rather than an error and must land
exactly on the axis. A second operator replaces the pending one instead
of stacking. DEL removes at most one thing and never an operator.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: 短い列を網羅する

**Files:**
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`

**Interfaces:**
- Consumes: `invariants::check`（Task 2）、`reduce`、`Key`、`EngineState`
- Produces: なし（テストのみ）

- [ ] **Step 1: 代表キーと歩行関数を書く**

`crates/calcarc-core/tests/engine_robustness.rs` に追加する。

```rust
/// 等価類に畳んだ代表キー。畳んでよい根拠は設計書 §5.2 の表にある。
/// 判断基準は「状態機械に対する作用が同じか」であって、表示上の違いではない。
///
/// 構造の網。表示トグルと定数を外すぶん、長さ 7 まで届く。
const STRUCTURE: [Key; 10] = [
    Key::Digit(3),
    Key::Dot,
    Key::J,
    Key::Add,
    Key::Mul,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
];

/// 全等価類の網。表示トグル・後置関数・定数・ゼロを足すぶん長さ 6 まで。
///
/// `√` を後置関数の代表にするのは、sqrt だけが負の実数用の専用経路を持ち
/// （I3b）、他の単項関数と違う分岐を通るためである。
/// `DRG` と `▸∠` は互いに等価なので代表 1 つでよい。どちらも angle / form
/// しか変えず、buffer / current / operands / operators に触れない。
const ALL_CLASSES: [Key; 14] = [
    Key::Digit(3),
    Key::Digit(0),
    Key::Dot,
    Key::J,
    Key::Add,
    Key::Mul,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
    Key::AngleToggle,
    Key::Sqrt,
    Key::Pi,
];

/// 深さ優先で全列を辿り、遷移ごとに不変条件を検査する。
///
/// エラー状態に落ちた列は AC 以外が無効なので（I5）、そこから先を辿っても
/// 新しい状態には届かない。枝刈りする。
fn walk(state: &EngineState, keys: &[Key], depth: usize, max: usize, trail: &mut Vec<&'static str>) {
    if depth == max {
        return;
    }
    for &key in keys {
        let (next, _) = reduce(state, key);
        trail.push(key.token());
        if let Err(why) = invariants::check(state, key, &next) {
            panic!("{why}\n  key sequence: {trail:?}");
        }
        // エラー状態からは AC 以外で新しい状態に届かないので、ここから
        // **先を辿らない**。遷移そのものは上で必ず検査する。枝刈りの根拠が
        // I5（エラーは AC でしか解けない）である以上、I5 を検査せずに
        // 枝刈りしては循環で、I5 だけが網羅から漏れる。
        if state.error.is_none() || key == Key::Ac {
            walk(&next, keys, depth + 1, max, trail);
        }
        trail.pop();
    }
}
```

`trail` は反例をそのまま再現できる形で出すためにある。網羅列挙は proptest と違って自動で最小化しないので、落ちた列そのものを見せる。

- [ ] **Step 2: 2 つの網を張るテストを書く**

```rust
/// 構造に関わるキーだけで、長さ 7 までのすべての打鍵列を検査する。
///
/// Vertical Slice で見つかったキー列バグは最長で 7 打鍵だった
/// （`3 + j 4 DEL 5 =`）。ランダム探索はこの領域をたまたましか踏まない。
#[test]
fn every_structural_sequence_up_to_seven_keys_holds_the_invariants() {
    walk(&EngineState::initial(), &STRUCTURE, 0, 7, &mut Vec::new());
}

/// 全等価類で長さ 6 まで。表示トグルを挟んだ形（`3 + DRG + 4 =`）は
/// こちらの網にかかる。
#[test]
fn every_sequence_over_all_classes_up_to_six_keys_holds_the_invariants() {
    walk(&EngineState::initial(), &ALL_CLASSES, 0, 6, &mut Vec::new());
}
```

- [ ] **Step 3: 実行して時間を測る**

Run: `cargo test -p calcarc-core --test engine_robustness -- --nocapture --test-threads=1`
Expected: PASS。2 つの網の合計が 6 秒以内であること。

**落ちた場合。** 表示された `key sequence` をそのまま `engine_table.rs` の固定テストに書き写し、期待値を手で決めてから実装を直す。反例を捨てて網を緩めない。

計測が 6 秒を超えた場合は、実装が遅くなったか環境が違う。設計書 §5.4 の実測（構造 3.1s、全等価類 2.8s）と比べ、どちらが伸びたかを報告する。網の大きさを勝手に縮めない。

- [ ] **Step 4: 整形して全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy -p calcarc-core --all-targets -- -D warnings && cargo test -p calcarc-core`
Expected: すべて成功

- [ ] **Step 5: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Walk every short key sequence

The bugs this slice produced were all short: three of them fit in seven
keystrokes or fewer. Random search reaches that territory only by
accident, so it found none of them — the whole-branch review and an
outside reviewer did.

Two exhaustive walks close it. Keys fold into equivalence classes by
what they do to the state machine, not by how they look, so the space
stays small enough to enumerate: the structural keys to seven
keystrokes, and every class to six. Sequences that error are pruned,
since nothing but AC can move them afterwards.

A failing walk prints the key sequence that broke, because unlike
proptest it has no shrinker to hand you a minimal case.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: ランダム探索を長い列に効かせる

**Files:**
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`

**Interfaces:**
- Consumes: `invariants::check`（Task 2）
- Produces: なし（テストのみ）

- [ ] **Step 1: 重みつきの生成器を書く**

現在の生成器は `Key::ALL` を一様に引くため、対応しない `)` を 1 打鍵あたり 1/30 で踏み、40 打鍵で一度も踏まない確率が `(29/30)^40 ≈ 0.26` しかない。**約 74% の列が途中で `SyntaxError` に落ち、そこから先は AC 以外が無効になって探索に寄与しない。**

`crates/calcarc-core/tests/engine_robustness.rs` に追加する。

```rust
/// 重みつきのキー生成。演算子と括弧を厚くして、深い入れ子と長い畳み込みに
/// 届かせる。一様に引くと `)` を早々に踏んで大半の列が死ぬ。
fn weighted_key() -> impl Strategy<Value = Key> {
    prop_oneof![
        5 => prop::sample::select(vec![
            Key::Digit(0), Key::Digit(3), Key::Digit(7),
        ]),
        4 => prop::sample::select(vec![
            Key::Add, Key::Sub, Key::Mul, Key::Div,
        ]),
        3 => Just(Key::LParen),
        2 => Just(Key::RParen),
        2 => Just(Key::Eq),
        1 => Just(Key::J),
        1 => Just(Key::Dot),
        1 => prop::sample::select(vec![
            Key::Sqrt, Key::Sqr, Key::Neg, Key::Sin, Key::Cos, Key::Tan, Key::Pi,
        ]),
        1 => prop::sample::select(vec![
            Key::Del, Key::AngleToggle, Key::PolarToggle, Key::Ac,
        ]),
    ]
}
```

`(` を `)` より厚くしてあるのは、深く入れ子にした状態へ届かせるためである。均等にすると括弧の深さが伸びない。

- [ ] **Step 2: エラーから復帰する探索テストを書く**

既存の `never_panics` は残し、その隣に長い列を担当するテストを足す。

```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    /// 長い打鍵列を辿る。エラーに落ちたら AC を挟んで続ける。
    ///
    /// 挟まないと、一度落ちた列は残り全部が無効打鍵になり探索に寄与しない。
    /// 網羅列挙が短い列を保証するので、こちらは深い入れ子・長い畳み込み・
    /// エラーからの復帰を繰り返す領域を担当する。
    #[test]
    fn long_sequences_hold_the_invariants(
        keys in prop::collection::vec(weighted_key(), 0..120)
    ) {
        let mut state = EngineState::initial();
        // 実際に reduce に渡した順序をそのまま残す。proptest が出す縮小結果は
        // Vec<Key> の Debug 表示で、しかも下で挟む AC を含まない。つまりそれ
        // だけでは再現できない。engine_table.rs の main_of(&[...]) にそのまま
        // 貼れる形で持っておく。
        let mut trail: Vec<&'static str> = Vec::new();
        for key in keys {
            if state.error.is_some() {
                trail.push(Key::Ac.token());
                let (cleared, _) = reduce(&state, Key::Ac);
                if let Err(why) = invariants::check(&state, Key::Ac, &cleared) {
                    return Err(TestCaseError::fail(format!(
                        "{why}\n  key sequence: {trail:?}"
                    )));
                }
                state = cleared;
            }
            trail.push(key.token());
            let (next, _) = reduce(&state, key);
            if let Err(why) = invariants::check(&state, key, &next) {
                return Err(TestCaseError::fail(format!(
                    "{why}\n  key sequence: {trail:?}"
                )));
            }
            state = next;
        }
    }
}

/// 重みが崩れたことに気づけるようにする。
///
/// 深い入れ子・長い畳み込み・復帰の繰り返しに届くテストはこれ 1 つで、
/// 網羅列挙は費用の都合で届かない（長さ 8 で 51 秒）。重みを触った誰かが
/// 到達距離を潰しても、不変条件は静かに通り続ける。到達距離そのものを
/// 表明しておかないと、この領域の網は音もなく消える。
///
/// 種を固定するので結果は揺れない。実測は深さ 9・復帰 1159 回で、
/// 下限にはどちらも十分な余裕がある。
#[test]
fn the_weighted_search_still_reaches_deep_states() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};

    let mut runner = TestRunner::new_with_rng(
        Config::default(),
        TestRng::deterministic_rng(RngAlgorithm::ChaCha),
    );
    let strategy = prop::collection::vec(weighted_key(), 0..120);

    let (mut deepest, mut recoveries) = (0usize, 0usize);
    for _ in 0..300 {
        let keys = strategy.new_tree(&mut runner).unwrap().current();
        let mut state = EngineState::initial();
        for key in keys {
            if state.error.is_some() {
                state = reduce(&state, Key::Ac).0;
                recoveries += 1;
            }
            state = reduce(&state, key).0;
            deepest = deepest.max(invariants::count_parens(&state));
        }
    }

    assert!(
        deepest >= 5,
        "入れ子が深さ {deepest} までしか届いていない。weighted_key の重みを確認すること"
    );
    assert!(
        recoveries >= 100,
        "エラーからの復帰が {recoveries} 回しかない。weighted_key の重みを確認すること"
    );
}
```

- [ ] **Step 3: 実行する**

Run: `cargo test -p calcarc-core --test engine_robustness`
Expected: PASS

**落ちた場合は proptest の最小反例を `engine_table.rs` に固定テストとして書いてから直す。** proptest は縮小した反例を出すので、そのキー列をそのまま使える。

- [ ] **Step 4: 探索が実際に深いところへ届いているか確かめる**

重みを変えた効果を確認する。一時的な計測であり、コミットには含めない。

```rust
#[test]
fn probe_reach() {
    // new_tree に Strategy、current に ValueTree が要る。
    use proptest::strategy::{Strategy, ValueTree};
    use proptest::test_runner::TestRunner;
    let mut runner = TestRunner::default();
    let strategy = prop::collection::vec(weighted_key(), 0..120);
    let (mut max_depth, mut errored) = (0usize, 0u32);
    for _ in 0..300 {
        let keys = strategy.new_tree(&mut runner).unwrap().current();
        let mut state = EngineState::initial();
        for key in keys {
            if state.error.is_some() {
                state = reduce(&state, Key::Ac).0;
                errored += 1;
            }
            state = reduce(&state, key).0;
            max_depth = max_depth.max(display(&state).pending_depth);
        }
    }
    println!("max paren depth reached: {max_depth}, error recoveries: {errored}");
}
```

Run: `cargo test -p calcarc-core --test engine_robustness probe_reach -- --nocapture`
Expected: 括弧の深さが 5 以上に届き、エラーからの復帰が 100 回以上起きていること。届いていなければ重みを見直す。

確認したらこのテストを削除する。**残さないこと。** 計測用であり、性質を検査していない。

- [ ] **Step 5: 整形して全体を確認する**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: すべて成功。既存の 114 件を含む。

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: PASS（6 件）

Run: `cd web && pnpm test && pnpm e2e`
Expected: PASS。Task 1 が `reduce` の挙動を変えているので、UI 側も通ることを確認する。

- [ ] **Step 6: コミット**

```bash
git add crates/calcarc-core/
git commit -F - <<'EOF'
Point the random search at the states it was missing

Drawing uniformly from thirty keys meant hitting an unmatched closing
parenthesis roughly one keystroke in thirty, so about three quarters of
sequences died partway and spent their remaining length on keys the
engine ignores. The search was mostly exploring the error state.

Weight the draw toward operators and parentheses, and press AC when a
sequence errors so the rest of it still counts. With the exhaustive
walks covering short sequences, this run can spend its budget where they
cannot reach: deep nesting, long folds, and repeated recovery.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証手段 |
|---|---|---|
| 1 | DEL の 3 段化と括弧削除（I7） | `engine_table.rs` の固定テスト 3 件 |
| 2 | 不変条件 I1〜I7 の集約、`numerical-policy.md` | 既存 proptest から呼んで通ること |
| 3 | 網羅列挙 2 種 | 合計 6 秒以内で PASS |
| 4 | 重みつき生成器とエラー復帰 | 括弧の深さ 5 以上に到達 |
