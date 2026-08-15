"""corpus/generated/*.json を生成する(設計書 §7.1)。

**generate.py からは呼ばれない。** 呼ぶと毎 PR の再生成一致チェックが
数万件を背負う。再生成が一致することの確認はリリース時にだけ行う。

種を固定するので、同じ入力から常に同じシャードが出る(固定コーパス)。
"""

from __future__ import annotations

import json
import pathlib
import random
import sys
import time

import mpmath as mp
import sympy

from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import (
    BINARY_OPS,
    UNARY_FNS,
    Bin,
    Node,
    Num,
    Un,
    to_expr_text,
    to_key_sequence,
    walk,
)

SCHEMA = 1
# docs/corpus-measurements.md の実測値。表示が言えない細かさを主張しない(設計書 §6.3)。
TOLERANCE = {"abs": 5e-10, "rel": 5e-10}
# 平坦な十進表示に収まる範囲。指数表記の解釈は段階 3 に送った。
# 実測の上端はちょうど |x| < 1e10 なので、境界そのものに着地しないよう 1e9 に下げる。
MIN_ABS = mp.mpf("1e-6")
MAX_ABS = mp.mpf("1e9")
MAX_DEPTH = 3
CORPUS = pathlib.Path(__file__).resolve().parents[2] / "corpus" / "generated"


def _provenance() -> str:
    # generate.py の _provenance と同じ形。生成器の版が golden に残る。
    return (
        f"sympy {sympy.__version__} / mpmath {mp.__version__}, "
        f"Python {sys.version_info.major}.{sys.version_info.minor}"
    )


def random_node(rng: random.Random, depth: int) -> Node:
    """深さで打ち切る乱択。葉は 1〜3 桁の非負整数。

    分布は意図して決める。放っておくと似た形ばかり出て、「大量に試した」が
    「同じような式を大量に試した」に化ける(設計書 §11)。
    """
    if depth <= 0 or rng.random() < 0.35:
        return Num(rng.randint(0, 999))
    if rng.random() < 0.45:
        return Un(rng.choice(UNARY_FNS), random_node(rng, depth - 1))
    return Bin(
        rng.choice(BINARY_OPS),
        random_node(rng, depth - 1),
        random_node(rng, depth - 1),
    )


def _within_range(node: Node) -> bool:
    """**中間値も範囲に収める。** 着地だけ見ると、途中で指数表記に飛んだ
    式が混ざり、表示の読み取りが書式の問題で落ちる。"""
    for sub in walk(node):
        value = evaluate(sub)
        if value != 0 and not (MIN_ABS <= abs(value) <= MAX_ABS):
            return False
    return True


def build_shard(seed: int, count: int) -> dict:
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_node(rng, MAX_DEPTH)
        if isinstance(node, Num):
            # 裸のリテラルは「押した桁が返る」ことしか確かめない。それは
            # engine_table.rs が既に仕様として持っている領域で、この重量級
            # コーパスの仕事ではない(レビュー修正ラウンド 1)。最上位には
            # 演算子か関数を最低 1 つ要求する。`Un("neg", Num(5))` のような
            # 単項 1 つだけのケースは残る — `neg` キーを実際に叩いているので。
            continue
        try:
            if not _within_range(node):
                continue
            value = evaluate(node)
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"sci-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": float(value), "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


def _equivalent_pair(rng: random.Random, node: Node) -> tuple[Node, Node] | None:
    """同じ値に着く二つの式木。**両辺の経路を必ず変える。**

    左右が同じ形に落ちると常に緑になり、テストが何も言わなくなる。
    """
    which = rng.randrange(3)
    if which == 0:
        # 平方して根を取ると戻る(非負のときだけ)。
        return node, Un("sqrt", Un("sqr", node))
    if which == 1:
        # 符号を二度反転すると戻る。
        return node, Un("neg", Un("neg", node))
    # 0 を足しても変わらない。左辺は素のまま。
    return node, Bin("+", node, Num(0))


def build_equivalences(seed: int, count: int) -> dict:
    rng = random.Random(seed)
    entries: list[dict] = []
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_node(rng, MAX_DEPTH - 1)
        try:
            if not _within_range(node):
                continue
            value = evaluate(node)
        except OutOfShard:
            continue
        if value < 0:
            # 平方根の往復が使えない。負の値は段階 3 で扱う。
            continue
        pair = _equivalent_pair(rng, node)
        if pair is None:
            continue
        left, right = pair
        try:
            if not _within_range(right):
                continue
        except OutOfShard:
            continue
        left_keys = to_key_sequence(left)
        right_keys = to_key_sequence(right)
        if left_keys == right_keys:
            continue
        entries.append(
            {
                "kind": "equivalence",
                "id": f"eqv-{len(entries):06d}",
                "mode": "Deg",
                "left": left_keys,
                "right": right_keys,
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


def write(name: str, payload: dict) -> None:
    path = CORPUS / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # generate.py と同じ整形。差分を安定させ、nan / inf を書き出さない。
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    started = time.monotonic()
    write("scientific-000.json", build_shard(seed=20260815, count=count))
    write("equivalence-000.json", build_equivalences(seed=20260816, count=count))
    elapsed = time.monotonic() - started
    # 生成時間はコーパスの上限を決める(設計書 §11)。必ず表に出す。
    # %.1f 秒だと数千件までは 0.0s に丸まって無意味になる(レビュー修正ラウンド 1)。
    # ミリ秒単位で出す。
    print(
        f"generated {count} cases in {elapsed * 1000:.2f}ms ({elapsed / count * 1000:.4f}ms each)"
    )


if __name__ == "__main__":
    main()
