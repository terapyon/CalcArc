# S-3 階乗・順列・組合せ — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `n!`（後置単項）と `nPr` / `nCr`（優先順位 3 の左結合二項）を足す。
定義域は**非負整数**に閉じる。

**Architecture:** `n!` は `apply_unary` にそのまま乗り、エンジンの構造は動かない。
`nPr` / `nCr` は `BinOp` に 2 つ足すだけで、**S-1 が `push_binop` の畳み込み条件を
結合方向つきに書き換え済み**なので、`is_right_associative` が `false` を返す限り
追加コードは要らない。**優先順位 3 は S-1 が空けてある。** 盤面は**数字 `7` `8` `9` の
Shift**——このリポジトリで数字キーに Shift が付く初めての例である。

**Tech Stack:** Rust / mpmath + Python の任意精度整数（参照実装）/ wasm-bindgen /
TypeScript / React 19 / vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-08-16-probability-keys-design.md`

**ブランチ:** `feature/probability-keys`（`feature/scientific-real-functions` の上に縦積み）

---

## ⚠ 着手前に読む: 設計書 §4 の主張が 1 つ間違っている

**設計書 §4 は `nCr` の計算をこう書いている:**

```
C(n, r) = Π[i=0..r-1] (n − i) / (i + 1)
```

> 各段の途中値は常に `C(n, i+1)` そのものなので、**答が収まるなら途中も収まる**。

**この最後の一文は偽である**（2026-08-16、plan 起草時に実測）。

途中値は `acc * (n−i)` を経由するので、**答の最大 `r` 倍**まで膨らむ。
実測した反例:

| `n` | `C(n, n/2)` | 掛けてから割る（設計書の式） | 割ってから掛ける |
|---|---|---|---|
| 1020 | 2.8063e305 | 2.8063e305 | 2.8063e305 |
| **1022** | **1.1214e306** | **途中で Overflow** | 1.1214e306 |
| **1024** | **4.4813e306** | **途中で Overflow** | 4.4813e306 |
| **1028** | **7.1561e307** | **途中で Overflow** | 7.1561e307 |

**`n = 1022`〜`1028` は、答が f64 に収まるのに設計書の式では落ちる。**

**この計画は「割ってから掛ける」を実装する**（`acc = acc / (i+1) * (n−i)`）。
精度は変わらない——4,000 組の無作為な `(n, r)` で最悪相対誤差を実測した:

| 式 | 最悪相対誤差 |
|---|---|
| 掛けてから割る（設計書） | 3.486e-15 |
| **割ってから掛ける（この計画）** | **3.566e-15** |

**どちらも表示の 10 桁（1e-10 相当）より 5 桁良い。** 精度を捨てずに定義域が広がる
ので、選ばない理由が無い。

**Task 1 が設計書 §4 のこの一文を訂正する。** 訂正せずに実装すると、
**「答が収まるなら途中も収まる」という偽の主張が spec に残ったまま、実装だけが
正しい**という形になる（このリポジトリで何度も踏んでいる形）。

---

## Global Constraints

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない
- **`calcarc-core` は panic しない**（`unwrap` / `expect` は lint が禁じている。
  テストコードは除く）
- **WASM 境界は JavaScript 例外を投げない**
- **許容誤差をテストコードに書かない。** 言語間検証は `testdata/*.json` の `tolerance`、
  Rust のユニットテストは `calcarc_core::assert_close`
- **参照実装を Rust の移植にしない。** Rust は **f64 の逐次乗除**、Python は
  **任意精度の整数**（`math.factorial` / `math.perm` / `math.comb`）。
  **アルゴリズムが同型でないことがこの spec の独立性の中心である**（設計書 §5）
- **電卓の挙動は `crates/calcarc-core/tests/engine_table.rs` が仕様書。**
  キー列と表示の対応を**先に変えてから**実装を直す
- **`STATE_SCHEMA` を上げない。** `BinOp` に variant を足すのは**広げるだけ**で、
  既存の直列化された状態は今までどおり読める（**S-4 が 5 → 6 に上げる。
  ここで上げると番号を奪う**）
- **5×5 のメイングリッドを 1 キーも動かさない。** `7` `8` `9` に**第 2 面を足すだけ**で、
  第 1 面のラベル・位置・寸法は変えない
- **区画の `ariaLabel` を変えない**（E2E のセレクタ）
- コミット前に **`cargo fmt`**（`--check` は直してくれない）
- **検証コマンドは `&&` で機械的に繋ぐ。** 出力の件数を目で見て判断しない
  （S-1 で clippy が赤のままコミットした。数を数えて続行させたのが原因）
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **`git push` と PR 作成は行わない**
- **共有ワークツリーである。コミットを含むコマンドは必ず**
  `test "$(git branch --show-current)" = feature/probability-keys && git commit ...`
  **の形にする。** `git checkout` / `git switch` でブランチを切り替えない
- E2E のポートは **4179**。**撮り終えたら preview を必ず落とす**
- `uv` のコマンドには必ず **`--no-config`** を付ける

## 他セッションとの約束（設計書 §8.1。合意済み）

`feature/e2e-corpus`（別セッション、worktree `/home/terapyon/dev/CalcArc-e2e`）が
4,000 件の検証コーパスを持つ。**あの worktree に触らない。**

1. **`KEY_TOKENS` は足すだけ。既存の綴りを 1 文字も変えない・消さない。**
   足すのは **`n_fact` `n_p_r` `n_c_r` の 3 つ**（設計書 §8.1 で綴りまで合意済み）
2. **`reference/src/calcarc_reference/corpus_expr.py` の `UNARY_FNS` / `BINARY_OPS`
   に触らない**（このブランチには存在しない。**作らないこと**）
3. **記法の約束 3 つを壊さない**——単項は後置 / 二項は必ず括弧で囲む / 終わりは `eq`。
   `n!` は `apply_unary`（後置）、`nPr` / `nCr` は二項として足すだけなので当たらない
4. **`engine_table.rs` は行を足すだけ。既存の行を書き換えない**
   （S-1 では 1 行だけ書き換えて名指しで伝えた。**S-3 では 0 件の見込み**。
   もし書き換える必要が出たら、**実装前に**名指しで伝える）
5. **表示書式を変えない**（`parseDisplay` が実測で固定している）

**相手は段階 3c（括弧を省いたキー列）に着手する。** 優先順位と結合方向を数千件で
照合するようになるので、**Task 3 を終えた時点で「優先順位 3・左結合」を伝える**
（Task 9 まで待たない——相手の 3c の設計に効く）。

---

## ファイル構成

```text
docs/superpowers/specs/2026-08-16-probability-keys-design.md  §4 の訂正（Task 1）
docs/numerical-policy.md                        f64 で整数を返す件（Task 1・8）
crates/calcarc-core/src/scientific/mod.rs       factorial / npr / ncr（Task 2）
reference/src/calcarc_reference/scientific_ref.py  厳密整数の参照（Task 3）
reference/src/calcarc_reference/cases.py        入力ケース（Task 3）
reference/scripts/generate.py                   build_scientific の拡張（Task 3）
reference/tests/test_scientific_ref.py          参照実装自身のテスト（Task 3）
crates/calcarc-core/tests/golden.rs             op の腕 3 つ（Task 3）
testdata/scientific.json                        再生成（Task 3）
crates/calcarc-core/src/engine/state.rs         BinOp に Npr / Ncr（Task 4）
crates/calcarc-core/src/engine/key.rs           Key 3 つ・ALL を 42→45（Task 4）
crates/calcarc-core/src/engine/mod.rs           apply / reduce / apply_binop（Task 4）
crates/calcarc-core/src/engine/display.rs       op_symbol に P / C（Task 4）
crates/calcarc-core/tests/engine_table.rs       キー列と表示（Task 4）
crates/calcarc-core/tests/engine_robustness.rs  FOCUS に 2 つ（Task 5）
web/src/calc/types.ts                           KEY_TOKENS / BinOpName（Task 4）
web/src/ui/Display/Display.tsx                  OP_SYMBOL（Task 4）
web/src/ui/Keypad/scientific.ts                 7/8/9 の Shift 面（Task 4）
web/src/ui/Keypad/scientific.test.ts            盤面の検査（Task 4）
web/tests/e2e/probability-keys.spec.ts          新設（Task 7）
```

## 検証の段付け

| 段 | コマンド | いつ回すか |
|---|---|---|
| 1 | `cargo test -p calcarc-core` | コアを触った全タスク |
| 2 | `cd reference && uv run --no-config pytest` | 参照を触ったタスク（3） |
| 3 | `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` | golden / トークンを触ったタスク |
| 4 | `cd web && pnpm test && pnpm lint` | web を触ったタスク（4） |
| 5 | `cd web && pnpm e2e` | Task 7 と**ブランチ末尾 1 回**（Task 8） |
| 6 | `wasm-pack test --headless --firefox crates/calcarc-wasm` | **ブランチ末尾**（Task 8）。**chrome は手元で版ずれで落ちる**（ChromeDriver 152 / Chrome 135）ので firefox で回して**件数を報告する**。28 件が基準 |

---

### Task 1: 設計書の偽の主張を先に訂正する

**1 行も実装しない。** この計画の冒頭で実測した反例を、設計書と数値方針に書く。
**実装より先にやる**——先にやらないと「spec は偽のまま、実装だけ正しい」になる。

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-probability-keys-design.md` §4
- Modify: `docs/numerical-policy.md`

**Interfaces:** なし（文書のみ）

- [ ] **Step 1: 設計書 §4 の `nCr` の段落を訂正する**

「**乗除を交互にする形で書く**」以下を、こう置き換える:

```markdown
**乗除を交互にする形で書く。順序は「割ってから掛ける」である**:

C(n, r) = 各段で  acc ← acc / (i+1) × (n − i)      （i = 0..r−1）

`r` を `min(r, n−r)` に置き換えて反復回数も減らす。

**【訂正 2026-08-16、実装計画の起草時に実測】** 当初この節は
`acc ← acc × (n − i) / (i + 1)`（掛けてから割る）と書き、
「各段の途中値は常に `C(n, i+1)` そのものなので、**答が収まるなら途中も収まる**」
と主張していた。**後半は偽である。** 途中値は `acc × (n − i)` を経由するので
**答の最大 `r` 倍**まで膨らみ、`n = 1022`〜`1028` の中心二項係数は
**答が f64 に収まるのに途中で `Overflow` する**（実測）。

| `n` | `C(n, n/2)` | 掛けてから割る | 割ってから掛ける |
|---|---|---|---|
| 1020 | 2.8063e305 | 2.8063e305 | 2.8063e305 |
| 1022 | 1.1214e306 | **Overflow** | 1.1214e306 |
| 1028 | 7.1561e307 | **Overflow** | 7.1561e307 |

**割ってから掛ける形にすると、この帯が消える。** 精度は変わらない——無作為な
4,000 組の `(n, r)` で最悪相対誤差は 3.486e-15（掛け先）と 3.566e-15（割り先）で、
**どちらも表示の 10 桁より 5 桁良い**。精度を捨てずに定義域が広がるので、
割ってから掛ける形を採る。

**`acc / (i+1)` は整数にならないことがある**（`C(5,2)` の途中で 2.5 を通る）。
それでよい——f64 はもともと厳密ではなく、測るべきは**表示の 10 桁が正しいか**
だけである。golden がそれを固定する。
```

§8 の必須ケースにも足す:

```markdown
**必須ケース（案）**: ... `200 nCr 100`（途中であふれない証拠）、
**`1022 nCr 511`（掛けてから割る形なら Overflow する帯の証拠。§4 の訂正）**、
`1000 nCr 500`（f64 の上限近く）/ 優先順位 `5 × 4 nCr 2`。
```

- [ ] **Step 2: `docs/numerical-policy.md` に節を足す**

「関数の定義域」節（S-1 が作った）の直後に:

```markdown
## 整数を返す演算を f64 でやること

`n!` `nPr` `nCr` は数学的には整数を返すが、`Value` は f64 である。

**`20!` = 2,432,902,008,176,640,000 は `2^53` を超えており、f64 では既に厳密でない。**
それでも困らないのは、**表示が有効数字 10 桁だから**である。

実測（2026-08-16）:

| | 相対誤差 | 表示に必要な精度 |
|---|---|---|
| `170!`（f64 の逐次乗算） | 6.9e-16 | 1e-10 |
| `nCr`（割ってから掛ける、無作為 4,000 組の最悪） | 3.6e-15 | 1e-10 |

**5 桁の余裕がある。表示される 10 桁はすべて正しい。**

上限は `170!` ≈ 7.257e306 で、**`171!` は `Overflow`** になる。

**`nCr` は「割ってから掛ける」**（`acc / (i+1) * (n-i)`）。素直に
`n! / (r!(n−r)!)` と書くと `200 nCr 100`（答は 9.05e58）が途中で溢れて落ちる。
掛けてから割る形でも `n = 1022`〜`1028` の帯が落ちる。**答が収まるなら途中も
収まる、という性質はこの順序でしか成り立たない。**

**厳密な整数表示はスコープ外である**（設計書 §9）。`20!` は
`2.432902008e18` と出る。19 桁は画面に入らない。
```

- [ ] **Step 3: コミット**

```bash
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Correct the spec's claim that nCr cannot overflow in the middle

It said the running value is always C(n, i+1), so an answer that fits
means the intermediates fit. The running value passes through
acc × (n − i) first, which is up to r times the answer, and the
central binomials for n = 1022..1028 fit in f64 while that product
does not.

Dividing before multiplying closes the band for nothing: worst
relative error over 4000 random (n, r) is 3.57e-15 against 3.49e-15,
both five orders below what ten displayed digits need.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `factorial` / `npr` / `ncr` をコアに足す

**キーはまだ足さない。** `Key::ALL` に足すと `token_parity.rs` が TypeScript との
一致を要求し、盤面まで同じコミットに引きずられる（S-1 で確認済みの依存）。

**Files:**
- Modify: `crates/calcarc-core/src/scientific/mod.rs`

**Interfaces:**
- Consumes: `CalcError::DomainError` と `scientific::real_arg`（S-1 が用意した。
  複素引数を弾く共通の入口）
- Produces:
  ```rust
  pub fn factorial(v: Value) -> CalcResult<Value>
  pub fn npr(n: Value, r: Value) -> CalcResult<Value>
  pub fn ncr(n: Value, r: Value) -> CalcResult<Value>
  ```

- [ ] **Step 1: 失敗するユニットテストを書く**

`mod tests` に足す。**許容誤差を書かない**（`close` が `TEST_EPSILON` を読む）。

```rust
    #[test]
    fn factorial_of_small_integers() {
        assert_eq!(factorial(Value::real(0.0)).unwrap(), Value::real(1.0));
        assert_eq!(factorial(Value::real(1.0)).unwrap(), Value::real(1.0));
        assert_eq!(factorial(Value::real(5.0)).unwrap(), Value::real(120.0));
        close(factorial(Value::real(20.0)).unwrap().re, 2.43290200817664e18);
    }

    #[test]
    fn factorial_stops_at_the_f64_ceiling() {
        // 170! は収まり、171! は溢れる（設計書 §4）。
        assert!(factorial(Value::real(170.0)).is_ok());
        assert_eq!(factorial(Value::real(171.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn factorial_is_only_defined_on_non_negative_integers() {
        // ガンマ関数には広げない（設計書 §3 の裁定 3）。
        assert_eq!(factorial(Value::real(2.5)), Err(CalcError::DomainError));
        assert_eq!(factorial(Value::real(-1.0)), Err(CalcError::DomainError));
        assert_eq!(
            factorial(Value::new(3.0, 4.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn permutations_and_combinations_of_small_numbers() {
        assert_eq!(npr(Value::real(5.0), Value::real(2.0)).unwrap(), Value::real(20.0));
        assert_eq!(ncr(Value::real(5.0), Value::real(2.0)).unwrap(), Value::real(10.0));
    }

    #[test]
    fn the_boundaries_are_all_one() {
        // 0! = nP0 = nC0 = nCn = 1（設計書 §3）。
        assert_eq!(npr(Value::real(5.0), Value::real(0.0)).unwrap(), Value::real(1.0));
        assert_eq!(ncr(Value::real(5.0), Value::real(0.0)).unwrap(), Value::real(1.0));
        assert_eq!(ncr(Value::real(5.0), Value::real(5.0)).unwrap(), Value::real(1.0));
    }

    #[test]
    fn r_may_not_exceed_n() {
        assert_eq!(
            ncr(Value::real(5.0), Value::real(6.0)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            npr(Value::real(5.0), Value::real(6.0)),
            Err(CalcError::DomainError)
        );
        // 非整数と負も定義域の外。
        assert_eq!(
            ncr(Value::real(5.5), Value::real(2.0)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            ncr(Value::real(5.0), Value::real(-1.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn ncr_does_not_overflow_on_the_way_to_an_answer_that_fits() {
        // **設計書 §4 の主張、訂正版。** 素直な n!/(r!(n-r)!) は 200! が
        // 溢れて落ちる。掛けてから割る形は n = 1022 の帯で落ちる。
        // 割ってから掛ける形だけが両方を通る（計画の冒頭に実測表）。
        close(ncr(Value::real(200.0), Value::real(100.0)).unwrap().re, 9.054851465610164e58);
        close(ncr(Value::real(1000.0), Value::real(500.0)).unwrap().re, 2.7028824094543655e299);
        // **この行が「割ってから掛ける」でしか通らない。**
        close(ncr(Value::real(1022.0), Value::real(511.0)).unwrap().re, 1.1214087642units);
    }
```

**注意**: 最後の行の期待値は `1.1214087642e306` である
（`units` はこの計画の誤植ではなく、**実装者が実測して埋める箇所**——
`cargo test` の失敗出力に出る実際の f64 を使うこと。10 桁表示は
`1.121408764e306`）。

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **コンパイルエラー**（`cannot find function `factorial``）。

- [ ] **Step 3: 実装する**

`scientific/mod.rs` の `recip` の後ろに足す。

```rust
/// 非負整数の引数を取り出す。`n!` / `nPr` / `nCr` の共通の入口（設計書 §3）。
///
/// 複素数は `real_arg` が弾く。ここで見るのは「非負の整数か」だけである。
fn non_negative_integer(v: Value) -> CalcResult<f64> {
    let x = real_arg(v)?;
    if !x.is_finite() || x < 0.0 || x.fract() != 0.0 {
        return Err(CalcError::DomainError);
    }
    Ok(x)
}

/// 階乗。定義域は**非負整数**（設計書 §3 の裁定 3）。
///
/// `2.5!` はガンマ関数だが入れない——「関数は実数に閉じる、面倒な拡張は
/// しない」という S-1 の精神と同じである。
///
/// `170!` ≈ 7.26e306 が f64 の上限で、`171!` は `Overflow` になる。
/// **f64 は `20!` の時点で既に厳密ではない**が、表示は有効数字 10 桁なので
/// 表示される桁はすべて正しい（実測 6.9e-16。numerical-policy を参照）。
pub fn factorial(v: Value) -> CalcResult<Value> {
    let n = non_negative_integer(v)?;
    let mut acc = 1.0_f64;
    let mut i = 2.0_f64;
    while i <= n {
        acc *= i;
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
}

/// 順列 nPr = n(n−1)…(n−r+1)。定義域は非負整数で `r ≤ n`（設計書 §3）。
///
/// 素直な積でよい——答より大きい途中値が出ない。
pub fn npr(n: Value, r: Value) -> CalcResult<Value> {
    let (n, r) = check_pair(n, r)?;
    let mut acc = 1.0_f64;
    let mut i = 0.0_f64;
    while i < r {
        acc *= n - i;
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
}

/// 組合せ nCr。定義域は非負整数で `r ≤ n`（設計書 §3）。
///
/// **割ってから掛ける。順序が定義域を決める**（設計書 §4 の訂正）:
///
/// - 素直な `n!/(r!(n−r)!)` は `200 nCr 100`（答は 9.05e58）で `200!` が
///   溢れて落ちる
/// - 掛けてから割る（`acc * (n−i) / (i+1)`）は、途中値が答の最大 `r` 倍に
///   なるので `n = 1022`〜`1028` の中心二項係数が**答は収まるのに**落ちる
/// - **割ってから掛ける**（`acc / (i+1) * (n−i)`）だけが両方を通る
///
/// 精度は落ちない。無作為な 4,000 組で最悪相対誤差 3.6e-15 であり、
/// 表示の 10 桁より 5 桁良い（実測）。途中で整数にならない段があるが
/// （`C(5,2)` は 2.5 を通る）、f64 はもともと厳密ではない。
pub fn ncr(n: Value, r: Value) -> CalcResult<Value> {
    let (n, r) = check_pair(n, r)?;
    // 反復回数を減らす。C(n, r) = C(n, n−r)。
    let r = if r > n - r { n - r } else { r };
    let mut acc = 1.0_f64;
    let mut i = 0.0_f64;
    while i < r {
        acc = acc / (i + 1.0) * (n - i);
        if !acc.is_finite() {
            return Err(CalcError::Overflow);
        }
        i += 1.0;
    }
    Value::real(acc).finalize()
}

/// `nPr` / `nCr` の 2 引数を検査する。どちらも非負整数で、`r ≤ n`。
fn check_pair(n: Value, r: Value) -> CalcResult<(f64, f64)> {
    let n = non_negative_integer(n)?;
    let r = non_negative_integer(r)?;
    if r > n {
        return Err(CalcError::DomainError);
    }
    Ok((n, r))
}
```

- [ ] **Step 4: 緑を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **PASS**。`1022 nCr 511` の期待値は失敗出力の実測値で埋めること。

- [ ] **Step 5: 赤確認 — 順序が定義域を決めることを見る**

**設計書 §4 の訂正が、実装のどこに支えられているかを確かめる。**
`ncr` の 1 行を掛けてから割る形に変える:

```rust
        acc = acc * (n - i) / (i + 1.0);
```

```bash
cargo test -p calcarc-core --lib scientific 2>&1 | grep -E 'FAILED|test result'
```

期待: **`ncr_does_not_overflow_on_the_way_to_an_answer_that_fits` が FAILED**。
`1022 nCr 511` だけが落ち、`200 nCr 100` と `1000 nCr 500` は緑のままであること
**も確かめる**——落ちる範囲が実測表と一致していることの確認である。

さらに素直な形（`factorial(n) / (factorial(r) * factorial(n-r))`）にも一度変えて、
**`200 nCr 100` も落ちる**ことを見る。**3 つの書き方で定義域が 3 段階に違う**、
というのがこのタスクの主張である。

**再編集で Step 3 の形に戻し**、緑を見る。

- [ ] **Step 6: コミット**

```bash
cargo fmt && cargo test -p calcarc-core && cargo clippy --workspace --all-targets -- -D warnings && \
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Add n!, nPr and nCr, and let the order of operations set the domain

Three ways to write nCr, three different domains. n!/(r!(n−r)!) dies
at 200 nCr 100 with an answer of 9e58. Multiplying before dividing
dies at n = 1022 with an answer that fits. Dividing first survives
both, at the same accuracy.

Factorial stops at 170! by arithmetic, not by choice. Non-integers
are a domain error rather than a gamma function — same reasoning that
closed the functions over the reals in S-1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Python 参照と golden

**ここは独立性が素直に取れる**（設計書 §5）。Rust は f64 の逐次乗除、Python は
**任意精度の整数**。アルゴリズムが同型でない。

**Files:**
- Modify: `reference/src/calcarc_reference/scientific_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`
- Modify: `reference/scripts/generate.py`
- Modify: `reference/tests/test_scientific_ref.py`
- Modify: `crates/calcarc-core/tests/golden.rs`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Consumes: `scientific::{factorial, npr, ncr}`（Task 2）、golden の `expect.error`
  と `error_name`（S-1 が用意した）
- Produces: golden の `op: "factorial"`（1 引数 `{"x":…}`）、
  `op: "npr"` / `"ncr"`（2 引数 `{"x":…,"y":…}`。**`pow` と同じ形**）

- [ ] **Step 1: 参照実装を書く**

`scientific_ref.py` に足す。**`math` の任意精度整数を使う**——mpmath は要らない。

```python
def _non_negative_integer(x: float) -> int | None:
    """非負整数なら int に、そうでなければ None。

    **Rust の `x.fract() == 0.0` を写したのではない。** Python 側は
    `float.is_integer()` という別の問い方をする。
    """
    if not math.isfinite(x) or x < 0 or not float(x).is_integer():
        return None
    return int(x)


def _fits_f64(n: int) -> dict:
    """厳密整数を f64 の値として返す。収まらなければ Overflow。"""
    try:
        v = float(n)
    except OverflowError:
        return {"error": "Overflow"}
    if math.isinf(v):
        return {"error": "Overflow"}
    return {"re": v, "im": 0.0}


def factorial(x: float, mode: str) -> dict:
    """階乗。**厳密な整数で計算してから f64 に落とす。**

    Rust は f64 で逐次乗算する。こちらは `math.factorial` の任意精度整数で
    答えを出してから 1 度だけ f64 にする——**同じアルゴリズムではない**ので、
    Rust の逐次乗算の誤差がここに写ることがない。
    """
    n = _non_negative_integer(x)
    if n is None:
        return {"error": "DomainError"}
    return _fits_f64(math.factorial(n))


def npr(x: float, y: float) -> dict:
    n, r = _non_negative_integer(x), _non_negative_integer(y)
    if n is None or r is None or r > n:
        return {"error": "DomainError"}
    return _fits_f64(math.perm(n, r))


def ncr(x: float, y: float) -> dict:
    n, r = _non_negative_integer(x), _non_negative_integer(y)
    if n is None or r is None or r > n:
        return {"error": "DomainError"}
    return _fits_f64(math.comb(n, r))
```

- [ ] **Step 2: 入力ケースを足す**

`cases.py` の `POW_INPUTS` の後ろに。**設計書 §8 の必須ケース（訂正版）と 1:1**。

```python
# 階乗（設計書 §3・§4）。1 引数。
FACTORIAL_INPUTS: list[float] = [
    0.0,  # 0! = 1（境界）
    1.0,
    5.0,
    10.0,
    20.0,  # 2^53 を超える最初のあたり
    170.0,  # f64 に収まる最大
    171.0,  # Overflow
    2.5,  # 非整数 → DomainError（ガンマ関数には広げない）
    -1.0,  # 負 → DomainError
]

# nPr / nCr（設計書 §3・§4）。(n, r)
PAIR_INPUTS: list[tuple[float, float]] = [
    (5.0, 2.0),  # 既知値: P=20, C=10
    (5.0, 0.0),  # nP0 = nC0 = 1（境界）
    (5.0, 5.0),  # nPn = n!, nCn = 1（境界）
    (5.0, 6.0),  # r > n → DomainError
    (10.0, 3.0),
    (170.0, 3.0),
    (52.0, 5.0),  # トランプの手札。実用域
    # **途中であふれない書き方の証拠**（設計書 §4 の訂正）。
    (200.0, 100.0),  # 素直な n!/(r!(n-r)!) はここで落ちる
    (1000.0, 500.0),  # f64 の上限近く
    (1022.0, 511.0),  # **掛けてから割る形はここで落ちる**
    (5.5, 2.0),  # 非整数 → DomainError
    (5.0, -1.0),  # 負 → DomainError
]
```

- [ ] **Step 3: `generate.py` にループを足す**

`build_scientific` の `pow` ループの後ろに:

```python
    for x in cases.FACTORIAL_INPUTS:
        entries.append(
            {
                "id": f"factorial/{x}",
                "op": "factorial",
                "input": {"x": x},
                "expect": scientific_ref.factorial(x, "Deg"),
            }
        )
    for x, y in cases.PAIR_INPUTS:
        for name in ("npr", "ncr"):
            fn = getattr(scientific_ref, name)
            entries.append(
                {
                    "id": f"{name}/{x}/{y}",
                    "op": name,
                    "input": {"x": x, "y": y},
                    "expect": fn(x, y),
                }
            )
```

- [ ] **Step 4: golden の Rust 側に腕を足す**

`golden.rs` の match に。**`npr` / `ncr` は `pow` と同じ 2 引数の形**:

```rust
            "factorial" => scientific::factorial(x),
            "npr" => scientific::npr(x, Value::real(field(&case.input, "y"))),
            "ncr" => scientific::ncr(x, Value::real(field(&case.input, "y"))),
```

- [ ] **Step 5: 参照実装自身のテストを足す**

`reference/tests/test_scientific_ref.py`（import も足す）:

```python
def test_factorial_stops_at_the_f64_ceiling() -> None:
    assert factorial(170.0, "Deg")["re"] > 0
    assert factorial(171.0, "Deg") == {"error": "Overflow"}


def test_factorial_is_only_defined_on_non_negative_integers() -> None:
    assert factorial(2.5, "Deg") == {"error": "DomainError"}
    assert factorial(-1.0, "Deg") == {"error": "DomainError"}


def test_combinations_beyond_the_naive_formula() -> None:
    # 参照は任意精度なので途中で溢れる問題がそもそも無い。Rust 側の
    # 書き方（割ってから掛ける）がこれと一致することを golden が見る。
    assert ncr(200.0, 100.0)["re"] == pytest.approx(9.054851465610164e58)
    assert ncr(1022.0, 511.0)["re"] > 0


def test_r_may_not_exceed_n() -> None:
    assert ncr(5.0, 6.0) == {"error": "DomainError"}
    assert npr(5.0, 6.0) == {"error": "DomainError"}
```

- [ ] **Step 6: 再生成して緑を見る**

```bash
cd reference && uv run --no-config pytest -q && uv run --no-config python scripts/generate.py && cd .. && \
cargo test -p calcarc-core --test golden
```

期待: すべて **PASS**。`scientific.json` に 9 + 24 = **33 件**増える。

**tolerance に収まることを確かめる**（設計書 §5）。落ちたら誤差の見積りが
甘かったということなので、**tolerance を緩めずに報告する**。

- [ ] **Step 7: golden がエラーのケースを実際に持っていることを確かめる**

**緑は「比較した」ことを意味しない**（このリポジトリで踏んだ形）。

```bash
python3 -c "
import json,collections
d=json.load(open('testdata/scientific.json'))
e=collections.Counter(c['expect'].get('error') for c in d['cases'] if 'error' in c['expect'])
print('error cases:', dict(e))
print('S-3 の error id:', [c['id'] for c in d['cases'] if 'error' in c['expect'] and c['op'] in ('factorial','npr','ncr')])
"
```

期待: `factorial/171.0`（Overflow）、`factorial/2.5`、`factorial/-1.0`、
`npr/5.0/6.0`、`ncr/5.0/6.0`、`npr/5.5/2.0`、`ncr/5.5/2.0`、
`npr/5.0/-1.0`、`ncr/5.0/-1.0` が**すべて出ること**。

- [ ] **Step 8: コミット**

```bash
cd reference && uv run --no-config ruff check . && cd .. && cargo fmt && \
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && \
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Check the counting functions against exact integers

Rust multiplies and divides f64 in a loop; Python asks math.comb for
an arbitrary-precision integer and converts once. Neither is a port of
the other, which is the whole point — the golden measures whether ten
displayed digits survive the f64 route.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**このコミットの後、`feature/e2e-corpus` に「優先順位 3・左結合」を伝える**
（相手の段階 3c の設計に効く。Task 9 まで待たない）。

---

### Task 4: キー 3 つを盤面まで通す

**1 コミットにまとまる**——`Key::ALL` に足すと `token_parity.rs` が TypeScript を、
`scientific.test.ts` が盤面への配置を要求する（S-1 で確認済み）。

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs`（**最初に**）
- Modify: `crates/calcarc-core/src/engine/state.rs`（`BinOp::Npr` / `Ncr`）
- Modify: `crates/calcarc-core/src/engine/key.rs`（`ALL` を 42 → 45）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`apply_binop` / `apply` / `reduce`）
- Modify: `crates/calcarc-core/src/engine/display.rs`（`op_symbol`）
- Modify: `web/src/calc/types.ts`
- Modify: `web/src/ui/Display/Display.tsx`
- Modify: `web/src/ui/Keypad/scientific.ts`
- Modify: `web/src/ui/Keypad/scientific.test.ts`

**Interfaces:**
- Consumes: `scientific::{factorial, npr, ncr}`（Task 2）、
  `BinOp::is_right_associative`（S-1）
- Produces: キートークン **`n_fact` `n_p_r` `n_c_r`**（`Key::ALL` と `KEY_TOKENS` の
  **末尾にこの順で追加**。既存 42 個の並びを変えない）
- Produces: `BinOp::Npr` / `BinOp::Ncr`（**優先順位 3、左結合**）

- [ ] **Step 1: 仕様の行を先に書く**

`engine_table.rs` に足す。**既存の行は 1 つも書き換えない**（相手との約束 4）。

```rust
#[test]
fn factorial_applies_immediately_like_the_other_unary_keys() {
    // 単項は後置。式には積まれない（設計書 D6）。
    assert_eq!(main_of(&["5", "n_fact"]), "120");
    assert_eq!(main_of(&["0", "n_fact"]), "1");
    assert_eq!(main_of(&["1", "0", "n_fact"]), "3,628,800");
    // 20! は 2^53 を超えるが、表示の 10 桁は正しい（設計書 §4）。
    assert_eq!(main_of(&["2", "0", "n_fact"]), "2.432902008e18");
}

#[test]
fn factorial_leaves_the_integers_with_an_error() {
    // ガンマ関数には広げない（設計書 §3 の裁定 3）。
    assert_eq!(main_of(&["2", "dot", "5", "n_fact"]), "Math ERROR");
    assert_eq!(main_of(&["1", "neg", "n_fact"]), "Math ERROR");
}

#[test]
fn permutations_and_combinations_are_binary_operators() {
    assert_eq!(main_of(&["5", "n_p_r", "2", "eq"]), "20");
    assert_eq!(main_of(&["5", "n_c_r", "2", "eq"]), "10");
    // 境界は全部 1（設計書 §3）。
    assert_eq!(main_of(&["5", "n_c_r", "0", "eq"]), "1");
    assert_eq!(main_of(&["5", "n_c_r", "5", "eq"]), "1");
    // r > n は定義域の外。
    assert_eq!(main_of(&["5", "n_c_r", "6", "eq"]), "Math ERROR");
}

#[test]
fn combinations_bind_tighter_than_multiplication() {
    // 5 × (4 nCr 2) = 5 × 6 = 30（設計書 §2 の裁定 1）。
    // 左から順なら (5 × 4) nCr 2 = 20 nCr 2 = 190 になる。
    assert_eq!(main_of(&["5", "mul", "4", "n_c_r", "2", "eq"]), "30");
}

#[test]
fn combinations_fold_from_the_left() {
    // (5 nCr 3) nCr 2 = 10 nCr 2 = 45（設計書 §2）。
    // **右結合なのは xʸ だけである**（S-1）。5 nCr (3 nCr 2) = 5 nCr 3 = 10。
    assert_eq!(main_of(&["5", "n_c_r", "3", "n_c_r", "2", "eq"]), "45");
}

#[test]
fn combinations_sit_below_the_power_operator() {
    // 優先順位は + −(1) < × ÷(2) < nPr nCr(3) < xʸ(4)。
    // 5 nCr (2 xʸ 1) = 5 nCr 2 = 10。逆順なら (5 nCr 2) xʸ 1 でも 10 に
    // なってしまうので、**答が分かれる列**を使う。
    // 4 nCr (2 xʸ 2) = 4 nCr 4 = 1。(4 nCr 2) xʸ 2 = 6^2 = 36。
    assert_eq!(main_of(&["4", "n_c_r", "2", "pow", "2", "eq"]), "1");
}

#[test]
fn the_echo_shows_the_counting_operators() {
    assert_eq!(echo_of(&["5", "n_p_r"]), "5 P");
    assert_eq!(echo_of(&["5", "n_c_r"]), "5 C");
}

#[test]
fn combinations_do_not_overflow_on_the_way_to_an_answer_that_fits() {
    // 設計書 §4（訂正版）。素直な n!/(r!(n−r)!) はここで落ちる。
    assert_eq!(
        main_of(&["2", "0", "0", "n_c_r", "1", "0", "0", "eq"]),
        "9.054851466e58"
    );
}
```

**`4 nCr 2 xʸ 2` の期待値を実装前に手で確かめること**: `xʸ` が先なら
`4 nCr 4 = 1`、`nCr` が先なら `6^2 = 36`。**1 が出れば優先順位は正しい。**

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --test engine_table --no-fail-fast 2>&1 | grep -E 'unknown key|FAILED'
```

期待: **`unknown key: n_fact`** で 8 つの test が落ちる。

- [ ] **Step 3: `BinOp` に 2 つ足す**

`engine/state.rs`:

```rust
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    /// xʸ。**唯一の右結合演算子**(S-1 設計書 §3.1)。
    Pow,
    /// 順列 nPr。**左結合**、優先順位 3(S-3 設計書 §2)。
    Npr,
    /// 組合せ nCr。**左結合**、優先順位 3。
    Ncr,
}
```

`precedence()`:

```rust
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul | BinOp::Div => 2,
            // 「1 つの数」を作る演算として読まれるので × ÷ より先
            // (S-3 設計書 §2)。`5 × 4 nCr 2` は `5 × 6 = 30`。
            BinOp::Npr | BinOp::Ncr => 3,
            BinOp::Pow => 4,
```

**`is_right_associative` は触らない。** `matches!(self, BinOp::Pow)` のままで
`Npr` / `Ncr` は左結合になる——**S-1 が結合方向を演算子に尋ねる形に変えてあるので、
追加コードは 1 行も要らない。**

- [ ] **Step 4: `Key` に 3 つ足す**

`engine/key.rs` の 4 か所。**末尾に、この順で**:

```rust
    /// 自然対数の底。π と同じ「値そのもの」のキー。
    E,
    /// 階乗。後置の単項(S-3 設計書 §1)。
    NFact,
    /// 順列 nPr。二項(S-3 設計書 §1)。
    Npr,
    /// 組合せ nCr。二項。
    Ncr,
}
```

`from_token`: `"n_fact" => Key::NFact,` `"n_p_r" => Key::Npr,` `"n_c_r" => Key::Ncr,`
`token()`: `Key::NFact => "n_fact",` `Key::Npr => "n_p_r",` `Key::Ncr => "n_c_r",`
`ALL`: `[Key; 45]` にして末尾に 3 つ。

- [ ] **Step 5: `apply_binop` / `apply` / `reduce` / `op_symbol`**

`engine/mod.rs` の `apply_binop`:

```rust
        BinOp::Pow => scientific::pow(lhs, rhs),
        BinOp::Npr => scientific::npr(lhs, rhs),
        BinOp::Ncr => scientific::ncr(lhs, rhs),
```

`apply`:

```rust
        Key::NFact => apply_unary(state, scientific::factorial)?,
        Key::Npr => push_binop(state, BinOp::Npr)?,
        Key::Ncr => push_binop(state, BinOp::Ncr)?,
```

`reduce` の `operator_pending`——**二項の腕に 2 つ、値を確定させる腕に `NFact`**:

```rust
                Key::Add | Key::Sub | Key::Mul | Key::Div | Key::Pow
                | Key::Npr | Key::Ncr => true,
```

```rust
                | Key::Atan
                | Key::NFact
                | Key::Ac => false,
```

`engine/display.rs` の `op_symbol`:

```rust
        BinOp::Pow => "^",
        BinOp::Npr => "P",
        BinOp::Ncr => "C",
```

- [ ] **Step 6: TypeScript 側を合わせる**

`web/src/calc/types.ts`:

```ts
export type BinOpName = "Add" | "Sub" | "Mul" | "Div" | "Pow" | "Npr" | "Ncr";
```

`KEY_TOKENS` の末尾（`"e"` の後）に `"n_fact", "n_p_r", "n_c_r",`。

`web/src/ui/Display/Display.tsx` の `OP_SYMBOL` に `Npr: "P", Ncr: "C",`。

- [ ] **Step 7: 盤面 — 数字 `7` `8` `9` に第 2 面を足す**

`web/src/ui/Keypad/scientific.ts` の `MAIN_GRID`。**第 1 面は 1 文字も変えない**:

```ts
    {
      token: "7",
      label: "7",
      ariaLabel: "7",
      variant: "digit",
      // **数字キーに第 2 面が付くのはここが初めてである**(S-3 設計書 §7 の
      // 裁定 2)。3 つを隣り合わせに置ける場所が他に無い——関数列の裏は
      // S-1 が意味の対応(√→ln など)で埋めている。
      //
      // **variant を "function" にするのは意図的**。第 2 面に入ったことが
      // 色で分かるようにするためで、裁定 2 の「発見性」への答えである。
      shift: {
        token: "n_fact",
        label: "n!",
        ariaLabel: "階乗",
        variant: "function",
      },
    },
    {
      token: "8",
      label: "8",
      ariaLabel: "8",
      variant: "digit",
      shift: {
        token: "n_p_r",
        label: "nPr",
        ariaLabel: "順列",
        variant: "function",
      },
    },
    {
      token: "9",
      label: "9",
      ariaLabel: "9",
      variant: "digit",
      shift: {
        token: "n_c_r",
        label: "nCr",
        ariaLabel: "組合せ",
        variant: "function",
      },
    },
```

- [ ] **Step 8: 盤面のテストを足す**

`scientific.test.ts`。**`lays the main grid out five by five` は第 1 面の
ラベルしか見ていないので変わらない**（確認すること）。

```ts
  it("puts the counting keys behind the digits, the only place three fit", () => {
    // S-3 設計書 §7 の裁定 2。**数字キーに第 2 面が付くのは初めて**なので、
    // 3 つが隣り合っていることを明示的に主張する。
    const grid = section("数字と演算のキー");
    const shifted = grid.keys
      .filter((k) => k.shift)
      .map((k) => [k.token, k.shift?.token]);
    expect(shifted).toEqual([
      ["7", "n_fact"],
      ["8", "n_p_r"],
      ["9", "n_c_r"],
      ["exp", "pi"],
    ]);
  });

  it("makes the shifted digits look like functions, not digits", () => {
    // 裁定 2 の「発見性」への答え。色が変わらないと、第 2 面に入ったことが
    // 数字キーの上では見えない(E2E が実ブラウザで確かめる)。
    const grid = section("数字と演算のキー");
    for (const token of ["7", "8", "9"]) {
      const key = grid.keys.find((k) => k.token === token);
      expect(key?.variant).toBe("digit");
      expect(key?.shift?.variant).toBe("function");
    }
  });
```

**`shifted` の期待が `exp`/`pi` を含む順序に依存している。** `MAIN_GRID` の
並び順で `7` `8` `9` が `exp` より前にあることを前提にしている——
**並べ替えたらこのテストが落ちる**が、それは正しい（盤面の意図が変わったので）。

- [ ] **Step 9: 段 1・3・4 を回す**

```bash
cargo fmt && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && \
cd web && pnpm test && pnpm lint && cd ..
```

期待: すべて **PASS**。**`&&` で繋ぐこと**（件数を目で見ない）。

- [ ] **Step 10: 赤確認 — 優先順位 3 が効いていることを見る**

`precedence()` の `BinOp::Npr | BinOp::Ncr => 3,` を `=> 2,` に変える（`×` と同じに）。

```bash
cargo test -p calcarc-core --test engine_table --no-fail-fast 2>&1 | grep -E '^test .*(ok|FAILED)' | grep -E 'combinations|power_operator|same_precedence'
```

期待:
- `combinations_bind_tighter_than_multiplication` … **FAILED**（`190` が出る）
- `combinations_fold_from_the_left` … **ok**（同順位どうしの左結合は変わらない）
- `combinations_sit_below_the_power_operator` … **ok**（`xʸ` は 4 のまま）
- 既存の `same_precedence_operators_fold_from_the_left_in_the_answer` … **ok**

**次に `=> 5,` に変える**（`xʸ` より上に）。期待:
- `combinations_sit_below_the_power_operator` … **FAILED**（`36` が出る）
- `combinations_bind_tighter_than_multiplication` … **ok**

**2 方向で違う行が落ちることを見る**——優先順位が「`×` より上」と「`xʸ` より下」の
**両方**で押さえられていることの確認である。片方だけなら、もう片方は主張されていない。

**再編集で `3` に戻し**、緑を見る。

- [ ] **Step 11: コミット**

```bash
cargo fmt && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && \
cd web && pnpm test && pnpm lint && cd .. && \
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Put n!, nPr and nCr on the board, behind the digits

Precedence 3: above × ÷ because nCr reads as making one number, below
xʸ. S-1 left the slot empty and taught push_binop to ask the operator
which way it folds, so left-associativity costs nothing here.

The three keys go behind 7, 8 and 9 — the first shifted digits in this
repo. Nowhere else fits three of a kind: S-1 filled the function row's
second face by meaning (√→ln), and splitting these up would be worse
than putting them somewhere unexpected. The shifted faces render as
functions rather than digits so the face change is visible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 網羅列挙に `Npr` / `Ncr` を足す

**S-1 が `FOCUS` の仕組みを用意し、「S-3 は 2 つをここに足すこと」と書き残してある。**

**Files:**
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`

**Interfaces:** なし（検査の網だけ）

- [ ] **Step 1: 現状の壁時計を測る**

```bash
cargo test -p calcarc-core --test engine_robustness -- --exact \
  every_sequence_over_all_classes_up_to_five_keys_and_six_through_the_focus 2>&1 | grep 'finished in'
```

**数字を控える**（S-1 の実測は 12.7 秒）。

- [ ] **Step 2: `ALL_CLASSES` と `FOCUS` に足す**

```rust
const FOCUS: [Key; 4] = [Key::Exp, Key::Pow, Key::Npr, Key::Ncr];
```

`ALL_CLASSES` を `[Key; 18]` にして `Key::Npr` と `Key::Ncr` を末尾に。

**`Npr` と `Ncr` を畳まない理由をコメントに書く**:

```rust
/// `nPr` / `nCr` は畳めない。**優先順位 3 という新しい段**を作るので、
/// `2`(× ÷)と `4`(xʸ)のあいだに演算子が挟まる形は他のどのキーでも作れない
/// (S-3 設計書 §2)。`FOCUS` に入れるのは S-1 が書き残した前提のとおり。
///
/// **2 つとも入れる。** 状態機械に対する作用は同じだが、`push_binop` から
/// 見て違うのは `apply_binop` の行き先だけなので、**片方に畳んでもよい**
/// ——のだが、畳むと「どちらを代表にしたか」を次の人が調べ直すことになる。
/// 18 クラスの実測が予算に収まるなら、両方入れるほうが説明が要らない。
```

- [ ] **Step 3: 実測して予算を確かめる**

```bash
cargo test -p calcarc-core --test engine_robustness -- --exact \
  every_sequence_over_all_classes_up_to_five_keys_and_six_through_the_focus 2>&1 | grep 'finished in'
{ time cargo test --workspace >/dev/null 2>&1; } 2>&1 | grep real
```

**長さ 5 の全数は 18^5 = 189 万で、16^5 = 105 万の 1.8 倍**になる。
焦点列も焦点キーが 2→4 に増えるぶん伸びる。

**`cargo test --workspace` が 20 秒を超えたら**、`FOCUS` から `Ncr` を落として
`Npr` だけにする（作用が同じなので代表 1 つで足りる）。**落としたらコメントに
理由と実測値を書く**——「両方入れるほうが説明が要らない」と書いた上で落とすので、
なぜ翻したかを残さないと次の人が読めない。

**S-1 のコメントを更新する**: 「比^深さは下限であって上限ではない」の実例が
また増えるはずなので、**予測と実測の両方を書く**。

- [ ] **Step 4: 網が鈍っていないことを確かめる**

```bash
# operator_pending の二項腕を true -> false に退行させる
cargo test -p calcarc-core --test engine_robustness --no-fail-fast 2>&1 | grep -cE '^test .* FAILED'
```

期待: **3 以上**（S-1 で `never_panics` / `long_sequences` / 焦点列挙が落ちた）。
**再編集で戻す。**

- [ ] **Step 5: コミット**

```bash
cargo fmt && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && \
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Send the counting operators through the focused sweep

S-1 left a note saying nPr and nCr belong in FOCUS when they land:
precedence 3 puts an operator between × ÷ and xʸ, a stack shape no
other key builds. Measured wall clock before and after in the comment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 数字キーの Shift を撮って見る

**裁定 2 が名指しで要求している**——「数字キーに Shift が付くのはこのリポジトリで
初めてなので、**Shift を押したときに数字の面が変わることが見て分かるか**を
スクリーンショットで確かめる。テストでは分からない。」

**Files:** なし（撮影のみ。問題が見つかったら `scientific.ts` / CSS を直す）

- [ ] **Step 1: 両面を撮る**

```bash
cd web && pnpm build && pnpm preview --port 4179 --strictPort &
sleep 3
```

390×844 で第 1 面と第 2 面を撮る（Playwright の一時 spec が早い。
**撮り終えたら spec を消すこと**）。

- [ ] **Step 2: 見るべきものを見る**

- **`7` `8` `9` が `n!` `nPr` `nCr` に変わったことが一目で分かるか。**
  variant を `digit` から `function` にしてあるので**色が変わる**はずである
- `nPr` `nCr` は 3 文字。**数字キーの幅（メイングリッドは 44px 以上）に収まるか**
- **他の数字（`0`〜`6`）が変わらないことが、かえって不自然に見えないか**
- Shift 自体が押された状態に見えるか（既存の挙動だが、数字の上でも分かるか）

- [ ] **Step 3: preview を落とす**

```bash
pkill -f 'vite preview' || true
lsof -i :4179 || echo "4179 is free"
```

**必ず落とす。** 落とさないと次の E2E が古いビルドを掴む。

- [ ] **Step 4: 見た目に問題があれば直してコミット**

問題が無ければコミット不要。**あった場合、裁定 2 を満たせないなら置き場を
再検討する必要がある**ので、直すのではなく**ユーザーに報告する**（置き場は
裁定事項であり、実装者が倒す話ではない）。

---

### Task 7: E2E — 発見性を実ブラウザで確かめる

**裁定 2 が「発見性を E2E で確かめる」と要求している。**
jsdom はアクセシビリティツリーを組み立てないので、Shift 面越しの到達は実ブラウザで見る。

**Files:**
- Create: `web/tests/e2e/probability-keys.spec.ts`

- [ ] **Step 1: E2E を書く**

```ts
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const shift = (page: Page) =>
  page.getByRole("button", { name: "第2面に切り替え" });

test("the factorial key is reachable behind the digit 7", async ({ page }) => {
  // **数字キーの第 2 面はこのリポジトリで初めて**(設計書 §7 の裁定 2)。
  await page.getByRole("button", { name: "5", exact: true }).click();
  await shift(page).click();
  await page.getByRole("button", { name: "階乗" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("120");
  // ワンショット: 面は戻り、7 は数字に戻っている。
  await expect(page.getByRole("button", { name: "7", exact: true })).toBeEnabled();
});

test("nPr and nCr compute through the browser", async ({ page }) => {
  await page.getByRole("button", { name: "5", exact: true }).click();
  await shift(page).click();
  await page.getByRole("button", { name: "組合せ" }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "計算する" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("10");
});

test("combinations bind tighter than multiplication, in the browser", async ({
  page,
}) => {
  // 5 × (4 nCr 2) = 30（裁定 1）。左から順なら 190。
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "掛ける" }).click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await shift(page).click();
  await page.getByRole("button", { name: "組合せ" }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "計算する" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("30");
});

test("the shifted digits look different, not just read differently", async ({
  page,
}) => {
  // **裁定 2 の発見性そのもの。** 数字キーの上で面が変わったことが
  // 色で分かるか。jsdom はここを見られない(CLAUDE.md)。
  const seven = page.getByRole("button", { name: "7", exact: true });
  const background = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const asDigit = await seven.evaluate(background);

  await shift(page).click();
  const factorial = page.getByRole("button", { name: "階乗" });
  await expect(factorial).toBeEnabled();
  const asFunction = await factorial.evaluate(background);

  // 同じ位置のキーが、面によって違う色で描かれている。
  expect(asFunction).not.toBe(asDigit);
});

test("the counting keys keep their 44px touch targets", async ({ page }) => {
  // メイングリッドの寸法は 3 タブで揃えてある。第 2 面でも崩れない。
  await shift(page).click();
  for (const name of ["階乗", "順列", "組合せ"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
```

- [ ] **Step 2: 走らせる**

```bash
cd web && pnpm e2e tests/e2e/probability-keys.spec.ts
```

期待: **5 件 PASS**。落ちたら**表示文字列を実測して直す**（推測しない）。

- [ ] **Step 3: 既存の E2E も回す**

```bash
cd web && pnpm e2e
```

期待: すべて **PASS**（S-1 時点で 96 件 + 今回の 5 件）。

- [ ] **Step 4: コミット**

```bash
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Watch the shifted digits from a real browser

The ruling asked for discoverability to be checked in E2E, not just
asserted in a unit test: this is the first time a digit key in this
repo has a second face, and the thing that makes it findable is that
7 stops looking like a digit. jsdom cannot see a computed colour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 文書とブランチ末尾のスイープ

**Files:**
- Modify: `docs/base-spec.md`（§9.2 に追加機能として記す）
- Modify: `docs/numerical-policy.md`（Task 1 で書いた節の仕上げ）
- Modify: `docs/superpowers/specs/2026-08-16-probability-keys-design.md`（状態行）

- [ ] **Step 1: 腐った理由を grep で洗い出す**

**手で数えた一覧は漏れる**（S-1 で `vertical-slice.spec.ts` を漏らした）。
**しかも「赤くなる場所」と「緑のまま意味だけ変わる場所」は別に数える**
（`feature/e2e-corpus` 担当の指摘）。

```bash
grep -rn '階乗\|nCr\|nPr\|factorial\|combination\|permutation' \
  --include='*.md' --include='*.rs' --include='*.py' --include='*.ts' --include='*.tsx' . \
  | grep -v node_modules | grep -v '/target/' | grep -v '\.venv' | grep -v '/src/wasm/'
```

**S-3 は機能を足すだけで既存挙動を変えないので、腐る理由は少ないはず**である。
ただし「MVP に無い」「Shift は関数列だけ」と書いた箇所は嘘になる。特に:

- `docs/base-spec.md` §9.2（MVP の一覧。**S-3 は MVP 外の追加機能**と明記する）
- 盤面を説明している箇所で「Shift を持つのは sin/cos/tan/√/x²/EXP だけ」

- [ ] **Step 2: `docs/base-spec.md` §9.2 に追記**

S-1 が足した「定義域について」の後ろに:

```markdown
MVP 外の追加機能（S-3、2026-08-16。ユーザー発意）：

- `n!`（階乗）
- `nPr`（順列）
- `nCr`（組合せ）

3 つとも**非負整数の上でしか定義しない**。優先順位は `× ÷` より先、`xʸ` より後。
盤面では数字 `7` `8` `9` の第 2 面に置く。
```

- [ ] **Step 3: 設計書の状態行を更新**

```markdown
**状態: 実装済み（`feature/probability-keys`、2026-08-16）。**
計画は `docs/superpowers/plans/2026-08-16-probability-keys.md`。
```

「**⚠ 未実装**」の行を消す。

- [ ] **Step 4: ブランチ末尾のフルスイープ**

**すべて `&&` で繋ぐ**（件数を目で見て判断しない）。

```bash
cargo fmt --check && cargo test --workspace && \
cargo clippy --workspace --all-targets -- -D warnings && \
echo "RUST OK"
```

```bash
wasm-pack test --headless --firefox crates/calcarc-wasm 2>&1 | tail -5
```

**chrome ではなく firefox。** 手元の ChromeDriver 152 と Chrome 135 が版ずれして
いる（S-1 で確認済み、環境要因）。**28 件通ることを確かめ、件数を報告する。**

```bash
cd reference && uv run --no-config pytest -q && uv run --no-config ruff check . && \
uv run --no-config python scripts/generate.py && cd .. && \
git diff --exit-code testdata/ && echo "golden is reproducible"
```

```bash
cd web && pnpm wasm && pnpm test && pnpm lint && pnpm build && pnpm e2e && cd .. && echo "WEB OK"
```

- [ ] **Step 5: コミット**

```bash
test "$(git branch --show-current)" = feature/probability-keys && git add -A && git commit -m "$(cat <<'EOF'
Record that the counting keys are an addition, not part of the MVP

base-spec §9.2 lists what the MVP promised; n!, nPr and nCr were asked
for afterwards. Saying so keeps the list honest about its own scope.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 申し送り

- [ ] **Step 1: `feature/e2e-corpus` に伝える**

**Task 3 の後で優先順位を伝えてあるはず**（あちらの 3c の設計に効く）。
ここでは完了の報告と、変更点の最終形を伝える:

1. **`KEY_TOKENS` に 3 つ追加**（`n_fact` `n_p_r` `n_c_r`）。**既存 42 個は不変**
2. **`engine_table.rs` の既存行の書き換えは 0 件**（足しただけ）
3. **表示書式は不変**（`parseDisplay` は無事）
4. **`nPr` / `nCr` は優先順位 3 の左結合。** `+ −`=1 < `× ÷`=2 < `nPr nCr`=3 < `xʸ`=4
5. **記法の約束 3 つは無傷**（`n!` は後置、`nPr`/`nCr` は二項）
6. `corpus_expr.py` には触れていない

- [ ] **Step 2: Fable に完了レビューを依頼**

**報告に含めるもの**（S-1 で求められた形）:
- 全段の実行結果（**firefox の件数を含む**）
- 網羅列挙の壁時計、**前後**
- 設計書 §4 の訂正（**この計画で最も大きい判断**）
- 裁定 2（数字キーの Shift）の発見性について、**撮って見た結果**

---

## Self-Review

**1. Spec coverage**

| 設計書の節 | 実装するタスク |
|---|---|
| §1 `n!` は単項、`nPr`/`nCr` は二項 | Task 2（コア）・Task 4（キー） |
| §2 優先順位 3・左結合 | Task 4 Step 3・Step 10（赤確認を 2 方向） |
| §3 定義域（非負整数、`r ≤ n`、境界は全部 1） | Task 2 Step 1・Task 3 Step 2 |
| §4 精度と「途中であふれない書き方」 | **Task 1（訂正）**・Task 2 Step 3・Step 5 |
| §5 Python 参照の独立軸（任意精度整数） | Task 3 Step 1 |
| §6・§7 盤面（数字 7/8/9 の Shift） | Task 4 Step 7・Task 6（撮影）・Task 7（E2E） |
| §7 裁定 2 の「発見性を E2E で確かめる」 | Task 7 Step 1 の 4 番目のテスト |
| §7 裁定 4 表示 10 桁 | Task 4 Step 1（`20!` は `2.432902008e18`） |
| §8 必須ケース | Task 3 Step 2（`FACTORIAL_INPUTS` / `PAIR_INPUTS`） |
| §8 赤確認（素直な式で `200 nCr 100` が落ちる） | Task 2 Step 5（**3 つの書き方で 3 段階**に拡張） |
| §8.1 他セッションとの約束 | Global Constraints の節・Task 3 の後・Task 9 |
| §9 スコープ外 | 触っていない（ガンマ関数・統計・乱数・厳密整数表示） |

**2. Placeholder scan**

Task 2 Step 1 の `1.1214087642units` は**意図的な穴**で、直後に
「実装者が実測して埋める」と明記してある。ほかに TBD・「適切に」・
「Task N と同様」は無い。

**3. Type consistency**

- `non_negative_integer` は Task 2 で定義、`check_pair` が使う。private fn ✔
- `real_arg` は S-1 が定義済み。同じモジュール ✔
- golden の `npr` / `ncr` は `pow` と同じ 2 引数の形（`{"x","y"}`）✔
- `Key::ALL` 42 → 45、`KEY_TOKENS` も同じ順で 3 つ ✔
- `BinOp::Npr` / `Ncr` は Task 4 Step 3 で定義、Step 5 が `apply_binop` で使う ✔
- **`is_right_associative` に手を入れない**——S-1 の `matches!(self, BinOp::Pow)` の
  ままで左結合になる ✔

**4. S-1 で踏んだ失敗への対策**

- **clippy が赤のままコミットした** → Global Constraints に「`&&` で機械的に繋ぐ」、
  各コミット手順を `cargo test && cargo clippy && git commit` の形にした
- **plan のファイル一覧が漏れた** → Task 8 Step 1 を grep から起こす形にし、
  **「赤くなる場所」と「緑のまま意味だけ変わる場所」を別に数える**と明記した

## 未確認事項（実装者へ）

**`Key.tsx` / `Keypad.tsx` が数字キーの Shift を描けるかを確認していない。**
`Keypad.tsx:61` の `const face = shifted && key.shift ? key.shift : key;` は
variant も face から取るので**動くはず**だが、`variant: "digit"` のキーに
`shift` が付いた前例が無い。**Task 4 Step 9 の vitest で落ちたら、
`Keypad.tsx` 側の対応が要る**——その場合は Task 4 の中で直し、
コミットメッセージに書くこと。
