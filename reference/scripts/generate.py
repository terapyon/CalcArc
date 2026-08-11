"""testdata/*.json を生成する。

このスクリプトの出力はリポジトリにコミットされ、Rust テストが読む。
CI では再生成して差分が出ないことを確認する(設計書 §7.1)。
"""

from __future__ import annotations

import json
import pathlib
import sys

import mpmath
import sympy

from calcarc_reference import cases, complex_ref, scientific_ref

SCHEMA = 1
TOLERANCE = {"abs": 1e-12, "rel": 1e-12}
TESTDATA = pathlib.Path(__file__).resolve().parents[2] / "testdata"


def _provenance() -> str:
    return (
        f"sympy {sympy.__version__} / mpmath {mpmath.__version__}, "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )


def build_complex() -> dict:
    entries = []
    for re, im in cases.RECT_INPUTS:
        r, theta_deg = complex_ref.rect_to_polar(re, im)
        entries.append(
            {
                "id": f"rect_to_polar/{re}/{im}",
                "op": "rect_to_polar",
                "input": {"re": re, "im": im},
                "expect": {"r": r, "theta_deg": theta_deg},
            }
        )
    for r, theta_deg in cases.POLAR_INPUTS:
        re, im = complex_ref.polar_to_rect(r, theta_deg)
        entries.append(
            {
                "id": f"polar_to_rect/{r}/{theta_deg}",
                "op": "polar_to_rect",
                "input": {"r": r, "theta_deg": theta_deg},
                "expect": {"re": re, "im": im},
            }
        )
    for (a_re, a_im), (b_re, b_im) in cases.BINARY_INPUTS:
        for op in ("add", "sub", "mul", "div"):
            fn = getattr(complex_ref, op)
            re, im = fn(a_re, a_im, b_re, b_im)
            entries.append(
                {
                    "id": f"{op}/({a_re},{a_im})/({b_re},{b_im})",
                    "op": op,
                    "input": {"a_re": a_re, "a_im": a_im, "b_re": b_re, "b_im": b_im},
                    "expect": {"re": re, "im": im},
                }
            )
    return _envelope(entries)


def build_scientific() -> dict:
    entries = []
    for name, x, mode in cases.UNARY_INPUTS:
        fn = getattr(scientific_ref, name)
        entries.append(
            {
                "id": f"{name}/{mode}/{x}",
                "op": name,
                "mode": mode,
                "input": {"x": x},
                "expect": {"re": fn(x, mode), "im": 0.0},
            }
        )
    for x in cases.SQRT_INPUTS:
        re, im = scientific_ref.sqrt_real(x)
        entries.append(
            {
                "id": f"sqrt/{x}",
                "op": "sqrt",
                "mode": "Deg",
                "input": {"x": x},
                "expect": {"re": re, "im": im},
            }
        )
    return _envelope(entries)


def _envelope(entries: list[dict]) -> dict:
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


def write(name: str, payload: dict) -> None:
    path = TESTDATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # 差分が安定するよう整形して書く。末尾改行を付ける。
    # allow_nan=False にするのは、nan / inf が RFC 8259 の JSON として
    # 不正であり、serde_json が解析できないため。黙って不正な golden を
    # 書き出すより、生成時に ValueError で落ちるほうがよい。
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def main() -> None:
    write("complex.json", build_complex())
    write("scientific.json", build_scientific())


if __name__ == "__main__":
    main()
