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
import math
import pathlib
import random
import sys
import time
from collections.abc import Iterator

import mpmath as mp

from calcarc_reference.corpus_calls import build_data_scale_shard, build_finance_shard
from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import (
    BINARY_OPS,
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    CONST_NAMES,
    ELEMENTARY_BINS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_FNS,
    Bin,
    Const,
    Node,
    Num,
    Typed,
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


def _subtrees_leaves_first(node: Node) -> Iterator[Node]:
    """**葉から先に返す。** `walk` は根を先に返すので、`_within_range` が
    いちばん高価な式を最初に評価してしまう。`^` が入るまでは深さ 3 で
    値が 1e12 を超えなかったので表に出なかった。

    実測: `999^(999^999)` は根から見ると 2.239 秒、葉から見ると 0.000 秒。
    **述語も答えも同じで、評価の順だけが違う。**

    共有の `walk`(根が先)は他のコードが前順であることに依存しているので
    変えない。ここだけのローカルな生成器にする。
    """
    if isinstance(node, Bin):
        yield from _subtrees_leaves_first(node.left)
        yield from _subtrees_leaves_first(node.right)
    elif isinstance(node, Un):
        yield from _subtrees_leaves_first(node.arg)
    yield node


def _within_range(node: Node) -> bool:
    """**中間値も範囲に収める。** 着地だけ見ると、途中で指数表記に飛んだ
    式が混ざり、表示の読み取りが書式の問題で落ちる。

    **葉から先に評価する。** 根から見ると、既に範囲外の部分木を持つ式でも
    まず根そのものを評価してしまい、`^` の入れ子(`999^(999^999)`)では
    その評価だけで何秒もかかる。部分木が先に範囲外だと分かればそこで
    打ち切れる——述語(「どの部分木も範囲外でない」)は順序に依らないので、
    答えは変わらない。
    """
    for sub in _subtrees_leaves_first(node):
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


# 棄却の理由。**E(エラー経路)の設計の入力になる**ので、名前を engine の
# エラー名に寄せてある(設計書 §3.6)。`division_by_zero` を `domain` と
# 分けるのは engine が分けているからである。
REJECTION_REASONS = (
    "bare",
    "domain",
    "division_by_zero",
    "overflow",
    "out_of_range",
    "dup",
)


def random_family_node(
    rng: random.Random,
    depth: int,
    unary_fns: tuple[str, ...],
    binary_ops: tuple[str, ...],
    const_prob: float,
) -> Node:
    """系統ごとの選択肢から引く乱択。

    **既存の `random_node` を呼ばない。** あちらは既存 3 枚のシャードの
    乱数の消費列そのものなので、共有すると片方を変えたときにもう片方が
    総入れ替えになる(設計書 §3.1)。
    """
    if depth <= 0 or rng.random() < 0.35:
        if rng.random() < const_prob:
            return Const(rng.choice(CONST_NAMES))
        return Num(rng.randint(0, 999))
    if rng.random() < 0.45:
        return Un(
            rng.choice(unary_fns),
            random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
        )
    return Bin(
        rng.choice(binary_ops),
        random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
        random_family_node(rng, depth - 1, unary_fns, binary_ops, const_prob),
    )


def _classify_out_of_shard(reason: str) -> str:
    """`OutOfShard` の文言を棄却の理由に割り当てる。

    **文言で分けるのは脆い**が、`OutOfShard` に種別を持たせると
    `corpus_eval` が「シャードの都合」を知ることになる。境界はそのままにして、
    ここで読み替える。文言を変えたらここも変わる、という結合は残る——
    その結合は `test_every_out_of_shard_message_is_classified` が守る。
    """
    if "division by zero" in reason or "reciprocal of zero" in reason:
        return "division_by_zero"
    return "domain"


def build_family_shard(
    seed: int,
    count: int,
    prefix: str,
    unary_fns: tuple[str, ...],
    binary_ops: tuple[str, ...],
) -> dict:
    """系統別のシャードを積む。**帯は既存の `MIN_ABS`〜`MAX_ABS`。**

    組合せ論は帯が違うので、この関数を使わない(設計書 §3.2.1)。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections = dict.fromkeys(REJECTION_REASONS, 0)
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        node = random_family_node(rng, MAX_DEPTH, unary_fns, binary_ops, 0.2)
        if isinstance(node, (Num, Const)):
            # 裸のリテラルも裸の定数も、押した桁(あるいは定数)がそのまま
            # 返ることしか確かめない。engine_table.rs の領域である。
            rejections["bare"] += 1
            continue
        try:
            if not _within_range(node):
                rejections["out_of_range"] += 1
                continue
            value = evaluate(node)
        except OutOfShard as exc:
            rejections[_classify_out_of_shard(str(exc))] += 1
            continue
        except OverflowError:
            rejections["overflow"] += 1
            continue
        expr = to_expr_text(node)
        if expr in seen:
            rejections["dup"] += 1
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"{prefix}-{len(entries):06d}",
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
        "rejections": rejections,
        "cases": entries,
    }


def build_elementary_shard(seed: int, count: int) -> dict:
    return build_family_shard(seed, count, "elem", ELEMENTARY_FNS, ELEMENTARY_BINS)


# 組合せ論の葉の上限。**`C(1022,511) ≈ 2.2e305` を含める必要がある**——engine の
# コメント(`scientific/mod.rs:257-264`)が「掛けてから割ると n = 1022〜1028 の
# 中心二項係数が**答は収まるのに**落ちる」と書いており、そこに届かない上限を
# 置くと、検証したいものが落ちる。
COMBINATORICS_MAX_N = 1200
# 階乗の葉の上限。171! で f64 を溢れるので、その少し先まで。
# **大きくしすぎない**——`math.factorial(500000)` は 1.4 秒かかり、
# 捨てられる候補にその時間を払うことになる。
COMBINATORICS_MAX_FACT = 200


# --- 打ち方と訂正のシャード（段階 G §3.1 / §3.3）---

# 指数入力の指数は 1〜2 桁。**符号は付けない**——指数中の `+/-` は
# 指数の符号を反転する別の挙動で、それは訂正の話ではない。
TYPED_MAX_EXPONENT = 6


def _typed_integer(rng: random.Random) -> Typed:
    """既存と同じ整数。打ち方の対照群として要る。"""
    value = rng.randint(1, 999)
    return Typed(tuple(str(value)), str(value))


def _typed_decimal(rng: random.Random) -> Typed:
    """小数点を打つ。**`dot` を押す唯一の形。**"""
    whole = rng.randint(0, 999)
    frac = rng.randint(1, 9999)
    text = f"{whole}.{frac}"
    return Typed(tuple("dot" if ch == "." else ch for ch in text), text)


def _typed_zeros3(rng: random.Random) -> Typed:
    """`000` キーを使う。

    **先頭には置かない。** 空のバッファに打つと先頭ゼロの規則で `"0"` に
    潰れる(実測、設計書 §6)。0 でない桁を 1 つ以上打った後にだけ使う。
    """
    head = rng.randint(1, 999)
    return Typed((*str(head), "zeros3"), f"{head}000")


def _typed_exponent(rng: random.Random) -> Typed:
    """指数入力(EE)。`1.5e3` のように打つ。"""
    mantissa = rng.randint(1, 99)
    frac = rng.randint(0, 9)
    exponent = rng.randint(1, TYPED_MAX_EXPONENT)
    text = f"{mantissa}.{frac}e{exponent}"
    keys = (
        *str(mantissa),
        "dot",
        str(frac),
        "exp",
        *str(exponent),
    )
    return Typed(keys, text)


TYPED_FORMS = (_typed_integer, _typed_decimal, _typed_zeros3, _typed_exponent)


def _typed_leaf(rng: random.Random) -> Typed:
    return TYPED_FORMS[rng.randrange(len(TYPED_FORMS))](rng)


def _is_exponent_entry(node: Node) -> bool:
    """指数入力の途中で終わる葉か。**`neg` の意味が変わる場所である。**"""
    return isinstance(node, Typed) and "exp" in node.keys


def _typed_node(rng: random.Random, depth: int) -> Node:
    """葉が `Typed` の木。**既存の `random_node` を呼ばない**(乱数の土台が別)。"""
    if depth <= 0 or rng.random() < 0.4:
        return _typed_leaf(rng)
    if rng.random() < 0.35:
        fn = rng.choice(UNARY_FNS)
        arg = _typed_node(rng, depth - 1)
        # **指数入力の直後の `+/-` は、値ではなく指数の符号を変える。**
        # `84.9e1` に `neg` を打つと `84.9e-1` = 8.49 であって -849 ではない
        # ——実際の電卓の慣行で、engine が正しい。**コーパスがこれを捕まえた**
        # (2026-08-17、68/2000 が不一致になって発覚。壊れていたのは生成器)。
        #
        # ここで避けるのは**生成器が間違った期待値を作らないため**であって、
        # engine の挙動を隠すためではない。**指数の符号を変える打ち方そのものは
        # まだ検証していない**——レポートがそう書く。
        if fn == "neg" and _is_exponent_entry(arg):
            arg = _typed_decimal(rng)
        return Un(fn, arg)
    return Bin(
        rng.choice(BINARY_OPS),
        _typed_node(rng, depth - 1),
        _typed_node(rng, depth - 1),
    )


# 三角関数に渡す角度の上限(度)。**f64 の刻み幅から決めた。**
#
# 1e6 度は約 1.7e4 ラジアンで、その大きさでの f64 の刻み幅は約 1.8e-12。
# sin/cos の導関数は 1 以下なので、引数の丸めだけで生じる誤差は 2e-12 程度
# ——表示分解能(5e-10)に対して 2 桁以上の余裕がある。
#
# **上限を置くのは、この現象を隠すためではない。** 巨大角度の三角関数は
# `scientific` シャードで既に上書き 2 件として名指しで記録されている。
# **同じ理由が繰り返し出るなら、上書きを何個も手書きするのではなく帯の
# 問題である**——上書きは名指しの例外のための機構で、再現する分類には
# 向かない(2026-08-17、9/2000 が同じ理由で外れて判明)。
TYPED_MAX_ANGLE_DEG = mp.mpf("1e6")


def _angle_is_reducible(node: Node) -> bool:
    """三角関数の引数が、f64 が解像できる大きさに収まっているか。"""
    try:
        return abs(evaluate(node)) <= TYPED_MAX_ANGLE_DEG
    except OutOfShard:
        return False


def build_typed_shard(seed: int, count: int) -> dict:
    """**打ち方のシャード。** 同じ値への別の打ち方を通す。

    `dot` / `zeros3` / `exp` はどれも値を新しくしない——**新しいのは
    「その値にどう到達するか」**である。engine の入力バッファは
    そこで初めて踏まれる(設計書 2026-08-17 §1)。
    """
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
        node = _typed_node(rng, MAX_DEPTH)
        if isinstance(node, Typed):
            # 裸のリテラルは「打った桁が返る」ことしか確かめない。
            continue
        if any(
            isinstance(sub, Un)
            and sub.fn in ("sin", "cos", "tan")
            and not _angle_is_reducible(sub.arg)
            for sub in walk(node)
        ):
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
                "id": f"typed-{len(entries):06d}",
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


# --- 訂正（`ac` / `del`）---

# でたらめに打つ列。**`ac` の後は何も残らないことを主張する**ので、
# 中身は何でもよい。角度モードや表示形式を変えるキーは入れない
# ——`cleared()` はそれらを保つので、同値が成り立たなくなる。
GARBAGE_KEYS = ("7", "add", "3", "dot", "9", "mul", "lparen", "2", "sub", "8")


def _with_typo(leaf: Typed, rng: random.Random) -> Typed:
    """**同じ葉を、打ち間違えて直しながら打つ。**

    余分な桁を 1 つ打って `del` で消す。値は変わらないので、
    同値であることが構成から自明である。

    **注入するのは葉のキー列の末尾**——そこはまだ数を打っている最中なので、
    `del` が仮数の 1 文字を消す。バッファが空のところで `del` を打つと
    開き括弧を消しに行き、**別の意味になる**(設計書 §3.3)。
    """
    extra = str(rng.randint(0, 9))
    return Typed((*leaf.keys, extra, "del"), leaf.text)


def _inject_typo(node: Node, rng: random.Random) -> Node:
    """木の中の `Typed` の葉を 1 つ選んで、打ち間違いを入れる。"""
    leaves = [sub for sub in walk(node) if isinstance(sub, Typed)]
    if not leaves:
        return node
    target = leaves[rng.randrange(len(leaves))]
    replaced = _with_typo(target, rng)

    def rebuild(current: Node) -> Node:
        if current is target:
            return replaced
        if isinstance(current, Bin):
            return Bin(current.op, rebuild(current.left), rebuild(current.right))
        if isinstance(current, Un):
            return Un(current.fn, rebuild(current.arg))
        return current

    return rebuild(node)


CORRECTION_FORMS = 2


def build_corrections_shard(seed: int, count: int) -> dict:
    """**訂正のシャード。** 打ち間違えて直した列と、打ち間違えない列。

    `ac` と `del` は**打った結果を巻き戻す**キーで、値の意味を持たない。
    だから期待値を持たず、**二つのキー列が同じ表示に着くこと**だけを主張する。
    """
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
        node = _typed_node(rng, MAX_DEPTH - 1)
        if isinstance(node, Typed):
            continue
        try:
            if not _within_range(node):
                continue
        except OutOfShard:
            continue
        clean = to_key_sequence(node)
        if rng.randrange(CORRECTION_FORMS) == 0:
            # `del`: 葉の途中で打ち間違えて消す。
            dirty = to_key_sequence(_inject_typo(node, rng))
        else:
            # `ac`: でたらめに打ってから全部消して打ち直す。
            dirty = [*GARBAGE_KEYS, "ac", *clean]
        if dirty == clean:
            continue
        key = (tuple(clean), tuple(dirty))
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            {
                "kind": "equivalence",
                "id": f"fix-{len(entries):06d}",
                "mode": "Deg",
                "left": clean,
                "right": dirty,
                "expr": f"{to_expr_text(node)}(訂正あり)",
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


# --- 角度モードのシャード（段階 H）---

# ラジアンの葉の帯。**度の 0〜999 をそのまま使うと 999 rad = 159 回転**になり、
# 引数還元の限界に当たる(段階 G で 1e6 度に切ったのと同じ問題)。
# ラジアンでは 2π ≈ 6.28 が 1 周なので、数周ぶんに収める。
RAD_MAX = 20


def _rad_leaf(rng: random.Random) -> Typed:
    """ラジアン用の葉。**小数を打つ**——`0`〜`20` の整数だけでは
    三角関数の引数として粗すぎて、同じ値ばかりになる。"""
    whole = rng.randint(0, RAD_MAX)
    frac = rng.randint(0, 999)
    text = f"{whole}.{frac:03d}"
    return Typed(tuple("dot" if ch == "." else ch for ch in text), text)


def _rad_node(rng: random.Random, depth: int) -> Node:
    if depth <= 0 or rng.random() < 0.45:
        return _rad_leaf(rng)
    if rng.random() < 0.5:
        return Un(rng.choice(UNARY_FNS), _rad_node(rng, depth - 1))
    return Bin(
        rng.choice(BINARY_OPS),
        _rad_node(rng, depth - 1),
        _rad_node(rng, depth - 1),
    )


def _uses_trig(node: Node) -> bool:
    """三角関数を含むか。**含まない木は角度モードを一切踏まない**ので捨てる。"""
    return any(isinstance(sub, Un) and sub.fn in ("sin", "cos", "tan") for sub in walk(node))


def _within_range_mode(node: Node, mode: str) -> bool:
    """`_within_range` のモード付き。葉から先に見るのは同じ。"""
    for sub in _subtrees_leaves_first(node):
        value = evaluate(sub, mode)
        if value != 0 and not (MIN_ABS <= abs(value) <= MAX_ABS):
            return False
    return True


def build_angle_mode_shard(seed: int, count: int) -> dict:
    """**ラジアンのシャード。`angle_toggle` を実際に押す。**

    `mode` を `"Rad"` と書くだけでは嘘になる——harness はキー列を流すだけで、
    押さなければ engine は既定の `Deg` のまま評価する。だから
    **キー列の先頭で実際に押す**(設計書 2026-08-17-angle §3.1)。

    `assertSupportedMode` はそれを「奇数回押していること」で確かめる。
    """
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
        node = _rad_node(rng, MAX_DEPTH)
        if isinstance(node, Typed) or not _uses_trig(node):
            # 三角関数を含まない木は、Rad にしても Deg と同じ答えになる
            # ——角度モードを一切踏まないので、確かめることが無い。
            continue
        try:
            if not _within_range_mode(node, "Rad"):
                continue
            value = evaluate(node, "Rad")
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"rad-{len(entries):06d}",
                "mode": "Rad",
                # **先頭で押す。** これが無いと engine は Deg で評価する。
                "keys": ["angle_toggle", *to_key_sequence(node)],
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


# --- 桁落ちを狙うシャード（段階 G §3.4）---

# **このシャードだけ許容が違う。** 表示分解能(5e-10)では実測で 99.8% が
# 外れ、スイートが永久に赤くなる——永久に赤いスイートは無視されるように
# なるので、それが最悪の結果である。**判定表は実測の最悪値をそのまま出す**
# ので、テストが緑でも報告は正直なままになる。
CANCELLATION_TOLERANCE = {"abs": 5e-10, "rel": 1e-6}


def _typed(text: str) -> Typed:
    """十進の文字列から打鍵の列を作る。**`.` は `dot` キー。**"""
    return Typed(tuple("dot" if ch == "." else ch for ch in text), text)


def _near_subtraction(rng: random.Random) -> Node:
    """近接する 2 数の減算。**桁落ちの主役。**"""
    base = rng.randint(10**5, 10**7)
    frac = rng.randint(1, 999)
    delta = rng.randint(1, 9)
    return Bin(
        "-",
        _typed(f"{base}.{frac:03d}"),
        _typed(f"{base}.{max(frac - delta, 0):03d}"),
    )


def _sqrt_difference(rng: random.Random) -> Node:
    """`sqrt(a) - sqrt(b)` で a と b が近い形。"""
    base = rng.randint(10**6, 10**9)
    return Bin("-", Un("sqrt", _typed(str(base + 1))), Un("sqrt", _typed(str(base))))


def _log_near_one(rng: random.Random) -> Node:
    """1 に近いところの対数。引数の丸めがそのまま結果に出る。"""
    tail = rng.randint(1, 999)
    return Un("ln", _typed(f"1.000000{tail:03d}"))


def _absorption(rng: random.Random) -> Node:
    """大小の吸収。小さいほうが丸めで消える。"""
    big = rng.randint(10**6, 10**9)
    small = rng.randint(1, 999)
    return Bin("+", _typed(str(big)), _typed(f"0.000{small:03d}"))


CANCELLATION_SHAPES = (
    _near_subtraction,
    _sqrt_difference,
    _log_near_one,
    _absorption,
)


def build_cancellation_shard(seed: int, count: int) -> dict:
    """**「結果は出るが間違っている」を狙い撃つシャード。**

    エラーは自分で名乗るが、もっともらしく間違った数は名乗らない——
    独立実装が唯一の武器になるのはそこである(設計書 2026-08-17 §3.4)。

    **乱択では桁落ちはほとんど起きない。** 近い 2 数が偶然選ばれる確率が
    低いためで、だから狙って作る。
    """
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
        node = CANCELLATION_SHAPES[rng.randrange(len(CANCELLATION_SHAPES))](rng)
        try:
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
                "id": f"canc-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": float(value), "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": CANCELLATION_TOLERANCE,
        "cases": entries,
    }


def build_combinatorics_shard(seed: int, count: int) -> dict:
    """階乗・順列・組合せのシャード。**帯も木の形も他の 2 つと違う。**

    **帯**: `float()` が `inf` にならないことだけ。`MIN_ABS`/`MAX_ABS` を当てない
    (設計書 §3.2.1)。既存の帯(`1e9`)を当てると `C(50,25) ≈ 1.26e14` すら入らず、
    大きな桁のケースが一件も出ない。

    **木**: 整数リテラルに演算を 1 つ、深さ 1。任意の部分木をオペランドにすると
    「非負整数で `r <= n`」を満たす確率が実用にならない。**この系統が検証したいのは
    式の構造ではなく、組合せ計算そのものの正しさと大きな桁の扱いである。**

    **絞る条件に engine の途中値を持ち込まない**(設計書 §3.2)。答が f64 に収まる
    限り生成し、engine が返せなければ不一致として赤くなる。それが
    `ncr_does_not_overflow_on_the_way_to_an_answer_that_fits` を独立に検証する
    ということである。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()
    rejections = dict.fromkeys(REJECTION_REASONS, 0)
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        if rng.random() < 0.25:
            node: Node = Un(
                rng.choice(COMBINATORICS_FNS),
                Num(rng.randint(0, COMBINATORICS_MAX_FACT)),
            )
        else:
            node = Bin(
                rng.choice(COMBINATORICS_BINS),
                Num(rng.randint(0, COMBINATORICS_MAX_N)),
                Num(rng.randint(0, COMBINATORICS_MAX_N)),
            )
        try:
            value = evaluate(node)
        except OutOfShard as exc:
            rejections[_classify_out_of_shard(str(exc))] += 1
            continue
        except OverflowError:
            rejections["overflow"] += 1
            continue
        # **mpmath は溢れても例外を投げず `inf` に飽和する。** 実測:
        #   float(math.factorial(1000))         -> OverflowError
        #   float(mp.mpf(math.factorial(1000))) -> inf   (例外なし)
        # 設計書 R4 の「`float()` が `OverflowError` を出さないこと」は Python の
        # **整数**の性質で、`evaluate` が返す mpf には当てはまらない。`inf` で見る。
        landed = float(value)
        if math.isinf(landed):
            rejections["overflow"] += 1
            continue
        expr = to_expr_text(node)
        if expr in seen:
            rejections["dup"] += 1
            continue
        seen.add(expr)
        entries.append(
            {
                "kind": "value",
                "id": f"comb-{len(entries):06d}",
                "mode": "Deg",
                "keys": to_key_sequence(node),
                "expr": expr,
                "expect": {"re": landed, "im": 0.0},
            }
        )
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "rejections": rejections,
        "cases": entries,
    }


def build_inverse_trig_shard(seed: int, count: int) -> dict:
    """逆三角関数のシャード。

    **二項演算子には既存の 4 つを使う。** `asin` などは単項なので、式の骨格を
    作る演算子が別に要る。ここで `^` を混ぜると、この系統の棄却の内訳に
    `^` の定義域が混ざって読めなくなる(設計書 §3.6)。

    `BINARY_OPS` は**引数として渡すだけ**でタプルには触っていない。生成器は
    独自の `random.Random(seed)` を持つので、既存シャードの乱数に影響しない。
    """
    return build_family_shard(seed, count, "itrig", INVERSE_TRIG_FNS, BINARY_OPS)


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
    write("elementary-000.json", build_elementary_shard(seed=20260818, count=count))
    write("inverse-trig-000.json", build_inverse_trig_shard(seed=20260819, count=count))
    write("typed-000.json", build_typed_shard(seed=20260824, count=count))
    write(
        "angle-mode-000.json",
        build_angle_mode_shard(seed=20260826, count=count),
    )
    write(
        "corrections-000.json",
        build_corrections_shard(seed=20260825, count=count),
    )
    write(
        "cancellation-000.json",
        build_cancellation_shard(seed=20260823, count=count),
    )
    write(
        "combinatorics-000.json",
        build_combinatorics_shard(seed=20260820, count=count),
    )
    # 金融とデータスケール。**科学計算とは別の領域**で、期待値は整数なので
    # 厳密一致で比べる(設計書 2026-08-17 §3.2)。
    write("finance-000.json", build_finance_shard(seed=20260821, count=count))
    write("data-scale-000.json", build_data_scale_shard(seed=20260822, count=count))
    elapsed = time.monotonic() - started
    # 生成時間はコーパスの上限を決める(設計書 §11)。必ず表に出す。
    # %.1f 秒だと数千件までは 0.0s に丸まって無意味になる(レビュー修正ラウンド 1)。
    # ミリ秒単位で出す。
    print(
        f"generated {count} cases in {elapsed * 1000:.2f}ms ({elapsed / count * 1000:.4f}ms each)"
    )


if __name__ == "__main__":
    main()
