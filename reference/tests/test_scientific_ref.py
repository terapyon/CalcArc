import math

from calcarc_reference.scientific_ref import (
    asin,
    cos,
    exp_e,
    factorial,
    ln,
    ncr,
    npr,
    pow_real,
    recip,
    sin,
    sqrt_real,
    tan,
)


def test_sine_in_degrees() -> None:
    assert math.isclose(sin(30.0, "Deg"), 0.5, abs_tol=1e-15)


def test_sine_of_a_half_turn_is_zero() -> None:
    # mpmath は 50 桁で評価してから f64 に落とすので、Rust の
    # libm が返す 1.22e-16 とは異なりちょうど 0 になる。
    # この差は tolerance の abs 側で吸収される。
    assert abs(sin(180.0, "Deg")) < 1e-30


def test_cosine_and_tangent() -> None:
    assert math.isclose(cos(60.0, "Deg"), 0.5, abs_tol=1e-15)
    assert math.isclose(tan(45.0, "Deg"), 1.0, abs_tol=1e-15)


def test_radian_mode() -> None:
    assert math.isclose(sin(math.pi / 6, "Rad"), 0.5, abs_tol=1e-15)


def test_square_root_of_a_negative_leaves_the_reals() -> None:
    # 関数は実数に閉じる（S-1 設計書 §1 の裁定 1）。参照実装は Rust の分岐を
    # 写すのではなく、mpmath が mpc を返したことを定義域の外の判定に使う。
    assert sqrt_real(-4.0) == {"error": "DomainError"}
    assert sqrt_real(4.0) == {"re": 2.0, "im": 0.0}


def test_ln_is_undefined_at_zero_and_below() -> None:
    assert ln(0.0, "Deg") == {"error": "DomainError"}
    assert ln(-1.0, "Deg") == {"error": "DomainError"}


def test_inverse_sine_is_bounded_by_one() -> None:
    assert asin(1.0000001, "Deg") == {"error": "DomainError"}
    assert math.isclose(asin(1.0, "Deg")["re"], 90.0, abs_tol=1e-13)


def test_reciprocal_of_zero_is_a_division_by_zero() -> None:
    # DomainError と取り違えると、golden が Rust の裁定違いを見逃す。
    assert recip(0.0, "Deg") == {"error": "DivisionByZero"}


def test_zero_to_the_zero_is_one() -> None:
    assert pow_real(0.0, 0.0)["re"] == 1.0


def test_a_negative_base_with_a_fractional_exponent_leaves_the_reals() -> None:
    assert pow_real(-2.0, 0.5) == {"error": "DomainError"}
    # 整数指数なら実数で一意。
    assert pow_real(-2.0, 3.0)["re"] == -8.0


def test_exp_overflows_rather_than_leaving_the_domain() -> None:
    # e^x は全実数で定義されている。f64 に入らないだけ（設計書 §3）。
    assert exp_e(710.0, "Deg") == {"error": "Overflow"}


def test_factorial_stops_at_the_f64_ceiling() -> None:
    assert factorial(170.0, "Deg")["re"] > 0
    assert factorial(171.0, "Deg") == {"error": "Overflow"}


def test_factorial_is_only_defined_on_non_negative_integers() -> None:
    # ガンマ関数には広げない（S-3 設計書 §3 の裁定 3）。
    assert factorial(2.5, "Deg") == {"error": "DomainError"}
    assert factorial(-1.0, "Deg") == {"error": "DomainError"}


def test_combinations_beyond_the_naive_formula() -> None:
    # 参照は任意精度なので、途中で溢れる問題がそもそも無い。Rust 側の
    # 「割ってから掛ける」がこれと一致することを golden が見る。
    # 厳密整数を 1 度 f64 にしただけなので、許容誤差は要らない。
    assert ncr(200.0, 100.0)["re"] == 9.054851465610328e58
    # **掛けてから割る形が落ちる帯**。参照は平然と答える。
    assert ncr(1022.0, 511.0)["re"] > 0


def test_r_may_not_exceed_n() -> None:
    assert ncr(5.0, 6.0) == {"error": "DomainError"}
    assert npr(5.0, 6.0) == {"error": "DomainError"}
