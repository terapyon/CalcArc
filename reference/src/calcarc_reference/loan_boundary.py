"""境界専用の golden の入力を作る(設計書 2026-09-12 §4.3)。

**狙いは、理論月額が円の境界ちょうど・すぐ下・すぐ上に来る入力**である。重量級と既存の golden は
`loan_ref._guard_boundary` で境界の近くを必ず除くので、ここでしか踏まない。

- ちょうど: 理論月額 = c·P(c は厳密な有理数)。P を c の分母の倍数にすると整数になる。
- すぐ下・すぐ上: c の連分数の近似分母 t で P = t·m, t·m ± 1 にすると、c·P が整数のごく近くに来る。
  整数から `NEAR`(1e-6 円)以内のものだけを採る。
- 残価あり: 理論月額 = c1·P − c2·B。B を c2 の分母の倍数にすると c2·B は整数なので、
  P の側は残価なしと同じ。
- 賞与: 賞与分は半年利・floor(n/6) 回の残価なしなので、賞与分の元本を上と同じく作る。
  元本はその 2 倍(上限 50%)。

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
# ブリーフの (1, 2, 3, 10, 1_000, 1_000_000) から広げた(residual/below・residual/above が
# 20 件に届かなかったため、task-2-report.md に理由を記載)。
MULTS = (
    1,
    2,
    3,
    5,
    7,
    10,
    20,
    50,
    100,
    200,
    500,
    1_000,
    2_000,
    5_000,
    10_000,
    20_000,
    50_000,
    100_000,
    200_000,
    500_000,
    1_000_000,
    2_000_000,
    5_000_000,
    10_000_000,
)
# ブリーフの (1, 2, 5) から広げた——残価あり(B=c2.denominator·j)は n=2 でしか使えず
# (n が増えると c2.denominator が u64 域を超えて `p <= b` を満たす候補が消える)、
# その n=2 の中で below/above を 20 件以上採るには j の刻みをもっと細かくする必要が
# あった(task-2-report.md)。
RESIDUAL_J_MULTS = (1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50)
# ブリーフの 8 から広げた(residual/below・residual/above を 20 件以上にするため。
# 上の 2 つの広げだけでは、同じ (rate, n) = (0.0001, 2) に候補が集中するので、
# その 1 セルからもっと採れるようにする必要があった。task-2-report.md 参照)。
PER_CELL = 25
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
    """c の連分数の近似分母(t·c が整数に近くなる t)を小さい順に並べる。"""
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
    return sorted(
        {
            k
            for k in (1, 2, 3, k_max // 10**6, k_max // 10**3, k_max // 10, k_max)
            if 1 <= k <= k_max
        }
    )


def _principals(c: Fraction, offset: int) -> Iterator[tuple[int, Fraction]]:
    """理論月額 = c·P − offset(offset は整数)が境界に来そうな元本 P と、その理論月額を挙げる。

    2 系統(c.denominator の倍数と、連分数の近似分母×MULTS±1)は同じ P を出すことがある
    (近似分母が c.denominator 自身のとき等)ので、P で重複除去する(ブリーフの記述からの逸脱、
    task-2-report.md に理由を記載)。
    """
    seen: set[int] = set()
    if c.denominator <= U64_MAX and c.numerator > 0:
        for k in _spread((MAX_MONTHLY_YEN + offset) // c.numerator):
            p = c.denominator * k
            if p in seen:
                continue
            seen.add(p)
            yield p, c * p - offset
    for t in _convergent_denominators(c, U64_MAX):
        for mult in MULTS:
            for d in (-1, 0, 1):
                p = t * mult + d
                if 1 <= p <= U64_MAX and p not in seen:
                    seen.add(p)
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


def _forward_case(
    set_: str, boundary: str, rate: str, n: int, principal: int, residual: int, floor_: int
) -> dict:
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
        for j in RESIDUAL_J_MULTS:
            b = c2.denominator * j
            if b > 10**12:
                break
            offset = int(c2 * b)
            for p, a in _principals(c1, offset):
                kind = _kind(a)
                if (
                    kind is None
                    or taken.get(kind, 0) >= PER_CELL
                    or p <= b
                    or not 0 < a <= MAX_MONTHLY_YEN
                ):
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
            if (
                kind is None
                or taken.get(kind, 0) >= PER_CELL
                or bonus > MAX_MONTHLY_YEN
                or 2 * bp > U64_MAX
            ):
                continue
            monthly = loan_ref.monthly_payment_exact(bp, num, den, n, 0)
            fm, fb = _floor(monthly), _floor(bonus)
            if monthly > MAX_MONTHLY_YEN:
                continue
            if not (
                _schedule_ok(bp, num, den, n, fm, 0) and _schedule_ok(bp, hnum, hden, rows, fb, 0)
            ):
                continue
            taken[kind] = taken.get(kind, 0) + 1
            yield {
                "id": f"bonus/{kind}/{rate}/{n}/{2 * bp}/{bp}",
                "op": "loan_bonus_forward",
                "set": "bonus",
                "boundary": kind,
                "input": {
                    "principal": str(2 * bp),
                    "bonus_principal": str(bp),
                    "rate": rate,
                    "n": n,
                },
                "expect": {"monthly_floor": str(fm), "bonus_floor": str(fb)},
            }


def build_cases() -> list[dict]:
    """境界専用の golden のケースを全部作る。順序は決定的(乱択を使わない)。

    独立: 一部(入力の作り方は分数の性質だけに依り、Rust を読まない。期待値は `monthly_payment_exact`
    の宣言に従う)
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
