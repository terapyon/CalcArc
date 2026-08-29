"""為替換算 参照実装の健全性テスト。突き合わせ本番は golden の仕事。

**期待値は spec §3・§3.1 から手で計算して書いている**（Rust も golden も見ずに）。
"""

from fractions import Fraction

from calcarc_reference.currency_ref import (
    MINOR_UNITS,
    compute,
    exchange,
    format_amount,
)


def test_a_hundred_dollars_goes_through_the_base_currency() -> None:
    # spec §3: value ÷ rate_from × rate_to。**基準通貨を経由する。**
    # 100 ÷ (10855/10000) × (1685/10)
    #   = (100 × 10000 × 1685) / (10855 × 10)
    #   = 1,685,000,000 / 108,550
    #   = 33,700,000 / 2,171          （2171 = 13 × 167、337 は素数なので既約）
    got = exchange(Fraction(100), Fraction("1.0855"), Fraction("168.5"))
    assert got == Fraction(33_700_000, 2_171)
    # **f64 では書けない値である。** 2171 で割り切れない。
    assert got.denominator == 2_171
    # 2171 × 15,522 = 33,698,262、余り 1,738。1738/2171 = 0.80055… > 1/2 なので
    # JPY（0 桁）へは切り上がる。
    assert 2_171 * 15_522 + 1_738 == 33_700_000
    assert compute("100", "usd", "jpy", "1.0855", "168.5") == {"text": "15,523"}


def test_the_rate_of_the_source_currency_is_not_ignored() -> None:
    # **`from_rate` が 1 の例だけでは、`from_rate` を無視する実装が通ってしまう。**
    # 同じ値・同じ `to_rate` で `from_rate` だけを変えると答が動くこと。
    a = compute("100", "usd", "jpy", "1.0855", "168.5")
    b = compute("100", "usd", "jpy", "1", "168.5")
    assert a == {"text": "15,523"}
    assert b == {"text": "16,850"}
    assert a != b


def test_the_yen_has_no_decimal_point() -> None:
    # §3.1: JPY の minor unit は 0。**小数点が出ない**（`.0` も付かない）。
    assert format_amount(Fraction("168.5"), 0) == "168"
    assert format_amount(Fraction(0), 0) == "0"
    assert compute("0", "eur", "jpy", "1", "168.5") == {"text": "0"}
    assert "." not in compute("100", "usd", "jpy", "1.0855", "168.5")["text"]


def test_the_dollar_has_exactly_two() -> None:
    # §3.1: 末尾が 0 でも 2 桁出す（`12.50` を `12.5` にしない）。
    assert format_amount(Fraction("12.5"), 2) == "12.50"
    assert format_amount(Fraction(0), 2) == "0.00"
    assert format_amount(Fraction(7), 2) == "7.00"
    # 整数部が 0 のときに桁が足りなくならないこと（`.05` ではなく `0.05`）。
    assert format_amount(Fraction(1, 20), 2) == "0.05"
    assert compute("12.5", "usd", "usd", "1.0855", "1.0855") == {"text": "12.50"}


def test_a_tie_rounds_to_even() -> None:
    # ここが主張しているのは「**厳密有理数で tie を踏んだとき偶数側へ倒れる**」だけで、
    # **`f64` との判別力は主張していない。**
    #
    # 判別力のある tie は **Task 3 が確定させ、`cases.py` に入っている**
    # （`42.66 GBP → USD`。厳密なら `54.28`、レートを `f64` に通すと境の下側で
    # `54.27`）。ここには「【仮置き】Task 3 の探索が確定させる」と**未来形で**
    # 書いてあったが、Task 3 は完了済みで、この註だけが古いまま残っていた。
    #
    # 12.345 × 100 = 1234.5 = 2469/2。余りが分母のちょうど半分（2 × 1 == 2）。
    assert (Fraction("12.345") * 100) == Fraction(2469, 2)
    assert format_amount(Fraction("12.345"), 2) == "12.34"  # 1234 は偶 → 据え置き
    assert format_amount(Fraction("12.355"), 2) == "12.36"  # 1235 は奇 → 切り上げ
    # 0 桁側も両方置く。half-up への変異は片方しか動かさない。
    assert format_amount(Fraction("168.5"), 0) == "168"
    assert format_amount(Fraction("169.5"), 0) == "170"


def test_the_thousands_are_grouped() -> None:
    # 整数部だけ 3 桁ごと。**小数部には入らない**（numerical-policy の表示節）。
    assert format_amount(Fraction("10855"), 2) == "10,855.00"
    assert format_amount(Fraction("1234567.891"), 2) == "1,234,567.89"
    assert format_amount(Fraction("1234567"), 0) == "1,234,567"
    assert compute("10000", "eur", "usd", "1", "1.0855") == {"text": "10,855.00"}


def test_a_negative_amount_wears_the_sign_outside_the_commas() -> None:
    assert format_amount(Fraction("-1234.567"), 2) == "-1,234.57"
    assert compute("-1234.567", "usd", "usd", "1.0855", "1.0855") == {"text": "-1,234.57"}


def test_a_rounded_away_negative_does_not_keep_its_sign() -> None:
    # **`-0.00` は「0 ではない」の意味に読める。** spec は書いていないので
    # ここで決め、golden に固定する（U-1 が `Fraction(0)` を `"0"` と書くのと同じ扱い）。
    assert format_amount(Fraction("-0.001"), 2) == "0.00"
    assert format_amount(Fraction("-0.4"), 0) == "0"
    # **本当に負の答は符号を保つ。** 上を「符号を捨てる」に変えると、ここが赤くなる。
    assert format_amount(Fraction("-0.006"), 2) == "-0.01"


def test_the_rates_cancel_exactly_when_they_are_equal() -> None:
    # **f64 なら残る誤差が、有理数では残らない。**
    # 12.345 / 1.0855 は割り切れないが、× 1.0855 で厳密に戻る。
    value = Fraction("12.345")
    assert exchange(value, Fraction("1.0855"), Fraction("1.0855")) == value


def test_a_rate_of_zero_is_an_error_not_a_division() -> None:
    # **レートは外から来る**（spec §3）。0 が来ることは有り得る。
    assert compute("100", "usd", "jpy", "0", "168.5") == {"error": "DivisionByZero"}
    # `to_rate` の 0 は割り算ではない。**0 円になるだけで、エラーではない。**
    assert compute("100", "usd", "jpy", "1.0855", "0") == {"text": "0"}


def test_unknown_currencies_are_rejected() -> None:
    assert compute("100", "usd", "xyz", "1.0855", "168.5") == {"error": "SyntaxError"}
    assert compute("100", "kwd", "jpy", "1.0855", "168.5") == {"error": "SyntaxError"}
    # **大文字は通さない。** トークンは小文字で 1 通りに決める（U-1 の単位と同じ）。
    assert compute("100", "USD", "JPY", "1.0855", "168.5") == {"error": "SyntaxError"}


def test_values_and_rates_obey_the_same_literal_rule() -> None:
    # 指数表記は受けない（盤面にその打ち方が無い）。
    assert compute("1e3", "usd", "jpy", "1.0855", "168.5") == {"error": "SyntaxError"}
    assert compute("100", "usd", "jpy", "1e3", "168.5") == {"error": "SyntaxError"}
    assert compute("100", "usd", "jpy", "1.0855", "abc") == {"error": "SyntaxError"}
    assert compute("", "usd", "jpy", "1.0855", "168.5") == {"error": "SyntaxError"}
    assert compute("--1", "usd", "jpy", "1.0855", "168.5") == {"error": "SyntaxError"}


def test_only_ascii_digits_are_digits() -> None:
    # Python の `\d` は既定で Unicode の数字を含み、`Fraction()` もそれを受ける。
    # **Rust 側は ASCII しか受けない**ので、通ると 2 実装が静かに食い違う。
    assert compute("１２３", "usd", "jpy", "1.0855", "168.5") == {"error": "SyntaxError"}
    assert compute("100", "usd", "jpy", "١٢٣", "168.5") == {"error": "SyntaxError"}
    assert compute("123", "usd", "usd", "1", "1") == {"text": "123.00"}


def test_the_minor_units_match_the_spec() -> None:
    # **数え間違いは表の写し落としである。**（spec §3.1 の表 + 【ISO 4217 の確認】）
    assert len(MINOR_UNITS) == 16
    assert MINOR_UNITS["jpy"] == 0
    assert MINOR_UNITS["krw"] == 0
    assert MINOR_UNITS["vnd"] == 0
    zero = [code for code, digits in MINOR_UNITS.items() if digits == 0]
    two = [code for code, digits in MINOR_UNITS.items() if digits == 2]
    assert zero == ["jpy", "krw", "vnd"]
    assert len(two) == 13
    # **0 か 2 のどちらかしかない**（spec §3.1 が 3 桁の通貨を入れないと決めている）。
    assert set(MINOR_UNITS.values()) == {0, 2}


def test_the_order_is_the_spec_table_order() -> None:
    # **面の並びはこの順である**（spec §3.1 の「面の並びもこの順」）。
    # Rust の `Currency::ALL` と `token_parity` が順序込みで見る（Task 3・Task 4）。
    assert list(MINOR_UNITS) == [
        "jpy",
        "krw",
        "vnd",
        "usd",
        "eur",
        "gbp",
        "chf",
        "cny",
        "thb",
        "sgd",
        "hkd",
        "twd",
        "aud",
        "cad",
        "inr",
        "brl",
    ]


def test_every_currency_appears_in_the_golden_inputs() -> None:
    # **現れない通貨の小数桁は言語間で一度も突き合わされない**（U-2 の Ruling 2）。
    # **`to` 側がとくに要る**——minor unit の表を引くのは `to` だけだからである。
    from calcarc_reference import cases

    sources = {src for _, src, _, _, _ in cases.CURRENCY_INPUTS}
    targets = {dst for _, _, dst, _, _ in cases.CURRENCY_INPUTS}
    assert set(MINOR_UNITS) <= sources, sorted(set(MINOR_UNITS) - sources)
    assert set(MINOR_UNITS) <= targets, sorted(set(MINOR_UNITS) - targets)


def test_the_golden_inputs_carry_no_surprises() -> None:
    # golden は**厳密一致**である（`tolerance` を持たない）。生成前にここで、
    # すべての入力が `compute` を通ることと、狙った形の答が出ることを確かめる。
    from calcarc_reference import cases

    results = [compute(*row) for row in cases.CURRENCY_INPUTS]
    ok = [r for r in results if "text" in r]
    errors = [r for r in results if "error" in r]
    assert len(ok) + len(errors) == len(results)
    # **内訳**: DivisionByZero 1 / SyntaxError 4 / Overflow 2。
    # Overflow の 2 件は `i128` の天井（2026-08-29 に足した）——数を書いて
    # あるのは、**エラーのつもりで置いた入力が答を返してしまった日に落ちる**
    # ようにするためである。増やしたらここも直す。
    assert len(errors) == 7
    # **0 桁の通貨の答には小数点が 1 つも無い。**
    for row, result in zip(cases.CURRENCY_INPUTS, results, strict=True):
        dst = row[2]
        if "text" in result and MINOR_UNITS.get(dst) == 0:
            assert "." not in result["text"], row
        if "text" in result and MINOR_UNITS.get(dst) == 2:
            assert result["text"].count(".") == 1, row
            assert len(result["text"].partition(".")[2]) == 2, row
