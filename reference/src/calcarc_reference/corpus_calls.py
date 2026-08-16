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

from . import compound_ref, data_scale_ref, loan_ref

# 現実的な入力の帯。**f64 が壊れるところに寄せない**(設計書 §3.5)。
# 金融の入力には人が実際に入れる範囲がある。
PRINCIPAL_MIN, PRINCIPAL_MAX = 100_000, 500_000_000
PAYMENT_MIN, PAYMENT_MAX = 10_000, 2_000_000
MONTHS_MIN, MONTHS_MAX = 1, 480
DEPOSIT_MAX = 1_000_000
TARGET_MAX = 1_000_000_000
PERIODS_PER_YEAR = (1, 2, 4, 12)
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
        "periods_per_year": rng.choice(PERIODS_PER_YEAR),
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

# **境界は乱択に任せない。名指しで列挙して全部入れる**(設計書 §3.5)。
# 乱択は境界をほぼ引かない——0 円、金利 0%、期間 1、u64 の上限、残価 = 元本。
FINANCE_BOUNDARIES: tuple[tuple[str, dict], ...] = (
    ("loan_forward", {"principal": "100000", "rate": "0", "n": 1, "residual": "0"}),
    (
        "loan_forward",
        {"principal": "3000000", "rate": "2.0", "n": 36, "residual": "3000000"},
    ),
    ("loan_forward", {"principal": U64_MAX_TEXT, "rate": "0", "n": 600, "residual": "0"}),
    ("loan_forward", {"principal": U64_MAX_TEXT, "rate": "1.5", "n": 1, "residual": "0"}),
    ("loan_forward", {"principal": "1", "rate": "20.0", "n": 480, "residual": "0"}),
    ("loan_principal", {"payment": "1", "rate": "0", "n": 1}),
    ("loan_principal", {"payment": str(PAYMENT_MAX), "rate": "20.0", "n": 480}),
    ("loan_term", {"principal": "100000", "rate": "0", "payment": "100000"}),
    # 返済額が利息に届かず、永久に終わらない入力。**エラーになること自体が仕様。**
    ("loan_term", {"principal": "500000000", "rate": "20.0", "payment": "1"}),
    ("loan_bonus_forward", {"principal": "5000000", "bonus_principal": "0", "rate": "0", "n": 12}),
    (
        "loan_bonus_forward",
        {"principal": "5000000", "bonus_principal": "5000000", "rate": "2.7", "n": 84},
    ),
    ("loan_bonus_principal", {"monthly_payment": "1", "bonus_payment": "0", "rate": "0", "n": 1}),
    (
        "compound_grow",
        {
            "principal": "0",
            "deposit": "0",
            "rate": "0",
            "periods_per_year": 1,
            "periods": 1,
            "tax": False,
        },
    ),
    (
        "compound_grow",
        {
            "principal": U64_MAX_TEXT,
            "deposit": "0",
            "rate": "0",
            "periods_per_year": 12,
            "periods": 1,
            "tax": True,
        },
    ),
    (
        "compound_grow",
        {
            "principal": "1000000",
            "deposit": "0",
            "rate": "20.0",
            "periods_per_year": 12,
            "periods": 600,
            "tax": True,
        },
    ),
    (
        "compound_deposit_for",
        {
            "principal": "0",
            "target": "1",
            "rate": "0",
            "periods_per_year": 1,
            "periods": 1,
            "tax": False,
        },
    ),
    (
        "compound_periods_for",
        {
            "principal": "1000000",
            "deposit": "0",
            "target": "1000000",
            "rate": "0",
            "periods_per_year": 1,
            "tax": False,
        },
    ),
    # 金利 0% で目標が元本より大きい——永久に届かない。エラーが仕様。
    (
        "compound_periods_for",
        {
            "principal": "1000000",
            "deposit": "0",
            "target": "2000000",
            "rate": "0",
            "periods_per_year": 1,
            "tax": False,
        },
    ),
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


class ReferenceGaveUp(Exception):
    """**参照実装が答えを出せなかった。**

    `compound_ref.deposit_for` は種から歩いて解を探す実装で、
    `MAX_WALK`(10 万歩)歩いても届かないと素の `ValueError` を投げる。
    これは定義域の話ではなく**参照実装自身の探索の限界**である。

    期待値が作れないので、そのケースは検証できない。**捨てるが、数える**——
    「このコーパスが確かめられなかった件数」は、判定と並べて報告する価値がある。
    金融の golden(手選び 100 件)はこの経路を一度も踏んでいなかった。
    """


def _finance_entry(index: int, op: str, params: dict) -> dict:
    """1 件を組み立てる。**期待値は参照実装がそのまま返した辞書である。**"""
    compute = loan_ref.compute if op.startswith("loan_") else compound_ref.compute
    try:
        expect = compute(op, params)
    except ValueError as error:
        # `CompoundError` / `LoanError` は `compute` が辞書にして返すので、
        # ここまで来る `ValueError` は探索の失敗だけである。
        raise ReferenceGaveUp(f"{op}: {error}") from error
    return {
        "kind": "call",
        "id": f"fin-{index:06d}",
        "op": op,
        "input": params,
        "expect": expect,
    }


def build_finance_shard(seed: int, count: int) -> dict:
    """金融のシャード。**境界を先に全部入れてから、残りを乱択で埋める。**"""
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections = {"dup": 0, "reference_gave_up": 0}
    for op, params in FINANCE_BOUNDARIES:
        entries.append(_finance_entry(len(entries), op, params))
        seen.add(repr((op, sorted(params.items()))))
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
            entries.append(_finance_entry(len(entries), op, params))
        except ReferenceGaveUp:
            rejections["reference_gave_up"] += 1
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
