"""Data Transfer の参照実装（spec §3.5）。

**帯域幅は 10 進である**（`kbps` の `k` は 1024 ではない）。出典は SI 接頭辞
（k = 10³、M = 10⁶、G = 10⁹）と、時間の 60 / 3600 / 86400 秒。
**入力は bit、表示は byte** で、切り上げはここで実際に発火する。

**Rust の実装は見ていない。** 式は spec §3.5 から書き起こしている。
"""

from __future__ import annotations

from calcarc_reference.data_scale_ref import U128_MAX, lines, parse_u128

BANDWIDTH_FACTOR = {"bps": 1, "kbps": 10**3, "mbps": 10**6, "gbps": 10**9}
DURATION_FACTOR = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}

# **`parse_u128` は自分で書かない**（Task 1 のレビュー指摘）。u128 の定義域の
# 読み取りは 3 つの参照実装で 1 つである——写すと、上限が動いた日に片方だけ
# 直る。


def compute(bandwidth: str, bandwidth_unit: str, duration: str, duration_unit: str) -> dict:
    value = parse_u128(bandwidth)
    seconds = parse_u128(duration)
    bw = BANDWIDTH_FACTOR.get(bandwidth_unit)
    du = DURATION_FACTOR.get(duration_unit)
    if value is None or seconds is None or bw is None or du is None:
        return {"error": "SyntaxError"}
    # 左から順に、その都度 u128 に収まるかを見る（spec §3.6）。
    total = 1
    for factor in (value, bw, seconds, du):
        total *= factor
        if total > U128_MAX:
            return {"error": "Overflow"}
    return lines(-(-total // 8))
