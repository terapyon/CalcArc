"""Loan の参照実装（設計書 2026-08-13 §6）。

**独立軸**: Rust は閉形式を f64 で評価し `expm1(n·log1p(r))` で桁落ちを避ける。
こちらは同じ閉形式を **Decimal 50 桁で素直に**評価する——`(1+r)^n` をそのまま冪で
計算し、Rust の式変形は写さない。式変形は f64 の弱点への対処であって、Decimal には
不要だからである。ここが手法の独立性である。

**共有する公開契約**（アルゴリズムの共有ではなく、base-spec §37 型の契約。
data_scale の U128_MAX や表示丸め契約と同じ位置づけで、知らなければ独立検証を
書けないもの）:

1. 各行の利息 = `balance * num // den`（厳密整数、円未満切り捨て）。
2. 償還表の形——残価なしは最終回が端数を吸収、残価ありは n−1 回目が調整回で、
   最終回は残価を超えない最大の支払（設計書 §3）。
3. 逆算の確定規則——「n 回で完済する」= 最終回の支払が月額以下（設計書 §5）。
   期間の探索上限 1200 か月も契約。
4. 金額は u64 の定義域。超えたら Overflow。

**境界近接ガード**（設計書 §1-4）は生成側のこの層が担う: f64 を floor して決まる
出力（= 月額）が円境界に近すぎるケースは、golden に入れずに ValueError で落とす。
逆算 2 種は f64 候補ではなく厳密表が答を確定するので（設計書 §5）、floor される
f64 出力が存在せず、ガードの対象にならない。
"""

from __future__ import annotations

from decimal import ROUND_FLOOR, Decimal, localcontext

PRECISION = 50
U64_MAX = (1 << 64) - 1
MAX_TERM_MONTHS = 1200
BONUS_INTERVAL_MONTHS = 6

# 円境界からこれ以上離れていなければ golden に採らない（設計書 §1-4）。
# 絶対 1e-6 円だけでは u64 域の巨大な月額を守れない——f64 の誤差は値に比例する
# ので、相対 1e-9 との大きいほうを使う（f64 の実力 ~1e-15 に対して 6 桁の余裕）。
GUARD_ABSOLUTE = Decimal("1e-6")
GUARD_RELATIVE = Decimal("1e-9")


class LoanError(Exception):
    """Rust の CalcError に対応する。`code` は golden の error 文字列。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _syntax() -> LoanError:
    return LoanError("SyntaxError")


def _overflow() -> LoanError:
    return LoanError("Overflow")


def rate_fraction(percent: str) -> tuple[int, int]:
    """年利のパーセント文字列 → 月利の分数 (分子, 分母)。約分しない。"""
    integer, _, fraction = percent.partition(".")
    if not integer and not fraction:
        raise _syntax()
    if len(fraction) > 4:
        raise _syntax()
    for part in (integer, fraction):
        if part and not (part.isascii() and part.isdigit()):
            raise _syntax()
    scale = 10 ** len(fraction)
    numerator = int(integer or 0) * scale + int(fraction or 0)
    if numerator > 100 * scale:
        raise _syntax()
    return numerator, scale * 100 * 12


def half_year(num: int, den: int) -> tuple[int, int]:
    """ボーナス列の半年利 = 年利÷2 = 月利×6（設計書 §4）。"""
    return num, den // 6


def monthly_interest(balance: int, num: int, den: int) -> int:
    """公開契約 1: 各行の利息。"""
    return balance * num // den


def _check_u64(*values: int) -> None:
    if any(v > U64_MAX for v in values):
        raise _overflow()


def _residual_target(residual: int, num: int, den: int) -> int:
    """最終回の直前に残す残高 = 支払 X + floor(X·r) が残価を超えない最大の X。

    f(X) は 1 か 2 ずつ増える単調な階段なので、残価を飛ばすことがある。そのときの
    最終回は残価 − 1 円になる（切り捨て側に倒す。設計書 §2 の 1 語と同じ向き）。
    """
    x = residual * den // (den + num)
    while x + monthly_interest(x, num, den) > residual:
        x -= 1
    while x + 1 + monthly_interest(x + 1, num, den) <= residual:
        x += 1
    return x


def run_schedule(principal: int, num: int, den: int, n: int, payment: int, residual: int) -> dict:
    """償還表を 1 行ずつ愚直に走らせる（公開契約 2）。"""
    if n == 0 or principal == 0 or payment == 0 or residual >= principal:
        raise _syntax()
    if residual > 0 and n < 2:
        raise _syntax()
    if payment <= monthly_interest(principal, num, den):
        raise _syntax()  # 発散

    balance = principal
    paid: list[int] = []
    interests: list[int] = []
    regular_rows = n - 1 if residual == 0 else n - 2

    for _ in range(regular_rows):
        interest = monthly_interest(balance, num, den)
        due = balance + interest
        if due <= payment:
            # 縮退: 定例回の途中で払い切れる。
            if residual > 0:
                raise _syntax()
            paid.append(due)
            interests.append(interest)
            return _summarize(paid, interests)
        paid.append(payment)
        interests.append(interest)
        balance = due - payment

    if residual > 0:
        # 調整回（n−1 回目）: 残高を目標まで落とす。
        target = _residual_target(residual, num, den)
        interest = monthly_interest(balance, num, den)
        due = balance + interest
        if due < target:
            raise _syntax()  # 定例額が大きすぎて残価に届かない
        paid.append(due - target)
        interests.append(interest)
        balance = target

    interest = monthly_interest(balance, num, den)
    paid.append(balance + interest)
    interests.append(interest)
    return _summarize(paid, interests)


def _summarize(paid: list[int], interests: list[int]) -> dict:
    total_payment = sum(paid)
    total_interest = sum(interests)
    _check_u64(total_payment, total_interest)
    return {
        "rows_paid": len(paid),
        "total_payment": total_payment,
        "total_interest": total_interest,
        "final_payment": paid[-1],
    }


def _guard_boundary(value: Decimal) -> None:
    """円境界に近すぎる月額は golden に入れない（設計書 §1-4 の番人）。"""
    below = value.to_integral_value(rounding=ROUND_FLOOR)
    distance = min(value - below, below + 1 - value)  # 最も近い円境界までの距離
    limit = max(GUARD_ABSOLUTE, abs(value) * GUARD_RELATIVE)
    if distance < limit:
        raise ValueError(f"monthly payment {value} sits within {limit} of a yen boundary")


def monthly_payment(principal: int, num: int, den: int, n: int, residual: int) -> int:
    """閉形式で月額を出す。Decimal 50 桁で素直に評価する（独立軸）。"""
    if n == 0 or principal == 0 or residual >= principal:
        raise _syntax()
    if residual > 0 and n < 2:
        raise _syntax()
    if num == 0:
        return principal // n if residual == 0 else (principal - residual) // (n - 1)
    if n == 1:
        payment = principal + monthly_interest(principal, num, den)
        _check_u64(payment)
        return payment
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        base = Decimal(1) + r
        pow_n = base**n
        m = n if residual == 0 else n - 1
        annuity = (Decimal(1) - base ** (-m)) / r
        present_value = Decimal(principal) - Decimal(residual) / pow_n
        if present_value <= 0 or annuity <= 0:
            raise _syntax()
        amount = present_value / annuity
        _guard_boundary(amount)
        if amount > Decimal(U64_MAX):
            raise _overflow()
        return int(amount.to_integral_value(rounding=ROUND_FLOOR))


def forward(principal: int, num: int, den: int, n: int, residual: int) -> dict:
    """正算: 月額を決め、表で総額を確定する。"""
    payment = monthly_payment(principal, num, den, n, residual)
    schedule = run_schedule(principal, num, den, n, payment, residual)
    return {"monthly_payment": payment, **schedule}


def _clears_within(principal: int, num: int, den: int, n: int, payment: int) -> bool:
    """公開契約 3: n 回で完済する = 最終回の支払が月額以下。"""
    try:
        return run_schedule(principal, num, den, n, payment, 0)["final_payment"] <= payment
    except LoanError as error:
        if error.code == "SyntaxError":
            return False
        raise


def _probe(principal: int, num: int, den: int, n: int, payment: int) -> bool:
    """探索中の一手。**u64 に収まらない元本は「完済しない側」**（公開契約 4）。"""
    try:
        return _clears_within(principal, num, den, n, payment)
    except LoanError:
        return False


def term_for(principal: int, num: int, den: int, payment: int) -> dict:
    """期間逆算: 完済する最小の回数。候補は Decimal の対数、確定は厳密表。"""
    if principal == 0 or payment == 0:
        raise _syntax()
    if payment <= monthly_interest(principal, num, den):
        raise _syntax()
    if num == 0:
        seed = -(-principal // payment)  # 整数の ceil
    else:
        with localcontext() as ctx:
            ctx.prec = PRECISION
            r = Decimal(num) / Decimal(den)
            ratio = Decimal(principal) * r / Decimal(payment)
            months = -(Decimal(1) - ratio).ln() / (Decimal(1) + r).ln()
            seed = int(months.to_integral_value(rounding=ROUND_FLOOR)) + 1
    seed = min(max(seed, 1), MAX_TERM_MONTHS)

    if _probe(principal, num, den, seed, payment):
        n = seed
        while n > 1 and _probe(principal, num, den, n - 1, payment):
            n -= 1
    else:
        n = seed
        while True:
            n += 1
            if n > MAX_TERM_MONTHS:
                raise _syntax()  # 100 年でも終わらない = 事実上の発散
            if _probe(principal, num, den, n, payment):
                break
    return {"n": n, **_without(run_schedule(principal, num, den, n, payment, 0), "rows_paid")}


def principal_for(payment: int, num: int, den: int, n: int) -> dict:
    """借入可能額逆算: n 回で表が完済する最大の元本。確定は厳密表（設計書 §5）。"""
    if payment == 0 or n == 0:
        raise _syntax()
    if num == 0:
        principal = payment * n
        _check_u64(principal)
    else:
        with localcontext() as ctx:
            ctx.prec = PRECISION
            r = Decimal(num) / Decimal(den)
            annuity = (Decimal(1) - (Decimal(1) + r) ** (-n)) / r
            seed = int((Decimal(payment) * annuity).to_integral_value(rounding=ROUND_FLOOR))
        principal = _largest_principal(max(seed, 1), num, den, n, payment)
    return {"principal": principal, **run_schedule(principal, num, den, n, payment, 0)}


def _largest_principal(seed: int, num: int, den: int, n: int, payment: int) -> int:
    low, high = 1, seed
    while _probe(high, num, den, n, payment):
        low = high
        if high >= U64_MAX:
            return U64_MAX
        high = min(high * 2, U64_MAX + 1)
    while high - low > 1:
        mid = (low + high) // 2
        if _probe(mid, num, den, n, payment):
            low = mid
        else:
            high = mid
    return low


def _check_bonus_share(bonus_principal: int, principal: int) -> None:
    if bonus_principal * 2 > principal:
        raise _syntax()


def bonus_forward(principal: int, bonus_principal: int, num: int, den: int, n: int) -> dict:
    """ボーナス併用の正算: 2 本の償還列を独立に併走させる（設計書 §4）。"""
    _check_bonus_share(bonus_principal, principal)
    if bonus_principal > 0 and n < BONUS_INTERVAL_MONTHS:
        raise _syntax()
    monthly = forward(principal - bonus_principal, num, den, n, 0)
    if bonus_principal == 0:
        return {
            "monthly_payment": monthly["monthly_payment"],
            "bonus_payment": 0,
            "bonus_rows": 0,
            "total_payment": monthly["total_payment"],
            "total_interest": monthly["total_interest"],
            "monthly_final_payment": monthly["final_payment"],
            "bonus_final_payment": 0,
        }
    rows = n // BONUS_INTERVAL_MONTHS
    b_num, b_den = half_year(num, den)
    bonus = forward(bonus_principal, b_num, b_den, rows, 0)
    total_payment = monthly["total_payment"] + bonus["total_payment"]
    total_interest = monthly["total_interest"] + bonus["total_interest"]
    _check_u64(total_payment, total_interest)
    return {
        "monthly_payment": monthly["monthly_payment"],
        "bonus_payment": bonus["monthly_payment"],
        "bonus_rows": rows,
        "total_payment": total_payment,
        "total_interest": total_interest,
        "monthly_final_payment": monthly["final_payment"],
        "bonus_final_payment": bonus["final_payment"],
    }


def bonus_principal_for(
    monthly_payment_amount: int, bonus_payment: int, num: int, den: int, n: int
) -> dict:
    """ボーナス併用の借入可能額逆算（設計書 §4-b）。50% は解いた後に検証する。"""
    if bonus_payment > 0 and n < BONUS_INTERVAL_MONTHS:
        raise _syntax()
    monthly = principal_for(monthly_payment_amount, num, den, n)
    if bonus_payment == 0:
        return {
            "monthly_principal": monthly["principal"],
            "bonus_principal": 0,
            "total_principal": monthly["principal"],
            "total_payment": monthly["total_payment"],
            "total_interest": monthly["total_interest"],
        }
    rows = n // BONUS_INTERVAL_MONTHS
    b_num, b_den = half_year(num, den)
    bonus = principal_for(bonus_payment, b_num, b_den, rows)
    total_principal = monthly["principal"] + bonus["principal"]
    _check_u64(total_principal)
    _check_bonus_share(bonus["principal"], total_principal)
    total_payment = monthly["total_payment"] + bonus["total_payment"]
    total_interest = monthly["total_interest"] + bonus["total_interest"]
    _check_u64(total_payment, total_interest)
    return {
        "monthly_principal": monthly["principal"],
        "bonus_principal": bonus["principal"],
        "total_principal": total_principal,
        "total_payment": total_payment,
        "total_interest": total_interest,
    }


def _without(source: dict, key: str) -> dict:
    return {k: v for k, v in source.items() if k != key}


# 金額は JSON では文字列（u64 は JSON number の 2^53 を超える）。回数は整数。
_COUNT_KEYS = {"rows_paid", "bonus_rows", "n"}


def compute(op: str, params: dict) -> dict:
    """生成スクリプトの入口。op ごとに 5 分岐し、エラーは戻り値にする。"""
    try:
        num, den = rate_fraction(params["rate"])
        if op == "loan_forward":
            result = forward(
                int(params["principal"]), num, den, params["n"], int(params["residual"])
            )
        elif op == "loan_principal":
            result = principal_for(int(params["payment"]), num, den, params["n"])
        elif op == "loan_term":
            result = term_for(int(params["principal"]), num, den, int(params["payment"]))
        elif op == "loan_bonus_forward":
            result = bonus_forward(
                int(params["principal"]),
                int(params["bonus_principal"]),
                num,
                den,
                params["n"],
            )
        elif op == "loan_bonus_principal":
            result = bonus_principal_for(
                int(params["monthly_payment"]),
                int(params["bonus_payment"]),
                num,
                den,
                params["n"],
            )
        else:
            raise ValueError(f"unknown op {op}")
    except LoanError as error:
        return {"error": error.code}
    return {k: (v if k in _COUNT_KEYS else str(v)) for k, v in result.items()}
