"""golden に載った逆算の答が、定義を満たしているかを毎回確かめる。

**これは突き合わせではない**（それは `finance_golden.rs` の仕事)。Rust の実装を
一切見ず、「その答が定義どおりか」だけを検査する。生成時に 1 回だけ確かめると
「golden を作った日に正しかった」で終わるので、pytest でも常時走らせる
（設計書 2026-08-15 §8）。
"""

from __future__ import annotations

import json
import pathlib

import pytest

from calcarc_reference import compound_ref

TESTDATA = pathlib.Path(__file__).resolve().parents[2] / "testdata" / "finance.json"


def _inverse_cases(op: str) -> list[dict]:
    cases = json.loads(TESTDATA.read_text())["cases"]
    # エラーを期待するケースには証明書が無い（答が無いので）。
    return [c for c in cases if c["op"] == op and "error" not in c["expect"]]


def test_the_golden_has_inverse_cases_to_certify() -> None:
    # 検査対象がゼロ件でも「全件通った」と言えてしまうのを防ぐ。
    assert len(_inverse_cases("compound_deposit_for")) >= 3
    assert len(_inverse_cases("compound_periods_for")) >= 3


@pytest.mark.parametrize("case", _inverse_cases("compound_deposit_for"), ids=lambda c: c["id"])
def test_every_deposit_answer_satisfies_the_definition(case: dict) -> None:
    i = case["input"]
    num, den = compound_ref.rate_fraction(i["rate"], i["periods_per_year"])
    compound_ref.check_deposit_certificate(
        int(case["expect"]["deposit"]),
        int(i["principal"]),
        num,
        den,
        i["periods"],
        int(i["target"]),
        bool(i.get("tax")),
    )


@pytest.mark.parametrize("case", _inverse_cases("compound_periods_for"), ids=lambda c: c["id"])
def test_every_periods_answer_satisfies_the_definition(case: dict) -> None:
    i = case["input"]
    num, den = compound_ref.rate_fraction(i["rate"], i["periods_per_year"])
    compound_ref.check_periods_certificate(
        int(case["expect"]["periods"]),
        int(i["principal"]),
        int(i["deposit"]),
        num,
        den,
        int(i["target"]),
        bool(i.get("tax")),
    )
