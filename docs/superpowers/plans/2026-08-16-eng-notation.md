# S-2 ENG 表示トグルと 3 桁カンマ — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 表示に **3 桁カンマ**を常時入れ、**ENG（工学表記）のトグル**を足す。
**計算には 1 行も触らない。**

**Architecture:** `numeric/format.rs` が実数 1 つの表し方を持っているので、そこに
2 つの規則を足す。ENG は `angle` / `form` と同じ**表示の状態**として `EngineState` に
載せ、`render()` が読む。盤面は関数列を 1 段から 2 段にして ENG を第 1 面に出す。

**Tech Stack:** Rust / wasm-bindgen / TypeScript / React 19 / vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-08-16-eng-notation-design.md`
（**節番号をこの計画の各所で引く。実装者は自分のタスクが引く節だけ読めばよい**）

## Global Constraints

- **計算ロジックを触らない。** この計画で数値の答は 1 つも変わらない。変わるのは
  **文字列にする段だけ**である
- **`calcarc-core` は panic しない**（`unwrap`/`expect` は lint が禁じている）
- **WASM 境界は JavaScript 例外を投げない**
- **許容誤差をテストコードに書かない**
- **5×5 のメイングリッドを 1 キーも動かさない**——`AC`/`DEL` の位置とキー寸法は
  3 タブで揃えてある
- **区画の `ariaLabel` を変えない**（E2E のセレクタ）
- コミット前に **`cargo fmt`**
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける
- **`git push` と PR 作成は行わない**
- **共有ワークツリーである。コミットの前に必ず**
  `test "$(git branch --show-current)" = feature/eng-notation && git commit ...`
  の形にすること。`git checkout` / `git switch` でブランチを切り替えない
- E2E のポートは **4179**。**撮り終えたら preview を必ず落とす**

## 他セッションとの約束（合意済み。**守ること**）

`feature/e2e-corpus` の担当セッションが、表示文字列を数に戻して 4,000 件を検証している。

- **カンマは既定の表示を変えるので、相手の 555 件（27.8%）と assertion 1 個が赤くなる。**
  **これは合意済みで、待ち合わせない**——相手は赤くなってから実測し直して直す
- **`KEY_TOKENS` は足すだけ**（`eng` の 1 つ）。既存の綴りを 1 文字も変えない
- **`corpus_expr.py` の `UNARY_FNS` / `BINARY_OPS` に触らない**
- **`engine_table.rs` は、行を足すのが原則。ただし既存行のうち
  「4 桁以上の表示が出る行」は、カンマが既定なので必ず書き換わる**
  （**【訂正 2026-08-16】** 当初この行は「既存行を書き換えない」とだけ書いていたが、
  **カンマが既定を変える以上それは最初から満たせない約束だった**。実際
  `exp_enters_an_exponent` の 2 行が変わっている。**相手が実際に依存しているのは
  「キー列の綴りを変えないこと」**であり、表示の期待値ではない——期待値が変われば
  相手のコーパスは自分で赤くなって気づく）
- **実装が入ったら伝える**（Task 8 の完了条件）

## ファイル構成

```text
crates/calcarc-core/src/numeric/format.rs   カンマ + 工学表記（Task 1・2）
crates/calcarc-core/src/engine/state.rs     Notation を足す。STATE_SCHEMA 4→5（Task 3）
crates/calcarc-core/src/engine/key.rs       Key::EngToggle（Task 3）
crates/calcarc-core/src/engine/mod.rs       reduce の分岐（Task 3）
crates/calcarc-core/src/engine/display.rs   render が notation を読む（Task 3）
crates/calcarc-core/tests/engine_table.rs   キー列と表示の対応（Task 3）
crates/calcarc-wasm/src/lib.rs              DisplayState に notation（Task 4）
web/src/calc/types.ts                       KEY_TOKENS に "eng"、DisplayState（Task 5）
web/src/ui/Display/Display.tsx              ENG インジケータ（Task 5）
web/src/ui/Keypad/scientific.ts             関数列を 2 段に（Task 6）
web/tests/e2e/eng-notation.spec.ts          新設（Task 7）
docs/numerical-policy.md                    既定の文を書き換え + ENG の追記（Task 8）
```

---

### Task 1: カンマを入れる

**Files:**
- Modify: `crates/calcarc-core/src/numeric/format.rs`

**Interfaces:**
- Consumes: 既存の `format_real(x: f64) -> String`
- Produces: `format_real` の**平坦な 10 進を返す経路**にだけカンマが入る。
  指数表記の経路は不変。関数の名前も引数も変わらない

設計書 §3.3 を読むこと。

- [ ] **Step 1: ブランチを作る**

```bash
cd /home/terapyon/dev/CalcArc
git branch --show-current      # 期待: docs/scientific-completion
git status --short             # 期待: 空
git switch -c feature/eng-notation
git log --oneline -1
```

**`docs/scientific-completion` から生やす**——設計書がそこにあり、main には無い。

- [ ] **Step 2: 失敗するテストを書く**

`format.rs` の `mod tests` に足す。

```rust
    #[test]
    fn thousands_separators_group_only_the_integer_part() {
        assert_eq!(format_real(1234567.0), "1,234,567");
        assert_eq!(format_real(1234.5678), "1,234.5678"); // 小数部は刻まない
        assert_eq!(format_real(-1234567.0), "-1,234,567"); // 符号は先頭
        assert_eq!(format_real(999.0), "999"); // 4 桁未満は変わらない
        assert_eq!(format_real(1000.0), "1,000"); // 境界の両側
        assert_eq!(format_real(1.5e12), "1.5e12"); // 指数表記には入らない
    }
```

**境界の両側（`999` と `1000`）を置くのが要点**である——片側だけだと閾値がずれても通る。

- [ ] **Step 3: 赤を見る**

```bash
cd /home/terapyon/dev/CalcArc && cargo test -p calcarc-core thousands 2>&1 | head -20
```

期待: `left: "1234567"` / `right: "1,234,567"` で落ちる。

- [ ] **Step 4: 実装する**

`format_real` の**平坦な 10 進を返す return** にだけ掛ける。指数表記の return には
掛けない。

```rust
/// 整数部だけを 3 桁ごとに区切る。**小数部と指数部には入れない**(設計書 §3.3)。
///
/// `data_scale::format::group_digits` と見た目は同じだが共通化しない——あちらは
/// `u128` の整数で定義域も用途も違い、**同じ見た目のものを 1 つにまとめると
/// 片方の都合がもう片方に効く**。5 行の処理であり、共有する価値より結合の害が大きい。
fn group_integer_part(text: &str) -> String {
    let (sign, rest) = match text.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", text),
    };
    let (int_part, frac) = match rest.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (rest, None),
    };
    let mut grouped = String::with_capacity(int_part.len() + int_part.len() / 3);
    for (i, c) in int_part.chars().enumerate() {
        if i != 0 && (int_part.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(c);
    }
    match frac {
        Some(f) => format!("{sign}{grouped}.{f}"),
        None => format!("{sign}{grouped}"),
    }
}
```

`format_real` の末尾を `trim_zeros(&format!(...))` から
`group_integer_part(&trim_zeros(&format!(...)))` に変える。

- [ ] **Step 5: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc && cargo test -p calcarc-core && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt
```

**既存のテストが落ちるはずである**——`format_rect` / `format_polar` や
`engine_table.rs` に 4 桁以上の期待値があれば、そこがカンマ付きになる。
**落ちたものは期待値を直す。ただし直す前に、落ちた件数と内容を報告に控えること**
（既定を変えた影響の実測である）。

- [ ] **Step 6: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/eng-notation && \
git add crates/ && git commit -m "$(cat <<'EOF'
Group the integer part in threes, and nothing else

小数部にも指数部にも入れない。data_scale の group_digits と見た目は同じだが
共通化しない——定義域も用途も違い、同じ見た目のものを 1 つにまとめると
片方の都合がもう片方に効く。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 工学表記を書く

**Files:**
- Modify: `crates/calcarc-core/src/numeric/format.rs`

**Interfaces:**
- Consumes: Task 1 の `group_integer_part`
- Produces: `pub fn format_real_eng(x: f64) -> String`。
  **`format_real` は変えない**——呼び分けは `render()` がする（Task 3）

設計書 §3（表）と §3.1（指数 0）と「有効数字」の節を読むこと。

- [ ] **Step 1: 失敗するテストを書く**

```rust
    #[test]
    fn engineering_notation_keeps_the_exponent_a_multiple_of_three() {
        assert_eq!(format_real_eng(1000.0), "1e3");
        assert_eq!(format_real_eng(12345.0), "12.345e3");
        assert_eq!(format_real_eng(0.0022), "2.2e-3");
        assert_eq!(format_real_eng(1500000.0), "1.5e6");
        assert_eq!(format_real_eng(1.5e11), "150e9"); // 仮数は 1000 未満
        assert_eq!(format_real_eng(0.0), "0");
        assert_eq!(format_real_eng(-1500000.0), "-1.5e6");
    }

    #[test]
    fn engineering_notation_omits_a_zero_exponent() {
        // **`999e0` とは書かない**(設計書 §3.1)。指数が 0 なら通常の 10 進。
        // つまり ENG に入れても見た目が変わらない値がある——それは仕様である。
        assert_eq!(format_real_eng(999.0), "999");
        assert_eq!(format_real_eng(1.5), "1.5");
        assert_eq!(format_real_eng(0.5), "500e-3"); // 1 未満は指数が付く
    }

    #[test]
    fn engineering_notation_decides_the_exponent_after_rounding() {
        // 先に指数を決めて丸めると 999.99999999e0 が 1000e0 になり、
        // 仮数の範囲(1 以上 1000 未満)を破る(設計書「有効数字」)。
        assert_eq!(format_real_eng(999.99999999), "1e3");
    }
```

- [ ] **Step 2: 赤を見る**（`format_real_eng` が無いのでコンパイルエラー）

- [ ] **Step 3: 実装する**

**`log10` を使わない。** `format_real` と同じ手——Rust の指数書式に有効数字 10 桁で
1 度整形させ、そこから指数を読む。**丸めた後の指数**が得られるので、繰り上がりを
先読みする必要が無い。

```rust
/// 工学表記。**指数は常に 3 の倍数**で、仮数は 1 以上 1000 未満(設計書 §3)。
///
/// `log10` を使わないのは `format_real` と同じ理由である——10 の冪の近くで
/// 1 桁ずれ、丸めの繰り上がりを先読みできない。**丸めた後の値から指数を決める。**
pub fn format_real_eng(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    let scientific = format!("{:.*e}", DISPLAY_DIGITS - 1, x);
    let (mantissa, exponent_text) = match scientific.split_once('e') {
        Some(parts) => parts,
        None => return scientific,
    };
    let exponent: i32 = exponent_text.parse().unwrap_or(0);
    // 3 の倍数へ**下向きに**丸める。-1 → -3、1 → 0、-4 → -6。
    let eng_exponent = exponent.div_euclid(3) * 3;
    let shift = exponent - eng_exponent; // 0, 1, 2 のいずれか
    // 仮数を 10^shift 倍する。小数点を動かすだけなので精度は落ちない。
    let value: f64 = mantissa.parse().unwrap_or(0.0) * 10f64.powi(shift);
    // 有効数字 10 桁から、整数部が使うぶんを引いた残りを小数に回す。
    let int_digits = shift + 1;
    let decimals = (DISPLAY_DIGITS as i32 - int_digits).max(0) as usize;
    let body = trim_zeros(&format!("{:.*}", decimals, value));
    if eng_exponent == 0 {
        // 指数 0 は書かない(設計書 §3.1)。通常の 10 進と同じ扱いにする。
        return group_integer_part(&body);
    }
    format!("{body}e{eng_exponent}")
}
```

**`div_euclid` を使うのは、負の指数で下向きに丸めるためである**——`-1 / 3` は Rust では
`0` だが `(-1).div_euclid(3)` は `-1` で、これが欲しい（`0.5` → `500e-3`）。

**`unwrap_or` で逃げているのは `calcarc-core` が panic しないため。** どちらも
到達しない（Rust の `LowerExp` は必ず `e` を含み、その両側は必ずパースできる）が、
契約として書く。

- [ ] **Step 4: 緑を見る + clippy + fmt**

- [ ] **Step 5: 赤確認**

**3 の倍数への丸めを外す**（`let eng_exponent = exponent;`）と
`12345` が `1.2345e4` になって赤。**編集で戻す**（`git checkout` を使わない）。

**指数 0 の分岐を外す**と `999` が `999e0` になって赤。同じく編集で戻す。

- [ ] **Step 6: コミット**（1 行目 `Write the engineering notation, rounding the exponent down to a multiple of three`）

---

### Task 3: ENG をモードとして持たせる

**Files:**
- Modify: `crates/calcarc-core/src/engine/state.rs`（`Notation`、`STATE_SCHEMA`）
- Modify: `crates/calcarc-core/src/engine/key.rs`（`Key::EngToggle`）
- Modify: `crates/calcarc-core/src/engine/mod.rs`（`reduce` の分岐）
- Modify: `crates/calcarc-core/src/engine/display.rs`（`render` と `DisplayState`）
- Modify: `crates/calcarc-core/tests/engine_table.rs`（**足す + カンマで変わる既存行を直す**）

**Interfaces:**
- Consumes: Task 2 の `format_real_eng`
- Produces: `EngineState.notation: Notation`（`Normal` / `Eng`）、
  `DisplayState.notation`、`Key::EngToggle`（トークン `eng`）、`STATE_SCHEMA = 5`

設計書 §4 §6 を読むこと。

- [ ] **Step 1: `engine_table.rs` に行を足す（先に。CLAUDE.md の規律）**

**「キー列と表示の対応を先に変えてから実装を直す」**——このリポジトリの規律である。

```rust
#[test]
fn eng_turns_the_answer_into_engineering_notation() {
    // 1000 を作って ENG を押す。もう一度押すと戻る(設計書 §1 の裁定 1)。
    assert_eq!(main_of(&["1", "0", "0", "0", "eq"]), "1,000");
    assert_eq!(main_of(&["1", "0", "0", "0", "eq", "eng"]), "1e3");
    assert_eq!(main_of(&["1", "0", "0", "0", "eq", "eng", "eng"]), "1,000");
}

#[test]
fn eng_stays_on_for_the_next_answer() {
    // **モードとして残る**——一度押したら以後の計算結果も ENG で出る。
    assert_eq!(main_of(&["eng", "1", "2", "3", "4", "5", "eq"]), "12.345e3");
}

#[test]
fn eng_does_not_touch_what_you_are_typing() {
    // 入力中は buffer.text() の経路で、format_real を通らない(設計書 §3.2)。
    // ENG に入れても打っている数字はそのまま見える。
    assert_eq!(main_of(&["eng", "1", "2", "3", "4", "5"]), "12345");
}
```

**既存の行は 1 つも書き換えない。**

- [ ] **Step 2: 赤を見る**（`eng` が未知のトークンなので、押しても何も起きず落ちる）

- [ ] **Step 3: 実装する**

`state.rs`:

```rust
/// 表示の記法。`AngleMode` や `DisplayForm` と同じ**表示の状態**である(設計書 §4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Notation {
    Normal,
    Eng,
}

impl Notation {
    pub fn toggled(self) -> Notation {
        match self {
            Notation::Normal => Notation::Eng,
            Notation::Eng => Notation::Normal,
        }
    }
}
```

`EngineState` に `pub notation: Notation` を足し、`initial()` で `Normal`。
**`STATE_SCHEMA` を `4` → `5` に上げる**（設計書 §4）。

`key.rs`: `Key::EngToggle` と `from_token` に `"eng" => Key::EngToggle`。

`mod.rs`: `Key::EngToggle => state.notation = state.notation.toggled(),`
——**`commit_entry` を呼ばない**。表示の切り替えであって計算ではない
（`Key::AngleToggle` と `Key::PolarToggle` がどうしているかを見て合わせること）。

`display.rs`: `format_rect` / `format_polar` に記法を渡すか、`render` の側で
呼び分ける。**`DisplayState` に `notation` を足す**（インジケータのため）。

**極形式の角度には ENG を掛けない**（設計書 §6、裁定 7）——`format_polar` は
半径にだけ通す。

- [ ] **Step 4: 緑を見る + clippy + fmt + `cargo test --workspace`**

**`STATE_SCHEMA` を上げたので、スキーマを見ているテストが落ちうる。** 落ちた件数と
内容を報告に控える。

- [ ] **Step 5: 赤確認**

`Key::EngToggle` の分岐で `commit_entry` を呼ぶようにすると、
`eng_does_not_touch_what_you_are_typing` が赤になる（入力が確定してしまう）。
**編集で戻す。**

- [ ] **Step 6: コミット**（1 行目 `Let ENG ride along with the angle and the form`）

---

### Task 4: WASM 境界

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`

**Interfaces:**
- Consumes: Task 3 の `DisplayState.notation`
- Produces: 境界の JSON に `notation` が出る（camelCase の対象外——1 語なので `notation`）

- [ ] **Step 1**: `DisplayState` は `calcarc-core` の型をそのまま serialize しているはず
  なので、**確認して、そうなら変更不要**。そうでなければ足す。**確認結果を報告に書く**
- [ ] **Step 2**: `wasm-pack test --headless --firefox crates/calcarc-wasm`
  （手元に chromedriver が無い。CI は chrome 固定なので**報告に書く**）
- [ ] **Step 3**: コミット（変更が無ければコミットしない。**その旨を報告に書く**）

---

### Task 5: TS の型とインジケータ

**Files:**
- Modify: `web/src/calc/types.ts`
- Modify: `web/src/ui/Display/Display.tsx`
- Modify: `web/src/ui/Display/Display.test.tsx`

**Interfaces:**
- Consumes: Task 4 の境界
- Produces: `KEY_TOKENS` に `"eng"`、`DisplayState.notation: Notation`、
  画面の status 行に `ENG` が出る

- [ ] **Step 1: 型を足す**

```ts
/** calcarc-core の engine::state::Notation に対応。 */
export type Notation = "Normal" | "Eng";
```

`KEY_TOKENS` の**末尾に** `"eng"` を足す（**既存の綴りを 1 文字も変えない**）。
`DisplayState` に `notation: Notation` を足す。

- [ ] **Step 2: インジケータを足す**

`Display.tsx` の `status` 配列に 1 つ足す。**`display-angle` の隣**——
同類（表示の状態）が並ぶ。

```tsx
        {
          testId: "display-notation",
          ariaLabel: "数の表記",
          text: display.notation === "Eng" ? "ENG" : "",
          live: "polite",
        },
```

**`ENG` が入っていないときは空文字**——`DEG`/`RAD` と違い、既定に名前を出さない
（`form` の `∠` と同じ流儀）。

- [ ] **Step 3**: `pnpm wasm && pnpm typecheck && pnpm lint && pnpm test`
- [ ] **Step 4**: コミット

---

### Task 6: 関数列を 2 段にする

**Files:**
- Modify: `web/src/ui/Keypad/scientific.ts`
- Modify: `web/src/ui/Keypad/scientific.test.ts`

**Interfaces:**
- Consumes: Task 5 の `"eng"` トークン
- Produces: 関数列が 2 区画になる。2 段目は `ENG` + 予約スロット 6 つ

設計書 §7.2 §7.3 を読むこと。

- [ ] **Step 1: 2 段目を足す**

```ts
/**
 * 関数列の 2 段目。**横に 8 列へ広げると 44px を割る**ので縦に増やした
 * (設計書 §7.1: 390px で 8 列は 38.75px)。キー幅は 45.43px のまま。
 *
 * ENG 以外は**予約スロット**である。S-1(実数の関数)と S-4(60 進)が埋める。
 * 格子の形を崩さないために置く——Finance の周期・税の面と同じ形。
 */
const FUNCTIONS_SECOND: KeypadSection<KeyToken> = {
  ariaLabel: "関数キー 2 段目",
  columns: 7,
  height: "half",
  keys: [
    { token: "eng", label: "ENG", ariaLabel: "工学表記に切り替え", variant: "function" },
    ...Array.from({ length: 6 }, () => ({
      token: null,
      label: "—",
      ariaLabel: "空き",
      variant: "function" as const,
    })),
  ],
};
```

**1 段目の `ariaLabel`（`"関数キー"`）を変えない**——E2E のセレクタである。
2 段目には**別の名前**を付ける（区画名が重複すると引けなくなる）。

`SCIENTIFIC_SECTIONS` の配列に、1 段目の**直後**に差し込む。

- [ ] **Step 2: テストを足す**

```ts
it("puts ENG on the first face, not behind Shift", () => {
  // 「押しやすくしたい」(ユーザー)——Shift の裏では要件を満たさない。
  const second = SCIENTIFIC_SECTIONS.find((s) => s.ariaLabel === "関数キー 2 段目");
  expect(second?.columns).toBe(7);
  expect(second?.height).toBe("half");
  expect(second?.keys[0]?.token).toBe("eng");
  // 残りは予約スロット。S-1 と S-4 が埋める。
  expect(second?.keys.slice(1).every((k) => k.token === null)).toBe(true);
});

it("does not move the main grid", () => {
  // **3 タブで揃えた 5×5**。ここを崩すと Finance / Data Scale と食い違う。
  const pad = SCIENTIFIC_SECTIONS.find((s) => s.ariaLabel === "数字と演算のキー");
  expect(pad?.columns).toBe(5);
  expect(pad?.keys).toHaveLength(25);
});
```

- [ ] **Step 3**: `pnpm typecheck && pnpm lint && pnpm test`
- [ ] **Step 4: スクリーンショット**

**390×844 で撮る。** 確かめること:

- **関数列 2 段が入り、盤面全体が 844px に収まっているか**（実測値を報告に書く）
- キー幅が **45.43px のまま**か
- `AC`/`DEL` の位置が 3 タブで揃ったままか
- 予約スロット 6 つが「押せない」ように見えるか

**収まらなければ止めて報告する**（設計書 §7.2 が「要実測」と書いている箇所）。
**撮ったら preview を落とす。**

- [ ] **Step 5**: コミット

---

### Task 7: E2E

**Files:**
- Create: `web/tests/e2e/eng-notation.spec.ts`

**Interfaces:**
- Consumes: Task 6 の盤面
- Produces: なし

- [ ] **Step 1: ユーザーの言葉をそのまま 1 本にする**

```ts
test("toggles 1000 to 1e3 and back", async ({ page }) => {
  // **ユーザーの言葉そのもの**: 「1000 → 1e3、1e3 → 1000 に戻すというトグル」
});

test("keeps engineering notation for the next answer", async ({ page }) => {
  // モードとして残る(裁定 1)。
});

test("shows the thousands separators by default", async ({ page }) => {
  // カンマは既定。ENG を押していない状態で 1,234,567 と出る。
});
```

**中身は実装者が書く。** 既存の `entry.spec.ts` の書き方に合わせ、
**押した結果を見る**こと。

- [ ] **Step 2**: `pnpm e2e`（**87 + 3 = 90** を期待。実測を報告に書く）
- [ ] **Step 3**: コミット

---

### Task 8: 文書と申し送り

**Files:**
- Modify: `docs/numerical-policy.md`

**Interfaces:**
- Consumes: Task 1〜7
- Produces: なし

設計書 §8.1 §8.3 を読むこと。**ENG とカンマで書き方が非対称である。**

- [ ] **Step 1: 既定の規則の文を書き換える（カンマ）**

いまの「有効数字 10 桁 / `|x| >= 1e10` または `0 < |x| < 1e-9` で指数表記」に、
**3 桁カンマを既定として足す**。**これは既定の変更なので、既定の文の側に書く。**

- [ ] **Step 2: ENG は追記として書く**

**既定の文を書き換えない。** 「ENG が入っているときの規則」として別に書く。

**非対称の理由も書く**——他レイヤーがこの文書を変更の判定に使っているため。

- [ ] **Step 3: 入力中と確定後で規則が違うことを書く**

設計書 §3.2 の実測。**この事実がどこにも書かれていないせいで、他セッションが
実測時に文書を疑った。**

- [ ] **Step 4: コミット**

- [ ] **Step 5: 他セッションに伝える（完了条件）**

`feature/e2e-corpus` の担当セッションに、**入ったことと、実際の表示**を伝える。
**相手は私の文書ではなく実際の表示を見る**と言っているので、**文書ではなく
実測値を送る**こと。

---

### Task 9: フルスイープ

**Files:** なし（検証のみ）

- [ ] **Step 1**

```bash
cd /home/terapyon/dev/CalcArc
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check
wasm-pack test --headless --firefox crates/calcarc-wasm
cd reference && uv run --no-config pytest && uv run --no-config python scripts/generate.py
cd ../web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

- [ ] **Step 2**: `git status --short testdata/` が**無出力**（**計算に触っていないので
  golden は 1 行も動かないはず**。動いたら止めて報告する）
- [ ] **Step 3**: 各層の実測件数を報告に書く
- [ ] **Step 4**: 完了報告

## スコープ外

- ENG の段送り（押すたび指数を 3 ずらす）
- SI 接頭辞での表示
- 入力側の工学表記
- 有効数字の桁数を変えられるようにすること
- カンマの区切り文字を選べるようにすること
