import json
import pathlib
import subprocess
from fractions import Fraction

import pytest

from calcarc_reference import loan_boundary, loan_ref

NEAR = Fraction(1, 10**6)
ROOT = pathlib.Path(__file__).resolve().parents[2]
# 円境界の 3 つのセルを持つ、もとからの 3 つの集合。`over_cap` と `exempt` は
# 境界ではなく**上限**を見る集合なので、境界のラベルを見るテストの対象外である。
BOUNDARY_SETS = ("plain", "residual", "bonus")


@pytest.fixture(scope="module")
def cases():
    return loan_boundary.build_cases()


@pytest.fixture(scope="module")
def boundary_cases(cases):
    return [c for c in cases if c["set"] in BOUNDARY_SETS]


def _theory(case) -> tuple[Fraction, Fraction | None]:
    inp = case["input"]
    num, den = loan_ref.rate_fraction(inp["rate"])
    n = inp["n"]
    if case["op"] == "loan_forward":
        return loan_ref.monthly_payment_exact(
            int(inp["principal"]), num, den, n, int(inp["residual"])
        ), None
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


def test_every_case_sits_where_its_label_says(boundary_cases):
    for case in boundary_cases:
        monthly, bonus = _theory(case)
        at_boundary = bonus if case["set"] == "bonus" else monthly
        assert _kind(at_boundary) == case["boundary"], case["id"]
        assert case["expect"]["monthly_floor"] == str(monthly.numerator // monthly.denominator), (
            case["id"]
        )
        if bonus is not None:
            assert case["expect"]["bonus_floor"] == str(bonus.numerator // bonus.denominator), case[
                "id"
            ]


def test_the_payments_stay_under_the_cap(boundary_cases):
    floors = [int(v) for c in boundary_cases for v in c["expect"].values()]
    assert max(floors) <= loan_boundary.MAX_MONTHLY_YEN
    # 上限の近くも踏む(10 億円の直下まで、設計書 §4.3)。
    assert max(floors) >= loan_boundary.MAX_MONTHLY_YEN // 2


def test_each_cell_has_enough_cases(boundary_cases):
    cases = boundary_cases
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


def test_residual_cases_reach_the_largest_residuals_the_cap_allows(cases):
    # 月額 10 億円の上限は残価 B も縛る(年 0.0001%・2 回で B ≤ 約 6.0e15)。f64 の余裕が
    # 最も薄いのは B が大きい所なので、そこに件を置く(最終レビュー I-1)。
    big = [
        c
        for c in cases
        if c["set"] == "residual"
        and c["input"]["rate"] == "0.0001"
        and c["input"]["n"] == 2
        and int(c["input"]["residual"]) >= 10**15
    ]
    assert len(big) >= 10, len(big)


def test_residual_near_boundary_cases_reach_beyond_two_payments(cases):
    # 残価ありのすぐ下・すぐ上は n=2 の 1 点に縛られていない(最終レビュー I-1)。
    for kind in ("below", "above"):
        terms = {c["input"]["n"] for c in cases if c["set"] == "residual" and c["boundary"] == kind}
        assert any(n >= 3 for n in terms), (kind, terms)


def _largest_residual_the_cap_allows(rate: str, n: int) -> int:
    """月額の上限が許す残価 B の上限を、生成器の式を写さずに求める。

    P > B のどの元本でも月額は最小で c1·(B+1) − c2·B なので、**P = B + 1 の月額が
    上限を超えない最大の B** が窓の上端である。単調なので二分探索でよい。
    """
    num, den = loan_ref.rate_fraction(rate)

    def fits(b: int) -> bool:
        smallest = loan_ref.monthly_payment_exact(b + 1, num, den, n, b)
        return smallest <= loan_boundary.MAX_MONTHLY_YEN

    lo, hi = 1, 1
    while fits(hi):
        lo, hi = hi, hi * 2
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid
    return lo


def test_the_residual_rungs_reach_the_top_of_the_window(cases):
    # 大きい残価は f64 の余裕が最も薄い所。窓の上端の 95% 以上にも件を置く(R4)。
    limit = _largest_residual_the_cap_allows("0.0001", 2)
    top = [
        c
        for c in cases
        if c["set"] == "residual"
        and c["input"]["rate"] == "0.0001"
        and c["input"]["n"] == 2
        and 100 * int(c["input"]["residual"]) >= 95 * limit
    ]
    assert top, (limit, max(int(c["input"]["residual"]) for c in cases if c["set"] == "residual"))


def test_the_over_cap_cases_sit_at_least_two_yen_above_the_cap(cases):
    over = [c for c in cases if c["set"] == "over_cap"]
    assert len(over) >= 5, len(over)
    for case in over:
        assert case["boundary"] == "over", case["id"]
        assert case["expect"] == {"error": "Overflow"}, case["id"]
        inp = case["input"]
        num, den = loan_ref.rate_fraction(inp["rate"])
        # 上限が掛かるのは f64 の経路だけ——正の年利で 2 回以上(R3 の裏)。
        assert num > 0 and inp["n"] >= 2, case["id"]
        monthly, bonus = _theory(case)
        # R2: 上限 + 2 円以上。(上限, 上限 + 1] は f64 のずれでどちらにも転ぶので置かない。
        # **ここで理論値を作り直して数える**(生成器の判断を写さない)。
        exceeding = bonus if bonus is not None else monthly
        assert exceeding >= loan_boundary.MAX_MONTHLY_YEN + 2, (case["id"], float(exceeding))
        if bonus is not None:
            # 賞与の列だけが超えること。月々の列も超えていたら、この行は賞与の経路を
            # 見張っていない(同じ Overflow が月々の列から返ってしまう)。
            assert monthly <= loan_boundary.MAX_MONTHLY_YEN, case["id"]
    # **3 つの形がそろっていること**(残価なし・残価あり・賞与)。生成器は月々の列が
    # 走らない組(年 100%・1200 回)を落とすので、落としきって賞与が 0 件になった日に
    # ここで気づく必要がある。
    assert {c["op"] for c in over} == {"loan_forward", "loan_bonus_forward"}, over
    with_residual = [
        c for c in over if c["op"] == "loan_forward" and int(c["input"]["residual"]) > 0
    ]
    assert with_residual, "残価ありの上限超えが 1 件も無い"


def test_the_exempt_cases_are_above_the_cap_on_the_exact_paths(cases):
    exempt = [c for c in cases if c["set"] == "exempt"]
    assert len(exempt) >= 5, len(exempt)
    for case in exempt:
        assert case["boundary"] == "over", case["id"]
        inp = case["input"]
        num, den = loan_ref.rate_fraction(inp["rate"])
        n, principal, residual = inp["n"], int(inp["principal"]), int(inp["residual"])
        # 上限を掛けない経路は 2 つだけ: 年利 0% と 1 回払い(R3)。
        assert num == 0 or n == 1, case["id"]
        want = int(case["expect"]["monthly_floor"])
        # 上限の下に居る行は、この集合が何も主張していないのと同じ。
        assert want > loan_boundary.MAX_MONTHLY_YEN, case["id"]
        # 期待値は厳密経路の整数(R3)。理論値の切り捨てとも、参照の月額とも一致する。
        exact = loan_ref.monthly_payment_exact(principal, num, den, n, residual)
        assert want == exact.numerator // exact.denominator, case["id"]
        assert want == loan_ref.monthly_payment(principal, num, den, n, residual), case["id"]
    # **2 つの経路がそろっていること。** 片方だけになれば、もう片方について
    # golden は何も言っていない。
    zero_rate = [c for c in exempt if loan_ref.rate_fraction(c["input"]["rate"])[0] == 0]
    single = [c for c in exempt if c["input"]["n"] == 1]
    assert zero_rate and single, (len(zero_rate), len(single))
    assert any(int(c["input"]["residual"]) > 0 for c in zero_rate), "0% の残価ありが無い"


def _cases_at_head() -> list[dict] | None:
    try:
        done = subprocess.run(
            ["git", "show", "HEAD:testdata/loan_boundary.json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except OSError, subprocess.CalledProcessError:
        return None
    return json.loads(done.stdout)["cases"]


def test_the_cases_committed_at_head_survive_unchanged(cases):
    """R4: 生成は**足すだけ**。HEAD に在る件は 1 件も消えず、1 文字も変わらない。

    比べる相手を作業ツリーのファイルではなく **HEAD** にするのは、再生成で上書き
    したあとにも問える形にするためである(ファイルと比べると、書き換えた瞬間に
    自分自身と一致してしまい、何も主張しなくなる)。生成器は `sort_keys` の
    JSON を書くので、**辞書として等しいことは、その件のバイトが等しいこと**である。
    """
    old = _cases_at_head()
    if old is None:
        pytest.skip("git の作業ツリーではないので HEAD の golden を取り出せない")
    new = {c["id"]: c for c in cases}
    missing = [c["id"] for c in old if c["id"] not in new]
    changed = [c["id"] for c in old if c["id"] in new and new[c["id"]] != c]
    assert not missing, missing[:5]
    assert not changed, changed[:5]
    # 比べた件数に下限を置く(記憶 tests-can-assert-nothing)。
    assert len(old) >= 2_500, len(old)


def test_ids_are_unique(cases):
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))


def test_each_case_survives_a_payment_one_yen_off(cases):
    # 製品の月額が上下 1 円ずれても償還表がエラーにならない入力だけを採る(テストが Err を踏まない)。
    # 値を期待する行だけが対象——`over_cap` は月額そのものが出ないので表も走らない。
    valued = [c for c in cases if "monthly_floor" in c["expect"]]
    for case in valued[:: max(1, len(valued) // 200)]:
        inp = case["input"]
        num, den = loan_ref.rate_fraction(inp["rate"])
        if case["op"] == "loan_forward":
            fl = int(case["expect"]["monthly_floor"])
            for pay in (fl - 1, fl, fl + 1):
                loan_ref.run_schedule(
                    int(inp["principal"]), num, den, inp["n"], pay, int(inp["residual"])
                )
