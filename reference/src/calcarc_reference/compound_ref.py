"""複利・積立の参照実装（設計書 2026-08-14 §8）。

**独立軸**: 期待値は厳密な int ループが出す（Rust と同じ丸め契約）が、
**Decimal 50 桁の閉形式が横で番人をする**——P(1+r)^n + m((1+r)^n − 1)/r を
評価し、int ループとのずれが 0 以上 期数×(1+r)^期数 以下であることを毎回
確かめる。ずれの向きは常に一方向（切り捨ての積み上がりで閉形式より小さい）
なので、符号の反転はバグの兆候である。

**共有する公開契約**（アルゴリズムの共有ではなく、base-spec §37 型の契約。
知らなければ独立検証を書けないもの）:

1. 1 期の利息 = `balance * num // den`（厳密整数、円未満切り捨て、元本組入）。
2. 積立は**期末**——利息を付けてから足す。その期に入れた金は利息を生まない。
3. 年利 → 1 期の利率は**名目**（分母に期/年を掛ける）。実効換算は使わない
   （無理数になり分数に載らない。numerical-policy）。
4. 税は国税 15.315% と地方税 5% を**別々に**切り捨て、課税対象は利息。
5. 金額は u64 の定義域。超えたら Overflow。
"""

from __future__ import annotations

from decimal import Decimal, localcontext

PRECISION = 50
U64_MAX = (1 << 64) - 1
# 期数の上限。loan の MAX_TERM_MONTHS と揃える（月次なら 100 年ぶん）。
MAX_PERIODS = 1200
PERIODS_PER_YEAR = (1, 2, 12)

NATIONAL_TAX_NUM, NATIONAL_TAX_DEN = 15315, 100_000  # 15.315%
LOCAL_TAX_NUM, LOCAL_TAX_DEN = 5, 100  # 5%


class CompoundError(Exception):
    """Rust の CalcError に対応する。`code` は golden の error 文字列。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def rate_fraction(percent: str, periods_per_year: int) -> tuple[int, int]:
    """年利のパーセント文字列 → 1 期の利率の分数 (分子, 分母)。約分しない。

    `loan_ref.rate_fraction` は分母に 12 を固定で掛ける。ここはそれを
    パラメータにしただけで、桁の扱い（小数 4 桁まで・100% 超は拒否）は同じ。
    """
    if periods_per_year not in PERIODS_PER_YEAR:
        raise CompoundError("SyntaxError")
    integer, _, fraction = percent.partition(".")
    if not integer and not fraction:
        raise CompoundError("SyntaxError")
    if len(fraction) > 4:
        raise CompoundError("SyntaxError")
    if not (integer + fraction).isdigit():
        raise CompoundError("SyntaxError")
    scale = 10 ** len(fraction)
    numerator = int(integer or 0) * scale + int(fraction or 0)
    if numerator > 100 * scale:
        raise CompoundError("SyntaxError")
    return numerator, scale * 100 * periods_per_year


def grow(principal: int, deposit: int, num: int, den: int, periods: int) -> int:
    """厳密整数で期を回す。**答はこれが出す。**"""
    if periods <= 0 or periods > MAX_PERIODS:
        raise CompoundError("SyntaxError")
    if principal == 0 and deposit == 0:
        raise CompoundError("SyntaxError")
    if principal > U64_MAX or deposit > U64_MAX:
        raise CompoundError("SyntaxError")
    balance = principal
    for _ in range(periods):
        balance += balance * num // den  # 期中の利息、円未満切り捨てで元本組入
        balance += deposit  # 積立は期末（契約 2）
        if balance > U64_MAX:
            raise CompoundError("Overflow")
    return balance


def closed_form(principal: int, deposit: int, num: int, den: int, periods: int) -> Decimal:
    """番人。Decimal 50 桁で素直に評価する（int ループの式変形は写さない）。"""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        if r == 0:
            return Decimal(principal) + Decimal(deposit) * periods
        growth = (1 + r) ** periods
        return Decimal(principal) * growth + Decimal(deposit) * (growth - 1) / r


def check_against_closed_form(
    exact: int, principal: int, deposit: int, num: int, den: int, periods: int
) -> None:
    """ずれが向きと上界の中に居ることを確かめる。

    向き: 各期の切り捨ては受取を減らすので、厳密ループは閉形式**以下**。
    上界: 1 期あたり 1 円未満の損が最後まで複利で育つので 期数×(1+r)^期数。
    """
    with localcontext() as ctx:
        ctx.prec = PRECISION
        drift = closed_form(principal, deposit, num, den, periods) - Decimal(exact)
        r = Decimal(num) / Decimal(den)
        bound = Decimal(periods) * (1 + r) ** periods
        if not 0 <= drift <= bound:
            raise ValueError(f"閉形式とのずれが範囲外: {drift}（上界 {bound}）")


def withholding_tax(interest: int) -> tuple[int, int]:
    """(国税, 地方税)。**別々に**切り捨てる（国税庁 No.1310）。"""
    national = interest * NATIONAL_TAX_NUM // NATIONAL_TAX_DEN
    local = interest * LOCAL_TAX_NUM // LOCAL_TAX_DEN
    return national, local


def compute(op: str, params: dict) -> dict:
    """生成スクリプトの入口。エラーは戻り値にする（loan_ref と同じ流儀）。"""
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
