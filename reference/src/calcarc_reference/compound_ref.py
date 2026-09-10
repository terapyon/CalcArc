"""複利・積立の参照実装（設計書 2026-08-14 §8）。

**独立軸**: 期待値は厳密な int ループが出す（Rust と同じ丸め契約）が、
**Decimal 50 桁の閉形式が横で番人をする**——P(1+r)^n + m((1+r)^n − 1)/r を
評価し、int ループとのずれが 0 以上 期数×(1+r)^期数 以下であることを毎回
確かめる。ずれの向きは常に一方向（切り捨ての積み上がりで閉形式より小さい）
なので、符号の反転はバグの兆候である。

**共有する公開契約**（アルゴリズムの共有ではなく、base-spec §37 型の契約。
知らなければ独立検証を書けないもの）:

1. 1 期の利息 = `balance * num // den`（厳密整数、円未満切り捨て、元本組入）。
2. 積立の位置は選べる。**既定は期末**——利息を付けてから足す。その期に入れた
   金は利息を生まない。期首を選ぶと積立が利息の前に入り、その期の利息を生む
   (設計書 2026-09-03 §5.4)。
3. 年利 → 1 期の利率は**名目**（分母に期/年を掛ける）。実効換算は使わない
   （無理数になり分数に載らない。numerical-policy）。
4. 税は国税 15.315% と地方税 5% を**別々に**切り捨て、課税対象は利息。
5. 金額は u64 の定義域。超えたら Overflow。
6. **目標と比べる値は手取り**（税 ON）、**税 OFF なら残高そのもの**。逆算はこの
   1 つの値だけを見る（設計書 2026-08-15 §2）。
"""

from __future__ import annotations

from decimal import Decimal, localcontext
from typing import Literal

PRECISION = 50
U64_MAX = (1 << 64) - 1
# 期数の上限。loan の MAX_TERM_MONTHS と揃える（月次なら 100 年ぶん）。
MAX_PERIODS = 1200
PERIODS_PER_YEAR = (1, 2, 12)

# 積立を期のどちらの端で入れるか。**既定は期末**(設計書 §5.4.1)。Rust の
# `compound::DepositTiming` と同じ 2 値だが、こちらは golden の JSON にその
# まま載る綴りを持つ——`timing` を書かないケースが**既定の経路**である。
Timing = Literal["end", "start"]
END: Timing = "end"
START: Timing = "start"

NATIONAL_TAX_NUM, NATIONAL_TAX_DEN = 15315, 100_000  # 15.315%
LOCAL_TAX_NUM, LOCAL_TAX_DEN = 5, 100  # 5%
# 国税 + 地方税の合算(種の連続近似だけに使う。実際の課税は 2 回に分けて
# 別々に切り捨てる — withholding_tax)。0.20315。
TAX_RATE = Decimal(NATIONAL_TAX_NUM) / Decimal(NATIONAL_TAX_DEN) + Decimal(LOCAL_TAX_NUM) / Decimal(
    LOCAL_TAX_DEN
)


class CompoundError(Exception):
    """Rust の CalcError に対応する。`code` は golden の error 文字列。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class DepositSearchLimitError(ValueError):
    """`deposit_for` が `MAX_WALK` を使い切って諦めた、探索自身の限界。

    `corpus_calls._finance_entry` はこの**型**を見て
    `GaveUpReason.COMPOUND_DEPOSIT_SEARCH_LIMIT` に分類する。メッセージでは
    分類しない——メッセージを直した日に静かに `other` へ落ちる事故を避ける
    ため。
    """


def rate_fraction(percent: str, periods_per_year: int) -> tuple[int, int]:
    """年利のパーセント文字列 → 1 期の利率の分数 (分子, 分母)。約分しない。

    `loan_ref.rate_fraction` は分母に 12 を固定で掛ける。ここはそれを
    パラメータにしただけで、桁の扱い（小数 4 桁まで・100% 超は拒否）は同じ。

    独立: 不可能（`Rate::from_annual_percent` と同じ手順——小数点で割り、桁数で
    10^k を作り、分母に 100×期/年を掛ける。**受け付ける綴りと分母の作り方が
    仕様そのもの**である）
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


def grow(
    principal: int, deposit: int, num: int, den: int, periods: int, timing: Timing = END
) -> int:
    """厳密整数で期を回す。**答はこれが出す。**

    `timing` を渡さない呼び出しが**既定の経路**である（Rust が `grow` と
    `grow_with_timing` を分けているのと同じ理由。設計書 §5.4.6）。

    独立: 不可能（`compound::grow_with_timing` と同じループ——1 期ごとに floor で
    利息を付け、積立を位置に応じて前か後ろに足す。**各期の切り捨てが経路に依存する**
    ので閉形式に置き換えられない。この経路の独立は、下の `closed_form` が外から
    検算することで担っている）
    """
    if periods <= 0 or periods > MAX_PERIODS:
        raise CompoundError("SyntaxError")
    if principal == 0 and deposit == 0:
        raise CompoundError("SyntaxError")
    if principal > U64_MAX or deposit > U64_MAX:
        raise CompoundError("SyntaxError")
    balance = principal
    for _ in range(periods):
        if timing == START:
            balance += deposit  # 期首（契約 2）: 利息の前に入るので利息が付く
        balance += balance * num // den  # 期中の利息、円未満切り捨てで元本組入
        if timing == END:
            balance += deposit  # 期末（契約 2、既定）
        # 期中で残高が減ることは無いので、期末の 1 点だけ見れば溢れは捕まる。
        if balance > U64_MAX:
            raise CompoundError("Overflow")
    return balance


def closed_form(
    principal: int, deposit: int, num: int, den: int, periods: int, timing: Timing = END
) -> Decimal:
    """番人。Decimal 50 桁で素直に評価する（int ループの式変形は写さない）。

        期末  FV = P(1+r)^n + PMT·((1+r)^n − 1)/r
        期首  FV = P(1+r)^n + PMT·((1+r)^n − 1)/r · (1+r)

    期首は**年金部分に (1+r) を 1 回余分に掛けるだけ**である（各回の積立が
    1 期ぶん長く運用される、という年金の教科書どおりの書き方）。**整数ループに
    位置の分岐を足したものの写しではない**——ループは 1 期ずつ floor するが、
    こちらは n 期ぶんをまとめて 1 本の式で評価する。

    利率 0 では位置は効かない（利息が常に 0 なので、いつ入れても同じ）。
    **その退化はここで 1 行に畳んである**——`(1+r)` を掛けても 1 倍にしか
    ならないので、分岐そのものが要らない。

    独立: 別手順（**Rust にこの経路は無い**。整数ループの答を、閉形式を Decimal 50 桁で
    評価した値と突き合わせるためだけに在る。ここが実質的な独立軸である）
    """
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        if r == 0:
            return Decimal(principal) + Decimal(deposit) * periods
        growth = (1 + r) ** periods
        annuity = Decimal(deposit) * (growth - 1) / r
        if timing == START:
            annuity *= 1 + r
        return Decimal(principal) * growth + annuity


def check_against_closed_form(
    exact: int,
    principal: int,
    deposit: int,
    num: int,
    den: int,
    periods: int,
    timing: Timing = END,
) -> None:
    """ずれが向きと上界の中に居ることを確かめる。

    向き: 各期の切り捨ては受取を減らすので、厳密ループは閉形式**以下**。
    上界: 1 期あたり 1 円未満の損が最後まで複利で育つので 期数×(1+r)^期数。

    **向きと上界を期首について導き直した結果、同じ式になる**（2026-09-10）。
    設計書 §5.4.5 は「そのまま使えるかは未確認」と書いていたので、仮定せずに
    導いた。1 期の漸化式を実数で書くと

        期末  b_k = floor(b_{k−1}(1+r)) + d = b_{k−1}(1+r) + d − φ_k
        期首  b_k = floor((b_{k−1}+d)(1+r))  = (b_{k−1}+d)(1+r)   − φ_k

    で、`φ_k ∈ [0, 1)` は floor が落とした端数である。閉形式 `B_k` は同じ
    漸化式を `φ_k = 0` で回したものだから、ずれ `e_k = B_k − b_k` は
    **どちらの位置でも同じ漸化式**に従う:

        e_k = e_{k−1}(1+r) + φ_k,   e_0 = 0
        ⇒ e_n = Σ_{k=1..n} φ_k (1+r)^{n−k}

    **位置が変えるのは φ_k が乗る残高（期首のほうが大きい）であって、
    φ_k の範囲でも (1+r) が掛かる回数でもない。** 端数はどちらでも 1 円未満で、
    どちらでも n−k 回だけ複利で育つ。したがって

        0 ≤ e_n < Σ_{k=1..n} (1+r)^{n−k} = ((1+r)^n − 1)/r
                ≤ n(1+r)^{n−1} ≤ n(1+r)^n = 上界

    ——**上界は期首でもそのまま使える**（しかも `(1+r)` 倍ぶん緩い）。

    **掃引で確かめた**（2026-09-10 実測。**破れは 1 件も無い**）:

    - 格子: 元本 {0, 1, 1000, 100 万, 10 億} × 積立 {0, 1, 7, 3 万, 500 万} ×
      年利 {0, 0.0001, 0.1, 1, 1.5, 3, 6, 100}% × 周期 {1, 2, 12} ×
      期数 {1, 2, 3, 12, 60, 240, 1200} × 位置 2 通り。溢れる組を除いて
      **7,672 件**、向きの破れ 0 件・上界の破れ 0 件。
    - 無作為: 同じ定義域から 40,000 回引いて溢れない **11,479 件**、
      向きの破れ 0 件・上界の破れ 0 件。

    上界に対するずれの比（`e_n / (n(1+r)^n)`）の最大は**期末 0.8607 /
    期首 0.8665**（どちらも 元本 1,000・積立 7・年 1%・月複利・12 期）。
    **期首のほうがわずかに上界へ寄るが、超えない**——期首は残高が大きい
    ぶん端数 φ_k が 1 に近い値を取りやすいだけで、φ_k < 1 の壁は動かない。
    代表点（積立 3 万・年 3%・月複利・240 期）では
    **期末 153.94 円 / 期首 154.59 円**（上界 436.98 円、比 0.3523 / 0.3538）。

    **下側にわずかな余裕を持たせる。** 向きの主張は数学のものだが、閉形式は
    有限桁の Decimal で評価しているので、ずれが厳密に 0 のときに丸めが
    わずかに負へ倒すことがある。`closed_form` の `(growth - 1) / r` は
    `growth = 1 + r` が 1 に近いほど桁落ちする——低金利では 7〜8 桁失う。

    独立: 別手順（**Rust にこの経路は無い**。ループの答が閉形式の下・上界の中に
    居ることを確かめる番人で、向きと上界は数学から出している）
    実測（2026-08-20）: `principal=0`・`periods=1`・`ppy=12` の 15 通りで
    相対 4e-43 程度の負のずれが出て、**この検査が偽の失敗を出していた**。

    余裕は相対 `10 ** -(PRECISION - 20)` に取る。**1e-30 になるのは
    `PRECISION = 50` だからであって、1e-30 が定数なのではない。** 丸めの
    人工物の大きさは計算の桁数で決まるので、桁数を動かしたら余裕も一緒に
    動かないと意味を失う——だから差し引きで書く。

    引く「20 桁」の出どころ。観測された人工物は相対 4e-43 で、`PRECISION`
    の最下位（1e-50）から 7 桁ほど上にいる。桁落ちの深さは金利に依存して
    （`growth = 1 + r` が 1 に近いほど深い）動くので、観測値ぴったりに
    合わせると金利の範囲が変わった途端に偽の失敗が戻る。**観測値の 12 桁
    上**、`PRECISION` の最下位から 20 桁上に置いて余裕を持たせた。

    残りの 30 桁は 1 円との距離である。本物のずれは円の尺度で出る（各期の
    切り捨ては 1 円未満を落とし、それが複利で育つ）ので、この余裕が本物を
    隠すことはない。**これは実装間の許容誤差ではなく、Decimal の丸めの
    上界である。**
    """
    with localcontext() as ctx:
        ctx.prec = PRECISION
        closed = closed_form(principal, deposit, num, den, periods, timing)
        drift = closed - Decimal(exact)
        r = Decimal(num) / Decimal(den)
        bound = Decimal(periods) * (1 + r) ** periods
        rounding_slack = max(Decimal(1), abs(closed)) * Decimal(10) ** -(PRECISION - 20)
        if not -rounding_slack <= drift <= bound:
            raise ValueError(f"閉形式とのずれが範囲外: {drift}（上界 {bound}）")


def withholding_tax(interest: int) -> tuple[int, int]:
    """(国税, 地方税)。**別々に**切り捨てる（国税庁 No.1310）。

    独立: 不可能（`tax::withholding` と同じ手順——国税と地方税を**別々に**掛けて
    切り捨てる。合算 20.315% で 1 度に計算するのは別手順ではなく規則違反である）
    """
    national = interest * NATIONAL_TAX_NUM // NATIONAL_TAX_DEN
    local = interest * LOCAL_TAX_NUM // LOCAL_TAX_DEN
    return national, local


def reached(
    principal: int,
    deposit: int,
    num: int,
    den: int,
    periods: int,
    taxed: bool,
    timing: Timing = END,
) -> int:
    """目標と比べる値。税 ON なら手取り、OFF なら残高（公開契約 6）。

    独立: 不可能（何と比べるかは公開契約そのもの。`compound_inverse` の `reached` と
    同じ規則になる）
    """
    balance = grow(principal, deposit, num, den, periods, timing)
    if not taxed:
        return balance
    interest = balance - (principal + deposit * periods)
    national, local = withholding_tax(interest)
    return balance - national - local


# 種から歩く上限。閉形式の種は数円〜数千円しかずれない（税ぶんが最大）ので、
# ここに当たったら種か契約が壊れている。黙って長く歩かせない。
MAX_WALK = 100_000


def _reached_or_nothing(
    principal: int,
    deposit: int,
    num: int,
    den: int,
    periods: int,
    taxed: bool,
    timing: Timing = END,
) -> int:
    """探索中の 1 手。**何も入れていない状態は「何にも届かない」**として扱う。

    `grow(0, 0, ...)` は「入れた金がゼロ」で SyntaxError を上げるが、探索の
    途中でそこを踏むのは「積立 0 では届かない」を意味するだけである
    （target > 0 は入口で保証済み）。Rust 側は probe が Err を「届かない側」に
    倒すことで同じ扱いをしている。
    """
    if principal == 0 and deposit == 0:
        return 0
    return reached(principal, deposit, num, den, periods, taxed, timing)


def _deposit_seed(
    principal: int,
    num: int,
    den: int,
    periods: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> int:
    """Decimal 閉形式から積立額の種を作る。**二分探索にしない**——ここが
    唯一の式で、ここが悪いと下の歩きが `MAX_WALK` を使い切る（設計書 §4.9）。

    税 OFF、または利率 0（利息が常に 0 なので税も常に 0）のときは元々の式
    （目標 == 残高）を解く。税 ON かつ利率 ≠ 0 のときは、目標と比べる値が
    手取り（残高 − 国税 − 地方税、課税対象は利息）であることを織り込む。
    円未満切り捨てを無視した連続近似

        net ≈ balance − TAX_RATE × (balance − 投入合計)
            = balance × (1 − TAX_RATE) + TAX_RATE × 投入合計

    に `balance = principal × growth + d × (growth − 1) / r × f`、
    `投入合計 = principal + d × periods` を代入し、`net = target` を
    `d` について解く。切り捨て 2 回ぶんの誤差は数円に収まるので、
    ここから歩けば数歩で当たる。

    `f` は積立の位置の係数で、**期末なら 1、期首なら (1+r)**（`closed_form` と
    同じ 1 か所の違い）。投入合計は位置に依らない——いつ入れても入れた額は同じ
    である。
    """
    with localcontext() as ctx:
        ctx.prec = PRECISION
        r = Decimal(num) / Decimal(den)
        growth = (1 + r) ** periods
        if r == 0:
            # 利率 0: 利息は常に 0、税があっても効かない。target == balance。
            # 位置も効かない（利息が無いので入れる順に意味が無い）。
            return int((Decimal(target) - Decimal(principal)) / Decimal(periods))
        annuity = (growth - 1) / r
        if timing == START:
            annuity *= 1 + r
        if not taxed:
            remain = Decimal(target) - Decimal(principal) * growth
            return int(remain / annuity)
        net_factor = 1 - TAX_RATE
        numerator = Decimal(target) - Decimal(principal) * (net_factor * growth + TAX_RATE)
        denominator = net_factor * annuity + TAX_RATE * periods
        return int(numerator / denominator)


def _deposit_search(
    principal: int,
    num: int,
    den: int,
    periods: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> tuple[int, int]:
    """`deposit_for` の実体。返り値は `(答, 使った歩数)`。

    歩数は下向き・上向きの合計。`deposit_for` は答だけを返す——歩数は
    「種が悪いまま歩数だけ伸ばしていないか」をテストが確かめるためだけに
    存在する内部の値で、公開契約ではない。
    """
    if target <= 0:
        raise CompoundError("SyntaxError")
    if _reached_or_nothing(principal, 0, num, den, periods, taxed, timing) >= target:
        return 0, 0
    seed = _deposit_seed(principal, num, den, periods, target, taxed, timing)
    d = max(seed, 0)
    steps = 0
    while d > 0:
        if steps >= MAX_WALK:
            raise DepositSearchLimitError(
                f"種から下向きに {MAX_WALK} 歩使い切っても下限に届かない（種 {seed}）"
            )
        if _reached_or_nothing(principal, d - 1, num, den, periods, taxed, timing) < target:
            break
        d -= 1
        steps += 1
    for step in range(MAX_WALK):
        if _reached_or_nothing(principal, d, num, den, periods, taxed, timing) >= target:
            return d, steps + step
        d += 1
    raise DepositSearchLimitError(f"種から {MAX_WALK} 歩いても届かない（種 {seed}）")


def deposit_for(
    principal: int,
    num: int,
    den: int,
    periods: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> int:
    """目標を下回らない最小の積立額（設計書 §1 の裁定 4）。

    **二分探索しない**——Rust がそれをやる。ここは Decimal 閉形式の種から
    証明書を満たすまで歩く。

    定義域は兄弟の `periods_for` と同じ理屈で先に落とす。目標が正でなければ
    「いくら積み立てれば届くか」という問い自体が立たず、期数が 0 なら積み立てる
    機会が無い。`grow` が同じ期数の定義域を宣言している（`periods <= 0 or
    periods > MAX_PERIODS`）ので、ここはその宣言を入口で読んでいるだけである。

    **入口で落とすのは、歩きの中で落ちるのを待つと種の計算が先に壊れるから。**
    `principal == 0` かつ `periods == 0` だと `_deposit_seed` の
    `growth - 1` が 0 になり、`decimal.DivisionByZero` が上がる。あれは
    `ValueError` ではないので `corpus_calls._finance_entry` の分類に当てはまらず、
    **生成器ごと落ちる**（2026-08-20 実測）。他の期数 0 は歩きが `grow` に届いて
    `SyntaxError` になっていたので、**1 つの入力の組だけが別の壊れ方をしていた。**

    独立: 別手順（`compound_inverse::deposit_for` は**二分探索**で挟む。こちらは
    Decimal 閉形式の種から証明書を満たすまで歩く。**探索の構造そのものが違う。**）
    """
    if target <= 0:
        raise CompoundError("SyntaxError")
    if periods <= 0 or periods > MAX_PERIODS:
        raise CompoundError("SyntaxError")
    answer, _steps = _deposit_search(principal, num, den, periods, target, taxed, timing)
    return answer


def periods_for(
    principal: int,
    deposit: int,
    num: int,
    den: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> int:
    """目標を下回らない最小の期数。**最初に届いた期**（設計書 §4）。

    独立: 不可能（`compound_inverse::periods_for` と同じ前進走査。**手取りは期数に
    ついて非単調**（税の 2 つの floor が同じ期に跳ぶ実測反例がある）ので二分探索が
    使えない。両方が同じ手順なのは、**それしか正しい手順が無いから**である）
    """
    if target <= 0:
        raise CompoundError("SyntaxError")
    if principal == 0 and deposit == 0:
        raise CompoundError("SyntaxError")
    for n in range(1, MAX_PERIODS + 1):
        if reached(principal, deposit, num, den, n, taxed, timing) >= target:
            return n
    raise CompoundError("SyntaxError")  # 1200 期でも届かない = 発散


def check_deposit_certificate(
    d: int,
    principal: int,
    num: int,
    den: int,
    periods: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> None:
    """単調側。答の両隣 2 点で足りる（単調性の証明が §3 にある）。

    独立: 別手順（**Rust にこの経路は無い**。答が最小であることを両隣で確かめる証明書）
    """
    assert reached(principal, d, num, den, periods, taxed, timing) >= target, f"{d} が届かない"
    if d > 0:
        assert _reached_or_nothing(principal, d - 1, num, den, periods, taxed, timing) < target, (
            f"{d} は最小でない"
        )


def check_periods_certificate(
    n: int,
    principal: int,
    deposit: int,
    num: int,
    den: int,
    target: int,
    taxed: bool,
    timing: Timing = END,
) -> None:
    """非単調側。**1..n−1 の全数**を見る——「最初に届く」の定義そのもの。

    残高を持ち回る 1 本の走査で全接頭辞を評価する。**探索ではない**——打ち切りの
    判定を持たず、n まで必ず走り切る。

    独立: 別手順（**Rust にこの経路は無い**。答が「その 1 つ手前では届かない」ことまで
    確かめる証明書で、答の性質を外から言う）
    """
    balance = principal
    total = principal
    for k in range(1, n + 1):
        if timing == START:
            balance += deposit
        balance += balance * num // den
        if timing == END:
            balance += deposit
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


def compute(op: str, params: dict) -> dict:
    """生成スクリプトの入口。エラーは戻り値にする（loan_ref と同じ流儀）。

    独立: 不可能（計算をしない。op の綴りで分岐して、上の関数へ渡すだけ）
    """
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


def _timing_of(params: dict) -> Timing:
    """入力の `timing` を読む。**書いていなければ期末**（既定の経路）。

    綴りは golden にそのまま載る。知らない綴りを黙って期末に倒すと、位置を
    取り違えた入力が「既定で計算した値」として golden に焼き付くので、
    ここで落とす。
    """
    value = params.get("timing", END)
    if value not in (END, START):
        raise CompoundError("SyntaxError")
    return value


def _compute_grow(params: dict) -> dict:
    principal = int(params["principal"])
    deposit = int(params["deposit"])
    periods = params["periods"]
    timing = _timing_of(params)
    num, den = rate_fraction(params["rate"], params["periods_per_year"])
    final = grow(principal, deposit, num, den, periods, timing)
    check_against_closed_form(final, principal, deposit, num, den, periods, timing)
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
    return result


def _compute_deposit_for(params: dict) -> dict:
    principal = int(params["principal"])
    target = int(params["target"])
    periods = params["periods"]
    taxed = bool(params.get("tax"))
    timing = _timing_of(params)
    num, den = rate_fraction(params["rate"], params["periods_per_year"])
    d = deposit_for(principal, num, den, periods, target, taxed, timing)
    check_deposit_certificate(d, principal, num, den, periods, target, taxed, timing)
    return {"deposit": str(d), **_picture(principal, d, num, den, periods, taxed, timing)}


def _compute_periods_for(params: dict) -> dict:
    principal = int(params["principal"])
    deposit = int(params["deposit"])
    target = int(params["target"])
    taxed = bool(params.get("tax"))
    timing = _timing_of(params)
    num, den = rate_fraction(params["rate"], params["periods_per_year"])
    n = periods_for(principal, deposit, num, den, target, taxed, timing)
    check_periods_certificate(n, principal, deposit, num, den, target, taxed, timing)
    return {"periods": str(n), **_picture(principal, deposit, num, den, n, taxed, timing)}


def _picture(
    principal: int,
    deposit: int,
    num: int,
    den: int,
    periods: int,
    taxed: bool,
    timing: Timing = END,
) -> dict:
    """答におけるその期の全体像（設計書 §4 の Solution と同じ内訳）。"""
    balance = grow(principal, deposit, num, den, periods, timing)
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
