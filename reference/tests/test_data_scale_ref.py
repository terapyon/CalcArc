"""Data Scale 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.data_scale_ref import compute


def test_headline_case() -> None:
    r = compute("100000000", "768", "float32")
    assert r == {
        "bytes": "307200000000",
        "bytes_grouped": "307,200,000,000",
        "decimal": "307.2 GB",
        "binary": "286.1 GiB",
    }


def test_overflow_is_the_u128_contract() -> None:
    # 積が 2^128 以上なら Rust 側は表現できない。これは §25 が定めた公開契約。
    half = str(1 << 127)
    assert compute(half, "2", "uint8") == {"error": "Overflow"}
    assert "error" not in compute(str((1 << 127) - 1), "2", "uint8")


def test_carry_reselects_the_unit() -> None:
    assert compute("999999999999", "1", "uint8")["decimal"] == "1.0 TB"


def test_below_the_smallest_unit_lines_are_absent() -> None:
    r = compute("999", "1", "uint8")
    assert r["decimal"] is None and r["binary"] is None
