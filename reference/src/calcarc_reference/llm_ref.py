"""LLM のメモリ見積りの参照実装(spec §3.2〜§3.4)。

数値は Python の組み込み int(任意精度)。u128 の上限とあふれの規則、
切り上げ、合計の取り方は**仕様として固定された公開契約**であって
アルゴリズムではない(spec §3.6、§3.4)。

**Rust の実装は見ていない。** 式は spec §3 から書き起こしている。
"""

from __future__ import annotations

from calcarc_reference.data_scale_ref import U128_MAX, lines, parse_u128

# 定義値(IEEE 754 binary32 / binary16、bfloat16 の 16 bit、整数型のビット幅)。
BITS_PER_PARAMETER = {
    "fp32": 32,
    "fp16": 16,
    "bf16": 16,
    "int8": 8,
    "int4": 4,
}


def _product(factors: list[int]) -> int | None:
    """左から順に掛け、**その都度** u128 に収まるかを見る(spec §3.6)。

    最後にまとめて見るのとは違う——途中であふれた後に 0 が来る構成
    (層数 2^127 × 文脈長 0)では、答えが違う。契約は checked_mul である。
    """
    total = 1
    for factor in factors:
        total *= factor
        if total > U128_MAX:
            return None
    return total


def compute(
    parameters: str,
    weight_precision: str,
    layers: str,
    kv_heads: str,
    head_dim: str,
    context_length: str,
    kv_precision: str,
) -> dict:
    numbers = [parse_u128(t) for t in (parameters, layers, kv_heads, head_dim, context_length)]
    weight_bits_per = BITS_PER_PARAMETER.get(weight_precision)
    kv_bits_per = BITS_PER_PARAMETER.get(kv_precision)
    if any(n is None for n in numbers) or weight_bits_per is None or kv_bits_per is None:
        return {"error": "SyntaxError"}
    params, layer_count, heads, dim, context = numbers

    weight_bits = _product([params, weight_bits_per])
    # 並びは spec §3.3 のとおり: 2 × layers × context_length × kv_heads × head_dim × bits
    kv_bits = _product([2, layer_count, context, heads, dim, kv_bits_per])
    if weight_bits is None or kv_bits is None:
        return {"error": "Overflow"}

    # **それぞれ切り上げてから足す**(spec §3.4)。画面に出る 2 行の
    # 足し算が合計と一致することを優先する。
    weight_bytes = -(-weight_bits // 8)
    kv_bytes = -(-kv_bits // 8)
    total = weight_bytes + kv_bytes
    # **この枝は到達しない。** weight_bytes も kv_bytes も
    # ceil(U128_MAX / 8) = 2^125 以下なので、和は 2^126 で頭打ちになる。
    # それでも検査を残す——「到達不能だから外す」は、証明が崩れた日に
    # 黙って折り返す。Rust 側の checked_add も同じ形にする。
    if total > U128_MAX:
        return {"error": "Overflow"}
    return {
        "weight": lines(weight_bytes),
        "kv": lines(kv_bytes),
        "total": lines(total),
    }
