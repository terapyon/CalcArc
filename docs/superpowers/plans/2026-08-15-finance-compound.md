# 複利・資産形成（F1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一括預入と毎月積立の複利を、銀行方式（各期の利息を円未満切り捨てて元本組入）で計算するコアを足し、Python 独立実装と golden で検証する。

**Architecture:** 1 期の演算はローンと同じ `floor(残高 × 分子 / 分母)`。答は厳密整数ループが出し、f64 は使わない。Python は同じ契約で int ループを回して golden を作り、**Decimal 50 桁の閉形式が独立の番人として横に立つ**。

**Tech Stack:** Rust（`calcarc-core`）/ Python（Decimal）/ WASM 境界 / TypeScript ラッパー。**UI は含まない**（後述）。

**正本:** [`docs/superpowers/specs/2026-08-14-finance-compound-design.md`](../specs/2026-08-14-finance-compound-design.md)（ユーザー裁定済み、2026-08-15。Q5=一括+積立の両方 / Q6=銀行方式のみ / Q7=既定タックスフリー+オプション 20.315%）。

## Global Constraints

- **§1 のゲートを段順として守る。逆順を禁じる。**

  | 段 | タスク | 逆順にすると何が壊れるか |
  |---|---|---|
  | 1 | 数値方針（Task 1） | 方針が無いまま実装すると、実装が方針になる |
  | 2 | Python 参照 + golden（Task 3） | **Rust を先に書くと Python が「Rust の答を再現するもの」に堕ち、独立性が消える**（base-spec §30） |
  | 3 | Rust 実装（Task 4・5） | — |
  | 4 | 境界（Task 6） | — |

  Task 2（既存コードのリファクタ）は複利を 1 行も計算しないので、この段順の外に置く。

- **答は厳密整数ループが出す。複利の計算経路に f64 を入れない**（spec §3）。
  f64 が居てよいのは既存の loan の閉形式だけ。
- **税は国税 15.315% と地方税 5% を別々に切り捨てる**（`i·15315/100000` と `i·5/100`。
  どちらも整数演算で表せる）。合算 20.315% の 1 回切り捨てとは**結果が違う**。
- **`testdata/finance.json` に op を足す。新ファイルを作らない**（spec §9）。
  **既存 36 件の期待値が 1 件も動かないこと**が Task 2・4 の完了判定に入る。
- `uv` は **`--no-config`** を付ける（`exclude-newer` がロックに書かれ CI が落ちる罠）。
- 分岐元は **F0 の HEAD `c05328f`**。ブランチ名 `feature/finance-compound`。
  コミットはブランチガード付き
  （`test "$(git branch --show-current)" = feature/finance-compound || exit 1`）。
  **`git push` と PR 作成は行わない。** Co-Authored-By を付ける。
- ベースライン（F0 完了時点）: Rust 192 / wasm 16 / vitest 137 / e2e 82 / Python 30 /
  golden 36 件。

## この plan が spec を狭める 2 点（**Fable のレビュー対象**）

### (1) 月利換算は名目（`r ÷ 期/年`）のみ。実効換算は実装しない

spec §5 は「`r/12` と `(1+r)^(1/12)−1` の 2 方式を明示的に区別する」と書き、
§9 は「月利換算 2 方式の差を固定するケース」を golden に挙げていた。

**Q6=(A) 銀行方式の裁定と両立しない。** `(1+r)^(1/12)−1` は**有理数ではない**ので、
`Rate`（分子/分母の分数）で表せない。表そうとすれば f64 か Decimal を計算経路に
入れることになり、「答は厳密整数ループ」（spec §3）を破る。

**したがって実効換算はスコープ外にする。** spec §5 の記述は「2 方式が実在する」
という事実の記録として残し、**「実装するのは名目のみ。実効換算はシミュレータ方式
（Q6 の (B)/(C)）を入れるときに一緒に来る」**と読み替える。§9 の「換算 2 方式の
差を固定するケース」は golden から落とす。

**赤確認 4 種のうち「換算を他方に変える」も成立しない**ので、**「周期を取り違える
（月次を半年に）」に差し替える**（同じ「率の解釈を間違えたら赤くなるか」を見る）。

### (2) UI は含まない

spec §10 は「本 spec は計算コアと検証を主戦場とする。UI の詳細は実装 spec を
分ける」、§14-8 は「UI は §10 の方向のみ。盤面の詳細は別 spec」。
したがって本 plan は **WASM 境界と TS ラッパーまで**で終わる（Task 6）。

**境界まで作る判断の理由**: 後続の UI spec が「計算に触らず盤面だけに集中できる」
状態で始められる。境界は機械的で、既存 5 本の loan エクスポートと同じ型を持つ。
**ただし UI が無いあいだ TS ラッパーは呼び出し元を持たない**——これを承知のうえで
置く（`web/src/loan/index.ts` と同じ形なので、UI spec が import するだけで使える）。

---

### Task 1: 数値方針を書く（ゲート段 1）

**Files:**
- Modify: `docs/numerical-policy.md`（`## 第 3 の分類: Loan は決定的概算` の後ろに節を足す）

**Interfaces:**
- Consumes: なし
- Produces: 以降のタスクが従う契約。**特に「floor の根拠」の記述は Task 3・4 の
  コメントから参照される。**

- [ ] **Step 1: 「複利は同じ切り捨て、違う理由」節を書く**

`docs/numerical-policy.md` の第 3 の分類の節の直後に追加する。**最低限これだけは
書く**（spec §4/§14-1）:

```markdown
## 複利は同じ切り捨て、違う理由

Finance の複利（一括預入・毎月積立）も、1 期の利息を
floor(残高 × 分子 / 分母) で計算して元本に組み入れる。式はローンの各行利息と
同一で、`Rate::interest_floor` をそのまま使う。

**しかし切り捨てを選ぶ根拠が反転している。**

ローンでは切り捨ては**安全な向き**だった——月額が理論値を下回るぶん残高が
高めに残り、端数は最終回が吸収する。借主に不利な方向へは倒れない。

積立・預金では、各期の利息を切り捨てるのは**受取を減らす向き**であり、
利用者に不利である。「切り捨て = 安全」はここでは成り立たない。

**それでも切り捨てを採るのは、実際の金融機関が付利単位 1 円で切り捨てるから
である。**根拠が「安全な向き」から**「慣行の再現」**に変わる。同じ 1 語でも
理由が分野で違うことをここに残すのは、後から「利用者に不利だから直そう」と
いう誤った修正が入るのを防ぐためである。

### 丸めない方式は採らない

同じ入力に 2 つの正解がある。100 万円・年 1%・5 年・半年複利で:

| 方式 | 元利合計 | 税額 |
|---|---|---|
| 各期切り捨て（採用） | 1,051,136 円 | 10,387 円 |
| 途中丸めなし・最後に 1 回 | 1,051,140 円 | 10,389 円 |

**銀行の公開試算例と一致するのは後者である。**「銀行方式」は慣行の名前で
あって、特定の銀行の公開値の裏付けではない——ここを書いておかないと、
将来「銀行の例と合わない」という誤った修正を招く。

丸めない方式を採らないのは、答を出すのが f64 か Decimal になり、
「答は厳密整数」という上の規律を破るからである。

### 月利換算は名目のみ

年利 r の 1 期あたりの利率は **r ÷ 期/年**（月次なら r/12）とする。
実効換算 (1+r)^(1/12)−1 は**有理数ではない**ので分数の `Rate` で表せず、
厳密整数の経路に載らない。2 方式が実在することは
[F1 設計](superpowers/specs/2026-08-14-finance-compound-design.md) §5 に
記録があるが、実装は名目のみである。

### 税

源泉分離課税は**国税 15.315% と地方税 5% を別々に円未満切り捨てる**
（国税庁 No.1310）。`i·15315/100000` と `i·5/100` はどちらも整数演算で表せる。
**合算 20.315% を 1 回切り捨てるのとは結果が違う**——利息 2,648,906 円で
1 円ずれる（別: 405,679 + 132,445 = 538,124 / 合算: 538,125）。
```

- [ ] **Step 2: 既知の制約に 1 行足す**

`## 既知の制約` に、**閉形式との系統差**を書く（Task 3 の番人が測る値）:

```markdown
- **複利の厳密ループは閉形式より小さい。** 各期の切り捨てが積み上がるため。
  ずれは期数と率で決まり、上界は 期数 × (1+r)^期数 円。実測では
  月 3 万円・年 5%・50 年（600 期）で 1,290 円（上界 7,272 円）。
```

- [ ] **Step 3: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-compound || exit 1
git add docs/numerical-policy.md
git commit
```

---

### Task 2: `pow_1p` と `annuity` を抽出する（既存コードのリファクタ）

**Files:**
- Create: `crates/calcarc-core/src/loan/closed_form.rs` 内に private helper、または
  `crates/calcarc-core/src/loan/f64_math.rs`（配置は Step 1 で決める）
- Modify: `crates/calcarc-core/src/loan/closed_form.rs:42-47`
- Modify: `crates/calcarc-core/src/loan/inverse.rs:99-100`

**Interfaces:**
- Consumes: なし
- Produces: `pow_1p(r: f64, n: u32) -> f64`（= `(1+r)^n`）と
  `annuity(r: f64, n: u32) -> f64`（= `(1 − (1+r)^{−n})/r`）。
  **複利は使わない**（複利に f64 は入らない）。**このタスクは既存の重複を
  畳むためだけにある。**

- [ ] **Step 1: 重複を数え直す**

```bash
grep -rn "exp_m1\|ln_1p" crates/calcarc-core/src/loan/
```

Expected: `closed_form.rs` に 2 箇所（`x_n`・`x_m`）、`inverse.rs` に 3 箇所
（うち `:99` が `exp_m1(n·ln_1p(r))` の形、`:64` は期間逆算の別式）。
**`:64` は抽出対象外**——形が違う。

- [ ] **Step 2: 抽出する**

`closed_form.rs` に置き、`inverse.rs` から `use super::closed_form::{annuity, pow_1p};`
で参照する（新ファイルを作らない。両方とも「閉形式の f64 計算」で同じ主題）。

```rust
/// (1+r)^n。素朴な `powi` ではなく expm1/log1p 経由で評価する。
///
/// 素朴式 `(1+r)^n − 1` は低金利で桁落ちし、年 0.001% で ~1e-5 円まで
/// 悪化する(設計書 §1-3)。**この関数は f64 の弱点への対処であって、
/// 複利(厳密整数)からは呼ばれない。**
pub(super) fn pow_1p(r: f64, n: u32) -> f64 {
    f64::exp_m1(n as f64 * f64::ln_1p(r)) + 1.0
}

/// 年金現価 (1 − (1+r)^{−n})/r。r > 0 を前提とする(呼び出し側が 0 を弾く)。
pub(super) fn annuity(r: f64, n: u32) -> f64 {
    let x = pow_1p(r, n) - 1.0; // = expm1(n·log1p(r))
    (x / (x + 1.0)) / r
}
```

**`pow_1p` の中で `+1.0` してから `annuity` で `−1.0` する形は、意図的に
そのまま置く。** `expm1` の値そのものを返す関数（`expm1_pow`）を別に作ると
呼び出し側が 2 種類を取り違える。**桁落ちが起きるのは `1 − (1+r)^{−n}` の側
ではなく `(1+r)^n − 1` の側**で、そこは `x` として保持されている。

- [ ] **Step 3: 呼び出し側を置き換える**

`closed_form.rs`:

```rust
    let r = rate.as_f64_monthly();
    let pow_n = pow_1p(r, n); // (1+r)^n
    let annuity_m = annuity(r, if residual == 0 { n } else { n - 1 });
    let pv = principal as f64 - residual as f64 / pow_n;
```

`inverse.rs:97-101`:

```rust
        let r = rate.as_f64_monthly();
        let candidate = payment as f64 * annuity(r, n);
```

- [ ] **Step 4: 無害性を証明する**

```bash
cargo test --workspace
git diff --stat -- testdata/
```

Expected: **Rust 192 passed（増減なし）**、`testdata/` の差分は**空**。

さらに **golden 36 件が 1 件も動いていないこと**を明示的に確かめる:

```bash
cargo test --test finance_golden -- --nocapture
cd reference && uv run --no-config python scripts/generate.py
git diff --stat -- testdata/finance.json
```

Expected: 再生成しても差分ゼロ。**これがリファクタの無害性の証明である**
——f64 の評価順序が変わると最下位ビットが動きうるので、「コンパイルが通った」
では足りない。

- [ ] **Step 5: 赤確認**

`pow_1p` を `(1.0 + r).powi(n as i32)` に変えて `cargo test --workspace` を回す。

Expected: **年 0.001% のテスト（`a_very_low_rate_still_lands_on_the_schedule`）
か golden が赤になる。** 赤にならなければ、この抽出で守っているものが
テストに写っていないということなので、**その事実を報告する**（M6 の【訂正 2c】
と同じ扱い。多層防御が効いている場合もある）。確認したら戻す。

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-compound || exit 1
git add crates/calcarc-core/src/loan/closed_form.rs crates/calcarc-core/src/loan/inverse.rs
git commit
```

---

### Task 3: Python 参照実装と golden（ゲート段 2）

**Files:**
- Create: `reference/src/calcarc_reference/compound_ref.py`
- Create: `reference/tests/test_compound_ref.py`
- Modify: `reference/src/calcarc_reference/cases.py`（`COMPOUND_INPUTS` を足す）
- Modify: `reference/scripts/generate.py`（`build_finance` が 2 つの表を回す）

**Interfaces:**
- Consumes: Task 1 の数値方針
- Produces: `compound_ref.compute(op, params) -> dict`。
  op は **`compound_grow` の 1 つだけ**（一括は積立額 0、積立は元本 0 の退化として
  同じ関数に載る。spec §2 の (c)）。
  入力: `principal` / `deposit` / `rate` / `periods_per_year` / `periods` / `tax`。
  出力: `final_balance` / `principal_total` / `interest`、`tax` が真なら
  `national_tax` / `local_tax` / `net`。**金額はすべて文字列**（u64 は JSON number の
  2^53 を超える）。

- [ ] **Step 1: 参照実装を書く**

`reference/src/calcarc_reference/compound_ref.py`:

```python
"""複利・積立の参照実装（設計書 2026-08-14 §8）。

**独立軸**: 期待値は厳密な int ループが出す（Rust と同じ丸め契約）が、
**Decimal 50 桁の閉形式が横で番人をする**——P(1+r)^n + m((1+r)^n − 1)/r を
評価し、int ループとのずれが 0 以上 期数×(1+r)^期数 以下であることを毎回
確かめる。ずれの向きは常に一方向（切り捨ての積み上がりで閉形式より小さい）
なので、符号の反転はバグの兆候である。

**共有する公開契約**（アルゴリズムの共有ではなく、base-spec §37 型の契約）:

1. 1 期の利息 = `balance * num // den`（厳密整数、円未満切り捨て、元本組入）。
2. 積立は**期末**（利息を付けてから足す）。
3. 年利 → 1 期の利率は **名目**（分母に期/年を掛ける）。実効換算は使わない。
4. 税は国税 15.315% と地方税 5% を**別々に**切り捨て、課税対象は利息。
5. 金額は u64 の定義域。超えたら Overflow。
"""

from __future__ import annotations

from decimal import Decimal, localcontext

PRECISION = 50
U64_MAX = (1 << 64) - 1
MAX_PERIODS = 1200          # loan の MAX_TERM_MONTHS と同じ上限
PERIODS_PER_YEAR = (1, 2, 12)

NATIONAL_TAX_NUM, NATIONAL_TAX_DEN = 15315, 100_000   # 15.315%
LOCAL_TAX_NUM, LOCAL_TAX_DEN = 5, 100                 # 5%


class CompoundError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def rate_fraction(percent: str, periods_per_year: int) -> tuple[int, int]:
    """年利のパーセント文字列 → 1 期の利率の分数。約分しない。

    loan の rate_fraction は分母に 12 を固定で掛ける。ここはそれを
    パラメータにしただけで、桁の扱いは同じである。
    """
    if periods_per_year not in PERIODS_PER_YEAR:
        raise CompoundError("SyntaxError")
    integer, _, fraction = percent.partition(".")
    if not integer and not fraction:
        raise CompoundError("SyntaxError")
    if len(fraction) > 4 or not (integer + fraction).isdigit():
        raise CompoundError("SyntaxError")
    scale = 10 ** len(fraction)
    numerator = int(integer or 0) * scale + int(fraction or 0)
    if numerator > 100 * scale:
        raise CompoundError("SyntaxError")
    return numerator, scale * 100 * periods_per_year


def grow(principal: int, deposit: int, num: int, den: int, periods: int) -> int:
    """厳密整数で期を回す。答はこれが出す。"""
    if periods <= 0 or periods > MAX_PERIODS:
        raise CompoundError("SyntaxError")
    if principal == 0 and deposit == 0:
        raise CompoundError("SyntaxError")
    balance = principal
    for _ in range(periods):
        balance += balance * num // den      # 期末までの利息、円未満切り捨て
        balance += deposit                   # 積立は期末（設計書 §5）
        if balance > U64_MAX:
            raise CompoundError("Overflow")
    return balance


def closed_form(principal: int, deposit: int, num: int, den: int, periods: int) -> Decimal:
    """番人。Decimal 50 桁で素直に評価する（int ループの式変形は写さない）。"""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        growth = (1 + r) ** periods
        if r == 0:
            return Decimal(principal) + Decimal(deposit) * periods
        return Decimal(principal) * growth + Decimal(deposit) * (growth - 1) / r


def check_against_closed_form(
    exact: int, principal: int, deposit: int, num: int, den: int, periods: int
) -> None:
    """ずれが向きと上界の中に居ることを確かめる。"""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        expected = closed_form(principal, deposit, num, den, periods)
        drift = expected - Decimal(exact)
        r = Decimal(num) / Decimal(den)
        bound = Decimal(periods) * (1 + r) ** periods
        if not (0 <= drift <= bound):
            raise ValueError(
                f"閉形式とのずれが範囲外: {drift} (上界 {bound})"
            )


def withholding_tax(interest: int) -> tuple[int, int]:
    """国税と地方税を**別々に**切り捨てる（国税庁 No.1310）。"""
    national = interest * NATIONAL_TAX_NUM // NATIONAL_TAX_DEN
    local = interest * LOCAL_TAX_NUM // LOCAL_TAX_DEN
    return national, local


def compute(op: str, params: dict) -> dict:
    if op != "compound_grow":
        raise ValueError(f"unknown op {op}")
    try:
        principal = int(params["principal"])
        deposit = int(params["deposit"])
        periods = params["periods"]
        num, den = rate_fraction(params["rate"], params["periods_per_year"])
        final = grow(principal, deposit, num, den, periods)
        check_against_closed_form(final, principal, deposit, num, den, periods)
        principal_total = principal + deposit * periods
        interest = final - principal_total
        result = {
            "final_balance": str(final),
            "principal_total": str(principal_total),
            "interest": str(interest),
        }
        if params.get("tax"):
            national, local = withholding_tax(interest)
            result["national_tax"] = str(national)
            result["local_tax"] = str(local)
            result["net"] = str(final - national - local)
    except CompoundError as error:
        return {"error": error.code}
    return result
```

- [ ] **Step 2: 参照実装のテストを書いて回す**

`reference/tests/test_compound_ref.py`:

```python
from decimal import Decimal

import pytest

from calcarc_reference import compound_ref


def test_the_half_year_seed_matches_the_hand_computation():
    # 100 万・年 1%・5 年・半年複利。各期 floor して元本組入(設計書 §4)。
    num, den = compound_ref.rate_fraction("1", 2)
    assert (num, den) == (1, 200)
    assert compound_ref.grow(1_000_000, 0, num, den, 10) == 1_051_136


def test_the_closed_form_sits_above_the_exact_loop():
    # 切り捨てが積み上がるので厳密ループは必ず小さい。向きが反転したらバグ。
    num, den = compound_ref.rate_fraction("1", 2)
    exact = compound_ref.grow(1_000_000, 0, num, den, 10)
    assert compound_ref.closed_form(1_000_000, 0, num, den, 10) > exact


def test_the_guard_rejects_a_loop_that_drifted_too_far():
    # 番人に判別力があることを確かめる(否定的結論の陽性確認)。
    num, den = compound_ref.rate_fraction("1", 2)
    with pytest.raises(ValueError):
        compound_ref.check_against_closed_form(0, 1_000_000, 0, num, den, 10)


def test_a_lump_sum_is_a_deposit_of_zero():
    num, den = compound_ref.rate_fraction("3", 12)
    assert compound_ref.grow(1_000_000, 0, num, den, 12) == compound_ref.grow(
        1_000_000, 0, num, den, 12
    )


def test_taxes_are_floored_separately():
    # 合算 20.315% の 1 回切り捨てとは 1 円違う(設計書 §6)。
    national, local = compound_ref.withholding_tax(2_648_906)
    assert (national, local) == (405_679, 132_445)
    assert national + local == 538_124
    assert 2_648_906 * 20315 // 100_000 == 538_125


def test_zero_rate_keeps_the_principal():
    num, den = compound_ref.rate_fraction("0", 12)
    assert compound_ref.grow(1_000_000, 0, num, den, 12) == 1_000_000
    assert compound_ref.grow(0, 30_000, num, den, 12) == 360_000
```

Run: `cd reference && uv run --no-config pytest -q`
Expected: 36 passed（30 + 6）。

- [ ] **Step 3: golden のケース表を書く**

`reference/src/calcarc_reference/cases.py` に追加する。**期待値は実測済み**
（この plan の執筆時に Decimal で計算した値）:

```python
COMPOUND_INPUTS: list[dict] = [
    # 種①: 100 万・年 1%・5 年・半年複利 → 1,051,136(設計書 §4)
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "1", "periods_per_year": 2, "periods": 10, "tax": False},
    # 同じ入力に税を付ける。国税 7,831 + 地方税 2,556 = 10,387
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "1", "periods_per_year": 2, "periods": 10, "tax": True},
    # 積立: 月 3 万・年 3%・20 年 → 9,848,906(閉形式の 9,849,059 ではない)
    {"op": "compound_grow", "principal": "0", "deposit": "30000",
     "rate": "3", "periods_per_year": 12, "periods": 240, "tax": False},
    # 同じ積立に税。**別切り捨てと合算切り捨てが 1 円違う組**(設計書 §6)
    {"op": "compound_grow", "principal": "0", "deposit": "30000",
     "rate": "3", "periods_per_year": 12, "periods": 240, "tax": True},
    # 一括 + 積立の混合: 1000 万 + 月 5 万・年 3%・50 年 → 114,198,545
    {"op": "compound_grow", "principal": "10000000", "deposit": "50000",
     "rate": "3", "periods_per_year": 12, "periods": 600, "tax": False},
    # 周期 3 種(同じ年利で分母が変わることを固定する)
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 1, "periods": 10, "tax": False},
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 2, "periods": 10, "tax": False},
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 12, "periods": 10, "tax": False},
    # 金利 0% の退化(一括はそのまま、積立は deposit×periods)
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "0", "periods_per_year": 12, "periods": 12, "tax": False},
    {"op": "compound_grow", "principal": "0", "deposit": "30000",
     "rate": "0", "periods_per_year": 12, "periods": 12, "tax": False},
    # 1 期だけ / 最長 1200 期
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 12, "periods": 1, "tax": False},
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "1", "periods_per_year": 12, "periods": 1200, "tax": False},
    # u64 Overflow(**新設のエラー経路**。ローンには無かった。設計書 §3)
    {"op": "compound_grow", "principal": U64_MAX_TEXT, "deposit": "0",
     "rate": "100", "periods_per_year": 12, "periods": 12, "tax": False},
    # 税の小さい側の境界: 元本 1,000 円・年 1%・1 期 → 利息 10 円。
    # 別切り捨てなら 国税 1 + 地方税 0 = 1、合算 20.315% だと 2 になる。
    {"op": "compound_grow", "principal": "1000", "deposit": "0",
     "rate": "1", "periods_per_year": 1, "periods": 1, "tax": True},
    # エラー(設計書 §3): 期数 0 / 元本も積立も 0 / 上限超の期数
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 12, "periods": 0, "tax": False},
    {"op": "compound_grow", "principal": "0", "deposit": "0",
     "rate": "3", "periods_per_year": 12, "periods": 12, "tax": False},
    {"op": "compound_grow", "principal": "1000000", "deposit": "0",
     "rate": "3", "periods_per_year": 12, "periods": 1201, "tax": False},
]
```

**「積立額 0 = 一括の退化恒等式」は上の表で成立している**（種①も周期 3 種も
`deposit: "0"`）——別ケースを足さない。

- [ ] **Step 4: 生成スクリプトを 2 つの表に対応させる**

`reference/scripts/generate.py` の `build_finance` を書き換える。**id の重複
チェックは 2 表を結合した後で行う**（spec §9）:

```python
def build_finance() -> dict:
    entries = []
    for case in cases.LOAN_INPUTS:
        op = case["op"]
        params = _resolve_placeholders({k: v for k, v in case.items() if k != "op"})
        entries.append(
            {
                "id": f"{op}/" + "/".join(str(v) for v in params.values()),
                "op": op,
                "input": params,
                "expect": loan_ref.compute(op, params),
            }
        )
    for case in cases.COMPOUND_INPUTS:
        op = case["op"]
        params = _resolve_placeholders({k: v for k, v in case.items() if k != "op"})
        entries.append(
            {
                "id": f"{op}/" + "/".join(str(v) for v in params.values()),
                "op": op,
                "input": params,
                "expect": compound_ref.compute(op, params),
            }
        )
    ids = [entry["id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate case id in finance golden")
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }
```

`from calcarc_reference import ... compound_ref ...` の import も足す。

- [ ] **Step 5: 生成して、既存 36 件が動いていないことを確かめる**

```bash
cd reference && uv run --no-config python scripts/generate.py
cd .. && git diff testdata/finance.json | grep "^-" | grep -v "^---" | head
```

Expected: **削除行が 1 行も無い**（追加のみ）。既存 36 件の期待値が動いていたら
Task 2 か生成スクリプトが壊している。

```bash
cargo test --test finance_golden
```

Expected: **赤**。Rust 側に `compound_grow` の分岐がまだ無く、
`panic!("unknown op compound_grow")` になる。**これが Task 4 の出発点である。**

- [ ] **Step 6: コミット**

```bash
test "$(git branch --show-current)" = feature/finance-compound || exit 1
git add reference/ testdata/finance.json
git commit
```

---

### Task 4: Rust コア（ゲート段 3）

**Files:**
- Create: `crates/calcarc-core/src/finance/mod.rs`、`compound.rs`、`tax.rs`
- Modify: `crates/calcarc-core/src/loan/rate.rs`（頻度パラメータ化）
- Modify: `crates/calcarc-core/src/lib.rs`（`pub mod finance;`）

**Interfaces:**
- Consumes: Task 1 の方針、Task 3 の golden
- Produces:
  - `Rate::from_annual_percent(text: &str, periods_per_year: u32) -> CalcResult<Rate>`
  - `Rate::interest_floor(balance: u64) -> CalcResult<u64>`（`monthly_interest_floor`
    の改名ではなく**別名の追加**——下の Step 2 を見よ）
  - `finance::compound::grow(principal: u64, deposit: u64, rate: &Rate, periods: u32) -> CalcResult<Growth>`
  - `struct Growth { final_balance: u64, principal_total: u64, interest: u64 }`
  - `finance::tax::withholding(interest: u64) -> CalcResult<(u64, u64)>`

**モジュール配置の判断（spec §7）**: **`finance/` を新設し、`loan/` は動かさない。**
spec の推奨は `finance::{loan, compound}` への再配置だったが、**`loan` の移動は
wasm・テスト・web の import に波及する**。移動と機能追加を同じブランチに混ぜない
（API 整理 PR #19 の方式）。**`finance::compound` を作り、`loan` の再配置は
別 spec に送る**——名前の嘘（`loan::compound`）は生じないので、F1 の前提は
満たされる。この判断は F0 spec §1 の「内部名は改名しない」とも整合する。

- [ ] **Step 1: `Rate` を頻度パラメータ化する（既存の呼び出しを壊さない）**

`crates/calcarc-core/src/loan/rate.rs`:

```rust
    /// 年利のパーセント文字列から 1 期の利率へ。分母に期/年を掛ける。
    ///
    /// **名目換算のみ**である(numerical-policy)。実効換算
    /// (1+r)^(1/期) − 1 は有理数ではなく、この分数に載らない。
    pub fn from_annual_percent(text: &str, periods_per_year: u32) -> CalcResult<Rate> {
        if !matches!(periods_per_year, 1 | 2 | 12) {
            return Err(CalcError::SyntaxError);
        }
        // ...(既存 from_percent の本体。最後の denominator だけ)
        let denominator = scale
            .checked_mul(100)
            .and_then(|v| v.checked_mul(periods_per_year as u64))
            .ok_or(CalcError::SyntaxError)?;
        // ...
    }

    /// 年利のパーセント文字列から**月利**へ。ローンの入口(既存の契約)。
    pub fn from_percent(text: &str) -> CalcResult<Rate> {
        Rate::from_annual_percent(text, 12)
    }
```

**既存の 5 つの loan エクスポートと golden 36 件は 1 文字も変わらない。**

- [ ] **Step 2: `interest_floor` を足す（改名しない）**

```rust
    /// 1 期の利息 = floor(残高 × 分子 / 分母)。厳密整数、u128 中間。
    ///
    /// `monthly_interest_floor` と同じ計算である。**月次とは限らない**
    /// 文脈(複利の半年・年)から呼ぶときに名前が嘘にならないよう別名を置く。
    pub fn interest_floor(&self, balance: u64) -> CalcResult<u64> {
        self.monthly_interest_floor(balance)
    }
```

**`monthly_interest_floor` は消さない。** 消すと loan 側の全呼び出しと
コメントが動き、このブランチの diff に「複利と無関係な変更」が混ざる。

- [ ] **Step 3: 複利のコアを書く**

`crates/calcarc-core/src/finance/compound.rs`:

```rust
//! 複利(一括預入・毎月積立)。**厳密整数だけで走る**——f64 は無い。
//!
//! 1 期の演算はローンの各行利息と同一の floor(残高×分子/分母) である。
//! 切り捨てを選ぶ根拠だけが違う(numerical-policy「複利は同じ切り捨て、
//! 違う理由」)。積立は**期末**——利息を付けてから足す。

use crate::loan::rate::Rate;
use crate::{CalcError, CalcResult};

/// 期数の上限。ローンの 1200 か月と揃える(月次 100 年ぶん)。
pub const MAX_PERIODS: u32 = 1200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Growth {
    pub final_balance: u64,
    pub principal_total: u64,
    pub interest: u64,
}

/// 期を回す。答はこのループが出す。
pub fn grow(principal: u64, deposit: u64, rate: &Rate, periods: u32) -> CalcResult<Growth> {
    if periods == 0 || periods > MAX_PERIODS {
        return Err(CalcError::SyntaxError);
    }
    if principal == 0 && deposit == 0 {
        return Err(CalcError::SyntaxError);
    }
    let mut balance = principal;
    for _ in 0..periods {
        let interest = rate.interest_floor(balance)?;
        balance = balance.checked_add(interest).ok_or(CalcError::Overflow)?;
        balance = balance.checked_add(deposit).ok_or(CalcError::Overflow)?;
    }
    let principal_total = deposit
        .checked_mul(periods as u64)
        .and_then(|v| v.checked_add(principal))
        .ok_or(CalcError::Overflow)?;
    // 利息が負になることは無い(利率は非負)が、契約として checked で引く。
    let interest = balance
        .checked_sub(principal_total)
        .ok_or(CalcError::Overflow)?;
    Ok(Growth {
        final_balance: balance,
        principal_total,
        interest,
    })
}
```

`crates/calcarc-core/src/finance/tax.rs`:

```rust
//! 源泉分離課税 20.315%。**国税と地方税を別々に切り捨てる**
//! (国税庁 No.1310)。合算して 1 回切り捨てるのとは結果が違う。

use crate::{CalcError, CalcResult};

const NATIONAL_NUM: u128 = 15_315; // 15.315%
const NATIONAL_DEN: u128 = 100_000;
const LOCAL_NUM: u128 = 5; // 5%
const LOCAL_DEN: u128 = 100;

/// (国税, 地方税)。課税対象は利息。
pub fn withholding(interest: u64) -> CalcResult<(u64, u64)> {
    let national = interest as u128 * NATIONAL_NUM / NATIONAL_DEN;
    let local = interest as u128 * LOCAL_NUM / LOCAL_DEN;
    let national = u64::try_from(national).map_err(|_| CalcError::Overflow)?;
    let local = u64::try_from(local).map_err(|_| CalcError::Overflow)?;
    Ok((national, local))
}
```

`crates/calcarc-core/src/finance/mod.rs`:

```rust
//! Finance の計算コア。いまは複利と税だけを持つ。
//!
//! **ローン(`crate::loan`)は移していない。** 移動と機能追加を同じ変更に
//! 混ぜないため(設計書 §7 の判断、plan Task 4)。再配置は別 spec で行う。

pub mod compound;
pub mod tax;
```

- [ ] **Step 4: 単体テストを書く**

`compound.rs` の `#[cfg(test)]` に:

```rust
    #[test]
    fn the_half_year_seed_is_exact() {
        // 100 万・年 1%・5 年・半年複利(numerical-policy の実測値)。
        let r = Rate::from_annual_percent("1", 2).unwrap();
        let g = grow(1_000_000, 0, &r, 10).unwrap();
        assert_eq!(g.final_balance, 1_051_136);
        assert_eq!(g.interest, 51_136);
    }

    #[test]
    fn a_deposit_lands_at_the_end_of_the_period() {
        // 期末なので、最初の期の利息は積立額に付かない。
        let r = Rate::from_annual_percent("12", 12).unwrap(); // 月 1%
        let g = grow(0, 10_000, &r, 2).unwrap();
        // 1 期目: 利息 0 + 10,000。2 期目: 利息 100 + 10,000。
        assert_eq!(g.final_balance, 20_100);
    }

    #[test]
    fn zero_rate_keeps_what_was_put_in() {
        let r = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(grow(1_000_000, 0, &r, 12).unwrap().interest, 0);
        assert_eq!(grow(0, 30_000, &r, 12).unwrap().final_balance, 360_000);
    }

    #[test]
    fn growth_can_overflow_u64() {
        // ローンには無かった経路(残高が減る一方だった)。
        let r = Rate::from_annual_percent("100", 12).unwrap();
        assert_eq!(grow(u64::MAX, 0, &r, 12), Err(CalcError::Overflow));
    }

    #[test]
    fn the_error_table() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        assert_eq!(grow(1_000_000, 0, &r, 0), Err(CalcError::SyntaxError));
        assert_eq!(grow(0, 0, &r, 12), Err(CalcError::SyntaxError));
        assert_eq!(
            grow(1_000_000, 0, &r, MAX_PERIODS + 1),
            Err(CalcError::SyntaxError)
        );
    }
```

`tax.rs` に:

```rust
    #[test]
    fn the_two_taxes_are_floored_separately() {
        // 合算 20.315% を 1 回切り捨てると 1 円ずれる(設計書 §6)。
        assert_eq!(withholding(2_648_906).unwrap(), (405_679, 132_445));
        assert_eq!(405_679 + 132_445, 538_124);
        assert_eq!(2_648_906u128 * 20_315 / 100_000, 538_125);
    }
```

`rate.rs` に:

```rust
    #[test]
    fn the_period_count_moves_the_denominator() {
        assert_eq!(Rate::from_annual_percent("1", 2).unwrap(), Rate { numerator: 1, denominator: 200 });
        assert_eq!(Rate::from_annual_percent("1.5", 12).unwrap(), Rate::from_percent("1.5").unwrap());
        assert_eq!(Rate::from_annual_percent("1", 4), Err(CalcError::SyntaxError));
    }
```

- [ ] **Step 5: 緑を確認する**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

Expected: Rust 192 + 新規 9 前後。**golden はまだ赤**（Task 5 で繋ぐ）ので、
`--lib` で回すか、`finance_golden` の赤が残っていることを承知で進む。

- [ ] **Step 6: コミット**

---

### Task 5: golden を繋ぎ、赤確認をする

**Files:**
- Modify: `crates/calcarc-core/tests/finance_golden.rs`

**Interfaces:**
- Consumes: Task 3 の golden、Task 4 のコア
- Produces: なし（検証のみ）

- [ ] **Step 1: `Input` を広げる**

```rust
struct Input {
    rate: String,
    // ...既存のフィールド...
    #[serde(default)]
    deposit: Option<String>,
    #[serde(default)]
    periods: Option<u32>,
    #[serde(default)]
    periods_per_year: Option<u32>,
    #[serde(default)]
    tax: Option<bool>,
}
```

- [ ] **Step 2: `run` に分岐を足す**

```rust
        "compound_grow" => {
            let rate = Rate::from_annual_percent(
                &input.rate,
                input.periods_per_year.ok_or(CalcError::SyntaxError)?,
            )?;
            let growth = compound::grow(
                input.yen(&input.principal)?,
                input.yen(&input.deposit)?,
                &rate,
                input.periods.ok_or(CalcError::SyntaxError)?,
            )?;
            let mut out = BTreeMap::new();
            field(&mut out, "final_balance", growth.final_balance);
            field(&mut out, "principal_total", growth.principal_total);
            field(&mut out, "interest", growth.interest);
            if input.tax == Some(true) {
                let (national, local) = tax::withholding(growth.interest)?;
                field(&mut out, "national_tax", national);
                field(&mut out, "local_tax", local);
                field(&mut out, "net", growth.final_balance - national - local);
            }
            Ok(out)
        }
```

**`other => panic!("unknown op {other}")` は残す**（未知 op が黙って通らない
のは良い性質）。

- [ ] **Step 3: 完全一致を確認する**

Run: `cargo test --test finance_golden`
Expected: PASS。golden 36 + 17 = **53 件**。

- [ ] **Step 4: 赤確認 4 種（実出力を貼る）**

| # | 変異 | 期待する赤 |
|---|---|---|
| 1 | 各期 floor をやめ、最後に 1 回だけ floor する | 種①が 1,051,140 になり赤 |
| 2 | 税を合算 20.315% の 1 回切り捨てにする | 積立+税のケースが 1 円ずれて赤 |
| 3 | 積立を期首にする（利息の前に足す） | 積立ケースが赤 |
| 4 | **周期を取り違える**（`periods_per_year` を無視して 12 固定） | 半年・年のケースが赤 |

**4 は当初「換算を他方に変える」だったが、実効換算を実装しないので成立しない**
（この plan の冒頭「spec を狭める 2 点」を見よ）。同じ「率の解釈違いを捕まえるか」
を見る変異に差し替えている。

**各変異について、実際の出力を完了報告に貼る。** 赤にならないものがあれば
正直に報告し、等価な強さの変異に差し替える（M6 の【訂正 2c】が先例）。

- [ ] **Step 5: コミット**

---

### Task 6: WASM 境界と TS ラッパー

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`
- Create: `web/src/finance/types.ts`、`web/src/finance/index.ts`

**Interfaces:**
- Consumes: Task 4 のコア
- Produces: `compound_grow(principal, deposit, rate, periods_per_year, periods, tax) -> JsValue`
  と、その TS 型。**UI からの呼び出し元はまだ無い**（冒頭の判断 (2)）。

- [ ] **Step 1: WASM の関数を足す**

既存の `loan_forward`（`crates/calcarc-wasm/src/lib.rs:200`）と**同じ形**にする
——引数は文字列（円は u64 で JS の number を超える）、**例外を投げず戻り値に
エラーを入れる**（CLAUDE.md の境界規約）。

- [ ] **Step 2: TS ラッパーを足す**

`web/src/loan/index.ts` と同じ流儀（`react` を import しない、計算を持たない、
型変換と初期化だけ）。

- [ ] **Step 3: wasm のテストを回す**

```bash
wasm-pack test --headless --chrome crates/calcarc-wasm
```

**Chrome が使えない場合は `--firefox` に落とし、その事実を報告に書く**
（CI は chrome 固定。手元の chromedriver 不一致は既知）。

- [ ] **Step 4: コミット**

---

### Task 7: フルスイープと完了

- [ ] **Step 1: 4173 を確かめてから全段を回す**

```bash
ss -ltn | grep 4173     # 何も出ないこと
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
wasm-pack test --headless --chrome crates/calcarc-wasm
cd reference && uv run --no-config pytest
cd reference && uv run --no-config python scripts/generate.py   # 差分が出ないこと
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

- [ ] **Step 2: 既存が動いていないことを示す**

```bash
git diff testdata/finance.json | grep "^-" | grep -v "^---" | wc -l   # 0 であること
git diff --stat c05328f -- web/src/ui/ web/tests/                     # 空であること
```

**UI と E2E に差分が無いこと**が「F1 は計算コアまで」の証明である。

- [ ] **Step 3: コミット（必要なら）と完了報告**

---

# 完了条件（spec §14 の写し）

1. **ゲートの段順が守られている**（数値方針 → Python 参照 → golden → Rust → 境界）。
   `docs/numerical-policy.md` に複利の節があり、**floor の根拠が「安全な向き」から
   「慣行の再現」に変わったこと**が明記されている。
2. 一括・積立の両方が `testdata/finance.json` の golden と**完全一致**（tolerance なし）。
   golden は 36 + 17 = 53 件。
3. 赤確認 4 種の**実出力**がある。赤にならないものは正直に報告し、等価な変異に
   差し替えてある。
4. Python 参照が **int ループとは独立の軸**を持っている（Decimal 閉形式の番人。
   その番人自身に判別力があることも `test_the_guard_rejects_a_loop_that_drifted_too_far`
   で確かめてある）。
5. `pow_1p` と `annuity` が抽出され、**既存の重複（前者 3 箇所・後者 2 箇所）が
   解消**されている。**`finance.json` の既存 36 件が 1 件も動かない**。
6. u64 オーバーフローが `Overflow` として返る（新設のエラー経路。golden あり）。
7. 全段のスイープが緑。`generate.py` の再生成で差分が出ない。
8. **UI と E2E に差分が無い**（`web/src/ui/` と `web/tests/` の diff が空）。

# 進捗の見取り図

| タスク | 成果物 | 検証段 | spec |
|---|---|---|---|
| 1 | numerical-policy の複利節 | なし（文書） | §4/§14-1 |
| 2 | `pow_1p`/`annuity` 抽出 | cargo + golden 不変 | §3/§7 |
| 3 | Python 参照 + golden 17 件 | pytest + 生成 | §8/§9 |
| 4 | Rust コア（`finance::{compound, tax}`） | cargo | §3/§6/§7 |
| 5 | golden 完全一致 + 赤確認 4 種 | cargo | §9 |
| 6 | WASM 境界 + TS ラッパー | wasm-pack + typecheck | §7 |
| 7 | フルスイープ | 全段 | §11/§14 |
