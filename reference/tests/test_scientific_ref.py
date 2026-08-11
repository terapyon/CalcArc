import math

from calcarc_reference.scientific_ref import cos, sin, sqrt_real, tan


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


def test_square_root_of_a_negative_is_imaginary() -> None:
    assert sqrt_real(-4.0) == (0.0, 2.0)
    assert sqrt_real(4.0) == (2.0, 0.0)
