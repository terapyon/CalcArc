from calcarc_reference.sexagesimal_ref import format_sexagesimal


def test_the_headline_example() -> None:
    # 設計書 §1: 1.5 は 1 時間 30 分とも 1 度 30 分とも読める。
    assert format_sexagesimal(1.5) == "1°30'0\""


def test_seconds_keep_their_decimals() -> None:
    # 秒に小数を許さないと 0.001 時間が表せない（設計書 §3）。
    assert format_sexagesimal(0.001) == "0°0'3.6\""


def test_the_carry_goes_through_the_minutes_into_the_degrees() -> None:
    # 秒が 59.9999996 で、5 桁に丸めると 60。分が 60 になって度へ繰り上がる。
    assert format_sexagesimal(0.999999999) == "1°0'0\""


def test_beyond_a_day_is_not_divided() -> None:
    # 裁定 5: 経過時間なので 24 で割らない。
    assert format_sexagesimal(30.5) == "30°30'0\""


def test_what_cannot_be_shown_is_none() -> None:
    # 裁定 6: 表示を変えないだけで、エラーにはしない。
    assert format_sexagesimal(1e10) is None
    assert format_sexagesimal(float("inf")) is None
    assert format_sexagesimal(float("nan")) is None
