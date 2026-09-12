# 0.9.2 の検査側（PR A・PR B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローン月額の円境界の許容（上下 1 円・月額 10 億円まで）を native と wasm32 の両方で見張る golden を作り、数値方針の誤った記述を直し、報告書の判定名を改名する。

**Architecture:** 期待値は参照実装の厳密な有理数（`Fraction`）で出し、`testdata/loan_boundary.json` に書く。Rust の native テストと wasm32 のテストが同じ JSON を読み、許容と上限も JSON から読む。判定名は領域の比べ方の表から明示で決める。

**Tech Stack:** Python 3.14（`fractions`、uv は必ず `--no-config`）、Rust（`calcarc-core` / `calcarc-wasm`、`wasm-pack test --headless --chrome`）、TypeScript（heavy、vitest / Playwright）。

**Spec:** `docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md`（`0cab867` で calcarc-1e が承認）

**範囲:** この計画は PR A（設計書 §4・§5）と PR B（§6）だけ。PR C（F1 のシャード、§3）と PR D（上限の `Overflow` の見張り、§4.8）は calcarc-3d の製品の枝に依存するので、**その枝ができてから別の計画を書く**。

## Global Constraints

- 起点は `main` = `674b4df`。**PR A は `docs/0-9-2-verification`（設計書と計画のある枝）に積む。PR B は PR A の先端から切った `heavy/verdict-names` に積む。** 共有の作業木 `/home/terapyon/dev/CalcArc` には触らない。作業木は `scratchpad/wt-092`。
- `git push` と PR 作成はしない（利用者の手番）。`gh auth login` はしない。
- `uv` は必ず `--no-config`（`lock` / `sync` だけでなく `run` も）。`reference/uv.lock` を変えない。
- **許容誤差をテストコードに書かない**。上下 1 円と 10 億円は `testdata/loan_boundary.json` の `tolerance` と `max_monthly_yen` にだけ置く。
- `calcarc-core` は panic しない（`deny(clippy::unwrap_used, clippy::expect_used)` はライブラリ側。統合テストには掛からない）。
- コミット前: `cargo fmt --all`、`cargo clippy --workspace --all-targets -- -D warnings`。reference は `ruff check` と `ruff format --check` の 2 つ。heavy の `pnpm lint` は `tools/` も見る。
- 参照実装の公開関数の docstring に `独立: 別手順／不可能／一部／未確認` を 1 行書く（CLAUDE.md・CONTRIBUTING）。
- 新しい検査は、比べた件数に下限を置き、壊した状態で赤くなることを確かめてから緑にする。赤の確かめの戻しは**再編集か再生成**で行う（`git checkout` でファイルを戻さない）。
- 重い段（`wasm-pack test`・`heavy:power`）は controller が監視役 calcarc-e3 に知らせてから回す。`heavy:ui` はこの作業機で回さない。`pnpm heavy` の前に `ss -ltnp | grep -E ':(4180|4181)\b'` が空であること。
- コミットメッセージの末尾:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NbSckxyibTw2mVbKW34pYp
  ```

## File Structure

| ファイル | 役割 | Task |
|---|---|---|
| `reference/src/calcarc_reference/loan_ref.py` | `monthly_payment_exact` を足す（理論月額の厳密値） | 1 |
| `reference/tests/test_loan_ref.py`（既存なら追記、無ければ新規） | `monthly_payment_exact` の単体 | 1 |
| `reference/src/calcarc_reference/loan_boundary.py`（新規） | 境界の入力を作る（ちょうど・すぐ下・すぐ上 × 残価なし・残価・賞与） | 2 |
| `reference/tests/test_loan_boundary.py`（新規） | 生成した境界が性質を満たすこと・件数・端の網羅 | 2 |
| `reference/scripts/generate.py` | `build_loan_boundary()` と `write("loan_boundary.json", …)` | 2 |
| `testdata/loan_boundary.json`（生成物） | 境界の golden（許容・上限つき） | 2 |
| `crates/calcarc-core/tests/loan_boundary_golden.rs`（新規） | native の Rust で上下 1 円を確かめる | 3 |
| `crates/calcarc-wasm/tests/loan_boundary.rs`（新規） | wasm32 で境界を渡って同じことを確かめる | 4 |
| `docs/numerical-policy.md` | §5 の訂正と新節 | 5 |
| `crates/calcarc-core/src/finance/loan/closed_form.rs` | 註だけを直す（コードは不変） | 5 |
| `reference/tests/test_policy_matches_loan_boundary.py`（新規） | 文書の「上下 1 円・10 億円」と JSON の一致 | 5 |
| `heavy/tests/corpus/report.ts` | `EXACT_AREAS`・`comparisonOf`・`VERDICTS`・`verdictOf`・凡例 | 6 |
| `heavy/tests/corpus/report.spec.ts` | 判定のテストの更新・新設・禁止語 | 6 |
| `heavy/tests/corpus/calls-rules.spec.ts` | 註の旧名 | 6 |
| `docs/corpus-measurements.md` | 冒頭に改名の注記 | 7 |
| `docs/superpowers/specs/2026-08-19-heavy-scientific-ui-report-design.md` | :80 の非目標に日付つきの訂正 | 7 |

---

## PR A（枝 `docs/0-9-2-verification`）

### Task 1: 理論月額の厳密値 `loan_ref.monthly_payment_exact`

**Files:**
- Modify: `reference/src/calcarc_reference/loan_ref.py`（`monthly_payment` の直後に足す。import に `from fractions import Fraction`）
- Test: `reference/tests/test_loan_ref.py`（`ls reference/tests/` で既存のローンのテストのファイル名を確かめ、あればそこへ追記）

**Interfaces:**
- Produces: `loan_ref.monthly_payment_exact(principal: int, num: int, den: int, n: int, residual: int) -> Fraction`。`num/den` は `rate_fraction` が返す**月利**。入力の検査は `monthly_payment` と同じ規則で `LoanError`（`_syntax()`）を投げる。**`_guard_boundary` を通さない。**

- [ ] **Step 1: 失敗するテストを書く**

```python
from fractions import Fraction

from calcarc_reference import loan_ref


def test_the_audit_boundary_is_an_exact_integer():
    # 720,600 円・年 2%・2 か月の理論月額は 361,201 円ちょうど（外部監査 F2、設計書 2026-09-12 §2.3）。
    num, den = loan_ref.rate_fraction("2")
    assert loan_ref.monthly_payment_exact(720_600, num, den, 2, 0) == Fraction(361_201)


def test_the_exact_value_agrees_with_the_decimal_one_away_from_boundaries():
    # 境界から離れた入力では、Decimal 50 桁の月額の切り捨てと一致する。
    num, den = loan_ref.rate_fraction("1.5")
    exact = loan_ref.monthly_payment_exact(30_000_000, num, den, 420, 0)
    assert exact.numerator // exact.denominator == loan_ref.monthly_payment(30_000_000, num, den, 420, 0)


def test_a_residual_moves_the_payment_down():
    num, den = loan_ref.rate_fraction("2")
    plain = loan_ref.monthly_payment_exact(3_000_000, num, den, 60, 0)
    with_residual = loan_ref.monthly_payment_exact(3_000_000, num, den, 60, 1_000_000)
    assert with_residual < plain


def test_zero_rate_follows_the_integer_rule():
    assert loan_ref.monthly_payment_exact(2_999_999, 0, 1200, 12, 0) == Fraction(2_999_999, 12)
    assert loan_ref.monthly_payment_exact(3_000_000, 0, 1200, 12, 600_000) == Fraction(2_400_000, 11)


def test_the_same_inputs_are_refused():
    num, den = loan_ref.rate_fraction("2")
    for args in [(0, num, den, 12, 0), (100, num, den, 0, 0), (100, num, den, 12, 100), (100, num, den, 1, 10)]:
        try:
            loan_ref.monthly_payment_exact(*args)
        except loan_ref.LoanError:
            continue
        raise AssertionError(f"accepted {args}")
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

Run: `cd reference && uv run --no-config pytest tests/test_loan_ref.py -q -k "exact or zero_rate or refused or residual_moves"`
Expected: FAIL（`AttributeError: module 'calcarc_reference.loan_ref' has no attribute 'monthly_payment_exact'`）

- [ ] **Step 3: 実装する**

`loan_ref.py` の `monthly_payment` の直後に:

```python
def monthly_payment_exact(principal: int, num: int, den: int, n: int, residual: int) -> Fraction:
    """理論月額を厳密な有理数で返す（境界専用の golden の期待値、設計書 2026-09-12 §4.2）。

    独立: 一部（式は `closed_form::monthly_payment` と同じ閉形式——残価ありは n−1 回の年金現価と
    n 回後の残価の現在価値——で、演算は厳密な有理数。f64 の評価の誤りは共有しない、式の誤りは共有する）

    **`_guard_boundary` を通さない。** 境界ちょうどの月額こそが見たいものであり、Decimal 50 桁でも
    境界ちょうどでは整数の下に着地する（720,600 円・年 2%・2 か月で 361200.99…）。
    """
    if n == 0 or principal == 0 or residual >= principal:
        raise _syntax()
    if residual > 0 and n < 2:
        raise _syntax()
    if num == 0:
        return Fraction(principal, n) if residual == 0 else Fraction(principal - residual, n - 1)
    r = Fraction(num, den)
    if n == 1:
        return principal * (1 + r)
    base = 1 + r
    m = n if residual == 0 else n - 1
    annuity = (1 - base ** (-m)) / r
    present_value = principal - Fraction(residual) / base**n
    if present_value <= 0:
        raise _syntax()
    return present_value / annuity
```

- [ ] **Step 4: 走らせて通ることを確かめる**

Run: `cd reference && uv run --no-config pytest tests/test_loan_ref.py -q`
Expected: 全件 PASS

- [ ] **Step 5: ゲートとコミット**

```bash
cd reference && uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config mypy && cd ..
git status --porcelain reference/uv.lock   # 空であること
git add reference/src/calcarc_reference/loan_ref.py reference/tests/test_loan_ref.py
git commit -m "Give the loan reference an exact theoretical monthly payment"   # 末尾にトレーラー
```

### Task 2: 境界の入力を作り、`testdata/loan_boundary.json` を書く

**Files:**
- Create: `reference/src/calcarc_reference/loan_boundary.py`
- Create: `reference/tests/test_loan_boundary.py`
- Modify: `reference/scripts/generate.py`（import に `loan_boundary`、`build_loan_boundary()` を `build_finance` の後に、`main` に `write("loan_boundary.json", build_loan_boundary())`）
- Create（生成物）: `testdata/loan_boundary.json`

**Interfaces:**
- Consumes: `loan_ref.monthly_payment_exact`（Task 1）、`loan_ref.rate_fraction` / `half_year` / `run_schedule` / `LoanError` / `U64_MAX`
- Produces: `loan_boundary.build_cases() -> list[dict]`、定数 `MAX_MONTHLY_YEN = 10**9`・`TOLERANCE_YEN = 1`。JSON の形（Task 3・4・5 が読む）:

```json
{
  "schema": 1,
  "generated_by": "...",
  "tolerance": {"below_yen": 1, "above_yen": 1},
  "max_monthly_yen": "1000000000",
  "cases": [
    {"id": "plain/exact/2/2/720600/0", "op": "loan_forward", "set": "plain", "boundary": "exact",
     "input": {"principal": "720600", "rate": "2", "n": 2, "residual": "0"},
     "expect": {"monthly_floor": "361201"}},
    {"id": "bonus/below/…", "op": "loan_bonus_forward", "set": "bonus", "boundary": "below",
     "input": {"principal": "…", "bonus_principal": "…", "rate": "…", "n": 120},
     "expect": {"monthly_floor": "…", "bonus_floor": "…"}}
  ]
}
```

`set` は `plain`（残価なし）・`residual`・`bonus`、`boundary` は `exact`・`below`・`above`。

- [ ] **Step 1: 失敗するテストを書く**（`reference/tests/test_loan_boundary.py`）

```python
from fractions import Fraction

import pytest

from calcarc_reference import loan_boundary, loan_ref

NEAR = Fraction(1, 10**6)


@pytest.fixture(scope="module")
def cases():
    return loan_boundary.build_cases()


def _theory(case) -> tuple[Fraction, Fraction | None]:
    inp = case["input"]
    num, den = loan_ref.rate_fraction(inp["rate"])
    n = inp["n"]
    if case["op"] == "loan_forward":
        return loan_ref.monthly_payment_exact(int(inp["principal"]), num, den, n, int(inp["residual"])), None
    bp = int(inp["bonus_principal"])
    monthly = loan_ref.monthly_payment_exact(int(inp["principal"]) - bp, num, den, n, 0)
    hnum, hden = loan_ref.half_year(num, den)
    bonus = loan_ref.monthly_payment_exact(bp, hnum, hden, n // loan_ref.BONUS_INTERVAL_MONTHS, 0)
    return monthly, bonus


def _kind(a: Fraction) -> str | None:
    fl = a.numerator // a.denominator
    frac = a - fl
    if frac == 0:
        return "exact"
    if 1 - frac <= NEAR:
        return "below"
    if frac <= NEAR:
        return "above"
    return None


def test_every_case_sits_where_its_label_says(cases):
    for case in cases:
        monthly, bonus = _theory(case)
        at_boundary = bonus if case["set"] == "bonus" else monthly
        assert _kind(at_boundary) == case["boundary"], case["id"]
        assert case["expect"]["monthly_floor"] == str(monthly.numerator // monthly.denominator), case["id"]
        if bonus is not None:
            assert case["expect"]["bonus_floor"] == str(bonus.numerator // bonus.denominator), case["id"]


def test_the_payments_stay_under_the_cap(cases):
    floors = [int(v) for c in cases for v in c["expect"].values()]
    assert max(floors) <= loan_boundary.MAX_MONTHLY_YEN
    # 上限の近くも踏む（10 億円の直下まで、設計書 §4.3）。
    assert max(floors) >= loan_boundary.MAX_MONTHLY_YEN // 2


def test_each_cell_has_enough_cases(cases):
    counts = {}
    for c in cases:
        counts[(c["set"], c["boundary"])] = counts.get((c["set"], c["boundary"]), 0) + 1
    for s in ("plain", "residual", "bonus"):
        for b in ("exact", "below", "above"):
            assert counts.get((s, b), 0) >= 20, (s, b, counts)
    assert counts[("plain", "below")] >= 100 and counts[("plain", "above")] >= 100, counts


def test_the_ends_of_rate_and_term_are_covered(cases):
    rates = {c["input"]["rate"] for c in cases}
    terms = {c["input"]["n"] for c in cases}
    assert {"0.0001", "100"} <= rates, rates
    assert {2, 1200} <= terms, terms


def test_ids_are_unique(cases):
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))


def test_each_case_survives_a_payment_one_yen_off(cases):
    # 製品の月額が上下 1 円ずれても償還表がエラーにならない入力だけを採る（テストが Err を踏まない）。
    for case in cases[:: max(1, len(cases) // 200)]:
        inp = case["input"]
        num, den = loan_ref.rate_fraction(inp["rate"])
        if case["op"] == "loan_forward":
            fl = int(case["expect"]["monthly_floor"])
            for pay in (fl - 1, fl, fl + 1):
                loan_ref.run_schedule(int(inp["principal"]), num, den, inp["n"], pay, int(inp["residual"]))
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

Run: `cd reference && uv run --no-config pytest tests/test_loan_boundary.py -q`
Expected: FAIL（`ImportError: cannot import name 'loan_boundary'`）

- [ ] **Step 3: `loan_boundary.py` を書く**

```python
"""境界専用の golden の入力を作る（設計書 2026-09-12 §4.3）。

**狙いは、理論月額が円の境界ちょうど・すぐ下・すぐ上に来る入力**である。重量級と既存の golden は
`loan_ref._guard_boundary` で境界の近くを必ず除くので、ここでしか踏まない。

- ちょうど: 理論月額 = c·P（c は厳密な有理数）。P を c の分母の倍数にすると整数になる。
- すぐ下・すぐ上: c の連分数の近似分母 t で P = t·m, t·m ± 1 にすると、c·P が整数のごく近くに来る。
  整数から `NEAR`（1e-6 円）以内のものだけを採る。
- 残価あり: 理論月額 = c1·P − c2·B。B を c2 の分母の倍数にすると c2·B は整数なので、P の側は残価なしと同じ。
- 賞与: 賞与分は半年利・floor(n/6) 回の残価なしなので、賞与分の元本を上と同じく作る。元本はその 2 倍（上限 50%）。

期待値は `loan_ref.monthly_payment_exact` の切り捨て。**`_guard_boundary` は通さない。**
製品の月額が上下 1 円ずれても償還表がエラーにならない入力だけを採る。
"""

from __future__ import annotations

from collections.abc import Iterator
from fractions import Fraction

from calcarc_reference import loan_ref

MAX_MONTHLY_YEN = 10**9
TOLERANCE_YEN = 1
NEAR = Fraction(1, 10**6)
RATES = ("0.0001", "0.5", "1", "2", "15", "100")
TERMS = (2, 3, 12, 120, 360, 1200)
BONUS_TERMS = (12, 120, 360, 1200)
MULTS = (1, 2, 3, 10, 1_000, 1_000_000)
PER_CELL = 8
U64_MAX = loan_ref.U64_MAX


def _floor(a: Fraction) -> int:
    return a.numerator // a.denominator


def _kind(a: Fraction) -> str | None:
    frac = a - _floor(a)
    if frac == 0:
        return "exact"
    if 1 - frac <= NEAR:
        return "below"
    if frac <= NEAR:
        return "above"
    return None


def _convergent_denominators(c: Fraction, limit: int) -> list[int]:
    """c の連分数の近似分母（t·c が整数に近くなる t）を小さい順に並べる。"""
    qs: list[int] = []
    h0, h1, k0, k1 = 0, 1, 1, 0
    x = c
    while True:
        a = x.numerator // x.denominator
        h0, h1 = h1, a * h1 + h0
        k0, k1 = k1, a * k1 + k0
        if k1 > limit:
            break
        qs.append(k1)
        frac = x - a
        if frac == 0:
            break
        x = 1 / frac
    return qs


def _spread(k_max: int) -> list[int]:
    return sorted({k for k in (1, 2, 3, k_max // 10**6, k_max // 10**3, k_max // 10, k_max) if 1 <= k <= k_max})


def _principals(c: Fraction, offset: int) -> Iterator[tuple[int, Fraction]]:
    """理論月額 = c·P − offset（offset は整数）が境界に来そうな元本 P と、その理論月額を挙げる。"""
    if c.denominator <= U64_MAX and c.numerator > 0:
        for k in _spread((MAX_MONTHLY_YEN + offset) // c.numerator):
            p = c.denominator * k
            yield p, c * p - offset
    for t in _convergent_denominators(c, U64_MAX):
        for mult in MULTS:
            for d in (-1, 0, 1):
                p = t * mult + d
                if 1 <= p <= U64_MAX:
                    yield p, c * p - offset


def _schedule_ok(principal: int, num: int, den: int, n: int, floor_: int, residual: int) -> bool:
    if floor_ < 2:
        return False
    for pay in (floor_ - 1, floor_, floor_ + 1):
        try:
            loan_ref.run_schedule(principal, num, den, n, pay, residual)
        except loan_ref.LoanError:
            return False
    return True


def _forward_case(set_: str, boundary: str, rate: str, n: int, principal: int, residual: int, floor_: int) -> dict:
    return {
        "id": f"{set_}/{boundary}/{rate}/{n}/{principal}/{residual}",
        "op": "loan_forward",
        "set": set_,
        "boundary": boundary,
        "input": {"principal": str(principal), "rate": rate, "n": n, "residual": str(residual)},
        "expect": {"monthly_floor": str(floor_)},
    }


def _plain(rate: str) -> Iterator[dict]:
    num, den = loan_ref.rate_fraction(rate)
    for n in TERMS:
        c = loan_ref.monthly_payment_exact(1, num, den, n, 0)
        taken: dict[str, int] = {}
        for p, a in _principals(c, 0):
            kind = _kind(a)
            if kind is None or taken.get(kind, 0) >= PER_CELL or a > MAX_MONTHLY_YEN:
                continue
            fl = _floor(a)
            if not _schedule_ok(p, num, den, n, fl, 0):
                continue
            taken[kind] = taken.get(kind, 0) + 1
            yield _forward_case("plain", kind, rate, n, p, 0, fl)


def _residual(rate: str) -> Iterator[dict]:
    num, den = loan_ref.rate_fraction(rate)
    r = Fraction(num, den)
    base = 1 + r
    for n in TERMS:
        annuity = (1 - base ** (-(n - 1))) / r
        c1 = 1 / annuity
        c2 = 1 / (base**n * annuity)
        taken: dict[str, int] = {}
        for j in (1, 2, 5):
            b = c2.denominator * j
            if b > 10**12:
                break
            offset = int(c2 * b)
            for p, a in _principals(c1, offset):
                kind = _kind(a)
                if kind is None or taken.get(kind, 0) >= PER_CELL or p <= b or not 0 < a <= MAX_MONTHLY_YEN:
                    continue
                if loan_ref.monthly_payment_exact(p, num, den, n, b) != a:
                    raise AssertionError(f"residual decomposition drifted: {rate} {n} {p} {b}")
                fl = _floor(a)
                if not _schedule_ok(p, num, den, n, fl, b):
                    continue
                taken[kind] = taken.get(kind, 0) + 1
                yield _forward_case("residual", kind, rate, n, p, b, fl)


def _bonus(rate: str) -> Iterator[dict]:
    num, den = loan_ref.rate_fraction(rate)
    hnum, hden = loan_ref.half_year(num, den)
    for n in BONUS_TERMS:
        rows = n // loan_ref.BONUS_INTERVAL_MONTHS
        c = loan_ref.monthly_payment_exact(1, hnum, hden, rows, 0)
        taken: dict[str, int] = {}
        for bp, bonus in _principals(c, 0):
            kind = _kind(bonus)
            if kind is None or taken.get(kind, 0) >= PER_CELL or bonus > MAX_MONTHLY_YEN or 2 * bp > U64_MAX:
                continue
            monthly = loan_ref.monthly_payment_exact(bp, num, den, n, 0)
            fm, fb = _floor(monthly), _floor(bonus)
            if monthly > MAX_MONTHLY_YEN:
                continue
            if not (_schedule_ok(bp, num, den, n, fm, 0) and _schedule_ok(bp, hnum, hden, rows, fb, 0)):
                continue
            taken[kind] = taken.get(kind, 0) + 1
            yield {
                "id": f"bonus/{kind}/{rate}/{n}/{2 * bp}/{bp}",
                "op": "loan_bonus_forward",
                "set": "bonus",
                "boundary": kind,
                "input": {"principal": str(2 * bp), "bonus_principal": str(bp), "rate": rate, "n": n},
                "expect": {"monthly_floor": str(fm), "bonus_floor": str(fb)},
            }


def build_cases() -> list[dict]:
    """境界専用の golden のケースを全部作る。順序は決定的（乱択を使わない）。

    独立: 一部（入力の作り方は分数の性質だけに依り、Rust を読まない。期待値は `monthly_payment_exact`
    の宣言に従う）
    """
    cases: list[dict] = []
    for rate in RATES:
        cases.extend(_plain(rate))
        cases.extend(_residual(rate))
        cases.extend(_bonus(rate))
    ids = [c["id"] for c in cases]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate case id in loan boundary golden")
    return cases
```

- [ ] **Step 4: テストを走らせる**

Run: `cd reference && uv run --no-config pytest tests/test_loan_boundary.py -q`
Expected: 全件 PASS。**件数の下限（`>= 20` / `>= 100`）や端の網羅が満たされないときは、下限を下げずに `MULTS`・`PER_CELL`・残価の `j` を広げ、何を広げたかを報告する。** 満たせないセルが残ったら止めて報告する（BLOCKED）。所要時間も報告に書く。

- [ ] **Step 5: `generate.py` に足して JSON を書く**

`reference/scripts/generate.py` の import に `loan_boundary` を足し、`build_finance` の後に:

```python
def build_loan_boundary() -> dict:
    """境界専用の golden（設計書 2026-09-12 §4）。**許容と上限はここにだけ置く**——Rust のテストは
    ここから読み、テストコードに 1 円も 10 億円も書かない（CLAUDE.md）。"""
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": {"below_yen": loan_boundary.TOLERANCE_YEN, "above_yen": loan_boundary.TOLERANCE_YEN},
        "max_monthly_yen": str(loan_boundary.MAX_MONTHLY_YEN),
        "cases": loan_boundary.build_cases(),
    }
```

`main()` の `write("finance.json", build_finance())` の次に `write("loan_boundary.json", build_loan_boundary())`。

Run: `cd reference && uv run --no-config python scripts/generate.py && cd .. && git status --porcelain testdata/`
Expected: `?? testdata/loan_boundary.json` だけ（**既存の testdata は 1 バイトも変わらない**）。件数を印字から報告に写す。

- [ ] **Step 6: ゲートとコミット**

```bash
cd reference && uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config mypy && uv run --no-config pytest -q && cd ..
git status --porcelain reference/uv.lock   # 空
git add reference/src/calcarc_reference/loan_boundary.py reference/tests/test_loan_boundary.py reference/scripts/generate.py testdata/loan_boundary.json
git commit -m "Build a loan golden that sits on yen boundaries, from exact fractions"   # 末尾にトレーラー
```

### Task 3: native の Rust で上下 1 円を確かめる

**Files:**
- Create: `crates/calcarc-core/tests/loan_boundary_golden.rs`

**Interfaces:**
- Consumes: `testdata/loan_boundary.json`（Task 2 の形）、`calcarc_core::finance::loan::{forward, bonus}`、`calcarc_core::finance::loan::rate::Rate::from_percent`

- [ ] **Step 1: テストを書く**

```rust
//! 境界専用の golden(設計書 2026-09-12 §4)を native で確かめる。
//!
//! **許容と上限はテストコードに書かない**(CLAUDE.md)——`testdata/loan_boundary.json` の
//! `tolerance` と `max_monthly_yen` から読む。製品の算術はブラウザの wasm32 で走るので、
//! **同じ JSON を `crates/calcarc-wasm/tests/loan_boundary.rs` も読む**(両方緑で緑)。
use std::collections::BTreeMap;
use std::path::PathBuf;

use calcarc_core::finance::loan::rate::Rate;
use calcarc_core::finance::loan::{bonus, forward};
use serde::Deserialize;

#[derive(Deserialize)]
struct Golden {
    schema: u32,
    tolerance: Tolerance,
    max_monthly_yen: String,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Tolerance {
    below_yen: u64,
    above_yen: u64,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    op: String,
    set: String,
    boundary: String,
    input: Input,
    expect: Expect,
}

#[derive(Deserialize)]
struct Input {
    principal: String,
    rate: String,
    n: u32,
    #[serde(default)]
    residual: Option<String>,
    #[serde(default)]
    bonus_principal: Option<String>,
}

#[derive(Deserialize)]
struct Expect {
    monthly_floor: String,
    #[serde(default)]
    bonus_floor: Option<String>,
}

#[derive(Default, Debug)]
struct Tally {
    low: u32,
    same: u32,
    high: u32,
}

fn load() -> Golden {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "testdata", "loan_boundary.json"]
        .iter()
        .collect();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}. Run reference/scripts/generate.py", path.display()));
    let golden: Golden = serde_json::from_str(&text).unwrap_or_else(|e| panic!("cannot parse: {e}"));
    assert_eq!(golden.schema, 1, "incompatible schema");
    golden
}

fn yen(text: &str) -> u64 {
    text.parse().unwrap_or_else(|_| panic!("not a yen amount: {text}"))
}

/// `want − below ≤ got ≤ want + above` を見て、ずれの向きを数える。
fn check(got: u64, want: u64, tol: &Tolerance, tally: &mut Tally) -> bool {
    match got.cmp(&want) {
        std::cmp::Ordering::Less => tally.low += 1,
        std::cmp::Ordering::Equal => tally.same += 1,
        std::cmp::Ordering::Greater => tally.high += 1,
    }
    want.saturating_sub(tol.below_yen) <= got && got <= want.saturating_add(tol.above_yen)
}

#[test]
fn monthly_payments_stay_within_the_allowance_on_yen_boundaries() {
    let golden = load();
    let cap = yen(&golden.max_monthly_yen);
    let mut tallies: BTreeMap<String, Tally> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();
    let mut compared = 0usize;
    for case in &golden.cases {
        let rate = Rate::from_percent(&case.input.rate).unwrap_or_else(|e| panic!("{}: rate {e:?}", case.id));
        let principal = yen(&case.input.principal);
        let want_monthly = yen(&case.expect.monthly_floor);
        assert!(want_monthly <= cap, "{}: expectation above the cap", case.id);
        let key = format!("{}/{}", case.set, case.boundary);
        let tally = tallies.entry(key).or_default();
        match case.op.as_str() {
            "loan_forward" => {
                let residual = yen(case.input.residual.as_deref().unwrap_or("0"));
                let out = forward::compute(principal, &rate, case.input.n, residual)
                    .unwrap_or_else(|e| panic!("{}: {e:?}", case.id));
                if !check(out.monthly_payment, want_monthly, &golden.tolerance, tally) {
                    failures.push(format!("{}: monthly {} vs floor {}", case.id, out.monthly_payment, want_monthly));
                }
            }
            "loan_bonus_forward" => {
                let bp = yen(case.input.bonus_principal.as_deref().unwrap_or("0"));
                let want_bonus = yen(case.expect.bonus_floor.as_deref().unwrap_or("0"));
                let out = bonus::compute_forward(principal, bp, &rate, case.input.n)
                    .unwrap_or_else(|e| panic!("{}: {e:?}", case.id));
                if !check(out.monthly_payment, want_monthly, &golden.tolerance, tally) {
                    failures.push(format!("{}: monthly {} vs floor {}", case.id, out.monthly_payment, want_monthly));
                }
                if !check(out.bonus_payment, want_bonus, &golden.tolerance, tally) {
                    failures.push(format!("{}: bonus {} vs floor {}", case.id, out.bonus_payment, want_bonus));
                }
            }
            other => panic!("{}: unknown op {other}", case.id),
        }
        compared += 1;
    }
    // **何かを比べたことを数える**(記憶 tests-can-assert-nothing)。
    assert_eq!(compared, golden.cases.len());
    for set in ["plain", "residual", "bonus"] {
        for boundary in ["exact", "below", "above"] {
            let t = tallies.get(&format!("{set}/{boundary}"));
            assert!(t.is_some_and(|t| t.low + t.same + t.high > 0), "no cases in {set}/{boundary}");
        }
    }
    eprintln!("loan boundary (native): {tallies:?}");
    assert!(failures.is_empty(), "{} outside the allowance:\n{}", failures.len(), failures.join("\n"));
}
```

- [ ] **Step 2: 走らせる**

Run: `cargo test -p calcarc-core --test loan_boundary_golden -- --nocapture`
Expected: PASS。`loan boundary (native): {…}` の印字（集合ごとの low / same / high）を報告に写す。**上下 1 円を超える件が 1 件でも出たら、許容を広げずに止めて報告する**（設計書 §4.7）。

- [ ] **Step 3: 赤を確かめる（3 通り、それぞれ戻してから次へ）**

1. `testdata/loan_boundary.json` の `"below_yen": 1` と `"above_yen": 1` を一時的に 0 に書き換える → 同じコマンドで FAIL（外れた件数が出る。境界ちょうどで low があるはず）。戻しは `cd reference && uv run --no-config python scripts/generate.py`（再生成）で行い、`git status --porcelain testdata/` が空であることを確かめる。
2. `crates/calcarc-core/src/finance/loan/closed_form.rs` の最後の `Ok(a as u64)` を一時的に `Ok((a as u64).saturating_sub(2))` にする → FAIL。戻しは再編集（`git diff --quiet -- crates/calcarc-core/src` で確かめる）。
3. 同じ場所を `Ok(a as u64 + 2)` にする → FAIL。再編集で戻す。

各回の FAIL の印字の要点（外れた件数と 1 件目）を報告に貼る。

- [ ] **Step 4: ゲートとコミット**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p calcarc-core --test loan_boundary_golden
git status --porcelain   # tests/loan_boundary_golden.rs だけ
git add crates/calcarc-core/tests/loan_boundary_golden.rs
git commit -m "Check the monthly payment against yen boundaries in native Rust"   # 末尾にトレーラー
```

### Task 4: wasm32 で同じ JSON を確かめる（レビュー条件 1）

**Files:**
- Create: `crates/calcarc-wasm/tests/loan_boundary.rs`

**Interfaces:**
- Consumes: `testdata/loan_boundary.json`、`calcarc_wasm::loan_forward(principal: &str, rate: &str, months: u32, residual: &str) -> JsValue`、`calcarc_wasm::loan_bonus_forward(principal: &str, bonus_principal: &str, rate: &str, months: u32) -> JsValue`。戻り値は `Outcome` の内部タグ形式: 成功は `{kind: "ok", monthlyPayment: "…", …}`、賞与は `bonusPayment` も持つ。

**★ controller が監視役に知らせてから走らせる**（`wasm-pack test` は wasm のビルドと Chrome を立てる重い段）。

- [ ] **Step 1: テストを書く**

```rust
//! 境界専用の golden(設計書 2026-09-12 §4)を **製品が走る wasm32** で確かめる。
//!
//! native の Rust は x86 の libm、ブラウザの wasm32 は Rust 自前の libm で、ulp が違いうる。
//! **境界ちょうどは ulp 1 つで 1 円動く場所**なので、native の緑は製品の緑ではない
//! (レビュー条件 1、calcarc-1e)。境界(`loan_forward` / `loan_bonus_forward`)を渡って読む。
//!
//! Run: wasm-pack test --headless --chrome crates/calcarc-wasm

#![cfg(target_arch = "wasm32")]

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const GOLDEN: &str = include_str!("../../../testdata/loan_boundary.json");

fn get(value: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(value, &JsValue::from_str(key)).unwrap_or_else(|_| panic!("missing field {key}"))
}

fn yen_field(value: &JsValue, key: &str) -> u64 {
    get(value, key)
        .as_string()
        .unwrap_or_else(|| panic!("{key} is not a string"))
        .parse()
        .unwrap_or_else(|_| panic!("{key} is not a yen amount"))
}

fn yen(v: &serde_json::Value) -> u64 {
    v.as_str().and_then(|s| s.parse().ok()).unwrap_or_else(|| panic!("not a yen string: {v}"))
}

#[wasm_bindgen_test]
fn monthly_payments_stay_within_the_allowance_on_yen_boundaries_in_wasm32() {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).expect("golden parses");
    assert_eq!(golden["schema"], 1);
    let below = golden["tolerance"]["below_yen"].as_u64().expect("below_yen");
    let above = golden["tolerance"]["above_yen"].as_u64().expect("above_yen");
    let within = |got: u64, want: u64| want.saturating_sub(below) <= got && got <= want.saturating_add(above);
    let cases = golden["cases"].as_array().expect("cases");
    let mut tallies: BTreeMap<String, [u32; 3]> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();
    for case in cases {
        let id = case["id"].as_str().expect("id");
        let input = &case["input"];
        let rate = input["rate"].as_str().expect("rate");
        let n = input["n"].as_u64().expect("n") as u32;
        let principal = input["principal"].as_str().expect("principal");
        let key = format!("{}/{}", case["set"].as_str().expect("set"), case["boundary"].as_str().expect("boundary"));
        let mut pairs: Vec<(&str, u64, u64)> = Vec::new();
        let out = match case["op"].as_str().expect("op") {
            "loan_forward" => calcarc_wasm::loan_forward(principal, rate, n, input["residual"].as_str().expect("residual")),
            "loan_bonus_forward" => {
                calcarc_wasm::loan_bonus_forward(principal, input["bonus_principal"].as_str().expect("bp"), rate, n)
            }
            other => panic!("{id}: unknown op {other}"),
        };
        assert_eq!(get(&out, "kind").as_string().as_deref(), Some("ok"), "{id}: not ok");
        pairs.push(("monthly", yen_field(&out, "monthlyPayment"), yen(&case["expect"]["monthly_floor"])));
        if case["op"] == "loan_bonus_forward" {
            pairs.push(("bonus", yen_field(&out, "bonusPayment"), yen(&case["expect"]["bonus_floor"])));
        }
        let tally = tallies.entry(key).or_insert([0, 0, 0]);
        for (what, got, want) in pairs {
            tally[usize::from(got >= want) + usize::from(got > want)] += 1;
            if !within(got, want) {
                failures.push(format!("{id}: {what} {got} vs floor {want}"));
            }
        }
    }
    assert!(!cases.is_empty());
    console_log!("loan boundary (wasm32) [low, same, high]: {tallies:?}");
    assert!(failures.is_empty(), "{} outside the allowance:\n{}", failures.len(), failures.join("\n"));
}
```

- [ ] **Step 2: 走らせる（controller が監視役に知らせたあと）**

Run: `wasm-pack test --headless --chrome crates/calcarc-wasm`
Expected: 既存のテストと合わせて PASS。`loan boundary (wasm32) [low, same, high]` の印字を報告に写す（**設計書 §4.7 の「Rust の実物」はこの数**）。手元で Chrome が立たないなら、その印字を報告し「wasm32 は CI の WASM boundary の段で確かめる（未確認）」と書く。**上下 1 円を超える件が出たら止めて報告する。**

- [ ] **Step 3: 赤を確かめる**

`testdata/loan_boundary.json` の許容を一時的に 0 にして同じコマンド → FAIL。再生成で戻す（`git status --porcelain testdata/` が空）。

- [ ] **Step 4: ゲートとコミット**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/calcarc-wasm/tests/loan_boundary.rs
git commit -m "Check the same yen boundaries in wasm32, where the product runs"   # 末尾にトレーラー
```

### Task 5: 数値方針と `closed_form.rs` の註を直し、文書と JSON を突き合わせる

**Files:**
- Modify: `docs/numerical-policy.md`（行は `674b4df` の座標。**着手前に `grep -n` で当て直す**）
- Modify: `crates/calcarc-core/src/finance/loan/closed_form.rs`（**註だけ**。コードは 1 字も変えない）
- Create: `reference/tests/test_policy_matches_loan_boundary.py`

**Interfaces:**
- Consumes: `testdata/loan_boundary.json` の `tolerance.below_yen` / `tolerance.above_yen` / `max_monthly_yen`

- [ ] **Step 1: 失敗するテストを書く**

```python
"""数値方針の「上下 N 円以内（月額 M まで）」が、境界専用の golden の許容と上限と一致すること
（設計書 2026-09-12 §5.7）。JSON を変えて文書を変えなければ赤、その逆も赤。"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
POLICY = ROOT / "docs" / "numerical-policy.md"
GOLDEN = ROOT / "testdata" / "loan_boundary.json"


def _yen_phrase(amount: int) -> str:
    if amount % 10**8 == 0:
        return f"{amount // 10**8} 億円"
    if amount % 10**4 == 0:
        return f"{amount // 10**4} 万円"
    return f"{amount:,} 円"


def phrases(golden: dict) -> list[str]:
    below = golden["tolerance"]["below_yen"]
    above = golden["tolerance"]["above_yen"]
    assert below == above, "上下の幅が違うなら、文書の書き方を先に決め直す"
    return [f"上下 {below} 円以内", f"月額 {_yen_phrase(int(golden['max_monthly_yen']))}まで"]


def test_the_phrases_follow_the_numbers():
    assert phrases({"tolerance": {"below_yen": 1, "above_yen": 1}, "max_monthly_yen": "1000000000"}) == [
        "上下 1 円以内",
        "月額 10 億円まで",
    ]
    assert phrases({"tolerance": {"below_yen": 2, "above_yen": 2}, "max_monthly_yen": "500000000"})[1] == "月額 5 億円まで"


def test_the_policy_states_the_allowance_the_golden_checks():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    text = POLICY.read_text(encoding="utf-8")
    for phrase in phrases(golden):
        assert phrase in text, f"numerical-policy.md に「{phrase}」が無い"
```

Run: `cd reference && uv run --no-config pytest tests/test_policy_matches_loan_boundary.py -q`
Expected: `test_the_policy_states_the_allowance_the_golden_checks` だけ FAIL（文書にまだ無い）。

- [ ] **Step 2: `numerical-policy.md` を直す**（既存の文は消さず、`【訂正 2026-09-12、外部監査・利用者の裁定】` で足す。§5 の文案をそのまま使う）

1. 「## 内部表現」の段落（「すべての値を複素数 `Value { re: f64, im: f64 }` として保持する」）の直後に:
   > **【訂正 2026-09-12】** 上の文は **Scientific の値**についての規則である。ほかの領域は別の内部表現を持つ——Data Scale は厳密整数（「第 3 の分類」の節）、Loan の償還表は u64 円の厳密整数で月額の決定だけ f64、複利は厳密整数（「複利は同じ切り捨て、違う理由」）、Finance の欄の式は有理数で評価して着地で 1 回だけ丸める（「式は有理数で評価し、着地で 1 回だけ丸める」）。
2. 「**f64 は閉形式の月額決定にだけ使う。**」の段落の直後に:
   > **【訂正 2026-09-12】** 実装は `expm1(n·log1p(r))` に 1 を足して `(1+r)^n` を作り、年金現価の中でそこから 1 を引く（`closed_form.rs` の `pow_1p` と `annuity`）。**1 を足した時点で下位の桁が落ちる**ので、`x` は expm1 の値そのものではない（絶対誤差がおよそ ε/2 残る）。素朴な `powi` より桁落ちは小さいが、上の誤差の見積もりは**見立てであって証明ではない**。円の境界での振る舞いは「定例月額の許容」の節と、それを見張る境界専用の検査が決める。
3. 「### 境界近接ガードは golden 生成側にある」の最後の段落の後に:
   > **【追記 2026-09-12】** ガードは**理論値がちょうど整数のケースも必ず除く**（最寄りの整数との距離が 0）。そのため golden と重量級のコーパスは円の境界を踏まない。境界での振る舞いは別の検査——境界専用の golden `testdata/loan_boundary.json`（参照は厳密な有理数、ガードを通さない）——が見る。
4. 「ローンでは切り捨ては**安全な向き**だった——月額が理論値を下回るぶん残高が高めに残り、端数は最終回が吸収する。借主に不利な方向へは倒れない。」の直後に:
   > **【訂正 2026-09-12】** 上の「借主に不利な方向へは倒れない」と「月額が理論値を下回る」は**どちらも偽**だった。反例: 1,000 円・年 12%・12 か月で、月額 88 円なら総利息 61 円、89 円なら 60 円（外部監査 F6）。理論値が整数のすぐ下の入力では、定例月額が理論値の切り捨てより 1 円高くなる（例: 年 0.5%・3 回・元本 10,370,160 円で理論 3,459,600.999999994 円に対して 3,459,601 円。設計書 2026-09-12 §2.3）。**言えるのは「定例月額の許容」の節の範囲まで**で、総支払額と総利息は定例月額に従って決まり、月額が 1 円違えば数円変わりうる——切り捨ては借主に有利とも中立とも言えない。ローンで切り捨てを選ぶ理由は「安全な向き」ではなく、**円単位の支払を決定的に決めるため**である。
5. 同じ節の「**それでも切り捨てを採るのは、実際の金融機関が付利単位 1 円で切り捨てるからである。** 根拠が「安全な向き」から**「慣行の再現」**に変わる。」の直後に:
   > **【訂正 2026-09-12】** ローンの側の根拠は「安全な向き」ではなく「決定性」だった（上の訂正）。したがってここは「ローンは決定性、複利は慣行の再現」と読む。
6. 「## 複利は同じ切り捨て、違う理由」の見出しの**直前**に新しい節:

   ```markdown
   ### 定例月額の許容（2026-09-12、外部監査 F2・利用者の裁定）

   **定例月額（と賞与額）は、理論月額の切り捨てから上下 1 円以内（月額 10 億円まで）。**
   理論月額は閉形式を厳密な有理数で評価した値である。月額は f64 で決めるので、円の境界の
   ごく近くでは切り捨てが上にも下にも 1 円ずれうる——これを直さず、許容として明記する。

   見張るのは境界専用の検査で、`testdata/loan_boundary.json`（理論月額が境界ちょうど・すぐ下・
   すぐ上に来る入力を、年利 0.0001%〜100%・期間 2〜1,200 回の端まで分数で作る）を、native の
   Rust（`crates/calcarc-core/tests/loan_boundary_golden.rs`）と、製品が走る wasm32
   （`crates/calcarc-wasm/tests/loan_boundary.rs`）の両方が読み、上の許容で比べる。
   許容と上限の数はこの JSON が持ち、この文と食い違えば
   `reference/tests/test_policy_matches_loan_boundary.py` が赤くなる。

   **10 億円を超える月額は `Overflow` のエラーにする（予定。製品の変更が入る PR でこの注記を外す）。**
   それより大きい金額では、f64 の精度のため 1 円を超えてずれうる（Python で閉形式を写した計算で、
   年 0.0001%・2 回の月額約 45 億円から 1 円に届いた）。
   ```
7. 「期首も選べる（盤面の `方式` の面の `期首`）」の直後に:
   > **【訂正 2026-09-12】** `方式` の面ではなく、**周期と積立の位置の面**（盤面のアクセシブルネーム「複利の周期と積立の位置のキー」、`web/src/ui/Keypad/finance.ts` の `PERIODS_FACE`）の `期首`。

- [ ] **Step 3: `closed_form.rs` の註を直す（コードは不変）**

1. 冒頭の `//! 出た候補は必ず切り捨てる。**切り捨ては安全な向き**である: 月額が理論値を下回るぶん`
   `//! 残高が高めに残り、端数は最終回(残価ありなら調整回)が吸収する。` を:

   ```rust
   //! 出た候補は必ず切り捨てる。**理由は円単位の支払を決定的に決めるため**である
   //! (「安全な向き」ではない——月額は理論値の切り捨てから上下 1 円ずれうるし、
   //! 総利息は月額に従って決まる。numerical-policy.md の「定例月額の許容」)。
   //! 端数は最終回(残価ありなら調整回)が吸収する。
   ```
2. `annuity` の doc 註「内側で `pow_1p` から 1 を引き戻すのは意図的である。桁落ちが起きるのは `(1+r)^n − 1` の側で、その値を `x` として保持したまま使う。…」と、行末の `// = expm1(n·log1p(r))` を:

   ```rust
   /// 年金現価 (1 − (1+r)^{−n})/r。r > 0 を前提とする(呼び出し側が 0 を弾く)。
   ///
   /// `pow_1p` から 1 を引き戻して `x` を作る。**1 を足した時点で下位の桁が落ちている**ので、
   /// `x` は `expm1(n·log1p(r))` の値そのものではない(絶対誤差がおよそ ε/2 残る)。
   /// 素朴な `powi` よりは良いが、円の境界では 1 円ずれうる——許容は numerical-policy.md の
   /// 「定例月額の許容」、見張りは `tests/loan_boundary_golden.rs` と wasm32 の同じ検査。
   pub(super) fn annuity(r: f64, n: u32) -> f64 {
       let x = pow_1p(r, n) - 1.0; // expm1 に 1 を足して引いた値(下位の桁は落ちている)
   ```
   （`let x = …` の式と以降の行は変えない。註の行だけを置き換える。）

Run: `git diff -U0 crates/calcarc-core/src/finance/loan/closed_form.rs | grep '^[-+]' | grep -v '^[-+]\s*//' | grep -v '^[-+][-+]'`
Expected: `let x = pow_1p(r, n) - 1.0;` の行の末尾の註だけ（式は同じ）。**それ以外のコードの行が出たら直しすぎ。**

- [ ] **Step 4: テストを走らせる**

Run: `cd reference && uv run --no-config pytest tests/test_policy_matches_loan_boundary.py -q`
Expected: PASS

- [ ] **Step 5: 赤を確かめる**

`testdata/loan_boundary.json` の `"max_monthly_yen": "1000000000"` を一時的に `"500000000"` に → FAIL（「月額 5 億円まで」が無い）。再生成で戻す。

- [ ] **Step 6: 設計書 §4.7 に実測を書き戻す**

`docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md` の §4.7 の末尾に、Task 3 と Task 4 の報告の印字から写して:

```markdown
【実測 2026-09-12、Task 3・4】`testdata/loan_boundary.json`（N 件——生成の印字から）を、native の Rust と wasm32
（`wasm-pack test --headless --chrome`、または CI の WASM boundary の段——どちらで取ったかを書く）で比べた。
集合ごとの [低い, 同じ, 高い]: native …／wasm32 …。**上下 1 円を超えた件は native 0・wasm32 0。**
```

数は報告の印字から写し、推測で埋めない。wasm32 が手元で取れず CI 待ちなら、そう書いて wasm32 の欄を「未確認（CI の最初の走行で書き戻す）」にする。

- [ ] **Step 7: ゲートとコミット**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p calcarc-core
cd reference && uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config pytest -q && cd ..
node tools/check-citations.mjs
git add docs/numerical-policy.md crates/calcarc-core/src/finance/loan/closed_form.rs reference/tests/test_policy_matches_loan_boundary.py docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md
git commit -m "Say what the monthly payment can promise, and keep the sentence tied to the golden"   # 末尾にトレーラー
```

---

## PR B（枝 `heavy/verdict-names`、PR A の先端から）

controller が `git -C scratchpad/wt-092 switch -c heavy/verdict-names` で切ってから Task 6 を発注する。

### Task 6: 判定名を領域の比べ方で分ける

**Files:**
- Modify: `heavy/tests/corpus/report.ts`（`VERDICTS`・註・`verdictOf`・`renderVerdicts` の呼び出し・凡例。`AREAS` の直後に `EXACT_AREAS` と `comparisonOf`）
- Modify: `heavy/tests/corpus/report.spec.ts`（:1883-1932 の判定のテスト、:683 の禁止語）
- Modify: `heavy/tests/corpus/calls-rules.spec.ts`:14（註）

**Interfaces:**
- Produces: `EXACT_AREAS: readonly Area[]`、`type Comparison = "exact" | "threshold"`、`comparisonOf(area: Area): Comparison`、`verdictOf(caseCount, worstRelativeError, structuralFailures, comparison: Comparison): Verdict`

- [ ] **Step 1: 失敗するテストを書く**（`report.spec.ts` の既存の判定のテストを次で置き換え、足す）

```ts
test("an area with no cases is never called correct", () => {
  // このテストを赤くする編集: verdictOf の `caseCount === 0` の枝を消す。
  expect(verdictOf(0, 0, 0, "exact")).toBe("検証していない");
  expect(verdictOf(0, 0, 0, "threshold")).toBe("検証していない");
});

test("the verdict ladder cuts where the display cuts", () => {
  // 表示は有効数字 10 桁なので、閾値の領域の最上位は 5e-10 まで。
  expect(verdictOf(100, 0, 0, "threshold")).toBe("採録ケースで表示精度内");
  expect(verdictOf(100, 5e-10, 0, "threshold")).toBe("採録ケースで表示精度内");
  expect(verdictOf(100, 1.34e-9, 0, "threshold")).toBe("ある程度正しい");
  expect(verdictOf(100, 9.9e-7, 0, "threshold")).toBe("ある程度正しい");
  expect(verdictOf(100, 1e-6, 0, "threshold")).toBe("多少疑問がある");
  expect(verdictOf(100, 0.5, 0, "threshold")).toBe("多少疑問がある");
  expect(verdictOf(100, 1, 0, "threshold")).toBe("間違っている");
  expect(verdictOf(100, 1e6, 0, "threshold")).toBe("間違っている");
});

test("an exactly compared area earns the exact name, and only it does", () => {
  // 利用者の裁定(2026-09-12): 厳密な領域は「採録ケースで一致」、閾値の領域は「採録ケースで表示精度内」。
  // このテストを赤くする編集: comparisonOf を常に "threshold" にする。
  expect(verdictOf(100, 0, 0, comparisonOf("finance"))).toBe("採録ケースで一致");
  expect(verdictOf(100, 0, 0, comparisonOf("data_scale"))).toBe("採録ケースで一致");
  expect(verdictOf(100, 0, 0, comparisonOf("display"))).toBe("採録ケースで一致");
  expect(verdictOf(100, 0, 0, comparisonOf("complex"))).toBe("採録ケースで表示精度内");
  expect(verdictOf(100, 0, 0, comparisonOf("scientific"))).toBe("採録ケースで表示精度内");
  expect(verdictOf(100, 0, 0, comparisonOf("cancellation"))).toBe("採録ケースで表示精度内");
});

test("the comparison kind comes from the area, not from whether an error was measured", () => {
  // レビュー注記 D(calcarc-1e): 閾値の領域で全件がエラー経路だと相対誤差を 1 件も測らない。
  // それでも「一致」と名乗らない——比べ方は領域の表から引く。
  const markdown = renderReport([summary({ name: "scientific-000.json", relMeasured: 0 })], PROVENANCE);
  expect(markdown).not.toContain("採録ケースで一致");
});

test("every exact area is a known area", () => {
  for (const area of EXACT_AREAS) expect(AREAS).toContain(area);
});

test("a structural failure outweighs a small numeric error", () => {
  expect(verdictOf(100, 0, 1, "exact")).toBe("間違っている");
  expect(verdictOf(100, 0, 1, "threshold")).toBe("間違っている");
});
```

`summary(...)` が `relMeasured` を受けない形なら、`summary` の既存の引数の形を読んで同じ意味になるように渡す（`relMeasured: 0` は「相対誤差を 1 件も測らなかった」）。import に `EXACT_AREAS`・`comparisonOf`・`AREAS` を足す。禁止語の一覧（`const forbidden = [ … ]`）の末尾に `"完全に正しい",` を足す（**旧名が報告書に残ったら赤**）。

**`report.spec.ts` と `calls-rules.spec.ts` は vitest ではなく Playwright のテスト**（`@playwright/test` を import し、`playwright.corpus.config.ts` の `testDir` が `./tests/corpus`）。単体で走らせるときは 4180 のサーバーが立つので、先にポートを確かめる。

Run: `ss -ltnp | grep -E ':(4180|4181)\b'`（空であること）のあと `cd heavy && pnpm --dir ../web wasm && pnpm exec playwright test --config playwright.corpus.config.ts tests/corpus/report.spec.ts`
Expected: FAIL（`EXACT_AREAS` が無い、`verdictOf` の引数、旧名）。型の誤りは `pnpm typecheck` でも見える。

- [ ] **Step 2: `report.ts` を直す**

`AREAS` の定義（`export type Area = …` の行）の直後に:

```ts
/**
 * **最上位の判定名は、その領域の比べ方で分ける**(設計書 2026-09-12 §6、利用者の裁定)。
 *
 * 厳密に比べる領域(整数円・整数・表示文字列そのもの)は「採録ケースで一致」、
 * 閾値で比べる領域(表示の 10 桁から導いた相対誤差 ≤ 5e-10)は「採録ケースで表示精度内」。
 * **比べ方は領域から引く**——「相対誤差を 1 件も測らなかった」から引くと、閾値の領域で
 * 全件がエラー経路だった走行が「一致」を名乗る(レビュー注記 D)。
 */
export const EXACT_AREAS: readonly Area[] = ["data_scale", "finance", "display"];
export type Comparison = "exact" | "threshold";
export function comparisonOf(area: Area): Comparison {
  return EXACT_AREAS.includes(area) ? "exact" : "threshold";
}
```

`VERDICTS` を:

```ts
/** 判定の段。閾値は表示(有効数字 10 桁)から導く。最上位だけ領域の比べ方で名前が分かれる。 */
export const VERDICTS = [
  "採録ケースで一致",
  "採録ケースで表示精度内",
  "ある程度正しい",
  "多少疑問がある",
  "間違っている",
  "検証していない",
] as const;
```

`VERDICT_EDGES` の上の註の `- \`完全に正しい\` — 表示 10 桁がすべて一致(相対誤差 ≤ 5e-10)` を:

```ts
 * - `採録ケースで一致` — 厳密に比べる領域で、採録したケースがすべて厳密一致
 * - `採録ケースで表示精度内` — 閾値の領域で、採録したケースがすべて相対誤差 ≤ 5e-10
 *   (**表示の 10 桁の文字列を突き合わせてはいない**。10 桁目の丸めの境目では表示が 1 違いうる)
```

`verdictOf` の署名と最後の行を:

```ts
export function verdictOf(
  caseCount: number,
  worstRelativeError: number,
  structuralFailures: number,
  comparison: Comparison,
): Verdict {
  // (途中の枝は今のまま)
  return comparison === "exact" ? "採録ケースで一致" : "採録ケースで表示精度内";
}
```

`renderVerdicts` の `verdict: verdictOf(cases, worst, mismatches),` を `verdict: verdictOf(cases, worst, mismatches, comparisonOf(area)),` に。`grep -n "verdictOf(" heavy/` で他の呼び出しを数え、すべて直す（数を報告に書く）。

凡例（`"判定の意味:"` の下）の最初の 1 行を 2 行に:

```ts
    "- **採録ケースで一致** — 厳密に比べる領域(`finance`・`data_scale`・`display`)で、採録したケースがすべて厳密一致した(整数円・整数・表示文字列そのもの)",
    "- **採録ケースで表示精度内** — 閾値で比べる領域(`scientific`・`cancellation`・`complex`)で、採録したケースがすべて表示の 10 桁から導いた相対誤差 ≤ 5e-10 に収まった。**表示の 10 桁の文字列を突き合わせたのではない**",
```

- [ ] **Step 3: `calls-rules.spec.ts`:14 の註を直す**

「緑になったら、判定表の「完全に正しい」が嘘になる。」→「緑になったら、判定表の「採録ケースで一致」が嘘になる。」

- [ ] **Step 4: テストを走らせる**

Run: `ss -ltnp | grep -E ':(4180|4181)\b'`（空）のあと `cd heavy && pnpm exec playwright test --config playwright.corpus.config.ts tests/corpus/report.spec.ts tests/corpus/calls-rules.spec.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: 赤を確かめる（2 通り、それぞれ再編集で戻す）**

1. `comparisonOf` を `return "threshold";` だけにする → 「an exactly compared area…」が FAIL。
2. 凡例の 1 行目を旧名「完全に正しい」に戻す → 禁止語の検査が FAIL。

- [ ] **Step 6: 重量級を回してゲートとコミット**

```bash
ss -ltnp | grep -E ':(4180|4181)\b'   # 空であること
cd heavy && pnpm test && pnpm typecheck && pnpm lint && pnpm heavy && cd ..
grep -n "採録ケースで" heavy/heavy-report.md | head   # 生成された報告書に新しい名前が出ていること（報告書は追跡外なら印字だけ）
git grep -n "完全に正しい" -- heavy   # 報告書のコードと検査から旧名が消えたこと（禁止語の一覧の 1 行だけが残る）
git add heavy/tests/corpus/report.ts heavy/tests/corpus/report.spec.ts heavy/tests/corpus/calls-rules.spec.ts
git commit -m "Name the verdict by how each area is compared, and forbid the old name"   # 末尾にトレーラー
```

### Task 7: 過去の記録に読み替えの注記を置く

**Files:**
- Modify: `docs/corpus-measurements.md`（冒頭の 2026-08-25 の注記の直後）
- Modify: `docs/superpowers/specs/2026-08-19-heavy-scientific-ui-report-design.md`:80

- [ ] **Step 1: `corpus-measurements.md` の冒頭（「> **2026-08-25 に重量級は `heavy/` へ移った。**…」の引用の直後）に:**

```markdown
> **2026-09-12 に判定名を改名した**（外部監査 F6・利用者の裁定、設計書 `2026-09-12-calc-fixes-verification-design.md` §6）。
> これより前の節の「完全に正しい」は、厳密に比べる領域（`finance`・`data_scale`・`display`）では
> 「採録ケースで一致」、閾値の領域（`scientific`・`cancellation`・`complex`）では「採録ケースで表示精度内」と読む。
> 表そのものは書いた日の走行の記録なので書き換えない。
```

- [ ] **Step 2: 2026-08-19 の設計書の非目標（「- 判定名（`完全に正しい` など）を変えない。許容誤差を変えない。」）の直後に:**

```markdown
  - **【訂正 2026-09-12】判定名は変えた**（外部監査 F6・利用者の裁定、設計書 `2026-09-12-calc-fixes-verification-design.md` §6）。許容誤差は変えていない。
```

- [ ] **Step 3: ゲートとコミット**

```bash
node tools/check-citations.mjs
git add docs/corpus-measurements.md docs/superpowers/specs/2026-08-19-heavy-scientific-ui-report-design.md
git commit -m "Tell readers of old measurements how the verdict names read now"   # 末尾にトレーラー
```

---

### Task 8: 枝の末尾のフルスイープ（PR A と PR B のそれぞれで 1 回）

- [ ] **Step 1: PR A の先端（`docs/0-9-2-verification`）で**

```bash
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd web && pnpm typecheck && pnpm lint && pnpm test && cd ..
ss -ltnp | grep -E ':(4180|4181)\b'   # 空
cd heavy && pnpm test && pnpm typecheck && pnpm lint && pnpm heavy && cd ..
cd reference && uv run --no-config ruff check && uv run --no-config ruff format --check && uv run --no-config mypy && uv run --no-config pytest -q && cd ..
node tools/check-version.mjs && node tools/check-boundary.mjs && node tools/check-citations.mjs
git status --porcelain   # 空（uv.lock も含めて）
```

`wasm-pack test --headless --chrome crates/calcarc-wasm` は Task 4 で回した結果を使う（重い段を 2 度回さない）。

- [ ] **Step 2: PR B の先端（`heavy/verdict-names`）で同じもの**

## 残り（別の計画）

- **PR C（F1 のシャード、設計書 §3）**: calcarc-3d のエンジン修正の枝（`fix/engine-correction`）ができてから、その上に積む計画を書く。
- **PR D（10 億円を超える月額の `Overflow` の見張り、§4.8）**: calcarc-3d の上限の実装の上に積む。コアの定数と JSON の `max_monthly_yen` の一致の検査もここ。
- **裁定待ち**: 上限を年利 0%・1 回払いにも掛けるか（数値方針の新節の範囲の文を、裁定後に書き足す）／F5 の関数の答えの後と `neg`（`entry-000033`）。
- **F5 の「拒む形」の単体テスト**（設計書 §3.10）は製品の定義を import する形で、PR C の計画に入れる（レビュー注記: 写しを持たない）。
