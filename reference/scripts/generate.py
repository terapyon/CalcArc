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

from calcarc_reference import (
    cases,
    complex_ref,
    compound_ref,
    data_scale_ref,
    expr_ref,
    loan_ref,
    scientific_ref,
)

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
        entries.append(
            {
                "id": f"sqrt/{x}",
                "op": "sqrt",
                "mode": "Deg",
                "input": {"x": x},
                "expect": scientific_ref.sqrt_real(x),
            }
        )
    for name, x, mode in cases.REAL_FN_INPUTS:
        fn = getattr(scientific_ref, name)
        entries.append(
            {
                "id": f"{name}/{mode}/{x}",
                "op": name,
                "mode": mode,
                "input": {"x": x},
                "expect": fn(x, mode),
            }
        )
    return _envelope(entries)


def build_data_scale() -> dict:
    entries = []
    for count, dimensions, dtype in cases.DATA_SCALE_INPUTS:
        result = data_scale_ref.compute(count, dimensions, dtype)
        entries.append(
            {
                "id": f"data_scale/{count}x{dimensions}x{dtype}",
                "op": "data_scale",
                "input": {"count": count, "dimensions": dimensions, "dtype": dtype},
                "expect": result,
            }
        )
    # 整数の完全一致なので tolerance を持たない(設計書 §5)。
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }


def _resolve_placeholders(params: dict) -> dict:
    """期間逆算の境界に使う元本を、参照実装に解かせて埋める。

    「ちょうど割り切れる n」の元本は手で書ける数ではない——その月額・その回数で
    借りられる最大額そのものだからである(設計書 §7)。+1 円が繰り上がりの相方。
    """
    resolved = dict(params)
    placeholder = resolved.get("principal")
    if isinstance(placeholder, str) and placeholder.startswith("EXACT_TERM_PRINCIPAL"):
        num, den = loan_ref.rate_fraction(resolved["rate"])
        payment = int(resolved["payment"])
        # 24 回ちょうどで完済する最大の元本(loan_principal のケースと同じ入力)。
        exact = loan_ref.principal_for(payment, num, den, 24)["principal"]
        offset = 1 if placeholder.endswith("+1") else 0
        resolved["principal"] = str(exact + offset)
    return resolved


def build_finance() -> dict:
    """ローンと複利は同じファイルに入る(設計書 §9)。

    base-spec の 4 ファイル列挙を動かさずに済み、どちらも tolerance を
    持たない完全一致だからである。**id の重複検査は 2 表を結合した後**で
    行う——表ごとに見ると、表をまたいだ衝突を見逃す。
    """
    entries = []
    for case in cases.LOAN_INPUTS:
        op = case["op"]
        params = _resolve_placeholders({k: v for k, v in case.items() if k != "op"})
        entries.append(
            {
                "id": f"{op}/" + "/".join(str(v) for v in params.values()),
                "op": op,
                "input": params,
                "expect": loan_ref.compute(op, params),
            }
        )
    for case in cases.COMPOUND_INPUTS:
        op = case["op"]
        params = {k: v for k, v in case.items() if k != "op"}
        entries.append(
            {
                "id": f"{op}/" + "/".join(str(v) for v in params.values()),
                "op": op,
                "input": params,
                "expect": compound_ref.compute(op, params),
            }
        )
    for case in cases.EXPR_INPUTS:
        op = case["op"]
        params = {k: v for k, v in case.items() if k != "op"}
        entries.append(
            {
                "id": f"{op}/" + "/".join(str(v) for v in params.values()),
                "op": op,
                "input": params,
                "expect": expr_ref.compute(op, params),
            }
        )
    ids = [entry["id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate case id in finance golden")
    # 整数円の完全一致なので tolerance を持たない(設計書 §7)。
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": entries,
    }


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
    write("data_scale.json", build_data_scale())
    write("finance.json", build_finance())


if __name__ == "__main__":
    main()
