# 複利の逆算 — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目標額から必要積立額と必要年数を求める。**必要年数は二分探索を使わない**
——手取りが期数について単調でないため。

**Architecture:** `finance/compound_inverse.rs` を新設し、`grow` と `tax::withholding`
の上に載せる。計算は 1 つも書き直さない。Python は探索せず、答が定義を満たすかだけを
検査する。段ゲート（base-spec §49）の順に進む: 数値方針 → Python + golden → Rust →
WASM → UI。

**Tech Stack:** Rust / wasm-bindgen / TypeScript / React 19 / Python (uv, pytest) / vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-08-15-compound-inverse-design.md`
（**節番号はこの計画の各所で引く。実装者は自分のタスクが引く節だけ読めばよい**）

## Global Constraints

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない。
- **`calcarc-core` は panic しない。** `unwrap`/`expect` は lint が禁じている。
- **WASM 境界は JavaScript 例外を投げない。** エラーは戻り値の一部。
- **許容誤差をテストコードに書かない。** 逆算は整数円の完全一致なので `tolerance` を持たない。
- **既存 golden 85 件を 1 行も動かさない。** 追加のみ。
- **`web/src/calc/` と `web/src/finance/` に React を import しない。**
- コミット前に `cargo fmt`。`uv lock`/`uv sync` には `--no-config`。
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- **`git push` と PR 作成は行わない。**
- **共有ワークツリーである。** コミットの前に必ず
  `test "$(git branch --show-current)" = feature/compound-inverse` を確かめる。
  `git checkout` でブランチを切り替えない。
- E2E のポートは 4179。

## 段ゲートの順序（崩さない）

```
Task 1     数値方針            ← 最初。丸めと探索の正当化を先に書く
Task 2-4   Python + golden     ← Rust より前。逐語移植を防ぐ
Task 5-7   Rust + 赤確認
Task 8     WASM 境界
Task 9-10  TS と UI
Task 11    フルスイープ
```

**段 2 が段 3 より前にあることが `git log` で確かめられること**が完了条件の 1 つ
（設計書 §12）。Task 5 より前に Task 4 のコミットが在ること。

## ファイル構成

```text
crates/calcarc-core/src/finance/compound_inverse.rs   新設（Task 5）
crates/calcarc-core/src/finance/mod.rs                pub mod を 1 行（Task 5）
crates/calcarc-core/tests/finance_golden.rs           2 アーム + カバレッジ 2 行（Task 6）
crates/calcarc-wasm/src/lib.rs                        2 関数（Task 8）
reference/src/calcarc_reference/compound_ref.py       逆算 + 証明書（Task 2）
reference/src/calcarc_reference/cases.py              必須ケース 13 件（Task 3）
reference/tests/test_compound_ref.py                  ユニット（Task 2）
reference/tests/test_compound_inverse_certificate.py  新設・golden 全件（Task 4）
testdata/finance.json                                 生成物（Task 3）
docs/numerical-policy.md                              §6 の 3 点（Task 1）
web/src/finance/index.ts, types.ts                    2 メソッド（Task 9）
web/src/ui/Keypad/finance.ts                          トークン 3 + 面（Task 10）
web/src/ui/Finance/FinancePanel.tsx                   モード 2 つ（Task 10）
```

---

### Task 1: 数値方針に、探索の正当化を書く

**Files:**
- Modify: `docs/numerical-policy.md`（`### 税` 節の直後、`## 式は有理数で評価し` の直前）

**Interfaces:**
- Consumes: なし
- Produces: なし（文書）

設計書 §3 と §6 を読むこと。**この節が後続タスクすべての根拠になる。**

- [ ] **Step 1: ブランチを作る**

```bash
cd /home/terapyon/dev/CalcArc
git fetch origin
git switch -c feature/compound-inverse origin/main
git log --oneline -1     # 549ac14 Merge pull request #40 ...
```

- [ ] **Step 2: 節を書く**

`docs/numerical-policy.md` の `### 税` 節の直後に次を挿入する。

```markdown
### 手取りは期数について単調でない

**税を引いた手取りは、期数を増やすと減ることがある。** 実測（元本 999 円・
年 1.5%・月次・積立なし）:

| n | 残高 | 利息 | 国税 | 地方税 | 手取り |
|---|---|---|---|---|---|
| 19 | 1,018 | 19 | 2 | 0 | **1,016** |
| 20 | 1,019 | 20 | 3 | 1 | **1,015** |

残高が 1 円増える間に税が 2 円増えている。利息 20 円が `0.15315 × 20 = 3.063` と
`0.05 × 20 = 1.00` の**両方の閾値を同時に跨ぐ**ためで、国税と地方税の floor が
同じ期に跳ぶ。別々に切り捨てる（No.1310）以上、避けられない。

**帰結 1: 目標額から必要年数を求めるとき、二分探索を使ってはならない。**
単調性を前提にする探索は静かに間違った答を返しうる。`MAX_PERIODS` まで
1 期ずつ前に進め、**最初に届いた期**を返す。

**帰結 2: 必要年数の直後に、目標を下回る期がありうる。** 上の例で目標
1,016 円の必要年数は 19 期だが、20 期では下回り、21 期で戻る。**これは仕様
である**——税の階段の性質であって不具合ではない。

**積立額については単調である。** 積立 +1 円で残高は `S ≥ n` 増え、利息は
`S − n` 増える。税の増分は 2 つの floor で `0.20315(S − n) + 2` を超えないので

    手取りの増分 ≥ S − (0.20315(S − n) + 2) ≥ n − 2

`n ≥ 3` で正。`n = 1` は積立が期末なので利息が動かず +1、`n = 2` は利息の増分が
0 か 1 で残高の増分が 2 か 3 なので +1 以上。**だから必要積立額は二分探索でよい。**

反例の探索範囲は
[複利の逆算 設計](superpowers/specs/2026-08-15-compound-inverse-design.md) §15。
```

- [ ] **Step 3: リンクが解決することを確かめる**

```bash
ls docs/superpowers/specs/2026-08-15-compound-inverse-design.md
```

- [ ] **Step 4: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add docs/numerical-policy.md && git commit -m "$(cat <<'EOF'
Write down why the periods inversion cannot bisect

手取りは期数について単調でない。国税と地方税の floor が同じ期に跳ぶと、
残高が 1 円増える間に税が 2 円増える。積立額については単調で、証明も置く。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Python 参照に逆算と証明書検査を足す

**Files:**
- Modify: `reference/src/calcarc_reference/compound_ref.py`
- Modify: `reference/tests/test_compound_ref.py`

**Interfaces:**
- Consumes: 既存の `grow` / `rate_fraction` / `withholding_tax` / `closed_form`
- Produces: `reached(principal, deposit, num, den, periods, taxed) -> int`、
  `deposit_for(...) -> int`、`periods_for(...) -> int`、
  `check_deposit_certificate(...)`、`check_periods_certificate(...)`、
  `compute()` が `"compound_deposit_for"` と `"compound_periods_for"` を受ける。
  戻り値の key は `deposit` / `periods` / `final_balance` / `principal_total` /
  `interest` と、税 ON なら `national_tax` / `local_tax` / `net`。

設計書 §2 §4 §5 §8 を読むこと。

**Python は Rust と同じ探索を書かない**（base-spec §30）:

| | Rust | Python |
|---|---|---|
| 必要積立額 | 純粋な二分探索 | **Decimal 閉形式で種 → 証明書を満たすまで歩く** |
| 必要年数 | 前進 1 本 | 前進 1 本（**これは定義そのものなので同型でよい**） |

- [ ] **Step 1: 失敗するテストを書く**

`reference/tests/test_compound_ref.py` の末尾に足す。

```python
def test_reached_is_the_net_when_taxed() -> None:
    # 目標と比べる値は、税 ON なら手取り、OFF なら残高（設計書 §2）。
    num, den = compound_ref.rate_fraction("1.5", 12)
    assert compound_ref.reached(999, 0, num, den, 19, taxed=False) == 1018
    assert compound_ref.reached(999, 0, num, den, 19, taxed=True) == 1016


def test_the_periods_answer_is_the_first_that_reaches() -> None:
    # 非単調の実例（設計書 §3）。19 で届き、20 で下回り、21 で戻る。
    num, den = compound_ref.rate_fraction("1.5", 12)
    assert compound_ref.periods_for(999, 0, num, den, 1016, taxed=True) == 19
    assert compound_ref.reached(999, 0, num, den, 20, taxed=True) == 1015
    assert compound_ref.reached(999, 0, num, den, 21, taxed=True) == 1016


def test_the_deposit_answer_does_not_fall_short() -> None:
    num, den = compound_ref.rate_fraction("3", 12)
    d = compound_ref.deposit_for(0, num, den, 240, 10_000_000, taxed=False)
    assert d == 30_461
    assert compound_ref.grow(0, d, num, den, 240) == 10_000_251
    assert compound_ref.grow(0, d - 1, num, den, 240) == 9_999_906


def test_the_certificate_rejects_an_answer_one_period_too_late() -> None:
    # 21 は「最初に届いた期」ではない。20 期が下回るので、n−1 の 1 点しか
    # 見なければ通ってしまう——全数走査が要る理由（設計書 §9 の #2）。
    num, den = compound_ref.rate_fraction("1.5", 12)
    with pytest.raises(AssertionError):
        compound_ref.check_periods_certificate(21, 999, 0, num, den, 1016, taxed=True)
    compound_ref.check_periods_certificate(19, 999, 0, num, den, 1016, taxed=True)
```

`pytest` の import が無ければ足す。

- [ ] **Step 2: 赤を見る**

```bash
cd /home/terapyon/dev/CalcArc/reference && uv run pytest tests/test_compound_ref.py -x
```

期待: `AttributeError: module 'calcarc_reference.compound_ref' has no attribute 'reached'`。

- [ ] **Step 3: 実装する**

`compound_ref.py` の `withholding_tax` の直後に足す。

```python
def reached(principal: int, deposit: int, num: int, den: int, periods: int, taxed: bool) -> int:
    """目標と比べる値。税 ON なら手取り、OFF なら残高（公開契約 6）。"""
    balance = grow(principal, deposit, num, den, periods)
    if not taxed:
        return balance
    interest = balance - (principal + deposit * periods)
    national, local = withholding_tax(interest)
    return balance - national - local


# 種から歩く上限。閉形式の種は数円〜数千円しかずれない（税ぶんが最大）ので、
# ここに当たったら種か契約が壊れている。黙って長く歩かせない。
MAX_WALK = 100_000


def deposit_for(principal: int, num: int, den: int, periods: int, target: int, taxed: bool) -> int:
    """目標を下回らない最小の積立額（設計書 §1 の裁定 4）。

    **二分探索しない**——Rust がそれをやる。ここは Decimal 閉形式の種から
    証明書を満たすまで歩く。種は税を見ないので必ず下から寄る。
    """
    if target <= 0:
        raise CompoundError("SyntaxError")
    # **`principal > 0` の条件は要る**——`grow(0, 0, ...)` は「入れた金がゼロ」で
    # SyntaxError を上げる。元本 0 の必須ケース(#1 ほか)がここで落ちる。
    if principal > 0 and reached(principal, 0, num, den, periods, taxed) >= target:
        return 0
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        remain = Decimal(target) - Decimal(principal) * (1 + r) ** periods
        if r == 0:
            seed = int(remain / Decimal(periods))
        else:
            seed = int(remain * r / ((1 + r) ** periods - 1))
    d = max(seed, 0)
    while d > 0 and reached(principal, d - 1, num, den, periods, taxed) >= target:
        d -= 1
    for step in range(MAX_WALK):
        if reached(principal, d, num, den, periods, taxed) >= target:
            return d
        d += 1
    raise ValueError(f"種から {MAX_WALK} 歩いても届かない（種 {seed}）")


def periods_for(principal: int, deposit: int, num: int, den: int, target: int, taxed: bool) -> int:
    """目標を下回らない最小の期数。**最初に届いた期**（設計書 §4）。"""
    if target <= 0:
        raise CompoundError("SyntaxError")
    if principal == 0 and deposit == 0:
        raise CompoundError("SyntaxError")
    for n in range(1, MAX_PERIODS + 1):
        if reached(principal, deposit, num, den, n, taxed) >= target:
            return n
    raise CompoundError("SyntaxError")  # 1200 期でも届かない = 発散


def check_deposit_certificate(
    d: int, principal: int, num: int, den: int, periods: int, target: int, taxed: bool
) -> None:
    """単調側。答の両隣 2 点で足りる（単調性の証明が §3 にある）。"""
    assert reached(principal, d, num, den, periods, taxed) >= target, f"{d} が届かない"
    if d > 0:
        assert reached(principal, d - 1, num, den, periods, taxed) < target, f"{d} は最小でない"


def check_periods_certificate(
    n: int, principal: int, deposit: int, num: int, den: int, target: int, taxed: bool
) -> None:
    """非単調側。**1..n−1 の全数**を見る——「最初に届く」の定義そのもの。

    残高を持ち回る 1 本の走査で全接頭辞を評価する。**探索ではない**——打ち切りの
    判定を持たず、n まで必ず走り切る。
    """
    balance = principal
    total = principal
    for k in range(1, n + 1):
        balance += balance * num // den + deposit
        total += deposit
        interest = balance - total
        if taxed:
            national, local = withholding_tax(interest)
            value = balance - national - local
        else:
            value = balance
        if k < n:
            assert value < target, f"{n} より早く {k} で届いている"
        else:
            assert value >= target, f"{n} で届いていない"
```

`compute()` の `if op != "compound_grow"` を、3 つの op を受ける形に広げる。

```python
def compute(op: str, params: dict) -> dict:
    """生成スクリプトの入口。エラーは戻り値にする（loan_ref と同じ流儀）。"""
    try:
        if op == "compound_grow":
            return _compute_grow(params)
        if op == "compound_deposit_for":
            return _compute_deposit_for(params)
        if op == "compound_periods_for":
            return _compute_periods_for(params)
    except CompoundError as error:
        return {"error": error.code}
    raise ValueError(f"unknown op {op}")
```

既存の本体を `_compute_grow(params)` に切り出す（**中身は 1 行も変えない**——
`try/except` が `compute` に移るだけ）。新しい 2 つ:

```python
def _compute_deposit_for(params: dict) -> dict:
    principal = int(params["principal"])
    target = int(params["target"])
    periods = params["periods"]
    taxed = bool(params.get("tax"))
    num, den = rate_fraction(params["rate"], params["periods_per_year"])
    d = deposit_for(principal, num, den, periods, target, taxed)
    check_deposit_certificate(d, principal, num, den, periods, target, taxed)
    return {"deposit": str(d), **_picture(principal, d, num, den, periods, taxed)}


def _compute_periods_for(params: dict) -> dict:
    principal = int(params["principal"])
    deposit = int(params["deposit"])
    target = int(params["target"])
    taxed = bool(params.get("tax"))
    num, den = rate_fraction(params["rate"], params["periods_per_year"])
    n = periods_for(principal, deposit, num, den, target, taxed)
    check_periods_certificate(n, principal, deposit, num, den, target, taxed)
    return {"periods": str(n), **_picture(principal, deposit, num, den, n, taxed)}


def _picture(principal: int, deposit: int, num: int, den: int, periods: int, taxed: bool) -> dict:
    """答におけるその期の全体像（設計書 §4 の Solution と同じ内訳）。"""
    balance = grow(principal, deposit, num, den, periods)
    total = principal + deposit * periods
    interest = balance - total
    out = {
        "final_balance": str(balance),
        "principal_total": str(total),
        "interest": str(interest),
    }
    if taxed:
        national, local = withholding_tax(interest)
        out["national_tax"] = str(national)
        out["local_tax"] = str(local)
        out["net"] = str(balance - national - local)
    return out
```

- [ ] **Step 4: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc/reference && uv run pytest -q
```

期待: 既存 51 件 + 新規 4 件が緑。

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add reference/ && git commit -m "$(cat <<'EOF'
Teach the Python reference to certify an inverse, not to search for one

必要年数は前進 1 本(定義そのもの)、必要積立額は Decimal 閉形式の種から歩く
——Rust の二分探索を写さないため。証明書検査は積立側が両隣 2 点、期数側は
1..n−1 の全数で、その非対称が単調性の証明の依存関係を写している。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: golden に必須ケース 13 件を足す

**Files:**
- Modify: `reference/src/calcarc_reference/cases.py`（`COMPOUND_INPUTS` の末尾）
- Regenerate: `testdata/finance.json`

**Interfaces:**
- Consumes: Task 2 の `compound_ref.compute`
- Produces: `testdata/finance.json` に op `compound_deposit_for` / `compound_periods_for`
  のケース。`input` の key は `principal` `deposit` `target` `rate`
  `periods_per_year` `periods` `tax`。

設計書 §7 を読むこと。**期待値は設計書に実測値が載っている。合わなければ止めて報告する。**

- [ ] **Step 1: ケースを足す**

`cases.py` の `COMPOUND_INPUTS` の末尾に足す。**#4 と #5 はコメントで対にする。**

```python
    # ここから逆算（設計書 2026-08-15 §7）。期待値は spec 起草時に実測済み。
    # 必要積立額: 元本 0・年 3%・月次・240 期・目標 1,000 万 → 30,461（残高 10,000,251）
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 1 円少ないと届かないことを固定する（上のケースの対）。
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "30460",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 必要年数: 元本 100 万・積立 3 万・年 3%・月次・目標 1,000 万 → 211 期
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "30000",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # **非単調ペア (a)**: 目標 1,016（手取り）→ 19 期。
    # **対は次のケース**。片方だけ消すと numerical-policy の注記が根拠を失う。
    {
        "op": "compound_periods_for",
        "principal": "999",
        "deposit": "0",
        "target": "1016",
        "rate": "1.5",
        "periods_per_year": 12,
        "tax": True,
    },
    # **非単調ペア (b)**: 同じ入力の 20 期は手取り 1,015 で目標を下回る。
    # 「届いた直後に下回る期がある」が仕様であることの証拠（設計書 §3 帰結 2）。
    {
        "op": "compound_grow",
        "principal": "999",
        "deposit": "0",
        "rate": "1.5",
        "periods_per_year": 12,
        "periods": 20,
        "tax": True,
    },
    # 0%: 整数の ceil になる。境界の +1 円も置く。
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "12000000",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "12000001",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 税あり必要積立額: 目標 1,000 万（手取り）→ 32,221
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": True,
    },
    # 目標が元本以下 → 1 期（エラーにしない。設計書 §5）
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "0",
        "target": "500000",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # 発散: 積立 0・利率 0 では増えない → SyntaxError
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "0",
        "target": "2000000",
        "rate": "0",
        "periods_per_year": 12,
        "tax": False,
    },
    # 往復: #1 の残高を目標にすると 240 期に戻る
    {
        "op": "compound_periods_for",
        "principal": "0",
        "deposit": "30461",
        "target": "10000251",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # 目標 0 は入力が足りていない → SyntaxError
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # u64 を超える目標 → Overflow。**2 期であることに意味がある**——0%・1 期なら
    # 答はちょうど u64::MAX で収まってしまう(残高 = 積立額)。2 期なら 2d ≥ u64::MAX
    # が要り、最小の d = 2^63 で残高が 2^64 になってあふれる。
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "18446744073709551615",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 2,
        "tax": False,
    },
```

**このケースは `MAX_WALK` に当たりうる。** 種は `remain / periods` = 2^63 付近を
指すので、そこから 1 歩目で `grow` があふれて `CompoundError("Overflow")` が上がり、
`compute` が `{"error": "Overflow"}` を返す——というのが期待する経路である。
**生成して実際にそうなることを確かめ、違ったら止めて報告する**（`MAX_WALK` の
`ValueError` が出るなら、`deposit_for` に「種が u64 を超えたら Overflow」の早期
判定が要る。設計書 §5 の「必要積立額が u64 に収まらない → Overflow」）。

- [ ] **Step 2: 生成する**

```bash
cd /home/terapyon/dev/CalcArc/reference && uv run python scripts/generate.py
cd /home/terapyon/dev/CalcArc && git diff --stat testdata/
```

期待: `testdata/finance.json` だけが変わり、**追加のみ**。

- [ ] **Step 3: 既存 85 件が動いていないことを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff -U0 testdata/finance.json | grep '^-' | grep -v '^---'
```

期待: **無出力**（削除行が 1 つも無い = 既存ケースが動いていない）。
`cases` 配列の末尾に足しているので、既存の行は動かないはずである。
出力があったら止めて報告すること。

- [ ] **Step 4: 設計書の実測値と突き合わせる**

```bash
cd /home/terapyon/dev/CalcArc
python3 -c "
import json
d = json.load(open('testdata/finance.json'))
for c in d['cases']:
    if c['op'] in ('compound_deposit_for','compound_periods_for'):
        print(c['id'], '->', c['expect'])
"
```

設計書 §7 の表と照合する: 30,461 / 211 / 19 / 50,000 / 50,001 / 32,221 / 1 /
SyntaxError / 240。**1 つでも違ったら止めて報告する。**

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add reference/ testdata/ && git commit -m "$(cat <<'EOF'
Put the inverse expectations in the golden before writing any Rust

必須ケース 13 件。非単調ペア(19 期と 20 期の手取り 1,015)は対にしてあり、
片方だけ消すと numerical-policy の注記が根拠を失う。既存 85 件は不動。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 証明書を pytest で常時効かせる

**Files:**
- Create: `reference/tests/test_compound_inverse_certificate.py`

**Interfaces:**
- Consumes: Task 2 の証明書検査、Task 3 の `testdata/finance.json`
- Produces: なし（テスト）

設計書 §8 の「証明書は常時効かせる」を読むこと。

**このリポジトリで `reference/tests/` が `testdata/*.json` を読むのは初めてである。**
`test_loan_ref.py` の 1 行目が「突き合わせ本番は golden の仕事」と書いているとおり、
突き合わせは Rust 側の仕事だった。**ここでやるのは突き合わせではなく定義検査**
——Rust の答を見に行かず、golden に載った答が定義を満たすかだけを見る。

- [ ] **Step 1: テストを書く**

```python
"""golden に載った逆算の答が、定義を満たしているかを毎回確かめる。

**これは突き合わせではない**（それは `finance_golden.rs` の仕事）。Rust の実装を
一切見ず、「その答が定義どおりか」だけを検査する。生成時に 1 回だけ確かめると
「golden を作った日に正しかった」で終わるので、pytest でも常時走らせる
（設計書 2026-08-15 §8）。
"""

from __future__ import annotations

import json
import pathlib

import pytest

from calcarc_reference import compound_ref

TESTDATA = pathlib.Path(__file__).resolve().parents[2] / "testdata" / "finance.json"


def _inverse_cases(op: str) -> list[dict]:
    cases = json.loads(TESTDATA.read_text())["cases"]
    # エラーを期待するケースには証明書が無い（答が無いので）。
    return [c for c in cases if c["op"] == op and "error" not in c["expect"]]


def test_the_golden_has_inverse_cases_to_certify() -> None:
    # 検査対象がゼロ件でも「全件通った」と言えてしまうのを防ぐ。
    assert len(_inverse_cases("compound_deposit_for")) >= 3
    assert len(_inverse_cases("compound_periods_for")) >= 3


@pytest.mark.parametrize("case", _inverse_cases("compound_deposit_for"), ids=lambda c: c["id"])
def test_every_deposit_answer_satisfies_the_definition(case: dict) -> None:
    i = case["input"]
    num, den = compound_ref.rate_fraction(i["rate"], i["periods_per_year"])
    compound_ref.check_deposit_certificate(
        int(case["expect"]["deposit"]),
        int(i["principal"]),
        num,
        den,
        i["periods"],
        int(i["target"]),
        bool(i.get("tax")),
    )


@pytest.mark.parametrize("case", _inverse_cases("compound_periods_for"), ids=lambda c: c["id"])
def test_every_periods_answer_satisfies_the_definition(case: dict) -> None:
    i = case["input"]
    num, den = compound_ref.rate_fraction(i["rate"], i["periods_per_year"])
    compound_ref.check_periods_certificate(
        int(case["expect"]["periods"]),
        int(i["principal"]),
        int(i["deposit"]),
        num,
        den,
        int(i["target"]),
        bool(i.get("tax")),
    )
```

- [ ] **Step 2: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc/reference && uv run pytest tests/test_compound_inverse_certificate.py -q
```

期待: 全ケース緑。ケース数が集まっていること。

- [ ] **Step 3: 赤確認 #2（設計書 §9） — 全数走査が要ることを実際に見る**

**golden を一時的に壊して、検査が捕まえることを確かめる。**

```bash
cd /home/terapyon/dev/CalcArc
git stash list   # 何も stash しない。編集して戻すだけ（赤確認の手順）
```

`testdata/finance.json` の非単調ケース（`compound_periods_for` で
`principal` `999`）の `expect.periods` を `"19"` → `"21"` に手で書き換え、

```bash
cd /home/terapyon/dev/CalcArc/reference && uv run pytest tests/test_compound_inverse_certificate.py -q
```

期待: **赤**（`21 より早く 19 で届いている`）。

続けて、`check_periods_certificate` を「`k = n−1` の 1 点だけ見る」形に一時的に
弱めて同じ状態で走らせる:

期待: **通ってしまう**（`reached(20) = 1,015 < 1,016` なので）。
**これが全数走査の根拠である。**

さらに `expect.periods` を `"20"` に変えると、1 点検査でも**赤**になる
（`reached(19) = 1,016 ≥ 1,016`）。設計書 §9 の表のとおりになることを確かめる。

**表のとおりにならなかったら止めて報告する**（設計書 §8 の非対称の根拠が崩れる）。

- [ ] **Step 4: 壊した箇所を戻す**

**`git checkout` でファイルごと戻さない**（同じファイルの別作業を巻き戻す）。
編集で戻し、差分が空であることを確かめる。

```bash
cd /home/terapyon/dev/CalcArc && git diff --stat
```

期待: **無出力**。

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add reference/tests/test_compound_inverse_certificate.py && git commit -m "$(cat <<'EOF'
Certify the golden's inverse answers on every pytest run

生成時 1 回だと「作った日に正しかった」で終わる。pytest が testdata を読むのは
初めてなので分業を書いておく——これは突き合わせ(finance_golden.rs の仕事)では
なく、Rust を見ない定義検査である。

赤確認: 19→21 の変異は全数走査が捕まえ、n−1 の 1 点検査はすり抜ける。
20 期が目標を下回るせいで、非単調性がそのまま検査の穴になる。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rust のコア

**Files:**
- Create: `crates/calcarc-core/src/finance/compound_inverse.rs`
- Modify: `crates/calcarc-core/src/finance/mod.rs`（`pub mod compound_inverse;` を 1 行）

**Interfaces:**
- Consumes: `super::compound::{grow, Growth, MAX_PERIODS}`、`super::tax::withholding`、
  `super::loan::rate::Rate`
- Produces:
  ```rust
  pub struct Solution {
      pub deposit: u64,
      pub periods: u32,
      pub growth: Growth,
      pub national_tax: u64,
      pub local_tax: u64,
      pub net: u64,
  }
  pub fn deposit_for(principal: u64, rate: &Rate, periods: u32, target: u64, taxed: bool)
      -> CalcResult<Solution>;
  pub fn periods_for(principal: u64, deposit: u64, rate: &Rate, target: u64, taxed: bool)
      -> CalcResult<Solution>;
  ```
  税 OFF のとき `national_tax` と `local_tax` は 0、`net` は `growth.final_balance`。

設計書 §2 §4 §5 を読むこと。**`grow` と `tax::withholding` は 1 行も変えない。**

- [ ] **Step 1: 失敗するテストを書く**

`compound_inverse.rs` を作り、まず `mod tests` だけ書く（本体は次のステップ）。

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_deposit_is_the_smallest_that_does_not_fall_short() {
        // 設計書 §7 の必須ケース #1。golden と同じ入力・同じ答。
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let s = deposit_for(0, &r, 240, 10_000_000, false).unwrap();
        assert_eq!(s.deposit, 30_461);
        assert_eq!(s.growth.final_balance, 10_000_251);
        // 定義の両側: 1 円少ないと届かない。
        let less = crate::finance::compound::grow(0, s.deposit - 1, &r, 240).unwrap();
        assert!(less.final_balance < 10_000_000);
    }

    #[test]
    fn the_periods_answer_survives_the_dip_that_follows_it() {
        // **この spec の存在理由**（設計書 §3）。19 で届き、20 で下回る。
        let r = Rate::from_annual_percent("1.5", 12).unwrap();
        let s = periods_for(999, 0, &r, 1016, true).unwrap();
        assert_eq!(s.periods, 19);
        assert_eq!(s.net, 1016);
        // 20 期は目標を下回る。二分探索ならここで道を誤る。
        let g20 = crate::finance::compound::grow(999, 0, &r, 20).unwrap();
        let (n20, l20) = crate::finance::tax::withholding(g20.interest).unwrap();
        assert_eq!(g20.final_balance - n20 - l20, 1015);
    }

    #[test]
    fn zero_rate_is_an_integer_ceiling() {
        let r = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(deposit_for(0, &r, 240, 12_000_000, false).unwrap().deposit, 50_000);
        assert_eq!(deposit_for(0, &r, 240, 12_000_001, false).unwrap().deposit, 50_001);
    }

    #[test]
    fn a_target_already_met_needs_one_period_and_no_deposit() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        assert_eq!(periods_for(1_000_000, 0, &r, 500_000, false).unwrap().periods, 1);
        assert_eq!(deposit_for(1_000_000, &r, 12, 500_000, false).unwrap().deposit, 0);
    }

    #[test]
    fn the_inversions_agree_with_each_other() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let d = deposit_for(0, &r, 240, 10_000_000, false).unwrap();
        assert_eq!(periods_for(0, d.deposit, &r, d.growth.final_balance, false).unwrap().periods, 240);
    }

    #[test]
    fn the_error_table() {
        let r = Rate::from_annual_percent("3", 12).unwrap();
        let zero = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(deposit_for(0, &r, 240, 0, false), Err(CalcError::SyntaxError));
        assert_eq!(periods_for(1_000_000, 0, &r, 0, false), Err(CalcError::SyntaxError));
        assert_eq!(deposit_for(0, &r, 0, 1_000_000, false), Err(CalcError::SyntaxError));
        assert_eq!(
            deposit_for(0, &r, MAX_PERIODS + 1, 1_000_000, false),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(periods_for(0, 0, &r, 1_000_000, false), Err(CalcError::SyntaxError));
        // 増える源が無いので 1200 期でも届かない = 発散。
        assert_eq!(
            periods_for(1_000_000, 0, &zero, 2_000_000, false),
            Err(CalcError::SyntaxError)
        );
    }

    #[test]
    fn an_unreachable_target_overflows_instead_of_looping() {
        // **1 期ではなく 2 期であることに意味がある。** 0%・1 期なら答は
        // ちょうど u64::MAX で、あふれずに収まってしまう(残高 = 積立額)。
        // 2 期なら 2d ≥ u64::MAX が要り、最小の d = 2^63 で残高が 2^64 に
        // なってあふれる。
        let zero = Rate::from_annual_percent("0", 12).unwrap();
        assert_eq!(deposit_for(0, &zero, 2, u64::MAX, false), Err(CalcError::Overflow));
        // 1 期なら答が出る側。境界の両側を押さえる。
        assert_eq!(deposit_for(0, &zero, 1, u64::MAX, false).unwrap().deposit, u64::MAX);
    }
}
```

- [ ] **Step 2: 赤を見る**

```bash
cd /home/terapyon/dev/CalcArc && cargo test -p calcarc-core compound_inverse 2>&1 | head -20
```

期待: コンパイルエラー（`deposit_for` が無い）。

- [ ] **Step 3: 実装する**

```rust
//! 目標額からの逆算 2 種(設計書 2026-08-15)。
//!
//! **f64 を 1 つも使わない。** ローンが種を要ったのは期間が数万回になりうる
//! うえ償還表が高価だったからで、複利は期数が MAX_PERIODS で頭打ちである。
//!
//! **必要年数に二分探索を使ってはならない**——手取りは期数について単調でない
//! (numerical-policy「手取りは期数について単調でない」)。積立額については
//! 単調なので、そちらは二分探索でよい。

use super::compound::{grow, Growth, MAX_PERIODS};
use super::loan::rate::Rate;
use super::tax::withholding;
use crate::{CalcError, CalcResult};

/// 逆算の答と、その答における全体像。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Solution {
    pub deposit: u64,
    pub periods: u32,
    pub growth: Growth,
    pub national_tax: u64,
    pub local_tax: u64,
    pub net: u64,
}

/// 目標と比べる値。税 ON なら手取り、OFF なら残高(設計書 §2)。
fn reached(balance: u64, interest: u64, taxed: bool) -> CalcResult<u64> {
    if !taxed {
        return Ok(balance);
    }
    let (national, local) = withholding(interest)?;
    balance
        .checked_sub(national)
        .and_then(|v| v.checked_sub(local))
        .ok_or(CalcError::Overflow)
}

fn solution(deposit: u64, periods: u32, growth: Growth, taxed: bool) -> CalcResult<Solution> {
    let (national, local) = if taxed {
        withholding(growth.interest)?
    } else {
        (0, 0)
    };
    let net = growth
        .final_balance
        .checked_sub(national)
        .and_then(|v| v.checked_sub(local))
        .ok_or(CalcError::Overflow)?;
    Ok(Solution {
        deposit,
        periods,
        growth,
        national_tax: national,
        local_tax: local,
        net,
    })
}

/// 目標を下回らない最小の積立額。**単調なので二分探索でよい**(設計書 §3)。
pub fn deposit_for(
    principal: u64,
    rate: &Rate,
    periods: u32,
    target: u64,
    taxed: bool,
) -> CalcResult<Solution> {
    if target == 0 || periods == 0 || periods > MAX_PERIODS {
        return Err(CalcError::SyntaxError);
    }
    // **Overflow は「届く側」として扱う**——探索を u64 の定義域で閉じるため。
    // 選ばれた答は最後に必ず grow を走らせるので、収まらないなら Overflow が出る。
    let probe = |d: u64| -> bool {
        match grow(principal, d, rate, periods) {
            Ok(g) => matches!(reached(g.final_balance, g.interest, taxed), Ok(v) if v >= target),
            Err(CalcError::Overflow) => true,
            Err(_) => false,
        }
    };
    // **`principal > 0` の条件は要る**——`grow(0, 0, ...)` は「入れた金がゼロ」で
    // SyntaxError を返す。`probe` の `Err(_) => false` に頼ると、元本 0 のときに
    // 「積立 0 では届かない」を偶然の経路で得ることになる。条件で言い切る。
    let answer = if principal > 0 && probe(0) {
        0
    } else {
        let mut low = 0u64; // 届かない側
        let mut high = 1u64;
        while !probe(high) {
            low = high;
            if high == u64::MAX {
                return Err(CalcError::Overflow);
            }
            high = high.saturating_mul(2);
        }
        while high - low > 1 {
            let mid = low + (high - low) / 2;
            if probe(mid) {
                high = mid;
            } else {
                low = mid;
            }
        }
        high
    };
    let growth = grow(principal, answer, rate, periods)?;
    solution(answer, periods, growth, taxed)
}

/// 目標を下回らない最小の期数。**最初に届いた期**を前進 1 本で見つける。
///
/// 二分探索を使わないのは手取りが期数について単調でないからで、これは
/// 効率の話ではなく正しさの話である(設計書 §3)。
pub fn periods_for(
    principal: u64,
    deposit: u64,
    rate: &Rate,
    target: u64,
    taxed: bool,
) -> CalcResult<Solution> {
    if target == 0 {
        return Err(CalcError::SyntaxError);
    }
    if principal == 0 && deposit == 0 {
        return Err(CalcError::SyntaxError);
    }
    let mut balance = principal;
    let mut principal_total = principal;
    for n in 1..=MAX_PERIODS {
        balance = balance
            .checked_add(rate.interest_floor(balance)?)
            .and_then(|b| b.checked_add(deposit))
            .ok_or(CalcError::Overflow)?;
        principal_total = principal_total
            .checked_add(deposit)
            .ok_or(CalcError::Overflow)?;
        // 利率は非負なので投入合計を下回らないが、契約として checked のまま引く。
        let interest = balance
            .checked_sub(principal_total)
            .ok_or(CalcError::Overflow)?;
        if reached(balance, interest, taxed)? >= target {
            return solution(
                deposit,
                n,
                Growth {
                    final_balance: balance,
                    principal_total,
                    interest,
                },
                taxed,
            );
        }
    }
    // 1,200 期でも届かない = 事実上の発散(ローンの term_for と同じ扱い)。
    Err(CalcError::SyntaxError)
}
```

`mod.rs` に `pub mod compound_inverse;` を足す。

- [ ] **Step 4: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc
cargo test -p calcarc-core compound_inverse
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt
```

期待: 7 件緑。`unwrap_used` の lint に当たらないこと（テストは除外されている）。

- [ ] **Step 5: 赤確認 #1（設計書 §9） — 二分探索に差し替えると赤になるか**

**この計画で最も重要な赤確認である。**

`periods_for` の前進ループを、一時的に二分探索に差し替える（`MAX_PERIODS` を
上限に「届く最小の n」を挟み撃ちする形）。

```bash
cd /home/terapyon/dev/CalcArc && cargo test -p calcarc-core compound_inverse
```

期待: **`the_periods_answer_survives_the_dip_that_follows_it` が赤**
（二分探索は 20 期を見て「まだ届いていない」と判断し、21 以降を探す）。

**赤にならなかったら止めて報告する**——非単調性を捕まえるテストが足りていない。

編集で元に戻し（`git checkout` を使わない）、`git diff` で差分が意図どおりに
戻っていることを確かめる。

- [ ] **Step 6: 赤確認 #4（設計書 §9） — 端の向き**

`deposit_for` の答を `high` から `low` に変える。

期待: **`the_deposit_is_the_smallest_that_does_not_fall_short` が赤**（30,460 になる）。
編集で戻す。

- [ ] **Step 7: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add crates/calcarc-core/src/finance/ && git commit -m "$(cat <<'EOF'
Invert the compound growth, walking forward where bisection would lie

必要積立額は二分探索(手取りは積立額について単調)。必要年数は前進 1 本
——手取りは期数について単調でないので、二分探索は静かに間違った答を返す。

赤確認: 前進を二分探索に差し替えると 999 円・目標 1,016 のケースが赤になる。
端を low にすると 1 円足りない答になって赤。どちらも見た。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: golden ハーネスを 2 op に広げる

**Files:**
- Modify: `crates/calcarc-core/tests/finance_golden.rs`

**Interfaces:**
- Consumes: Task 5 の `compound_inverse::{deposit_for, periods_for, Solution}`、
  Task 3 の `testdata/finance.json`
- Produces: なし（テスト）

- [ ] **Step 1: `Input` に `target` を足す**

複利の欄の隣に:

```rust
    #[serde(default)]
    target: Option<String>,
```

- [ ] **Step 2: `run()` に 2 アームを足す**

`run()` の先頭、`compound_grow` の分岐の隣に:

```rust
    if op == "compound_deposit_for" || op == "compound_periods_for" {
        return run_compound_inverse(op, input);
    }
```

そして `run_compound` の隣に:

```rust
/// 逆算 2 op。**答の key だけが違い、内訳は compound_grow と同じ形**である。
fn run_compound_inverse(op: &str, input: &Input) -> Result<BTreeMap<String, String>, CalcError> {
    let rate = Rate::from_annual_percent(
        &input.rate,
        input.periods_per_year.ok_or(CalcError::SyntaxError)?,
    )?;
    let target = input.yen(&input.target)?;
    let taxed = input.tax == Some(true);
    let mut out = BTreeMap::new();
    let s = if op == "compound_deposit_for" {
        let s = compound_inverse::deposit_for(
            input.yen(&input.principal)?,
            &rate,
            input.periods.ok_or(CalcError::SyntaxError)?,
            target,
            taxed,
        )?;
        field(&mut out, "deposit", s.deposit);
        s
    } else {
        let s = compound_inverse::periods_for(
            input.yen(&input.principal)?,
            input.yen(&input.deposit)?,
            &rate,
            target,
            taxed,
        )?;
        field(&mut out, "periods", s.periods);
        s
    };
    field(&mut out, "final_balance", s.growth.final_balance);
    field(&mut out, "principal_total", s.growth.principal_total);
    field(&mut out, "interest", s.growth.interest);
    if taxed {
        field(&mut out, "national_tax", s.national_tax);
        field(&mut out, "local_tax", s.local_tax);
        field(&mut out, "net", s.net);
    }
    Ok(out)
}
```

`use` に `compound_inverse` を足す。

- [ ] **Step 3: カバレッジ検査に 2 行足す**

`for op in [...]` の配列に `"compound_deposit_for"` と `"compound_periods_for"` を足す。

- [ ] **Step 4: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc && cargo test --workspace
```

期待: **Rust の総数が 223 + 7（Task 5）+ golden の 13 件ぶん**。golden は 1 テストで
全ケースを回すので件数は増えないはずである——**実際の数を報告に書く**。
`testdata/` の差分が空であること。

- [ ] **Step 5: 赤確認 #5（設計書 §9）**

`testdata/finance.json` から `compound_deposit_for` のケースを一時的に全部消す。

期待: **`no golden case for compound_deposit_for` で赤。** 編集で戻す。

- [ ] **Step 6: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add crates/calcarc-core/tests/finance_golden.rs && git commit -m "$(cat <<'EOF'
Wire the golden harness to the two inverse ops

Input に target を 1 つ、run に 2 アーム、カバレッジに 2 行。内訳の key は
compound_grow と同じ形なので、違うのは答の key だけである。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 単調性の総当たりを Rust の検査として残す

**Files:**
- Modify: `crates/calcarc-core/src/finance/compound_inverse.rs`（`mod tests` に追加）

**Interfaces:**
- Consumes: Task 5 のすべて
- Produces: なし（テスト）

設計書 §3 と §15 を読むこと。**spec が主張した単調性を、検査としてリポジトリに残す。**

- [ ] **Step 1: テストを書く**

```rust
    #[test]
    fn the_net_is_monotone_in_the_deposit() {
        // **§3 の証明を検査として残す。** 二分探索の正当性はこれに依存している。
        // 範囲は設計書 §15 の総当たりの縮小版(テスト時間に収める)。
        for percent in ["0", "0.0001", "1.5", "3", "20"] {
            for ppy in [1u32, 2, 12] {
                let r = Rate::from_annual_percent(percent, ppy).unwrap();
                for periods in [1u32, 2, 3, 12, 240] {
                    for principal in [0u64, 999, 1_000_000] {
                        let mut previous = 0u64;
                        for d in 0..200u64 {
                            let g = grow(principal, d, &r, periods).unwrap();
                            let v = reached(g.final_balance, g.interest, true).unwrap();
                            assert!(
                                v >= previous,
                                "手取りが減った: {percent}% ppy={ppy} n={periods} P={principal} d={d}"
                            );
                            previous = v;
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_net_is_not_monotone_in_the_periods() {
        // **非単調は仕様である**(numerical-policy)。ここが緑でなくなったら、
        // 税の丸めが変わったということなので、前進 1 本の根拠を読み直す。
        let r = Rate::from_annual_percent("1.5", 12).unwrap();
        let net_at = |n: u32| {
            let g = grow(999, 0, &r, n).unwrap();
            reached(g.final_balance, g.interest, true).unwrap()
        };
        assert_eq!(net_at(19), 1016);
        assert_eq!(net_at(20), 1015); // 減る
        assert_eq!(net_at(21), 1016);
    }
```

- [ ] **Step 2: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc && cargo test -p calcarc-core compound_inverse
```

期待: 9 件緑。総当たりに時間がかかりすぎるなら範囲を減らし、**減らしたことと
減らした範囲を報告に書く**（黙って縮めない）。

- [ ] **Step 3: 赤確認 #3 相当**

`the_net_is_not_monotone_in_the_periods` の `net_at(20)` の期待を `1016` に変える。

期待: **赤**（実際は 1015）。編集で戻す。

- [ ] **Step 4: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add crates/calcarc-core/src/finance/compound_inverse.rs && git commit -m "$(cat <<'EOF'
Keep the monotonicity claims as tests, both of them

積立額について単調(二分探索の根拠)と、期数について非単調(前進 1 本の根拠)。
どちらも spec の主張なので、リポジトリに検査として残す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: WASM 境界

**Files:**
- Modify: `crates/calcarc-wasm/src/lib.rs`
- Modify: `crates/calcarc-wasm/tests/`（既存の複利テストの隣）

**Interfaces:**
- Consumes: Task 5 の `compound_inverse`
- Produces: `compound_deposit_for(principal, target, rate, periods_per_year, periods, tax)` と
  `compound_periods_for(principal, deposit, target, rate, periods_per_year, tax)`。
  どちらも `CompoundResult` を拡張した形（`deposit` / `periods` を足したもの）を返す。

設計書 §10 を読むこと。**JavaScript 例外を投げない。エラーは戻り値の一部。**

- [ ] **Step 1: 結果型を足す**

**既存の `CompoundResult` は触らない**——`compound_grow` の出力に余分な `null` を
増やさないため。`CompoundResult` の直後に新しい型を置く。

```rust
/// 逆算の結果。**答（`deposit` か `periods`）と、その答における全体像**。
///
/// `CompoundResult` と分けてあるのは、`compound_grow` の出力に常に `null` の
/// `deposit` / `periods` が混ざるのを避けるためである。
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompoundInverseResult {
    /// 必要積立額。`compound_periods_for` では入力そのまま。
    deposit: Option<String>,
    /// 必要期数。`compound_deposit_for` では入力そのまま。
    periods: Option<String>,
    final_balance: Option<String>,
    principal_total: Option<String>,
    interest: Option<String>,
    national_tax: Option<String>,
    local_tax: Option<String>,
    net: Option<String>,
    error: Option<CalcError>,
}

/// `Solution` を境界の形に詰める。**税 OFF のとき税の 3 項目は `None`**
/// ——`compound_grow` が同じ扱いなので、TS 側の読み方を揃える。
fn inverse_result(s: compound_inverse::Solution, taxed: bool) -> CompoundInverseResult {
    CompoundInverseResult {
        deposit: Some(s.deposit.to_string()),
        periods: Some(s.periods.to_string()),
        final_balance: Some(s.growth.final_balance.to_string()),
        principal_total: Some(s.growth.principal_total.to_string()),
        interest: Some(s.growth.interest.to_string()),
        national_tax: taxed.then(|| s.national_tax.to_string()),
        local_tax: taxed.then(|| s.local_tax.to_string()),
        net: taxed.then(|| s.net.to_string()),
        error: None,
    }
}
```

- [ ] **Step 2: 2 関数を書く**

**計算は 1 行も書かない**——`compound_inverse` を呼ぶだけ。

```rust
/// 目標額から必要な積立額を求める。**目標を下回らない最小**(設計書 §1 の裁定 4)。
///
/// 税 ON のとき `target` は**手取り**と比べられる(設計書 §2)。
#[wasm_bindgen]
pub fn compound_deposit_for(
    principal: &str,
    target: &str,
    rate: &str,
    periods_per_year: u32,
    periods: u32,
    tax: bool,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        let rate = Rate::from_annual_percent(rate, periods_per_year)?;
        compound_inverse::deposit_for(parse_yen(principal)?, &rate, periods, parse_yen(target)?, tax)
    })();
    let result = match outcome {
        Ok(s) => inverse_result(s, tax),
        Err(e) => CompoundInverseResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}

/// 目標額から必要な期数を求める。**最初に届いた期**を返す。
///
/// **その次の期が目標を下回ることがある**——手取りは期数について単調でない
/// (numerical-policy)。仕様であって不具合ではない。
#[wasm_bindgen]
pub fn compound_periods_for(
    principal: &str,
    deposit: &str,
    target: &str,
    rate: &str,
    periods_per_year: u32,
    tax: bool,
) -> JsValue {
    let outcome: CalcResult<_> = (|| {
        let rate = Rate::from_annual_percent(rate, periods_per_year)?;
        compound_inverse::periods_for(
            parse_yen(principal)?,
            parse_yen(deposit)?,
            &rate,
            parse_yen(target)?,
            tax,
        )
    })();
    let result = match outcome {
        Ok(s) => inverse_result(s, tax),
        Err(e) => CompoundInverseResult {
            error: Some(e),
            ..Default::default()
        },
    };
    to_js_value(&result)
}
```

`use` に `compound_inverse` を足す。

- [ ] **Step 3: wasm テストを足す**

既存の複利の wasm テストの隣に、必須ケース #1 と #4 を置く。**エラーが例外ではなく
戻り値の `error` に出ることも確かめる**（目標 0）。

- [ ] **Step 4: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc
wasm-pack test --headless --chrome crates/calcarc-wasm
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt
```

期待: 24 + 3 件。手元の chromedriver が合わなければ Firefox で回し、**そのことを
報告に書く**（CI は chrome 固定）。

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add crates/calcarc-wasm/ && git commit -m "$(cat <<'EOF'
Expose the two inversions across the wasm boundary

計算は持たない。エラーは戻り値の一部で、例外は投げない。compound_grow の
出力に null を増やさないよう、逆算は別の結果型にする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: TS ラッパー

**Files:**
- Modify: `web/src/finance/types.ts`
- Modify: `web/src/finance/index.ts`

**Interfaces:**
- Consumes: Task 8 の wasm エクスポート
- Produces: `FinanceCalc` に `depositFor(...)` と `periodsFor(...)`。
  型 `CompoundInverseResult`（`deposit: string | null`、`periods: string | null`、
  以下 `CompoundResult` と同じ）。

**`web/src/finance/` に React を import しない。**
**`FinanceCalc` / `initFinance` の改名はしない**（設計書 §10。altitude の問題は別作業）。

- [ ] **Step 1: 型を足す**

`types.ts` の `CompoundResult` の直後。**既存の型は 1 行も動かさない。**

```ts
/**
 * 逆算の結果。**答（`deposit` か `periods`）と、その答における全体像**。
 *
 * 税の 3 項目が `null` になる条件は `CompoundResult` と同じ（税を求めなかったとき）。
 */
export interface CompoundInverseResult {
  /** 必要積立額。必要年数を求めたときは入力そのまま。 */
  deposit: string | null;
  /** 必要期数。必要積立額を求めたときは入力そのまま。 */
  periods: string | null;
  finalBalance: string | null;
  principalTotal: string | null;
  interest: string | null;
  nationalTax: string | null;
  localTax: string | null;
  net: string | null;
  error: CompoundErrorCode | null;
}
```

- [ ] **Step 2: メソッドを足す**

`index.ts` の `FinanceCalc` に 2 つ。既存の `grow` と同じ形（wasm を呼んで `as` で
型を付けるだけ。**計算を書かない**）。

```ts
  /**
   * 目標額から必要な積立額を求める。**目標を下回らない最小**を返す。
   * 税 ON のとき `target` は手取りと比べられる。
   */
  depositFor(
    principal: string,
    target: string,
    rate: string,
    periodsPerYear: PeriodsPerYear,
    periods: number,
    tax: boolean,
  ): CompoundInverseResult;

  /**
   * 目標額から必要な期数を求める。**最初に届いた期**を返す。
   *
   * **その次の期が目標を下回ることがある**——手取りは期数について単調でない
   * （numerical-policy）。仕様であって不具合ではない。
   */
  periodsFor(
    principal: string,
    deposit: string,
    target: string,
    rate: string,
    periodsPerYear: PeriodsPerYear,
    tax: boolean,
  ): CompoundInverseResult;
```

`initFinance()` の中の実装も `grow` と同じ形で足し、`import` と `export type` に
`compound_deposit_for` / `compound_periods_for` / `CompoundInverseResult` を加える。

- [ ] **Step 3: 型検査**

```bash
cd /home/terapyon/dev/CalcArc/web && pnpm wasm && pnpm typecheck && pnpm lint && pnpm test
```

期待: vitest **141 passed** のまま（UI はまだ触っていない）。

- [ ] **Step 4: コミット**（メッセージは 1 行目 `Wrap the two inversions for the web`）

---

### Task 10: 盤面にモードを 2 つ足す

**Files:**
- Modify: `web/src/ui/Keypad/finance.ts`
- Modify: `web/src/ui/Keypad/finance.test.ts`
- Modify: `web/src/ui/Finance/FinancePanel.tsx`
- Modify: `web/src/ui/Finance/FinancePanel.test.tsx`
- Modify: `web/tests/e2e/`（新規 spec 1 本）

**Interfaces:**
- Consumes: Task 9 の `depositFor` / `periodsFor`
- Produces: `FinanceKeyToken` に `"mode:deposit-for"` `"mode:periods-for"` `"field:target"`。
  `FinanceField` に `"target"`。`PanelMode` に `"deposit-for" | "periods-for"`。

設計書 §11 を読むこと。

- [ ] **Step 1: キー集合を広げる**

`MODES` の `columns` を 4 → **6** にし、キーを 2 つ足す。

```ts
    {
      token: "mode:deposit-for",
      label: "必要積立",
      ariaLabel: "必要な積立額を求める",
      variant: "function",
    },
    {
      token: "mode:periods-for",
      label: "必要年数",
      ariaLabel: "必要な期間を求める",
      variant: "function",
    },
```

項目行は 2 つ足す。**`COMPOUND_FIELDS` を書き写さず、そこから 1 キーだけ差し替えて
作る**——6 キーを 3 回書くと、片方だけ直す事故が生まれる。

```ts
/** 目標額のキー。2 つの逆算で共有する（同じ意味の欄である）。 */
const TARGET_KEY: KeyDef<FinanceKeyToken> = {
  token: "field:target",
  label: "目標",
  ariaLabel: "目標額を入力",
  variant: "function",
};

/** 1 キーだけ差し替えた項目行を作る。**行の形と区画名は動かさない。** */
function fieldsWith(
  replaced: FinanceKeyToken,
  key: KeyDef<FinanceKeyToken>,
): KeypadSection<FinanceKeyToken> {
  return {
    ...COMPOUND_FIELDS,
    keys: COMPOUND_FIELDS.keys.map((k) => (k.token === replaced ? key : k)),
  };
}

/** 必要積立額の項目。**積立の代わりに目標**が出る(設計書 §11)。 */
const DEPOSIT_FOR_FIELDS = fieldsWith("field:deposit", TARGET_KEY);

/** 必要年数の項目。**期間の代わりに目標**が出る。 */
const PERIODS_FOR_FIELDS = fieldsWith("field:months", TARGET_KEY);

export const DEPOSIT_FOR_FIELD_SECTION = DEPOSIT_FOR_FIELDS;
export const PERIODS_FOR_FIELD_SECTION = PERIODS_FOR_FIELDS;
```

`KeyDef` を `./types` から import する。区画の `ariaLabel` は
**「入力する項目」のまま**（E2E のセレクタなので変えない）。

**`fieldsWith` の検査を `finance.test.ts` に足す**——差し替えが 1 キーだけであり、
列数・高さ・区画名が動いていないこと。

```ts
it("swaps exactly one key for the target field", () => {
  expect(DEPOSIT_FOR_FIELD_SECTION.keys).toHaveLength(6);
  expect(DEPOSIT_FOR_FIELD_SECTION.columns).toBe(6);
  expect(DEPOSIT_FOR_FIELD_SECTION.ariaLabel).toBe("入力する項目");
  expect(DEPOSIT_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
    "field:principal",
    "field:target",
    "field:rate",
    "field:months",
    "field:periods",
    "field:tax",
  ]);
  expect(PERIODS_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
    "field:principal",
    "field:deposit",
    "field:rate",
    "field:target",
    "field:periods",
    "field:tax",
  ]);
});
```

- [ ] **Step 2: キー集合のテストを直す**

`finance.test.ts` の「モード行は 4 キー」を **6** に、`columns` を **6** に直す。
**それ以外の期待値（区画名の並び、数字面の 5×5、予約スロット 2 つ）は動かさない。**

- [ ] **Step 3: パネルを広げる**

`PanelMode` に 2 つ足し、`SOLVED_FOR` / `MODE_STATUS` / `FIELD_LABELS` /
`FIELD_UNITS` に対応する行を足す。

```ts
const SOLVED_FOR: Record<PanelMode, FinanceField | null> = {
  // ...既存...
  "deposit-for": "deposit",   // 積立額が答なので入力できない
  "periods-for": "months",    // 期間が答なので入力できない
};

const MODE_STATUS: Record<PanelMode, string> = {
  // ...既存...
  "deposit-for": "必要な積立額を求める",
  "periods-for": "必要な期間を求める",
};
```

`FIELD_LABELS` に `target: "目標額"`、`FIELD_UNITS` に `target: "円"`。

**値の入れ物**: 複利と共有しない（F1 が「ローンの値を持ち回らない」と決めたのと
同じ理由）。接頭辞は `deposit-for:` と `periods-for:`。**ただし目標額だけは
2 つの逆算で共有する**（同じ意味の欄である）——キーは `target` 固定にする。

答の出し方は既存の複利と同じ（必要な項目が埋まったら計算する。`=` は要らない）。

- [ ] **Step 4: パネルのテストを足す**

**押した結果を見る検査**にすること（押せるかどうかだけを見ない）。

```tsx
  it("solves for the deposit and shows what it lands on", async () => {
    // 設計書 §7 の必須ケース #1。元本 0・年 3%・月次・240 期・目標 1,000 万。
    // 期待: 積立 30,461 円、残高 10,000,251 円。
  });

  it("keeps the periods answer even though the next period dips below", async () => {
    // 非単調(設計書 §3 帰結 2)。19 期と出ること。
  });
```

- [ ] **Step 5: 緑を見る**

```bash
cd /home/terapyon/dev/CalcArc/web && pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 6: E2E を 1 本足す**

`web/tests/e2e/finance-inverse.spec.ts`。**region 起点で引く**（区画名は Data Scale と
同名のものがある）。必要積立額を 1 本、必要年数を 1 本。

```bash
cd /home/terapyon/dev/CalcArc/web && pnpm e2e
```

期待: 82 + 2 件。

- [ ] **Step 7: スクリーンショットを撮る**

**モード行が 6 つになるので、390×844 で撮って目視する**（[[ui-changes-need-a-screenshot]]:
テスト全緑でも「押せる場所に見えるか」は撮らないと分からない）。撮ったら preview を
落とす（4179 の再利用事故）。

確かめること: モード行 6 キーが 1 行に収まる／44px を割っていない／`AC`・`DEL` の
位置が 3 タブで揃ったまま。

- [ ] **Step 8: コミット**

```bash
cd /home/terapyon/dev/CalcArc
test "$(git branch --show-current)" = feature/compound-inverse && \
git add web/ && git commit -m "$(cat <<'EOF'
Put the two inversions on the keypad

モード行を 4 から 6 へ。求める項目が消えて目標が出るのは既存の SOLVED_FOR の
仕組みそのままで、値の入れ物はモードごとに分ける——欄の名前が同じでも意味が
違うため。目標額だけは 2 つの逆算で共有する。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: ブランチ末尾のフルスイープ

**Files:** なし（検証のみ）

- [ ] **Step 1: 全段を回す**

```bash
cd /home/terapyon/dev/CalcArc
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
wasm-pack test --headless --chrome crates/calcarc-wasm
cd reference && uv run pytest && uv run python scripts/generate.py
cd ../web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

- [ ] **Step 2: 再生成の差分がゼロであることを示す**

```bash
cd /home/terapyon/dev/CalcArc && git status --short testdata/
```

期待: **無出力**。

- [ ] **Step 3: 既存 golden が動いていないことを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff -U0 origin/main -- testdata/finance.json | grep '^-' | grep -v '^---'
```

期待: **無出力**（追加のみ）。

- [ ] **Step 4: 段の順序を示す**

```bash
cd /home/terapyon/dev/CalcArc && git log --oneline --reverse origin/main..HEAD
```

期待: 数値方針 → Python → golden → 証明書 → Rust → ハーネス → 単調性 → wasm →
TS → UI の順。**Python + golden のコミットが Rust より前にあること。**

- [ ] **Step 5: 完了報告**

設計書 §14 の 6 項目に 1 つずつ答える。特に:

- **赤確認 5 種の結果**——とりわけ「二分探索に差し替えると #4 が赤」を見たこと
- **証明書検査の 1 点 / 全数の比較表**が設計書 §9 のとおりになったこと
- 各層のテスト件数（Rust / wasm / Python / vitest / e2e / golden）
- スクリーンショットで確かめたこと
- push と PR は行っていない

## スコープ外

- 必要元本（一括）・必要利回り
- 期首積立、ボーナス月の増額、途中引き出し
- シミュレータ方式の丸めと実効換算
- `finance/compound/` への分離（`FinanceCalc` の altitude）
- 資産推移表の画面表示
