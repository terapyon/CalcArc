"""単位換算 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from fractions import Fraction
from itertools import pairwise

from calcarc_reference.convert_ref import (
    CATEGORIES,
    compute,
    convert_value,
    format_rational,
)


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


def test_a_negative_value_wears_all_three_at_once() -> None:
    # 負号・カンマ・小数部は上の 3 本に散っていて、**同時に踏む値が 1 つも無かった**。
    # 符号はカンマの外側（`-1,234.5678`）で、小数部にはカンマが入らない。
    assert format_rational(Fraction(-12345678, 10000)) == "-1,234.5678"


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


def test_only_ascii_digits_are_digits() -> None:
    # Python の `\d` は既定で Unicode の数字を含み、`Fraction()` もそれを受ける。
    # **Rust 側は ASCII しか受けない**ので、全角が通ると 2 実装が静かに食い違う。
    assert compute("１２３", "length", "m", "m") == {"error": "SyntaxError"}
    assert compute("١٢٣", "length", "m", "m") == {"error": "SyntaxError"}
    assert compute("1．5", "length", "m", "m") == {"error": "SyntaxError"}
    # ASCII は今までどおり通る。
    assert compute("123", "length", "m", "m") == {"text": "123"}


# --- U-2: Area / Volume / Speed / Data Size（spec §3.1〜§3.6） -----------------


def test_a_tsubo_is_not_exactly_two_tatami() -> None:
    # spec §3.3: 慣用では「1 坪 = 2 畳」だが、**出自が違うので厳密には一致しない**。
    # 坪は尺から（1 尺 = 10/33 m、1 坪 = 6 尺 × 6 尺 = 400/121 m²）、畳は
    # 不動産の表示規約から（1.62 m² ちょうど）。**丸めて 2 に見せない。**
    assert convert_value(Fraction(1), "area", "tsubo", "jo") == Fraction(20000, 9801)


def test_the_two_gallons_are_not_the_same() -> None:
    assert convert_value(Fraction(1), "volume", "gal_us", "l") == Fraction(473176473, 125000000)
    assert convert_value(Fraction(1), "volume", "gal_imp", "l") == Fraction(454609, 100000)


def test_the_two_cups_are_not_the_same() -> None:
    # 米国慣用の 8 fl oz と、日本の計量カップ 200 mL は別物（spec §3.4）。
    assert convert_value(Fraction(1), "volume", "cup_us", "ml") == Fraction(2365882365, 10000000)
    assert convert_value(Fraction(1), "volume", "cup_jp", "ml") == Fraction(200)


def test_si_and_iec_are_separate() -> None:
    # 設計書 §6 の例。`GB` と `GiB` を曖昧にしない。
    assert convert_value(Fraction(1), "data-size", "gb", "mib") == Fraction(10**9, 2**20)


def test_a_bit_is_an_eighth_of_a_byte() -> None:
    # **1/8 である。** 有理数なので 0.125 が厳密に出る（f64 なら偶然合う）。
    assert convert_value(Fraction(1), "data-size", "bit", "byte") == Fraction(1, 8)


def test_the_acre_is_the_yard_pound_stack() -> None:
    # 4840 × yd² = 4840 × 9 × 144 × (127/5000)² = ちょうど 4046.8564224 m²。
    assert convert_value(Fraction(1), "area", "ac", "m2") == Fraction(316160658, 78125)
    # **ac は約分済みの値で書いてあり、yd² は導出で書いてある。**
    # 片方だけ動かしたときに、この 1 行が気づく。
    assert convert_value(Fraction(1), "area", "ac", "yd2") == Fraction(4840)


def test_the_knot_keeps_the_nautical_mile() -> None:
    assert convert_value(Fraction(1), "speed", "kn", "kmh") == Fraction(1852, 1000)


def test_the_square_units_are_the_squares_of_the_lengths() -> None:
    # **面積の表は長さの表と辻褄が合っていなければならない。**
    # in² は (127/5000)²、ft² は 144 × in²、yd² は 9 × ft² と別々に書いてあるので、
    # 長さの側から独立に 2 乗して突き合わせる（片方だけ直した日に赤くなる）。
    for length_token, area_token in (("in", "in2"), ("ft", "ft2"), ("yd", "yd2")):
        side = convert_value(Fraction(1), "length", length_token, "m")
        assert convert_value(Fraction(1), "area", area_token, "m2") == side * side


def test_the_fluid_ounce_stack_is_internally_consistent() -> None:
    # pt / qt は fl oz の倍数として書いてあり、**US と Imperial で倍率が違う**
    # （US は 16/32/128、Imperial は 20/40/160）。取り違えをここで捕まえる。
    gal_us = convert_value(Fraction(1), "volume", "gal_us", "l")
    assert gal_us == 128 * convert_value(Fraction(1), "volume", "floz_us", "l")
    assert gal_us == 8 * convert_value(Fraction(1), "volume", "pt_us", "l")
    assert gal_us == 4 * convert_value(Fraction(1), "volume", "qt_us", "l")
    assert gal_us == 16 * convert_value(Fraction(1), "volume", "cup_us", "l")

    gal_imp = convert_value(Fraction(1), "volume", "gal_imp", "l")
    assert gal_imp == 160 * convert_value(Fraction(1), "volume", "floz_imp", "l")
    assert gal_imp == 8 * convert_value(Fraction(1), "volume", "pt_imp", "l")
    assert gal_imp == 4 * convert_value(Fraction(1), "volume", "qt_imp", "l")


def test_the_speeds_come_from_the_length_table() -> None:
    # mph = mi/3600、kn = nmi/3600。**1 時間で進む距離**であることを、
    # 長さの表から独立に確かめる。
    for length_token, speed_token in (("mi", "mph"), ("nmi", "kn")):
        distance = convert_value(Fraction(1), "length", length_token, "m")
        assert convert_value(Fraction(1), "speed", speed_token, "mps") * 3600 == distance


def test_the_iec_prefixes_are_powers_of_two() -> None:
    # 2 の冪は指数を 1 つ書き間違えても「それらしい」値になる。
    # **隣どうしが 1024 倍**であることを確かめる。
    ladder = ("byte", "kib", "mib", "gib", "tib", "pib")
    for smaller, larger in pairwise(ladder):
        assert convert_value(Fraction(1), "data-size", larger, smaller) == Fraction(1024)


def test_the_si_prefixes_are_powers_of_ten() -> None:
    ladder = ("byte", "kb", "mb", "gb", "tb", "pb")
    for smaller, larger in pairwise(ladder):
        assert convert_value(Fraction(1), "data-size", larger, smaller) == Fraction(1000)


def test_the_new_categories_have_the_unit_counts_the_spec_says() -> None:
    # **数え間違いは表の写し落としである。** 件数を固定する。
    assert len(CATEGORIES["area"]) == 11
    assert len(CATEGORIES["volume"]) == 15
    assert len(CATEGORIES["speed"]) == 4
    assert len(CATEGORIES["data-size"]) == 12


def test_no_token_is_used_twice_across_categories() -> None:
    # **トークンは flat な名前空間である**（Rust の `Unit` が 1 つの enum）。
    seen: list[str] = []
    for table in CATEGORIES.values():
        seen.extend(table)
    assert len(seen) == len(set(seen)), "トークンが 2 つのカテゴリで衝突している"
    assert len(seen) == 21 + 42
