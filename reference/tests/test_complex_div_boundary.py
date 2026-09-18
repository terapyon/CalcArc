"""複素除算の境界 golden の生成器の番人（0.9.5、F16）。"""

import hashlib
import json
import math
import struct

import pytest

from calcarc_reference import complex_div_boundary as g

#: **0.9.4 の 572 行（F7）の指紋。** 0.9.5 は族を足すだけで、あの行は 1 バイトも変えない
#: （F16 の直しの前後で、F7 の番人が同じものを見ていると言えるように）。
#: 2026-09-18 に、コミット済みの de50c40 の JSON の 572 行と一致することを確かめて置いた。
F7_ROWS = 572
F7_SHA256 = "541b5ec0079e51670cda333bdd499cca8751fff45273ca086a6b40af1c146efd"


@pytest.fixture(scope="module")
def cases():
    return g.build_cases()


def test_the_f7_rows_are_unchanged(cases):
    f7 = [c for c in cases if not c["id"].startswith(g.NEW_FAMILIES)]
    assert len(f7) == F7_ROWS
    text = json.dumps(f7, sort_keys=True, ensure_ascii=False)
    assert hashlib.sha256(text.encode()).hexdigest() == F7_SHA256


def _trailing_zero_bits(x: float) -> int:
    mantissa = struct.unpack("<Q", struct.pack("<d", x))[0] & ((1 << 52) - 1)
    return (mantissa & -mantissa).bit_length() - 1


@pytest.mark.parametrize("m", [g._M_BIG, g._M_SMALL, g._M_OTHER])
def test_the_mantissas_are_full(m):
    """**2 や 10 の冪を使わない**理由（モジュールの docstring）を、値の側で縛る。
    仮数の下位が 0 だらけの値は、精度を落とす帯（指数差 1023〜1075）を隠す。"""
    assert _trailing_zero_bits(m) <= 1


def test_the_f16_band_is_in_the_table(cases):
    ids = {c["id"] for c in cases}
    for top in (1023, 700, 1):
        for gap in (1023, 1050, 1075):
            assert any(i.startswith(f"gap/t{top}/g{gap}/") for i in ids), (top, gap)
    assert any(i.startswith("den_gap/t500/g1076/") for i in ids)
    assert sum(i.startswith("chain/") for i in ids) >= 8


def test_abs_floor_is_the_relative_rule_at_the_bottom_of_the_normal_range():
    assert g.TOLERANCE_ABS_FLOOR == g.TOLERANCE_REL * 2.0**-1022


def test_a_cancelling_component_stops_the_generator():
    """**成分ごとの判定が意味を持たない行は、黙って落とさずに止める。**"""
    eps = 2.0**-40
    with pytest.raises(AssertionError, match="打ち消し合う"):
        g._component_ok("probe", (1.0, 1.0 + eps), (1.0, 1.0), 1.0, eps / 2)


def test_a_component_that_underflows_is_not_placed():
    """真値は非零だが f64 で 0 になる成分は、「厳密に 0」の期待と区別できないので置かない。"""
    assert not g._component_ok("probe", (2.0**-1000, 0.0), (2.0**100, 0.0), 0.0, 0.0)
    assert math.ldexp(1.0, -1100) == 0.0
