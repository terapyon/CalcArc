"""金融とデータスケールのコーパス(設計書 2026-08-17 §3)。

**科学計算のコーパスと形が違う。** あちらは「キー列 → 表示」だが、こちらは
「関数と引数 → 構造体」である。円もバイト数も整数なので、**期待値は厳密一致で
比べられる**——許容誤差の出る幕がない。

**期待値は既存の参照実装から取る。** `compound_ref` / `loan_ref` /
`data_scale_ref` は Python の任意精度整数と `Decimal` で計算しており、
Rust の f64 / u64 とは別物である。**ここで計算し直さない**——書き直せば
移植の危険が生まれる。

エラーも期待値として持つ。金融は入力の検証が仕事の一部なので、
**エラーになること自体が仕様**である。参照実装の `compute` は
`{"error": コード}` を返すので、それをそのまま期待値にする。
"""

from __future__ import annotations

import random
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from itertools import combinations

from . import compound_ref, data_scale_ref, loan_ref
from . import corpus_coverage as coverage

# 現実的な入力の帯。**f64 が壊れるところに寄せない**(設計書 §3.5)。
# 金融の入力には人が実際に入れる範囲がある。
PRINCIPAL_MIN, PRINCIPAL_MAX = 100_000, 500_000_000
PAYMENT_MIN, PAYMENT_MAX = 10_000, 2_000_000
MONTHS_MIN, MONTHS_MAX = 1, 480
DEPOSIT_MAX = 1_000_000
TARGET_MAX = 1_000_000_000
# **乱択は `4` を引かない**(設計書 §4.2)。`Rate::from_annual_percent` が
# 受け付けるのは 1・2・12 だけで(`rate.rs:32`)、`4` は名指しのエラー層
# (`_periods_per_year_bad_strata`)に移した。
PERIODS_PER_YEAR_OK = (1, 2, 12)
PERIODS_PER_YEAR_BAD = (0, 4, 13)
COMPOUND_PERIODS_MAX = 600

DTYPES = tuple(data_scale_ref.BYTES_PER_ELEMENT)

# u64 の上限。境界として必ず入れる。
U64_MAX_TEXT = str(2**64 - 1)


def _rate(rng: random.Random) -> str:
    """金利。0〜20% を 0.1 刻みで。**文字列で持つ**——参照実装が文字列から
    有理数を作るので、途中で浮動小数にしない。"""
    return f"{rng.randrange(0, 201) / 10:.1f}"


# 乱択の試行上限。逆算 op の入力構成(下記)は「有効な組が引けるまで引き直す」
# ので、理論上は無限ループになりうる——実測ではほぼ毎回 1〜2 回で当たるが
# (設計書 §4.4)、種が壊れたときに黙って回り続けるのを避けるため上限を持つ。
_INVERSE_CONSTRUCTION_MAX_ATTEMPTS = 10_000


def _forward_payment(principal: int, rate: str, n: int) -> int | None:
    """`principal`・`rate`・`n` から `loan_forward` の月額を返す。参照実装が
    受理しない組(発散・円境界近接など)は `None`(設計書 §4.4 の構成)。
    """
    num, den = loan_ref.rate_fraction(rate)
    try:
        return loan_ref.monthly_payment(principal, num, den, n, 0)
    except loan_ref.LoanError, ValueError:
        return None


def _loan_term_params(rng: random.Random) -> dict:
    """`loan_term` の乱択入力。**逆算の入力は正算の答から作る**(設計書 §4.4)
    ——`payment` を独立に乱択すると、初回利息を覆わない組が発散して
    `SyntaxError` になりやすい(正常率 37%の原因)。ここで `payment` を
    `loan_forward` の月額から作ると、`term_for` は必ずその `n` 前後で
    完済を見つけられる。
    """
    for _attempt in range(_INVERSE_CONSTRUCTION_MAX_ATTEMPTS):
        principal = rng.randint(PRINCIPAL_MIN, PRINCIPAL_MAX)
        rate = _rate(rng)
        n = rng.randint(MONTHS_MIN, MONTHS_MAX)
        payment = _forward_payment(principal, rate, n)
        if payment is not None:
            return {"principal": str(principal), "rate": rate, "payment": str(payment)}
    raise RuntimeError("loan_term: 有効な入力を引けなかった(構成の式を疑う)")


def _loan_principal_params(rng: random.Random) -> dict:
    """`loan_principal` の乱択入力。`loan_term` と同じ構成(設計書 §4.4)。"""
    for _attempt in range(_INVERSE_CONSTRUCTION_MAX_ATTEMPTS):
        principal = rng.randint(PRINCIPAL_MIN, PRINCIPAL_MAX)
        rate = _rate(rng)
        n = rng.randint(MONTHS_MIN, MONTHS_MAX)
        payment = _forward_payment(principal, rate, n)
        if payment is not None:
            return {"payment": str(payment), "rate": rate, "n": n}
    raise RuntimeError("loan_principal: 有効な入力を引けなかった(構成の式を疑う)")


def _loan_params(rng: random.Random, op: str) -> dict:
    if op == "loan_forward":
        principal = rng.randint(PRINCIPAL_MIN, PRINCIPAL_MAX)
        return {
            "principal": str(principal),
            "rate": _rate(rng),
            "n": rng.randint(MONTHS_MIN, MONTHS_MAX),
            "residual": str(rng.randint(0, principal)),
        }
    if op == "loan_principal":
        return _loan_principal_params(rng)
    if op == "loan_term":
        return _loan_term_params(rng)
    if op == "loan_bonus_forward":
        principal = rng.randint(PRINCIPAL_MIN, PRINCIPAL_MAX)
        return {
            "principal": str(principal),
            "bonus_principal": str(rng.randint(0, principal)),
            "rate": _rate(rng),
            "n": rng.randint(MONTHS_MIN, MONTHS_MAX),
        }
    if op == "loan_bonus_principal":
        return {
            "monthly_payment": str(rng.randint(PAYMENT_MIN, PAYMENT_MAX)),
            "bonus_payment": str(rng.randint(0, PAYMENT_MAX)),
            "rate": _rate(rng),
            "n": rng.randint(MONTHS_MIN, MONTHS_MAX),
        }
    raise ValueError(f"unknown loan op: {op!r}")


def _compound_reached(
    principal: int, deposit: int, rate: str, periods_per_year: int, periods: int, tax: bool
) -> int | None:
    """到達値(税 ON なら手取り、OFF なら残高。公開契約 6)。参照実装が
    受理しない組(元本も積立も 0、期数域外など)は `None`(設計書 §4.4)。
    """
    try:
        num, den = compound_ref.rate_fraction(rate, periods_per_year)
        return compound_ref.reached(principal, deposit, num, den, periods, tax)
    except compound_ref.CompoundError:
        return None


def _compound_deposit_for_params(rng: random.Random) -> dict:
    """`compound_deposit_for` の乱択入力。**逆算の入力は正算の答から作る**
    (設計書 §4.4)——積立額を選び、`compound_grow` の到達値を `target` にする。
    `deposit` は 1 円以上にして「元本も積立も 0」を踏まない。

    `periods_per_year` は**引き直しループの外で 1 回だけ引く**。中で引き直すと、
    `periods_per_year = 1`(年 1 回複利)は同じ `periods` でも実質的な年数が
    12 倍長くなり、Overflow で構成をやり直す率が他の周期より高くなる——
    その分だけ最終的な採用に占める `1` の割合が下がり、§4.11 の 5(周期の
    均等性)を壊す。周期を固定してから中身だけ引き直せば、この偏りは
    起きない(実装時に実測して直した)。
    """
    periods_per_year = rng.choice(PERIODS_PER_YEAR_OK)
    for _attempt in range(_INVERSE_CONSTRUCTION_MAX_ATTEMPTS):
        principal = rng.randint(0, PRINCIPAL_MAX)
        deposit = rng.randint(1, DEPOSIT_MAX)
        rate = _rate(rng)
        periods = rng.randint(1, COMPOUND_PERIODS_MAX)
        tax = rng.random() < 0.5
        target = _compound_reached(principal, deposit, rate, periods_per_year, periods, tax)
        if target is not None and target > 0:
            return {
                "principal": str(principal),
                "target": str(target),
                "periods": periods,
                "rate": rate,
                "periods_per_year": periods_per_year,
                "tax": tax,
            }
    raise RuntimeError("compound_deposit_for: 有効な入力を引けなかった(構成の式を疑う)")


def _compound_periods_for_params(rng: random.Random) -> dict:
    """`compound_periods_for` の乱択入力。期数 `n` を選び、`compound_grow`
    の到達値を `target` にする(設計書 §4.4)。`target` はちょうど `n` 期での
    到達値なので、`periods_for` は遅くとも `n` で見つける——1200 期でも
    未達という発散を踏まない。

    `periods_per_year` を引き直しループの外に出す理由は
    `_compound_deposit_for_params` と同じ。
    """
    periods_per_year = rng.choice(PERIODS_PER_YEAR_OK)
    for _attempt in range(_INVERSE_CONSTRUCTION_MAX_ATTEMPTS):
        principal = rng.randint(0, PRINCIPAL_MAX)
        deposit = rng.randint(0, DEPOSIT_MAX)
        if principal == 0 and deposit == 0:
            continue
        rate = _rate(rng)
        n = rng.randint(1, COMPOUND_PERIODS_MAX)
        tax = rng.random() < 0.5
        target = _compound_reached(principal, deposit, rate, periods_per_year, n, tax)
        if target is not None and target > 0:
            return {
                "principal": str(principal),
                "deposit": str(deposit),
                "target": str(target),
                "rate": rate,
                "periods_per_year": periods_per_year,
                "tax": tax,
            }
    raise RuntimeError("compound_periods_for: 有効な入力を引けなかった(構成の式を疑う)")


def _compound_params(rng: random.Random, op: str) -> dict:
    if op == "compound_grow":
        # 描画順は変更前と揃えてある(rate → periods_per_year → tax →
        # principal → deposit → periods)。逆算 2 op だけを構成に差し替える
        # Task なので、無関係な `compound_grow` の乱数列をずらさない。
        common = {
            "rate": _rate(rng),
            "periods_per_year": rng.choice(PERIODS_PER_YEAR_OK),
            "tax": rng.random() < 0.5,
        }
        return {
            "principal": str(rng.randint(0, PRINCIPAL_MAX)),
            "deposit": str(rng.randint(0, DEPOSIT_MAX)),
            "periods": rng.randint(1, COMPOUND_PERIODS_MAX),
            **common,
        }
    if op == "compound_deposit_for":
        return _compound_deposit_for_params(rng)
    if op == "compound_periods_for":
        return _compound_periods_for_params(rng)
    raise ValueError(f"unknown compound op: {op!r}")


LOAN_OPS = (
    "loan_forward",
    "loan_principal",
    "loan_term",
    "loan_bonus_forward",
    "loan_bonus_principal",
)
COMPOUND_OPS = ("compound_grow", "compound_deposit_for", "compound_periods_for")


@dataclass(frozen=True)
class Stratum:
    """コーパスの 1 件が属する層(設計書 §4.1)。

    コーパスの 1 件は必ずちょうど 1 つの層に属する。層の識別子 `key`
    (`"{op}/{name}"`)は、§9 の最低件数テスト・§6 の変異・D+E のレポートが
    共有する文字列である。**3 か所が別々に組み立てないよう、層の一覧は
    ここ(`corpus_calls.py`)に 1 つだけ置く。**

    `minimum` は Task 6 で `residual_zero` に 100、`bonus_zero` に 30 が入った
    (骨格の Task 3 ではすべて 0 だった。当時の生成器では実測 1 件・1 件しか
    無く、赤くなることを確かめてから直した)。`build_finance_shard` は
    `max(1, stratum.minimum)` 件を `build(rng, i)` の `i` を振って作る
    ——`minimum` はテストの下限であると同時に、その層が実際に生成される
    目標件数でもある。`i` を使わない `build`(大半の名指し境界層)は毎回
    同じ入力を返すので、そのまま 1 件だけ作られる。
    """

    op: str
    name: str
    expect: str  # "ok" | "SyntaxError" | "Overflow"
    minimum: int
    build: Callable[[random.Random, int], dict]

    @property
    def key(self) -> str:
        return f"{self.op}/{self.name}"


# **境界は乱択に任せない。名指しで列挙して全部入れる**(設計書 §3.5)。
# 乱択は境界をほぼ引かない——0 円、金利 0%、期間 1、u64 の上限、残価 = 元本。
#
# この Task では既存の名指し境界を層に移すだけで、**ケースの中身(input)を
# 1 件も変えていない**。`build` は乱数を消費しない(既存のケースが乱択で
# 作られたものではなかったので、消費すると Task 2 までで固定した乱択列が
# ずれる)。`expect` は参照実装を実際に呼んで確かめた実測である。
#
# **Task 4 で足す層(因子・水準・名指し異常系)は下に続く。** ここは骨格の
# Task が作った最初の 18 層のままにしてある——歴史的な名前を保つため。
_BOUNDARY_STRATA: tuple[Stratum, ...] = (
    Stratum(
        "loan_forward",
        "residual_zero",
        "ok",
        100,
        # `i` で元本と期間を振って 100 件の異なる入力を作る(設計書 §4.11 の 2)。
        # 金利 0% に固定するのは、`monthly_payment` の `num == 0` 分岐が
        # `_guard_boundary` を通らないため——ここは「残価 0」の網羅が目的で、
        # 金利の網羅は `_rate_level_strata` が別に担う。`principal >= n` は
        # 常に成り立つ(最小 100,000 円・最大期間 480)ので発散しない。
        lambda rng, i: {
            "principal": str(100_000 + i * 4_000_000),
            "rate": "0",
            "n": 1 + (i % MONTHS_MAX),
            "residual": "0",
        },
    ),
    Stratum(
        "loan_forward",
        "residual_equals_principal",
        "SyntaxError",
        0,
        lambda rng, i: {
            "principal": "3000000",
            "rate": "2.0",
            "n": 36,
            "residual": "3000000",
        },
    ),
    Stratum(
        "loan_forward",
        "principal_u64_max_no_interest",
        "ok",
        0,
        lambda rng, i: {
            "principal": U64_MAX_TEXT,
            "rate": "0",
            "n": 600,
            "residual": "0",
        },
    ),
    Stratum(
        "loan_forward",
        "principal_u64_max_overflow",
        "Overflow",
        0,
        lambda rng, i: {
            "principal": U64_MAX_TEXT,
            "rate": "1.5",
            "n": 1,
            "residual": "0",
        },
    ),
    Stratum(
        "loan_forward",
        "monthly_payment_below_interest",
        "SyntaxError",
        0,
        lambda rng, i: {"principal": "1", "rate": "20.0", "n": 480, "residual": "0"},
    ),
    Stratum(
        "loan_principal",
        "single_payment_no_interest",
        "ok",
        0,
        lambda rng, i: {"payment": "1", "rate": "0", "n": 1},
    ),
    Stratum(
        "loan_principal",
        "payment_max_high_rate",
        "ok",
        0,
        lambda rng, i: {"payment": str(PAYMENT_MAX), "rate": "20.0", "n": 480},
    ),
    Stratum(
        "loan_term",
        "immediate_payoff",
        "ok",
        0,
        lambda rng, i: {"principal": "100000", "rate": "0", "payment": "100000"},
    ),
    Stratum(
        "loan_term",
        # 返済額が利息に届かず、永久に終わらない入力。**エラーになること自体が仕様。**
        "payment_below_interest_diverges",
        "SyntaxError",
        0,
        lambda rng, i: {
            "principal": "500000000",
            "rate": "20.0",
            "payment": "1",
        },
    ),
    Stratum(
        "loan_bonus_forward",
        "bonus_zero",
        "ok",
        30,
        # `i` で元本と期間を振って 30 件の異なる入力を作る(設計書 §4.11 の 2)。
        # `bonus_principal = 0` は `_check_bonus_share` も `n < 6` の検査も
        # 通らない(ボーナス > 0 のときだけ効く)ので、金利 0% と合わせて
        # 常に ok になる。
        lambda rng, i: {
            "principal": str(5_000_000 + i * 1_000_000),
            "bonus_principal": "0",
            "rate": "0",
            "n": 12 + i,
        },
    ),
    Stratum(
        "loan_bonus_forward",
        "bonus_exceeds_half",
        "SyntaxError",
        0,
        lambda rng, i: {
            "principal": "5000000",
            "bonus_principal": "5000000",
            "rate": "2.7",
            "n": 84,
        },
    ),
    Stratum(
        "loan_bonus_principal",
        "single_payment_no_interest",
        "ok",
        0,
        lambda rng, i: {
            "monthly_payment": "1",
            "bonus_payment": "0",
            "rate": "0",
            "n": 1,
        },
    ),
    Stratum(
        "compound_grow",
        "principal_and_deposit_zero",
        "SyntaxError",
        0,
        lambda rng, i: {
            "principal": "0",
            "deposit": "0",
            "rate": "0",
            "periods_per_year": 1,
            "periods": 1,
            "tax": False,
        },
    ),
    Stratum(
        "compound_grow",
        "principal_u64_max_no_interest",
        "ok",
        0,
        lambda rng, i: {
            "principal": U64_MAX_TEXT,
            "deposit": "0",
            "rate": "0",
            "periods_per_year": 12,
            "periods": 1,
            "tax": True,
        },
    ),
    Stratum(
        "compound_grow",
        "long_horizon_high_rate_taxed",
        "ok",
        0,
        lambda rng, i: {
            "principal": "1000000",
            "deposit": "0",
            "rate": "20.0",
            "periods_per_year": 12,
            "periods": 600,
            "tax": True,
        },
    ),
    Stratum(
        "compound_deposit_for",
        "minimal_target",
        "ok",
        0,
        lambda rng, i: {
            "principal": "0",
            "target": "1",
            "rate": "0",
            "periods_per_year": 1,
            "periods": 1,
            "tax": False,
        },
    ),
    Stratum(
        "compound_periods_for",
        "target_met_immediately",
        "ok",
        0,
        lambda rng, i: {
            "principal": "1000000",
            "deposit": "0",
            "target": "1000000",
            "rate": "0",
            "periods_per_year": 1,
            "tax": False,
        },
    ),
    Stratum(
        "compound_periods_for",
        # 金利 0% で目標が元本より大きい——永久に届かない。エラーが仕様。
        "target_unreachable_zero_rate",
        "SyntaxError",
        0,
        lambda rng, i: {
            "principal": "1000000",
            "deposit": "0",
            "target": "2000000",
            "rate": "0",
            "periods_per_year": 1,
            "tax": False,
        },
    ),
)

# 金利 11 種(設計書 §4.2)。うち正常は 10、"100.0001" だけが上限超で SyntaxError。
# `"2.7125"` と `"99.9999"` は小数 4 桁(受理される定義域の端)。
RATE_LEVELS: tuple[tuple[str, str], ...] = (
    ("0", "ok"),
    ("0.0001", "ok"),
    ("0.001", "ok"),
    ("0.01", "ok"),
    ("0.1", "ok"),
    ("1.5", "ok"),
    ("2.7125", "ok"),
    ("20", "ok"),
    ("99.9999", "ok"),
    ("100", "ok"),
    ("100.0001", "SyntaxError"),
)

_RATE_LEVEL_NAMES: dict[str, str] = {
    "0": "rate_zero",
    "0.0001": "rate_0_0001_percent",
    "0.001": "rate_0_001_percent",
    "0.01": "rate_0_01_percent",
    "0.1": "rate_0_1_percent",
    "1.5": "rate_1_5_percent",
    "2.7125": "rate_2_7125_percent",
    "20": "rate_20_percent",
    "99.9999": "rate_99_9999_percent",
    "100": "rate_100_percent",
    "100.0001": "rate_over_max",
}

# 期間 16 種(設計書 §4.2)。**この表の `expect` は複利(§4.5 の
# 「複利の期数が 0 または 1200 超」)を表す。** loan には期間の上限ガードが
# 無いので、`1201` は loan では `ok` になる——`_term_level_strata` が
# loan_forward 用に個別に上書きする(下記)。`0` はどちらの op でもエラー。
TERM_LEVELS: tuple[tuple[int, str], ...] = (
    (0, "SyntaxError"),
    (1, "ok"),
    (2, "ok"),
    (5, "ok"),
    (6, "ok"),
    (7, "ok"),
    (11, "ok"),
    (12, "ok"),
    (13, "ok"),
    (479, "ok"),
    (480, "ok"),
    (599, "ok"),
    (600, "ok"),
    (1199, "ok"),
    (1200, "ok"),
    (1201, "SyntaxError"),
)

_TERM_LEVEL_NAMES: dict[int, str] = {
    0: "term_0",
    1: "term_1",
    2: "term_2",
    5: "term_5",
    6: "term_6",
    7: "term_7",
    11: "term_11",
    12: "term_12",
    13: "term_13",
    479: "term_479",
    480: "term_480",
    599: "term_599",
    600: "term_600",
    1199: "term_1199",
    1200: "term_1200",
    1201: "term_1201_ok_for_loan",
}

# エラー経路 17 種(設計書 §4.5、2026-08-19 訂正後)。**Rust のガードから
# 数え上げたもので、推測で足していない。** 各経路は `ERROR_PATH_STRATA` で
# 実際の層に対応づく——対応が 1 件も無ければ `test_generate_corpus.py` が
# 落ちる(§4.11 の 4)。
ERROR_PATHS: tuple[tuple[str, str], ...] = (
    ("周期が1・2・12でない", "rate.rs:32"),
    ("金利の小数5桁以上", "rate.rs:42"),
    ("金利が非数字・空・負", "rate.rs:46"),
    ("金利が100%超", "rate.rs:67"),
    ("複利の期数が0または1200超", "compound.rs:33"),
    ("ローンの期間が0(上限のガードは無い)", "schedule.rs:40"),
    ("元本も積立も0", "compound.rs:38"),
    ("残価≥元本", "schedule.rs:40"),
    ("残価ありかつn<2", "schedule.rs:43"),
    ("月額が初回利息以下(発散)", "schedule.rs:50"),
    ("残価に届く前に完済", "schedule.rs:74"),
    ("ボーナスが元本の50%超", "loan_ref.py:289"),
    ("ボーナスありかつn<6", "loan_ref.py:296"),
    ("目標0", "compound_inverse.rs"),
    ("1200期でも未達(発散)", "compound_inverse.rs"),
    ("残高がu64を超える", "compound.rs:44"),
    ("積立額がu64に収まらない", "compound_inverse.rs"),
)


def _rate_level_strata() -> tuple[Stratum, ...]:
    """RATE_LEVELS をそのまま層にする(設計書 §4.2)。`loan_forward` の
    `principal=1,000,000 / n=12 / residual=0` を土台に金利だけ動かす。
    `"100.0001"` は同時に ERROR_PATHS の「金利が100%超」を満たす。
    """
    strata = []
    for rate, expect in RATE_LEVELS:
        name = _RATE_LEVEL_NAMES[rate]
        strata.append(
            Stratum(
                "loan_forward",
                name,
                expect,
                0,
                lambda rng, i, rate=rate: {
                    "principal": "1000000",
                    "rate": rate,
                    "n": 12,
                    "residual": "0",
                },
            )
        )
    return tuple(strata)


def _term_level_strata() -> tuple[Stratum, ...]:
    """TERM_LEVELS を `loan_forward` の層にする。**`1201` だけ `ok` に
    上書きする**——loan の期間に上限のガードは無い(設計書 §4.2 の訂正、
    `loan/inverse.rs:21` の `MAX_TERM_MONTHS` は逆算の探索打ち切りであって
    入力の契約ではない)。`0` は同時に ERROR_PATHS の「ローンの期間が0」を
    満たす。
    """
    strata = []
    for n, expect in TERM_LEVELS:
        loan_expect = "ok" if n == 1201 else expect
        name = _TERM_LEVEL_NAMES[n]
        strata.append(
            Stratum(
                "loan_forward",
                name,
                loan_expect,
                0,
                lambda rng, i, n=n: {
                    "principal": "1000000",
                    "rate": "2.0",
                    "n": n,
                    "residual": "0",
                },
            )
        )
    return tuple(strata)


def _periods_per_year_bad_strata() -> tuple[Stratum, ...]:
    """周期が 1・2・12 でない層(ERROR_PATHS の 1 番目)。**`4` は乱択から
    移した分、名指しで 5 件を確保する**(設計書 §4.2 の指示)。`0` と `13`
    はそれぞれ数件で経路の網羅を満たす。
    """
    return (
        Stratum(
            "compound_grow",
            "periods_per_year_4_grow",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 4,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_per_year_4_grow_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 4,
                "periods": 24,
                "tax": True,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "periods_per_year_4",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "2.0",
                "periods_per_year": 4,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "periods_per_year_4",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "target": "2000000",
                "rate": "2.0",
                "periods_per_year": 4,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_per_year_4_alt",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "500000",
                "deposit": "10000",
                "rate": "1.0",
                "periods_per_year": 4,
                "periods": 6,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_per_year_0",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 0,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "periods_per_year_0",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "2.0",
                "periods_per_year": 0,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_per_year_13",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 13,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "periods_per_year_13",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "target": "2000000",
                "rate": "2.0",
                "periods_per_year": 13,
                "tax": False,
            },
        ),
    )


def _malformed_rate_strata() -> tuple[Stratum, ...]:
    """金利の文字列が壊れている 2 経路(ERROR_PATHS の 2・3 番目)。
    小数 5 桁以上と、非数字・空・負を、loan と compound の両方に配る。
    """
    return (
        Stratum(
            "loan_forward",
            "rate_five_decimal_digits",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "1.23456", "n": 12, "residual": "0"},
        ),
        Stratum(
            "loan_term",
            "rate_five_decimal_digits",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "0.00001", "payment": "100000"},
        ),
        Stratum(
            "compound_grow",
            "rate_five_decimal_digits",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "12.34567",
                "periods_per_year": 12,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "rate_five_decimal_digits",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "3.14159",
                "periods_per_year": 1,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "rate_five_decimal_digits",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "bonus_principal": "0",
                "rate": "0.99999",
                "n": 12,
            },
        ),
        Stratum(
            "loan_forward",
            "rate_empty",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "", "n": 12, "residual": "0"},
        ),
        Stratum(
            "loan_term",
            "rate_non_digit",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "abc", "payment": "100000"},
        ),
        Stratum(
            "compound_grow",
            "rate_negative",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "-1",
                "periods_per_year": 12,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "rate_negative_decimal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "-0.5",
                "periods_per_year": 1,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "rate_non_digit_suffix",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "bonus_principal": "0",
                "rate": "1a",
                "n": 12,
            },
        ),
    )


def _rate_over_max_strata() -> tuple[Stratum, ...]:
    """金利が100%超(ERROR_PATHS の 4 番目)。`_rate_level_strata` の
    `rate_over_max`(loan_forward)に 4 件足し、他の op にも配る。
    """
    return (
        Stratum(
            "loan_term",
            "rate_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "100.0001", "payment": "100000"},
        ),
        Stratum(
            "loan_bonus_forward",
            "rate_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "bonus_principal": "0",
                "rate": "100.0001",
                "n": 12,
            },
        ),
        Stratum(
            "compound_grow",
            "rate_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "100.0001",
                "periods_per_year": 12,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "rate_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "100.0001",
                "periods_per_year": 1,
                "periods": 12,
                "tax": False,
            },
        ),
    )


def _compound_periods_out_of_range_strata() -> tuple[Stratum, ...]:
    """複利の期数が 0 または 1200 超(ERROR_PATHS の 5 番目)。

    **`compound_deposit_for` の `principal=0` かつ `periods=0` をここに入れて
    ある。** Task 4 の時点ではこの組だけが `_deposit_seed` の
    `growth - 1 == 0` で `decimal.DivisionByZero` を投げ、`_finance_entry` の
    分類(`ValueError`)にも当てはまらず生成器ごと落ちていた。`deposit_for` の
    入口に定義域のガードを置いて直したので、いまは他の期数 0 と同じ
    `SyntaxError` になる。**直したことを、この 1 件がコーパスの中で見張る**
    ——Rust も同じ入力を `SyntaxError` にする(`compound_inverse.rs:67`)ので、
    退行すれば `pnpm heavy` が両実装の食い違いとして落とす。
    """
    return (
        Stratum(
            "compound_grow",
            "periods_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 1,
                "periods": 0,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 2,
                "periods": 1201,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "periods_over_max_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "rate": "2.0",
                "periods_per_year": 12,
                "periods": 1201,
                "tax": True,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "periods_over_max",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "2.0",
                "periods_per_year": 1,
                "periods": 1201,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "periods_over_max_with_principal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000",
                "target": "1000000",
                "rate": "2.0",
                "periods_per_year": 1,
                "periods": 1201,
                "tax": False,
            },
        ),
        # **生成器を落としていた 1 件。** docstring を見よ。元本 0・期数 0 の組。
        Stratum(
            "compound_deposit_for",
            "periods_zero_without_principal",
            "SyntaxError",
            1,
            lambda rng, i: {
                "principal": "0",
                "target": "1000000",
                "rate": "2.0",
                "periods_per_year": 1,
                "periods": 0,
                "tax": False,
            },
        ),
    )


def _principal_and_deposit_zero_strata() -> tuple[Stratum, ...]:
    """元本も積立も0(ERROR_PATHS の 7 番目)。既存の
    `compound_grow/principal_and_deposit_zero` に加え、`compound_periods_for`
    側と周期違いを補う。
    """
    return (
        Stratum(
            "compound_grow",
            "principal_and_deposit_zero_ppy2",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": "0",
                "rate": "1.0",
                "periods_per_year": 2,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "principal_and_deposit_zero_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": "0",
                "rate": "1.0",
                "periods_per_year": 12,
                "periods": 600,
                "tax": True,
            },
        ),
        Stratum(
            "compound_periods_for",
            "principal_and_deposit_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": "0",
                "target": "1000000",
                "rate": "1.0",
                "periods_per_year": 1,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "principal_and_deposit_zero_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": "0",
                "target": "1000000",
                "rate": "1.0",
                "periods_per_year": 12,
                "tax": True,
            },
        ),
    )


def _residual_at_least_principal_strata() -> tuple[Stratum, ...]:
    """残価≥元本(ERROR_PATHS の 8 番目)。既存の `residual_equals_principal`
    に加え、==(別値)と > の両方を配る。
    """
    return (
        Stratum(
            "loan_forward",
            "residual_equals_principal_alt",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "2000000", "rate": "1.5", "n": 24, "residual": "2000000"},
        ),
        Stratum(
            "loan_forward",
            "residual_exceeds_principal",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "500000", "rate": "0", "n": 12, "residual": "600000"},
        ),
        Stratum(
            "loan_forward",
            "residual_exceeds_principal_by_one",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "3000000", "rate": "5.0", "n": 60, "residual": "3000001"},
        ),
        Stratum(
            "loan_forward",
            "residual_far_exceeds_principal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "100000",
                "rate": "20.0",
                "n": 6,
                "residual": "999999999",
            },
        ),
    )


def _residual_with_single_payment_strata() -> tuple[Stratum, ...]:
    """残価ありかつ n<2(ERROR_PATHS の 9 番目)。すべて `n=1`。"""
    return (
        Stratum(
            "loan_forward",
            "residual_with_single_payment",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "2.0", "n": 1, "residual": "500000"},
        ),
        Stratum(
            "loan_forward",
            "residual_with_single_payment_minimal",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "500000", "rate": "0", "n": 1, "residual": "1"},
        ),
        Stratum(
            "loan_forward",
            "residual_with_single_payment_near_principal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "3000000",
                "rate": "5.0",
                "n": 1,
                "residual": "2999999",
            },
        ),
        Stratum(
            "loan_forward",
            "residual_with_single_payment_high_rate",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "200000",
                "rate": "10.0",
                "n": 1,
                "residual": "100000",
            },
        ),
        Stratum(
            "loan_forward",
            "residual_with_single_payment_large",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "10000000",
                "rate": "1.0",
                "n": 1,
                "residual": "9999999",
            },
        ),
    )


def _payment_below_interest_strata() -> tuple[Stratum, ...]:
    """月額が初回利息以下(発散)(ERROR_PATHS の 10 番目)。`loan_term` の
    `term_for` は `payment <= 初回利息` を入口で直接検査する
    (`loan_ref.py:236`。Rust は `inverse.rs:52` が同じ検査を先取りし、
    `schedule.rs:50` の同型の検査に落ちる前に弾く)。既存の
    `payment_below_interest_diverges` に 4 件足す。
    """
    return (
        Stratum(
            "loan_term",
            "payment_below_interest_high_rate",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "100000000", "rate": "50.0", "payment": "100"},
        ),
        Stratum(
            "loan_term",
            "payment_below_interest_moderate_principal",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "99.0", "payment": "1000"},
        ),
        Stratum(
            "loan_term",
            "payment_below_interest_max_rate",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "400000000", "rate": "99.9999", "payment": "10000"},
        ),
        Stratum(
            "loan_term",
            "payment_below_interest_small_principal",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "250000000", "rate": "10.0", "payment": "50000"},
        ),
    )


def _paid_off_before_residual_strata() -> tuple[Stratum, ...]:
    """残価に届く前に完済(ERROR_PATHS の 11 番目、`schedule.rs:74`)。

    通常の現実的な元本(`PRINCIPAL_MIN` 以上)では、`monthly_payment` が
    残価ちょうどに届くよう annuity で払込額を較正するため、定例回の途中で
    先に払い切ってしまうことが**構造的に起きない**——200,000 件のランダム
    探索(元本 1,000〜10^9、金利 0.1〜99%、n 3〜50)で 1 件も再現しなかった
    (実装報告に記録)。**極小の元本**(1 桁〜2 桁円)でだけ、円未満切り捨ての
    比率が annuity の較正を崩して再現する。この 5 件は総当たりで実測した
    値そのもの。
    """
    return (
        Stratum(
            "loan_forward",
            "paid_off_before_residual_1",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "6", "rate": "99.0", "n": 8, "residual": "1"},
        ),
        Stratum(
            "loan_forward",
            "paid_off_before_residual_2",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "7", "rate": "80.0", "n": 9, "residual": "1"},
        ),
        Stratum(
            "loan_forward",
            "paid_off_before_residual_3",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "7", "rate": "99.0", "n": 9, "residual": "2"},
        ),
        Stratum(
            "loan_forward",
            "paid_off_before_residual_4",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "8", "rate": "80.0", "n": 10, "residual": "1"},
        ),
        Stratum(
            "loan_forward",
            "paid_off_before_residual_5",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "8", "rate": "99.9999", "n": 10, "residual": "2"},
        ),
    )


def _bonus_exceeds_half_strata() -> tuple[Stratum, ...]:
    """ボーナスが元本の50%超(ERROR_PATHS の 12 番目)。既存の
    `bonus_exceeds_half` に 4 件足す(`bonus_principal * 2 > principal`)。
    """
    return (
        Stratum(
            "loan_bonus_forward",
            "bonus_exceeds_half_moderate",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "3000000",
                "bonus_principal": "2000000",
                "rate": "1.0",
                "n": 36,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_exceeds_half_zero_rate",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "10000000",
                "bonus_principal": "6000000",
                "rate": "0",
                "n": 120,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_exceeds_half_near_principal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "bonus_principal": "999999",
                "rate": "5.0",
                "n": 12,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_exceeds_half_high_rate",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "8000000",
                "bonus_principal": "5000000",
                "rate": "3.0",
                "n": 240,
            },
        ),
    )


def _bonus_with_short_term_strata() -> tuple[Stratum, ...]:
    """ボーナスありかつ n<6(ERROR_PATHS の 13 番目、`loan_ref.py:296`)。
    `BONUS_INTERVAL_MONTHS = 6` の手前 5 か月(`n=1..5`)をそのまま並べる。
    """
    return tuple(
        Stratum(
            "loan_bonus_forward",
            f"bonus_with_term_{n}",
            "SyntaxError",
            0,
            lambda rng, i, n=n: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "2.0",
                "n": n,
            },
        )
        for n in range(1, 6)
    )


def _target_zero_strata() -> tuple[Stratum, ...]:
    """目標0(ERROR_PATHS の 14 番目)。`compound_deposit_for` と
    `compound_periods_for` の両方に配る。
    """
    return (
        Stratum(
            "compound_deposit_for",
            "target_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "0",
                "rate": "2.0",
                "periods_per_year": 1,
                "periods": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "target_zero_with_principal",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "target": "0",
                "rate": "1.0",
                "periods_per_year": 12,
                "periods": 24,
                "tax": True,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "target_zero_zero_rate",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": "0",
                "rate": "0",
                "periods_per_year": 2,
                "periods": 6,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "target_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1000000",
                "deposit": "0",
                "target": "0",
                "rate": "2.0",
                "periods_per_year": 1,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "target_zero_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": "10000",
                "target": "0",
                "rate": "1.0",
                "periods_per_year": 12,
                "tax": True,
            },
        ),
    )


def _unreachable_target_strata() -> tuple[Stratum, ...]:
    """1200期でも未達(発散)(ERROR_PATHS の 15 番目)。既存の
    `target_unreachable_zero_rate` に 4 件足す。**金利 0% かつ積立 0** なら
    残高が増えないので、目標が元本を超えていれば確実に発散する
    (決定的で、乱数を使わない)。
    """
    return (
        Stratum(
            "compound_periods_for",
            "target_unreachable_zero_rate_ppy2",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "500000",
                "deposit": "0",
                "target": "900000",
                "rate": "0",
                "periods_per_year": 2,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "target_unreachable_zero_rate_by_one",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "2000000",
                "deposit": "0",
                "target": "2000001",
                "rate": "0",
                "periods_per_year": 12,
                "tax": False,
            },
        ),
        Stratum(
            "compound_periods_for",
            "target_unreachable_zero_rate_taxed",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "100000",
                "deposit": "0",
                "target": "999999999",
                "rate": "0",
                "periods_per_year": 1,
                "tax": True,
            },
        ),
        Stratum(
            "compound_periods_for",
            "target_unreachable_zero_rate_large",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "1",
                "deposit": "0",
                "target": "1000000000",
                "rate": "0",
                "periods_per_year": 1,
                "tax": False,
            },
        ),
    )


def _balance_overflow_strata() -> tuple[Stratum, ...]:
    """残高がu64を超える(ERROR_PATHS の 16 番目、Overflow)。"""
    return (
        Stratum(
            "compound_grow",
            "balance_overflow_from_interest",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": U64_MAX_TEXT,
                "deposit": "0",
                "rate": "1.0",
                "periods_per_year": 12,
                "periods": 1,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "balance_overflow_tiny_rate",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": str(2**64 - 2),
                "deposit": "0",
                "rate": "0.0001",
                "periods_per_year": 1,
                "periods": 1,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "balance_overflow_max_rate",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": str(10**19),
                "deposit": "0",
                "rate": "100",
                "periods_per_year": 1,
                "periods": 1,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "balance_overflow_from_deposit",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "deposit": str(2**63),
                "rate": "0",
                "periods_per_year": 1,
                "periods": 600,
                "tax": False,
            },
        ),
        Stratum(
            "compound_grow",
            "balance_overflow_principal_and_deposit",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": str(2**63),
                "deposit": str(2**63),
                "rate": "0",
                "periods_per_year": 1,
                "periods": 2,
                "tax": False,
            },
        ),
    )


def _deposit_overflow_strata() -> tuple[Stratum, ...]:
    """積立額がu64に収まらない(ERROR_PATHS の 17 番目、Overflow)。
    `deposit_for` の二分探索が `u64::MAX` を超えて Overflow を返す構図
    (`compound_inverse.rs` の `an_unreachable_target_overflows_instead_of_looping`
    と同じ形: 0%・2 期・目標 `u64::MAX` は最小の積立が `2^63` を超える)。
    """
    return (
        Stratum(
            "compound_deposit_for",
            "deposit_overflow_ppy1",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": U64_MAX_TEXT,
                "rate": "0",
                "periods_per_year": 1,
                "periods": 2,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "deposit_overflow_ppy2",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": U64_MAX_TEXT,
                "rate": "0",
                "periods_per_year": 2,
                "periods": 2,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "deposit_overflow_ppy12",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": U64_MAX_TEXT,
                "rate": "0",
                "periods_per_year": 12,
                "periods": 2,
                "tax": False,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "deposit_overflow_taxed",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": U64_MAX_TEXT,
                "rate": "0",
                "periods_per_year": 1,
                "periods": 2,
                "tax": True,
            },
        ),
        Stratum(
            "compound_deposit_for",
            "deposit_overflow_ppy12_taxed",
            "Overflow",
            0,
            lambda rng, i: {
                "principal": "0",
                "target": U64_MAX_TEXT,
                "rate": "0",
                "periods_per_year": 12,
                "periods": 2,
                "tax": True,
            },
        ),
    )


def _find_simultaneous_tax_jump(start: int) -> int:
    """国税・地方税の床が同じ利息で同時に跳ぶ最小の利息を `start` から昇順に
    決定的に探す(乱数を使わない、設計書 §4.6)。名指しの 7 値(0/1/6/7/10/19/20)
    は既に利息 19→20 でこの形(国税 2→3・地方税 0→1)を使っているので、
    `start` はその先に置いて、別の値を探す。
    """
    prev_national, prev_local = compound_ref.withholding_tax(start - 1)
    interest = start
    while True:
        national, local = compound_ref.withholding_tax(interest)
        if national != prev_national and local != prev_local:
            return interest
        prev_national, prev_local = national, local
        interest += 1


def _find_tax_rounding_mismatch(start: int) -> int:
    """合計 20.315% を 1 回切り捨てる計算と、国税 15.315%・地方税 5% を
    別々に切り捨てる計算とで 1 円ずれる最小の利息を、`start` から昇順に
    決定的に探す(乱数を使わない、設計書 §4.6)。`start` には `tax.rs` の
    ユニットテストが持つ `2,648,906` を渡す。**一括の分数は
    `compound_ref` 自身の国税・地方税の定数から組む**——20315/100000 を
    ここに書き写すと、定数がずれたときに黙って古い値のまま検算することになる。
    """
    combined_num = (
        compound_ref.NATIONAL_TAX_NUM * compound_ref.LOCAL_TAX_DEN
        + compound_ref.LOCAL_TAX_NUM * compound_ref.NATIONAL_TAX_DEN
    )
    combined_den = compound_ref.NATIONAL_TAX_DEN * compound_ref.LOCAL_TAX_DEN
    interest = start
    while True:
        national, local = compound_ref.withholding_tax(interest)
        combined = interest * combined_num // combined_den
        if national + local != combined:
            return interest
        interest += 1


def _find_non_monotone_net_valley(
    principal: int, deposit: int, num: int, den: int, search_limit: int
) -> tuple[int, int, int]:
    """`到達 → 未達 → 再到達` の形を、`compound_ref.reached` を期の昇順に
    呼びながら決定的に探す(乱数を使わない、設計書 §5.2・Task 8)。

    手取り(`net`)は期数について単調ではない——税は利息にだけ掛かり、
    国税(15.315%)と地方税(5%)は**別々に**切り捨てる(`withholding_tax`)。
    ある期からその次の期に移るとき、残高の増分(その期の利息そのもの)より
    国税・地方税の床の増分の合計が大きいと、`net` は前の期より下がる。

    `search_limit` 期まで昇順に `reached(taxed=True)` を呼び、**最初に前の
    期より値が下がる期**(谷)を見つけたら、その直前の期の値を目標にして、
    それより後の期で再びその値以上に戻る期(再到達)を探す。**見つからな
    ければ探索を打ち切らず `RuntimeError` で止まる**——この層を黙って
    空にすると、Task 11 の変異 #9(§5.2)が検出力を静かに失う。

    返り値は `(到達した期, 未達の期, 再到達した期)`。すべて 1-indexed。
    """
    values = [
        compound_ref.reached(principal, deposit, num, den, n, True)
        for n in range(1, search_limit + 1)
    ]
    for dip_index in range(1, len(values)):
        if values[dip_index] < values[dip_index - 1]:
            reached_period = dip_index  # values[dip_index - 1] はこの期の値
            dip_period = dip_index + 1  # values[dip_index] はこの期の値
            target = values[dip_index - 1]
            for recovery_index in range(dip_index + 1, len(values)):
                if values[recovery_index] >= target:
                    return reached_period, dip_period, recovery_index + 1
            raise RuntimeError(
                f"非単調層: 期 {reached_period} → {dip_period} の谷は見つかったが、"
                f"search_limit={search_limit} 以内に再到達しない(範囲を広げる)"
            )
    raise RuntimeError(
        f"非単調層: principal={principal} num={num} den={den} の"
        f"search_limit={search_limit} 期以内に谷が見つからない(範囲を広げるか入力を見直す)"
    )


# 決定的な探索(乱数を使わない)。結果は corpus に焼き付き、再生成一致ゲート
# (`test_corpus_reproducibility.py`)が固定する。
_TAX_SIMULTANEOUS_JUMP_INTEREST = _find_simultaneous_tax_jump(21)
_TAX_ROUNDING_MISMATCH_INTEREST = _find_tax_rounding_mismatch(2_648_906)

# 非単調層の入力(設計書 §5.2・Task 8)。元本 100 万円・積立 0・年利
# 0.0001%・年 1 回複利にすると、1 期の利息は `floor(残高 / 1,000,000)` に
# なり、残高が 200 万円を超えるまで(1200 期の探索範囲を大きく超える)毎期
# ちょうど 1 円ずつ積み上がる——利息の累計が期数と一致するので、国税・
# 地方税の床の跳びを 1 円単位で狙い撃てる(`_tax_boundary_grow` と同じ
# 手口)。谷そのものは探索が見つける——期数を決め打ちしない。
_NON_MONOTONE_NET_PRINCIPAL = 1_000_000
_NON_MONOTONE_NET_RATE = "0.0001"
_NON_MONOTONE_NET_PERIODS_PER_YEAR = 1
_NON_MONOTONE_NET_NUM, _NON_MONOTONE_NET_DEN = compound_ref.rate_fraction(
    _NON_MONOTONE_NET_RATE, _NON_MONOTONE_NET_PERIODS_PER_YEAR
)
(
    _NON_MONOTONE_NET_REACHED_PERIOD,
    _NON_MONOTONE_NET_DIP_PERIOD,
    _NON_MONOTONE_NET_RECOVERY_PERIOD,
) = _find_non_monotone_net_valley(
    _NON_MONOTONE_NET_PRINCIPAL,
    0,
    _NON_MONOTONE_NET_NUM,
    _NON_MONOTONE_NET_DEN,
    search_limit=200,
)
_NON_MONOTONE_NET_TARGET = compound_ref.reached(
    _NON_MONOTONE_NET_PRINCIPAL,
    0,
    _NON_MONOTONE_NET_NUM,
    _NON_MONOTONE_NET_DEN,
    _NON_MONOTONE_NET_REACHED_PERIOD,
    True,
)


def _tax_boundary_grow(principal: str) -> dict:
    """`periods_per_year = 1`・`periods = 1`・`deposit = "0"`・
    `rate = "0.0001"` の `compound_grow`(税あり)。1 期の利息は
    `floor(元本 / 1,000,000)` になる(`Rate` の分母が `scale×100×ppy` =
    10^4×100×1 = 10^6、`rate.rs` の `from_annual_percent`)。**元本を選べば
    利息を 1 円単位で狙える**(設計書 §4.6)。
    """
    return {
        "principal": principal,
        "deposit": "0",
        "rate": "0.0001",
        "periods_per_year": 1,
        "periods": 1,
        "tax": True,
    }


def _tax_boundary_strata() -> tuple[Stratum, ...]:
    """税の境界(設計書 §4.6)。狙う利息 0/1/6/7/10/19/20 は、国税の床の
    跳び目(6→7、0→1)と地方税の床の跳び目(19→20、0→1)を挟む
    (`tax.rs` の `withholding`)。**元本を 1 桁でも書き間違えると跳びが
    消える**ので、`test_generate_corpus.py` は件数ではなく跳びそのものを
    参照実装の出力から確かめる。

    利息 0 は元本 0 が(元本も積立も 0 で)`SyntaxError` になるため、
    `999,999` で代える(design table の注記どおり)。

    残り 2 層は決定的探索(乱数を使わない)で見つけた:
    - `tax_simultaneous_jump`: 国税と地方税が同じ利息で同時に跳ぶ値。
    - `tax_rounding_mismatch`: 合計 20.315% の一括切り捨てと、国税・地方税を
      別々に切り捨てるのとで 1 円ずれる値(`tax.rs` の `2,648,906` を起点に
      探索。**それ自身が既にずれていた**)。
    """
    return (
        Stratum(
            "compound_grow", "tax_interest_0", "ok", 0, lambda rng, i: _tax_boundary_grow("999999")
        ),
        Stratum(
            "compound_grow", "tax_interest_1", "ok", 0, lambda rng, i: _tax_boundary_grow("1000000")
        ),
        Stratum(
            "compound_grow", "tax_interest_6", "ok", 0, lambda rng, i: _tax_boundary_grow("6000000")
        ),
        Stratum(
            "compound_grow", "tax_interest_7", "ok", 0, lambda rng, i: _tax_boundary_grow("7000000")
        ),
        Stratum(
            "compound_grow",
            "tax_interest_10",
            "ok",
            0,
            lambda rng, i: _tax_boundary_grow("10000000"),
        ),
        Stratum(
            "compound_grow",
            "tax_interest_19",
            "ok",
            0,
            lambda rng, i: _tax_boundary_grow("19000000"),
        ),
        Stratum(
            "compound_grow",
            "tax_interest_20",
            "ok",
            0,
            lambda rng, i: _tax_boundary_grow("20000000"),
        ),
        Stratum(
            "compound_grow",
            "tax_simultaneous_jump",
            "ok",
            0,
            lambda rng, i: _tax_boundary_grow(str(_TAX_SIMULTANEOUS_JUMP_INTEREST * 1_000_000)),
        ),
        Stratum(
            "compound_grow",
            "tax_rounding_mismatch",
            "ok",
            0,
            lambda rng, i: _tax_boundary_grow(str(_TAX_ROUNDING_MISMATCH_INTEREST * 1_000_000)),
        ),
    )


def _non_monotone_net_strata() -> tuple[Stratum, ...]:
    """`compound_periods_for/non_monotone_net`(設計書 §5.2、Task 8)。

    **これは件数を守るための層ではない。** `compound_ref.periods_for` は
    税の 2 つの床(国税 15.315%・地方税 5%)が同じ期に同時に跳ぶと、その期
    だけ手取り(`net`)が前の期より下がることがある——税は利息にだけ掛かり、
    利息は残高の増分(その期の利息そのもの)だけしか押し上げないので、税の
    増分がそれを上回るとこうなる。Task 11 で入る Finance 変異 #9
    (`compound_inverse.rs::periods_for` を、期数についての前進 1 本の全走査
    から二分探索に置き換える)は、この谷を飛び越えて誤った期を返す
    ——**しかしこの層が空だと、どのコーパスのケースもその誤りを踏まない。**
    つまりこのテストが守っているのは層の件数そのものではなく、**別の場所
    (変異 #9)の検出力**である(§5.2)。

    入力は `_find_non_monotone_net_valley` が決定的に(乱数を使わず)見つけた
    谷: 元本 100 万円・積立 0・年利 0.0001%・年 1 回複利・税ありで、利息が
    1 円ずつ積み上がる区間に、国税・地方税の床の最初の同時跳び(利息
    19→20、`_find_simultaneous_tax_jump` の docstring が名指ししている
    もの——`tax_simultaneous_jump` 層はこれを避けて 21 以降を探している)が
    重なる。目標は谷の直前の期の手取りにする——`到達(谷の直前の期)
    → 未達(谷の期) → 再到達(その後の期)` の形になる。期数を決め打ちにせず、
    探索が見つけた期数をそのまま焼き付ける。
    """
    return (
        Stratum(
            "compound_periods_for",
            "non_monotone_net",
            "ok",
            0,
            lambda rng, i: {
                "principal": str(_NON_MONOTONE_NET_PRINCIPAL),
                "deposit": "0",
                "target": str(_NON_MONOTONE_NET_TARGET),
                "rate": _NON_MONOTONE_NET_RATE,
                "periods_per_year": _NON_MONOTONE_NET_PERIODS_PER_YEAR,
                "tax": True,
            },
        ),
    )


def _residual_axis_strata() -> tuple[Stratum, ...]:
    """`loan_forward` の残価 7 層のうち、Task 6 で足す 4 つ(設計書 §4.2)。
    `residual_zero`(既存、下限 100)・`residual_equals_principal`(既存、
    ERROR_PATH の「残価≥元本」)・`residual_exceeds_principal`(同上)と
    合わせて 7 層になる。金利は 0% に固定してある——残価の網羅が目的で、
    金利の網羅は `_rate_level_strata` が別に担う。
    """
    return (
        Stratum(
            "loan_forward",
            "residual_one",
            "ok",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "0", "n": 24, "residual": "1"},
        ),
        Stratum(
            "loan_forward",
            "residual_40_percent",
            "ok",
            0,
            lambda rng, i: {"principal": "1000000", "rate": "0", "n": 24, "residual": "400000"},
        ),
        Stratum(
            "loan_forward",
            "residual_50_percent",
            "ok",
            0,
            lambda rng, i: {"principal": "2000000", "rate": "0", "n": 24, "residual": "1000000"},
        ),
        Stratum(
            "loan_forward",
            "residual_principal_minus_one",
            "ok",
            0,
            # 金利 0% だと(規則的な支払いが残価の手前まで一気に落ちて)定例回の
            # 途中で払い切ってしまい `SyntaxError` になる(実装時に実測)ので、
            # ここだけ金利を入れて調整回を作る。
            lambda rng, i: {"principal": "1000000", "rate": "2.0", "n": 24, "residual": "999999"},
        ),
    )


def _bonus_axis_strata() -> tuple[Stratum, ...]:
    """`loan_bonus_forward` のボーナス 9 層のうち、Task 6 で足す 6 つ
    (設計書 §4.2)。`bonus_zero`(既存、下限 30)・`bonus_exceeds_half`
    (既存、ERROR_PATH の「ボーナスが元本の50%超」)・`bonus_with_term_5`
    (既存、ERROR_PATH の「ボーナスありかつn<6」の `n=5`)と合わせて 9 層に
    なる。**50% ちょうどは正常側**(`bonus_principal * 2 > principal` は
    `>` であって `>=` ではない、`loan_ref.py:298`)。
    """
    return (
        Stratum(
            "loan_bonus_forward",
            "bonus_below_half",
            "ok",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "0",
                "n": 24,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_equals_half",
            "ok",
            0,
            lambda rng, i: {
                "principal": "4000000",
                "bonus_principal": "2000000",
                "rate": "0",
                "n": 24,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_n_6",
            "ok",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "0",
                "n": 6,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_n_7",
            "ok",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "0",
                "n": 7,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_multiple_of_6",
            "ok",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "0",
                "n": 18,
            },
        ),
        Stratum(
            "loan_bonus_forward",
            "bonus_not_multiple_of_6",
            "ok",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "1000000",
                "rate": "0",
                "n": 13,
            },
        ),
    )


def _inverse_answer_milestone_strata() -> tuple[Stratum, ...]:
    """逆算の答が 480・600・1200 付近に落ちる層(設計書 §4.4)。

    **答を狙う op(期間を返す `loan_term` と `compound_periods_for`)だけに
    要る。** `loan_principal` と `compound_deposit_for` は期間ではなく金額を
    返すので、この意味での「480/600/1200 付近」という軸を持たない。

    `payment` / `target` は正算(`loan_ref.forward` / `compound_ref.reached`)
    の答から作る——これは移植ではなく、入力を構成しているだけである
    (設計書 §4.4 の注記)。`compound_periods_for` は `tax=False` に固定する:
    税ありだと手取りが期数について非単調になりうる(実装時の既知の性質)ので、
    「税 OFF なら答は残高そのもの、かつ残高は期数について単調」という条件で
    初めて、狙った `n` がそのまま最初の到達期になることを保証できる。
    """
    milestones = (480, 600, 1200)

    def _loan_term_milestone(n: int) -> Stratum:
        num, den = loan_ref.rate_fraction("5.0")
        payment = loan_ref.monthly_payment(50_000_000, num, den, n, 0)
        return Stratum(
            "loan_term",
            f"answer_near_{n}",
            "ok",
            0,
            lambda rng, i, payment=payment: {
                "principal": "50000000",
                "rate": "5.0",
                "payment": str(payment),
            },
        )

    def _periods_milestone(n: int) -> Stratum:
        num, den = compound_ref.rate_fraction("2.0", 12)
        target = compound_ref.reached(1_000_000, 10_000, num, den, n, False)
        return Stratum(
            "compound_periods_for",
            f"answer_near_{n}",
            "ok",
            0,
            lambda rng, i, target=target: {
                "principal": "1000000",
                "deposit": "10000",
                "target": str(target),
                "rate": "2.0",
                "periods_per_year": 12,
                "tax": False,
            },
        )

    return tuple(_loan_term_milestone(n) for n in milestones) + tuple(
        _periods_milestone(n) for n in milestones
    )


# **経路名 → 層の key の対応。** ERROR_PATHS の網羅テストがここを読む
# (テスト側に写しを持たない、設計書 §4.1 と同じ理由)。骨格 Task が作った
# 既存層(`residual_equals_principal` など)を再利用している経路は、
# 対応するタプルの先頭に既存の key を含めてある。
ERROR_PATH_STRATA: dict[str, tuple[str, ...]] = {
    "周期が1・2・12でない": tuple(s.key for s in _periods_per_year_bad_strata()),
    "金利の小数5桁以上": tuple(
        s.key for s in _malformed_rate_strata() if s.name == "rate_five_decimal_digits"
    ),
    "金利が非数字・空・負": tuple(
        s.key
        for s in _malformed_rate_strata()
        if s.name
        in (
            "rate_empty",
            "rate_non_digit",
            "rate_negative",
            "rate_negative_decimal",
            "rate_non_digit_suffix",
        )
    ),
    "金利が100%超": (
        "loan_forward/rate_over_max",
        *(s.key for s in _rate_over_max_strata()),
    ),
    "複利の期数が0または1200超": tuple(s.key for s in _compound_periods_out_of_range_strata()),
    "ローンの期間が0(上限のガードは無い)": (
        "loan_forward/term_0",
        "loan_principal/term_zero",
        "loan_bonus_forward/term_zero",
        "loan_bonus_principal/term_zero",
        "loan_forward/term_zero_alt",
    ),
    "元本も積立も0": (
        "compound_grow/principal_and_deposit_zero",
        *(s.key for s in _principal_and_deposit_zero_strata()),
    ),
    "残価≥元本": (
        "loan_forward/residual_equals_principal",
        *(s.key for s in _residual_at_least_principal_strata()),
    ),
    "残価ありかつn<2": tuple(s.key for s in _residual_with_single_payment_strata()),
    "月額が初回利息以下(発散)": (
        "loan_term/payment_below_interest_diverges",
        *(s.key for s in _payment_below_interest_strata()),
    ),
    "残価に届く前に完済": tuple(s.key for s in _paid_off_before_residual_strata()),
    "ボーナスが元本の50%超": (
        "loan_bonus_forward/bonus_exceeds_half",
        *(s.key for s in _bonus_exceeds_half_strata()),
    ),
    "ボーナスありかつn<6": tuple(s.key for s in _bonus_with_short_term_strata()),
    "目標0": tuple(s.key for s in _target_zero_strata()),
    "1200期でも未達(発散)": (
        "compound_periods_for/target_unreachable_zero_rate",
        *(s.key for s in _unreachable_target_strata()),
    ),
    "残高がu64を超える": tuple(s.key for s in _balance_overflow_strata()),
    "積立額がu64に収まらない": tuple(s.key for s in _deposit_overflow_strata()),
}


def _term_zero_strata_for_remaining_ops() -> tuple[Stratum, ...]:
    """ローンの期間が0(ERROR_PATHS の 6 番目)を、`n` を取る残り 3 op
    (`loan_forward` は `_term_level_strata` の `term_0` が担う)に配る。
    """
    return (
        Stratum(
            "loan_principal",
            "term_zero",
            "SyntaxError",
            0,
            lambda rng, i: {"payment": "100000", "rate": "2.0", "n": 0},
        ),
        Stratum(
            "loan_bonus_forward",
            "term_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "principal": "5000000",
                "bonus_principal": "0",
                "rate": "1.0",
                "n": 0,
            },
        ),
        Stratum(
            "loan_bonus_principal",
            "term_zero",
            "SyntaxError",
            0,
            lambda rng, i: {
                "monthly_payment": "100000",
                "bonus_payment": "0",
                "rate": "1.0",
                "n": 0,
            },
        ),
        Stratum(
            "loan_forward",
            "term_zero_alt",
            "SyntaxError",
            0,
            lambda rng, i: {"principal": "2000000", "rate": "3.0", "n": 0, "residual": "0"},
        ),
    )


# === Task 7: ペアワイズ割付(IPOG、設計書 §4.3) ==============================


def pairwise(factors: dict[str, Sequence[object]]) -> list[dict[str, object]]:
    """2 因子網羅の行を決定的に返す。**乱数を使わない。**

    貪欲な集合被覆で組む: 「まだ覆っていない、2 つの因子の水準の組」のうち
    辞書順で最小のものを 1 つ選んで行を起こし、残りの因子はその行の中で
    「すでに決めた水準との組み合わせで、いちばん多くの未覆ペアを稼げる
    水準」を選んで埋める(同点は各因子の水準の並び順で先に出たものを取る)。
    すべてのペアを覆うまでこれを繰り返す。

    因子の並び順・各因子の水準の並び順だけで行と行の順序が決まるので、
    **同じ `factors` を渡せば何度呼んでも同じ行が同じ順で返る**(このモジュール
    の呼び出し側は `dict` のキー順・タプルの並び順を固定して使っている)。

    2 因子しかない場合、ペアワイズ網羅は全交差と一致する(覆うべきペアが
    水準の組の数だけあり、1 行が高々 1 組しか覆えないため)。3 因子以上で
    初めて、全交差より少ない行数で全ペアを覆えるようになる。

    IPOG(In Parameter Order - General)のように因子を 1 つずつ順に足す
    段階的な作り方ではなく、貪欲な被覆を直接解く——このモジュールが扱う
    規模(最大 4 因子・水準 15 種程度)では、貪欲でも実用的な行数に収まり、
    「全ペアを覆うまで止まらない」という正しさがループの構造からそのまま
    読める。
    """
    names = list(factors)
    if not names:
        return []
    if len(names) == 1:
        only = names[0]
        return [{only: level} for level in factors[only]]

    index = {name: position for position, name in enumerate(names)}

    def canonical_pair(
        factor_a: str, level_a: object, factor_b: str, level_b: object
    ) -> tuple[str, object, str, object]:
        if index[factor_a] < index[factor_b]:
            return (factor_a, level_a, factor_b, level_b)
        return (factor_b, level_b, factor_a, level_a)

    needed: set[tuple[str, object, str, object]] = set()
    for i, factor_a in enumerate(names):
        for factor_b in names[i + 1 :]:
            for level_a in factors[factor_a]:
                for level_b in factors[factor_b]:
                    needed.add((factor_a, level_a, factor_b, level_b))

    def pair_sort_key(pair: tuple[str, object, str, object]) -> tuple:
        factor_a, level_a, factor_b, level_b = pair
        return (index[factor_a], repr(level_a), index[factor_b], repr(level_b))

    rows: list[dict[str, object]] = []
    while needed:
        factor_a, level_a, factor_b, level_b = min(needed, key=pair_sort_key)
        row: dict[str, object] = {factor_a: level_a, factor_b: level_b}
        for name in names:
            if name in row:
                continue
            best_level, best_gain = None, -1
            for level in factors[name]:
                gain = sum(
                    1
                    for other_name, other_level in row.items()
                    if canonical_pair(other_name, other_level, name, level) in needed
                )
                if gain > best_gain:
                    best_gain, best_level = gain, level
            row[name] = best_level
        rows.append(row)
        for i, factor_a2 in enumerate(names):
            for factor_b2 in names[i + 1 :]:
                needed.discard((factor_a2, row[factor_a2], factor_b2, row[factor_b2]))
    return rows


# 金利は RATE_LEVELS のうち ok だけ(10 種)。`"100.0001"` はエラー水準なので
# 因子の水準に混ぜない(設計書 §4.3)。
PAIRWISE_RATE_LEVELS: tuple[str, ...] = tuple(
    rate for rate, expect in RATE_LEVELS if expect == "ok"
)

# 期間は op によって「ok」の意味が違う(§4.2 の訂正)。loan は `1201` も ok
# (上限のガードが無い)。複利は `1201` がエラーなので TERM_LEVELS の宣言
# (複利を表す)をそのまま使える。
PAIRWISE_LOAN_TERM_LEVELS: tuple[int, ...] = tuple(n for n, _ in TERM_LEVELS if n != 0)
PAIRWISE_COMPOUND_TERM_LEVELS: tuple[int, ...] = tuple(
    n for n, expect in TERM_LEVELS if expect == "ok"
)

# loan の 4 op(forward・principal・bonus_forward・bonus_principal)が共有する
# 因子表。`n` はこの 4 op ではすべて**そのまま入力に使われる**リテラルな
# 因子である(`loan_term` だけ `n` が答なので別扱い、下記)。
PAIRWISE_LOAN_FACTORS: dict[str, tuple] = {
    "rate": PAIRWISE_RATE_LEVELS,
    "n": PAIRWISE_LOAN_TERM_LEVELS,
}

# 複利の 3 op が使う因子。`compound_periods_for` だけ「期間」が答なので
# 持たない(設計書の注記「その op が持たない因子を無理に入れない」)。
PAIRWISE_COMPOUND_GROW_FACTORS: dict[str, tuple] = {
    "rate": PAIRWISE_RATE_LEVELS,
    "periods": PAIRWISE_COMPOUND_TERM_LEVELS,
    "periods_per_year": PERIODS_PER_YEAR_OK,
    "tax": (False, True),
}
PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS: dict[str, tuple] = {
    "rate": PAIRWISE_RATE_LEVELS,
    "periods_per_year": PERIODS_PER_YEAR_OK,
    "tax": (False, True),
}

_PAIRWISE_LOAN_ROWS: tuple[dict[str, object], ...] = tuple(pairwise(PAIRWISE_LOAN_FACTORS))
_PAIRWISE_COMPOUND_GROW_ROWS: tuple[dict[str, object], ...] = tuple(
    pairwise(PAIRWISE_COMPOUND_GROW_FACTORS)
)
_PAIRWISE_COMPOUND_PERIODS_FOR_ROWS: tuple[dict[str, object], ...] = tuple(
    pairwise(PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS)
)
# `compound_deposit_for` は `compound_grow` と同じ 4 因子(§4.4 と同じ構成の
# 理屈で、`periods` がそのまま入力になる op どうし)。同じ因子表なので
# `pairwise()` は同じ行を返す——2 度呼んでも計算し直すだけで結果は同じ
# (この関数は乱数を使わないので、呼び出し回数は結果に影響しない)。
_PAIRWISE_COMPOUND_DEPOSIT_FOR_ROWS = _PAIRWISE_COMPOUND_GROW_ROWS

# loan の pairwise 行が使う元本の土台。ちょうど 20,000,000 という値自体に
# 意味は無い(他の名指し層と重ならない、程度の良い実額)。
_LOAN_PAIRWISE_PRINCIPAL_BASE = 20_000_000
# 円境界(`NearYenBoundaryError`、番人)を避けるための決定的な候補列。
# **乱択ではない**——同じ (rate, n) には毎回同じ候補を同じ順で試す。
# 実測(2026-08-20): この列で全 150 組が円境界以外の結果(ok か本物の
# LoanError)に落ち着く。
_LOAN_PAIRWISE_PRINCIPAL_OFFSETS: tuple[int, ...] = (
    0,
    1,
    3,
    7,
    13,
    29,
    53,
    101,
    199,
    401,
    809,
    1601,
)


def _pairwise_forward_result(rate: str, n: int) -> tuple[int, int | None, str] | None:
    """`(principal, monthly_payment または None, expect)` を返す。

    候補の元本を `_LOAN_PAIRWISE_PRINCIPAL_OFFSETS` の順に試し、
    `NearYenBoundaryError`(特定の元本にだけ起きる番人の artifact)に当たった
    候補は飛ばして次を試す。**`LoanError`(SyntaxError/Overflow)は元本を
    変えても消えない本物の結果なので、最初に当たった時点でそのまま採用する**
    ——実測(2026-08-20): 金利 20% × 期間 1199 か月のような「返済額が利息に
    収束していく」組は、元本を 10 万円から 5 億円まで振っても同じ
    SyntaxError になる(長期・高金利の年金現価が利息収束に近づく、本物の
    数理)。全候補が円境界だけに当たった場合は `None`(実測では起きない)。
    """
    num, den = loan_ref.rate_fraction(rate)
    for offset in _LOAN_PAIRWISE_PRINCIPAL_OFFSETS:
        principal = _LOAN_PAIRWISE_PRINCIPAL_BASE + offset
        try:
            result = loan_ref.forward(principal, num, den, n, 0)
            return principal, result["monthly_payment"], "ok"
        except loan_ref.LoanError as error:
            return principal, None, error.code
        except ValueError:
            continue
    return None


# `loan_principal` / `loan_bonus_principal` に使う固定の月額。`principal_for`
# には円境界の番人が無い(`_guard_boundary` は `monthly_payment` だけが呼ぶ)
# ので、元本をずらす必要が無く、金利・期間の全 150 組がそのまま安全に使える
# (実測、2026-08-20)。
_PAIRWISE_LOAN_PAYMENT_FIXED = "300000"


def _pairwise_loan_principal_strata() -> tuple[Stratum, ...]:
    strata = []
    index = 0
    for row in _PAIRWISE_LOAN_ROWS:
        params = {"payment": _PAIRWISE_LOAN_PAYMENT_FIXED, "rate": row["rate"], "n": row["n"]}
        if not _claim_pairwise_signature("loan_principal", params):
            continue
        result = loan_ref.compute("loan_principal", params)
        expect = result.get("error", "ok")
        strata.append(
            Stratum(
                "loan_principal",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    return tuple(strata)


def _pairwise_loan_bonus_principal_strata() -> tuple[Stratum, ...]:
    strata = []
    index = 0
    for row in _PAIRWISE_LOAN_ROWS:
        params = {
            "monthly_payment": _PAIRWISE_LOAN_PAYMENT_FIXED,
            "bonus_payment": "0",
            "rate": row["rate"],
            "n": row["n"],
        }
        if not _claim_pairwise_signature("loan_bonus_principal", params):
            continue
        result = loan_ref.compute("loan_bonus_principal", params)
        expect = result.get("error", "ok")
        strata.append(
            Stratum(
                "loan_bonus_principal",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    return tuple(strata)


def _pairwise_loan_forward_like_strata(op: str, bonus_key: str | None) -> tuple[Stratum, ...]:
    """`loan_forward` / `loan_bonus_forward`(ボーナス 0)用。`monthly_payment`
    の計算そのものが円境界の番人を通るので、`_pairwise_forward_result` で
    元本を決定的にずらしながら本物の結果を取る。
    """
    strata = []
    index = 0
    for row in _PAIRWISE_LOAN_ROWS:
        rate, n = row["rate"], row["n"]
        resolved = _pairwise_forward_result(rate, n)
        assert resolved is not None, f"{op}: 円境界しか無い組(想定外): rate={rate} n={n}"
        principal, _payment, expect = resolved
        params = {"principal": str(principal), "rate": rate, "n": n, "residual": "0"}
        if bonus_key is not None:
            params[bonus_key] = "0"
        if not _claim_pairwise_signature(op, params):
            continue
        strata.append(
            Stratum(
                op,
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    return tuple(strata)


# `loan_term` の pairwise 行数(実測、2026-08-20)。`n` は `loan_term` の
# 入力ではなく答なので、`forward` で払える月額を作れた組だけを行にする——
# `_pairwise_forward_result` が本物の `LoanError` を返した組(元本を変えても
# 払えない = そもそも forward が定義できない)は、この op の入力を構成する
# 元ネタが無いので**その組だけ**飛ばす(§4.4 の構成が前提にしている「正算の
# 答から作る」が成り立たない)。他の 4 op(forward 系・principal 系)は `n` が
# 答ではなくそのまま入力なので、この飛ばしを持たない——同じ (rate, n) の
# 組は必ずどれかの loan op でコーパスに現れる(集計はテストで確かめる)。
#
# **2026-08-29 に 17 → 24 へ動かした(Task 5)。数を測り直したのではなく、
# 数える対象が増えた。** 以前ここが数えていたのは「正算が本物のエラーで、
# 逆算の入力を作る元ネタが無い」行だけ(17 行)だった。Task 5 が
# `_construct_loan_term_row` を入れたので、**「入力は作れたが、決定的な候補を
# 尽くしても目標期間に乗らない」行(7 行)も飛ばす**ようになった——以前は
# それを飛ばさず、**目標と違う期間のケースとして黙って混ぜていた。**
# 7 行はすべて `target_n = 1201` で、`loan_ref.MAX_TERM_MONTHS = 1200` である
# 以上 `loan_term` は 1201 を返しようがない(`loan_term_exclusions` が
# `not_applicable` として理由を付ける)。
PAIRWISE_LOAN_TERM_SKIPPED_COUNT = 24


@dataclass(frozen=True)
class LoanTermFact:
    """`loan_term` の 1 行が、目標期間に対して何をしたか(設計書 §8.2)。

    **`target_n` は入力ではなく答である。** 正算で作った月額を逆算へ戻すと、
    円単位の丸めのぶんだけ答がずれることがある——ずれた行は計算の照合には
    使えるが、**目標期間セルを被覆したことにはならない。**

    `state` の 3 値:

    - `covered`  … `actual_n == target_n`
    - `excluded` … 正算が本物のエラーで、逆算の入力そのものを構成できない
    - `unmet`    … ケースは作れたが、目標期間を満たしていない
    """

    rate_level: str
    target_n: int
    principal: int
    payment: int | None
    actual_n: int | None
    error: str | None
    state: str


_LOAN_TERM_FACTS: list[LoanTermFact] = []


#: 月額の増分の候補。**固定順**(設計書 §8.3)。**`+0` を先に試す**——まず素の
#: 月額で目標に乗るかを見て、乗らなければ `+1` へ進む。円単位に丸めた月額を
#: 逆算へ戻すと 1 期ぶん長く出ることが多いので、**2 番目が `+1`** である。
#: 実測(2026-08-29): 構成できた 126 行のうち **76 行が `+0`、50 行が `+1`**。
#: (2026-08-29 訂正: ここは「`+1` を先に試す」と書いていたが、**タプルは `0` が
#: 先**で、引いている実測もそちらと整合していた。**誤っていたのは注釈だけ。**)
_LOAN_TERM_PAYMENT_DELTAS: tuple[int, ...] = (0, 1, -1, 2, -2)


def _construct_loan_term_row(rate: str, target: int) -> tuple[int, int] | None:
    """`actual_n == target` になる `(principal, payment)` を**固定順**で探す。

    **乱数を使わない。候補順は `_LOAN_PAIRWISE_PRINCIPAL_OFFSETS`(12 通り) ×
    `_LOAN_TERM_PAYMENT_DELTAS`(5 通り)の 60 通りで、試行上限もこれである。**
    上限を宣言するだけでは検証にならないので、**尽きたら `None` を返し、
    呼び手が理由付きの除外にする**——黙って別の期間のケースへ置き換えない。

    `LoanError` は元本を変えても消えない本物の結果なので、その場で諦める
    (`_pairwise_forward_result` と同じ判断。実測: 高金利 × 長期は元本を
    10 万円から 5 億円まで振っても同じ SyntaxError になる)。
    `ValueError` は円境界の番人で、**特定の元本にだけ起きる artifact**
    なので次の元本へ進む。

    **`_pairwise_forward_result` との違いは、最初の候補で打ち切らないこと**
    である。あちらは正算が通った時点で確定するが、こちらは**逆算が目標に
    乗るまで**進む——実測で 2 行が、これだけで被覆へ動く。
    """
    num, den = loan_ref.rate_fraction(rate)
    for offset in _LOAN_PAIRWISE_PRINCIPAL_OFFSETS:
        principal = _LOAN_PAIRWISE_PRINCIPAL_BASE + offset
        try:
            forward = loan_ref.forward(principal, num, den, target, 0)
        except loan_ref.LoanError:
            return None
        except ValueError:
            continue
        for delta in _LOAN_TERM_PAYMENT_DELTAS:
            payment = forward["monthly_payment"] + delta
            if payment <= 0:
                continue
            result = loan_ref.compute(
                "loan_term",
                {"principal": str(principal), "rate": rate, "payment": str(payment)},
            )
            if "error" not in result and int(result["n"]) == target:
                return principal, payment
    return None


def compound_deposit_for_exclusions(
    covered: set[coverage.Cell],
) -> dict[coverage.Cell, coverage.Exclusion]:
    """踏めなかったペアに理由を付ける(設計書 §9.1・§10)。

    **一律に貼らない。セルごとに、参照実装へ聞いて確かめる。** 目標値は
    `_compound_reached` が正算で作るので、そこが u64 を溢れると逆算の入力
    そのものを作れない。**積立額は既に最小(1 円)**なので、`(1+r)^n` が溢れる
    組は元本や積立額をどう振っても救えない(§9.2 の代替構成の外にある)。

    **説明できないセルが 1 つでもあれば落とす。** 計画は 19 件へ一律に
    `source_overflow` を貼る形だったが、**実測(2026-08-29)ではそのうち 2 件が
    溢れていなかった**——`(rate=100, ppy=12)` と `(rate=99.9999, ppy=12)` は
    期間を振り直せば構成でき、いまは `_deposit_for_construction` が覆っている。
    **一律に貼っていたら、偽の理由が 2 件コーパスに載っていた。**
    未分類の理由を `other` として通さないのと同じ姿勢である。
    """
    requirement = _REQUIREMENT_OF["compound_deposit_for"]
    out: dict[coverage.Cell, coverage.Exclusion] = {}
    unexplained: list[str] = []
    for cell in requirement.cells:
        if cell in covered:
            continue
        axes = dict(cell.axes)
        rate, periods = axes.get("rate"), axes.get("periods")
        if rate is None or periods is None or _deposit_for_target_exists(str(rate), int(periods)):
            # 溢れていない(または期間を名指ししていない)セルは、**構成できる
            # はずのものが未達で残っている**ということである。理由を作らない。
            unexplained.append(cell.id)
            continue
        out[cell] = coverage.Exclusion(
            cell,
            coverage.Reason.SOURCE_OVERFLOW,
            "積立 1 円でも正算が u64 を溢れるので、逆算の目標値を作れない",
            (f"compound_grow/{','.join(f'{k}={v}' for k, v in cell.axes)}",),
        )
    if unexplained:
        raise RuntimeError(
            "compound_deposit_for: 理由を説明できない未達セルがある——"
            f"構成できるはずのものが漏れている: {sorted(unexplained)[:5]}"
        )
    return out


def _deposit_for_target_exists(rate: str, periods: int) -> bool:
    """その (金利, 期間) で、積立 1 円の正算が答を出せるか。

    **周期と税の全通りを試す。** 1 つでも通れば「溢れて作れない」とは言えない
    ——セルが要求しているのは金利と期間だけで、残りは構成の自由度である。
    """
    for per_year in PAIRWISE_COMPOUND_GROW_FACTORS["periods_per_year"]:
        for tax in PAIRWISE_COMPOUND_GROW_FACTORS["tax"]:
            reached = _compound_reached(0, 1, rate, int(per_year), periods, bool(tax))
            if reached is not None and reached > 0:
                return True
    return False


def loan_term_exclusions() -> dict[coverage.Cell, coverage.Exclusion]:
    """構成できなかった目標期間セルに理由を付ける(設計書 §8.3・§10)。

    **2 つの理由を混ぜない。** `not_applicable` は「その操作にその水準が
    存在しない」——`loan_term` は `MAX_TERM_MONTHS` を上限に探索するので、
    それを超える期間は**答になり得ない**。`inverse_target_unconstructible` は
    「努力したが作れなかった」で、正算そのものが本物のエラーを返す行である。
    **前者は何も失っていないが、後者は失っている**(設計書 §10.2 の判断区分)。
    """
    out: dict[coverage.Cell, coverage.Exclusion] = {}
    for fact in LOAN_TERM_FACTS:
        if fact.state == "covered":
            continue
        cell = coverage.Cell(
            "loan_term", (("rate", fact.rate_level), ("target_n", str(fact.target_n)))
        )
        if fact.target_n > loan_ref.MAX_TERM_MONTHS:
            out[cell] = coverage.Exclusion(
                cell,
                coverage.Reason.NOT_APPLICABLE,
                f"loan_term は {loan_ref.MAX_TERM_MONTHS} か月を上限に探索するので、"
                f"{fact.target_n} か月は答になり得ない",
                (f"loan_forward/rate={fact.rate_level},n={fact.target_n}",),
            )
        elif fact.state == "excluded" and fact.error not in (None, "no-construction"):
            # **走った手順だけを書く。** この行では正算が最初の元本でエラーを
            # 返し、**構成探索(元本 12 通り × 月額 5 通り)は 1 度も走っていない**
            # ——`_pairwise_loan_term_strata` が `forward_expect != "ok"` の時点で
            # ここへ回すからである。**「尽くした」と書けるのは尽くしたときだけ。**
            #
            # 元本を変えても消えないことは別に確かめてある——
            # `test_the_unconstructible_rows_really_have_no_principal_that_works`
            # が 12 通りすべてを実際に試す(実測 2026-08-29: 14 行とも全滅)。
            out[cell] = coverage.Exclusion(
                cell,
                coverage.Reason.INVERSE_TARGET_UNCONSTRUCTIBLE,
                f"正算が {fact.error} を返すので、逆算の入力を作る元ネタが無い",
                (f"loan_forward/rate={fact.rate_level},n={fact.target_n}",),
            )
        else:
            # 正算は通ったが、構成探索が候補を尽くしても目標に乗らなかった行。
            # **こちらは実際に尽くしている。**
            out[cell] = coverage.Exclusion(
                cell,
                coverage.Reason.INVERSE_TARGET_UNCONSTRUCTIBLE,
                "決定的な候補(元本 12 通り × 月額の増分 5 通り)を尽くしても、"
                "逆算が目標期間に乗らない",
                (f"loan_forward/rate={fact.rate_level},n={fact.target_n}",),
            )
    return out


def _pairwise_loan_term_strata() -> tuple[Stratum, ...]:
    strata = []
    index = 0
    infeasible = 0
    for row in _PAIRWISE_LOAN_ROWS:
        rate, n = row["rate"], row["n"]
        resolved = _pairwise_forward_result(rate, n)
        if resolved is None:
            infeasible += 1
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, 0, None, None, "no-candidate", "excluded")
            )
            continue
        principal, payment, forward_expect = resolved
        if forward_expect != "ok":
            infeasible += 1
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, principal, None, None, forward_expect, "excluded")
            )
            continue
        # **目標期間に乗る組を、固定順で探す**(設計書 §8.3)。`_pairwise_forward_result`
        # は正算が通った最初の元本で確定するが、**その月額を逆算へ戻すと丸めの
        # ぶんだけ答がずれる**——ずれた行は計算の照合には使えるが、目標期間セルを
        # 被覆したことにはならない。尽きたら `None` で、**その行は除外になる**
        # (`loan_term_exclusions` が理由を付ける)。黙って別の期間へ置き換えない。
        constructed = _construct_loan_term_row(rate, n)
        if constructed is None:
            infeasible += 1
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, principal, payment, None, "no-construction", "excluded")
            )
            continue
        principal, payment = constructed
        params = {"principal": str(principal), "rate": rate, "payment": str(payment)}
        if not _claim_pairwise_signature("loan_term", params):
            # 実測(2026-08-25)ではここを通る行は無い(150 = 133 + 17)。**通った
            # ときに黙って消えないよう**、記録だけは残す。
            _LOAN_TERM_FACTS.append(
                LoanTermFact(rate, n, principal, payment, None, "duplicate", "unmet")
            )
            continue
        result = loan_ref.compute("loan_term", params)
        expect = result.get("error", "ok")
        actual = None if "error" in result else int(result["n"])
        _LOAN_TERM_FACTS.append(
            LoanTermFact(
                rate,
                n,
                principal,
                payment,
                actual,
                None if actual is not None else expect,
                "covered" if actual == n else "unmet",
            )
        )
        strata.append(
            Stratum(
                "loan_term",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    assert infeasible == PAIRWISE_LOAN_TERM_SKIPPED_COUNT, (
        f"loan_term pairwise: 構成できなかった数が実測({PAIRWISE_LOAN_TERM_SKIPPED_COUNT})と違う"
        f"(実際は {infeasible})——因子表か候補列を変えたのでは"
    )
    return tuple(strata)


def _pairwise_compound_grow_strata() -> tuple[Stratum, ...]:
    """`compound_grow` は正算そのものなので、`grow()` が Overflow を投げても
    参照実装は安全に `{"error": "Overflow"}` を返す(探索が絡まないので
    `ReferenceGaveUp` の危険が無い)。**`expect` は決め打たない**——高金利 ×
    長期間 × 周期 1 回/年は、元本をいくら小さくしても u64 を超える(2 の
    べき乗の複利は元本の大きさに関係なく発散する)。これは正常値だけで
    組んだ結果として実際に起きる Overflow であって、エラー水準を混ぜたから
    起きたのではない——設計時に気づいた点(実装報告に記録)。

    `principal` は `0` ではなく非 0 にする。**実測(2026-08-20)**:
    `principal=0` かつ `periods=1` かつ `periods_per_year=12` の一部の金利で、
    `compute()` の閉形式番人(`check_against_closed_form`)が `drift < 0`
    (実測 `-4e-39` 程度)で落ちる——`(1+r)**1` を Decimal の `**` 演算子で
    評価する際の丸めが、元本 0 で `principal_total` 側の桁を失って露出する、
    参照実装の Decimal 精度の隅である(`grow()` 自体の整数ループは正しい)。
    `compound_ref.py` は変更しない(Task 7 の範囲外)ので、この層の構成では
    `principal` を非 0 にしてこの隅を踏まないようにする。
    """
    strata = []
    index = 0
    for row in _PAIRWISE_COMPOUND_GROW_ROWS:
        params = {
            "principal": "1000000",
            "deposit": "10000",
            "rate": row["rate"],
            "periods_per_year": row["periods_per_year"],
            "periods": row["periods"],
            "tax": row["tax"],
        }
        if not _claim_pairwise_signature("compound_grow", params):
            continue
        result = compound_ref.compute("compound_grow", params)
        expect = result.get("error", "ok")
        strata.append(
            Stratum(
                "compound_grow",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    return tuple(strata)


# `compound_deposit_for` の pairwise 行数(実測、2026-08-20)。§4.4 と同じ
# 構成(積立額を選び、`compound_grow` の到達値を `target` にする)を使うが、
# 積立額は最小の 1 円に固定する(§4.4 の「答が 480/600/1200 付近になる」の
# ような特定の答を狙う軸ではなく、pairwise はレベルの組そのものが目的な
# ので、積立額を動かす理由が無い——動かすと `target` が変わり、後述の
# Overflow 判定がぶれる)。それでも高金利 × 長期間では**積立額を 1 円に
# しても** `compound_grow` 側の正算が Overflow するので `target` を作れない
# 組が残る——`compound_grow` の pairwise 層が同じ (rate, periods,
# periods_per_year, tax) の組を Overflow として持っているので、コーパス
# 全体で見ればその組は「現れている」(テストが確かめる)。
# **2026-08-29(Task 6)に 17 → 0 へ動いた。数え方ではなく作り方が変わった。**
# 以前は期間で溢れた行をそのまま捨てていたが、**1 行が運ぶのはペア 6 組**で、
# **期間を含まない 3 組まで一緒に落ちていた**——実測で `(rate=100, ppy=12)` と
# `(rate=99.9999, ppy=12)` の 2 組が、溢れていないのに未達として残っていた。
# いまは `_deposit_for_construction` が期間の水準を振り直すので、
# **構成できない行は無い。** 溢れた (金利,期間) のセルは未達のまま残り、
# `compound_deposit_for_exclusions` がセルごとに理由を付ける。
PAIRWISE_COMPOUND_DEPOSIT_FOR_SKIPPED_COUNT = 0


def _deposit_for_construction(row: Mapping[str, object]) -> tuple[int, int, int] | None:
    """ペアワイズ 1 行から `(periods, target)` を作る。**溢れたら期間を振り直す。**

    **1 行が運ぶのはペア 6 組である**(設計書 §7.2): (金利,期間)・(金利,周期)・
    (金利,税)・(期間,周期)・(期間,税)・(周期,税)。**期間で溢れて行ごと捨てると、
    期間を含まない 3 組まで一緒に落ちる**——実測(2026-08-29)では
    `(rate=100, ppy=12)` と `(rate=99.9999, ppy=12)` の 2 組が、
    **溢れていないのに未達として残っていた。**

    **期間の水準を因子表の順で振り直す。** 決定的で、上限は水準の数である。
    振り直した行が覆うのは**別の期間のセル**なので、**溢れた (金利,期間) の
    セルは未達のまま残る**——そちらは `compound_deposit_for_exclusions` が
    セルごとに溢れを確かめて理由を付ける。**救えるものだけを救う。**
    """
    rate = str(row["rate"])
    per_year = int(row["periods_per_year"])  # type: ignore[arg-type]
    tax = bool(row["tax"])
    periods0 = int(row["periods"])  # type: ignore[arg-type]
    # **因子表を直接見る。** `COVERAGE_FACTORS` はこの下で組まれるので、
    # 層の構築時にはまだ存在しない——写しを持たず、素の表を指す。
    per_years = PAIRWISE_COMPOUND_GROW_FACTORS["periods_per_year"]
    # **周期を先に振る。期間は最後まで動かさない。** 枯れているのは
    # (金利, 期間) の組で、周期は他の行がいくらでも運ぶ——**動かす順が
    # そのまま「何を諦めるか」の順である。**
    for per in (per_year, *per_years):
        target = _compound_reached(0, 1, rate, int(per), periods0, tax)
        if target is not None and target > 0:
            return periods0, int(per), target
    for periods in PAIRWISE_COMPOUND_GROW_FACTORS["periods"]:
        for per in (per_year, *per_years):
            target = _compound_reached(0, 1, rate, int(per), int(periods), tax)
            if target is not None and target > 0:
                return int(periods), int(per), target
    return None


def _pairwise_compound_deposit_for_strata() -> tuple[Stratum, ...]:
    strata = []
    index = 0
    infeasible = 0
    for row in _PAIRWISE_COMPOUND_DEPOSIT_FOR_ROWS:
        constructed = _deposit_for_construction(row)
        if constructed is None:
            infeasible += 1
            continue
        periods, per_year, target = constructed
        params = {
            "principal": "0",
            "target": str(target),
            "periods": periods,
            "rate": row["rate"],
            "periods_per_year": per_year,
            "tax": row["tax"],
        }
        if not _claim_pairwise_signature("compound_deposit_for", params):
            continue
        result = compound_ref.compute("compound_deposit_for", params)
        expect = result.get("error", "ok")
        strata.append(
            Stratum(
                "compound_deposit_for",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    # **2026-08-29(Task 6)に 17 → 0 へ動いた。** 期間で溢れた行を捨てるのを
    # やめ、**期間の水準を振り直して行を作る**ようにしたため。溢れた
    # (金利,期間) のセルは未達のまま残り、`compound_deposit_for_exclusions`
    # がセルごとに理由を付ける——**行の救済とセルの除外は別の話である。**
    assert infeasible == PAIRWISE_COMPOUND_DEPOSIT_FOR_SKIPPED_COUNT, (
        f"compound_deposit_for pairwise: 構成できなかった数が実測"
        f"({PAIRWISE_COMPOUND_DEPOSIT_FOR_SKIPPED_COUNT})と違う(実際は {infeasible})"
        "——因子表を変えたのでは"
    )
    return tuple(strata)


def _pairwise_compound_periods_for_strata() -> tuple[Stratum, ...]:
    """`compound_periods_for` は「期間」を答として持たない(設計書の注記)
    ので、因子は金利・周期・税の 3 つ。答を短い期間に収めるため、積立額
    1,000 円・期数 10 で正算した到達値を `target` にする——**期数 10 は
    因子ではなく構成の定数**(rate=100%・periods_per_year=1 という最悪条件
    でも 2^10 は u64 に遠く及ばないので、全 30 組で Overflow を踏まない)。
    """
    strata = []
    index = 0
    for row in _PAIRWISE_COMPOUND_PERIODS_FOR_ROWS:
        target = _compound_reached(0, 1000, row["rate"], row["periods_per_year"], 10, row["tax"])
        assert target is not None and target > 0, f"periods_for pairwise: 構成が失敗した {row}"
        params = {
            "principal": "0",
            "deposit": "1000",
            "target": str(target),
            "rate": row["rate"],
            "periods_per_year": row["periods_per_year"],
            "tax": row["tax"],
        }
        if not _claim_pairwise_signature("compound_periods_for", params):
            continue
        result = compound_ref.compute("compound_periods_for", params)
        expect = result.get("error", "ok")
        strata.append(
            Stratum(
                "compound_periods_for",
                f"pairwise_{index:04d}",
                expect,
                0,
                lambda rng, i, params=params: params,
            )
        )
        index += 1
    return tuple(strata)


# pairwise **より前**に決まっている全層(骨格 Task 3〜6)。pairwise の行が
# これと同じ (op, input) を作ってしまうことがある(実測、2026-08-20:
# `compound_deposit_for` の最初の pairwise 行が `minimal_target` と
# 一致した——`rate=0/periods=1/periods_per_year=1/tax=False` は両方にとって
# 「いちばん自然な最初の水準」なので、偶然ではなく起きやすい衝突である)。
# `build_finance_shard` は同じ (op, input) の 2 件目を**個別の乱択の重複**
# としてなら捨てられるが、`build` が `i` を使わない名指し層どうしの重複は
# 何度リトライしても同じ入力しか返らず、そのまま詰む(設計書 §4.7 と同じ
# 「黙って層を削らない」の裏返しで、ここは「黙って重複させない」)。
# pairwise 側が自分より前の層と衝突していないかを**生成前に**確かめ、
# 衝突する行は飛ばす(件数はテストで数える)。
_NON_PAIRWISE_FINANCE_STRATA: tuple[Stratum, ...] = (
    _BOUNDARY_STRATA
    + _rate_level_strata()
    + _term_level_strata()
    + _term_zero_strata_for_remaining_ops()
    + _periods_per_year_bad_strata()
    + _malformed_rate_strata()
    + _rate_over_max_strata()
    + _compound_periods_out_of_range_strata()
    + _principal_and_deposit_zero_strata()
    + _residual_at_least_principal_strata()
    + _residual_with_single_payment_strata()
    + _payment_below_interest_strata()
    + _paid_off_before_residual_strata()
    + _bonus_exceeds_half_strata()
    + _bonus_with_short_term_strata()
    + _target_zero_strata()
    + _unreachable_target_strata()
    + _balance_overflow_strata()
    + _deposit_overflow_strata()
    + _tax_boundary_strata()
    + _non_monotone_net_strata()
    + _residual_axis_strata()
    + _bonus_axis_strata()
    + _inverse_answer_milestone_strata()
)


def _finance_signature(op: str, params: dict) -> str:
    """`build_finance_shard` の重複判定と同じ形の署名(設計書に写しを
    増やさないため、鍵の作り方はここ 1 か所)。"""
    return repr((op, sorted(params.items())))


# `_NON_PAIRWISE_FINANCE_STRATA` が既に使っている (op, input) の署名。
# pairwise の行を足すたびにここへも足し、**pairwise どうしの重複**(違う
# 水準の組が偶然同じ入力になる場合)も同じ仕組みで防ぐ。
_PAIRWISE_CLAIMED_SIGNATURES: set[str] = {
    _finance_signature(stratum.op, stratum.build(random.Random(0), 0))
    for stratum in _NON_PAIRWISE_FINANCE_STRATA
}


def _claim_pairwise_signature(op: str, params: dict) -> bool:
    """まだ使われていなければ署名を予約して `True`。既に使われていたら
    `False`(呼び出し側はその行を飛ばす)。"""
    signature = _finance_signature(op, params)
    if signature in _PAIRWISE_CLAIMED_SIGNATURES:
        return False
    _PAIRWISE_CLAIMED_SIGNATURES.add(signature)
    return True


FINANCE_STRATA: tuple[Stratum, ...] = (
    _NON_PAIRWISE_FINANCE_STRATA
    + _pairwise_loan_forward_like_strata("loan_forward", None)
    + _pairwise_loan_principal_strata()
    + _pairwise_loan_term_strata()
    + _pairwise_loan_forward_like_strata("loan_bonus_forward", "bonus_principal")
    + _pairwise_loan_bonus_principal_strata()
    + _pairwise_compound_grow_strata()
    + _pairwise_compound_deposit_for_strata()
    + _pairwise_compound_periods_for_strata()
)


# ---------------------------------------------------------------------------
# テスト空間モデル `finance-v1`(設計書 §7)
#
# **ここに水準を書き写さない。** 上の因子表(`PAIRWISE_*_FACTORS`)が一次資料で、
# モデルはそこから組み立てる——写しを持つと、因子表を直した日に片方だけが
# 古くなる(設計書 §7.1)。
# ---------------------------------------------------------------------------

#: `loan_term` の 150 行の記録。**`FINANCE_STRATA` を組み立てた後に凍らせる**
#: ——`_pairwise_loan_term_strata()` が走り終えるまで揃わない。
LOAN_TERM_FACTS: tuple[LoanTermFact, ...] = tuple(_LOAN_TERM_FACTS)


def loan_term_covered_cells() -> set[coverage.Cell]:
    """設計書 §8.2。**答が目標と一致した行だけ**が目標期間セルを被覆する。"""
    return {
        coverage.Cell("loan_term", (("rate", fact.rate_level), ("target_n", str(fact.target_n))))
        for fact in LOAN_TERM_FACTS
        if fact.state == "covered"
    }


FINANCE_MODEL = "finance-v1"

#: scope → 因子名 → 水準列。**`loan_term` だけ第 2 因子の名前が違う**
#: ——期間が入力ではなく答だからで、`n` のまま通すと被覆の集計が
#: 「入力に在った値」と「答として出た値」を混ぜる(設計書 §8.2)。
COVERAGE_FACTORS: dict[str, dict[str, tuple]] = {
    "loan_forward": PAIRWISE_LOAN_FACTORS,
    "loan_principal": PAIRWISE_LOAN_FACTORS,
    "loan_bonus_forward": PAIRWISE_LOAN_FACTORS,
    "loan_bonus_principal": PAIRWISE_LOAN_FACTORS,
    "loan_term": {
        "rate": PAIRWISE_LOAN_FACTORS["rate"],
        "target_n": PAIRWISE_LOAN_FACTORS["n"],
    },
    "compound_grow": PAIRWISE_COMPOUND_GROW_FACTORS,
    # `compound_deposit_for` は `compound_grow` と同じ 4 因子だが、**被覆は
    # op 単体で数える**(設計書 §7.2 の但し書き)。同じ因子表を指していても、
    # 要求セルの scope が違うので混ざらない。
    "compound_deposit_for": PAIRWISE_COMPOUND_GROW_FACTORS,
    "compound_periods_for": PAIRWISE_COMPOUND_PERIODS_FOR_FACTORS,
}

#: 被覆規則(設計書 §7.2)。loan 系 5 op は金利 × 期間の**全組合せ**、
#: 複利 3 op は**2 因子間ペアワイズ**。
#:
#: ペアワイズの数は**行数ではなくセル数**である(設計書 §12.4)——
#: `compound_grow` は 140 行で 266 セルを踏む。除外した行数をそのまま
#: 除外セル数として出せないのは、この単位の違いによる。
FINANCE_REQUIREMENTS: tuple[coverage.Requirement, ...] = (
    *(
        coverage.Requirement(
            f"{op}/rate-n/all",
            op,
            "all",
            coverage.all_combination_cells(op, COVERAGE_FACTORS[op]),
        )
        for op in ("loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal")
    ),
    coverage.Requirement(
        "loan_term/rate-target_n/all",
        "loan_term",
        "all",
        coverage.all_combination_cells("loan_term", COVERAGE_FACTORS["loan_term"]),
    ),
    coverage.Requirement(
        "compound_grow/rate-periods-ppy-tax/pairwise",
        "compound_grow",
        "pairwise",
        coverage.pairwise_cells("compound_grow", COVERAGE_FACTORS["compound_grow"]),
    ),
    coverage.Requirement(
        "compound_deposit_for/rate-periods-ppy-tax/pairwise",
        "compound_deposit_for",
        "pairwise",
        coverage.pairwise_cells("compound_deposit_for", COVERAGE_FACTORS["compound_deposit_for"]),
    ),
    coverage.Requirement(
        "compound_periods_for/rate-ppy-tax/pairwise",
        "compound_periods_for",
        "pairwise",
        coverage.pairwise_cells("compound_periods_for", COVERAGE_FACTORS["compound_periods_for"]),
    ),
)

_REQUIREMENT_OF: dict[str, coverage.Requirement] = {r.scope: r for r in FINANCE_REQUIREMENTS}


#: scope → (因子名, `case["input"]` の鍵)。**`loan_term` はここに置かない**
#: ——`target_n` は入力に無く、答であるため(設計書 §8.2)。入力から数えると、
#: 「入力に在った値」と「答として出た値」を混ぜることになる。
_COVERAGE_INPUT_KEYS: dict[str, tuple[tuple[str, str], ...]] = {
    op: (("rate", "rate"), ("n", "n"))
    for op in ("loan_forward", "loan_principal", "loan_bonus_forward", "loan_bonus_principal")
} | {
    "compound_grow": (
        ("rate", "rate"),
        ("periods", "periods"),
        ("periods_per_year", "periods_per_year"),
        ("tax", "tax"),
    ),
    "compound_deposit_for": (
        ("rate", "rate"),
        ("periods", "periods"),
        ("periods_per_year", "periods_per_year"),
        ("tax", "tax"),
    ),
    "compound_periods_for": (
        ("rate", "rate"),
        ("periods_per_year", "periods_per_year"),
        ("tax", "tax"),
    ),
}


def covered_cells_from_cases(cases: Sequence[dict]) -> set[coverage.Cell]:
    """生成済みのケースが踏んだ要求セル(設計書 §15.1 の 2)。

    **入力の実値ではなく水準へ写してから数える。** 水準表に無い値は数えない
    ——乱択のケースは水準の外の値を持つので、素朴に数えると要求セルと単位が
    合わなくなる(実測 2026-08-25: `compound_deposit_for` の全 420 件は
    「因子と値の組」を 1,491 通り踏む。要求セルは 266 しかない)。

    **1 件が複数のセルを踏む**(設計書 §9.3)。集合へ足すので、同じセルを
    埋めるためにケースを重複生成する必要はない——重複ケースを消しても
    要求セルが未達として残る、という壊れ方を避けられる。

    **層(`stratum`)で絞らない。** ペアワイズ行として重複で落ちた組合せが、
    名指し境界層のケースとして実在することがある(実測: `compound_deposit_for`
    の `rate=0 × periods=1`)。層で絞ると、その 1 ペアを取りこぼす。
    """
    covered: set[coverage.Cell] = set()
    for case in cases:
        axes = _COVERAGE_INPUT_KEYS.get(case["op"])
        if axes is None:
            continue
        factors = COVERAGE_FACTORS[case["op"]]
        requirement = _REQUIREMENT_OF[case["op"]]
        on_level: list[tuple[str, str]] = []
        for name, key in axes:
            value = case["input"].get(key)
            # **`in` の前に型を見ない。** 水準列は `("0", "20")` のような
            # 文字列だったり `(1, 12)` のような整数だったりするので、
            # 実値がそのまま水準列に在るかだけを見る。
            if key not in case["input"] or value not in factors[name]:
                continue
            on_level.append((name, coverage.level_text(value)))
        if requirement.strength == "all":
            # 全組合せのセルは**両方の因子が水準に載っていて初めて**踏まれる。
            if len(on_level) == len(axes):
                covered.add(coverage.Cell(case["op"], tuple(on_level)))
        else:
            # **2 因子のセルは、その 2 つが水準なら踏まれている。** 同じケースの
            # 他の因子が水準の外にあっても、この 2 つの組を試した事実は変わらない
            # ——ここで全因子を要求すると、乱択のケースが踏んだ組を数え落とす。
            for left, right in combinations(on_level, 2):
                covered.add(coverage.Cell(case["op"], (left, right)))
    return covered


DATA_SCALE_BOUNDARIES: tuple[tuple[str, str, str], ...] = (
    ("0", "1", "int8"),
    ("1", "1", "int8"),
    ("1", "0", "float64"),
    # 9 データ型すべてを 1 度は通す。1 バイトと 8 バイトで単位の刻みが変わる。
    *((f"{1}", "1", dtype) for dtype in DTYPES),
    # 単位の境界ちょうど(1 KB / 1 KiB / 1 MB / 1 MiB …)。
    ("1000", "1", "int8"),
    ("1024", "1", "int8"),
    ("1000000", "1", "int8"),
    ("1048576", "1", "int8"),
    ("1000000000", "1", "int8"),
    ("1073741824", "1", "int8"),
    # 桁の上限側。
    (U64_MAX_TEXT, "1", "int8"),
    ("100000000", "768", "float32"),
    # 数でないもの。**弾かれること自体が仕様。**
    ("abc", "1", "int8"),
    ("-1", "1", "int8"),
    ("１０", "1", "int8"),
    ("1", "1", "float128"),
)


class GaveUpReason(StrEnum):
    """`ReferenceGaveUp` の理由(設計書 §4.9)。

    `near_yen_boundary` は 0 件を要求しない(意図的な棄却)。
    `compound_deposit_search_limit` はコミット済みコーパスで 0 件が目標。
    `other` は 1 件でも出たら生成器自身が落ちる——未分類のまま数だけ増える、
    を許さない。
    """

    NEAR_YEN_BOUNDARY = "near_yen_boundary"
    COMPOUND_DEPOSIT_SEARCH_LIMIT = "compound_deposit_search_limit"
    OTHER = "other"


class ReferenceGaveUp(Exception):
    """**参照実装が答えを出せなかった。**

    `compound_ref.deposit_for` は種から歩いて解を探す実装で、
    `MAX_WALK`(10 万歩)歩いても届かないと `compound_ref.DepositSearchLimitError`
    を投げる。`loan_ref._guard_boundary` は円境界に近すぎる月額を
    `loan_ref.NearYenBoundaryError` で棄却する。どちらも定義域の話ではなく
    **参照実装自身の探索・番人の限界**である。

    期待値が作れないので、そのケースは検証できない。**捨てるが、数える**——
    「このコーパスが確かめられなかった件数」は、判定と並べて理由別に報告する
    価値がある。金融の golden(手選び 100 件)はこの経路を一度も踏んでいなかった。
    """

    def __init__(self, message: str, reason: GaveUpReason) -> None:
        super().__init__(message)
        self.reason = reason


def _finance_entry(index: int, op: str, params: dict, stratum: str) -> dict:
    """1 件を組み立てる。**期待値は参照実装がそのまま返した辞書である。**

    `stratum` はケースが属する層の識別子(`"{op}/{name}"`。乱択で作られた
    ケースは `"{op}/random"`)。**`SCHEMA` は上げない**——`corpus_calls.SCHEMA`
    は 15 シャードが共有する 1 つの定数で、上げると無関係な 14 枚の golden が
    バイト単位で書き換わる(設計書 §4.8)。読み手(`web/tests/heavy/corpus.ts`)は
    未知のキーを弾かないので、フィールドの追加は後方互換である。「schema 1
    なのに必須フィールドがある」が根拠のない例外に見えないよう書いておくと、
    全 finance ケースが `stratum` を持つことは**スキーマ番号ではなく
    `test_generate_corpus.py` のテストが契約として担う**(設計書 §4.11 の 10)。
    """
    compute = loan_ref.compute if op.startswith("loan_") else compound_ref.compute
    try:
        expect = compute(op, params)
    except loan_ref.NearYenBoundaryError as error:
        raise ReferenceGaveUp(f"{op}: {error}", GaveUpReason.NEAR_YEN_BOUNDARY) from error
    except compound_ref.DepositSearchLimitError as error:
        raise ReferenceGaveUp(
            f"{op}: {error}", GaveUpReason.COMPOUND_DEPOSIT_SEARCH_LIMIT
        ) from error
    except ValueError as error:
        # `CompoundError` / `LoanError` は `compute` が辞書にして返すので、
        # ここまで来る `ValueError` は上の 2 つの**型**のどちらにも当てはまらない
        # 未分類の失敗である。メッセージでは分類しない——分類できない失敗を
        # `other` として数だけ増やして通すのではなく、生成器自体をここで落とす。
        raise RuntimeError(f"unclassified ReferenceGaveUp for {op}: {error}") from error
    return {
        "kind": "call",
        "id": f"fin-{index:06d}",
        "op": op,
        "input": params,
        "expect": expect,
        "stratum": stratum,
    }


def build_finance_shard(seed: int, count: int) -> dict:
    """金融のシャード。**境界を先に全部入れてから、残りを乱択で埋める。**

    名指し層は `max(1, stratum.minimum)` 件を作る(設計書 §4.11 の 1・2)。
    `minimum` が 0 の層(大半)は `build(rng, 0)` の 1 件だけ——`i` を使わない
    `build` は毎回同じ入力を返すので、これまでと同じ挙動になる。
    `residual_zero`(100 件)・`bonus_zero`(30 件)のように `minimum` を
    持つ層は `i` を 0, 1, 2, … と振って複数件作る。**同じ入力を 2 度作ると
    `seen` の重複で捨てて次の `i` を試す**——`build` が `i` を使わずに固定値を
    返す層で `minimum > 1` を指定すると、ここで無限に近い空振りになる
    (設計書 §4.7 が定数決め打ちを禁じているのと同じ理由で、黙って通さない)。
    """
    named_minimum_total = sum(max(1, stratum.minimum) for stratum in FINANCE_STRATA)
    if named_minimum_total > count:
        raise RuntimeError(
            f"名指し層の下限合計 {named_minimum_total} が総件数 {count} を超えている"
            "(設計書 §4.7: 黙って層を削らない)"
        )
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections: dict[str, object] = {
        "dup": 0,
        "reference_gave_up": {reason.value: 0 for reason in GaveUpReason},
    }
    for stratum in FINANCE_STRATA:
        target = max(1, stratum.minimum)
        produced = 0
        i = 0
        stratum_attempts = 0
        while produced < target:
            stratum_attempts += 1
            if stratum_attempts > target * 200 + 1000:
                raise RuntimeError(
                    f"{stratum.key}: {target} 件作るのに {stratum_attempts} 回試して"
                    f"{produced} 件しかできなかった(build が i を活かしていないのでは)"
                )
            params = stratum.build(rng, i)
            i += 1
            key = repr((stratum.op, sorted(params.items())))
            if key in seen:
                continue
            seen.add(key)
            entries.append(_finance_entry(len(entries), stratum.op, params, stratum.key))
            produced += 1
    ops = LOAN_OPS + COMPOUND_OPS
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        op = rng.choice(ops)
        params = _loan_params(rng, op) if op.startswith("loan_") else _compound_params(rng, op)
        key = repr((op, sorted(params.items())))
        if key in seen:
            rejections["dup"] += 1
            continue
        seen.add(key)
        try:
            entries.append(_finance_entry(len(entries), op, params, f"{op}/random"))
        except ReferenceGaveUp as gave_up:
            rejections["reference_gave_up"][gave_up.reason.value] += 1
    # **空間の地図を、覆ったケースの隣に置く**(設計書 §11.2)。ここで初めて
    # 「何を要求し、何を覆い、何を理由付きで諦めたか」が 1 枚に揃う。
    #
    # **`loan_term` の被覆は入力から数えられない。** `target_n` は入力ではなく
    # 答なので、`covered_cells_from_cases` は `loan_term` を見ない
    # (§8.2)——`loan_term_covered_cells()` が答の側から数えたものを足す。
    covered = covered_cells_from_cases(entries) | loan_term_covered_cells()
    exclusions = {**loan_term_exclusions(), **compound_deposit_for_exclusions(covered)}
    gave_up = rejections["reference_gave_up"]
    coverage_payload = coverage.build_payload(
        FINANCE_MODEL,
        FINANCE_REQUIREMENTS,
        covered,
        exclusions,
        {
            # **綴りは設計書 §11.2 のもの。** 既存の `rejections` の綴りは
            # 読み手(`report.ts` の `renderGaveUp`)が使っているので変えない
            # ——ここは**写し**であって、同じ入れ物ではない(§10.3)。
            "candidate_duplicate": rejections["dup"],
            "oracle_near_yen_boundary": gave_up["near_yen_boundary"],
            "oracle_search_limit": gave_up["compound_deposit_search_limit"],
        },
    )
    # **未達を黙って通さない**(設計書 §13.1)。要求セルは被覆・理由付き除外・
    # 未達のいずれかに必ず入るが、**未達のまま出荷してよいものは 1 つも無い**
    # ——覆えないなら理由を書く、が空間モデルの約束である。
    #
    # **門が無いと、この集計は何も主張しない。** 実測(2026-08-29): 除外を
    # 空にすると `loan_term` に 24 件の未達が残るが、門を足す前の生成器は
    # そのまま出力していた。`test_removing_one_exclusion_makes_the_generator_fail`
    # がこの門の番人である。
    for summary in coverage_payload["requirements"]:  # type: ignore[attr-defined]
        if summary["unmet_cells"]:
            raise RuntimeError(
                f"{summary['id']}: 未達セルが {summary['unmet_cells']} 件ある"
                "(被覆にも理由付き除外にも入っていない。設計書 §13.1)"
            )
    return {
        "schema": SCHEMA,
        "generated_by": _finance_provenance(),
        "rejections": rejections,
        "coverage": coverage_payload,
        "cases": entries,
    }


def build_data_scale_shard(seed: int, count: int) -> dict:
    """データスケールのシャード。境界を先に、残りを乱択で。"""
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    def add(count_text: str, dimensions: str, dtype: str) -> None:
        key = (count_text, dimensions, dtype)
        if key in seen:
            return
        seen.add(key)
        entries.append(
            {
                "kind": "call",
                "id": f"ds-{len(entries):06d}",
                "op": "data_scale",
                "input": {
                    "count": count_text,
                    "dimensions": dimensions,
                    "dtype": dtype,
                },
                "expect": data_scale_ref.compute(count_text, dimensions, dtype),
            }
        )

    for boundary in DATA_SCALE_BOUNDARIES:
        add(*boundary)
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        add(
            str(rng.randint(0, 10**12)),
            str(rng.randint(0, 100_000)),
            rng.choice(DTYPES),
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }


# `generate_corpus` と同じ値を使う。ここで別に定義すると、片方だけ動いたときに
# シャードの schema が食い違う。
SCHEMA = 1


def _finance_provenance() -> str:
    """金融のシャードを作ったもの。**「独立実装」だけでは強すぎる**——
    `loan_ref` と `compound_ref` の公開関数は `独立: 不可能` を宣言しており、
    丸めの手順そのものを Rust と共有している。`corpus_errors` が公開契約の
    共有を書いているのと同じ形で、ここにも書く。"""
    return (
        f"{_provenance()}。"
        "ただし丸めの取り決め——毎期の利息を切り捨てること、積立を期末に"
        "置くこと、税を国税と地方税で別々に掛けること——は Rust と共有して"
        "いる(loan_ref / compound_ref の docstring が関数ごとに"
        "「独立: 不可能」と宣言している)。**共有した取り決めの上での"
        "書き間違いは捕まえるが、取り決めそのものの妥当性は見ていない。**"
    )


def _provenance() -> str:
    """このシャードを実際に作ったもの。**mpmath は関与していない**——
    金融とデータスケールは Python の整数と `Decimal` だけで計算している。"""
    import sys

    return (
        "calcarc_reference (exact integers / Decimal), "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )
