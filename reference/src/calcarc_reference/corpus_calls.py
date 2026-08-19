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
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

from . import compound_ref, data_scale_ref, loan_ref

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
        return {
            "payment": str(rng.randint(PAYMENT_MIN, PAYMENT_MAX)),
            "rate": _rate(rng),
            "n": rng.randint(MONTHS_MIN, MONTHS_MAX),
        }
    if op == "loan_term":
        return {
            "principal": str(rng.randint(PRINCIPAL_MIN, PRINCIPAL_MAX)),
            "rate": _rate(rng),
            "payment": str(rng.randint(PAYMENT_MIN, PAYMENT_MAX)),
        }
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


def _compound_params(rng: random.Random, op: str) -> dict:
    common = {
        "rate": _rate(rng),
        "periods_per_year": rng.choice(PERIODS_PER_YEAR_OK),
        "tax": rng.random() < 0.5,
    }
    if op == "compound_grow":
        return {
            "principal": str(rng.randint(0, PRINCIPAL_MAX)),
            "deposit": str(rng.randint(0, DEPOSIT_MAX)),
            "periods": rng.randint(1, COMPOUND_PERIODS_MAX),
            **common,
        }
    if op == "compound_deposit_for":
        return {
            "principal": str(rng.randint(0, PRINCIPAL_MAX)),
            "target": str(rng.randint(1, TARGET_MAX)),
            "periods": rng.randint(1, COMPOUND_PERIODS_MAX),
            **common,
        }
    if op == "compound_periods_for":
        return {
            "principal": str(rng.randint(0, PRINCIPAL_MAX)),
            "deposit": str(rng.randint(0, DEPOSIT_MAX)),
            "target": str(rng.randint(1, TARGET_MAX)),
            **common,
        }
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

    `minimum` はこの Task(層の骨格を作るだけ)ではすべて 0 にしてある。
    `residual_zero` に本来の下限 100、`bonus_zero` に 30 を入れると現在の
    生成器では実測 2 件・1 件しか無く落ちる——それを直すのは Task 6 である。
    骨格の段階で赤いテストを抱えないため、値は Task 6 で入れる。
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
        0,
        lambda rng, i: {"principal": "100000", "rate": "0", "n": 1, "residual": "0"},
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
        0,
        lambda rng, i: {
            "principal": "5000000",
            "bonus_principal": "0",
            "rate": "0",
            "n": 12,
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


# 決定的な探索(乱数を使わない)。結果は corpus に焼き付き、再生成一致ゲート
# (`test_corpus_reproducibility.py`)が固定する。
_TAX_SIMULTANEOUS_JUMP_INTEREST = _find_simultaneous_tax_jump(21)
_TAX_ROUNDING_MISMATCH_INTEREST = _find_tax_rounding_mismatch(2_648_906)


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


FINANCE_STRATA: tuple[Stratum, ...] = (
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
)

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


class GaveUpReason(str, Enum):
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
    """金融のシャード。**境界を先に全部入れてから、残りを乱択で埋める。**"""
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections: dict[str, object] = {
        "dup": 0,
        "reference_gave_up": {reason.value: 0 for reason in GaveUpReason},
    }
    for stratum in FINANCE_STRATA:
        params = stratum.build(rng, 0)
        entries.append(_finance_entry(len(entries), stratum.op, params, stratum.key))
        seen.add(repr((stratum.op, sorted(params.items()))))
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
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "rejections": rejections,
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


def _provenance() -> str:
    """このシャードを実際に作ったもの。**mpmath は関与していない**——
    金融とデータスケールは Python の整数と `Decimal` だけで計算している。"""
    import sys

    return (
        "calcarc_reference (exact integers / Decimal), "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )
