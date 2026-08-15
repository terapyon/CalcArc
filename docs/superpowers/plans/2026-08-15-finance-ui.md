# Finance の盤面と式入力（A）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finance タブに複利を出し、盤面を Scientific に揃え、表示と入力の欠陥を直し、**有理数の式入力**を Data Scale と Finance に足す。

**Architecture:** 段 1〜3 でコア（`u128` 有界の有理数評価器）を Python 参照と golden 付きで作り、段 4 で盤面と表示を作り直す。**段 2 が段 3 より先**（base-spec §30）。

**Tech Stack:** Rust（`calcarc-core` に新モジュール `expr`）/ Python（`fractions.Fraction`）/ WASM 境界 / React。

**正本:** [`docs/superpowers/specs/2026-08-15-finance-ui-design.md`](../specs/2026-08-15-finance-ui-design.md)（ユーザー承認済み、2026-08-15。裁定 16 点）。

## Global Constraints

- **§49 のゲートを段順として守る。逆順を禁じる。** Rust を先に書くと Python が
  「Rust の答を再現するもの」に堕ちて独立性が消える。
- **有理数は `u128` 有界。中間があふれたら `Overflow`**（spec §8 の角）。
  多倍長クレートも自前実装も入れない。`calcarc-core` の依存は `serde` だけ。
- **約分は正しさの一部**（最適化ではない）。各演算のあとに必ず約分する。
- **丸めは着地の 1 回だけ**、向きは floor。
- `uv` は **`--no-config`**（既知の罠）。
- 分岐元は **B の HEAD（`refactor/loan-under-finance` の `d4b2466`）**。
  ブランチ名 `feature/finance-ui`。B が先に main へ入るなら main から。
  コミットはブランチガード付き。**`git push` と PR 作成は行わない。**
  Co-Authored-By を付ける。
- ベースライン（B 完了時点）: Rust 203 / wasm 20 / vitest 137 / e2e 82 /
  Python 39 / golden 53 件。
- **段の切れ目で中間報告**（spec §1）。段 2 完了・段 3 完了・段 4 完了の 3 点で
  コミット SHA を報告し、レビューを受けてから次の段に入る。

## この plan が決める 2 点（spec からは一意に決まらない。**レビュー対象**）

### (1) 単位は **UI 層で展開**し、コアには数字と演算子だけを渡す

spec §8 の文法は `数 := 位取り入力（単位は数の後置修飾）` と書いている。
**これを「コアが単位を解釈する」と読むと、単位表が TS と Rust の 2 か所に
できる**——`KEY_TOKENS` と `Key::ALL` の二重管理で一度踏んだ形である
（未知トークンが黙って no-op になる、という事故）。

**したがって UI が展開する。** コアが受け取るのは
`"30000000+500000"`——数字と `+ - * / ( )` だけである。

- `100万 + 50万` → UI が `"1000000+500000"` にして渡す。
- **意味論は spec と同じ**（単位は項ごとに効く）。展開は**厳密**であって
  丸めた表示値の還流ではない（base-spec §26 に触れない）。
- **単位表は TS の 1 か所**（`web/src/units/`）に残る。
- 期間の `年`/`月`、複利の周期依存 scale も同じ経路で展開される。

### (2) 符号は**分子の隣に持つ**（`i128` にしない）

spec §8 は「分母は常に正、符号は分子が持つ」と書く。素直に読むと `i128` だが、
**`i128::MAX ≈ 1.7e38` は u128 の定義域（3.4e38）を覆えない**——Data Scale の
39 桁の件数が式に入れられなくなる。

```rust
pub struct Rational {
    negative: bool,
    num: u128,   // 大きさ。0 のとき negative は false に正規化する
    den: u128,   // 常に 1 以上
}
```

**負の中間値は許す**（`(500 − 1000) + 2000` は 1500）。**着地で負なら
`SyntaxError`**——金額も件数も期間も符号なしの定義域だからである。

---

# 段 1: 数値方針（ゲートの最初）

### Task 1: 式の意味論を `numerical-policy.md` に書く

**Files:**
- Modify: `docs/numerical-policy.md`

**Interfaces:**
- Consumes: なし
- Produces: 以降の全タスクが従う契約。**Python と Rust の両方がここを参照する。**

- [ ] **Step 1: 「式は有理数で評価し、着地で 1 回だけ丸める」節を書く**

最低限これだけは書く:

```markdown
## 式は有理数で評価し、着地で 1 回だけ丸める

金額・件数・期間・年利の入力欄では四則演算が打てる。**評価は既約分数で行い、
丸めるのは項目に着地させる 1 回だけ**である。

    100万 ÷ 3 × 3   → 1000000/1  → 1,000,000
    100万 ÷ 3       → 1000000/3  →   333,333（floor）
    年利 1.5 + 0.25 →  175/100   → 1.75

各演算で丸める方式（実物の電卓の多く）は採らない——`100万 ÷ 3 × 3` が
999,999 になり、**打つ順序で答えが変わる**（結合則が壊れる）。

**評価器は 1 つで、着地が項目ごとに違う。**

| 項目 | 定義域 | 着地 |
|---|---|---|
| 金額 | u64 円 | floor。負・超過は SyntaxError / Overflow |
| 件数・次元数 | u128 | floor |
| 期間 | u32 かつ ≤1200 | floor |
| 年利 | 小数 4 桁以内・0〜100% | **4 桁に収まらなければ SyntaxError** |

年利の 4 桁は新しい規則ではない。`1.23456` は入口で拒否されるので、
**計算で出た値にも同じ線を引く**——`1 ÷ 3` % は表せないので拒否する。

### 分子・分母は u128 で有界

Rust の標準ライブラリに多倍長整数は無い。多倍長のクレートを足す案も自前で
書く案も採らない——**依存ゼロと実装の小ささを優先する**。

**分子か分母が u128 に収まらなくなった時点で Overflow を返す。** その結果、
**数学的には定義域に戻る式もエラーになる**:

    39桁 ÷ 3        → OK
    100万 ÷ 3 × 3   → OK（約分で分母が消える）
    39桁 × 2 ÷ 2    → Overflow（× の時点で分子があふれる）

実用の式はすべて収まる。u128 の端に張り付いた値をさらに掛ける場合だけが
外れるので、そこを通すために多倍長を抱えない。

**約分は最適化ではなく正しさの一部である。** `100万 ÷ 3 × 3` が通るのは
約分で分母の 3 が消えるからで、約分をやめると予期しない Overflow になる。

### 単位は UI が展開する

`3000万` は UI 層で `30000000` に展開してからコアへ渡す。単位表を TS と Rust に
二重に持たないためで、展開は厳密なので §26（丸めた表示値を入力に還流させない）
には触れない。
```

- [ ] **Step 2: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-ui || exit 1
git add docs/numerical-policy.md && git commit
```

---

# 段 2: Python 参照と golden（**Rust より先**）

### Task 2: Python の有理数評価器

**Files:**
- Create: `reference/src/calcarc_reference/expr_ref.py`
- Create: `reference/tests/test_expr_ref.py`

**Interfaces:**
- Consumes: Task 1 の方針
- Produces: `expr_ref.compute(op, params) -> dict`。
  op は `expr_integer`（金額・件数・期間）と `expr_percent`（年利）の 2 つ。
  入力: `text`（式）・`max`（整数の上限。`expr_integer` のみ）。
  出力: `value`（文字列）または `error`。

- [ ] **Step 1: 参照実装を書く**

```python
"""式入力の参照実装（設計書 2026-08-15 §8）。

**独立軸**: Rust は u128 有界の有理数を自前で実装する。こちらは標準ライブラリの
`fractions.Fraction`（多倍長）を使う——base-spec §30 の「既存の数学ライブラリや
別手法を利用する」にそのまま当たる。

**ただし u128 の有界性は共有の契約である。** Fraction は多倍長なので放って
おくと Rust が出せない答を出す。**各演算のあとに分子・分母が u128 に収まるかを
検査**し、超えたら Overflow にする。ここを入れないと golden が
「Rust では出せない答」を持つ。

共有する公開契約:
1. 優先順位（× ÷ が先）と左結合。
2. 丸めは着地の 1 回だけ、向きは floor。
3. 中間値も u128 に収まること。
4. 各項目の定義域と、超えたときのエラー種別。
"""

from __future__ import annotations

from fractions import Fraction

U128_MAX = (1 << 128) - 1
PERCENT_SCALE = 10**4  # 年利は小数 4 桁まで


class ExprError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _guard(value: Fraction) -> Fraction:
    """u128 の有界性。**Rust と同じ範囲でしか答を出さない。**"""
    if abs(value.numerator) > U128_MAX or value.denominator > U128_MAX:
        raise ExprError("Overflow")
    return value


def tokenize(text: str) -> list[str]:
    """数字列と + - * / ( ) だけを受ける。単位は UI が展開済み。"""
    tokens: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isdigit():
            start = index
            while index < len(text) and text[index].isdigit():
                index += 1
            tokens.append(text[start:index])
            continue
        if char in "+-*/()":
            tokens.append(char)
            index += 1
            continue
        if char == ".":
            # 年利の小数点。数字列の一部として拾う。
            start = index
            index += 1
            while index < len(text) and text[index].isdigit():
                index += 1
            if tokens and tokens[-1].replace(".", "").isdigit():
                tokens[-1] += text[start:index]
                continue
            raise ExprError("SyntaxError")
        raise ExprError("SyntaxError")
    return tokens


class _Parser:
    """再帰下降。式 := 項 (("+"|"-") 項)*、項 := 因子 (("*"|"/") 因子)*。"""

    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.at = 0

    def peek(self) -> str | None:
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise ExprError("SyntaxError")
        self.at += 1
        return token

    def expression(self) -> Fraction:
        value = self.term()
        while self.peek() in ("+", "-"):
            operator = self.take()
            right = self.term()
            value = _guard(value + right if operator == "+" else value - right)
        return value

    def term(self) -> Fraction:
        value = self.factor()
        while self.peek() in ("*", "/"):
            operator = self.take()
            right = self.factor()
            if operator == "/":
                if right == 0:
                    raise ExprError("DivisionByZero")
                value = _guard(value / right)
            else:
                value = _guard(value * right)
        return value

    def factor(self) -> Fraction:
        token = self.take()
        if token == "(":
            value = self.expression()
            if self.take() != ")":
                raise ExprError("SyntaxError")
            return value
        if token in "+-*/)":
            raise ExprError("SyntaxError")
        try:
            return _guard(Fraction(token))
        except (ValueError, ZeroDivisionError) as error:
            raise ExprError("SyntaxError") from error


def evaluate(text: str) -> Fraction:
    if text == "":
        raise ExprError("SyntaxError")
    parser = _Parser(tokenize(text))
    value = parser.expression()
    if parser.peek() is not None:
        raise ExprError("SyntaxError")
    return value


def land_integer(value: Fraction, maximum: int) -> int:
    """floor して整数へ。負と上限超は弾く。"""
    if value < 0:
        raise ExprError("SyntaxError")
    landed = value.numerator // value.denominator
    if landed > maximum:
        raise ExprError("Overflow")
    return landed


def land_percent(value: Fraction) -> str:
    """年利へ。小数 4 桁に収まらなければ拒否する。"""
    if value < 0 or value > 100:
        raise ExprError("SyntaxError")
    scaled = value * PERCENT_SCALE
    if scaled.denominator != 1:
        raise ExprError("SyntaxError")  # 4 桁で表せない
    text = f"{int(scaled) / PERCENT_SCALE:.4f}".rstrip("0").rstrip(".")
    return text or "0"


def compute(op: str, params: dict) -> dict:
    try:
        value = evaluate(params["text"])
        if op == "expr_integer":
            return {"value": str(land_integer(value, int(params["max"])))}
        if op == "expr_percent":
            return {"value": land_percent(value)}
        raise ValueError(f"unknown op {op}")
    except ExprError as error:
        return {"error": error.code}
```

- [ ] **Step 2: テストを書いて回す**

```python
import pytest

from calcarc_reference import expr_ref
from fractions import Fraction


def test_rounding_happens_once_at_the_landing():
    # 各演算で丸めるなら 999999 になる。ここが方式の分かれ目である。
    value = expr_ref.evaluate("1000000/3*3")
    assert expr_ref.land_integer(value, 2**64 - 1) == 1_000_000
    assert expr_ref.land_integer(expr_ref.evaluate("1000000/3"), 2**64 - 1) == 333_333


def test_precedence_and_parentheses():
    assert expr_ref.evaluate("3000+500*2") == Fraction(4000)
    assert expr_ref.evaluate("(3000+500)*2") == Fraction(7000)


def test_intermediate_overflow_is_an_error():
    # 数学的には定義域へ戻るが、u128 を超えた時点で落とす（設計書 §8 の角）。
    huge = str((1 << 128) - 1)
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate(f"{huge}*2/2")
    assert error.value.code == "Overflow"


def test_the_guard_has_teeth():
    # 番人に判別力があること。u128 ちょうどは通り、1 つ超えると落ちる。
    assert expr_ref._guard(Fraction((1 << 128) - 1)) is not None
    with pytest.raises(expr_ref.ExprError):
        expr_ref._guard(Fraction(1 << 128))


def test_division_by_zero():
    with pytest.raises(expr_ref.ExprError) as error:
        expr_ref.evaluate("100/0")
    assert error.value.code == "DivisionByZero"


def test_percent_landing_keeps_four_digits():
    assert expr_ref.land_percent(expr_ref.evaluate("1.5+0.25")) == "1.75"
    with pytest.raises(expr_ref.ExprError):
        expr_ref.land_percent(expr_ref.evaluate("1/3"))


def test_negative_intermediates_are_allowed_but_not_landings():
    assert expr_ref.evaluate("(500-1000)+2000") == Fraction(1500)
    with pytest.raises(expr_ref.ExprError):
        expr_ref.land_integer(expr_ref.evaluate("500-1000"), 2**64 - 1)
```

Run: `cd reference && uv run --no-config pytest -q`
Expected: 39 + 7 = **46 passed**。

- [ ] **Step 3: コミット**

---

### Task 3: golden のケース表と生成

**Files:**
- Modify: `reference/src/calcarc_reference/cases.py`（`EXPR_INPUTS`）
- Modify: `reference/scripts/generate.py`
- Modify: `testdata/finance.json`（生成物）

**Interfaces:**
- Consumes: Task 2
- Produces: `testdata/finance.json` に `expr_integer` / `expr_percent` のケース。

**置き場所の判断**: **`finance.json` に足す。** base-spec 855 行の 4 ファイル
列挙を動かさずに済み、tolerance なしの完全一致で既存と同じ流儀だからである。
式は Finance 専用ではない（Data Scale でも使う）が、**ファイルを増やすと
base-spec の記述に手が入る**——そちらの方が高い。

- [ ] **Step 1: ケース表を書く**

```python
U64_MAX_TEXT = str((1 << 64) - 1)
U128_MAX_TEXT = str((1 << 128) - 1)

EXPR_INPUTS: list[dict] = [
    # 丸めが着地の 1 回だけであることの証明。各演算で丸めるなら 999999。
    {"op": "expr_integer", "text": "1000000/3*3", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "1000000/3", "max": U64_MAX_TEXT},
    # 優先順位と括弧
    {"op": "expr_integer", "text": "3000+500*2", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "(3000+500)*2", "max": U64_MAX_TEXT},
    # 単位の同居（UI が展開したあとの形）
    {"op": "expr_integer", "text": "1000000+500000", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "160000000-5000000", "max": U64_MAX_TEXT},
    # u128 の定義域。f64 なら壊れる桁
    {"op": "expr_integer", "text": f"{U128_MAX_TEXT}/3", "max": U128_MAX_TEXT},
    # 着地の Overflow（u128 を超える）
    {"op": "expr_integer", "text": f"{U128_MAX_TEXT}*2", "max": U128_MAX_TEXT},
    # **中間の Overflow**。数学的には戻るが仕様としてエラー（設計書 §8 の角）
    {"op": "expr_integer", "text": f"{U128_MAX_TEXT}*2/2", "max": U128_MAX_TEXT},
    # 0 除算
    {"op": "expr_integer", "text": "100/0", "max": U64_MAX_TEXT},
    # 負の中間は許し、負の着地は拒む
    {"op": "expr_integer", "text": "(500-1000)+2000", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "500-1000", "max": U64_MAX_TEXT},
    # 期間の上限（1200 ちょうど / 超え）
    {"op": "expr_integer", "text": "100*12", "max": "1200"},
    {"op": "expr_integer", "text": "100*12+1", "max": "1200"},
    # 文法違反
    {"op": "expr_integer", "text": "3000+", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "(3000+500", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "", "max": U64_MAX_TEXT},
    # 年利（4 桁の線）
    {"op": "expr_percent", "text": "1.5+0.25"},
    {"op": "expr_percent", "text": "1/3"},
    {"op": "expr_percent", "text": "3*40"},
    {"op": "expr_percent", "text": "3*40+1"},
]
```

- [ ] **Step 2: `build_finance` に 3 つ目の表を足す**

`loan` / `compound` と同じ形で回す。**id の重複検査は 3 表を結合した後**。

- [ ] **Step 3: 生成して既存が動いていないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff testdata/finance.json | grep "^-" | grep -v "^---" | wc -l
```
Expected: **0**（追加のみ）。golden は 53 + 21 = **74 件**。

- [ ] **Step 4: Rust が赤であることを確かめる**

Run: `cargo test --test finance_golden`
Expected: **赤**（`unknown op expr_integer`）。これが段 3 の出発点である。

- [ ] **Step 5: コミット。ここで段 2 の中間報告**（SHA を報告してレビューを受ける）

---

# 段 3: Rust の評価器

### Task 4: `u128` 有界の有理数

**Files:**
- Create: `crates/calcarc-core/src/expr/rational.rs`
- Create: `crates/calcarc-core/src/expr/mod.rs`
- Modify: `crates/calcarc-core/src/lib.rs`（`pub mod expr;`）

**Interfaces:**
- Produces:
  ```rust
  pub struct Rational { negative: bool, num: u128, den: u128 }
  impl Rational {
      pub fn from_u128(value: u128) -> Rational;
      pub fn add(self, other: Rational) -> CalcResult<Rational>;
      pub fn sub(self, other: Rational) -> CalcResult<Rational>;
      pub fn mul(self, other: Rational) -> CalcResult<Rational>;
      pub fn div(self, other: Rational) -> CalcResult<Rational>;  // 0 割は DivisionByZero
      pub fn floor_to_u128(&self) -> CalcResult<u128>;            // 負は SyntaxError
      pub fn is_negative(&self) -> bool;
  }
  ```

- [ ] **Step 1: 実装する**

要点だけ:

```rust
/// 約分は**正しさの一部**である。u128 有界なので、約分しないと収まるはずの
/// 式が Overflow になる(numerical-policy)。
fn reduce(negative: bool, num: u128, den: u128) -> CalcResult<Rational> {
    if den == 0 {
        return Err(CalcError::DivisionByZero);
    }
    let g = gcd(num, den);
    let (num, den) = (num / g, den / g);
    Ok(Rational {
        negative: negative && num != 0, // 0 に符号を持たせない
        num,
        den,
    })
}

fn gcd(a: u128, b: u128) -> u128 {
    let (mut a, mut b) = (a, b);
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a.max(1)
}
```

**掛け算は「先に約分してから掛ける」**（`a/b × c/d` は `gcd(a,d)` と
`gcd(c,b)` で先に割る）。これをやらないと、収まるはずの式が中間であふれる。

足し算は `a/b + c/d = (ad ± cb)/(bd)`。**各積で `checked_mul`**、和で
`checked_add`——あふれたら `Overflow`。

- [ ] **Step 2: 単体テストを書く**

```rust
    #[test]
    fn reduction_keeps_expressions_inside_u128() {
        // 100万 ÷ 3 × 3。約分しなければ分母 3 が残り、× で分子が 300 万になる
        // ——ここでは収まるが、u128 の端では収まらない。約分が効いていること
        // 自体を、分母が 1 に戻ることで確かめる。
        let a = Rational::from_u128(1_000_000)
            .div(Rational::from_u128(3)).unwrap()
            .mul(Rational::from_u128(3)).unwrap();
        assert_eq!(a.floor_to_u128().unwrap(), 1_000_000);
    }

    #[test]
    fn an_intermediate_beyond_u128_is_an_error() {
        let huge = Rational::from_u128(u128::MAX);
        assert_eq!(huge.mul(Rational::from_u128(2)), Err(CalcError::Overflow));
    }

    #[test]
    fn the_full_u128_range_fits_because_the_sign_is_a_flag() {
        // i128 だったら u128::MAX が持てない(設計書の判断 (2))。
        assert_eq!(Rational::from_u128(u128::MAX).floor_to_u128().unwrap(), u128::MAX);
    }

    #[test]
    fn negatives_live_only_in_the_middle() {
        let v = Rational::from_u128(500).sub(Rational::from_u128(1000)).unwrap();
        assert!(v.is_negative());
        assert_eq!(v.floor_to_u128(), Err(CalcError::SyntaxError));
        assert_eq!(
            v.add(Rational::from_u128(2000)).unwrap().floor_to_u128().unwrap(),
            1500
        );
    }

    #[test]
    fn dividing_by_zero_is_its_own_error() {
        assert_eq!(
            Rational::from_u128(100).div(Rational::from_u128(0)),
            Err(CalcError::DivisionByZero)
        );
    }
```

- [ ] **Step 3: 緑を確認してコミット**

---

### Task 5: パーサと着地

**Files:**
- Create: `crates/calcarc-core/src/expr/parse.rs`
- Modify: `crates/calcarc-core/src/expr/mod.rs`

**Interfaces:**
- Consumes: Task 4
- Produces:
  ```rust
  /// 式を評価して整数へ着地させる。`maximum` は項目の上限。
  pub fn evaluate_to_integer(text: &str, maximum: u128) -> CalcResult<u128>;
  /// 式を評価して年利のパーセント文字列へ着地させる（小数 4 桁まで）。
  pub fn evaluate_to_percent(text: &str) -> CalcResult<String>;
  ```

- [ ] **Step 1: 再帰下降で書く**

Python 側（Task 2）と**同じ文法**だが、**実装は独立**である
（Python は `Fraction`、Rust は自前の `Rational`）。

`式 := 項 (("+"|"-") 項)*` / `項 := 因子 (("*"|"/") 因子)*` /
`因子 := 数 | "(" 式 ")"`。

**数は数字列（年利では小数点を含む）。** 小数は `1.75` → `175/100` として
`Rational` にする。

- [ ] **Step 2: 着地を書く**

```rust
pub fn evaluate_to_integer(text: &str, maximum: u128) -> CalcResult<u128> {
    let value = evaluate(text)?;
    let landed = value.floor_to_u128()?; // 負は SyntaxError
    if landed > maximum {
        return Err(CalcError::Overflow);
    }
    Ok(landed)
}
```

年利は `×10^4` して分母が 1 になるかを見る——**ならなければ 4 桁で表せない
ので `SyntaxError`**（`Rate::from_percent` が `1.23456` を拒むのと同じ線）。

- [ ] **Step 3: 単体テストと緑の確認、コミット**

---

### Task 6: golden の突き合わせと赤確認

**Files:**
- Modify: `crates/calcarc-core/tests/finance_golden.rs`

- [ ] **Step 1: `Input` に `text` / `max` を足し、2 つの op を配線する**

`compound_grow` と同じく**別関数で受ける**（入力の形が違う）。
`other => panic!("unknown op {other}")` は残す。

- [ ] **Step 2: 完全一致を確認する**

Run: `cargo test --test finance_golden`
Expected: PASS。**74 件**。

- [ ] **Step 3: 赤確認 4 種（実出力を貼る）**

| # | 変異 | 期待する赤 |
|---|---|---|
| 1 | 各演算のあとに floor する | `1000000/3*3` が 999,999 で赤 |
| 2 | `term()` を使わず全部左結合にする | `3000+500*2` が 7,000 で赤 |
| 3 | **約分をやめる** | `{u128最大}/3` などが `Overflow` になって赤 |
| 4 | 年利の 4 桁検査を外す | `1/3` が通ってしまい赤 |

**3 は u128 有界だからこそ効く**（多倍長なら「遅くなるだけ」で赤にならない
可能性があった）。**赤にならないものがあれば正直に報告し、等価な変異に
差し替える**（M6 の【訂正 2c】が先例）。

- [ ] **Step 4: コミット**

---

### Task 7: WASM 境界と TS ラッパー

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`
- Create: `web/src/expr/index.ts`、`web/src/expr/types.ts`

**Interfaces:**
- Produces:
  ```rust
  #[wasm_bindgen] pub fn expr_integer(text: &str, maximum: &str) -> JsValue;
  #[wasm_bindgen] pub fn expr_percent(text: &str) -> JsValue;
  ```
  戻り値は `{ value: string | null, error: CalcError | null }`。
  **例外は投げない**（境界の規約）。

- [ ] **Step 1〜3**: 既存 5 本の loan エクスポートと同じ形で書き、
  **wasm のテストを 4 本足す**（正常・中間 Overflow・0 除算・年利 4 桁）。
  `wasm-pack test`。Chrome が使えなければ `--firefox` に落とし報告に書く。

- [ ] **Step 4: コミット。ここで段 3 の中間報告**（SHA を報告してレビュー）

---

# 段 4: 盤面と表示

### Task 8: `Readout` を `entries[]` にする

**Files:**
- Modify: `web/src/ui/Readout/Readout.tsx`、`Readout.module.css`、`Readout.test.tsx`
- Modify: `web/src/ui/ScientificPanel.tsx`、`web/src/ui/Loan/LoanPanel.tsx`、
  `web/src/ui/DataScale/DataScalePanel.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface ReadoutEntry { label: string; value: string; active?: boolean }
  export interface ReadoutProps {
    entries: ReadoutEntry[];
    main: string;
    error?: string | null;
    status: ReadoutStatus[];
  }
  ```

- [ ] **Step 1: テストの期待値を先に書く**（赤を見る）

**Scientific は「名前なし 1 件」に落ちて見た目が変わらない**ことを検査で
固定する——ここが崩れると S2 のエコーが壊れる。

- [ ] **Step 2: 実装する。** アクティブは `--key-font-size` 級・`--display-fg`、
  入力済みは `--display-size-status` 級・`--display-status-fg`。
  **入力済みは折り返す**（`white-space: normal`。アクティブは `nowrap` のまま）。
- [ ] **Step 3: 緑を確認してコミット**

---

### Task 9: 盤面を 5 列にする

**Files:**
- Modify: `web/src/ui/Keypad/loan.ts`、`dataScale.ts` とそれぞれのテスト
- Modify: `web/tests/e2e/loan-keypad.spec.ts`、`data-scale-keypad.spec.ts`

- [ ] **Step 1: キー集合を 5×5 に書き直す**（spec §4 の絵のとおり）。
  `DEL`・`AC` を最上段の右 2 つへ。**予約スロットは `token: null`**
  （既存の機構）。**D の型面も 5 列**にし、`DEL`・`AC` を同じ位置に置く。
- [ ] **Step 2: 予約スロットが無効に見えることを computed style で固定する**
  （S1 の欠陥の再演防止）。
- [ ] **Step 3: 44px の検査を 3 タブで揃える**。E2E で
  **`AC`・`DEL` の座標が 3 タブで一致すること**を見る。
- [ ] **Step 4: 緑を確認してコミット**

---

### Task 10: `000` を直し、出口の検査を置く

**Files:**
- Modify: `web/src/ui/Loan/LoanPanel.tsx`
- Modify: `web/src/ui/Loan/LoanPanel.test.tsx`、`DataScalePanel.test.tsx`

- [ ] **Step 1: 出口の検査を先に書く**（両パネル）:
  `借入額` で `3` `000` → `3000円`、Data Scale の `件数` でも同じ。
  Run → **L が赤、D が緑**（D は実装が正しい）。
- [ ] **Step 2: ローカル畳み込みに直す**（D と同じ形）。
- [ ] **Step 3: `press` 全体を走査する**——**同じイベントで複数回状態を更新する
  経路が他に無いか**。見つけたら同じ形に直し、**見つからなければ「走査して
  無かった」と報告に書く**（黙って省かない）。
- [ ] **Step 4: 緑を確認してコミット**

---

### Task 11: 単位キーを項目に従わせる

**Files:**
- Modify: `web/src/units/entry.ts`（doc の訂正）、`web/src/loan/entry.ts`
- Modify: `web/src/ui/Keypad/loan.ts`、`web/src/ui/Loan/LoanPanel.tsx`

- [ ] **Step 1: 期間の単位表を足す**（`年 = 12n`、`月 = 1n`）。
  複利は周期に従う（`年 = 1 年あたりの期数`、下位 = `1`）。
- [ ] **Step 2: 5 列目のキーを項目で差し替える**（金額 → `万`/`億`、
  期間 → `年`/`月`、年利 → 予約スロット）。
- [ ] **Step 3: 合成後の値を検査する**（L の教訓）。
  `digits(entry)` が `u32` かつ ≤1200 に収まること。**赤確認**: 検査を外して
  `9999年9999` がもっともらしい答を出すことを見る。
- [ ] **Step 4: `units/entry.ts` の冒頭「期間はここを通らない」を訂正**
- [ ] **Step 5: 緑を確認してコミット**

---

### Task 12: 複利のモードと項目

**Files:**
- Modify: `web/src/ui/Keypad/loan.ts`（モード行を `計算の種類` に、4 キーへ）
- Modify: `web/src/ui/Loan/LoanPanel.tsx`
- Modify: `web/tests/e2e/loan.spec.ts`、`loan-keypad.spec.ts`（区画名の追随）

- [ ] **Step 1: 区画名を `求めるもの` → `計算の種類` に変え、E2E を追随させる**
  （最初にやる。後回しにすると全タスクで赤が出続ける）
- [ ] **Step 2: 複利モードの項目 6 つ**（元本・積立額・年利・期間・周期・税）。
  周期面（3 キー）と税面（2 キー）は **D のデータ型と同じ面の入れ替え**。
- [ ] **Step 3: 可否表とモード切替の退避**——`fieldEnabledIn(field, forMode)` に
  複利を足し、**ローン ⇄ 複利の切り替えでアクティブ項目が有効な先頭へ移る**
  ことを検査で固定する（L で踏んだバグの再演防止）。
- [ ] **Step 4: `web/src/finance/` のラッパーを繋ぐ**（F1 で作った `grow`）。
- [ ] **Step 5: 緑を確認してコミット**

---

### Task 13: 式を盤面に繋ぐ

**Files:**
- Modify: `web/src/units/entry.ts`（トークン列への一般化）
- Modify: 両パネル

**Interfaces:**
- Consumes: Task 7 の `expr_integer` / `expr_percent`
- Produces: 項目の入力がトークン列になる:
  ```ts
  export type InputToken =
    | { kind: "digits"; text: string }
    | { kind: "unit"; unit: Unit }
    | { kind: "op"; op: "+" | "-" | "*" | "/" }
    | { kind: "lparen" }
    | { kind: "rparen" };
  ```

- [ ] **Step 1: `Entry` をトークン列に一般化する。**
  **既存の `units/entry.test.ts` が 1 文字も変わらずに通ること**が
  無害性の証明である（D の引き上げと同じ流儀）。
- [ ] **Step 2: 表示と `source` を導く**——`text()` は打った通り
  （`3000万+50万`）、コアへ渡す `source` は**単位を展開した形**
  （`30000000+500000`。この plan の判断 (1)）。
- [ ] **Step 3: DEL は 1 トークンぶん戻す**（数字は 1 文字、単位・演算子・
  括弧は 1 つ）。**単位の段規律の自然な拡張**である。
- [ ] **Step 4: `=` を繋ぐ**——アクティブ項目の式を評価して値にする。
  **式を打っている途中はモジュールの計算を走らせない**（中途半端な式から
  答を出さない）。エラーは `main` に `Math ERROR` + `data-error`。
- [ ] **Step 5: 演算キーの可否**——年利でも式が使える（裁定 Q14）ので、
  **演算キーは全項目で有効**。`(` `)` も同様。
- [ ] **Step 6: 緑を確認してコミット**

---

### Task 14: 結果表示・免責・税の注記

- [ ] **Step 1: 複利の結果領域**（元本合計・運用収益・税の 3 行）。
  `main` は**税ありなら手取り**（裁定 Q5）。
- [ ] **Step 2: 免責を複利にも掛かる文言に広げる。**
  **税を出すときは税務上の助言ではない旨を添える**（新規の文言）。
- [ ] **Step 3: 緑を確認してコミット**

---

### Task 15: フルスイープと実機確認

- [ ] **Step 1: 4173 を確かめてから全段を回す**（spec §11 のコマンド一式）。
- [ ] **Step 2: 390×844 のスクリーンショット**。見るもの:
  - 3 タブを並べて `AC`・`DEL` が同じ位置・数字が同じ寸法
  - 打っている項目が読める大きさか、**入力を 3〜5 項目入れて 44px を割らないか**
  - 項目を切り替えて**前の値が残っているか**
  - **予約スロットが無効に見えるか**
  - 面の入れ替え・単位の差し替えで**枠と他のキーが動かないか**
  - **Scientific が変わっていないこと**
- [ ] **Step 3: preview を落とし、`ss -ltn | grep 4173` で解放を確かめる**
  （`pkill` では落ちない。`fuser -k 4173/tcp` まで）。
- [ ] **Step 4: 完了報告**（段 4 の報告）。

---

# 完了条件

spec §13 の 12 項目をそのまま使う。加えてこの plan 固有:

- **段 2 のコミットが段 3 より前**にあること（`git log` で示す）。
- **`units/entry.test.ts` が 1 文字も変わっていない**こと（Task 13 の無害性）。
- **`testdata/finance.json` の既存 53 件が 1 行も動いていない**こと。

# 進捗の見取り図

| 段 | タスク | 成果物 | 検証段 |
|---|---|---|---|
| 1 | 1 | numerical-policy の式の節 | なし（文書） |
| 2 | 2–3 | Python 参照 + golden 21 件 | pytest + 生成 |
| 3 | 4–7 | 有理数・パーサ・golden 一致・境界 | cargo + wasm |
| 4 | 8–15 | 表示・盤面・`000`・単位・複利・式・仕上げ | web 段 |
