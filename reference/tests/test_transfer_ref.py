"""Data Transfer 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.transfer_ref import compute


def test_headline_case() -> None:
    # spec §3.5: 100 Mbps × 3 時間 = 135,000,000,000 bytes
    assert compute("100", "mbps", "3", "hour") == {
        "bytes": "135000000000",
        "bytes_grouped": "135,000,000,000",
        "decimal": "135.0 GB",
        "binary": "125.7 GiB",
    }


def test_kilo_is_decimal_not_1024() -> None:
    # 512 kbps × 30 分 = 512,000 × 1800 bit = 115,200,000 bytes
    assert compute("512", "kbps", "30", "minute")["bytes"] == "115200000"


def test_bits_round_up_to_a_whole_byte() -> None:
    # **転送では切り上げが実際に発火する**（1 bit は 1 byte に満たない）。
    assert compute("1", "bps", "1", "second")["bytes"] == "1"
    assert compute("8", "bps", "1", "second")["bytes"] == "1"
    assert compute("9", "bps", "1", "second")["bytes"] == "2"


def test_a_day_of_a_gigabit() -> None:
    assert compute("1", "gbps", "1", "day")["decimal"] == "10.8 TB"


def test_zero_is_valid_not_an_error() -> None:
    r = compute("0", "gbps", "1", "hour")
    assert r["bytes"] == "0"
    assert r["decimal"] is None


def test_overflow_is_the_u128_contract() -> None:
    assert compute(str(1 << 127), "gbps", "1", "second") == {"error": "Overflow"}


def test_unknown_units_are_syntax_errors() -> None:
    assert compute("1", "tbps", "1", "second") == {"error": "SyntaxError"}
    assert compute("1", "bps", "1", "week") == {"error": "SyntaxError"}
