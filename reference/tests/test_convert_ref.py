"""単位換算 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from fractions import Fraction

from calcarc_reference.convert_ref import compute, convert_value, format_rational


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


def test_a_short_value_keeps_its_own_length() -> None:
    # **末尾の 0 は落とす。** 25.40000000 にしない。
    assert format_rational(Fraction(254, 10)) == "25.4"
    assert format_rational(Fraction(0)) == "0"
    assert format_rational(Fraction(-40)) == "-40"


def test_ten_significant_digits_is_the_ceiling() -> None:
    # 100 km は 62.13711922 mi（spec §4.1 の盤面図の値）。10 桁。
    assert format_rational(Fraction(100000, 1) / Fraction(201168, 125)) == "62.13711922"


def test_commas_go_in_the_integer_part_only() -> None:
    assert format_rational(Fraction(1234567)) == "1,234,567"
    assert format_rational(Fraction(12345678, 10000)) == "1,234.5678"
    assert format_rational(Fraction(-1234567)) == "-1,234,567"


def test_the_big_boundary_is_ten_to_the_tenth() -> None:
    # 10^10 ちょうどは指数表記、その 1 つ下は固定小数点。
    assert format_rational(Fraction(10**10)) == "1e10"
    assert format_rational(Fraction(10**10 - 1)) == "9,999,999,999"


def test_the_boundary_is_judged_after_rounding() -> None:
    # **9,999,999,999.5 は丸めると 10^10 に達するので指数表記になる**(spec §3.3)。
    # half-to-even なので 9999999999.5 は偶数側の 10000000000 へ上がる。
    assert format_rational(Fraction(99999999995, 10)) == "1e10"


def test_the_small_boundary_is_ten_to_the_minus_ninth() -> None:
    assert format_rational(Fraction(1, 10**9)) == "0.000000001"
    assert format_rational(Fraction(1, 10**10)) == "1e-10"
    # 小さい側も丸めた後で判定する。9.999999999_5e-10 は 10^-9 に達するので
    # 固定小数点に戻る（spec §3.3）。
    assert format_rational(Fraction(99999999995, 10**20)) == "0.000000001"


def test_half_to_even_rounds_toward_the_even_digit() -> None:
    # 11 桁目がちょうど 5 で、10 桁目が偶数なら**上げない**。
    assert format_rational(Fraction(123456789_25, 10**9)) == "12.34567892"
    # 10 桁目が奇数なら上げる。
    assert format_rational(Fraction(123456789_35, 10**9)) == "12.34567894"


def test_compute_is_the_entry_point() -> None:
    assert compute("100", "length", "km", "mi") == {"text": "62.13711922"}
    assert compute("-40", "temperature", "degc", "degf") == {"text": "-40"}
    assert compute("1", "length", "km", "kg") == {"error": "SyntaxError"}
    assert compute("", "length", "km", "m") == {"error": "SyntaxError"}
    assert compute("1e3", "length", "km", "m") == {"error": "SyntaxError"}
    assert compute("--1", "length", "km", "m") == {"error": "SyntaxError"}
