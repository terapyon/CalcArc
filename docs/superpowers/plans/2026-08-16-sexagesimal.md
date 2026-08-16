# S-4 時間計算（60 進） — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `°'"` キー 1 つで、**60 進の入力**（`1 °'" 30 °'"` → `1.5`）と
**60 進の表示**（`3.75` → `3°45'0"`）を足す。**四則演算は 1 行も書かない**
——値は 10 進の `f64` のままで、60 進は入力と表示の形式にすぎない。

**Architecture:** `Buffer` に**3 つ目の入力モード**が入る（既存は仮数と指数）。
表示側は `numeric/format.rs` に `format_sexagesimal` を足し、
**`EngineState` に「いま 60 進で見せろ」という一時状態**を持たせる
——`°'"` 以外のあらゆるキーで解除する。**`STATE_SCHEMA` が 5 → 6 に上がる
唯一の spec である。**

**Tech Stack:** Rust / Python の `Fraction`（参照実装）/ wasm-bindgen /
TypeScript / React 19 / vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-08-16-sexagesimal-design.md`

**ブランチ:** `feature/sexagesimal`（`feature/probability-keys` の上に縦積み）

---

## Global Constraints

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない
- **`calcarc-core` は panic しない**（`unwrap` / `expect` は lint が禁じている）
- **WASM 境界は JavaScript 例外を投げない**
- **許容誤差をテストコードに書かない。** 言語間検証は `testdata/*.json` の
  `tolerance`。**ユニットテストで `assert_close` を使うのは、値が 1e-2 〜 1e6 の
  範囲にあるときだけにする**——あれは**絶対誤差 1e-12** で比べるので、
  大きい値では正しい実装でも必ず落ちる（S-3 で踏んだ）。60 進の検査は
  **文字列の完全一致**なので、そもそも許容誤差が要らない
- **参照実装を Rust の移植にしない。** Rust は f64 の除算と剰余、Python は
  **`Fraction` の厳密有理数**。アルゴリズムが同型でない（設計書 §7）
- **電卓の挙動は `engine_table.rs` が仕様書。** キー列と表示の対応を**先に**変える
- **5×5 のメイングリッドを 1 キーも動かさない**
- **区画の `ariaLabel` を変えない**（E2E のセレクタ）
- **`STATE_SCHEMA` を 5 → 6 に上げる。** これが最後の 1 本なので番号の奪い合いは無い
- コミット前に **`cargo fmt`**
- **検証コマンドは `&&` で機械的に繋ぐ。出力の件数を目で見て判断しない**
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **`git push` と PR 作成は行わない**
- **共有ワークツリーである。コミットを含むコマンドは必ず**
  `test "$(git branch --show-current)" = feature/sexagesimal && git commit ...`
- E2E のポートは **4179**。**撮り終えたら preview を必ず落とす**
- `uv` のコマンドには必ず **`--no-config`**

## 他セッションとの約束

`feature/e2e-corpus`（worktree `/home/terapyon/dev/CalcArc-e2e`）に**触らない**。

1. **`KEY_TOKENS` は足すだけ。** 足すのは **`dms` の 1 つ**
2. **`corpus_expr.py` に触らない**（このブランチには存在しない）
3. **記法の約束 3 つを壊さない**——`°'"` は**新しい種類のキー**（入力中は区切り、
   確定後は表示トグル）だが、**相手はこのキーを押さない**ので当たらない
4. **`engine_table.rs` は行を足すだけ**（既存行の書き換えは 0 件の見込み）
5. **表示書式**: `12°34'56"` は相手の `parseDisplay` が拒む形である。
   **裁定 4（押したときだけ変換）により発火しない**——押さなければ十進のまま

**⚠ 設計書 §7.1 が名指しで要求している**: 「**それでも実装に入る前に一声かける**
——『押さないから当たらない』は私の側の読みで、確かめるのは相手である」。
**Task 1 がこれを行う。返事を待たずに Task 2 へ進んでよいが、送るのが先である。**

---

## ファイル構成

```text
crates/calcarc-core/src/numeric/format.rs    format_sexagesimal（Task 2）
reference/src/calcarc_reference/sexagesimal_ref.py  新設・Fraction で厳密（Task 3）
reference/src/calcarc_reference/cases.py     入力ケース（Task 3）
reference/scripts/generate.py                build_scientific に追加（Task 3）
reference/tests/test_sexagesimal_ref.py      新設（Task 3）
crates/calcarc-core/tests/golden.rs          op: "sexagesimal"（Task 3）
testdata/scientific.json                     再生成（Task 3）
crates/calcarc-core/src/engine/state.rs      Buffer の 3 つ目のモード + schema 6（Task 4）
crates/calcarc-core/src/engine/key.rs        Key::Dms（Task 5）
crates/calcarc-core/src/engine/mod.rs        apply / reduce の解除規則（Task 5）
crates/calcarc-core/src/engine/display.rs    render が一時状態を読む（Task 5）
crates/calcarc-core/tests/engine_table.rs    キー列と表示（Task 4・5）
crates/calcarc-core/tests/engine_robustness.rs  網に Dms（Task 6）
crates/calcarc-wasm/src/lib.rs               DisplayState に載るか確認（Task 5）
web/src/calc/types.ts                        KEY_TOKENS に "dms"（Task 5）
web/src/ui/Keypad/scientific.ts              予約スロットを埋める（Task 5）
web/src/ui/Keypad/scientific.test.ts         盤面の検査（Task 5）
web/tests/e2e/keypad-shell.spec.ts           予約スロットが 0 になる（Task 5）
web/tests/e2e/sexagesimal.spec.ts            新設（Task 8）
docs/base-spec.md                            §9 に 60 進の節（Task 9）
docs/numerical-policy.md                     桁の配り方と繰り上がり（Task 2・9）
```

## 検証の段付け

| 段 | コマンド |
|---|---|
| 1 | `cargo test -p calcarc-core` |
| 2 | `cd reference && uv run --no-config pytest` |
| 3 | `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` |
| 4 | `cd web && pnpm test && pnpm lint` |
| 5 | `cd web && pnpm e2e`（Task 8 とブランチ末尾） |
| 6 | `wasm-pack test --headless --firefox crates/calcarc-wasm`（**chrome は版ずれで落ちる**。28 件が基準） |

---

### Task 1: `feature/e2e-corpus` に先に伝える

**設計書 §7.1 が実装前に要求している。** コードは 1 行も書かない。

- [ ] **Step 1: 送る**

内容:

1. S-4 で `KEY_TOKENS` に **`dms` を 1 つ足す**（既存 45 個は不変）
2. **`°'"` は新しい種類のキーである**——入力中は 60 進の区切り、確定後は表示の
   一時トグル。**既存のどのキーとも作用が違う**
3. **表示が `12°34'56"` という形になりうる。** `parseDisplay` はこれを拒むはず
4. **押さなければ発火しない**（裁定 4: 押したときだけ変換）。
   **こちらの読みなので、確かめてほしい**
5. **`STATE_SCHEMA` が 5 → 6 に上がる**
6. `engine_table.rs` は行を足すだけ（既存行の書き換えは 0 件の見込み）

- [ ] **Step 2: 返事を待たずに Task 2 へ進む**

**送るのが先であって、待つのが条件ではない**（設計書 §7.1 の書き方）。
返事で「当たる」と分かったら、その時点で止めて相談する。

---

### Task 2: `format_sexagesimal` — 表示側だけを先に作る

**キーもエンジンも触らない。** 純関数を 1 つ足して、桁の配り方と繰り上がりを固める。

**Files:**
- Modify: `crates/calcarc-core/src/numeric/format.rs`
- Modify: `docs/numerical-policy.md`

**Interfaces:**
- Produces: `pub fn format_sexagesimal(x: f64) -> Option<String>`
  （`None` は「60 進にできない」。裁定 6 で**呼び出し側が表示を変えない**）

**桁の配り方（設計書 §3 の「`DISPLAY_DIGITS` の残りを回す」を具体化する）:**

`DISPLAY_DIGITS` は 10。度が `nd` 桁、分が 2 桁、秒の整数部が 2 桁を使うので、
**秒の小数は `max(0, 10 − nd − 4)` 桁**。`nd = 1` なら 5 桁、`nd = 2` なら 4 桁。

**実測で確かめた出力（この計画の起草時）:**

| 入力 | 出力 |
|---|---|
| `1.5` | `1°30'0"` |
| `0.001` | `0°0'3.6"` |
| `-3.75` | `-3°45'0"` |
| `0.0` | `0°0'0"` |
| `30.5` | `30°30'0"` |
| `0.1` | `0°6'0"` |
| `1/3` | `0°20'0"` |
| **`0.999999999`** | **`1°0'0"`**（秒 → 分 → 度と**二段繰り上がる**） |

- [ ] **Step 1: 失敗するテストを書く**

`numeric/format.rs` の `mod tests` に。**文字列の完全一致なので許容誤差が要らない。**

```rust
    #[test]
    fn formats_sexagesimal() {
        // 設計書 §1: 1.5 は 1 時間 30 分とも 1 度 30 分とも読める。
        assert_eq!(format_sexagesimal(1.5).as_deref(), Some("1°30'0\""));
        assert_eq!(format_sexagesimal(-3.75).as_deref(), Some("-3°45'0\""));
        assert_eq!(format_sexagesimal(0.0).as_deref(), Some("0°0'0\""));
        // 24 を超えてもそのまま出す（裁定 5）。経過時間なので割らない。
        assert_eq!(format_sexagesimal(30.5).as_deref(), Some("30°30'0\""));
    }

    #[test]
    fn sexagesimal_seconds_may_have_decimals() {
        // 秒に小数を許さないと 0.001 時間が表せない（設計書 §3）。
        assert_eq!(format_sexagesimal(0.001).as_deref(), Some("0°0'3.6\""));
        assert_eq!(format_sexagesimal(0.1).as_deref(), Some("0°6'0\""));
    }

    #[test]
    fn sexagesimal_carries_when_the_seconds_round_up() {
        // **59.999... が 60 に丸まったら繰り上げる**（設計書 §3 の丸め）。
        // format_real が 9999999999.6 → 1e10 で踏んだのと同じ形で、
        // 手も同じ（先に丸めてから桁を決める）。
        //
        // 0.999999999 は秒が 59.9999996 で、5 桁に丸めると 60.00000。
        // 分へ繰り上がって 60 分になり、さらに度へ繰り上がる——**二段**。
        assert_eq!(format_sexagesimal(0.999999999).as_deref(), Some("1°0'0\""));
    }

    #[test]
    fn sexagesimal_declines_what_it_cannot_show() {
        // 裁定 6: 何もしない。呼び出し側が表示を変えない。
        assert_eq!(format_sexagesimal(f64::INFINITY), None);
        assert_eq!(format_sexagesimal(f64::NAN), None);
        // 度が 10 桁を使い切ると分と秒の場所が無い。
        assert_eq!(format_sexagesimal(1e10), None);
        // その手前は出せる。
        assert!(format_sexagesimal(999999.5).is_some());
    }
```

- [ ] **Step 2: 赤を見る**

```bash
cargo test -p calcarc-core --lib numeric::format
```

期待: **コンパイルエラー**（`cannot find function `format_sexagesimal``）。

- [ ] **Step 3: 実装する**

```rust
/// 60 進で表示する。`3.75` → `3°45'0"`（設計書 §3）。
///
/// **値は 10 進のままである。** 60 進は表示の形式にすぎず、時間とも角度とも
/// 読める——どちらの意味かは利用者の頭の中にしかない（設計書 §1）。
///
/// `None` は「60 進にできない」。**呼び出し側は表示を変えない**（裁定 6）
/// ——表示の操作でエラー状態に落とすのは重い。
///
/// 秒の小数桁は `DISPLAY_DIGITS` の残りを回す（裁定 7）。度が `nd` 桁、
/// 分が 2 桁、秒の整数部が 2 桁を使うので、残りは `10 − nd − 4` 桁。
pub fn format_sexagesimal(x: f64) -> Option<String> {
    if !x.is_finite() {
        return None;
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let a = x.abs();
    let mut degrees = a.trunc();
    // 度が有効数字を使い切ると、分と秒を置く場所が無い。
    let int_digits = if degrees < 1.0 {
        1
    } else {
        degrees.log10().floor() as i32 + 1
    };
    if int_digits + 4 > DISPLAY_DIGITS as i32 {
        return None;
    }
    let rest = (a - degrees) * 60.0;
    let mut minutes = rest.trunc();
    let seconds = (rest - minutes) * 60.0;
    let decimals = (DISPLAY_DIGITS as i32 - int_digits - 4).max(0) as usize;

    // **先に丸めてから繰り上がりを見る。** 59.999... が 60 に丸まる場合、
    // 丸めた後の値でしか気づけない（format_real と同じ手）。
    let mut text = format!("{:.*}", decimals, seconds);
    if text.parse::<f64>().unwrap_or(0.0) >= 60.0 {
        text = format!("{:.*}", decimals, 0.0);
        minutes += 1.0;
        if minutes >= 60.0 {
            minutes = 0.0;
            degrees += 1.0;
        }
    }
    Some(format!(
        "{sign}{}°{}'{}\"",
        degrees,
        minutes,
        trim_zeros(&text)
    ))
}
```

**`unwrap_or` を使っているのは、`format!` が作った文字列は必ず解析できるが、
`unwrap()` が lint で禁じられているためである。** 解析できなければ 0.0 として
扱い、繰り上がらない——安全側に倒れる。

- [ ] **Step 4: 緑を見る**

```bash
cargo test -p calcarc-core --lib numeric::format
```

- [ ] **Step 5: 赤確認 — 繰り上がりを外す**

設計書 §7 が名指しで要求している。`if text.parse... >= 60.0` のブロックを消す。

```bash
cargo test -p calcarc-core --lib numeric::format 2>&1 | grep -E 'FAILED|left|right'
```

期待: `sexagesimal_carries_when_the_seconds_round_up` が **FAILED** で、
**`1°0'0"` の代わりに `0°59'60"` が出る**。**再編集で戻す。**

- [ ] **Step 6: numerical-policy に節を足す**

```markdown
## 60 進表示（`°'"`）

**値は 10 進の f64 のままで、60 進は入力と表示の形式である**（S-4 設計書 §1）。
だから四則演算を 1 つも足していない——`1:30 + 2:45` は `1.5 + 2.75` である。

同じ形式が**経過時間と角度の両方**を表す。`3.75` は `3°45'0"` とも
「3 時間 45 分」とも読め、**どちらの意味かは利用者の頭の中にしかない。**

**24 で割らない**（裁定 5）。`30.5` は `30°30'0"` と出る——経過時間の計算では
`30:00:00` が要る。

**秒の小数桁は `DISPLAY_DIGITS` の残り**（裁定 7）。度が `nd` 桁、分が 2 桁、
秒の整数部が 2 桁を使うので、秒の小数は `10 − nd − 4` 桁になる。
秒に小数を許さないと `0.001` 時間（= `0°0'3.6"`）が表せない。

**丸めで秒が 60 になったら繰り上げる。** `0.999999999` は秒が 59.9999996 で、
5 桁に丸めると 60.00000 になり、**分へ、さらに度へ二段繰り上がって `1°0'0"`**
になる。`format_real` が `9999999999.6 → 1e10` で踏んだのと同じ形で、手も同じ
——**先に丸めてから桁を決める**。

**60 進にできない値には何もしない**（裁定 6）。非有限と、度が有効数字を使い切る
値（`1e10` 以上）がそれで、**表示を変えないだけでエラー状態には落とさない。**
表示の操作でエラーにするのは重い。
```

- [ ] **Step 7: コミット**

```bash
cargo fmt && cargo test -p calcarc-core && cargo clippy --workspace --all-targets -- -D warnings && \
test "$(git branch --show-current)" = feature/sexagesimal && git add -A && git commit -m "$(cat <<'EOF'
Show a number in degrees, minutes and seconds

The value stays decimal f64 — sexagesimal is a display format, which
is why this adds no arithmetic at all. 3.75 reads as 3°45'0" or as
three and three quarter hours, and which one it is lives only in the
head of whoever typed it.

Seconds round before the carry is checked, because 59.9999996 only
becomes 60 after rounding. At five decimals 0.999999999 carries twice,
through the minutes and into the degrees.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Python 参照と golden

**独立軸**: Rust は f64 の `trunc` と乗算、Python は **`Fraction` の厳密有理数**。

**Files:**
- Create: `reference/src/calcarc_reference/sexagesimal_ref.py`
- Create: `reference/tests/test_sexagesimal_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`
- Modify: `reference/scripts/generate.py`
- Modify: `crates/calcarc-core/tests/golden.rs`
- Regenerate: `testdata/scientific.json`

**Interfaces:**
- Produces: golden の `op: "sexagesimal"`、`input: {"x": …}`、
  `expect: {"text": "1°30'0\""}` または `{"text": null}`（60 進にできない）

**⚠ `expect` が数値でない初めてのケースである。** `golden.rs` の
`scientific_functions_match_the_reference` は `close_complex` を呼ぶ形なので、
**`sexagesimal` だけ別の腕で文字列比較する**（`data_scale_golden.rs` が
文字列を比べているのと同じ形）。

- [ ] **Step 1: 参照実装を書く**

```python
"""60 進表示の参照実装。

Rust は f64 の trunc と乗算で桁を割り出す。ここは **Fraction の厳密有理数**で
やる——`3.75 = 15/4` から `3 + 45/60` を厳密に出せるので、**f64 の割り算を
1 度も通らない**。アルゴリズムが同型でないことがこの層の価値である
（CONTRIBUTING: 参照実装を Rust の移植にしない）。
"""

from __future__ import annotations

import math
from fractions import Fraction

DISPLAY_DIGITS = 10


def format_sexagesimal(x: float) -> str | None:
    """60 進の文字列。60 進にできなければ None。"""
    if not math.isfinite(x):
        return None
    sign = "-" if x < 0 else ""
    a = Fraction(abs(x))  # f64 の二進値をそのまま厳密な有理数にする
    degrees = a.numerator // a.denominator
    int_digits = 1 if degrees == 0 else len(str(degrees))
    if int_digits + 4 > DISPLAY_DIGITS:
        return None
    rest = (a - degrees) * 60
    minutes = rest.numerator // rest.denominator
    seconds = (rest - minutes) * 60
    decimals = max(0, DISPLAY_DIGITS - int_digits - 4)

    # 丸めてから繰り上がりを見る（Rust と同じ順序だが、丸めるのは有理数）。
    quantum = Fraction(1, 10**decimals)
    rounded = Fraction(round(seconds / quantum)) * quantum
    if rounded >= 60:
        rounded = Fraction(0)
        minutes += 1
        if minutes >= 60:
            minutes = 0
            degrees += 1

    text = f"{float(rounded):.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return f"{sign}{degrees}°{minutes}'{text}\""
```

**`round()` は Python の banker's rounding（round-half-to-even）である。**
Rust の `format!("{:.*}")` も round-half-to-even なので**規則は一致する**が、
**書き方が違う**（Rust は書式化に丸めさせ、Python は有理数で丸める）。
一致は偶然ではなく、どちらも IEEE 754 の既定に従っているためである。

- [ ] **Step 2: 入力ケースを足す**

`cases.py`:

```python
# 60 進表示（S-4 設計書 §7 の必須ケース）。
SEXAGESIMAL_INPUTS: list[float] = [
    1.5,  # 1°30'0"（設計書 §1 の見出し例）
    0.001,  # 0°0'3.6"（秒に小数が要る証拠）
    -3.75,  # 符号は先頭に 1 つ
    0.0,  # 0°0'0"
    30.5,  # 24 を超えてもそのまま（裁定 5）
    0.1,
    0.3333333333333333,  # 1/3
    0.999999999,  # **秒 → 分 → 度と二段繰り上がる**
    2.75,
    999999.5,  # 度が 6 桁。まだ出せる
    1e10,  # 度が 10 桁 → None（裁定 6）
    1e308,  # 同上
    123.456,
]
```

- [ ] **Step 3: `generate.py` にループを足す**

```python
    for x in cases.SEXAGESIMAL_INPUTS:
        entries.append(
            {
                "id": f"sexagesimal/{x}",
                "op": "sexagesimal",
                "input": {"x": x},
                "expect": {"text": sexagesimal_ref.format_sexagesimal(x)},
            }
        )
```

（`from calcarc_reference import sexagesimal_ref` の import も足す。）

- [ ] **Step 4: `golden.rs` に文字列比較の腕を足す**

**`sexagesimal` は数値の腕に混ぜられない。** match の**手前**で分岐する:

```rust
    for case in &golden.cases {
        // sexagesimal だけ expect が文字列である。数値の腕に混ぜない。
        if case.op == "sexagesimal" {
            let x = field(&case.input, "x");
            let expected = case.expect.get("text").and_then(|t| t.as_str());
            let actual = calcarc_core::numeric::format::format_sexagesimal(x);
            assert_eq!(actual.as_deref(), expected, "{}", case.id);
            continue;
        }
        ...
    }
```

**`numeric::format` が `pub` で見えるかを確かめること**（見えなければ
`lib.rs` で再公開する。計算ではなく書式化なので公開してよい）。

- [ ] **Step 5: 参照実装自身のテスト**

`reference/tests/test_sexagesimal_ref.py`:

```python
from calcarc_reference.sexagesimal_ref import format_sexagesimal


def test_the_headline_example() -> None:
    assert format_sexagesimal(1.5) == "1°30'0\""


def test_seconds_keep_their_decimals() -> None:
    assert format_sexagesimal(0.001) == "0°0'3.6\""


def test_the_carry_goes_through_the_minutes_into_the_degrees() -> None:
    # 秒が 59.9999996 で、5 桁に丸めると 60。分が 60 になって度へ繰り上がる。
    assert format_sexagesimal(0.999999999) == "1°0'0\""


def test_what_cannot_be_shown_is_none() -> None:
    assert format_sexagesimal(1e10) is None
    assert format_sexagesimal(float("inf")) is None
```

- [ ] **Step 6: 再生成して緑を見る**

```bash
cd reference && uv run --no-config pytest -q && uv run --no-config ruff check . && \
uv run --no-config python scripts/generate.py && cd .. && cargo test -p calcarc-core --test golden
```

**落ちたら、Rust と Python のどちらが正しいかを先に決めること。**
`Fraction` は厳密なので、**食い違ったら Rust の f64 経路を疑う**のが筋である
——ただし「厳密なほうが表示として正しい」とは限らない（表示は f64 の値を
見せるものなので）。**食い違いの中身を見てから判断する。**

- [ ] **Step 7: golden が `null` のケースを持っていることを確かめる**

```bash
python3 -c "
import json
d=json.load(open('testdata/scientific.json'))
s=[c for c in d['cases'] if c['op']=='sexagesimal']
print('cases:', len(s))
print('null:', [c['id'] for c in s if c['expect']['text'] is None])
"
```

期待: `sexagesimal/10000000000.0` と `sexagesimal/1e+308` が出ること。

- [ ] **Step 8: コミット**

---

### Task 4: `Buffer` に 3 つ目の入力モードを入れる

**ここが実装の主戦場である**（設計書 §3）。**キーはまだ足さない**——`Buffer` の
構造と値の導出を先に固める。

**Files:**
- Modify: `crates/calcarc-core/src/engine/state.rs`

**Interfaces:**
- Produces: `Buffer.sexagesimal: Vec<String>`（確定した段。最大 2 つ）
- Produces: `Buffer::push_sexagesimal_separator(&mut self) -> bool`
  （区切りを打てたら true。3 段目で打つと false）
- Produces: `Buffer::value()` が 60 進の段を畳んだ値を返す
- Produces: `STATE_SCHEMA = 6`

**形の決め方（設計書 §3 は「段数を持たせる」としか書いていないので、ここで決める）:**

```rust
pub struct Buffer {
    pub digits: String,
    pub imaginary: bool,
    pub exponent: Option<Exponent>,
    /// 60 進で確定した段。`digits` が**いま打っている段**である。
    /// `1 °'" 30 °'"` なら `["1", "30"]` で `digits` は空。
    /// **最大 2 つ**——度・分・秒の 3 段なので、確定するのは 2 つまで。
    pub sexagesimal: Vec<String>,
}
```

**値**: `sexagesimal[0] + sexagesimal[1]/60 + digits/3600`。段が足りなければ 0 とみなす
（`1 °'" 30 °'"` は秒を省略した形で `1.5`。設計書 §3）。

**指数と併用しない。** `EXP` と `°'"` は別の入力モードで、混ぜると意味が決まらない。

**排他の操作的意味論（両方向とも「無視」）:**

| 状況 | 押したキー | 起きること |
|---|---|---|
| 指数入力中（`exponent.is_some()`） | `°'"` | **何もしない。** 区切りは打たれず、指数はそのまま |
| 60 進入力中（`sexagesimal` が空でない） | `EXP` | **何もしない。** 指数は開かず、段はそのまま |

**エラーにもモード切替にもしない。** 前例がある——`push_dot` は
「指数は整数。小数点は無視する（**打ち間違いで計算を止めない**）」と決めており、
**同じ理由が同じ強さで当てはまる**。`°'"` の打ち間違いで `1.5e3` の入力が
壊れるのは、利用者にとって理不尽である。

**モード切替にしない理由**は別にある。切り替えるなら**すでに打った桁を
どう解釈し直すか**を決めねばならず（`1.5e3` の `3` は指数か秒か）、
**答えが無い**。無視なら答えが要らない。

**この 2 行は `engine_table.rs` にも置く**（Task 5 Step 1）——`Buffer` の
ユニットテストだけだと、キー列から到達したときの挙動が固定されない。

- [ ] **Step 1: 失敗するテストを書く**

`state.rs` の `mod tests` に:

```rust
    #[test]
    fn a_sexagesimal_buffer_folds_its_stages() {
        // 1 °'" 30 °'" 0 → 1.5（設計書 §3）
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert!(b.push_sexagesimal_separator());
        b.push_digit(0);
        assert_eq!(b.value().unwrap(), Value::real(1.5));
    }

    #[test]
    fn the_last_sexagesimal_stage_may_be_omitted() {
        // 1 °'" 30 °'" で秒を省ける（設計書 §3）。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.push_sexagesimal_separator());
        b.push_digit(3);
        b.push_digit(0);
        assert!(b.push_sexagesimal_separator());
        assert_eq!(b.value().unwrap(), Value::real(1.5));
    }

    #[test]
    fn a_fourth_sexagesimal_stage_is_refused() {
        // 段は 3 つまで（裁定 3）。4 つ目の区切りは打てない。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.push_sexagesimal_separator());
        assert!(b.push_sexagesimal_separator());
        assert!(!b.push_sexagesimal_separator());
    }

    #[test]
    fn sexagesimal_and_the_exponent_do_not_mix() {
        // 別の入力モードなので混ぜない。
        let mut b = Buffer::default();
        b.push_digit(1);
        assert!(b.push_sexagesimal_separator());
        b.push_exponent();
        assert!(b.exponent.is_none());

        let mut c = Buffer::default();
        c.push_digit(1);
        c.push_exponent();
        assert!(!c.push_sexagesimal_separator());
    }

    #[test]
    fn a_sexagesimal_buffer_shows_what_was_typed() {
        // 入力中は打った通りに見せる（設計書 §3.2 の既存規則）。
        let mut b = Buffer::default();
        b.push_digit(1);
        b.push_sexagesimal_separator();
        b.push_digit(3);
        b.push_digit(0);
        assert_eq!(b.text(), "1°30");
    }
```

- [ ] **Step 2: 赤を見る → 実装 → 緑を見る**

`Buffer` に欄を足し、`value()` / `text()` / `backspace()` / `push_exponent()` を直す。

**`backspace()` の段構成に 60 進が入る**（I7 の順序）。既存は
「指数の桁 → e マーカー → 仮数の文字 → j マーカー」。
**60 進は「いま打っている段の文字 → 直前の区切り → …」**とする
——`1 °'" 30` から DEL を 3 回押すと `1 °'" 3` → `1 °'"` → `1` になる。

- [ ] **Step 3: `STATE_SCHEMA` を 6 に上げる**

```rust
/// 6: `Buffer` に 60 進の段と、`EngineState` に 60 進表示の一時状態が
///    入った(S-4 設計書 §3.2)。直列化の形が変わったので上げた。
pub const STATE_SCHEMA: u32 = 6;
```

- [ ] **Step 4: 段 1 を回してコミット**

---

### Task 5: `Key::Dms` を盤面まで通す

**1 コミットにまとまる**（`Key::ALL` → `token_parity` → 盤面の連鎖）。

**Files:** `key.rs` / `mod.rs` / `display.rs` / `engine_table.rs` /
`web/src/calc/types.ts` / `web/src/ui/Keypad/scientific.ts` + そのテスト /
`web/tests/e2e/keypad-shell.spec.ts`

**Interfaces:**
- Produces: キートークン **`dms`**（`Key::ALL` と `KEY_TOKENS` の末尾。46 個目）
- Produces: `EngineState.sexagesimal_view: bool`（§3.1 の一時状態）

**`°'"` は 2 つの仕事をする**（Casio 方式）:

| 状況 | 動作 |
|---|---|
| 入力中（`buffer.is_some()`） | **60 進の区切り**（段を確定） |
| 入力中でない | **表示の一時トグル**（`sexagesimal_view` を反転） |

**解除規則（§3.1）: `°'"` 以外のあらゆるキーで `sexagesimal_view` を false にする。**
`reduce` の `operator_pending` と同じ場所で、**同じ形の match**で書く
——例外を作らない。

- [ ] **Step 1: 仕様の行を先に書く**

```rust
#[test]
fn the_dms_key_separates_stages_while_typing() {
    // 1 °'" 30 °'" 0 → 1.5（設計書 §3）。入力中は打った通りに見せる。
    assert_eq!(main_of(&["1", "dms", "3", "0"]), "1°30");
    assert_eq!(main_of(&["1", "dms", "3", "0", "dms", "0", "eq"]), "1.5");
    // 秒は省ける。
    assert_eq!(main_of(&["1", "dms", "3", "0", "dms", "eq"]), "1.5");
}

#[test]
fn the_dms_key_shows_a_committed_value_in_sexagesimal() {
    // = のあとに押すと現在値を 60 進で見せる（設計書 §3）。
    assert_eq!(main_of(&["3", "dot", "7", "5", "eq", "dms"]), "3°45'0\"");
    // もう一度押すと戻る（裁定 4 のトグル）。
    assert_eq!(main_of(&["3", "dot", "7", "5", "eq", "dms", "dms"]), "3.75");
}

#[test]
fn the_sexagesimal_view_is_released_by_any_other_key() {
    // **例外を作らない**（設計書 §3.1）。表示トグルでも解除する。
    for release in ["angle_toggle", "polar_toggle", "eng", "del", "ac"] {
        let keys = vec!["3", "dot", "7", "5", "eq", "dms", release];
        assert_ne!(
            main_of(&keys),
            "3°45'0\"",
            "{release} should have released the sexagesimal view"
        );
    }
}

#[test]
fn the_four_operations_answer_in_sexagesimal_without_new_arithmetic() {
    // **この spec の要点**（設計書 §1）: 1:30 + 2:45 = 4:15 は
    // 1.5 + 2.75 = 4.25 であり、既存の加算がそのまま答える。
    assert_eq!(
        main_of(&["1", "dms", "3", "0", "dms", "add", "2", "dms", "4", "5", "dms", "eq", "dms"]),
        "4°15'0\""
    );
}

#[test]
fn the_dms_key_does_nothing_to_a_value_it_cannot_show() {
    // 裁定 6: 表示を変えないだけで、エラーにはしない。
    let shown = run(&["1", "exp", "2", "0", "eq", "dms"]);
    assert_eq!(shown.main, "1e20");
    assert!(shown.error.is_none());
}
```

**`1 °'" 30 °'" + 2 °'" 45 °'" =` の期待値を手で確かめること**:
`1.5 + 2.75 = 4.25` → `4°15'0"`。

- [ ] **Step 2: 赤を見る（`unknown key: dms`）**

- [ ] **Step 3: `Key::Dms` を足す**（`ALL` を 45 → 46、`from_token` / `token`）

- [ ] **Step 4: `EngineState` に `sexagesimal_view` を足し、`cleared()` で落とす**

**`AC` は解除する**（§3.1 の表）ので、`cleared()` は `false` にする
——`angle` / `form` / `notation` のように**保たない**。

- [ ] **Step 5: `apply` と `reduce` を書く**

```rust
        Key::Dms => {
            // 入力中なら区切り、そうでなければ表示の一時トグル。
            let separated = state
                .buffer
                .as_mut()
                .is_some_and(Buffer::push_sexagesimal_separator);
            if !separated && state.buffer.is_none() {
                state.sexagesimal_view = !state.sexagesimal_view;
            }
        }
```

`reduce` の末尾で**解除**する（`operator_pending` の隣）:

```rust
        // §3.1: `°'"` 以外のあらゆるキーで 60 進表示を解除する。
        // 例外を作らない——`▸∠` は形を変え、`DEG/RAD` は角度の意味を変え、
        // `ENG` は同じ表示層で競合する。1 つの規則で言い切るほうが安い。
        if key != Key::Dms {
            next.sexagesimal_view = false;
        }
```

- [ ] **Step 6: `render` が一時状態を読む**

`display.rs` の `main` を決めるところで、**`sexagesimal_view` が立っていて
`buffer` が無いとき**だけ `format_sexagesimal` を試す。
**`None` なら通常表示に落とす**（裁定 6）。

**`Notation::Eng` とは排他**（設計書 §9）。60 進が勝つ——押した直後だから。

- [ ] **Step 7: TypeScript と盤面**

`KEY_TOKENS` に `"dms"`。`FUNCTIONS_SECOND` の**最後の予約スロットを埋める**:

```ts
    { token: "dms", label: "°′″", ariaLabel: "60進に切り替え", variant: "function" },
```

**`scientific.test.ts` の 2 か所を直す**:
- `puts ENG on the first face...` の並びの最後を `null` から `"dms"` に
- `has one reserved slot left, and it is the one S-4 fills` を
  **「予約スロットは 1 つも残っていない」**に書き換える

**`web/tests/e2e/keypad-shell.spec.ts` の
`the one remaining reserved slot does nothing, and looks like it` は、
守る対象が消える。** S-1 と同じ判断で**削除ではなく向け直す**か、
**対象が無くなったことを主張する形に変える**——
「盤面に予約スロットは 1 つも無い」は主張として意味がある。

- [ ] **Step 8: 段 1・3・4 を回す**

- [ ] **Step 9: 赤確認 — 解除規則の例外を作ってみる**

`if key != Key::Dms` を `if !matches!(key, Key::Dms | Key::EngToggle)` にする
（「表示トグルは保つ」という、あり得た設計）。

期待: `the_sexagesimal_view_is_released_by_any_other_key` が **FAILED**。
**再編集で戻す。**

- [ ] **Step 10: コミット**

---

### Task 6: 網羅列挙に `Dms` を入れる

**S-3 で確立した一般則の適用**——「網に入れる価値があるのは、**結合方向が違う**か
**状態の形が違う**とき」。**`°'"` は状態の形を変える**（`Buffer` に 3 つ目の
モード、`EngineState` に一時状態）ので、**今度は入る側である。**

**Files:** `crates/calcarc-core/tests/engine_robustness.rs`

- [ ] **Step 1: 前の壁時計を測る**（S-3 時点で 12.6 秒）

- [ ] **Step 2: `ALL_CLASSES` と `FOCUS` に `Key::Dms` を足す**

**`Exp` の隣に置く**——どちらも `Buffer` の構造を変えるキーである。

- [ ] **Step 3: 実測して予算を確かめる**

**17 クラスで `17^5 / 16^5 = 1.35` 倍**の見込み。**`cargo test --workspace` が
20 秒を超えたら**、`FOCUS` に入れるだけにして `ALL_CLASSES` からは外す
（長さ 6 の焦点列でだけ踏む）。**どちらにしても実測値をコメントに書く。**

**S-3 で「比^深さは下限であって上限ではない」と書いた。今回も上振れするか
を見ること**——`Dms` は `Buffer` を伸ばすので枝刈りが減る可能性がある。

- [ ] **Step 4: 網が鈍っていないことを確かめる**

`operator_pending` の二項腕を退行させて、**3 件以上**落ちることを見る。

- [ ] **Step 5: I7（DEL の段構成）に 60 進が入ったことを確かめる**

**Fable のレビュー観点の先出しにある。** `del_removes_at_most_one_thing` が
60 進の段を 1 つずつ戻すことを見ているか確認し、見ていなければ足す。

- [ ] **Step 6: コミット**

---

### Task 7: 盤面を撮って見る

**4 本を通したあとの最終形である**（設計書 §5）。

- [ ] **Step 1: 両面を撮る**（390×844、`pnpm preview --port 4179 --strictPort`）
- [ ] **Step 2: 見る**
  - **`°′″` が 45.43px に収まるか**（3 文字で、しかも記号）
  - 2 段目が `[ENG] [ln] [log] [1/x] [eˣ] [xʸ] [°′″]` で**予約スロットが無い**か
  - 第 2 面（Shift）が全部埋まって見えるか
- [ ] **Step 3: preview を落とす**（`pkill -f 'vite preview'` + `lsof -i :4179`）

---

### Task 8: E2E

**Files:** Create `web/tests/e2e/sexagesimal.spec.ts`

見るもの:
1. `1 °'" 30 °'" + 2 °'" 45 °'" =` → `4.25`、そこで `°'"` → `4°15'0"`
2. **一時状態であること**——次に何か押すと十進に戻る
3. **入力中の表示**が `1°30` と打った通りに出る
4. `°′″` キーが 44px を保っている

- [ ] **Step 1〜4**: 書く → 単体で走らせる → 全体を走らせる → コミット

---

### Task 9: 文書とブランチ末尾のスイープ

- [ ] **Step 1: grep で腐った理由を洗い出す**

**「赤くなる場所」と「緑のまま意味だけ変わる場所」を別に数える。**

```bash
grep -rn '60 進\|予約スロット\|準備中\|sexagesimal\|dms\|STATE_SCHEMA' \
  --include='*.md' --include='*.rs' --include='*.ts' --include='*.tsx' . \
  | grep -v node_modules | grep -v '/target/' | grep -v '\.venv' | grep -v '/src/wasm/'
```

**特に見る**: 「予約スロットが 1 つ残っている」と書いた S-3 の記述
（`scientific.test.ts` と `keypad-shell.spec.ts` と S-1 の
`FUNCTIONS_SECOND` のコメント）。**S-4 で 0 になる。**

- [ ] **Step 2: `docs/base-spec.md` §9 に 60 進の節を足す**（設計書 §6）

```markdown
## 9.3 60 進表記（S-4、2026-08-16。ユーザー発意）

`°'"` キーで、**経過時間と角度の両方**を 60 進で入出力する。

- **入力**: 数を打つ途中に区切りとして押す。`1 °'" 30 °'"` は `1.5`
- **表示**: 確定値に押すと `3.75` → `3°45'0"`。**押したときだけ**で、
  次に何か押すと十進に戻る

**値は 10 進の実数のままである。** 60 進は入力と表示の形式にすぎないので、
**四則演算は 1 つも足していない**——`1:30 + 2:45` は `1.5 + 2.75` である。
同じ形式が時間とも角度とも読め、**度分秒で入れた角度をそのまま `sin` に渡せる**
（§9.1 の電気・電子分野の用途と噛み合う）。

**時刻ではない。** `13:45` の 3 時間後は求められない——時点と期間を区別する型が
要るので、必要になったら別 spec にする。24 時間で割らないのも同じ理由である
（`30:00:00` が経過時間として要る）。
```

- [ ] **Step 3: 設計書の状態行を更新**（「⚠ 未実装」を消す）

- [ ] **Step 4: S-2 spec の依存表（§0.1）で S-4 を「実装済み」にする**

**あの表が実装順と依存の正である**（memory と各 spec が参照している）。
**4 本すべてが実装済みになる。**

- [ ] **Step 5: フルスイープ**（すべて `&&` で連結）

```bash
cargo fmt --check && cargo test --workspace && \
cargo clippy --workspace --all-targets -- -D warnings && echo "RUST OK"
```
```bash
wasm-pack test --headless --firefox crates/calcarc-wasm 2>&1 | grep 'test result'
```
```bash
cd reference && uv run --no-config pytest -q && uv run --no-config ruff check . && \
uv run --no-config python scripts/generate.py && cd .. && \
git diff --exit-code testdata/ && echo "golden reproducible"
```
```bash
cd web && pnpm wasm && pnpm test && pnpm lint && pnpm build && pnpm e2e && cd .. && echo "WEB OK"
```

- [ ] **Step 6: コミット**

---

### Task 10: 申し送り

- [ ] **Step 1: `feature/e2e-corpus` に完了を伝える**（`dms` 1 つ追加、schema 6、
  表示書式は押したときだけ）
- [ ] **Step 2: Fable に完了レビューを依頼**（firefox の件数、網の壁時計 前後、
  `STATE_SCHEMA` 6、解除規則の赤確認）
- [ ] **Step 3: 4 本完了をユーザーに報告**——**縦積みは
  `origin/main` → S-1 → S-3 → S-4。push すると rebase で SHA が変わるので、
  積み直しが要ることを伝える**

---

## Self-Review

**1. Spec coverage**

| 設計書 | タスク |
|---|---|
| §1 60 進は表示形式・四則を書かない | Task 2・Task 5 Step 1 の `the_four_operations_answer_in_sexagesimal_without_new_arithmetic` |
| §2 裁定 1（経過時間） | Task 9 Step 2（base-spec に「時刻ではない」と明記） |
| §2 裁定 2（角度と兼ねる） | Task 2 の doc コメント・Task 9 |
| §2 裁定 3（3 段） | Task 4 Step 1 の `a_fourth_sexagesimal_stage_is_refused` |
| §2 裁定 4（押したときだけ） | Task 5 Step 1・Step 5・Step 9 |
| §2 裁定 5（24 を超えてもそのまま） | Task 2 Step 1（`30.5`） |
| §2 裁定 6（できない値は何もしない） | Task 2 Step 1・Task 5 Step 1 の最後 |
| §2 裁定 7（秒の桁） | Task 2（桁の配り方を具体化） |
| §2 裁定 8（第 1 面の 2 段目） | Task 5 Step 7・Task 7 |
| §3 入力 | Task 4 |
| §3.1 解除規則 | Task 5 Step 5・Step 9 |
| §3.2 schema 5 → 6 | Task 4 Step 3 |
| §3 丸め・繰り上がり | Task 2 Step 1・Step 5 |
| §5 盤面 | Task 5 Step 7・Task 7 |
| §6 base-spec | Task 9 Step 2 |
| §7 Python 参照（`Fraction`）・必須ケース・赤確認 | Task 3・Task 2 Step 5 |
| §7.1 他セッションへの事前連絡 | **Task 1** |
| §9 スコープ外 | 触らない（時刻・日付・単位換算・60 進の ENG） |

**2. Placeholder scan**: 無し。Task 6 の壁時計だけ実測待ちだが、
**測る手順と超過時の分岐を書いてある。**

**3. Type consistency**
- `format_sexagesimal(x: f64) -> Option<String>` は Task 2 で定義、
  Task 3（golden）と Task 5（`render`）が使う ✔
- `Buffer.sexagesimal: Vec<String>` と `push_sexagesimal_separator` は Task 4 ✔
- `EngineState.sexagesimal_view: bool` は Task 5 ✔
- `Key::ALL` 45 → 46、`KEY_TOKENS` も 1 つ ✔
- golden の `expect` が**文字列**なのは `sexagesimal` だけ。
  **match の手前で分岐する**と明記した ✔

**4. S-1 / S-3 で踏んだ失敗への対策**
- `&&` で連結（clippy 赤のままコミットの再発防止）✔
- grep を「赤くなる場所」と「緑のまま意味が変わる場所」に分ける ✔
- **`assert_close` を大きい値に使わない**——60 進は文字列一致なので該当しない ✔
- 予算は**測ってから**判断し、超過時の分岐を先に決めてある ✔

## 未確認事項（実装者へ）

1. **`numeric::format` が `calcarc-core` の外から見えるか。** golden が
   `format_sexagesimal` を直接呼ぶので、見えなければ再公開が要る（Task 3 Step 4）
2. **`Buffer::text()` の 60 進表示をどう出すか。** この計画は `1°30` と決めたが、
   **区切りを打った直後に何を出すか**（`1°` か `1°0` か）は決めていない。
   **Task 4 Step 1 で `1°30` を固定したので、その形に合わせること**
3. **`Notation::Eng` と 60 進が同時に立ったときの優先**。この計画は
   **60 進を勝たせる**と決めた（押した直後だから）。設計書 §9 は「排他にする」と
   しか書いていないので、**engine_table に 1 行足して固定すること**
