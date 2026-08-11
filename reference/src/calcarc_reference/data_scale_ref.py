"""Data Scale の参照実装。

数値は Python の組み込み int（任意精度、base-spec §29）。u128 と自然に
手法が独立する。丸め規則（小数第 1 位・half-to-even・繰り上がり時の単位
再選択）と u128 の上限は、アルゴリズムではなく仕様として固定された公開契約
である（設計書 §5）——契約を知らなければ独立検証は書けない。
"""

from __future__ import annotations

U128_MAX = (1 << 128) - 1

BYTES_PER_ELEMENT = {
    "int8": 1,
    "uint8": 1,
    "int16": 2,
    "float16": 2,
    "bfloat16": 2,
    "int32": 4,
    "float32": 4,
    "int64": 8,
    "float64": 8,
}

DECIMAL_UNITS = [("KB", 10**3), ("MB", 10**6), ("GB", 10**9), ("TB", 10**12)]
BINARY_UNITS = [("KiB", 2**10), ("MiB", 2**20), ("GiB", 2**30), ("TiB", 2**40)]


def _parse(text: str) -> int | None:
    if not text or not text.isascii() or not text.isdigit():
        return None
    value = int(text)
    return value if value <= U128_MAX else None


def _round_tenth(size: int, divisor: int) -> tuple[int, int]:
    whole, remainder = divmod(size, divisor)
    tenth, leftover = divmod(remainder * 10, divisor)
    if leftover * 2 > divisor or (leftover * 2 == divisor and tenth % 2 == 1):
        tenth += 1
        if tenth == 10:
            tenth = 0
            whole += 1
    return whole, tenth


def _scaled(size: int, units: list[tuple[str, int]], base: int) -> str | None:
    candidates = [i for i, (_, d) in enumerate(units) if size >= d]
    if not candidates:
        return None
    index = candidates[-1]
    while True:
        unit, divisor = units[index]
        whole, tenth = _round_tenth(size, divisor)
        if whole >= base and index + 1 < len(units):
            index += 1
            continue
        return f"{whole}.{tenth} {unit}"


def compute(count: str, dimensions: str, dtype: str) -> dict:
    c = _parse(count)
    d = _parse(dimensions)
    per = BYTES_PER_ELEMENT.get(dtype)
    if c is None or d is None or per is None:
        return {"error": "SyntaxError"}
    size = c * d * per
    if size > U128_MAX:
        return {"error": "Overflow"}
    return {
        "bytes": str(size),
        "bytes_grouped": f"{size:,}",
        "decimal": _scaled(size, DECIMAL_UNITS, 1000),
        "binary": _scaled(size, BINARY_UNITS, 1024),
    }
