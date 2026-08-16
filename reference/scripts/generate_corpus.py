"""corpus/generated/*.json を生成する(設計書 §7.1)。

**generate.py からは呼ばれない。** これは「再生成に時間がかかるから」ではない
——実測(docs/corpus-measurements.md)では 4000 件(値 2000 + 同値 2000)の生成が
0.3 秒未満で終わる。呼ばない理由は、`generate.py` が golden(`testdata/`)専用の
スクリプトであり、性質の異なる別資産(重量級コーパス)の再生成を混ぜたくない
ことにある。再生成一致の確認は `reference/tests/test_corpus_reproducibility.py`
がコミット済み JSON に対して毎回行う(golden の再生成一致ゲートと同じ役割)。

種を固定するので、同じ入力から常に同じシャードが出る(固定コーパス)。
"""

from __future__ import annotations

import json
import pathlib
import random
import sys
import time

import mpmath as mp

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
    to_keys,
    to_keys_minimal,
    to_minimal_key_sequence,
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
    """このシャードを実際に作ったものだけを名乗る。

    **SymPy を書かない。** generate.py の素性は `sympy X / mpmath Y` の形だが、
    あちらは本当に SymPy で式を立てている。この生成器は corpus_eval.py の
    mpmath だけで評価しており、SymPy は値に一切触れていない。信頼を目的とした
    文書で、値の生成に関与していない依存の版を素性に書くのは不正確である
    (レビュー修正ラウンド 2)。精度(dps)は corpus_eval.py が決めるので、
    宣言値ではなく実際の設定を読む。
    """
    return (
        f"mpmath {mp.__version__} ({mp.mp.dps} dps), "
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


# 同値の作り方。番号は _equivalence_candidate の rng.randrange(N) と対応する。
# **0 番だけが非負を要求する。** 平方して根を取る往復は負の値を返さない
# (√((-5)²) = 5)。1 番と 2 番は負でも成り立つので、負の値を丸ごと捨てて
# しまうと同値シャードが負数を一切通らなくなる(レビュー修正ラウンド 2)。
SQRT_ROUND_TRIP = 0
EQUIVALENCE_FORMS = 3


def _equivalent_pair(which: int, node: Node) -> tuple[Node, Node]:
    """同じ値に着く二つの式木。**両辺の経路を必ず変える。**

    左右が同じ形に落ちると常に緑になり、テストが何も言わなくなる。
    """
    if which == SQRT_ROUND_TRIP:
        # 平方して根を取ると戻る(非負のときだけ。呼ぶ側が確かめる)。
        return node, Un("sqrt", Un("sqr", node))
    if which == 1:
        # 符号を二度反転すると戻る。負の値でも成り立つ。
        return node, Un("neg", Un("neg", node))
    # 0 を足しても変わらない。左辺は素のまま。負の値でも成り立つ。
    return node, Bin("+", node, Num(0))


def _equivalence_candidate(
    rng: random.Random,
) -> tuple[list[str], list[str], mp.mpf] | None:
    """同値ケースを 1 つ引く。採れなければ None。

    値を一緒に返すのは、生成器のテストが「負の値が実際に残っているか」を
    見られるようにするためである。キー列からは値が読めない——読もうとすると
    engine の移植になる。
    """
    node = random_node(rng, MAX_DEPTH - 1)
    if isinstance(node, Num):
        # 裸のリテラルは「押した桁が返る」ことしか確かめない。`85 =` と
        # `(85 + 0) =` が同じ表示に着くことを 3 桁の整数に対して何百回
        # 主張しても、それ以上のことは何も言っていない。build_shard が
        # ラウンド 1 で同じ理由により棄却しているのと同じ線を引く。
        return None
    try:
        if not _within_range(node):
            return None
        value = evaluate(node)
    except OutOfShard:
        return None
    which = rng.randrange(EQUIVALENCE_FORMS)
    if which == SQRT_ROUND_TRIP and value < 0:
        return None
    left, right = _equivalent_pair(which, node)
    try:
        if not _within_range(right):
            return None
    except OutOfShard:
        return None
    left_keys = to_key_sequence(left)
    right_keys = to_key_sequence(right)
    if left_keys == right_keys:
        return None
    return left_keys, right_keys, value


def build_equivalences(seed: int, count: int) -> dict:
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        candidate = _equivalence_candidate(rng)
        if candidate is None:
            continue
        left_keys, right_keys, _value = candidate
        # 同じ対を二度主張しても件数が増えるだけで、確かめたことは増えない。
        # build_shard が expr で重複を落としているのと同じ(ラウンド 2)。
        fingerprint = (tuple(left_keys), tuple(right_keys))
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
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


def build_precedence_shard(seed: int, count: int) -> dict:
    """**括弧を省いたキー列**のシャード。

    式も期待値も既存シャードと同じ作り方で、変わるのは直列化だけである。
    つまり「Rust が優先順位から構造を復元できるか」だけを分離して測れる。

    **省ける括弧が 1 つも無い木は捨てる。** 省くものが無ければキー列が
    括弧つきの形と同一になり、新しいことを何も試さないケースが混ざる
    (設計書 §3.3)。全件が必ず優先順位を踏む。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    attempts = 0
    dropped_nothing = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} "
                f"cases ({dropped_nothing} trees had no droppable parenthesis)"
            )
        node = random_node(rng, MAX_DEPTH)
        if isinstance(node, Num):
            continue
        minimal = to_keys_minimal(node)
        full = to_keys(node)
        if isinstance(node, Bin):
            # to_keys_minimal は root 自身を包まない――子として現れたときだけ
            # 条件つきで包む。full 側は to_keys が root も無条件に包むので、その
            # 外側の 1 組を外してから揃える。外さずに比べると、内部では何も
            # 省いていない木(例: 同順位の入れ子を全部残した木)まで「差がある」
            # と誤判定し、優先順位を一度も踏まないケースが混入する。
            full = full[1:-1]
        if minimal == full:
            # 省くものが無い。この木は何も新しいことを試さない。
            dropped_nothing += 1
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
                "id": f"prec-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_minimal_key_sequence(node),
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
    write("precedence-000.json", build_precedence_shard(seed=20260817, count=count))
    elapsed = time.monotonic() - started
    # 生成時間はコーパスの上限を決める(設計書 §11)。必ず表に出す。
    # %.1f 秒だと数千件までは 0.0s に丸まって無意味になる(レビュー修正ラウンド 1)。
    # ミリ秒単位で出す。
    print(
        f"generated {count} cases in {elapsed * 1000:.2f}ms ({elapsed / count * 1000:.4f}ms each)"
    )


if __name__ == "__main__":
    main()
