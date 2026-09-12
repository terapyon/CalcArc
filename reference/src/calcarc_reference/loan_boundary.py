"""境界専用の golden の入力を作る(設計書 2026-09-12 §4.3)。

**狙いは、理論月額が円の境界ちょうど・すぐ下・すぐ上に来る入力**である。重量級と既存の golden は
`loan_ref._guard_boundary` で境界の近くを必ず除くので、ここでしか踏まない。

- ちょうど: 理論月額 = c·P(c は厳密な有理数)。P を c の分母の倍数にすると整数になる。
- すぐ下・すぐ上: c の連分数の近似分母 t で P = t·m, t·m ± 1 にすると、c·P が整数のごく近くに来る。
  整数から `NEAR`(1e-6 円)以内のものだけを採る。
- 残価あり: 理論月額 = c1·P − c2·B。B を c2 の分母の倍数にすると c2·B は整数なので、
  P の側は残価なしと同じ。B は月額の上限が許す最大まで取り、P は実現可能な窓
  (B, (上限 + c2·B)/c1] の両端から探す(`_window_principals`)。
- 賞与: 賞与分は半年利・floor(n/6) 回の残価なしなので、賞与分の元本を上と同じく作る。
  元本はその 2 倍(上限 50%)。

期待値は `loan_ref.monthly_payment_exact` の切り捨て。**`_guard_boundary` は通さない。**
製品の月額が上下 1 円ずれても償還表がエラーにならない入力だけを採る。
"""

from __future__ import annotations

from collections.abc import Iterator
from fractions import Fraction
from itertools import chain

from calcarc_reference import loan_ref

MAX_MONTHLY_YEN = 10**9
TOLERANCE_YEN = 1
NEAR = Fraction(1, 10**6)
RATES = ("0.0001", "0.5", "1", "2", "15", "100")
TERMS = (2, 3, 12, 120, 360, 1200)
BONUS_TERMS = (12, 120, 360, 1200)
# ブリーフの (1, 2, 3, 10, 1_000, 1_000_000) から広げた(residual/below・residual/above が
# 20 件に届かなかったため。理由は
# docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md §1 に記載)。
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
# 小さい残価(B = c2.denominator·j)の j。ブリーフの (1, 2, 5) から広げた(n=2 の中で
# below/above を 20 件以上採るため。理由は
# docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md §1)。大きい残価の j は
# `_residual_js` が月額の上限から決める。**置き場を n=2 に縛っていたのは c2 の分母では
# なく、B を 10^12 で打ち切り、元本を実現可能な窓に向けて探していなかった生成器の側
# だった**(最終レビュー I-1。年 0.0001%・n=3 の分母は 49 bit で u64 に収まる)。
RESIDUAL_J_MULTS = (1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50)
# ブリーフの 8 から広げた(residual/below・residual/above を 20 件以上にするため。
# 同じ (rate, n) = (0.0001, 2) に候補が集中するので、その 1 セルからもっと採れるように
# する必要があった。理由は docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md
# §1 参照)。
PER_CELL = 25
# 残価 B ≥ LARGE_B の件は (rate, n, kind) ごとに別枠で採る——小さい残価の枠を奪わず、
# 奪われもしない(最終レビュー I-1)。f64 の誤差が最も大きいのは B が上限に近い所なので、
# 大きい残価は上から採る(`_residual_js`)。
LARGE_B = 10**12
PER_CELL_LARGE_B = 10
# 窓の両端から何個の m を試すか(`_window_principals`)。
WINDOW_STEPS = 3
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
    (近似分母が c.denominator 自身のとき等)ので、P で重複除去する(ブリーフの記述からの
    逸脱、理由は docs/superpowers/sdd/2026-09-12-calc-fixes-verification.md §1 に記載)。
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


def _window_principals(
    c: Fraction, offset: int, p_lo: int, p_hi: int
) -> Iterator[tuple[int, Fraction]]:
    """元本の窓 [p_lo, p_hi] の中で、理論月額 = c·P − offset が境界に来そうな P と理論月額を挙げる。

    残価が大きいと P の窓は (B, (上限 + c2·B)/c1] に狭まり、`_principals` の固定の刻み
    (近似分母×MULTS)は窓に届かない。そこで窓の両端から数える:

    - c の連分数の近似分母 t について P = t·m + d(d ∈ {−1, 0, 1})。m は ceil(p_lo/t) から上へ、
      floor(p_hi/t) から下へ、それぞれ WINDOW_STEPS 個。
    - c.denominator の倍数(c·P が整数になる)。同じく窓の両端から WINDOW_STEPS 個。

    P で重複除去する。
    """
    if p_lo > p_hi:
        return
    seen: set[int] = set()

    def near_ends(t: int, ds: tuple[int, ...]) -> Iterator[tuple[int, Fraction]]:
        lo_m = -(-p_lo // t)
        hi_m = p_hi // t
        ms = set(range(lo_m, lo_m + WINDOW_STEPS)) | set(range(hi_m - WINDOW_STEPS + 1, hi_m + 1))
        for m in sorted(ms):
            for d in ds:
                p = t * m + d
                if p_lo <= p <= p_hi and p not in seen:
                    seen.add(p)
                    yield p, c * p - offset

    for t in _convergent_denominators(c, p_hi):
        yield from near_ends(t, (-1, 0, 1))
    yield from near_ends(c.denominator, (0,))


def _residual_js(c2_den: int, b_limit: int) -> list[int]:
    """残価 B = c2_den·j の j を、試す順に並べる。

    小さい残価(B < LARGE_B)は昇順——`RESIDUAL_J_MULTS` と `_spread` の小さい側。大きい残価は
    **降順**で、上限 b_limit の j から十分の一刻みで下りる(f64 の誤差が最も大きい、B が上限に
    近い所から採る)。どちらも b_limit を超える j は含めない。
    """
    j_limit = b_limit // c2_den
    js = set(RESIDUAL_J_MULTS) | set(_spread(j_limit)) | {j_limit * k // 10 for k in range(1, 10)}
    js = {j for j in js if 1 <= j <= j_limit}
    small = sorted(j for j in js if c2_den * j < LARGE_B)
    large = sorted((j for j in js if c2_den * j >= LARGE_B), reverse=True)
    return small + large


def _residual_candidates(
    c1: Fraction, c2: Fraction, b_limit: int
) -> Iterator[tuple[int, int, Fraction]]:
    """残価ありの (B, P, 理論月額) を試す順に挙げる。(B, P) で重複除去する。

    1 巡目は以前の生成と同じ候補を同じ順で出す(`RESIDUAL_J_MULTS` の小さい残価 × `_principals`)。
    2 巡目で新しい候補——大きい残価と、窓の両端の元本——を足す。**枠が埋まる順を 1 巡目に
    固定するので、足した候補が既存の小さい残価の件を押し出さない**(最終レビュー I-1)。
    """
    seen: set[tuple[int, int]] = set()

    def at(b: int, window: bool) -> Iterator[tuple[int, int, Fraction]]:
        offset = int(c2 * b)
        source: Iterator[tuple[int, Fraction]] = _principals(c1, offset)
        if window:
            # 月額 c1·P − offset ≤ 上限 となる P の上端。下端は P > B。
            p_hi = _floor((MAX_MONTHLY_YEN + offset) / c1)
            source = chain(source, _window_principals(c1, offset, b + 1, p_hi))
        for p, a in source:
            if (b, p) not in seen:
                seen.add((b, p))
                yield b, p, a

    for j in RESIDUAL_J_MULTS:
        b = c2.denominator * j
        if b < LARGE_B and b <= b_limit:
            yield from at(b, window=False)
    for j in _residual_js(c2.denominator, b_limit):
        yield from at(c2.denominator * j, window=True)


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
        # 残価の利息はどの月額にも乗る: P > B なので月額 = c1·P − c2·B ≥ c1·(B+1) − c2·B。
        # したがって月額の上限が B を縛る(これを超える B では、どの元本も上限を超える)。
        b_limit = _floor((MAX_MONTHLY_YEN - c1) / (c1 - c2))
        taken_small: dict[str, int] = {}
        taken_large: dict[str, int] = {}
        for b, p, a in _residual_candidates(c1, c2, b_limit):
            if b > b_limit:
                continue
            taken, quota = (
                (taken_large, PER_CELL_LARGE_B) if b >= LARGE_B else (taken_small, PER_CELL)
            )
            kind = _kind(a)
            if (
                kind is None
                or taken.get(kind, 0) >= quota
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
