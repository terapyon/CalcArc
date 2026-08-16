# S-1 関数を実数に閉じ、MVP を埋める — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** base-spec §9.2 の未実装関数 8 つ + ユーザー要望の `1/x` を足し、**関数の定義域を
実数に閉じる**。`sqrt(-4)` は `j2` ではなく `DomainError` になる。

**Architecture:** 単項 7 つ（`ln` `log10` `eˣ` `asin` `acos` `atan` `1/x`）は
`scientific/mod.rs` に足して `apply_unary` に乗せるだけで、エンジンの構造は動かない。
**構造が動くのは `xʸ` だけ**——`BinOp` に `Pow`（優先順位 4・**右結合**）を足し、
`push_binop` の畳み込み条件 1 行を書き換える。定数 `e` は `π` と同じ扱い。

**Tech Stack:** Rust / mpmath（参照実装）/ wasm-bindgen / TypeScript / React 19 /
vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-08-16-scientific-real-functions-design.md`
（**節番号を各タスクで引く。実装者は自分のタスクが引く節だけ読めばよい**）

**ブランチ:** `feature/scientific-real-functions`（`origin/main` から作成済み）

---

## Global Constraints

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない
- **`calcarc-core` は panic しない**（`unwrap` / `expect` は lint が禁じている。
  テストコードは除く）
- **WASM 境界は JavaScript 例外を投げない。** 計算エラーは戻り値の一部
- **許容誤差をテストコードに書かない。** 言語間検証は `testdata/*.json` の `tolerance`、
  Rust のユニットテストは `calcarc_core::assert_close`（`TEST_EPSILON` を読む）
- **参照実装を Rust の移植にしない。** 定義域の判定は **mpmath が実際に返す型**から
  導く（複素数が返る → `DomainError`）。Rust 側の分岐表を Python に書き写さない。
  **唯一の例外は `0^(y<0)`**（Task 6 に理由を書いた）
- **電卓の挙動は `crates/calcarc-core/tests/engine_table.rs` が仕様書。**
  キー列と表示の対応を**先に変えてから**実装を直す
- **5×5 のメイングリッドを 1 キーも動かさない**——`AC` / `DEL` の位置とキー寸法は
  3 タブで揃えてある
- **区画の `ariaLabel` を変えない**（E2E のセレクタ）
- **`STATE_SCHEMA` を上げない。** `BinOp` に variant を足すのは**広げるだけ**で、
  既存の直列化された状態は今までどおり読める（S-4 が 5 → 6 に上げる。
  ここで上げると番号を奪う）
- コミット前に **`cargo fmt`**（`--check` は直してくれない）
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **`git push` と PR 作成は行わない**
- **共有ワークツリーである。コミットを含むコマンドは必ず**
  `test "$(git branch --show-current)" = feature/scientific-real-functions && git commit ...`
  **の形にする。** `git checkout` / `git switch` でブランチを切り替えない
- E2E のポートは **4179**。**撮り終えたら preview を必ず落とす**

## 他セッションとの約束（合意済み。**守ること**。設計書 §5.3）

`feature/e2e-corpus` の担当セッション（worktree `/home/terapyon/dev/CalcArc-e2e`）が
4,000 件の検証コーパスを持つ。**あの worktree に触らない。**

1. **`KEY_TOKENS` は足すだけ。既存の綴りを 1 文字も変えない・消さない。**
   1 文字変えると 4,000 件が全部「未知のキー」になる。だから設計書は
   `Key::Exp`（指数入力）を改名しないと決めている
2. **`reference/src/calcarc_reference/corpus_expr.py` の `UNARY_FNS` / `BINARY_OPS`
   に触らない**（このブランチには存在しない。**作らないこと**）。1 つ足すと同じ種でも
   4,000 件が総入れ替えになる
3. **記法の約束 3 つを壊さない**——単項は後置 / 二項は必ず括弧で囲む / 式の終わりは `eq`。
   この計画の単項 7 つは `apply_unary`（後置）に乗り、`xʸ` は二項として足すだけなので、
   **優先順位が 2 段から 4 段になっても括弧で囲まれている限り当たらない**
4. **`engine_table.rs` の既存行を書き換えるのは Task 1 の 1 行だけ**
   （`square_root_of_a_negative_gives_an_imaginary_result`）。**伝達済み**
5. **実装が入ったら伝える**（Task 10 の完了条件）。相手の
   `docs/corpus-measurements.md` の「`sqrt(-4)` の表示は `j2`」が事実でなくなる

**相手は 4,000 件を全件走査して確認済み**: `["4","neg","sqrt"]` は 0 件、`neg` の直後に
`sqrt` が来る形も部分列として 0 件。**タイミングを合わせる必要は無い。**

---

## ファイル構成

```text
crates/calcarc-core/src/error.rs                DomainError を足す（Task 1）
crates/calcarc-core/src/scientific/mod.rs       sqrt の反転 + 関数 8 つ（Task 1・2・3・5）
crates/calcarc-core/src/engine/key.rs           Key を 9 つ足す（Task 5・7）
crates/calcarc-core/src/engine/state.rs         BinOp::Pow と結合方向（Task 5）
crates/calcarc-core/src/engine/mod.rs           push_binop の比較 + apply の腕（Task 5・7）
crates/calcarc-core/src/engine/display.rs       op_symbol に "^"（Task 5）
crates/calcarc-core/tests/engine_table.rs       キー列と表示の対応（Task 1・4・5・7）
crates/calcarc-core/tests/engine_robustness.rs  I3b の削除 + 網に Pow（Task 1・6）
crates/calcarc-core/tests/golden.rs             expect.error を読めるように（Task 1）
reference/src/calcarc_reference/scientific_ref.py  参照実装（Task 1・2・3・6）
reference/src/calcarc_reference/cases.py        入力ケース（Task 1・2・3・6）
reference/scripts/generate.py                   build_scientific の拡張（Task 2・6）
reference/tests/test_scientific_ref.py          参照実装自身のテスト（Task 2・3・6）
testdata/scientific.json                        再生成（Task 1・2・3・6）
web/src/calc/types.ts                           CalcErrorCode / KEY_TOKENS / BinOpName
web/src/ui/Display/Display.tsx                  OP_SYMBOL に Pow（Task 5）
web/src/ui/Keypad/scientific.ts                 関数列 2 段目 + Shift 面（Task 5・7）
web/src/ui/Keypad/scientific.test.ts            盤面の検査（Task 5・7）
web/src/ui/Keypad/Keypad.test.tsx               空きスロットの検査（Task 7）
web/tests/e2e/keypad-shell.spec.ts              予約スロットの検査（Task 7）
web/tests/e2e/scientific-functions.spec.ts      新設（Task 9）
docs/base-spec.md                               §9.2 の但し書き（Task 10）
docs/numerical-policy.md                        定義域と結合方向（Task 10）
```

## 検証の段付け（CONTRIBUTING の段付けに従う）

| 段 | コマンド | いつ回すか |
|---|---|---|
| 1 | `cargo test -p calcarc-core` | コアを触った全タスク |
| 2 | `cd reference && uv run --no-config pytest` | 参照を触ったタスク（1・2・3・6） |
| 3 | `cargo test --workspace` | golden / トークンを触ったタスク |
| 4 | `cd web && pnpm test` | web を触ったタスク（5・7・8） |
| 5 | `cd web && pnpm e2e` | Task 9 と**ブランチ末尾 1 回**（Task 10） |

**`uv` のコマンドには必ず `--no-config` を付ける**（付けないと手元の
`~/.config/uv/uv.toml` の `exclude-newer` がロックファイルに書き込まれ、CI の
`uv sync --locked` が落ちる）。

---

### Task 1: `sqrt` を実数に閉じる — 既存挙動の反転

**この計画で唯一、動いているものを壊すタスクである。** 設計書 §5 と §5.1 を読むこと。

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs:354-358`（**最初に、単独で**）
- Modify: `crates/calcarc-core/src/error.rs`
- Modify: `crates/calcarc-core/src/scientific/mod.rs:3-20`（`sqrt`）と `:89-102`（テスト）
- Modify: `crates/calcarc-core/tests/engine_robustness.rs:196-234`（I3b の削除）
- Modify: `crates/calcarc-core/tests/golden.rs:171-195`（`expect.error` を読む）
- Modify: `reference/src/calcarc_reference/scientific_ref.py`
- Modify: `web/src/calc/types.ts:11-15`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Produces: `CalcError::DomainError`（Task 2・3・5 が使う）
- Produces: `scientific::sqrt(v: Value) -> CalcResult<Value>`（**シグネチャ不変**。
  負の実数と複素数で `Err(CalcError::DomainError)` を返すようになる）
- Produces: `scientific_ref.sqrt_real(x: float) -> dict`（**戻り値の形が変わる**。
  `{"re": …, "im": 0.0}` か `{"error": "DomainError"}`）
- Produces: golden の `expect` が `{"error": "..."}` を取れるようになる（Task 2・3・6 が使う）

- [ ] **Step 1: 仕様の行を先に書き換える**

`crates/calcarc-core/tests/engine_table.rs` の 354 行目からの test をこう変える。
**テスト名もコメントも書き換える**——「複素数対応の電卓は答えられる」を残したまま
`DomainError` にすると、文書が実装と逆のことを言う（設計書 §5.1）。

```rust
#[test]
fn square_root_of_a_negative_is_a_domain_error() {
    // 関数は実数に閉じる（設計書 §1 の裁定 1）。複素数は入力と四則と
    // 表示の機能であって、関数の値域ではない。
    assert_eq!(main_of(&["4", "neg", "sqrt"]), "Math ERROR");
}
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --test engine_table -- --exact square_root_of_a_negative_is_a_domain_error
```

期待: **FAIL**。`assertion `left == right` failed: left: "j2", right: "Math ERROR"`。
これが「仕様を先に動かした」証拠になる。

- [ ] **Step 3: `CalcError::DomainError` を足す**

`crates/calcarc-core/src/error.rs` の `SyntaxError` の**前**に足す。
`SyntaxError` は総括的な最後の腕として読まれているので、その位置を保つ。

```rust
    /// tan の極（Deg モードの 90 + 180n 度）での評価。
    TrigPole,
    /// その値にはその関数が定義されていない。`ln(0)` や `sqrt(-4)` など。
    ///
    /// `SyntaxError` と混ぜない。「打ち方が悪い」と「その値には定義が無い」は
    /// 利用者にとって別の話で、`ln(-1)` を SyntaxError と言われても直しようがない。
    DomainError,
    /// 対応しない `)` や `.` の重複など、入力列として不正。
    SyntaxError,
```

- [ ] **Step 4: TypeScript の合併型を広げる**

`web/src/calc/types.ts`:

```ts
/** calcarc-core の error::CalcError に対応。 */
export type CalcErrorCode =
  | "DivisionByZero"
  | "Overflow"
  | "TrigPole"
  | "DomainError"
  | "SyntaxError";
```

`CalcError` は `Serialize` を derive しており、境界には variant 名がそのまま出る。
`datascale` / `finance` / `expr` の各 `Extract<...>` は名前で絞っているので、
広げても影響しない。

- [ ] **Step 5: golden が `expect.error` を読めるようにする**

`crates/calcarc-core/tests/golden.rs` の `scientific_functions_match_the_reference` を
書き換える。**この時点ではまだ `scientific.json` にエラーのケースが無いので緑のまま**
——先に受け皿を作る（`data_scale_golden.rs:94-121` と同じ形）。

`Case` 構造体の下に足す:

```rust
/// `expect` にエラーが書かれていればその名前。値のケースでは None。
fn expected_error(case: &Case) -> Option<&str> {
    case.expect.get("error").and_then(|e| e.as_str())
}

/// CalcError を golden の綴りに写す。
fn error_name(e: calcarc_core::CalcError) -> &'static str {
    use calcarc_core::CalcError::*;
    match e {
        DivisionByZero => "DivisionByZero",
        Overflow => "Overflow",
        TrigPole => "TrigPole",
        DomainError => "DomainError",
        SyntaxError => "SyntaxError",
    }
}
```

`scientific_functions_match_the_reference` の本体を:

```rust
    for case in &golden.cases {
        let x = Value::real(field(&case.input, "x"));
        let mode = angle_mode(case);
        let actual = match case.op.as_str() {
            "sin" => scientific::sin(x, mode),
            "cos" => scientific::cos(x, mode),
            "tan" => scientific::tan(x, mode),
            "sqrt" => scientific::sqrt(x),
            other => panic!("{}: unknown op {other}", case.id),
        };

        match (actual, expected_error(case)) {
            (Ok(v), None) => close_complex(
                v,
                field(&case.expect, "re"),
                field(&case.expect, "im"),
                golden.tolerance,
                &case.id,
            ),
            (Err(e), Some(expected)) => {
                assert_eq!(error_name(e), expected, "{}: error kind", case.id)
            }
            (Ok(v), Some(expected)) => {
                panic!("{}: expected {expected} but got {v:?}", case.id)
            }
            (Err(e), None) => panic!("{}: unexpected error {e:?}", case.id),
        }
    }
```

- [ ] **Step 6: 受け皿が緑であることを見る**

```bash
cargo test -p calcarc-core --test golden
```

期待: **PASS**（挙動はまだ何も変わっていない）。

- [ ] **Step 7: 参照実装の `sqrt_real` を変える**

`reference/src/calcarc_reference/scientific_ref.py` の `sqrt_real` を置き換える。
**mpmath が複素数を返すことから定義域を導く**——Rust の分岐を写さない。

```python
def sqrt_real(x: float) -> dict:
    """実数の平方根。

    **負の実数は定義域の外**である（設計書 §1 の裁定 1）。判定は Rust の
    分岐を写したものではなく、mpmath が mpc（複素数）を返すかどうかで決める。
    """
    r = mp.sqrt(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return {"re": float(r), "im": 0.0}
```

`generate.py` の `build_scientific` の `sqrt` ループを、返った dict をそのまま
`expect` に置く形にする:

```python
    for x in cases.SQRT_INPUTS:
        entries.append(
            {
                "id": f"sqrt/{x}",
                "op": "sqrt",
                "mode": "Deg",
                "input": {"x": x},
                "expect": scientific_ref.sqrt_real(x),
            }
        )
```

- [ ] **Step 8: golden を再生成し、Rust がまだ古いので赤を見る**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff --stat testdata/scientific.json
cargo test -p calcarc-core --test golden
```

期待: `scientific.json` の `sqrt/-4.0` と `sqrt/-1.0` が
`{"error": "DomainError"}` に変わる。golden は **FAIL**
（`sqrt/-4.0: expected DomainError but got Value { re: 0.0, im: 2.0 }`）。

- [ ] **Step 9: `scientific::sqrt` を直す**

`crates/calcarc-core/src/scientific/mod.rs` の先頭を置き換える。

```rust
/// 実数の平方根。**負の実数と複素数は定義域の外**である（設計書 §1 の裁定 1）。
///
/// 以前は負の実数を虚軸に載せて `sqrt(-4) = j2` を返していた。関数を実数に
/// 閉じる裁定でそれを落とした。**複素数は入力と四則と表示の機能であって、
/// 関数の値域ではない。** `sqr` と `neg` は複素数のままである——2 乗は乗算、
/// 符号反転は減算であり、どちらも四則の側にある。
pub fn sqrt(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x < 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.sqrt()).finalize()
}

/// 関数の引数を実数として取り出す。複素数は `DomainError`（設計書 §1 の裁定 4）。
///
/// 実部だけ使う案は**黙って別の計算をする**ので採らない。
fn real_arg(v: Value) -> CalcResult<f64> {
    if v.is_real() {
        Ok(v.re)
    } else {
        Err(CalcError::DomainError)
    }
}
```

- [ ] **Step 10: `scientific/mod.rs` のユニットテストを直す**

89-102 行の 2 つを置き換える。

```rust
    #[test]
    fn square_root_of_a_negative_real_is_a_domain_error() {
        assert_eq!(sqrt(Value::real(-4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn square_root_of_a_complex_number_is_a_domain_error() {
        // 極形式経由で答えられたが、関数は実数に閉じる（設計書 §5）。
        assert_eq!(sqrt(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
    }
```

- [ ] **Step 11: 網羅列挙の I3b 例外を消す**

`crates/calcarc-core/tests/engine_robustness.rs` の `real_axis_is_closed` から、
`Key::Sqrt` の分岐（221-234 行）を**丸ごと削除する**。`sqrt(-4)` はエラーになるので
`after.error.is_some()` の早期 return に吸収され、この分岐は到達しない死んだ枝になる。

同じ関数の doc コメント（196-204 行あたり）の「出口 2」の説明も直す:

```rust
    /// 出口は `j` キーだけである。これは入力なので「実数のみの入力」という
    /// 前提から外れる。
    ///
    /// **かつては出口が 2 つあった。** `sqrt(-4) = j2` を返すのが設計上の機能
    /// だったためで、負の実数の sqrt に I3b という例外を置いていた。関数を
    /// 実数に閉じる裁定（S-1 設計書 §1）でその機能が消え、例外も消えた。
```

さらに `STRUCTURE` と `ALL_CLASSES` の doc コメントにある **I3b への言及を直す**
（424-432 行と 445-448 行）。`−` を二項演算子の代表に選ぶ理由が「`√` の I3b 経路に
届くから」になっているが、その経路はもう無い。

```rust
/// 二項演算子の代表が `−` と `÷` なのは、同じ等価類のうち**射程が広いほう**
/// を選んでいるからである。`−` は負の実数を作れるので、負の値を単項関数に
/// 通す経路（`0 − 3 = √` が `DomainError` になる形）に届き、`÷` は畳み込みの
/// 途中で失敗できる唯一の二項演算子で、被演算数を消費した後にエラーになった
/// 状態の形を網に入れる。`+` `×` を代表にするとどちらの形も一度も通らない。
```

```rust
/// `√` を後置関数の代表にするのは、**エラーを返しうる単項関数**の代表だから
/// である（`0 − 3 = √` で `DomainError` に届く）。エラーに落ちた後の状態の形を
/// 網に入れられるのは、この経路だけである。
```

- [ ] **Step 12: 段 1〜3 を回す**

```bash
cargo fmt
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd reference && uv run --no-config pytest && cd ..
```

期待: すべて **PASS**。

- [ ] **Step 13: 赤確認 — 虚軸分岐を戻して落ちることを見る**

設計書 §8 が要求している。**変異の前に一時コミットを作り、戻しは再編集で行う**
（ファイル単位の `git checkout` は同じファイルの別の作業を巻き戻す）。

```bash
test "$(git branch --show-current)" = feature/scientific-real-functions \
  && git add -A && git commit -m "wip: 赤確認の直前"
```

`scientific::sqrt` を一時的に旧実装へ戻す:

```rust
pub fn sqrt(v: Value) -> CalcResult<Value> {
    if v.is_real() {
        return if v.re >= 0.0 {
            Value::real(v.re.sqrt()).finalize()
        } else {
            Value::imag((-v.re).sqrt()).finalize()
        };
    }
    Err(CalcError::DomainError)
}
```

```bash
cargo test -p calcarc-core 2>&1 | grep -E '^(test |failures:)' | grep -i fail
```

期待: 少なくとも
`square_root_of_a_negative_is_a_domain_error`（engine_table）、
`square_root_of_a_negative_real_is_a_domain_error`（ユニット）、
`scientific_functions_match_the_reference`（golden）**の 3 つが落ちる**。
3 層すべてが見張っていることの確認である。

**再編集で Step 9 の実装に戻し**、`cargo test -p calcarc-core` が緑に戻ることを見る。

- [ ] **Step 14: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Close sqrt to the reals, and give "no value there" its own name

sqrt(-4) answered j2. The ruling is that functions are real-valued:
complex numbers stay in entry, the four operations, and the display.
The engine_table row that boasted about it now expects Math ERROR.

DomainError is separate from SyntaxError on purpose — being told
ln(-1) is a syntax error gives you nothing to fix.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**wip コミットを畳む**: `git reset --soft HEAD~2 && git commit -m ...` で 1 つにする
（wip を履歴に残さない）。

---

### Task 2: 単項 6 つをコアと参照に足す

`ln` `log10` `eˣ` `asin` `acos` `atan`。**キーはまだ足さない**——`Key::ALL` に足すと
`token_parity.rs` が TypeScript との一致を要求し、盤面まで同じコミットに引きずられる。
コアと golden を先に固める（設計書 §8 の段ゲート 2・3）。

**Files:**
- Modify: `crates/calcarc-core/src/scientific/mod.rs`
- Modify: `reference/src/calcarc_reference/scientific_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`
- Modify: `reference/scripts/generate.py`
- Modify: `reference/tests/test_scientific_ref.py`
- Modify: `crates/calcarc-core/tests/golden.rs`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Consumes: `CalcError::DomainError` と `scientific::real_arg`（Task 1）
- Produces:
  ```rust
  pub fn ln(v: Value) -> CalcResult<Value>
  pub fn log10(v: Value) -> CalcResult<Value>
  pub fn exp_e(v: Value) -> CalcResult<Value>
  pub fn asin(v: Value, mode: AngleMode) -> CalcResult<Value>
  pub fn acos(v: Value, mode: AngleMode) -> CalcResult<Value>
  pub fn atan(v: Value, mode: AngleMode) -> CalcResult<Value>
  ```
  （Task 7 がキーから呼ぶ）
- Produces: `scientific_ref.evaluate(name, x, mode) -> dict`（Task 3 が使う）

**名前について:** 既存の `Key::Exp` は**指数入力**（EE）であって e^x ではない。
新しいほうは **`exp_e`** で通す——Rust の関数名も Python の関数名も golden の `op` も
キーのトークンも全部 `exp_e` にする。`Key::Exp` は改名しない（設計書 §3、
他セッションとの約束 1）。

- [ ] **Step 1: 失敗するユニットテストを書く**

`crates/calcarc-core/src/scientific/mod.rs` の `mod tests` に足す。
**許容誤差を書かない**——`close`（= `crate::assert_close`）が `TEST_EPSILON` を読む。

```rust
    #[test]
    fn natural_log_of_e_is_one() {
        close(ln(Value::real(std::f64::consts::E)).unwrap().re, 1.0);
    }

    #[test]
    fn natural_log_is_undefined_at_zero_and_below() {
        assert_eq!(ln(Value::real(0.0)), Err(CalcError::DomainError));
        assert_eq!(ln(Value::real(-1.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn common_log_of_a_power_of_ten() {
        close(log10(Value::real(1000.0)).unwrap().re, 3.0);
        assert_eq!(log10(Value::real(0.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn exp_e_is_the_inverse_of_ln() {
        close(exp_e(Value::real(1.0)).unwrap().re, std::f64::consts::E);
        // 定義域は全実数。落ちるのは溢れたときだけ（設計書 §3）。
        assert_eq!(exp_e(Value::real(1e5)), Err(CalcError::Overflow));
    }

    #[test]
    fn inverse_trig_returns_the_angle_in_the_current_mode() {
        close(asin(Value::real(0.5), AngleMode::Deg).unwrap().re, 30.0);
        close(acos(Value::real(0.5), AngleMode::Deg).unwrap().re, 60.0);
        close(atan(Value::real(1.0), AngleMode::Deg).unwrap().re, 45.0);
        close(asin(Value::real(1.0), AngleMode::Rad).unwrap().re, PI / 2.0);
    }

    #[test]
    fn inverse_sine_and_cosine_are_bounded_by_one() {
        assert_eq!(
            asin(Value::real(1.0000001), AngleMode::Deg),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            acos(Value::real(-1.0000001), AngleMode::Deg),
            Err(CalcError::DomainError)
        );
        // 境界そのものは定義域の中。
        assert!(asin(Value::real(1.0), AngleMode::Deg).is_ok());
        assert!(acos(Value::real(-1.0), AngleMode::Deg).is_ok());
        // atan は全実数。
        assert!(atan(Value::real(1e300), AngleMode::Deg).is_ok());
    }

    #[test]
    fn the_new_functions_reject_complex_arguments() {
        // 裁定 4: 実部だけ使う案は黙って別の計算をするので採らない。
        let z = Value::new(3.0, 4.0);
        assert_eq!(ln(z), Err(CalcError::DomainError));
        assert_eq!(log10(z), Err(CalcError::DomainError));
        assert_eq!(exp_e(z), Err(CalcError::DomainError));
        assert_eq!(asin(z, AngleMode::Deg), Err(CalcError::DomainError));
        assert_eq!(acos(z, AngleMode::Deg), Err(CalcError::DomainError));
        assert_eq!(atan(z, AngleMode::Deg), Err(CalcError::DomainError));
    }
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **コンパイルエラー**（`cannot find function `ln` in this scope` ほか 5 件）。

- [ ] **Step 3: 実装する**

`crates/calcarc-core/src/scientific/mod.rs` の `tan` の後ろに足す。

```rust
/// 自然対数。定義域は `x > 0`（設計書 §3）。
pub fn ln(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x <= 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.ln()).finalize()
}

/// 常用対数。定義域は `x > 0`。
pub fn log10(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x <= 0.0 {
        return Err(CalcError::DomainError);
    }
    Value::real(x.log10()).finalize()
}

/// e の x 乗。
///
/// **`Key::Exp`（指数入力 EE）とは別物である。** 名前が紛らわしいので、
/// この関数もキーのトークンも `exp_e` で通す（設計書 §3）。
/// 定義域は全実数で、落ちるのは結果が f64 を溢れたときだけ。
pub fn exp_e(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    Value::real(x.exp()).finalize()
}

/// 逆正弦。定義域は `−1 ≤ x ≤ 1`。
///
/// **返す角度は `AngleMode` に従う。** `sin` などが `AngleMode` で引数を
/// 解釈しているのと対称である（設計書 §3）。
pub fn asin(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if !(-1.0..=1.0).contains(&x) {
        return Err(CalcError::DomainError);
    }
    Value::real(mode.angle_of(x.asin())).finalize()
}

/// 逆余弦。定義域は `−1 ≤ x ≤ 1`。
pub fn acos(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if !(-1.0..=1.0).contains(&x) {
        return Err(CalcError::DomainError);
    }
    Value::real(mode.angle_of(x.acos())).finalize()
}

/// 逆正接。定義域は全実数。
pub fn atan(v: Value, mode: AngleMode) -> CalcResult<Value> {
    let x = real_arg(v)?;
    Value::real(mode.angle_of(x.atan())).finalize()
}
```

- [ ] **Step 4: 緑を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **PASS**。

- [ ] **Step 5: 参照実装に 6 つ足す**

`reference/src/calcarc_reference/scientific_ref.py` に足す。
**定義域は mpmath が返す型から導く**——Rust の分岐を写さない。

```python
def _real_or_domain_error(r) -> dict:
    """mpmath の結果を golden の expect に写す。

    **定義域の判定を Rust から写さない。** mpmath は定義域の外で mpc（複素数）
    または非有限を返すので、それをそのまま「実数の答が無い」の判定に使う。
    これが独立検証の軸である（CONTRIBUTING: 参照実装を Rust の移植にしない）。
    """
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    x = float(r.real if isinstance(r, mp.mpc) else r)
    if x != x or x in (float("inf"), float("-inf")):
        return {"error": "DomainError"}
    return {"re": x, "im": 0.0}


def ln(x: float, mode: str) -> dict:
    return _real_or_domain_error(mp.log(mp.mpf(str(x))))


def log10(x: float, mode: str) -> dict:
    return _real_or_domain_error(mp.log10(mp.mpf(str(x))))


def exp_e(x: float, mode: str) -> dict:
    r = mp.exp(mp.mpf(str(x)))
    y = float(r)
    # 実数として定義はされている。f64 に収まらないだけなので Overflow
    # （設計書 §3 の「Overflow のみ」）。
    if y in (float("inf"), float("-inf")):
        return {"error": "Overflow"}
    return {"re": y, "im": 0.0}


def _from_radians(r, mode: str):
    if mode == "Deg":
        return r * 180 / mp.pi
    if mode == "Rad":
        return r
    raise ValueError(f"unknown angle mode: {mode}")


def asin(x: float, mode: str) -> dict:
    r = mp.asin(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return _real_or_domain_error(_from_radians(r, mode))


def acos(x: float, mode: str) -> dict:
    r = mp.acos(mp.mpf(str(x)))
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    return _real_or_domain_error(_from_radians(r, mode))


def atan(x: float, mode: str) -> dict:
    return _real_or_domain_error(_from_radians(mp.atan(mp.mpf(str(x))), mode))
```

**`mode` を使わない関数にも引数を残す**のは、`generate.py` の 1 つのループが
`fn(x, mode)` で呼べるようにするためである。名前で分岐を増やさない。

- [ ] **Step 6: 入力ケースを足す**

`reference/src/calcarc_reference/cases.py` の `UNARY_INPUTS` の**後ろ**に新しいリストを
足す。`UNARY_INPUTS` 自体は触らない——既存の golden の id が動かないようにする。

```python
# S-1 で足した実数の関数（設計書 §3）。**定義域の境界を必須で含める**（§8）。
# 戻り値が dict なので UNARY_INPUTS とは別のループが読む。
REAL_FN_INPUTS: list[tuple[str, float, str]] = [
    # 自然対数: 既知値 / 境界 0 / 定義域の外 / 極大・極小
    ("ln", 1.0, "Deg"),
    ("ln", 2.718281828459045, "Deg"),
    ("ln", 2.0, "Deg"),
    ("ln", 0.5, "Deg"),
    ("ln", 0.0, "Deg"),
    ("ln", -1.0, "Deg"),
    ("ln", 1e-300, "Deg"),
    ("ln", 1e300, "Deg"),
    # 常用対数
    ("log10", 1.0, "Deg"),
    ("log10", 100.0, "Deg"),
    ("log10", 0.001, "Deg"),
    ("log10", 2.0, "Deg"),
    ("log10", 0.0, "Deg"),
    ("log10", -1.0, "Deg"),
    # e^x: 全実数。溢れる側の境界も置く（709.78 あたりが f64 の限界）
    ("exp_e", 0.0, "Deg"),
    ("exp_e", 1.0, "Deg"),
    ("exp_e", -1.0, "Deg"),
    ("exp_e", 2.0, "Deg"),
    ("exp_e", 709.0, "Deg"),
    ("exp_e", 710.0, "Deg"),
    ("exp_e", -745.0, "Deg"),
    # 逆三角: 両モード / 定義域の境界ちょうど / その外側
    ("asin", 0.0, "Deg"),
    ("asin", 0.5, "Deg"),
    ("asin", 1.0, "Deg"),
    ("asin", -1.0, "Deg"),
    ("asin", 1.0000001, "Deg"),
    ("asin", -1.0000001, "Deg"),
    ("asin", 0.5, "Rad"),
    ("acos", 0.0, "Deg"),
    ("acos", 0.5, "Deg"),
    ("acos", 1.0, "Deg"),
    ("acos", -1.0, "Deg"),
    ("acos", 1.0000001, "Deg"),
    ("acos", 0.5, "Rad"),
    ("atan", 0.0, "Deg"),
    ("atan", 1.0, "Deg"),
    ("atan", -1.0, "Deg"),
    ("atan", 1e300, "Deg"),
    ("atan", 1.0, "Rad"),
]
```

- [ ] **Step 7: `generate.py` に新しいループを足す**

`build_scientific` の `sqrt` ループの後ろに:

```python
    for name, x, mode in cases.REAL_FN_INPUTS:
        fn = getattr(scientific_ref, name)
        entries.append(
            {
                "id": f"{name}/{mode}/{x}",
                "op": name,
                "mode": mode,
                "input": {"x": x},
                "expect": fn(x, mode),
            }
        )
```

- [ ] **Step 8: golden の Rust 側に腕を足す**

`crates/calcarc-core/tests/golden.rs` の match に:

```rust
            "ln" => scientific::ln(x),
            "log10" => scientific::log10(x),
            "exp_e" => scientific::exp_e(x),
            "asin" => scientific::asin(x, mode),
            "acos" => scientific::acos(x, mode),
            "atan" => scientific::atan(x, mode),
```

- [ ] **Step 9: 参照実装自身のテストを足す**

`reference/tests/test_scientific_ref.py` に足す。**参照実装が黙って壊れないための
検査であって、Rust との突き合わせではない**（それは golden がやる）。

```python
def test_ln_is_undefined_at_zero_and_below():
    assert scientific_ref.ln(0.0, "Deg") == {"error": "DomainError"}
    assert scientific_ref.ln(-1.0, "Deg") == {"error": "DomainError"}


def test_inverse_sine_is_bounded_by_one():
    assert scientific_ref.asin(1.0000001, "Deg") == {"error": "DomainError"}
    assert scientific_ref.asin(1.0, "Deg")["re"] == pytest.approx(90.0)


def test_exp_overflows_rather_than_leaving_the_domain():
    # e^x は全実数で定義されている。f64 に入らないだけ（設計書 §3）。
    assert scientific_ref.exp_e(710.0, "Deg") == {"error": "Overflow"}
```

（`pytest` と `pytest.approx` の import が既にあることを確認する。無ければ足す。）

- [ ] **Step 10: 再生成して段 1〜3 を回す**

```bash
cd reference && uv run --no-config pytest && uv run --no-config python scripts/generate.py && cd ..
git diff --stat testdata/scientific.json
cargo fmt && cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

期待: すべて **PASS**。`scientific.json` に 38 件増える。

- [ ] **Step 11: 赤確認**

`asin` の定義域チェックを一時的に外す（`if !(-1.0..=1.0).contains(&x)` の行を消す）。

```bash
cargo test -p calcarc-core 2>&1 | grep -ciE '^test .* FAILED'
```

期待: `inverse_sine_and_cosine_are_bounded_by_one` と golden の 3 件
（`asin/Deg/1.0000001` など）が落ちる。**再編集で戻して緑を見る。**

- [ ] **Step 12: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Fill in six of the functions base-spec asked for

ln, log10, e^x, and the three inverse trig functions. Each one closes
over the reals and says DomainError where there is no real answer.

The reference does not copy those branches: it asks mpmath for the
value and treats "came back complex" as the domain boundary. That is
the whole point of having a second implementation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `1/x` — 0 は `DivisionByZero`

設計書 §3.0 を読むこと。**`DomainError` ではない**——利用者にとってそれはまさに
0 除算であり、`5 ÷ 0` と `0` `1/x` が違うエラーを返す理由が無い。

**Files:**
- Modify: `crates/calcarc-core/src/scientific/mod.rs`
- Modify: `reference/src/calcarc_reference/scientific_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`
- Modify: `crates/calcarc-core/tests/golden.rs`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Consumes: `scientific::real_arg`（Task 1）
- Produces: `pub fn recip(v: Value) -> CalcResult<Value>`（Task 7 がキーから呼ぶ）

**トークンの綴りは `recip`。** `inv` は逆三角（inverse）と紛れる。

- [ ] **Step 1: 失敗するテストを書く**

```rust
    #[test]
    fn reciprocal_of_zero_is_a_division_by_zero() {
        // DomainError ではない（設計書 §3.0）。利用者にとってこれは 0 除算で
        // あり、5 ÷ 0 と違うエラーを返す理由が無い。
        assert_eq!(recip(Value::real(0.0)), Err(CalcError::DivisionByZero));
    }

    #[test]
    fn reciprocal_inverts() {
        close(recip(Value::real(4.0)).unwrap().re, 0.25);
        close(recip(Value::real(-8.0)).unwrap().re, -0.125);
        // 複素数は DomainError。1 ÷ (3+j4) と四則で書けるので機能は失われない。
        assert_eq!(recip(Value::new(3.0, 4.0)), Err(CalcError::DomainError));
    }

    #[test]
    fn reciprocal_of_a_tiny_value_overflows() {
        assert_eq!(recip(Value::real(1e-320)), Err(CalcError::Overflow));
    }
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **コンパイルエラー**（`cannot find function `recip``）。

- [ ] **Step 3: 実装する**

```rust
/// 逆数。**`x = 0` は `DomainError` ではなく `DivisionByZero`**（設計書 §3.0）。
///
/// `DomainError` は「その値には定義が無い」を言うために新設した名前で、
/// 0 除算はそれとは別に既に名前を持っている。
pub fn recip(v: Value) -> CalcResult<Value> {
    let x = real_arg(v)?;
    if x == 0.0 {
        return Err(CalcError::DivisionByZero);
    }
    Value::real(1.0 / x).finalize()
}
```

- [ ] **Step 4: 緑を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **PASS**。

- [ ] **Step 5: 参照実装に足す**

```python
def recip(x: float, mode: str) -> dict:
    """逆数。0 は DivisionByZero（設計書 §3.0）。

    mpmath は 1/0 で ZeroDivisionError を投げる。**その例外をそのまま
    「0 で割った」の判定に使う**——Rust の `x == 0.0` を写したのではない。
    """
    try:
        r = mp.mpf(1) / mp.mpf(str(x))
    except ZeroDivisionError:
        return {"error": "DivisionByZero"}
    y = float(r)
    if y in (float("inf"), float("-inf")):
        return {"error": "Overflow"}
    return {"re": y, "im": 0.0}
```

- [ ] **Step 6: 入力ケースを足す**

`cases.py` の `REAL_FN_INPUTS` の末尾に:

```python
    # 逆数（設計書 §3.0）。0 は DivisionByZero、極小は Overflow。
    ("recip", 4.0, "Deg"),
    ("recip", -8.0, "Deg"),
    ("recip", 1.0, "Deg"),
    ("recip", 3.0, "Deg"),
    ("recip", 0.0, "Deg"),
    ("recip", 1e-320, "Deg"),
    ("recip", 1e300, "Deg"),
```

- [ ] **Step 7: golden の Rust 側に腕を足す**

```rust
            "recip" => scientific::recip(x),
```

- [ ] **Step 8: 参照のテストを足す**

`reference/tests/test_scientific_ref.py`:

```python
def test_reciprocal_of_zero_is_a_division_by_zero():
    # DomainError と取り違えると、golden が Rust の裁定違いを見逃す。
    assert scientific_ref.recip(0.0, "Deg") == {"error": "DivisionByZero"}
```

- [ ] **Step 9: 再生成して段 1〜3 を回す**

```bash
cd reference && uv run --no-config pytest && uv run --no-config python scripts/generate.py && cd ..
cargo fmt && cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

期待: すべて **PASS**。

- [ ] **Step 10: 赤確認**

`recip` の `DivisionByZero` を `DomainError` に変え、
`reciprocal_of_zero_is_a_division_by_zero` と golden の `recip/Deg/0.0` が落ちることを
見る。**この 2 つが両方落ちるのが要点**——裁定の中身を Rust と Python の両方が
独立に押さえていることの確認である。**再編集で戻して緑を見る。**

- [ ] **Step 11: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Add 1/x, and let 0 be a division by zero

The user asked for a reciprocal key. Zero gets DivisionByZero, not
DomainError — to the person pressing it, that is exactly what it is,
and 5 ÷ 0 already has that name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 左結合を守る行を足して、緑を見る

**このタスクは 1 行も実装を変えない。** `push_binop` の比較を触る前に、**いま何が
守られているのかを書き留める**。

**【訂正 2026-08-16】設計書 §3.1 の「左結合を守る行が 1 つも無い」は誤りである。**
`feature/e2e-corpus` 担当セッションの指摘を受けて実測し直した。**半分は在る:**

`engine_table.rs:214-219` の `reduces_same_precedence_left_to_right` の**1 行目**
（`["2","add","3","add"]` → `"5"`）が結合方向を捕まえる。`push_binop` の比較を
`>=` から `>` に素朴に変えると 2 つ目の `+` で畳まれなくなり、`state.current` が
3 のままになって **`"3"` が出る。この行は赤くなる**（2026-08-16 実測。
落ちるのはこの 1 件だけ）。

**在るのは「途中の表示」の守りであって、「答え」の守りではない。** 同じ test の
2 行目 `2 + 3 + 4 = 9` は、加算が結合的なので**どちらの結合でも 9** であり、
区別しない。`10 − 3 − 2` が 5 か 9 か、`100 ÷ 5 ÷ 2` が 10 か 40 か——
**答えの側で結合方向を主張する行は無い。** このタスクが足すのはそれである。

**この区別には使い道がある**（相手の指摘）: `xʸ` だけを右結合にする実装なら、
**既存の 217 行目は緑のままのはず**である。もし赤くなったら、他の演算子まで
巻き込んでいる証拠になる。**既存の行が、変更の範囲を測る道具になる**
——Task 5 の赤確認でそう使う。

**Files:**
- Modify: `crates/calcarc-core/tests/engine_table.rs`

**Interfaces:**
- Produces: なし（検査だけを足す）

- [ ] **Step 1: 左結合を主張する行を足す**

`engine_table.rs` の `functions_compose_with_operators` の近く、演算子の節に足す。

```rust
#[test]
fn same_precedence_operators_fold_from_the_left_in_the_answer() {
    // **この行は Task 5 のために足した。** `xʸ` を右結合で入れるとき
    // `push_binop` の畳み込み条件に手が入るので、他の演算子が左結合の
    // ままであることを先に固定する。
    //
    // `reduces_same_precedence_left_to_right` が既に**途中の表示**を
    // 守っている（2 つ目の `+` で 5 が出る）。守られていないのは**答え**
    // のほうで、あちらの `2 + 3 + 4 = 9` は加算が結合的なのでどちらの
    // 結合でも 9 になり、区別しない。減算と除算なら区別する。
    assert_eq!(main_of(&["1", "0", "sub", "3", "sub", "2", "eq"]), "5"); // 9 でない
    assert_eq!(main_of(&["1", "0", "0", "div", "5", "div", "2", "eq"]), "10"); // 40 でない
}
```

- [ ] **Step 2: 緑であることを見る**

```bash
cargo test -p calcarc-core --test engine_table -- --exact same_precedence_operators_fold_from_the_left
```

期待: **PASS**。いまのエンジンは全演算子が左結合なので通る。
**ここで落ちたら Task 5 に進んではいけない**——前提が違う。

- [ ] **Step 3: 設計書の誤った実測記録を訂正する**

`docs/superpowers/specs/2026-08-16-scientific-real-functions-design.md` §3.1 の

> **左結合を守る行を足す。実測したところ、いま `engine_table.rs` に 1 つも無い**
> （2026-08-16 確認）。在るのは演算子の押し直し（…）の 2 行だけで、**同順位の
> 演算子が連続したときにどちらから畳むかを確かめる行が無い**。

を、実測し直した事実に置き換える:

```markdown
**左結合を守る行を足す。ただし「1 つも無い」は誤りだった**（当初の記述を
2026-08-16 に訂正。`feature/e2e-corpus` 担当セッションの指摘で測り直した）。

`reduces_same_precedence_left_to_right` の 1 行目（`2 add 3 add` → `"5"`）が
**途中の表示**として結合方向を捕まえる。比較を `>` に変えると `"3"` が出て
赤くなる（実測。落ちるのはこの 1 件だけ）。**守られていないのは「答え」の
ほうである**——同じ test の `2 + 3 + 4 = 9` は加算が結合的なのでどちらの
結合でも 9 になり、区別しない。足すべきは減算と除算で答えを主張する行である。
```

**理由が静かに腐るのを防ぐ訂正である。** 検査は緑のままでも、「なぜこの順序で
やるのか」の根拠が事実でなくなっていた。

- [ ] **Step 4: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Write down that − and ÷ fold from the left, before touching that line

Nothing in engine_table checked which way same-precedence operators
fold. The next commit rewrites the comparison that decides it. Put the
guard in first and watch it pass, so a regression there is visible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `xʸ` — 二項演算子、優先順位 4、**右結合**

**S-1 の中で唯一エンジンの構造を動かすタスクである。** 設計書 §3.1 と §4 を読むこと。

このタスクは**キーを 1 つ端から端まで通す**: `Key::Pow` を足すと `token_parity.rs` が
TypeScript の `KEY_TOKENS` との一致を要求し、`scientific.test.ts` が盤面への配置を
要求する。3 つを同じコミットに入れる。

**Files:**
- Modify: `crates/calcarc-core/src/scientific/mod.rs`（`pow`）
- Modify: `crates/calcarc-core/src/engine/state.rs`（`BinOp::Pow`・`precedence`・
  `is_right_associative`）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`push_binop`・`apply_binop`・
  `apply`・`reduce` の腕）
- Modify: `crates/calcarc-core/src/engine/key.rs`（`Key::Pow`・`ALL` を 33 → 34）
- Modify: `crates/calcarc-core/src/engine/display.rs`（`op_symbol`）
- Modify: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `web/src/calc/types.ts`（`KEY_TOKENS` に `"pow"`、`BinOpName` に `"Pow"`）
- Modify: `web/src/ui/Display/Display.tsx`（`OP_SYMBOL`）
- Modify: `web/src/ui/Keypad/scientific.ts`（2 段目の 6 番目に `xʸ`）
- Modify: `web/src/ui/Keypad/scientific.test.ts`

**Interfaces:**
- Consumes: `CalcError::DomainError`（Task 1）
- Produces: `pub fn pow(base: Value, exponent: Value) -> CalcResult<Value>`
- Produces: `BinOp::Pow` と `BinOp::is_right_associative(self) -> bool`
- Produces: キートークン `"pow"`（`Key::ALL` と `KEY_TOKENS` の**末尾に追加**。
  既存の並びを変えない）

**`STATE_SCHEMA` は上げない**（Global Constraints）。

- [ ] **Step 1: `xʸ` の定義域のユニットテストを書く**

`scientific/mod.rs` の `mod tests` に足す。表は設計書 §4 と 1:1 で対応する。

```rust
    #[test]
    fn power_of_a_positive_base() {
        close(pow(Value::real(2.0), Value::real(10.0)).unwrap().re, 1024.0);
        close(pow(Value::real(2.0), Value::real(0.5)).unwrap().re, 2.0_f64.sqrt());
        close(pow(Value::real(2.0), Value::real(-1.0)).unwrap().re, 0.5);
    }

    #[test]
    fn zero_to_the_zero_is_one() {
        // 数学的には不定形だが、電卓は 1 を返すのが慣行である（設計書 §4.1）。
        // DomainError にすると x^0 の一様性が x = 0 でだけ崩れ、利用者には
        // 理由が見えない。
        assert_eq!(pow(Value::real(0.0), Value::real(0.0)).unwrap(), Value::real(1.0));
    }

    #[test]
    fn zero_to_a_positive_power_is_zero_and_to_a_negative_one_is_undefined() {
        assert_eq!(pow(Value::real(0.0), Value::real(3.0)).unwrap(), Value::ZERO);
        assert_eq!(
            pow(Value::real(0.0), Value::real(-1.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn a_negative_base_needs_an_integer_exponent() {
        // (-2)^3 は実数で一意。これをエラーにすると普段やる計算が落ちる。
        close(pow(Value::real(-2.0), Value::real(3.0)).unwrap().re, -8.0);
        close(pow(Value::real(-2.0), Value::real(2.0)).unwrap().re, 4.0);
        // 非整数の指数は複素数になる（裁定 1）。
        assert_eq!(
            pow(Value::real(-2.0), Value::real(0.5)),
            Err(CalcError::DomainError)
        );
        assert_eq!(
            pow(Value::real(-8.0), Value::real(1.0 / 3.0)),
            Err(CalcError::DomainError)
        );
    }

    #[test]
    fn power_rejects_complex_operands() {
        let z = Value::new(3.0, 4.0);
        assert_eq!(pow(z, Value::real(2.0)), Err(CalcError::DomainError));
        assert_eq!(pow(Value::real(2.0), z), Err(CalcError::DomainError));
    }

    #[test]
    fn power_overflows_rather_than_returning_infinity() {
        assert_eq!(
            pow(Value::real(10.0), Value::real(400.0)),
            Err(CalcError::Overflow)
        );
    }
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **コンパイルエラー**（`cannot find function `pow``）。

- [ ] **Step 3: `scientific::pow` を実装する**

**`f64::powf` に丸投げしない**（設計書 §4）。`powf` は `(-8.0).powf(1.0/3.0)` を `NaN`
にするが `(-2.0).powf(3.0)` は `-8` を返す。定義域の判定を先に自分で書き、判定を
通ったものにだけ `powf` を使う。

```rust
/// x の y 乗。**二項演算子であって後置関数ではない**（設計書 §3.1）。
///
/// 実数の範囲で答が一意に決まるものは返し、そうでないものは `DomainError` に
/// する。判定を `f64::powf` に任せない——`powf` は `(-8)^(1/3)` を NaN に
/// するが `(-2)^3` は −8 を返すので、**どちらが定義域の外なのかを powf は
/// 区別していない**。判定を先に書き、通ったものにだけ powf を使う。
pub fn pow(base: Value, exponent: Value) -> CalcResult<Value> {
    let x = real_arg(base)?;
    let y = real_arg(exponent)?;
    if !y.is_finite() {
        return Err(CalcError::DomainError);
    }
    if x == 0.0 {
        return match y.partial_cmp(&0.0) {
            // 0^0 = 1。電卓の慣行に従う（設計書 §4.1）。
            Some(std::cmp::Ordering::Equal) => Ok(Value::real(1.0)),
            Some(std::cmp::Ordering::Greater) => Ok(Value::ZERO),
            // 0^(負) は 0 除算だが、設計書 §4 の表は DomainError と定める。
            _ => Err(CalcError::DomainError),
        };
    }
    if x < 0.0 && y.fract() != 0.0 {
        // 複素数になる（裁定 1）。
        return Err(CalcError::DomainError);
    }
    let r = x.powf(y);
    if r.is_nan() {
        // 判定漏れを黙って通さないための最後の網。
        return Err(CalcError::DomainError);
    }
    Value::real(r).finalize()
}
```

- [ ] **Step 4: 緑を見る**

```bash
cargo test -p calcarc-core --lib scientific
```

期待: **PASS**。

- [ ] **Step 5: `BinOp::Pow` と結合方向を足す**

`crates/calcarc-core/src/engine/state.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    /// xʸ。**唯一の右結合演算子**（設計書 §3.1）。
    Pow,
}

impl BinOp {
    /// 大きいほど先に評価される（設計書 D9）。
    ///
    /// 3 は空けてある——S-3 が `nPr` / `nCr` をそこに置く。
    pub fn precedence(self) -> u8 {
        match self {
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul | BinOp::Div => 2,
            BinOp::Pow => 4,
        }
    }

    /// 同じ優先順位が連続したとき、右から畳むか。
    ///
    /// 数学の慣行では冪だけが右結合で、`2^3^2` は `2^(3^2) = 512` である
    /// （`(2^3)^2 = 64` ではない）。**左結合はタダではない**——独立検証層の
    /// mpmath は慣行に従うので、左結合を選ぶと恒久的に食い違う。それを消す
    /// 唯一の方法は Python に engine の意味論を教えることで、それは
    /// CONTRIBUTING の「参照実装を Rust の移植にしない」に真正面から当たる
    /// （設計書 §3.2）。
    pub fn is_right_associative(self) -> bool {
        matches!(self, BinOp::Pow)
    }
}
```

- [ ] **Step 6: `push_binop` の畳み込み条件を書き換える**

`crates/calcarc-core/src/engine/mod.rs`。**これは既存の論理の書き換えである。**
Task 4 で足した行が、他の演算子が左結合のままであることを守る。

```rust
    // `state.operators.last()` の借用を while の条件式で終わらせてから
    // `reduce_top(&mut state)` を呼ぶ。matches! の中に閉じ込めるのがその手段。
    //
    // **`>=` ではない。** 同順位のときに畳むかどうかを結合方向が決める
    // ——左結合なら畳み（`10 − 3 − 2` は `(10−3)−2`）、右結合なら積む
    // （`2 xʸ 3 xʸ 2` は `2^(3^2)`）。設計書 §3.1。
    while matches!(
        state.operators.last(),
        Some(OpToken::Op(top)) if top.precedence() > op.precedence()
            || (top.precedence() == op.precedence() && !op.is_right_associative())
    ) {
        reduce_top(state)?;
    }
```

`apply_binop` にも腕を足す:

```rust
        BinOp::Div => lhs.checked_div(rhs),
        BinOp::Pow => scientific::pow(lhs, rhs),
```

- [ ] **Step 7: `Key::Pow` を足す**

`crates/calcarc-core/src/engine/key.rs` の 3 か所。**既存の並びを変えず、末尾に足す**
（`Key::ALL` の順序は `KEY_TOKENS` の順序と 1:1 で突き合わされる）。

```rust
    /// 工学表記(ENG)のトグル。表示の切り替えであって計算ではない(設計書 §4)。
    EngToggle,
    /// xʸ。二項演算子であって後置関数ではない(S-1 設計書 §3.1)。
    Pow,
}
```

`from_token` に `"pow" => Key::Pow,`、`token()` に `Key::Pow => "pow",`、
`ALL` を `[Key; 34]` にして末尾に `Key::Pow,`。

- [ ] **Step 8: `apply` と `reduce` の腕を足す**

`engine/mod.rs` の `apply`:

```rust
        Key::Pow => push_binop(state, BinOp::Pow)?,
```

`reduce` の `operator_pending` の match で、**二項演算子の腕に足す**:

```rust
                Key::Add | Key::Sub | Key::Mul | Key::Div | Key::Pow => true,
```

- [ ] **Step 9: エコーの記号を足す**

`engine/display.rs` の `op_symbol`:

```rust
        BinOp::Div => "÷",
        BinOp::Pow => "^",
```

- [ ] **Step 10: TypeScript 側を合わせる**

`web/src/calc/types.ts`:

```ts
export type BinOpName = "Add" | "Sub" | "Mul" | "Div" | "Pow";
```

`KEY_TOKENS` の末尾（`"eng"` の後）に `"pow",` を足す。

`web/src/ui/Display/Display.tsx`:

```ts
const OP_SYMBOL: Record<BinOpName, string> = {
  Add: "+",
  Sub: "−",
  Mul: "×",
  Div: "÷",
  Pow: "^",
};
```

- [ ] **Step 11: 盤面の 6 番目に `xʸ` を置く**

`web/src/ui/Keypad/scientific.ts` の `FUNCTIONS_SECOND`。最終形は
`[ENG] [ln] [log] [1/x] [eˣ] [xʸ] [°'"]`（設計書 §7）なので、**6 番目**に入れ、
残りは予約スロットのままにする。

```ts
const FUNCTIONS_SECOND: KeypadSection<KeyToken> = {
  ariaLabel: "第 2 関数列",
  columns: 7,
  height: "half",
  keys: [
    {
      token: "eng",
      label: "ENG",
      ariaLabel: "工学表記に切り替え",
      variant: "function",
    },
    // 1〜4 番目は S-1 の単項が埋める（同ブランチの後続タスク）。
    ...Array.from({ length: 4 }, () => ({
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function" as const,
    })),
    { token: "pow", label: "xʸ", ariaLabel: "べき乗", variant: "function" },
    // 7 番目は S-4 の `°'"` が埋める。
    {
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function" as const,
    },
  ],
};
```

`web/src/ui/Keypad/scientific.test.ts` の `puts ENG on the first face, not behind Shift`
の最後の 2 行を書き換える:

```ts
    expect(second?.keys).toHaveLength(7);
    // 2 段目の並びは設計書 §7 の確定盤面。予約は S-1 の単項（1〜4）と
    // S-4 の `°'"`（7 番目）。
    expect(second?.keys.map((k) => k.token)).toEqual([
      "eng",
      null,
      null,
      null,
      null,
      "pow",
      null,
    ]);
```

- [ ] **Step 12: 仕様の行を足す（キー列と表示）**

`engine_table.rs`。**`64` にならないことがこの裁定の全内容である。**

```rust
#[test]
fn the_power_operator_folds_from_the_right() {
    // 数学の慣行（設計書 §3.1 の裁定 3）。左結合なら (2^3)^2 = 64 になる。
    assert_eq!(main_of(&["2", "pow", "3", "pow", "2", "eq"]), "512");
}

#[test]
fn the_power_operator_binds_tighter_than_multiplication() {
    // 2 × 3² = 18。優先順位 4（設計書 §3.1）。
    assert_eq!(main_of(&["2", "mul", "3", "pow", "2", "eq"]), "18");
    assert_eq!(main_of(&["2", "pow", "3", "mul", "2", "eq"]), "16");
}

#[test]
fn the_power_operator_takes_a_negative_base_with_an_integer_exponent() {
    // (-2)^3 = -8 は実数で一意（設計書 §4）。
    assert_eq!(main_of(&["2", "neg", "pow", "3", "eq"]), "-8");
    // 非整数の指数は複素数になるので落とす。
    assert_eq!(main_of(&["2", "neg", "pow", "0", "dot", "5", "eq"]), "Math ERROR");
}

#[test]
fn zero_to_the_zero_is_one_on_the_keypad() {
    assert_eq!(main_of(&["0", "pow", "0", "eq"]), "1");
}

#[test]
fn the_echo_shows_the_power_operator() {
    assert_eq!(echo_of(&["2", "pow"]), "2 ^");
}
```

`every_error_kind_reaches_the_display` に `DomainError` の行を足す:

```rust
    assert_eq!(
        run(&["4", "neg", "sqrt"]).error,
        Some(CalcError::DomainError)
    );
```

- [ ] **Step 13: 段 1・3・4 を回す**

```bash
cargo fmt && cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd web && pnpm test && cd ..
```

期待: すべて **PASS**。特に `token_parity.rs` の
`key_tokens_match_between_typescript_and_rust` と、`scientific.test.ts` の
`offers every key the core accepts, exactly once` が通ること。

- [ ] **Step 14: 赤確認 — 比較を `>=` に戻す**

設計書 §3.1 が名指しで要求している。**片方だけ動いたのでは意味がない。**

`push_binop` の while 条件を一時的に旧い形へ戻す:

```rust
        Some(OpToken::Op(top)) if top.precedence() >= op.precedence()
```

```bash
cargo test -p calcarc-core --test engine_table --no-fail-fast 2>&1 \
  | grep -E '^test .*(ok|FAILED)' | grep -E 'fold_from_the|power_operator|same_precedence'
```

期待:
- `the_power_operator_folds_from_the_right` … **FAILED**（`64` が出る）
- `same_precedence_operators_fold_from_the_left_in_the_answer` … **ok**
- `reduces_same_precedence_left_to_right` … **ok**

**3 つが同時に成り立つことを目で確かめる。** 右結合だけが壊れ、左結合は
壊れていない——それが「1 行の条件式で他の演算子の挙動を変えていない」ことの証拠である。

**逆向きの測り方も 1 度やる**（`feature/e2e-corpus` 担当セッションの指摘）。
Step 6 の実装のまま、`is_right_associative` を `true` を返すだけにする
（= 全演算子を右結合にする）と、**`reduces_same_precedence_left_to_right` と
Task 4 の 2 行がどちらも赤くなる**はずである。片方しか赤くならなければ、
守りの射程がこちらの想定より狭い。**戻すのを忘れないこと。**

**再編集で Step 6 の形に戻し**、緑を見る。

- [ ] **Step 15: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Give xʸ its own precedence, and fold it from the right

2^3^2 is 512, not 64. Every other operator in this engine folds from
the left and keeps doing so — the comparison in push_binop now asks
the operator which way it goes instead of assuming.

Left-associative was not free: mpmath follows the convention, so the
independent layer would have disagreed forever, and the only way to
silence it is to teach Python the engine's semantics. That is the one
thing CONTRIBUTING says not to do.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `pow` の golden と、網羅列挙に `Pow` を足す

**Files:**
- Modify: `reference/src/calcarc_reference/scientific_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`
- Modify: `reference/scripts/generate.py`
- Modify: `reference/tests/test_scientific_ref.py`
- Modify: `crates/calcarc-core/tests/golden.rs`
- Modify: `crates/calcarc-core/tests/engine_robustness.rs`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Consumes: `scientific::pow`（Task 5）、golden の `expect.error`（Task 1）
- Produces: golden の `op: "pow"`（`input` は `{"x": …, "y": …}` の 2 引数。
  **既存の単項ケースと形が違う**ので、Rust 側は別ループで読む）

- [ ] **Step 1: 参照実装に `pow_real` を足す**

```python
def pow_real(x: float, y: float) -> dict:
    """x の y 乗を実数の範囲で。

    **定義域の判定を Rust から写さない。** mpmath に計算させ、返ってきたのが
    複素数なら「実数の答が無い」と判定する。Rust は `y.fract() == 0.0` で
    整数指数を先に判定しており、**書き方がまるで違う**——そこに突き合わせる
    価値がある。

    **1 か所だけ規約を直に書いている**: `0^(y<0)` である。mpmath は
    ZeroDivisionError を投げるが、設計書 §4 の表はここを DomainError と
    定めている（`1/x` の 0 が DivisionByZero なのとは別の裁定）。
    数学からは導けないので、規約として書く。
    """
    if x == 0.0 and y < 0.0:
        return {"error": "DomainError"}
    try:
        r = mp.power(mp.mpf(str(x)), mp.mpf(str(y)))
    except ZeroDivisionError:
        return {"error": "DomainError"}
    if isinstance(r, mp.mpc) and r.imag != 0:
        return {"error": "DomainError"}
    v = float(r.real if isinstance(r, mp.mpc) else r)
    if v in (float("inf"), float("-inf")):
        return {"error": "Overflow"}
    return {"re": v, "im": 0.0}
```

- [ ] **Step 2: 入力ケースを足す**

`cases.py`。**設計書 §4 の表と 1:1 で対応させる**（各行に表の分岐名をコメントで書く）。

```python
# xʸ（設計書 §4 の定義域表と 1:1）。(x, y)
POW_INPUTS: list[tuple[float, float]] = [
    (2.0, 10.0),  # x > 0 / 整数
    (2.0, 0.5),  # x > 0 / 非整数
    (2.0, -1.0),  # x > 0 / 負
    (10.0, 3.0),
    (1.5, 2.5),
    (0.0, 3.0),  # x = 0, y > 0 → 0
    (0.0, 0.0),  # x = 0, y = 0 → 1（§4.1）
    (0.0, -1.0),  # x = 0, y < 0 → DomainError
    (-2.0, 3.0),  # x < 0 / 整数 → -8
    (-2.0, 2.0),  # x < 0 / 偶数 → 4
    (-2.0, 0.0),  # x < 0 / 0 乗 → 1
    (-2.0, 0.5),  # x < 0 / 非整数 → DomainError
    (-8.0, 0.3333333333333333),  # x < 0 / 非整数（立方根の見た目）→ DomainError
    (10.0, 400.0),  # Overflow
    (10.0, -400.0),  # 極小（Overflow ではない）
    (1e-8, 2.0),
]
```

- [ ] **Step 3: `generate.py` に `pow` のループを足す**

```python
    for x, y in cases.POW_INPUTS:
        entries.append(
            {
                "id": f"pow/{x}/{y}",
                "op": "pow",
                "input": {"x": x, "y": y},
                "expect": scientific_ref.pow_real(x, y),
            }
        )
```

- [ ] **Step 4: golden の Rust 側に `pow` の腕を足す**

`golden.rs` の match は `x` 1 引数を前提にしているので、`pow` だけ `y` を読む。

```rust
            "pow" => scientific::pow(x, Value::real(field(&case.input, "y"))),
```

（`x` は既に `Value::real(field(&case.input, "x"))` として作られている。）

- [ ] **Step 5: 参照のテストを足す**

```python
def test_zero_to_the_zero_is_one():
    assert scientific_ref.pow_real(0.0, 0.0)["re"] == 1.0


def test_a_negative_base_with_a_fractional_exponent_leaves_the_reals():
    assert scientific_ref.pow_real(-2.0, 0.5) == {"error": "DomainError"}
    # 整数指数なら実数で一意。
    assert scientific_ref.pow_real(-2.0, 3.0)["re"] == -8.0
```

- [ ] **Step 6: 再生成して緑を見る**

```bash
cd reference && uv run --no-config pytest && uv run --no-config python scripts/generate.py && cd ..
cargo test -p calcarc-core --test golden
```

期待: **PASS**。`scientific.json` に 16 件増える。

- [ ] **Step 7: 網羅列挙に `Pow` を足す**

`crates/calcarc-core/tests/engine_robustness.rs` の `ALL_CLASSES` を 15 → 16 にする。

**理由**: `Pow` は `push_binop` に**新しい状態の形**を作る。右結合なので
`2 ^ 3 ^` の時点で畳まれず、**同順位の演算子が 2 つ積まれたスタック**が生まれる。
これは既存のどの演算子でも到達できない形であり、I4（演算子の差し替え）と
I7（括弧の会計）がその形の上で成り立つことを見たい。

**予算の実測（2026-08-16、S-1）**: 追加前、`ALL_CLASSES` 15 個・長さ 6 で **11.94 秒**、
`STRUCTURE` 10 個・長さ 7 で **7.40 秒**（並行して走るのでファイル全体は 12.34 秒）。
16 個にすると `(16/15)^6 = 1.48` 倍で **約 17.7 秒**の見込み。**長さ 6 を維持する。**
`STRUCTURE` には足さない——11 個にすると `(11/10)^7 = 1.95` 倍で 14.4 秒になり、
`ALL_CLASSES` が既に覆う形のために倍払うことになる。

```rust
const ALL_CLASSES: [Key; 16] = [
    Key::Digit(3),
    Key::Digit(0),
    Key::Dot,
    Key::J,
    Key::Sub,
    Key::Div,
    Key::Eq,
    Key::LParen,
    Key::RParen,
    Key::Del,
    Key::Ac,
    Key::PolarToggle,
    Key::Sqrt,
    Key::Pi,
    Key::Exp,
    Key::Pow,
];
```

同じ doc コメントの予算の段落を、実測し直した数字で書き換える:

```rust
/// `xʸ` は畳めない。**唯一の右結合演算子**で、同順位の演算子が畳まれずに
/// 2 つ積まれたスタック（`2 ^ 3 ^`）を作る。これは他のどの演算子でも到達
/// できない形なので、`−` や `÷` の等価類には入らない（S-1 設計書 §3.1）。
///
/// **予算の実測(2026-08-16、S-1)**: 15 個で 11.9 秒、16 個で NN 秒。
/// (16/15)^6 = 1.48 の見込みと突き合わせること。**長さ 6 を維持した。**
/// 次に等価類を足す人へ: 17 個なら約 1.4 倍になる。そこが分かれ目で、
/// 越えるなら長さを 5 に落として `Exp` と `xʸ` を含む列の重点列挙を別に持つこと。
```

- [ ] **Step 8: 実測して `NN` を埋める**

```bash
cargo test -p calcarc-core --test engine_robustness -- --exact \
  every_sequence_over_all_classes_up_to_six_keys_holds_the_invariants
```

**出力の `finished in X.XXs` を読んで、Step 7 のコメントの `NN` を実測値に置き換える。**
見込みと大きく違ったら、その事実もコメントに書く（**予測ではなく実測を残す**）。

**20 秒を超えたら `Key::Pow` を `ALL_CLASSES` から外し**、代わりに
`engine_table.rs` へ `["2","pow","3","pow","2","del","4","eq"]` のような
「積まれたスタックを DEL が触る」行を 1 つ足すこと。理由をコメントに書く。

- [ ] **Step 9: 段 1〜3 を回す**

```bash
cargo fmt && cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd reference && uv run --no-config pytest && cd ..
```

期待: すべて **PASS**。

- [ ] **Step 10: 赤確認**

`pow` の `if x < 0.0 && y.fract() != 0.0` の行を消す（`powf` に丸投げする形にする）。

```bash
cargo test -p calcarc-core --test golden 2>&1 | grep -i 'pow/-'
```

期待: `pow/-2.0/0.5` が落ちる——**ただし `NaN` の最後の網が拾うので `DomainError`
のまま通ってしまう可能性がある。** そうなったら、**網のほうを外して**もう一度
測ること。**判定と網のどちらが効いているのかを目で確かめる**のがこの赤確認の中身で、
「両方あるから安心」で済ませない。**再編集で戻して緑を見る。**

- [ ] **Step 11: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Check xʸ against mpmath, and put it in the exhaustive net

The reference decides the domain by asking whether mpmath handed back
a complex number. Rust decides it by asking whether the exponent is a
whole number. Two different questions, same answers — that is what the
golden is for.

Pow joins ALL_CLASSES because right-associativity builds an operator
stack no other key can reach. Measured cost is in the comment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 残り 8 キーを盤面まで通す

単項 7 つ（`ln` `log10` `exp_e` `recip` `asin` `acos` `atan`）と定数 `e`。
設計書 §7 の確定盤面を実装する。

**Files:**
- Modify: `crates/calcarc-core/src/engine/key.rs`（`ALL` を 34 → 42）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`apply` と `reduce` の腕）
- Modify: `crates/calcarc-core/tests/engine_table.rs`
- Modify: `web/src/calc/types.ts`（`KEY_TOKENS`）
- Modify: `web/src/ui/Keypad/scientific.ts`
- Modify: `web/src/ui/Keypad/scientific.test.ts`
- Modify: `web/src/ui/Keypad/Keypad.test.tsx`
- Modify: `web/tests/e2e/keypad-shell.spec.ts`

**Interfaces:**
- Consumes: `scientific::{ln, log10, exp_e, recip, asin, acos, atan}`（Task 2・3）
- Produces: キートークン `"ln"` `"log10"` `"exp_e"` `"recip"` `"asin"` `"acos"`
  `"atan"` `"e"`（**この順で** `Key::ALL` と `KEY_TOKENS` の末尾に追加）

**順序が契約である。** `token_parity.rs` は `Key::ALL` の `token()` 列と
`KEY_TOKENS` を**順序込みで**比較する。2 つのファイルに同じ順で足すこと。

- [ ] **Step 1: 仕様の行を先に書く**

`engine_table.rs` に足す。**キー列と表示の対応を先に決める**（CLAUDE.md）。

```rust
#[test]
fn the_real_functions_apply_immediately_like_the_others() {
    // 単項は後置。式には積まれない（設計書 D6）。
    assert_eq!(main_of(&["2", "ln"]), "0.6931471806");
    assert_eq!(main_of(&["1", "0", "0", "log10"]), "2");
    assert_eq!(main_of(&["1", "exp_e"]), "2.718281828");
    assert_eq!(main_of(&["4", "recip"]), "0.25");
}

#[test]
fn the_inverse_trig_functions_follow_the_angle_mode() {
    assert_eq!(main_of(&["0", "dot", "5", "asin"]), "30");
    assert_eq!(main_of(&["0", "dot", "5", "acos"]), "60");
    assert_eq!(main_of(&["1", "atan"]), "45");
    // Rad に切り替えると同じ入力がラジアンで返る。
    assert_eq!(main_of(&["angle_toggle", "1", "atan"]), "0.7853981634");
}

#[test]
fn the_domain_boundaries_show_an_error() {
    assert_eq!(main_of(&["0", "ln"]), "Math ERROR");
    assert_eq!(main_of(&["1", "neg", "log10"]), "Math ERROR");
    assert_eq!(main_of(&["2", "asin"]), "Math ERROR");
    // 1/0 は DivisionByZero。表示は同じでも種類が違う（設計書 §3.0）。
    use calcarc_core::CalcError;
    assert_eq!(run(&["0", "recip"]).error, Some(CalcError::DivisionByZero));
    assert_eq!(run(&["0", "ln"]).error, Some(CalcError::DomainError));
}

#[test]
fn e_is_a_value_not_an_entry() {
    // π と同じ扱い（設計書 §3）。
    assert_eq!(main_of(&["e"]), "2.718281828");
    assert_eq!(main_of(&["e", "ln"]), "1");
}
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --test engine_table 2>&1 | grep -c 'unknown key'
```

期待: **panic**（`unknown key: ln`）。4 つの test が落ちる。

- [ ] **Step 3: `Key` に 8 つ足す**

`key.rs` の enum に、**この順で**末尾に足す:

```rust
    /// xʸ。二項演算子であって後置関数ではない(S-1 設計書 §3.1)。
    Pow,
    /// 自然対数。
    Ln,
    /// 常用対数。
    Log10,
    /// e の x 乗。**`Key::Exp`(指数入力 EE)とは別物**(S-1 設計書 §3)。
    ExpE,
    /// 逆数。
    Recip,
    Asin,
    Acos,
    Atan,
    /// 自然対数の底。π と同じ「値そのもの」のキー。
    E,
}
```

`from_token` / `token()` にそれぞれ:

```rust
            "ln" => Key::Ln,
            "log10" => Key::Log10,
            "exp_e" => Key::ExpE,
            "recip" => Key::Recip,
            "asin" => Key::Asin,
            "acos" => Key::Acos,
            "atan" => Key::Atan,
            "e" => Key::E,
```

```rust
            Key::Ln => "ln",
            Key::Log10 => "log10",
            Key::ExpE => "exp_e",
            Key::Recip => "recip",
            Key::Asin => "asin",
            Key::Acos => "acos",
            Key::Atan => "atan",
            Key::E => "e",
```

`ALL` を `[Key; 42]` にして、`Key::Pow` の後ろに同じ順で 8 つ足す。

- [ ] **Step 4: `apply` に腕を足す**

`engine/mod.rs` の `apply`:

```rust
        Key::Ln => apply_unary(state, scientific::ln)?,
        Key::Log10 => apply_unary(state, scientific::log10)?,
        Key::ExpE => apply_unary(state, scientific::exp_e)?,
        Key::Recip => apply_unary(state, scientific::recip)?,
        Key::Asin => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::asin(v, mode))?;
        }
        Key::Acos => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::acos(v, mode))?;
        }
        Key::Atan => {
            let mode = state.angle;
            apply_unary(state, |v| scientific::atan(v, mode))?;
        }
        Key::E => {
            // π と同じ。入力中のバッファを捨てて値そのものを置く。
            state.buffer = None;
            state.current = Value::real(std::f64::consts::E);
        }
```

- [ ] **Step 5: `reduce` の `operator_pending` に腕を足す**

**値を確定させるキー**の側（`false` を返す腕）に 8 つとも足す:

```rust
                Key::Eq
                | Key::RParen
                | Key::Pi
                | Key::E
                | Key::Sqrt
                | Key::Sqr
                | Key::Sin
                | Key::Cos
                | Key::Tan
                | Key::Ln
                | Key::Log10
                | Key::ExpE
                | Key::Recip
                | Key::Asin
                | Key::Acos
                | Key::Atan
                | Key::Ac => false,
```

- [ ] **Step 6: `KEY_TOKENS` に同じ順で足す**

`web/src/calc/types.ts` の末尾（`"pow"` の後）:

```ts
  "ln",
  "log10",
  "exp_e",
  "recip",
  "asin",
  "acos",
  "atan",
  "e",
] as const;
```

- [ ] **Step 7: 盤面を確定形にする**

`web/src/ui/Keypad/scientific.ts`。

`EMPTY_FACE` は**使い手がいなくなるので削除する**（`sin` / `cos` / `tan` の裏が
`asin` / `acos` / `atan` で埋まる）。定数を残すと未使用で lint が落ちる。

`FUNCTION_ROW` の 3 つを書き換える:

```ts
    {
      token: "sin",
      label: "sin",
      ariaLabel: "サイン",
      variant: "function",
      shift: {
        token: "asin",
        label: "asin",
        ariaLabel: "アークサイン",
        variant: "function",
      },
    },
    {
      token: "cos",
      label: "cos",
      ariaLabel: "コサイン",
      variant: "function",
      shift: {
        token: "acos",
        label: "acos",
        ariaLabel: "アークコサイン",
        variant: "function",
      },
    },
    {
      token: "tan",
      label: "tan",
      ariaLabel: "タンジェント",
      variant: "function",
      shift: {
        token: "atan",
        label: "atan",
        ariaLabel: "アークタンジェント",
        variant: "function",
      },
    },
```

`FUNCTIONS_SECOND` を確定形にする。**`°'"` の 1 枠だけ S-4 のために残す**（設計書 §7）:

```ts
/**
 * 関数列の 2 段目。**横に 8 列へ広げると 44px を割る**ので縦に増やした
 * (S-2 設計書 §7.1: 390px で 8 列は 38.75px)。キー幅は 45.43px のまま。
 *
 * よく使う関数を第 1 面に出す(S-1 設計書 §7)——関数電卓で `ln` や `log` が
 * Shift の裏なのは不便であり、空きを予約スロットで埋めたまま隠すのは本末転倒。
 * 残る 1 枠は S-4 の `°'"`(60 進)が埋める。
 */
const FUNCTIONS_SECOND: KeypadSection<KeyToken> = {
  ariaLabel: "第 2 関数列",
  columns: 7,
  height: "half",
  keys: [
    {
      token: "eng",
      label: "ENG",
      ariaLabel: "工学表記に切り替え",
      variant: "function",
    },
    { token: "ln", label: "ln", ariaLabel: "自然対数", variant: "function" },
    { token: "log10", label: "log", ariaLabel: "常用対数", variant: "function" },
    { token: "recip", label: "1/x", ariaLabel: "逆数", variant: "function" },
    {
      token: "exp_e",
      label: "eˣ",
      ariaLabel: "指数関数",
      variant: "function",
      // **同じ e。`eˣ` を Shift すると底そのものが出る**(設計書 §7)。
      shift: {
        token: "e",
        label: "e",
        ariaLabel: "自然対数の底",
        variant: "function",
      },
    },
    { token: "pow", label: "xʸ", ariaLabel: "べき乗", variant: "function" },
    // S-4 の `°'"`。予約スロットとして場所だけ確保する。
    {
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function",
    },
  ],
};
```

- [ ] **Step 8: 盤面のテストを直す**

`web/src/ui/Keypad/scientific.test.ts`:

`puts ENG on the first face, not behind Shift` の並びの期待を確定形にする:

```ts
    expect(second?.keys.map((k) => k.token)).toEqual([
      "eng",
      "ln",
      "log10",
      "recip",
      "exp_e",
      "pow",
      null,
    ]);
```

`puts the function row above, half height, with DRG at its end` はラベルを見ているので
そのままでよい。**第 2 面の対応を主張する行を足す**:

```ts
  it("puts the inverse trig functions behind their own first face", () => {
    // sin の裏が asin という対応が自然だから第 2 面に置いた(設計書 §7)。
    const pairs = section("関数キー").keys.map((k) => [k.token, k.shift?.token]);
    expect(pairs).toContainEqual(["sin", "asin"]);
    expect(pairs).toContainEqual(["cos", "acos"]);
    expect(pairs).toContainEqual(["tan", "atan"]);
  });

  it("puts the base of the natural logarithm behind e to the x", () => {
    // ユーザーの質問への答え: 同じ e。eˣ を Shift すると底そのものが出る。
    const key = section("第 2 関数列").keys.find((k) => k.token === "exp_e");
    expect(key?.shift?.token).toBe("e");
  });
```

- [ ] **Step 9: 空きスロットの検査を撮り直す**

`EMPTY_FACE` が消えたので、`第2面（準備中）` を見ている 3 つの検査が対象を失う。
**削除するのではなく、生きている予約スロットに向け直す**——「無効なキーは無効に
見える」という主張自体は守る価値がある。

`web/src/ui/Keypad/Keypad.test.tsx` の
`shows the empty second-face slots as reserved` を置き換える:

```ts
  it("shows the one remaining reserved slot as reserved", () => {
    // 第 2 面の空きは S-1 で全部埋まった。残るのは第 2 関数列の 1 枠
    // （S-4 の `°'"`）。無効表示の意味論はそこで守る。
    render(<Keypad sections={SCIENTIFIC_SECTIONS} onPress={vi.fn()} />);
    const empty = screen.getAllByRole("button", { name: "空き" });
    expect(empty).toHaveLength(1);
    expect(empty[0]).toBeDisabled();
  });
```

（`await userEvent.click(Shift)` は不要になるので消す。`async` も外す。）

`web/tests/e2e/keypad-shell.spec.ts` の 2 つを置き換える:

```ts
test("the one remaining reserved slot is reserved, not missing", async ({
  page,
}) => {
  // 第 2 面の空きは S-1 で埋まった。残るのは第 2 関数列の 1 枠(S-4 の `°'"`)。
  const empty = page.getByRole("button", { name: "空き", exact: true });
  await expect(empty).toHaveCount(1);
  await expect(empty).toBeDisabled();
  // 無効なことは見た目にも出す(S-2 設計書 §5 の「無効表示」)。属性だけだと
  // 押せる見た目のキーが押せない、という一番いらだつ形になる。
  const opacity = await empty.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(1);
});

test("the second face is full now, not a row of placeholders", async ({
  page,
}) => {
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await expect(page.getByRole("button", { name: "第2面（準備中）" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "アークサイン" })).toBeEnabled();
});
```

- [ ] **Step 10: 段 1・3・4 を回す**

```bash
cargo fmt && cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd web && pnpm test && cd ..
```

期待: すべて **PASS**。`key_tokens_match_between_typescript_and_rust` が通ることを
特に確かめる（順序込みの比較）。

- [ ] **Step 11: 赤確認 — トークンの順序が契約であることを見る**

`web/src/calc/types.ts` の `"asin"` と `"acos"` を入れ替える。

```bash
cargo test -p calcarc-wasm --test token_parity
```

期待: **FAIL**。**再編集で戻して緑を見る。**

- [ ] **Step 12: コミット**

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Put the nine functions on the board, and retire the placeholder face

ln, log, 1/x and eˣ go on the first face, not behind Shift — a
scientific calculator that hides ln one keypress deep is not one.
The inverse trig functions sit behind sin/cos/tan, and Shift on eˣ
gives you e itself.

That empties the "第2面（準備中）" slots entirely, so the constant and
the three tests watching it move to the one reserved slot that is
left: the °'" S-4 will fill.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 盤面を撮って見る

テストが全部緑でも、**押せる場所に見えるかは撮らないと分からない**。
関数列が 2 段になったところに 6 個の新しいラベルが入る。

**Files:** なし（撮影のみ。問題が見つかったら `scientific.ts` / CSS を直す）

- [ ] **Step 1: preview を上げてスクリーンショットを撮る**

```bash
cd web && pnpm build && pnpm preview --port 4179 --strictPort &
sleep 3
```

Playwright か Chrome で `http://localhost:4179` を 390×844 で開き、
**第 1 面と第 2 面の両方**を撮る。

- [ ] **Step 2: 見るべきものを見る**

- 2 段目の 6 ラベル（`ln` `log` `1/x` `eˣ` `xʸ`）が**枠に収まっているか**。
  `1/x` は 3 文字で一番幅を食う。45.43px に入るか
- `eˣ` と `xʸ` の**上付き文字が切れていないか**（半高のキーで行高が足りるか）
- 予約スロット 1 つが**無効に見えるか**（不透明度が下がっているか）
- Shift を押したとき `asin` / `acos` / `atan` / `e` が出るか。
  **`asin` は 4 文字で `sin` より長い**——枠を超えないか

- [ ] **Step 3: preview を落とす**

```bash
pkill -f 'vite preview' || true
lsof -i :4179 || echo "4179 is free"
```

**必ず落とす。** 落とさないと次の E2E が古いビルドを掴む。

- [ ] **Step 4: 直したものがあればコミット**

見た目の問題が無ければコミットは不要。あれば:

```bash
cargo fmt
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Make the new labels fit the keys they are on

<何をどう直したかを 1〜2 行で>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: E2E — 実ブラウザで打鍵から表示まで

**jsdom はアクセシビリティツリーを組み立てない**（CLAUDE.md）。Shift 面越しの
`asin` と、右結合の `xʸ` は、実ブラウザで見る価値がある。

**Files:**
- Create: `web/tests/e2e/scientific-functions.spec.ts`

- [ ] **Step 1: E2E を書く**

```ts
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("the functions on the second row reach the core", async ({ page }) => {
  // 第 1 面に出ていることの検査でもある(設計書 §7)。Shift を 1 度も押さない。
  await press(page, ["2", "自然対数"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.6931471806");

  await press(page, ["全消去", "1", "0", "0", "常用対数"]);
  await expect(page.getByTestId("display-main")).toHaveText("2");

  await press(page, ["全消去", "4", "逆数"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.25");

  await press(page, ["全消去", "1", "指数関数"]);
  await expect(page.getByTestId("display-main")).toHaveText("2.718281828");
});

test("xʸ folds from the right, all the way through the browser", async ({
  page,
}) => {
  // 裁定 3。左結合なら 64 になる(設計書 §3.1)。
  await press(page, ["2", "べき乗", "3", "べき乗", "2", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("512");
});

test("the pending power operator shows in the echo", async ({ page }) => {
  await press(page, ["2", "べき乗"]);
  await expect(page.getByTestId("display-echo")).toHaveText("2 ^");
});

test("the inverse trig functions are reachable through Shift", async ({
  page,
}) => {
  // ロールの意味論に関わるので実ブラウザで確かめる(CLAUDE.md: jsdom は
  // アクセシビリティツリーを組み立てない)。
  await press(page, ["0", ".", "5"]);
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "アークサイン" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("30");
  // ワンショット: 面は戻っている。
  await expect(page.getByRole("button", { name: "サイン" })).toBeEnabled();
});

test("Shift on e to the x gives the base itself", async ({ page }) => {
  // ユーザーの質問への答えが盤面に出ていることの検査(設計書 §7)。
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "自然対数の底" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("2.718281828");
});

test("the square root of a negative number is now an error", async ({
  page,
}) => {
  // **この電卓が誇っていた挙動の反転**(設計書 §5)。関数は実数に閉じる。
  await press(page, ["4", "符号を反転", "平方根"]);
  await expect(page.getByTestId("display-main")).toHaveText("Math ERROR");
  // 四則の複素数は今までどおり動く——落としたのは関数だけである。
  await press(page, ["全消去", "3", "+", "虚数単位", "4", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("3+j4");
});
```

- [ ] **Step 2: 走らせる**

```bash
cd web && pnpm e2e tests/e2e/scientific-functions.spec.ts
```

期待: **7 件 PASS**。落ちたら**表示文字列を実測して直す**（推測しない）。

- [ ] **Step 3: 既存の E2E も回す**

```bash
cd web && pnpm e2e
```

期待: すべて **PASS**。Task 7 で書き換えた `keypad-shell.spec.ts` を含む。

- [ ] **Step 4: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Watch the new functions from outside the browser

Nine keys, the right-associative fold, the Shift face, and the one
behaviour this branch reversed: √ of a negative is an error now, while
3 + j4 still answers. jsdom cannot see the accessibility tree these
tests walk.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 文書を実装に合わせ、申し送りを出す

**理由は静かに腐る。** この計画は「複素数対応の電卓は答えられる」と書かれた挙動を
逆に倒した。**検査は緑のまま、なぜそうなのかだけが嘘になる**箇所を潰す。

**Files:**
- Modify: `docs/base-spec.md`（§9.2 と §10 の関係）
- Modify: `docs/numerical-policy.md`
- Modify: `docs/superpowers/specs/2026-08-16-scientific-real-functions-design.md`（状態行）

- [ ] **Step 1: 腐った理由を grep で洗い出す**

手で数えた一覧は漏れる。

```bash
grep -rn 'sqrt(-4)\|j2\|複素数対応\|虚軸' --include='*.md' --include='*.rs' --include='*.py' --include='*.ts' . \
  | grep -v node_modules | grep -v '/target/' | grep -v '\.venv'
```

**出てきた行を 1 つずつ見て、実装と食い違っているものを直す。**
`docs/corpus-measurements.md` は**別ブランチの持ち物なので触らない**（Step 5 で伝える）。

- [ ] **Step 2: base-spec §9.2 に但し書きを足す**

`docs/base-spec.md` の §9.2 の「数学関数」「三角関数」の一覧の後ろに足す。

```markdown
定義域について：

**関数は実数に閉じる。** 実数の答が一意に決まらない入力（`sqrt(-4)`、`ln(0)`、
`asin(2)`、`(-2)^0.5` など）はエラーを返す。

これは §10（複素数）や §11（Rectangular / Polar）と矛盾しない。
**複素数は入力と四則と表示の機能であって、関数の値域ではない。**
`3 + j4` は打てるし、`(3+j4) × (1+j2)` も極形式への変換も今までどおり動く。
落としたのは「関数が複素数を返す」経路だけである（S-1 設計書 §1 の裁定 1・2）。
```

- [ ] **Step 3: numerical-policy に 2 つ書く**

`docs/numerical-policy.md` に節を足す。**片方は結合方向、もう片方は定義域**。

```markdown
## `xʸ` は右結合である

`2 xʸ 3 xʸ 2` は `2^(3^2) = 512` であって `(2^3)^2 = 64` ではない。
**このエンジンで右結合なのは `xʸ` だけ**で、`+` `−` `×` `÷` は左結合のままである
（`10 − 3 − 2` は `5`）。

数学の慣行に合わせた、というだけではない。**独立検証層（mpmath）が慣行に従う**ので、
左結合を選ぶと恒久的に食い違い、それを消す唯一の方法は Python に engine の意味論を
教えることになる。それは CONTRIBUTING の「参照実装を Rust の移植にしない」に
真正面から当たる。**独立した検証層が、実装前に設計判断を動かした事例である。**

優先順位は `+ −` が 1、`× ÷` が 2、`xʸ` が 4。**3 は空けてある**（`nPr` / `nCr` の席）。

## 関数の定義域

**関数は実数に閉じる。** 実数の答が一意に決まらない入力は `DomainError` になる。

| 関数 | 定義域 | 外れたとき |
|---|---|---|
| `sqrt` | `x ≥ 0` | `DomainError`（**かつては `j2` を返していた**） |
| `ln` / `log10` | `x > 0` | `DomainError` |
| `asin` / `acos` | `−1 ≤ x ≤ 1` | `DomainError` |
| `eˣ` / `atan` | 全実数 | `eˣ` は溢れたとき `Overflow` |
| `1/x` | `x ≠ 0` | **`DivisionByZero`**（`DomainError` ではない） |
| `xʸ` | 下の表 | |

`1/x` が `DomainError` でないのは、利用者にとってそれがまさに 0 除算だからである。
`5 ÷ 0` と `0` `1/x` が違うエラーを返す理由が無い。

`xʸ` の定義域:

| `x` | `y` | 答 |
|---|---|---|
| `x > 0` | 任意 | `exp(y·ln x)` |
| `x = 0` | `y > 0` | `0` |
| `x = 0` | `y = 0` | **`1`**（不定形だが電卓の慣行） |
| `x = 0` | `y < 0` | `DomainError` |
| `x < 0` | 整数 | 実数で一意（`(-2)^3 = -8`） |
| `x < 0` | 非整数 | `DomainError` |

**どの関数も複素数の引数を受け取らない。** `sqr`（x²）と `+/−` は関数ではなく
四則の側なので、複素数のまま動く。
```

- [ ] **Step 4: spec の状態行を更新する**

`docs/superpowers/specs/2026-08-16-scientific-real-functions-design.md` の冒頭:

```markdown
**状態: 実装済み（`feature/scientific-real-functions`、2026-08-16）。**
```

「**⚠ 未実装——このリポジトリに実装は入っていない。**」の行を消す。

- [ ] **Step 5: ブランチ末尾のフルスイープ**

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
wasm-pack test --headless --chrome crates/calcarc-wasm
cd reference && uv run --no-config pytest && uv run --no-config ruff check . && cd ..
cd web && pnpm wasm && pnpm test && pnpm lint && pnpm build && pnpm e2e && cd ..
```

**golden が再生成で変わらないことも見る**（CI がこれを見る）:

```bash
cd reference && uv run --no-config python scripts/generate.py && cd ..
git diff --exit-code testdata/ && echo "golden is reproducible"
```

期待: **すべて PASS**、`git diff --exit-code` が 0。

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/scientific-real-functions && git add -A && git commit -m "$(cat <<'EOF'
Say why √ of a negative is an error, in the places that claimed otherwise

base-spec listed the functions without saying where they stop, and
nothing wrote down that xʸ is the one right-associative operator. The
tests were green either way — it was only the reasons that had gone
false.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: `feature/e2e-corpus` の担当セッションに伝える**（設計書 §9.1 の完了条件）

**これは完了条件である。** 相手の `docs/corpus-measurements.md` に
「`sqrt(-4)` の表示は `"j2"`（複素表記）」という実測記録があり、事実でなくなる。
ガード自体は正しいまま（範囲外であることは変わらない）で、変わるのは**理由**
——「読めない複素表記だから外す」から「エラー経路だから外す」へ。

伝える内容:

1. `feature/scientific-real-functions` で `sqrt(-4)` は `DomainError` になった。
   表示は `Math ERROR`
2. **`KEY_TOKENS` は 9 つ足しただけ**（`pow` `ln` `log10` `exp_e` `recip` `asin`
   `acos` `atan` `e`）。**既存の綴りは 1 文字も変えていない**
3. `corpus_expr.py` には触っていない（このブランチには無い）
4. **`engine_table.rs` で書き換えた既存行は 1 つだけ**:
   `square_root_of_a_negative_gives_an_imaginary_result`
   → `square_root_of_a_negative_is_a_domain_error`
5. **表示書式は変えていない**（`parseDisplay` は無事）
6. `docs/corpus-measurements.md` の「`sqrt(-4)` は `j2`」の記録を実測し直してほしい

`ListAgents` で相手のセッションを探し、`SendMessage` で送る。見つからなければ
**ユーザーに伝達を依頼する**（黙って完了にしない）。

---

## Self-Review

**1. Spec coverage**

| 設計書の節 | 実装するタスク |
|---|---|
| §1 裁定 1（関数が複素数を返すときエラー） | Task 1（sqrt）・2・3・5 |
| §1 裁定 2（複素数そのものは残す） | Task 1 Step 9（`sqr`/`neg` は不変）・Task 9（`3+j4` の E2E） |
| §1 裁定 3（`xʸ` 右結合） | Task 4・5 |
| §1 裁定 4（複素引数は `DomainError`） | Task 1 の `real_arg`、Task 2 Step 1 の最後のテスト |
| §3 単項 6 + 定数 `e` | Task 2（コア）・Task 7（キー） |
| §3.0 `1/x` は `DivisionByZero` | Task 3 |
| §3.1 `xʸ` は二項・優先順位 4・左結合の行を先に足す | Task 4・5 |
| §3.2 左結合の代償（記録として） | Task 10 Step 3（numerical-policy） |
| §4 `xʸ` の定義域表 | Task 5 Step 3、Task 6 Step 2（golden が表と 1:1） |
| §4.1 `0^0 = 1` | Task 5 Step 1・Step 12 |
| §5 `sqrt(-4)` を落とす | Task 1 |
| §5.1 engine_table を先に書き換える | Task 1 Step 1・2 |
| §5.2 影響の実測 | Task 1 Step 8（`git diff --stat`）・Task 10 Step 1（grep） |
| §5.3 他セッションとの約束 | Global Constraints の節 + Task 10 Step 7 |
| §6 `CalcError` に `DomainError` / TS の合併型 | Task 1 Step 3・4 |
| §7 盤面（確定） | Task 5 Step 11・Task 7 Step 7・Task 8 |
| §8 段ゲート / golden の必須境界 / 赤確認 | 各タスクの赤確認ステップ、Task 2 Step 6・Task 6 Step 2 |
| §9.1 完了条件（他セッションへの申し送り） | Task 10 Step 7 |
| §10 スコープ外 | 触っていない（`Key::Exp` 改名なし、双曲線関数なし、`n!` は S-3） |

**§8 が名指しした golden の必須境界の所在**: `ln(0)` `ln(-1)` → Task 2 Step 6 /
`asin(1)` `asin(1.0000001)` → Task 2 Step 6 / `0^0` `(-2)^3` `(-2)^0.5` → Task 6 Step 2 /
`sqrt(-4)` → Task 1（既存の `SQRT_INPUTS` に入っている）。**全部ある。**

**2. Placeholder scan**

`NN` が Task 6 Step 7 のコメントに 1 つあるが、**Step 8 が実測して埋める手順を
持っている**（予測値を書き残さないための意図的な形）。ほかに TBD・「適切に」・
「Task N と同様」は無い。

**3. Type consistency**

- `real_arg` は Task 1 で定義し、Task 2・3・5 が使う。private fn なので同じモジュール内 ✔
- `scientific::exp_e` の綴りは Rust・Python・golden の `op`・キートークンで一致 ✔
- `scientific_ref` の新しい関数は全部 `dict` を返す。既存の `sin`/`cos`/`tan` は
  `float` のまま（別のループが読む）✔
- `sqrt_real` だけは戻り値の型が `tuple` → `dict` に変わる。**呼び出し元は
  `generate.py` の 1 か所だけ**で、Task 1 Step 7 が同時に直す ✔
- `Key::ALL` の長さ: 33 → 34（Task 5）→ 42（Task 7）。`KEY_TOKENS` も同じ順序で
  同じ数だけ伸びる ✔
- `BinOp::is_right_associative` は Task 5 で定義し、同じ Step で `push_binop` が使う ✔
- `error_name` は Task 1 で定義。Task 2・3・6 が足すケースはすべてそれを通る ✔

## 既知の引っかかり（実装者へ）

**設計書の中に小さな不整合が 1 つある。** §3.0 は `1/x` の `x = 0` を
「利用者にとってそれはまさに 0 除算だから」`DivisionByZero` にすると決めているが、
§4 の表は `0^(y<0)` を `DomainError` としている。**`0^-1` も文字どおり `1/0` である。**

**この計画は設計書どおりに実装する**（`1/x` → `DivisionByZero`、`0^(y<0)` →
`DomainError`）。裁定は受けており、実装者が勝手に倒す話ではない。
**Task 6 Step 1 のコメントと Task 5 Step 3 のコメントに、それが規約であることを
明示的に書いてある**——「なぜここだけ違うのか」を後から読む人が探さずに済むように。

**ユーザーに報告する事項である。** 揃えるなら `0^(y<0)` を `DivisionByZero` に
倒すのが自然だが、それは spec の変更であり、この計画の中では行わない。
