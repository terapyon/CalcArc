# 複素四則演算の言語間検証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** golden の比較をノルム基準に改めてから（#3）、Smith 法の除算を含む四則演算を Python 独立検証の射程に入れる（#2）。

**Architecture:** spec は docs/superpowers/specs/2026-08-11-golden-arithmetic-design.md。4 タスク: 比較の付け替え → Python 参照実装 → 配線と実証 → 段付けの記録と最終スイープ。#3 が先なのは、成分ごと比較のまま四則を足すと正しい実装が落ちるため。

**Tech Stack:** Rust（golden.rs）、Python（SymPy 厳密有理数）、uv。

## Global Constraints

- **テストの段付け（本ブランチは数値・アルゴリズム段）**: 毎タスクの検証は
  `cargo fmt` + `cargo clippy --workspace --all-targets -- -D warnings` +
  `cargo test --workspace`（約 5 秒）。Python を触るタスクのみ
  `cd reference && uv run --no-config pytest` を追加。**wasm / vitest / e2e は
  Task 4 のフルスイープ 1 回だけ**（境界・UI・ロール意味論に不触のため）。
- **許容誤差をテストコードに書かない**（CLAUDE.md）。tolerance は
  `testdata/*.json` に集中。値は 1e-12 のまま変えない。
- **参照実装を Rust の移植にしない**（CONTRIBUTING）。Smith 法をいかなる形でも
  写さない。
- `uv lock` / `uv sync` / `uv run` は `--no-config` を付ける（CLAUDE.md の罠）。
- コミット前に `cargo fmt`。**`git push` と PR 作成は行わない。**
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。
- ベースライン: Rust 125 / wasm 6 / vitest 31 / e2e 14 / Python 10。
  Rust の**テスト関数**数は最後まで 125 のまま（golden はケース数だけ増える）。
  Python は Task 2 で増える。

---

### Task 1: 比較をノルム基準にする（#3）

**Files:**
- Modify: `crates/calcarc-core/tests/golden.rs`（`close_complex` 新設、複素数値の呼び出しを置換）
- Modify: `docs/numerical-policy.md`（「許容誤差」節の拡充）

**Interfaces:**
- Consumes: なし
- Produces: `fn close_complex(actual: Value, expected_re: f64, expected_im: f64, tol: Tolerance, id: &str)` — Task 3 の四則の腕がこれを呼ぶ。

- [ ] **Step 1: `close_complex` を書く**

`golden.rs` の `close()` の直後に:

```rust
/// 複素数の結果は差ベクトルのノルムで比べる。
///
/// 乗除算は成分ごとの相対精度を保証しない。小さい成分は大きな積の差として
/// 復元されるため、成分比が偏るほど桁が落ちる（実装の不備ではなく複素数
/// 演算の性質。実測は docs/numerical-policy.md の「許容誤差」節）。
/// 保証されるのはノルムの相対精度であり、それを検査する。
/// 差ベクトルのノルムなので、成分の取り違え・符号違いも捕まる。
fn close_complex(actual: Value, expected_re: f64, expected_im: f64, tol: Tolerance, id: &str) {
    let diff = (actual.re - expected_re).hypot(actual.im - expected_im);
    let norm = expected_re.hypot(expected_im);
    let ok = diff <= tol.abs || diff <= tol.rel * norm;
    assert!(
        ok,
        "{id}: got ({}, {}), expected ({expected_re}, {expected_im}) \
         (norm diff {diff}, abs tol {}, rel tol {})",
        actual.re, actual.im, tol.abs, tol.rel
    );
}
```

- [ ] **Step 2: 複素数値の呼び出しを置き換える**

- `polar_to_rect` の腕: `close(v.re, ...)` と `close(v.im, ...)` の 2 呼び出しを
  `close_complex(v, field(&case.expect, "re"), field(&case.expect, "im"), golden.tolerance, &case.id)` の 1 呼び出しに。
- `scientific_functions_match_the_reference` の末尾: 同様に `close` 2 回を
  `close_complex(actual, ...)` 1 回に。
- **`rect_to_polar` の腕（`r` と `theta_deg`）は触らない** — 独立に意味を持つ
  スカラーであり、成分ごとのまま（spec §1）。

- [ ] **Step 3: 検査が効いていることを赤で確認する（変更した検査なので必須）**

`testdata/complex.json` の `polar_to_rect` ケース 1 件の `expect.re` を
**許容誤差 1e-12 を明確に超える幅（1e-6 程度）**だけ一時的にずらし
（最終桁の 1 ULP では許容誤差の内側に収まって赤にならない）、
`cargo test -p calcarc-core --test golden` が
`close_complex` のメッセージで落ちることを確認して、`git checkout -- testdata/`
で戻す。**この赤の出力を報告に貼る。** 戻した後に緑も確認する。

- [ ] **Step 4: `docs/numerical-policy.md` の「許容誤差」節を拡充する**

既存の 2 行の下に追記:

```markdown
### 複素数の比較はノルムで行う

複素数の乗除算は成分ごとの相対精度を保証しない。小さいほうの成分は大きな
数どうしの積の差として復元されるため桁落ちし、成分比が偏るほど失う桁が
増える。これは実装の不備ではなく複素数演算の性質である。

実測（issue #3、恒等式 `(a*b)/b == a` を乱数 50 万件、成分 -1000..1000）:

| 指標 | 最大相対誤差 |
|---|---|
| 成分ごと | 7.26e-12 |
| ノルム | 4.30e-16 |

最悪ケースでは虚部が実部の 9.4e-6 倍で、虚部の相対誤差 7.26e-12 に対し
ノルムの相対誤差は 6.8e-17 —— f64 の丸め誤差の水準であり、計算は限界まで
正しい。成分ごとに見たときだけ誤差が大きく見える。

そのため golden の比較は、期待値が複素数であるものすべてについて
**差ベクトルのノルム**で行う（`golden.rs` の `close_complex`）。`r` と
`theta_deg` は独立に意味を持つスカラーなので成分ごとのまま。

**この一様な線は、加減算については意図的な弱体化である。** 加減算は成分
ごとに独立に正しく丸められるため、成分ごとの相対精度を保証できる演算で
あり、成分ごと比較のほうが強い検査になる（例: `(1e6, 1e-8)` の加算で虚部が
100% 狂っても、差 1e-8 < rel×ノルム 1e-6 で通る）。それでも一様な線を採る
のは、演算ごとに基準を分けると次に演算を足す人が毎回この判断をやり直すこと
になるため。加減算の成分レベルの厳密さは `value.rs` の単体テスト（完全一致）
が固定しており、実害はない。見落としではなく選択である。
```

- [ ] **Step 5: 検証してコミット**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: 125 件 PASS。testdata に差分が無いこと（`git status` で確認）。

```bash
git add crates/calcarc-core/tests/golden.rs docs/numerical-policy.md
git commit -F - <<'EOF'
Compare complex results by norm, and write down what that trades away

Componentwise tolerance fails correct implementations once component
ratios skew: the small component of a product is recovered as the
difference of large terms, and the digits it loses are not a bug. The
measured gap is four orders: 7.26e-12 componentwise against 4.30e-16 by
norm over half a million identity checks.

The uniform line — scalars by component, complex values by norm —
deliberately weakens add/sub, which could promise componentwise
precision. The unit tests' exact equality holds that line instead, and
the policy records the weakening as a choice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Python 参照実装（#2 の前半）

**Files:**
- Modify: `reference/src/calcarc_reference/complex_ref.py`（四則を追加）
- Modify: `reference/tests/test_complex_ref.py`（健全性テストを追加）

**Interfaces:**
- Consumes: なし
- Produces: `add(a_re, a_im, b_re, b_im) -> tuple[float, float]`（sub/mul/div も
  同形）。Task 3 の `generate.py` が `getattr(complex_ref, op)` で呼ぶ。

**cases.py と generate.py はこのタスクでは触らない。** 生成器を先に変えると、
Rust 側に腕が無い状態で CI の再生成検査が落ちる。配線は Task 3 でまとめて行う。

- [ ] **Step 1: 健全性テストを先に書く（TDD）**

`test_complex_ref.py` に追加（既存の流儀: 既知値と数学的性質）:

```python
def test_binary_headline_cases() -> None:
    """単体テストと同じ既知値。(3+4j)(1+2j) = -5+10j、その逆除算。"""
    assert mul(3.0, 4.0, 1.0, 2.0) == (-5.0, 10.0)
    assert div(-5.0, 10.0, 1.0, 2.0) == (3.0, 4.0)
    assert add(3.0, 4.0, 1.0, 2.0) == (4.0, 6.0)
    assert sub(3.0, 4.0, 1.0, 2.0) == (2.0, 2.0)


def test_division_is_exact_in_rationals() -> None:
    """厳密有理数の除算には条件数の概念がない。

    f64 では素朴な分母 (b.re² + b.im²) がアンダーフローで 0 に潰れる入力
    でも、有理数では正確に計算できる。これが Rust(Smith 法)との手法の
    独立性そのもの。
    """
    re, im = div(1.0, 0.0, 1e-200, 1e-200)
    assert math.isclose(re, 0.5e200, rel_tol=1e-15)
    assert math.isclose(im, -0.5e200, rel_tol=1e-15)


def test_multiplication_and_division_are_inverse() -> None:
    """(a*b)/b が a に戻る(丸めは最後の float 化の 1 回だけ)。"""
    p_re, p_im = mul(430.27, 0.0040323, 0.87, -0.54)
    re, im = div(p_re, p_im, 0.87, -0.54)
    assert math.isclose(re, 430.27, rel_tol=1e-15)
    assert math.isclose(im, 0.0040323, rel_tol=1e-15)
```

import 行に `add, div, mul, sub` を足す。

- [ ] **Step 2: 実行して失敗を確認する**

Run: `cd reference && uv run --no-config pytest`
Expected: FAIL（ImportError — `add` 等が未定義）

- [ ] **Step 3: 実装する**

`complex_ref.py` に追加。既存の `_exact`（str 経由の厳密有理数化）を使う:

```python
def _binary(a_re: float, a_im: float, b_re: float, b_im: float):
    """4 つの f64 を厳密有理数の組にする。"""
    return _exact(a_re), _exact(a_im), _exact(b_re), _exact(b_im)


def _to_floats(re_expr, im_expr) -> tuple[float, float]:
    return float(sp.N(re_expr, PRECISION)), float(sp.N(im_expr, PRECISION))


def add(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar + br, ai + bi)


def sub(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar - br, ai - bi)


def mul(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    return _to_floats(ar * br - ai * bi, ar * bi + ai * br)


def div(a_re: float, a_im: float, b_re: float, b_im: float) -> tuple[float, float]:
    """複素数の除算。教科書どおりの式を厳密有理数で計算する。

    素朴な分母 (b_re² + b_im²) は f64 では禁じ手(アンダーフローで 0 に
    潰れ、オーバーフローで inf になる)であり、Rust はそのために Smith 法を
    使う。厳密有理数にはその問題が存在しないので、教科書の式のまま正しい。
    同じ結論に別の道で着くこと自体が検証の独立性である(base-spec §30)。
    ゼロ除数は golden の対象外(エラー系は engine_table の領域)なので、
    ここでは検査しない —— 渡せば SymPy が ZeroDivisionError を投げ、
    生成が音を立てて止まる。それでよい。
    """
    ar, ai, br, bi = _binary(a_re, a_im, b_re, b_im)
    den = br * br + bi * bi
    return _to_floats((ar * br + ai * bi) / den, (ai * br - ar * bi) / den)
```

docstring の要点: mul/add/sub は定義そのものなので式は Rust と同形になるが、
独立性は「厳密有理数で計算して最後に 1 回だけ丸める」ことにある
（`rect_to_polar` と同じ論法。モジュール docstring が既にそう述べている）。

- [ ] **Step 4: 検証してコミット**

Run: `cd reference && uv run --no-config pytest`
Expected: 全件 PASS（10 + 追加 3）

Run: `cargo test --workspace`（Rust 不触の確認、5 秒）
Expected: 125 件 PASS

```bash
git add reference/
git commit -F - <<'EOF'
Give the reference the four operations, by a road Rust cannot share

Exact rationals all the way, one rounding at the end. Division uses the
textbook formula that f64 forbids — its denominator underflows and
overflows in floating point, which is the entire reason Rust runs Smith's
method. Arriving at the same answers by a road the implementation cannot
take is what makes the check independent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: 配線と実証（#2 の後半、spec §3）

**Files:**
- Modify: `reference/src/calcarc_reference/cases.py`（`BINARY_INPUTS` 追加）
- Modify: `reference/scripts/generate.py`（`build_complex` に二項演算を追加）
- Modify: `crates/calcarc-core/tests/golden.rs`（四則の腕）
- Modify: `testdata/complex.json`（再生成）

**Interfaces:**
- Consumes: Task 1 の `close_complex`、Task 2 の `add/sub/mul/div`
- Produces: golden の op `"add" | "sub" | "mul" | "div"`、
  input 形式 `{"a_re", "a_im", "b_re", "b_im"}`、expect `{"re", "im"}`

- [ ] **Step 1: `cases.py` に入力ペアを追加する**

```python
# ((a_re, a_im), (b_re, b_im))。各ペアに 4 演算すべてを生成する。
# 設計基準は spec §2: Smith 法の両分岐、単体テストの極端値、四象限・軸上、
# 成分比の偏り。結果が inf/nan になるペアは入れない(generate.py が
# allow_nan=False で落ちる)。ゼロ除数も入れない(エラー系は engine_table)。
BINARY_INPUTS: list[tuple[tuple[float, float], tuple[float, float]]] = [
    ((3.0, 4.0), (1.0, 2.0)),  # 既知値 (3+4j)(1+2j) = -5+10j
    ((1.0, 0.0), (0.0, 1.0)),  # 軸上どうし
    ((0.0, 0.0), (3.0, 4.0)),  # ゼロの被演算数(除数ではない)
    ((-1.0, 1.0), (1.0, -1.0)),  # 象限をまたぐ
    ((-5.0, 10.0), (1.0, 2.0)),  # 単体テストの逆除算既知値
    ((123456.789, -987654.321), (0.1, 0.2)),  # 桁の離れた実用値
    ((1.0, 1.0), (1000.0, 1.0)),  # Smith 実部優勢分岐
    ((1.0, 1.0), (1.0, 1000.0)),  # Smith 虚部優勢分岐
    ((1.0, 0.0), (1e-200, 1e-200)),  # 微小除数: 素朴な f64 分母は 0 に潰れる
    ((1.0, 0.0), (1e200, 0.0)),  # 巨大除数: 素朴な f64 分母は inf になる
    ((1e-8, 1e-8), (1e8, -1e8)),  # スケールの離れた組
    ((430.27, 0.0040323), (0.87, -0.54)),  # 成分比 ~1e-5(issue #3 の領域)
    # ここに Step 3 のプローブで凍結したペアを追記する(下記)。
]
```

- [ ] **Step 2: `generate.py` と `golden.rs` を配線する**

`generate.py` の `build_complex()` の `POLAR_INPUTS` ループの後に:

```python
    for (a_re, a_im), (b_re, b_im) in cases.BINARY_INPUTS:
        for op in ("add", "sub", "mul", "div"):
            fn = getattr(complex_ref, op)
            re, im = fn(a_re, a_im, b_re, b_im)
            entries.append(
                {
                    "id": f"{op}/({a_re},{a_im})/({b_re},{b_im})",
                    "op": op,
                    "input": {"a_re": a_re, "a_im": a_im, "b_re": b_re, "b_im": b_im},
                    "expect": {"re": re, "im": im},
                }
            )
```

`golden.rs` の `complex_conversions_match_the_reference` の match に:

```rust
"add" | "sub" | "mul" | "div" => {
    let a = Value::new(field(&case.input, "a_re"), field(&case.input, "a_im"));
    let b = Value::new(field(&case.input, "b_re"), field(&case.input, "b_im"));
    let actual = match case.op.as_str() {
        "add" => a.checked_add(b),
        "sub" => a.checked_sub(b),
        "mul" => a.checked_mul(b),
        _ => a.checked_div(b),
    }
    .unwrap_or_else(|e| panic!("{}: unexpected error {e:?}", case.id));
    close_complex(
        actual,
        field(&case.expect, "re"),
        field(&case.expect, "im"),
        golden.tolerance,
        &case.id,
    );
}
```

再生成して確認:

Run: `cd reference && uv run --no-config python scripts/generate.py && cargo test --workspace`
Expected: complex.json のケース数が 25 → 73（+48 = 12 ペア × 4 演算）、125 件 PASS

- [ ] **Step 3: 「成分ごとなら赤・ノルムなら緑」のペアを探して凍結する（spec §3）**

一時的なプローブテストを `crates/calcarc-core/tests/zz_probe.rs` に書く
（**コミットしない**）:

```rust
//! 一時的な探索。コミットしない。
//! issue #3 の恒等式 (a*b)/b の形で、成分ごとの相対誤差が 1e-12 を超える
//! (p, b) の組を探す。p = a*b は f64 に丸めた値をそのまま使う。
use calcarc_core::Value;

#[test]
fn probe_componentwise_outliers() {
    let mut s: u64 = 0x243F6A8885A308D3;
    let mut rand = move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s as f64 / u64::MAX as f64) * 2000.0 - 1000.0
    };
    for _ in 0..500_000 {
        // 片方の成分を 1e-5 倍して比を偏らせる(issue #3 の最悪領域)。
        let a = Value::new(rand(), rand() * 1e-5);
        let b = Value::new(rand(), rand());
        let Ok(p) = a.checked_mul(b) else { continue };
        let Ok(q) = p.checked_div(b) else { continue };
        let rel_im = ((q.im - a.im) / a.im).abs();
        if rel_im > 1e-12 {
            println!("p = ({:e}, {:e})  b = ({:e}, {:e})  rel_im = {rel_im:e}", p.re, p.im, b.re, b.im);
        }
    }
}
```

Run: `cargo test -p calcarc-core --test zz_probe -- --nocapture`

出た候補から 1 組を選び、`(p, b)` を **f64 の全桁**（`{:?}` 表示）で
`BINARY_INPUTS` の末尾に追記する。コメントに「プローブ（xorshift、成分比
1e-5、50 万件）で発見。成分ごとの相対誤差 <実測値>、ノルムでは <実測値>」と
残す。再生成して緑を確認したらプローブを削除する。

**受け入れ基準は Step 4 の赤である。** 候補を凍結して Step 4 が赤に
ならなければ、その候補は主張を実証していない——別の候補で繰り返す。
プローブで候補が 1 つも出ない場合は止まって報告する（spec §3-3。探索を
広げる判断——比をさらに偏らせる、反復乗除で蓄積させる——は実装者に委ねる
が、「緑のまま完了」は完了ではない）。

- [ ] **Step 4: 実証——比較を一時的に成分ごとへ戻して赤を見る**

`close_complex` の本体を一時的に成分ごとの比較（旧 `close` を re/im に
2 回）に差し替え、`cargo test -p calcarc-core --test golden` を実行。
Expected: **凍結したケースが赤**（差の値がメッセージに出る）。
出力を保存して `close_complex` を戻し、緑を確認する。**赤と緑の両方の
実出力を報告に貼る。** 差し替えの残骸が無いことを `git diff` で確認。

- [ ] **Step 5: 再生成の再現性と検証、コミット**

Run: `cd reference && uv run --no-config python scripts/generate.py && git diff --stat testdata/`
Expected: 1 回目の生成後にコミット対象の差分、**2 回目の生成で追加差分ゼロ**
（再現性）。`git status` で `reference/uv.lock` に差分が無いこと。

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && cd reference && uv run --no-config pytest`
Expected: Rust 125 件 / Python 13 件 PASS。`zz_probe.rs` が存在しないこと。

```bash
git add reference/ testdata/ crates/calcarc-core/tests/golden.rs
git commit -F - <<'EOF'
Put the four operations under cross-language watch

Every pair walks all four operations. The divisors cover both Smith
branches and the two inputs where a naive f64 denominator dies — one
underflows to zero, one overflows to inf — so rewriting either side
naively now fails golden instead of passing quietly.

One pair is frozen from a search: its quotient's small component misses
componentwise tolerance while the norm stays at rounding level. Flipping
the comparison back to componentwise turns exactly that case red, which
is the measured proof that #3's change was needed, not cosmetic.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: 段付けの記録と最終スイープ

**Files:**
- Modify: `CONTRIBUTING.md`（「テストの段付け」節を追加）

**Interfaces:**
- Consumes: なし
- Produces: リポジトリに記録された段付け方針（どのセッション・レビュアーからも見える）

- [ ] **Step 1: CONTRIBUTING.md に節を追加する**

「電卓の挙動を変えるとき」の節の後に:

```markdown
## テストをどこまで回すか

変更の影響範囲に合わせて段を選ぶ。全部を毎回回さない。

| 変更の場所 | 回すもの |
|---|---|
| calcarc-core 内部（境界・挙動不変） | fmt + clippy + `cargo test --workspace` |
| `reduce`/表示の挙動、DisplayState、トークン | 上記 + `wasm-pack test` |
| `web/src/calc`・UI | 上記 + `pnpm wasm && pnpm test` |
| ロール意味論・a11y・境界契約 | 上記 + `pnpm e2e`（jsdom は a11y ツリーを組まない） |
| 数値・アルゴリズム | `cargo test --workspace`。testdata を変えるときだけ Python 再生成 |

フルスイープ（全レイヤー + golden 再生成の差分ゼロ確認）はブランチの
最終コミット前に 1 回。新設・変更した検査は、対応する壊し方で赤くなる
ことを確認してから信じる（機械的リネームには不要）。
```

- [ ] **Step 2: フルスイープ（ブランチ末尾の 1 回）**

```
cargo fmt && cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                                   # 125
wasm-pack test --headless --chrome crates/calcarc-wasm   # 6
cd web && pnpm wasm && pnpm test && pnpm e2e             # 31 + 14
cd reference && uv run --no-config pytest                # 13
cd reference && uv run --no-config python scripts/generate.py && git diff --exit-code testdata/
git status   # uv.lock に差分なし、残骸なし
```

Expected: すべて緑、testdata 再生成差分ゼロ。

- [ ] **Step 3: コミット**

```bash
git add CONTRIBUTING.md
git commit -F - <<'EOF'
Write the test-tiering ladder where every session can see it

Which suites to run is a function of what the change can break, and that
mapping lived only in one agent's memory. Now it lives here: core-only
changes take the five-second workspace run, the browser suites wait for
changes that can reach them, and the full sweep happens once per branch,
not once per task.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

# 進捗の見取り図

| タスク | 成果物 | 検証手段 | close |
|---|---|---|---|
| 1 | close_complex とノルム基準の記録 | 期待値を崩して赤 → 戻して緑 | #3 |
| 2 | Python の四則（厳密有理数） | pytest 13 件 | — |
| 3 | golden の四則 48+ ケースと凍結ペア | 成分ごとに戻すと赤、ノルムで緑 | #2 |
| 4 | CONTRIBUTING の段付け節 | フルスイープ 1 回 | — |
