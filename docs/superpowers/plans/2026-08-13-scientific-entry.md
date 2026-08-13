# Scientific 入力の意味論（S2）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後置 `j`・`Exp`・`000` を engine に足し、保留中の式を導出するエコー行を表示に足して、S1 が場所だけ確保していたスロットを有効にする。

**Architecture:** `Buffer` を「仮数 + 任意の指数」に広げ、`j` は数字があるとき実部と虚部を切り替える。`Exp` は `+/−` と `DEL` の意味をバッファ内で変える唯一のキーなので、不変条件 I7 の段構成と網羅列挙の等価類を同時に更新する。エコーは `DisplayState` の導出フィールドで、状態は増やさない。

**Tech Stack:** Rust（`calcarc-core` / `calcarc-wasm`）、TypeScript、vitest、Playwright。

## Global Constraints

- **`engine_table.rs` を先に書き換える**（CLAUDE.md: キー列と表示の対応が仕様書）。赤を見てから実装する。
- `calcarc-core` は panic しない。`unwrap`/`expect` は本番経路で禁止（`deny` 済み）。
- **境界は例外を投げない。** エラーは戻り値の一部（`Overflow` は確定時に返す）。
- 新トークンは `zeros3`・`exp`。`crates/calcarc-wasm/tests/token_parity.rs` が Rust と TypeScript の両方への追加を強制する。
- **`STATE_SCHEMA` を 3 → 4 に上げる**（Task 2）。spec §4 の「据え置き」はエコーの
  話であって、§2 の `Buffer.exponent` は **`EngineState` の直列化形状そのものの
  変更**——この定数が番をしている当のものである。実害の比較: 旧い形の状態が
  新しい wasm に届く経路（Service Worker 更新で旧タブが残った窓）では、bump
  しなければ serde の解析失敗で初期状態に戻り、bump すれば `is_valid()` が
  偽で初期状態に戻る。**結果は同じだが、後者は意図した挙動で前者は事故**であり、
  base-spec §40 の永続化が入った時点で差が実害になる。エコー（導出）は
  この理由に含まれない。
- **網羅列挙の予算は実測して記録する。** 長さ 6 のままか、長さ 5 + 重点列挙かを、壁時計とともに報告に書く（spec §6）。
- コミットはブランチガード付き（`test "$(git branch --show-current)" = feature/scientific-entry || exit 1`）。**`git push` と PR 作成は行わない**。Co-Authored-By を付ける。
- ベースライン（S1 完了時点）: Rust 185 / wasm 15 / vitest 71 / e2e 50 / Python 30。

---

### Task 1: 後置 j

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `crates/calcarc-core/src/engine/state.rs`（`Buffer` に切り替えを足す）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`Key::J` の腕）

**Interfaces:**
- Produces: `Buffer::has_digits() -> bool`、`Buffer::toggle_imaginary()`

- [ ] **Step 1: 仕様表に行を足す（先に書く）**

`engine_table.rs` の `j_starts_an_imaginary_entry` の隣に足す。

```rust
#[test]
fn j_after_digits_turns_the_entry_imaginary() {
    // 設計書 §1: 数字があれば j は実部と虚部を切り替える。
    assert_eq!(main_of(&["3", "j"]), "j3");
    assert_eq!(main_of(&["3", "j", "j"]), "3");
    assert_eq!(main_of(&["3", "j", "4"]), "j34");
    assert_eq!(main_of(&["3", "dot", "5", "j"]), "j3.5");
    // 数字が無い j は従来どおり新しい虚部入力を開始する。
    assert_eq!(main_of(&["j", "j", "4"]), "j4");
    // DEL の段構成は変わらない(数字だけ消え、j マーカーが残る)。
    assert_eq!(main_of(&["3", "j", "del"]), "j");
    assert_eq!(main_of(&["3", "j", "del", "del"]), "0");
    // 式の中でも同じ。
    assert_eq!(main_of(&["3", "add", "4", "j", "eq"]), "3+j4");
    assert_eq!(main_of(&["3", "j", "add", "2", "j", "eq"]), "j5");
}
```

- [ ] **Step 2: 赤を確認**

Run: `cargo test -p calcarc-core --test engine_table j_after_digits`
Expected: FAIL（`["3","j"]` が `j` になる——現行は常に新規開始）。

- [ ] **Step 3: `Buffer` に 2 つ足す**

`state.rs` の `impl Buffer` に:

```rust
    /// 打鍵された数字があるか。j の切り替え条件(設計書 §1)。
    pub fn has_digits(&self) -> bool {
        !self.digits.is_empty()
    }

    /// 実部と虚部を切り替える。数字はそのまま残す。
    pub fn toggle_imaginary(&mut self) {
        self.imaginary = !self.imaginary;
    }
```

- [ ] **Step 4: `Key::J` の腕を書き換える**

`mod.rs` の `apply`:

```rust
        Key::J => {
            // 数字があれば実部⇄虚部の切り替え、無ければ新しい虚部入力
            // (設計書 §1)。数字が無いときに切り替えると「実部で数字なし」
            // という無意味な状態になるので、そこは従来どおりにする。
            //
            // 借用を分けているのは、match の腕の中で state.buffer を
            // 差し替えると走査中の借用と衝突するため。
            let toggles = state.buffer.as_ref().is_some_and(Buffer::has_digits);
            if toggles {
                if let Some(buffer) = state.buffer.as_mut() {
                    buffer.toggle_imaginary();
                }
            } else {
                state.buffer = Some(Buffer::imaginary());
            }
        }
```

- [ ] **Step 5: 緑を確認**

Run: `cargo test -p calcarc-core`
Expected: PASS。**I3（虚軸への出口は 2 つだけ）が通ることを確認する**——後置 j は
確定値を触らないので通るはずである。通らなければ検査のほうが正しい。

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates/calcarc-core
git commit  # 件名の趣旨:「数字のあとの j は、その数字を虚部にする」
```

---

### Task 2: Exp

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `crates/calcarc-core/src/engine/state.rs`（`Exponent`、`Buffer` の各メソッド、`STATE_SCHEMA` を 4 へ）
- Modify: `crates/calcarc-core/src/engine/key.rs`（`Key::Exp` とトークン）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`Key::Exp`、`Key::Neg`、`commit_entry`）
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`（`entry_after_del` が `Buffer` を構築しているのでコンパイルが通らなくなる）
- Modify: `Buffer::value()` の呼び出し箇所すべて（コンパイラが教える。現状は `commit_entry` の 1 か所）

**Interfaces:**
- Consumes: Task 1 の `Buffer`
- Produces:
  - `state::Exponent { digits: String, negative: bool }`
  - `Buffer::push_exponent()`、`Buffer::toggle_exponent_sign() -> bool`
  - `Buffer::value() -> CalcResult<Value>`（**戻り型が変わる**）
  - `Key::Exp`（トークン `"exp"`）

- [ ] **Step 1: 仕様表に行を足す（先に書く）**

```rust
#[test]
fn exp_enters_an_exponent() {
    // 設計書 §2。1.5 Exp 3 = 1500。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3"]), "1.5e3");
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "eq"]), "1500");
    // 仮数なしの Exp は仮数 1。表示にも 1 が出る(空の "e3" にはしない)。
    assert_eq!(main_of(&["exp", "3"]), "1e3");
    assert_eq!(main_of(&["exp", "3", "eq"]), "1000");
    // 連打は無視。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "exp"]), "1.5e");
    // 指数は整数。小数点は無視する。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "dot"]), "1.5e3");
    // 指数は 3 桁で頭打ち(4 桁目は無視)。
    assert_eq!(main_of(&["1", "exp", "3", "0", "9", "9"]), "1e309");
    // 先頭ゼロは仮数と同じ規則。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "0", "0", "3"]), "1.5e3");
    // 指数入力中でも後置 j は効く(設計書 §1 の表の最後の行)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "j"]), "j1.5e3");
}

#[test]
fn the_sign_key_follows_the_exponent_while_one_is_open() {
    // 設計書 §2: 指数入力中は指数の符号、それ以外は確定値の符号。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "neg"]), "1.5e-3");
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "neg", "neg"]), "1.5e3");
    // 桁が無くても押せる。順序を変えても同じ値になる。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "neg", "3"]), "1.5e-3");
    // Exp 中でなければ従来どおり確定値の符号。
    assert_eq!(main_of(&["4", "neg"]), "-4");
}

#[test]
fn del_walks_out_of_the_exponent_one_stage_at_a_time() {
    // 段は 指数の桁 → e マーカー → 仮数の文字(設計書 §2)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "del"]), "1.5e");
    assert_eq!(main_of(&["1", "dot", "5", "exp", "3", "del", "del"]), "1.5");
    assert_eq!(
        main_of(&["1", "dot", "5", "exp", "3", "del", "del", "del"]),
        "1."
    );
}

#[test]
fn an_exponent_out_of_range_is_an_error_when_it_is_committed() {
    // 打鍵の途中はエラーにしない。値になる瞬間に Overflow(設計書 §2)。
    assert_eq!(main_of(&["1", "exp", "3", "0", "9"]), "1e309");
    assert_eq!(main_of(&["1", "exp", "3", "0", "9", "eq"]), "Math ERROR");
}
```

- [ ] **Step 2: 赤を確認**

Run: `cargo test -p calcarc-core --test engine_table exp`
Expected: FAIL（`"exp"` は未知のトークンなので無視され、表示が変わらない）。

- [ ] **Step 3: `Exponent` と `Buffer` を書く**

`state.rs`。`MAX_ENTRY_LEN` の隣に足す:

```rust
/// 指数部に打てる桁数。f64 の定義域(約 1e±308)を打鍵で覆える 3 桁にする
/// (設計書 §2)。2 桁だと golden の境界ケースを手で再現できない。
const MAX_EXPONENT_LEN: usize = 3;
```

`Exponent` 型:

```rust
/// 入力中の指数部。`Exp` を押した時点で空のまま存在する。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Exponent {
    pub digits: String,
    pub negative: bool,
}
```

`Buffer` にフィールドを足す:

```rust
pub struct Buffer {
    pub digits: String,
    pub imaginary: bool,
    /// `Exp` を押してから確定するまでの指数部(設計書 §2)。
    pub exponent: Option<Exponent>,
}
```

メソッド:

```rust
    /// `Exp`。すでに指数入力中なら何もしない(連打は無視)。
    pub fn push_exponent(&mut self) {
        self.exponent.get_or_insert_with(Exponent::default);
    }

    /// `+/−`。指数入力中なら指数の符号を反転して true を返す。
    /// そうでなければ何もせず false——呼び出し側が確定値の符号を反転する。
    pub fn toggle_exponent_sign(&mut self) -> bool {
        match self.exponent.as_mut() {
            Some(exponent) => {
                exponent.negative = !exponent.negative;
                true
            }
            None => false,
        }
    }
```

`push_digit` を指数対応にする（先頭ゼロの規則は仮数と共通）:

```rust
    pub fn push_digit(&mut self, d: u8) {
        if d > 9 {
            // Key::Digit は pub なので範囲外の値を構築できる。from_token は
            // 0..=9 しか作らないが、直接渡されると (b'0' + d) が桁上がりして
            // panic する。このクレートは panic しないと約束している。
            return;
        }
        let digit = (b'0' + d) as char;
        // 指数入力中は指数へ入る(設計書 §2)。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.len() >= MAX_EXPONENT_LEN {
                return;
            }
            // 先頭の 0 は次の数字で置き換える。仮数と同じ規則。
            if exponent.digits == "0" {
                exponent.digits.clear();
            }
            exponent.digits.push(digit);
            return;
        }
        if self.digits.len() >= MAX_ENTRY_LEN {
            return;
        }
        if self.digits == "0" {
            self.digits.clear();
        }
        self.digits.push(digit);
    }
```

`push_dot` の先頭に足す（指数は整数）:

```rust
        if self.exponent.is_some() {
            // 指数は整数。小数点は無視する(エラーにはしない——打ち間違いで
            // 計算を止めるほどの事故ではない)。
            return Ok(());
        }
```

`backspace` を段対応にする:

```rust
    pub fn backspace(&mut self) -> Backspace {
        // 段は 指数の桁 → e マーカー → 仮数の文字 → j マーカー の順
        // (設計書 §2)。一度に 1 段だけ戻す。
        if let Some(exponent) = self.exponent.as_mut() {
            if exponent.digits.pop().is_some() {
                return Backspace::Removed;
            }
            self.exponent = None;
            return Backspace::Removed;
        }
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

`text()`:

```rust
    pub fn text(&self) -> String {
        let mantissa = if !self.digits.is_empty() {
            self.digits.clone()
        } else if self.exponent.is_some() {
            // 仮数なしの Exp は仮数 1(実機と同じ)。値と表示を揃える。
            "1".to_string()
        } else if self.imaginary {
            String::new()
        } else {
            "0".to_string()
        };
        let exponent = match &self.exponent {
            Some(e) => format!("e{}{}", if e.negative { "-" } else { "" }, e.digits),
            None => String::new(),
        };
        format!(
            "{}{mantissa}{exponent}",
            if self.imaginary { "j" } else { "" }
        )
    }
```

`value()` を `CalcResult` にする:

```rust
    /// 確定値。`j` だけで数字がなければ j1 と解釈する(設計書 §4.3)。
    /// 指数を付けた結果が f64 の範囲を超えたら Overflow(設計書 §2)。
    pub fn value(&self) -> CalcResult<Value> {
        let mantissa = if self.digits.is_empty() {
            // Exp だけ打った場合の仮数は 1(実機と同じ)。j だけの場合も 1。
            "1".to_string()
        } else {
            self.digits.clone()
        };
        let text = match &self.exponent {
            Some(e) if !e.digits.is_empty() => {
                format!("{mantissa}e{}{}", if e.negative { "-" } else { "" }, e.digits)
            }
            // 桁の無い指数は指数なしと同じ。
            _ => mantissa,
        };
        let n: f64 = text.parse().map_err(|_| CalcError::SyntaxError)?;
        if !n.is_finite() {
            return Err(CalcError::Overflow);
        }
        Ok(if self.imaginary {
            Value::imag(n)
        } else {
            Value::real(n)
        })
    }
```

- [ ] **Step 3b: `STATE_SCHEMA` を 4 に上げる**

`state.rs`:

```rust
/// 状態のスキーマ版。永続化を始めた後に不整合を検出するために持つ。
/// 4: `Buffer` に指数部が入った(設計書 §2)。直列化の形が変わるので上げる。
pub const STATE_SCHEMA: u32 = 4;
```

版を持つ意味は「形が変わったことを検出できる」ことであり、形を変えたら
上げる。上げないと、旧い形の状態が届いたときの初期化が serde の解析失敗
という**事故**として起き、意図した挙動と区別できなくなる。

- [ ] **Step 4: `Key::Exp` を足す**

`key.rs` の `enum Key` に `Exp` を、`from_token` に `"exp" => Key::Exp`、
`token()` に `Key::Exp => "exp"` を足す。

- [ ] **Step 5: `mod.rs` を配線する**

`commit_entry` が `CalcResult` を返すようにする（`value()` の変更に追随）:

```rust
fn commit_entry(state: &mut EngineState) -> CalcResult<()> {
    if let Some(buffer) = state.buffer.take() {
        state.current = buffer.value()?;
    }
    Ok(())
}
```

呼び出し 4 か所（`push_binop`・`apply_unary`・`close_paren`・`finish`）に `?` を足す。

`apply` の腕:

```rust
        Key::Exp => {
            state
                .buffer
                .get_or_insert_with(Buffer::default)
                .push_exponent();
        }
        Key::Neg => {
            // 指数入力中は指数の符号、それ以外は確定値の符号(設計書 §2)。
            let signed_exponent = state
                .buffer
                .as_mut()
                .is_some_and(Buffer::toggle_exponent_sign);
            if !signed_exponent {
                apply_unary(state, |v| Ok(scientific::neg(v)))?;
            }
        }
```

`operator_pending` の match で `Key::Exp` を「場所を動かさないキー」側
（`Key::Digit(_)` と同じ腕）に足し、`Key::Neg` を次に差し替える:

```rust
                // +/− は 2 つの階層で働く(設計書 §2)。指数の符号を変えた
                // ときはバッファが残る——場所は動いていないので旗も残す。
                // 確定値の符号を変えたときはバッファが消え、値が確定する。
                Key::Neg => next.buffer.is_some() && was_pending,
```

- [ ] **Step 6: `engine_robustness.rs` のコンパイルを通す**

`entry_after_del` が `Buffer { digits, imaginary }` を構築しているので、
指数の段を含めて書き直す。**I7 の期待そのもの**なので、実装を写さずに
「外から見た 1 段」を書く:

```rust
    /// DEL 1 回でバッファがどうなるべきか。
    ///
    /// 段は 指数の桁 → e マーカー → 仮数の文字 → j マーカー の順で、
    /// 一度に 1 つだけ消える(設計書 §2)。実装の `Buffer::backspace` を
    /// 写したものではなく、「入力欄から 1 段消える」という外から見た期待を
    /// そのまま書いてある。
    fn entry_after_del(entry: &Buffer) -> Option<Buffer> {
        let mut next = entry.clone();
        if let Some(exponent) = next.exponent.as_mut() {
            if exponent.digits.pop().is_none() {
                next.exponent = None;
            }
            return Some(next);
        }
        next.digits.pop()?;
        if next.digits.is_empty() && !next.imaginary {
            // 実数の入力が空になったらバッファごと消える。表示は確定値に戻る。
            return None;
        }
        Some(next)
    }
```

- [ ] **Step 7: 緑を確認**

Run: `cargo test -p calcarc-core && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS。件数は実測。

- [ ] **Step 8: 赤確認（新設した段を壊して見る）**

`backspace` の指数分岐を「指数ごと捨てる」に変え、
`del_walks_out_of_the_exponent_one_stage_at_a_time` が赤になることを確認して
戻す。**実出力を報告に貼る。**

- [ ] **Step 9: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates/calcarc-core
git commit  # 件名の趣旨:「指数はバッファの第 2 段で、+/− と DEL がそこに従う」
```

---

### Task 3: 000

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `crates/calcarc-core/src/engine/state.rs`
- Modify: `crates/calcarc-core/src/engine/key.rs`
- Modify: `crates/calcarc-core/src/engine/mod.rs`

**Interfaces:**
- Produces: `Buffer::push_zeros()`、`Key::Zeros3`（トークン `"zeros3"`）

- [ ] **Step 1: 仕様表に行を足す（先に書く）**

```rust
#[test]
fn the_triple_zero_key_adds_three_zeros_at_most() {
    // 設計書 §3。押した回数と消える回数が食い違わないよう、Digit(0) の
    // 3 連ではなく 1 打鍵として扱う。
    assert_eq!(main_of(&["1", "zeros3"]), "1000");
    // 先頭ゼロは増えない(現行の規則をそのまま適用)。
    assert_eq!(main_of(&["zeros3"]), "0");
    assert_eq!(main_of(&["0", "zeros3"]), "0");
    // 残り字数に収まるぶんだけ入る(MAX_ENTRY_LEN は 12)。
    assert_eq!(
        main_of(&["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "zeros3"]),
        "123456789000"
    );
    // DEL は 1 文字ずつ。
    assert_eq!(main_of(&["1", "zeros3", "del"]), "100");
    // 指数入力中は指数へ入る(3 桁上限、先頭ゼロ規則も同じ)。
    assert_eq!(main_of(&["1", "dot", "5", "exp", "zeros3"]), "1.5e0");
}
```

- [ ] **Step 2: 赤を確認**

Run: `cargo test -p calcarc-core --test engine_table triple_zero`
Expected: FAIL（`"zeros3"` は未知のトークン）。

- [ ] **Step 3: 実装**

`state.rs`:

```rust
    /// `000`。0 を 3 つ入れる。字数制限に収まるぶんだけ入り、先頭ゼロの
    /// 規則も 1 つずつ押したときと同じになる(設計書 §3)。
    pub fn push_zeros(&mut self) {
        for _ in 0..3 {
            self.push_digit(0);
        }
    }
```

`key.rs` に `Key::Zeros3` と `"zeros3"` を足す。`mod.rs` の `apply`:

```rust
        Key::Zeros3 => {
            state
                .buffer
                .get_or_insert_with(Buffer::default)
                .push_zeros();
        }
```

`operator_pending` の match では `Key::Digit(_)` と同じ腕に足す（場所を動かさない）。

- [ ] **Step 4: 緑を確認**

Run: `cargo test -p calcarc-core`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates/calcarc-core
git commit  # 件名の趣旨:「000 は 1 打鍵で、字数の許すぶんだけ 0 を置く」
```

---

### Task 4: 不変条件と網羅列挙

**Files:**
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`

- [ ] **Step 1: 等価類に `Exp` を足し、`000` は畳む**

`ALL_CLASSES` を 15 個にする。**`000` は足さない**——`Digit` と同じ「バッファに
数字を足す」枝であり、状態機械への作用が同じだからである（境界は Task 3 の
個別テストが持つ）。コメントで理由を書く:

```rust
/// 全等価類の網。表示トグル・後置関数・定数・ゼロを足すぶん長さ 6 まで。
///
/// `Exp` は畳めない。バッファの構造そのもの(仮数/指数)を変え、`+/−` と
/// `DEL` の意味まで変えるので、他のどのキーとも作用が違う(設計書 §6)。
/// 逆に `000` は畳む——`Digit` と同じ「数字を足す」枝で、違うのは文字数
/// だけである。字数の境界は engine_table の個別テストが持つ。
const ALL_CLASSES: [Key; 15] = [
    // …既存の 14 個…
    Key::Exp,
];
```

- [ ] **Step 2: 予算を実測する**

Run: `cargo test -p calcarc-core --test engine_robustness -- --nocapture 2>&1 | tail -5`
Run: `time cargo test -p calcarc-core --test engine_robustness`

**壁時計を記録する。** 6 秒を大きく超える場合は、網の長さを 6 から 5 に落とし、
**落としたことと実測値をコメントに書く**（次に読む人が再判断できるように）。
長さを変える場合は `exhaustive_to_length_six` 系のテスト名も実態に合わせる。

- [ ] **Step 3: I7 の赤確認**

`entry_after_del`（Task 2 で更新済み）が本当に段を見張っていることを確かめる。
`Buffer::backspace` の指数分岐を「1 回で指数ごと捨てる」に変え、
**網羅列挙が I7 で赤になる**ことを確認して戻す。**実出力を報告に貼る。**

- [ ] **Step 4: 緑を確認してコミット**

Run: `cargo test --workspace`

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates/calcarc-core
git commit  # 件名の趣旨:「Exp は畳めない等価類、000 は畳める」
```

---

### Task 5: 式エコー（導出）

**Files:**
- Modify: `crates/calcarc-core/src/engine/display.rs`
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Produces: `DisplayState.echo: String`

- [ ] **Step 1: 仕様表に行を足す（先に書く）**

`engine_table.rs` に、`main_of` と同じ形の `echo_of` を足してから:

```rust
fn echo_of(tokens: &[&str]) -> String {
    press(tokens).1.echo
}

#[test]
fn the_echo_shows_the_pending_expression() {
    // 設計書 §4: 保留中の式を状態から導出する。打鍵履歴は持たない。
    assert_eq!(echo_of(&["3", "add"]), "3 +");
    assert_eq!(echo_of(&["3", "add", "4", "mul"]), "3 + 4 ×");
    assert_eq!(echo_of(&["3", "add", "lparen", "4"]), "3 + ( 4");
    assert_eq!(echo_of(&["j", "4", "mul"]), "j4 ×");
    // = で確定するとスタックが空になり、echo も空になる。
    assert_eq!(echo_of(&["3", "add", "4", "eq"]), "");
    // 保留式が無いあいだは空(main が値を見せている)。
    assert_eq!(echo_of(&["1", "dot", "5", "exp", "3"]), "");
    // 畳まれたものは畳まれた姿で見える(設計書 §4 の制限)。
    assert_eq!(echo_of(&["3", "0", "sin", "add"]), "0.5 +");
    assert_eq!(echo_of(&["2", "mul", "3", "add"]), "6 +");
    // エラー中は保留を伏せる(pending_op と同じ扱い)。
    assert_eq!(echo_of(&["1", "div", "0", "eq"]), "");
}
```

- [ ] **Step 2: 赤を確認**

Run: `cargo test -p calcarc-core --test engine_table echo`
Expected: FAIL（`DisplayState` に `echo` が無くコンパイルできない）。

- [ ] **Step 3: `render` に導出を足す**

`display.rs`:

```rust
/// 保留中の式を組み立てる(設計書 §4)。
///
/// 打鍵履歴ではなく**スタックの形**を見せる。後置関数は押した瞬間に値へ
/// 畳まれ、優先順位でも畳まれるので、`2 × 3 +` は `6 +` と出る。履歴を
/// 見せるには状態を増やす必要があり、それは要望が残ったときの別の設計。
fn echo_of(state: &EngineState) -> String {
    if state.operators.is_empty() {
        // 保留が無いなら main が値を見せている。二重に出さない。
        return String::new();
    }
    let mut parts: Vec<String> = Vec::new();
    let mut operands = state.operands.iter();
    for token in &state.operators {
        match token {
            OpToken::Op(op) => {
                if let Some(value) = operands.next() {
                    parts.push(format_rect(*value));
                }
                parts.push(op_symbol(*op).to_string());
            }
            OpToken::OpenParen => parts.push("(".to_string()),
        }
    }
    for value in operands {
        parts.push(format_rect(*value));
    }
    if let Some(buffer) = &state.buffer {
        parts.push(buffer.text());
    }
    parts.join(" ")
}

/// 演算子の記号。`pending_op` を UI 側で記号にしているのと同じ対応。
fn op_symbol(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "−",
        BinOp::Mul => "×",
        BinOp::Div => "÷",
    }
}
```

`DisplayState` に `pub echo: String` を足し、`render` で
`echo: if has_error { String::new() } else { echo_of(state) }` を返す。

- [ ] **Step 4: 緑を確認**

Run: `cargo test -p calcarc-core && cargo clippy --workspace --all-targets -- -D warnings`

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates/calcarc-core
git commit  # 件名の趣旨:「エコーはスタックの形であって、打鍵の履歴ではない」
```

---

### Task 6: 境界と UI とフルスイープ

**Files:**
- Modify: `crates/calcarc-wasm/tests/web.rs`（新トークンの往復）
- Modify: `web/src/calc/types.ts`（`KEY_TOKENS` と `DisplayState`）
- Modify: `web/src/ui/Keypad/scientific.ts`（予約解除）
- Modify: `web/src/ui/Keypad/Keypad.test.tsx`（予約スロットの前提が変わる）
- Modify: `web/src/ui/Display/Display.tsx`（echo を流す）
- Modify: `web/tests/e2e/keypad-shell.spec.ts`（予約スロットの検査を実挙動に。
  **π の Shift 経路テストが `"指数入力（準備中）"` を 3 箇所参照している**ので、
  有効化後の aria 名 `"指数入力"` に直す——直さないと赤になる）
- Create: `web/tests/e2e/entry.spec.ts`

- [ ] **Step 1: TypeScript 側にトークンと echo を足す**

`web/src/calc/types.ts` の `KEY_TOKENS` に `"zeros3"` と `"exp"` を足し、
`DisplayState` に `echo: string` を足す。

- [ ] **Step 2: `token_parity` が緑になることを確認**

Run: `cargo test -p calcarc-wasm --test token_parity`（wasm32 以外でも動く検査）
Expected: PASS。落ちるなら足し忘れがある。

- [ ] **Step 3: wasm の往復テストを足す**

`crates/calcarc-wasm/tests/web.rs`:

```rust
#[wasm_bindgen_test]
fn the_new_entry_keys_cross_the_boundary() {
    // 1.5 Exp 3 = 1500、および 1 000 = 1000。
    let step = press(
        calcarc_wasm::initial_state(),
        &["1", "dot", "5", "exp", "3", "eq"],
    );
    assert_eq!(main_text(&step), "1500");
    let step = press(calcarc_wasm::initial_state(), &["1", "zeros3"]);
    assert_eq!(main_text(&step), "1000");
    // 後置 j とエコー行も境界を越える。
    let step = press(calcarc_wasm::initial_state(), &["3", "j", "add"]);
    assert_eq!(
        get(&get(&step, "display"), "echo").as_string().as_deref(),
        Some("j3 +")
    );
}
```

- [ ] **Step 4: 盤面の予約を解く**

`web/src/ui/Keypad/scientific.ts`:
- `000` の `token: null` → `token: "zeros3"`、`ariaLabel` を `"3桁のゼロ"` に
- `Exp` の `token: null` → `token: "exp"`、`ariaLabel` を `"指数入力"` に

`Keypad.test.tsx` の `reserves the slots S2 fills` を、**第 2 面の空きスロット
だけが残る**形に書き換える:

```tsx
  it("has no reserved slots left on the first face", () => {
    // S2 で 000 と Exp が有効になった。残る予約は第 2 面の空きだけ。
    const reserved = allKeys.filter((k) => k.token === null && !k.kind);
    expect(reserved).toHaveLength(0);
  });
```

- [ ] **Step 5: echo を表示に流す**

`web/src/ui/Display/Display.tsx` の `echo=""` を `echo={display.echo}` にする。

- [ ] **Step 6: E2E を書く**

`web/tests/e2e/entry.spec.ts`:

```ts
import { type Page, expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("Exp types an exponent and the sign key follows it", async ({ page }) => {
  await press(page, ["1", "小数点", "5", "指数入力", "3"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e3");
  await press(page, ["符号を反転"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e-3");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.0015");
});

test("the triple zero key is live now", async ({ page }) => {
  await press(page, ["1", "3桁のゼロ"]);
  await expect(page.getByTestId("display-main")).toHaveText("1000");
});

test("j after digits turns the entry imaginary", async ({ page }) => {
  await press(page, ["3", "虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("j3");
  await press(page, ["虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("3");
});

test("the echo line shows the pending expression", async ({ page }) => {
  await press(page, ["3", "足す", "4", "掛ける"]);
  await expect(page.getByTestId("display-echo")).toHaveText("3 + 4 ×");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});
```

`keypad-shell.spec.ts` の「予約スロットは押しても何も起きない」は、
`000` が有効になったので**第 2 面の空きスロット**を対象に書き換える。

- [ ] **Step 7: フルスイープ**

**4173 を掴んでいる `vite preview` が居ないか先に確認する**
（`ss -ltnp | grep 4173`。居ると古いビルドに対して E2E が走る）。

Run:
```bash
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
wasm-pack test --headless --chrome crates/calcarc-wasm
# 手元の Chrome と wasm-pack の chromedriver が噛み合わない場合(M6 で実際に
# 起きた)は --firefox で代替し、**代替したことを報告に書く**。CI は chrome。
cd web && pnpm wasm && pnpm typecheck && pnpm lint && pnpm test && pnpm exec vite build && pnpm check:sw && pnpm e2e
```
Python は触っていないので回さない（tiering）。件数はすべて実測して報告に書く。

- [ ] **Step 8: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-entry || exit 1
git add crates web
git commit  # 件名の趣旨:「予約を解いて、新しい打鍵を画面から使えるようにする」
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | 後置 j | cargo（engine_table 先行） | §1 |
| 2 | Exp（+/− と DEL の段） | cargo（+ 赤確認） | §2 |
| 3 | 000 | cargo | §3 |
| 4 | 等価類 15 と I7 の段 | cargo（予算実測 + 赤確認） | §6 |
| 5 | 式エコー（導出） | cargo | §4 |
| 6 | トークン・UI・E2E | 全レイヤー（Python 以外） | §7/§8 |
