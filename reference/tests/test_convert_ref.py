"""単位換算 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from fractions import Fraction

from calcarc_reference.convert_ref import convert_value


def test_the_inch_is_exactly_25_point_4_millimetres() -> None:
    # 1959 年の国際ヤード・ポンド協定。**定義値であって測定値ではない。**
    assert convert_value(Fraction(1), "length", "in", "mm") == Fraction(254, 10)


def test_the_pound_is_exactly_0_point_45359237_kilograms() -> None:
    assert convert_value(Fraction(1), "mass", "lb", "kg") == Fraction(45359237, 10**8)


def test_minus_forty_is_the_fixed_point_of_the_two_scales() -> None:
    # **factor と offset の両方が同時に効く唯一の点。**
    # offset を落とすと、この 1 件だけが動く。
    assert convert_value(Fraction(-40), "temperature", "degc", "degf") == Fraction(-40)
    assert convert_value(Fraction(-40), "temperature", "degf", "degc") == Fraction(-40)


def test_the_offsets_check_out() -> None:
    assert convert_value(Fraction(0), "temperature", "degc", "k") == Fraction(5463, 20)
    assert convert_value(Fraction(32), "temperature", "degf", "degc") == Fraction(0)


def test_a_round_trip_returns_exactly_where_it_started() -> None:
    # **有理数でなければ通らない。** f64 なら 99.99999999999999 になる。
    miles = convert_value(Fraction(100), "length", "km", "mi")
    assert convert_value(miles, "length", "mi", "km") == Fraction(100)


def test_temperature_converts_points_not_differences() -> None:
    # spec §3.4: 10 °C の差は 18 °F の差だが、この換算は点を変換する。
    assert convert_value(Fraction(10), "temperature", "degc", "degf") == Fraction(50)


def test_crossing_categories_is_not_a_conversion() -> None:
    assert convert_value(Fraction(1), "length", "km", "kg") is None
    assert convert_value(Fraction(1), "mass", "km", "kg") is None


def test_unknown_tokens_are_rejected() -> None:
    assert convert_value(Fraction(1), "length", "km", "furlong") is None
    assert convert_value(Fraction(1), "loudness", "db", "db") is None


def test_below_absolute_zero_is_not_stopped() -> None:
    # spec §3.5 の裁定。物理の妥当性は単位換算器の仕事ではない。
    assert convert_value(Fraction(-300), "temperature", "degc", "k") == Fraction(-537, 20)
