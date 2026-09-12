"""数値方針の「上下 N 円以内（月額 M まで）」が、境界専用の golden の許容と上限と一致すること
（設計書 2026-09-12 §5.7）。JSON を変えて文書を変えなければ赤、その逆も赤。"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
POLICY = ROOT / "docs" / "numerical-policy.md"
GOLDEN = ROOT / "testdata" / "loan_boundary.json"


def _yen_phrase(amount: int) -> str:
    if amount % 10**8 == 0:
        return f"{amount // 10**8} 億円"
    if amount % 10**4 == 0:
        return f"{amount // 10**4} 万円"
    return f"{amount:,} 円"


def phrases(golden: dict) -> list[str]:
    below = golden["tolerance"]["below_yen"]
    above = golden["tolerance"]["above_yen"]
    assert below == above, "上下の幅が違うなら、文書の書き方を先に決め直す"
    return [f"上下 {below} 円以内", f"月額 {_yen_phrase(int(golden['max_monthly_yen']))}まで"]


def test_the_phrases_follow_the_numbers():
    assert phrases(
        {"tolerance": {"below_yen": 1, "above_yen": 1}, "max_monthly_yen": "1000000000"}
    ) == [
        "上下 1 円以内",
        "月額 10 億円まで",
    ]
    assert (
        phrases({"tolerance": {"below_yen": 2, "above_yen": 2}, "max_monthly_yen": "500000000"})[1]
        == "月額 5 億円まで"
    )


def test_the_policy_states_the_allowance_the_golden_checks():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    text = POLICY.read_text(encoding="utf-8")
    for phrase in phrases(golden):
        assert phrase in text, f"numerical-policy.md に「{phrase}」が無い"
