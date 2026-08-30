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
import sympy as sp

from calcarc_reference import (
    corpus_combinatorics,
    corpus_complex,
    corpus_science,
    eng_ref,
    real_ref,
    sexagesimal_ref,
)
from calcarc_reference.corpus_calls import build_data_scale_shard, build_finance_shard
from calcarc_reference.corpus_complex import (
    COMPLEX_BINARY_OPS,
    COMPLEX_UNARY_FNS,
    NotComplexSafe,
)
from calcarc_reference.corpus_entry import build_entry_shard
from calcarc_reference.corpus_errors import build_errors_shard
from calcarc_reference.corpus_eval import OutOfShard, evaluate
from calcarc_reference.corpus_expr import (
    BINARY_KEYS,
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
    Imag,
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


def _provenance_sympy() -> str:
    """複素数のシャードの素性。**こちらは本当に SymPy が値を作っている。**

    `_provenance` は「SymPy を書かない」ことを規律にしている——あれが名乗る
    シャードは mpmath だけで評価されており、関与していない依存の版を書くのは
    不正確だからである。**同じ理由で、こちらは SymPy を書かなければならない。**
    `corpus_complex` は SymPy の厳密有理数で木を組み、`sp.N` で 1 度だけ
    落としている(設計書 2026-08-17-complex §6)。

    素性が 2 種類あることそのものが、**どのシャードを何が作ったか**を
    読み手に伝える。1 つに統一すると、どちらかが嘘になる。
    """
    return (
        f"sympy {sp.__version__} ({corpus_complex.PRECISION} dps), "
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
        case = {
            "kind": "value",
            "id": f"prec-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_minimal_key_sequence(node),
            "expr": expr,
            "expect": {"re": float(value), "im": 0.0},
        }
        # **木を歩いて記録し、キーから読んだものと突き合わせる**（裁定 1 の (c)）。
        # ここのキー列は**括弧を省いた形**なので、`parenthesis` の観測は
        # 木と食い違いうる——だからそれは観測のみの軸である。
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


# **結合方向のシャード(設計書 2026-08-19 §6、計画 Task 4)。**
#
# 左結合・右結合の規則は `docs/base-spec.md` の**公開契約**である——`xʸ` だけが
# 右結合で(`2^3^2 = 512`)、四則と `nPr`/`nCr` は左結合。ここは
# `BINARY_PRECEDENCE` とまったく同じ立場で、**計算ではなく記法の約束**である。
# `engine/mod.rs` の畳み込みの実装は読んでいない——読めば移植になる。
#
# **既存の直列化(`to_keys` / `to_keys_minimal`)は 1 文字も触らない。**
# `to_keys_minimal` は「同順位の入れ子の括弧は残す」で書かれており、それを
# 変えると `precedence-000.json` の 2000 件が総入れ替えになる。このシャードは
# **自分で平坦なキー列を組む**。
RIGHT_ASSOCIATIVE_OPS = ("^",)

#: 同順位の連鎖に使う演算子。**1 つの連鎖に混ぜてよいのは同じ優先順位の段
#: だけ**である。混ぜると「同じ括弧の組に優先順位の異なる演算子が 2 つ」に
#: なり、`needsPrecedence` が数える「括弧を省いた式」に化けて、優先順位の
#: 検証(`precedence-000.json` の担当)とこのシャードの担当が混ざる。
#: 赤が出たときにどちらが原因か分からなくなるので、意図して分けている。
ASSOC_CHAINS: dict[str, tuple[str, ...]] = {
    "additive": ("+", "-"),
    "multiplicative": ("*", "/"),
    "combinatorial": ("nPr", "nCr"),
    "power": ("^",),
}

#: 対照群の層の名前。**同じシャードに入れる**(設計書 §6)——括弧が構造を
#: 決めるので結合方向を反転しても答えが変わらない。変異がシャード内の
#: **一部だけ**を赤くすることになり、無差別に壊しているのではないと言える。
ASSOC_CONTROL_STRATUM = "parenthesized"

#: 二つの読み方が「別の答え」と言えるための相対差の下限。
#:
#: **許容誤差ではない**(合否には一切使わない。CLAUDE.md の規約どおり、
#: 判定に使う許容は `tolerance` が持つ)。ここは生成側のふるいで、
#: `a + b + c` のように結合方向を変えても答えが同じになる連鎖
#: (加算・乗算は結合的である)や、`a - b - 0` のように偶然一致する連鎖を
#: 捨てるためにある。`tolerance.rel`(5e-10)よりはるかに粗い値を置くのは、
#: 「二つの読み方の差」が許容誤差すれすれのケースを混ぜないためである。
ASSOC_MIN_RELATIVE_GAP = mp.mpf("1e-3")


def _assoc_leaves(rng: random.Random, stratum: str) -> tuple[list[Node], list[str]]:
    """1 本の連鎖の項と演算子を引く。**層ごとに範囲が違う。**

    `combinatorial` は値が爆発するので項数も桁数も小さく取る——大きく取ると
    `_within_range` がほとんど全部を捨て、生成が止まらない。
    """
    ops = ASSOC_CHAINS[stratum]
    if stratum == "additive":
        terms = [Num(rng.randint(1, 999)) for _ in range(rng.randint(3, 5))]
    elif stratum == "multiplicative":
        terms = [Num(rng.randint(1, 99)) for _ in range(rng.randint(3, 4))]
    elif stratum == "combinatorial":
        # **内側は必ず `nPr` にする。** 組合せ `C(n, r) = P(n, r) / r!` は
        # **割り算を通る**ので、f64 で計算した答えは整数の格子から外れることが
        # ある——実測 `C(29, 4)` は 23751 ではなく 23751.000000000004 になる。
        # その値をもう一度 `nPr`/`nCr` に食わせると「非負整数か」の検査に
        # 落ちて `DomainError` になる(実測 2026-08-20、`assoc-001790` ほか
        # 4 件。表示は 23751 と出るので、画面からは区別が付かない)。
        # 順列 `P(n, r) = n(n−1)…` は積だけなので、2^53 未満なら厳密である。
        #
        # **これは結合方向とは別の主張である。** 内側に `nCr` を許すと、
        # このシャードは「連鎖した組合せの途中値が整数の格子に載るか」まで
        # 主張することになり、赤が出たときにどちらが原因か分からなくなる。
        # 途中値の厳密性は別の担当である(この食い違い自体は申し送りにした)。
        terms = [Num(rng.randint(4, 40)), Num(rng.randint(2, 5)), Num(rng.randint(2, 3))]
        return terms, ["nPr", rng.choice(ops)]
    else:
        raise ValueError(f"unknown randomly sampled associativity stratum: {stratum!r}")
    return terms, [rng.choice(ops) for _ in range(len(terms) - 1)]


def _power_chains() -> list[tuple[list[Node], list[str]]]:
    """`xʸ` の連鎖の候補を**全部**並べる。乱択しない。

    **平坦表示の帯(`MAX_ABS` = 1e9)の中に収まる `b ^ e1 ^ e2` は、
    数え上げられるほど少ない。** 右結合の読みは `b^(e1^e2)` なので、指数が
    少し伸びただけで帯を突き抜ける——実測で、下の箱(底 2〜99、指数 2〜5)の
    1568 通りのうち**残るのは 27 通り**だった。さらに `e1 = e2 = 2` は
    `e1^e2 = e1*e2 = 4` で二つの読みが同じ値になるので、結合方向を区別できない。

    狭いなら乱択する意味がない。**箱を全部見て、通ったものを全部使う**——
    そのほうが「この形をどれだけ踏んだか」を数えたときに嘘がない。
    """
    return [
        ([Num(base), Num(first), Num(second)], ["^", "^"])
        for base in range(2, 100)
        for first in range(2, 6)
        for second in range(2, 6)
    ]


def _fold(terms: list[Node], ops: list[str], *, right: bool) -> Node:
    """項と演算子を、左からか右から畳んで木にする。"""
    if right:
        node = terms[-1]
        for op, term in zip(reversed(ops), reversed(terms[:-1]), strict=True):
            node = Bin(op, term, node)
        return node
    node = terms[0]
    for op, term in zip(ops, terms[1:], strict=True):
        node = Bin(op, node, term)
    return node


def _assoc_trees(terms: list[Node], ops: list[str]) -> tuple[Node, Node]:
    """公開契約どおりの読み方と、**その逆向きの読み方**を返す。

    逆向きの木は期待値には一切使わない。生成側のふるい
    (`ASSOC_MIN_RELATIVE_GAP`)が「このキー列は結合方向を区別できるのか」を
    判定するためだけに組む。
    """
    right = ops[0] in RIGHT_ASSOCIATIVE_OPS
    if any((op in RIGHT_ASSOCIATIVE_OPS) != right for op in ops):
        raise ValueError(f"a chain mixes both associativities: {ops!r}")
    return _fold(terms, ops, right=right), _fold(terms, ops, right=not right)


def assoc_value(terms: list[Node], ops: list[str]) -> mp.mpf | None:
    """この連鎖が使えるなら公開契約どおりの読みの値を、使えないなら `None`。

    捨てるのは 3 通り。**どれも「踏んでも何も言えない列」である。**

    1. 契約どおりの読みが平坦表示の帯を外れる(`_within_range`)。
    2. どちらかの読みが数学の定義域を外れる(`5 nPr (3 nPr 2)` は r > n)。
       engine がどのエラーを返すかはこの層の主張ではないので、素直に捨てる。
    3. 二つの読みの差が `ASSOC_MIN_RELATIVE_GAP` に届かない。加算と乗算は
       **結合的**なので `9 + 4 + 3` はどちらの読みでも 16 であり、
       `(b^2)^2 = b^(2^2)` も同じ値になる。そういう列を積むと
       「大量に踏んだ」が「大量に何も試していない」に化ける。
    """
    documented, other = _assoc_trees(terms, ops)
    try:
        if not _within_range(documented):
            return None
        value = evaluate(documented)
        alternative = evaluate(other)
    except OutOfShard:
        return None
    if not mp.isfinite(alternative):
        return None
    if abs(value - alternative) / max(abs(value), mp.mpf(1)) < ASSOC_MIN_RELATIVE_GAP:
        return None
    return value


def _assoc_pair(
    index: int, stratum: str, terms: list[Node], ops: list[str], value: mp.mpf
) -> list[dict]:
    """1 本の連鎖から、**平坦なキー列とその全括弧の双子**を作る。

    期待値は同じ木から出るので、二つは必ず同じ値になる。違うのはキー列だけ
    である——だから `associativity-flip` の変異は、**平坦な側だけ**を赤くする。
    """
    documented, _ = _assoc_trees(terms, ops)
    expr = to_expr_text(documented)
    expect = {"re": float(value), "im": 0.0}
    # **双子は同じ木から出る。** 層だけが違うので、記録も層ごとに取る
    # （`shape` は `stratum` で決まる。裁定 1 の (c)）。
    flat_levels = corpus_science.levels_as_json(
        corpus_science.recorded_levels(documented, "Deg", stratum)
    )
    paren_levels = corpus_science.levels_as_json(
        corpus_science.recorded_levels(documented, "Deg", ASSOC_CONTROL_STRATUM)
    )
    return [
        {
            "kind": "value",
            "id": f"assoc-{index:06d}",
            "stratum": stratum,
            "mode": "Deg",
            "keys": _flat_key_sequence(terms, ops),
            "expr": expr,
            "expect": expect,
            "levels": flat_levels,
        },
        {
            "kind": "value",
            "id": f"assoc-{index + 1:06d}",
            "stratum": ASSOC_CONTROL_STRATUM,
            "mode": "Deg",
            "keys": to_key_sequence(documented),
            "expr": expr,
            "expect": expect,
            "levels": paren_levels,
        },
    ]


def _flat_key_sequence(terms: list[Node], ops: list[str]) -> list[str]:
    """**括弧を 1 つも打たない**キー列。結合方向だけが構造を決める。

    `to_keys_minimal` を使わないのは、あれが同順位の入れ子の括弧を意図して
    残すからである(その docstring を見よ)。ここが欲しいのは、まさにその
    残している括弧を外した形である。
    """
    keys = list(to_keys(terms[0]))
    for op, term in zip(ops, terms[1:], strict=True):
        keys.append(BINARY_KEYS[op])
        keys.extend(to_keys(term))
    return [*keys, "eq"]


def build_assoc_shard(seed: int, count: int) -> dict:
    """**結合方向**のシャード(`kind: "value"`)。

    1 本の連鎖から**二件**書き出す。同じ項と同じ演算子から、

    1. 括弧を 1 つも打たない平坦なキー列(`9 − 4 − 3`)。engine は結合方向
       だけを頼りに構造を決める。
    2. その木を全括弧で書いた対照群(`((9 − 4) − 3)`)。**括弧が構造を
       決めるので、結合方向を反転しても答えが変わらない。**

    **対照群を同じシャードに入れる**(設計書 §6)。`associativity-flip` の
    変異はこのシャードのちょうど半分だけを赤くすることになり、変異が
    シャード全体を無差別に壊しているのではないことが、シャードの中で言える。

    層の配分は乱択しない。`power` は箱を数え上げて通ったものを全部使い
    (`_power_chains` を見よ)、残りを乱択の 3 層に決まった割合で配る。
    **埋まらなければ黙って縮まず `RuntimeError` で落ちる**——層が痩せた
    シャードは、痩せたことを言わずに件数だけを名乗るからである。
    """
    rng = random.Random(seed)
    pairs = count // 2
    chains: list[tuple[str, list[Node], list[str], mp.mpf]] = []
    remaining = pairs
    power: list[tuple[list[Node], list[str]]] = []
    for terms, ops in _power_chains():
        value = assoc_value(terms, ops)
        if value is not None and len(power) < remaining:
            power.append((terms, ops))
            chains.append(("power", terms, ops, value))
    remaining -= len(power)
    quotas = {
        "additive": round(remaining * 0.50),
        "multiplicative": round(remaining * 0.33),
    }
    quotas["combinatorial"] = remaining - sum(quotas.values())
    for stratum, quota in quotas.items():
        seen: set[tuple[str, ...]] = set()
        taken = 0
        attempts = 0
        while taken < quota:
            attempts += 1
            if attempts > max(quota, 1) * 500:
                raise RuntimeError(
                    f"{stratum}: gave up after {attempts} attempts with {taken}/{quota} "
                    "chains — the sampling box is too small for this count"
                )
            terms, ops = _assoc_leaves(rng, stratum)
            keys = tuple(_flat_key_sequence(terms, ops))
            if keys in seen:
                continue
            value = assoc_value(terms, ops)
            if value is None:
                continue
            seen.add(keys)
            chains.append((stratum, terms, ops, value))
            taken += 1
    entries: list[dict] = []
    for stratum, terms, ops, value in chains:
        entries.extend(_assoc_pair(len(entries), stratum, terms, ops, value))
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["stratum"]] = counts.get(entry["stratum"], 0) + 1
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "strata": dict(sorted(counts.items())),
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
        case = {
            "kind": "value",
            "id": f"{prefix}-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": expr,
            "expect": {"re": float(value), "im": 0.0},
        }
        # **木を歩いて水準を記録し、キーから読んだものと突き合わせる**
        # (試験空間モデル `scientific-v1` の裁定 1 の (c))。
        # **食い違ったら生成を止める**——警告で流さない。
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "rejections": rejections,
        "cases": entries,
    }


def build_elementary_shard(seed: int, count: int) -> dict:
    shard = build_family_shard(seed, count, "elem", ELEMENTARY_FNS, ELEMENTARY_BINS)
    _append_elementary_boundaries(shard["cases"])
    return shard


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


def _error_inducing_key_sequences() -> tuple[tuple[str, ...], ...]:
    """`errors-000.json` の 9 経路のうち、実際にエラーになる列だけを取り出す。

    アンダーフローの 2 件(`value_range_cases` の後半)は `expect.error` を
    持たない(丸め潰れは値域を外れたことにならない、`corpus_errors.py` の
    モジュール docstring)ので、ここには入らない。**エラー状態を作るための
    プールなので、実際にエラーになる列だけが要る。**

    **括弧の経路(`unbalanced_parenthesis_cases`)も入れる。** 実装中、
    この 2 件を除けば `pnpm heavy` が緑になることが分かった——`right` 全体を
    1 本のキー列として括弧の対応を見るコード(`web/tests/heavy/corpus.ts` の
    `needsPrecedence` と、その Python の双子)が、`ac` が engine を初期状態に
    戻すことを知らなかったためである。**engine は `ac` で正しく復帰しており、
    壊れていたのは判定のほうだった**ので、判定を直した(`ac` でそれまでの
    括弧の組を捨てる)。入力を除いていたら、「括弧の構文エラーから `ac` で
    復帰する」という形がコーパスから丸ごと抜けていた。
    """
    cases = build_errors_shard()["cases"]
    return tuple(tuple(case["keys"]) for case in cases if case["expect"].get("error"))


#: `errors-000.json` から起こした、実際にエラーになるキー列のプール
#: (計画 Task 3、設計書 §5.2)。`build_errors_shard` は乱択を持たない固定の
#: 列挙なので、ここも固定になる。
ERROR_INDUCING_KEY_SEQUENCES = _error_inducing_key_sequences()

#: `build_corrections_shard` が積む層(finance の `stratum` と同じ考え方、
#: 計画 Task 3 Step 2)。`rng.randrange(len(CORRECTION_STRATA))` の添字と
#: 対応する。
CORRECTION_STRATA = ("typo-del", "ac-rebuild", "error-recovery", "paren-edit")

CORRECTION_FORMS = len(CORRECTION_STRATA)


def build_corrections_shard(seed: int, count: int) -> dict:
    """**訂正のシャード。** 打ち間違えて直した列と、打ち間違えない列。

    `ac` と `del` は**打った結果を巻き戻す**キーで、値の意味を持たない。
    だから期待値を持たず、**二つのキー列が同じ表示に着くこと**だけを主張する。

    4 つの層(`CORRECTION_STRATA`)を持つ:

    - `typo-del`: 葉の途中で 1 桁多く打って `del` で消す。
    - `ac-rebuild`: でたらめに打ってから `ac` で全部消して打ち直す。
    - `error-recovery`: エラーになる列を打ち、**エラー中に他のキーを
      押してから**(`keys_other_than_ac_are_ignored_while_in_error`、
      `engine_table.rs:194`)`ac` で復帰し、正しい列を打つ
      (`ac_recovers_from_an_error`、`engine_table.rs:189`)。
    - `paren-edit`: 開いた括弧の中で 1 桁打ってから `del` で消し、
      別の桁を打つ(計画 Task 3 Step 1)。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    strata: list[str] = []
    seen: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        form = CORRECTION_STRATA[rng.randrange(CORRECTION_FORMS)]
        if form in ("typo-del", "ac-rebuild", "error-recovery"):
            node = _typed_node(rng, MAX_DEPTH - 1)
            if isinstance(node, Typed):
                continue
            try:
                if not _within_range(node):
                    continue
            except OutOfShard:
                continue
            clean = to_key_sequence(node)
            if form == "typo-del":
                # `del`: 葉の途中で打ち間違えて消す。
                dirty = to_key_sequence(_inject_typo(node, rng))
            elif form == "ac-rebuild":
                # `ac`: でたらめに打ってから全部消して打ち直す。
                dirty = [*GARBAGE_KEYS, "ac", *clean]
            else:
                # `error-recovery`: エラーになる列を打ち、エラー中に別の
                # キーをさらに押してから `ac` で復帰し、正しい列を打つ。
                # `GARBAGE_KEYS` を「エラー中は無視される」側の主張にも
                # そのまま使う——中身がでたらめでよいのは変わらない。
                error_keys = ERROR_INDUCING_KEY_SEQUENCES[
                    rng.randrange(len(ERROR_INDUCING_KEY_SEQUENCES))
                ]
                dirty = [*error_keys, *GARBAGE_KEYS, "ac", *clean]
            expr = f"{to_expr_text(node)}(訂正あり)"
        else:
            # `paren-edit`: `a + ( c )` を、括弧の中で 1 桁打ち間違えてから
            # 直す形で打つ。`b` は必ず 1 個の数字キーにする——1 回の `del` で
            # 完全に消えて欲しいので、複数キーの葉(小数点や `zeros3` など)
            # だと最後の 1 キーしか消えず別の形になってしまう。
            a_leaf = _typed_leaf(rng)
            c_leaf = _typed_leaf(rng)
            try:
                if not _within_range(Bin("+", a_leaf, c_leaf)):
                    continue
            except OutOfShard:
                continue
            b_digit = str(rng.randint(0, 9))
            clean = [*to_keys(a_leaf), "add", "lparen", *to_keys(c_leaf), "rparen", "eq"]
            dirty = [
                *to_keys(a_leaf),
                "add",
                "lparen",
                b_digit,
                "del",
                *to_keys(c_leaf),
                "rparen",
                "eq",
            ]
            expr = f"{to_expr_text(a_leaf)}+({to_expr_text(c_leaf)})(括弧内で訂正)"
        if dirty == clean:
            continue
        key = (tuple(clean), tuple(dirty))
        if key in seen:
            continue
        seen.add(key)
        strata.append(form)
        entries.append(
            {
                "kind": "equivalence",
                "id": f"fix-{len(entries):06d}",
                "mode": "Deg",
                "left": clean,
                "right": dirty,
                "expr": expr,
                "stratum": form,
            }
        )
    counts = {name: strata.count(name) for name in CORRECTION_STRATA}
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": TOLERANCE,
        "cases": entries,
        "strata": counts,
    }


# --- 複素数のシャード（段階 J）---
#
# **未押下キーの最後の 2 個(`j` と `▸∠`)を押す。** これで 46 キーすべてが押される。
#
# この電卓は複素数を持っている——`j` で虚数単位を打ち、四則が複素数のまま動き、
# `▸∠` で極形式に切り替わる。コーパスはそこに一度も触れていなかった。
#
# ## 関数の定義域について（実測 2026-08-17）
#
# 設計書は「関数は実数に閉じている」と書いていたが、**それは広すぎた。**
# 実測すると:
#
# | 単項 | 複素数を渡すと |
# |---|---|
# | `sqrt` `ln` `log10` `recip` `n_fact` | `DomainError`（`real_arg` が弾く） |
# | `sin` `cos` `tan` | **複素数のまま計算する**（`scientific/mod.rs:54`） |
# | `neg` `sqr` | 複素数のまま（減算・乗算だから） |
#
# 三角関数が複素数を受け付けるのは意図された実装である——コード自身が
# 「複素数の引数でも実部・虚部の両方を同じ係数で変換する」と書いている。
# **設計書の想定より検証できる範囲が広い**ので、三角関数も含める。
#
# ## 2 つに分ける理由
#
# 段階 I と同じ理由である。**計算を挟んだ値と厳密一致は両立しない。**
#
# - `complex-000.json` — **計算した値**。`{re, im}` を許容付きで突き合わせる
# - `complex-display-000.json` — **打った数そのもの**。直交形式と極形式の
#   表示文字列を厳密一致で突き合わせる
#
# 極形式は `hypot` と `atan2` を通るので厳密ではないが、**入力が打った数そのもの
# なら誤差は 1 ulp 程度**(1e-16)で、表示 10 桁の丸め格子(相対 1e-9)をまたぐ
# 確率は 2e-7/件——2000 件で 4e-4 件である。段階 I が踏んだ帯(引数還元で
# ε≈1e-9)とは 7 桁違う。

#: 複素数の葉に打つ桁数の上限。**入力バッファは 12 桁で打ち切る**
#: (`MAX_ENTRY_LEN`、実測 2026-08-17: 13 桁打つと 13 桁目が捨てられる)。
#: 超えると参照が「打ったはずの値」を評価して食い違い、**それは整形でも
#: 計算でもなく打鍵の話**になる。余裕を取って 6 桁に収める。
COMPLEX_MAX_DIGITS = 6

#: 複素数の大きさの帯。実数側の `MIN_ABS`/`MAX_ABS` と同じ考え方で、
#: 途中値が溢れたり潰れたりする形を生成の時点で捨てる。
COMPLEX_MIN_ABS = mp.mpf("1e-6")
COMPLEX_MAX_ABS = mp.mpf("1e9")

#: 三角関数に渡す角度の上限（度）。段階 G と同じ理由で、引数還元の f64 誤差が
#: 表示分解能に効いてくる帯を避ける。**複素数では虚部にも同じ係数が掛かり、
#: `cosh`/`sinh` が指数的に伸びる**ので、実数のときよりずっと手前で切る
#: ——`cosh(710)` は f64 で溢れる。ラジアンで 100 = 5730 度あたりが実用上限で、
#: そこから 2 桁の余裕を取る。
COMPLEX_MAX_TRIG_DEG = mp.mpf("360")


def _complex_real_leaf(rng: random.Random) -> Typed:
    """実数の葉。**桁数を抑える**(上の `COMPLEX_MAX_DIGITS`)。"""
    if rng.random() < 0.5:
        text = str(rng.randint(0, 10**COMPLEX_MAX_DIGITS - 1))
    else:
        whole = rng.randint(0, 999)
        frac = rng.randint(1, 999)
        text = f"{whole}.{frac}"
    return Typed(tuple("dot" if ch == "." else ch for ch in text), text)


def _complex_imag_leaf(rng: random.Random) -> Imag:
    """虚数の葉。**`j` を先に押す形と後に押す形の両方を出す。**

    engine は桁が無ければ虚数として始め、桁があれば実部⇄虚部を切り替える
    (`engine/mod.rs:283`)。**同じ値への別の打ち方**なので、値からは
    どちらを打ったか分からない——だからキー列を持つ。
    """
    if rng.random() < 0.5:
        text = str(rng.randint(1, 10**COMPLEX_MAX_DIGITS - 1))
    else:
        whole = rng.randint(0, 999)
        frac = rng.randint(1, 999)
        text = f"{whole}.{frac}"
    digits = tuple("dot" if ch == "." else ch for ch in text)
    if rng.random() < 0.5:
        return Imag(("j", *digits), text)  # j を先に押す
    return Imag((*digits, "j"), text)  # 桁を打ってから j で切り替える


def _complex_leaf(rng: random.Random) -> Node:
    return _complex_imag_leaf(rng) if rng.random() < 0.45 else _complex_real_leaf(rng)


def _complex_node(rng: random.Random, depth: int) -> Node:
    """複素数の木。**engine が複素数を受け付ける演算だけ**で組む。

    `sqrt`/`ln`/`recip`/`n_fact` を混ぜても `DomainError` で全部捨てられるだけで、
    棄却率が上がる以外に何も確かめない(設計書 §3.1)。
    """
    if depth <= 0 or rng.random() < 0.45:
        return _complex_leaf(rng)
    if rng.random() < 0.35:
        return Un(rng.choice(COMPLEX_UNARY_FNS), _complex_node(rng, depth - 1))
    return Bin(
        rng.choice(COMPLEX_BINARY_OPS),
        _complex_node(rng, depth - 1),
        _complex_node(rng, depth - 1),
    )


def _complex_within_range(node: Node) -> bool:
    """部分木の大きさを**葉から先に**見る。実数側の `_within_range` と同じ形。

    三角関数の引数は別に上限を持つ——複素の三角は虚部に `cosh`/`sinh` が
    掛かるので、実数より遥かに手前で溢れる。
    """
    for sub in _subtrees_leaves_first(node):
        if isinstance(sub, Un) and sub.fn in ("sin", "cos", "tan"):
            re, im = corpus_complex.evaluate(sub.arg)
            if max(abs(re), abs(im)) > COMPLEX_MAX_TRIG_DEG:
                return False
        re, im = corpus_complex.evaluate(sub)
        magnitude = mp.sqrt(mp.mpf(re) ** 2 + mp.mpf(im) ** 2)
        if magnitude != 0 and not (COMPLEX_MIN_ABS <= magnitude <= COMPLEX_MAX_ABS):
            return False
    return True


def _uses_imaginary(node: Node) -> bool:
    """`j` を含むか。**含まない木は複素数を一度も踏まない**ので捨てる。"""
    return any(isinstance(sub, Imag) for sub in walk(node))


def build_complex_shard(seed: int, count: int) -> dict:
    """**複素数のシャード。値を許容付きで突き合わせる。**

    期待値は `corpus_complex` が SymPy の厳密有理数で木全体を計算し、
    **最後に 1 度だけ** f64 に落としたものである。engine は f64 の対で
    演算ごとに丸める——アルゴリズムを共有していない。

    **値ケースだけを置く。** `▸∠` の往復は「2 回押すと**同じ表示に戻る**」で
    あって数値の主張ではないので、表示のシャード側に置く(段階 I と同じ形)。
    値の同値ループは表示を実数として読み直すため、複素数の表示を渡すと
    `parseDisplay` が落ちる——そしてその番人は**残しておきたい**(実数しか
    出ないはずのシャードで `2j` が出たら落ちてほしい)。
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
        node = _complex_node(rng, MAX_DEPTH - 1)
        if not _uses_imaginary(node):
            continue
        try:
            if not _complex_within_range(node):
                continue
            re, im = corpus_complex.evaluate(node)
        except NotComplexSafe, OutOfShard, ValueError, ZeroDivisionError:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        case = {
            "kind": "value",
            "id": f"cplx-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": expr,
            "expect": {"re": re, "im": im},
        }
        # **木を歩いて記録し、キーから読んだものと突き合わせる**（裁定 1 の (c)）。
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
    _append_zero_complex(entries)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance_sympy(),
        "tolerance": TOLERANCE,
        "cases": entries,
    }


#: **実部も虚部も 0 になる複素の式**（試験空間モデルの Task 13）。
#:
#: **乱択では踏めない。** `0` に着くには 2 つの葉が**厳密に等しい**必要があり、
#: 生成器は葉を独立に引く——**確率の問題ではなく、同じ値を 2 度引く仕掛けが
#: 無い**（`expr` の重複除去もあるが、それは式の重複であって値ではない）。
#:
#: **`j` を 2 回打った差**にする。実部を混ぜると `real_zero` と区別が付かない。
ZERO_COMPLEX_DIGITS = "5"


def _append_zero_complex(entries: list[dict]) -> None:
    """**`(j5 - j5)` を末尾に足す。** 乱択の draw に触らない（Task 8 と同じ形）。

    **`zero_part=both_zero` は、この 1 件だけが踏む。** 実測（2026-08-30）:
    複素の 2 シャード 4,000 件のゼロ成分は
    `real_zero 1,327` / `imag_zero 202` / `none 1,799` で、**both_zero は 0 件**
    だった。
    """
    leaf = Imag(tuple(ZERO_COMPLEX_DIGITS) + ("j",), ZERO_COMPLEX_DIGITS)
    node = Bin("-", leaf, leaf)
    re, im = corpus_complex.evaluate(node)
    case = {
        "kind": "value",
        "id": f"cplx-{len(entries):06d}",
        "mode": "Deg",
        "keys": to_key_sequence(node),
        "expr": to_expr_text(node),
        "expect": {"re": re, "im": im},
    }
    case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
    corpus_science.assert_record_matches_observation(case, node)
    entries.append(case)


#: 極形式と直交形式の分岐を狙って手で選んだ複素数。**乱数では踏めない場所**である。
#: `(実部の文字列 or None, 虚部の文字列 or None)`——`None` はその成分を打たない。
COMPLEX_EDGE_VALUES = (
    ("3", "4"),  # 5 ∠ 53.13010235。教科書の 3-4-5
    ("1", "1"),  # ∠ 45
    ("1", "-1"),  # ∠ -45
    ("-1", "1"),  # ∠ 135
    ("-1", "-1"),  # ∠ -135
    ("1", None),  # 実軸の正。∠ 0
    ("-1", None),  # **実軸の負。∠ 180 か ∠ -180 か**(虚部の 0 の符号が効く)
    (None, "1"),  # 虚軸の正。∠ 90
    (None, "-1"),  # 虚軸の負。∠ -90
    ("0.001", "-0.001"),  # 小さい。∠ -45
    ("123456", "789"),  # 大きい実部に小さい虚部
    ("789", "123456"),  # その逆
    ("5", "0"),  # **虚部が 0。`0j` とは出ず実数として表示される**
    ("0", "5"),  # 実部が 0
    ("999.999", "999.999"),  # 桁が揃った端数
    ("2", "2"),
    ("100", "1"),
    ("1", "100"),
)


def _edge_node(re_text: str | None, im_text: str | None) -> Node:
    """手で選んだ複素数を式木にする。**負号は `neg` キーで打つ。**"""

    def leaf(text: str, imaginary: bool) -> Node:
        negative = text.startswith("-")
        body = text[1:] if negative else text
        digits = tuple("dot" if ch == "." else ch for ch in body)
        node: Node = Imag(("j", *digits), body) if imaginary else Typed(digits, body)
        return Un("neg", node) if negative else node

    if re_text is None:
        if im_text is None:
            raise ValueError("both components are None")
        return leaf(im_text, imaginary=True)
    if im_text is None:
        return leaf(re_text, imaginary=False)
    return Bin("+", leaf(re_text, imaginary=False), leaf(im_text, imaginary=True))


def build_complex_display_shard(seed: int, count: int) -> dict:
    """**複素数の表示のシャード。表示文字列を厳密一致で比べる。**

    値は**打った数そのもの**に近い——実部と虚部をそれぞれ打ち、足すだけである。
    十進→f64 は Python も Rust も正しく丸めるので**両成分ともビットまで同一**で、
    直交形式の表示は完全に厳密に比べられる。

    極形式は `hypot` と `atan2` を通るので厳密ではないが、入力が打った数なら
    誤差は 1 ulp 程度(1e-16)で、表示 10 桁の丸め格子(相対 1e-9)をまたぐ確率は
    **1 件あたり 2e-7**——2000 件で 4e-4 件である。段階 I が踏んだ帯
    (引数還元で ε≈1e-9)とは 7 桁違うので、厳密一致で比べてよい。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()

    def emit(node: Node) -> None:
        re, im = corpus_complex.evaluate(node)
        keys = to_key_sequence(node)
        expr = to_expr_text(node)
        # **同じ木から 2 件出る。** 記録も同じ木から取る（裁定 1 の (c)）。
        # `form` は `polar_toggle` を**木の外で押す**ので観測のみの軸である。
        levels = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        entries.append(
            {
                "kind": "display",
                "id": f"cdsp-{len(entries):06d}",
                "mode": "Deg",
                "keys": keys,
                "expr": f"{expr} を直交形式で",
                "expect": {"main": real_ref.format_rect(re, im)},
                "levels": levels,
            }
        )
        r, theta = corpus_complex.to_polar(re, im)
        entries.append(
            {
                "kind": "display",
                "id": f"cdsp-{len(entries):06d}",
                "mode": "Deg",
                "keys": [*keys, "polar_toggle"],
                "expr": f"{expr} を極形式で",
                "expect": {"main": real_ref.format_polar(r, theta)},
                "levels": levels,
            }
        )
        # **`▸∠` を 2 回押すと元の表示に戻る。** 値の主張ではなく表示の主張
        # なので、参照実装を通さず engine の 2 本のキー列だけで比べる。
        entries.append(
            {
                "kind": "equivalence",
                "id": f"cdsp-{len(entries):06d}",
                "mode": "Deg",
                "left": keys,
                "right": [*keys, "polar_toggle", "polar_toggle"],
                "expr": f"{expr} で ▸∠ を 2 回押すと元の表示に戻る",
            }
        )

    def emit_typing_equivalence(text: str) -> None:
        """**`j` を先に押す形と後に押す形が同じ値に着く。**

        engine は桁が無ければ虚数として始め、桁があれば実部⇄虚部を切り替える
        (`engine/mod.rs:283`)。**2 つの経路が同じ場所に着くこと**は engine の
        自己整合の主張で、参照実装は要らない。
        """
        digits = tuple("dot" if ch == "." else ch for ch in text)
        entries.append(
            {
                "kind": "equivalence",
                "id": f"cdsp-{len(entries):06d}",
                "mode": "Deg",
                "left": ["j", *digits, "eq"],
                "right": [*digits, "j", "eq"],
                "expr": f"j{text} は j を先に押しても後に押しても同じ",
            }
        )

    # **手で選んだ値は乱数に引かせず、必ず全部出す**(段階 I で学んだ形)。
    for re_text, im_text in COMPLEX_EDGE_VALUES:
        node = _edge_node(re_text, im_text)
        seen.add(to_expr_text(node))
        emit(node)
    for text in ("1", "2", "0.5", "123.456", "999999", "0.001"):
        emit_typing_equivalence(text)

    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        re_leaf = _complex_real_leaf(rng)
        im_leaf = _complex_imag_leaf(rng)
        which = rng.randrange(4)
        if which == 0:
            node: Node = im_leaf
        elif which == 1:
            node = Un("neg", im_leaf)
        elif which == 2:
            node = Bin("+", re_leaf, im_leaf)
        else:
            node = Bin("-", re_leaf, im_leaf)
        expr = to_expr_text(node)
        if expr in seen:
            continue
        try:
            re, im = corpus_complex.evaluate(node)
        except NotComplexSafe, ValueError:
            continue
        magnitude = mp.sqrt(mp.mpf(re) ** 2 + mp.mpf(im) ** 2)
        if magnitude != 0 and not (COMPLEX_MIN_ABS <= magnitude <= COMPLEX_MAX_ABS):
            continue
        seen.add(expr)
        emit(node)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance_sympy(),
        "cases": entries,
    }


# --- 表示のトグルのシャード（段階 I）---
#
# **このシャードは「整形」を試すのであって、「計算」を試すのではない。**
#
# 最初の版は任意の式の答えを 60 進・工学表記に直して**文字列の厳密一致**で
# 比べた。2000 件中 5 件が末尾 1 桁だけ食い違って落ちた——例えば
# `sin(rad(70500070))` は engine が `-173.6481776e-3`、参照が
# `-173.6481777e-3` である。原因は整形ではなく**値**で、7000 万度の引数還元で
# engine の f64 が正しく丸めた値から数 ulp ずれ、それがちょうど 10 桁目の
# 丸め境界をまたいだ。
#
# 帯を狭めても消えない。表示は有効数字 10 桁＝相対 1e-9 刻みの格子で、
# 計算の相対誤差 ε に対して「境界をまたぐ確率」はおよそ 2ε/1e-9 になる
# ——1e6 度に切って ε≈2e-11 でも 2000 件中 80 件、1e4 度に切っても数件残る。
# **厳密一致と、計算誤差を含む値は、原理的に両立しない。**
#
# だから 3 つに分ける:
#
# - **A 整形ケース(`display`、厳密一致)** — 値は**打った数そのもの**。
#   十進→f64 の変換は Python も Rust も正しく丸めるので**ビットまで同一**で、
#   食い違えば整形の欠陥である。工学表記と 60 進の分岐を狙って値を選ぶ。
# - **B 往復ケース(`equivalence`)** — 任意の式に対し、
#   **トグルを 2 回押すと元の表示に戻る**。両側とも engine なので ulp の
#   揺れを受けず、任意の式を使える。
# - **C 落下ケース(`equivalence`)** — 60 進にできない値では `dms` を押しても
#   表示が動かない。通常表示を予測する参照実装を書かずに済ませるための形。

# 工学表記と 60 進の分岐を狙って手で選んだ値。**乱数では踏めない場所**である。
#
# 各要素は「打つ十進の文字列」。キー列は `_literal_keys` が組む。
DISPLAY_EDGE_LITERALS = (
    "1",  # 指数 0。`e0` を書かないことの確認
    "10",  # 指数 1。仮数 10
    "100",  # 指数 2。仮数 100
    "1000",  # 指数 3 ちょうど。`1e3`
    # **【訂正 2026-08-30】この 2 つに「繰り上がる」と書いてあったが、繰り上がらない。**
    # `999.9999999` は**既に有効数字 10 桁**なので 10 桁への丸めが恒等であり、
    # 参照実装に通すと `999.9999999` のまま。`999999999.9` も `999,999,999.9`
    # と表示される（`real_ref.format_real` で実測）。**註が主張していた境界を、
    # コーパスは 1 度も踏んでいなかった**——試験空間モデルが `display/edge`
    # を読めるようにして初めて出た（`corpus_science.display_edges`）。
    # **本物の繰り上がりは末尾の `DISPLAY_ROUNDING_CARRY_LITERAL` が踏む。**
    "999.9999999",  # 有効数字 10 桁。仮数が 9 で埋まる側の代表
    "999999999.9",  # 10 桁ちょうど。カンマを要する最大の桁数
    "0.5",  # 1 未満。`500e-3`。60 進では 0°30'00"
    "0.001",  # 指数 -3 ちょうど
    "0.0001234",  # 指数 -4。3 の倍数へ**下向き**に丸める側
    "0.0000001",  # 指数 -7 → `100e-9`
    "1234.5678",  # 指数 3、仮数に小数部が残る
    "123456789",  # 指数 8 → `123.456789e6`
    "0.999999999",  # 1 未満のまま 10 桁
    "1.000000001",  # 末尾だけが 1
    "12.34",  # 小さな端数
    "90",  # 60 進の代表(90°00'00")
    "1.5",  # 1°30'00"
    "0.0002777777",  # 1 秒に近い
    # --- 60 進の秒が丸めで 60 になり、分へ繰り上がる値 ---
    #
    # **手で探した。** 秒は「10 桁 − 度の桁数 − 4」桁に丸めてから 60 と
    # 比べる規則なので、繰り上がりが起きる窓は度の桁数によって変わる
    # (1 桁なら 59.999995 以上、3 桁なら 59.9995 以上)。乱数がこの窓に
    # 落ちる確率は 1e-5 程度で、**2000 件引いても踏めない。**
    #
    # 繰り上がりを止める変異を入れて測ったところ、最初の版はこの窓を
    # 1 件しか持っておらず、検出が乱数 1 回に懸かっていた。だから
    # **並びとして固定し、下の生成器が必ず全部を出す。**
    "0.016666666",  # 生の秒 59.9999976 → 0°1'0"
    "0.30000000",  # 生の秒 59.9999999 → 0°18'0"
    "3.766666666",  # 生の秒 59.9999976 → 3°46'0"
    "0.983333332",  # 生の秒 59.9999952 → 0°59'0"
    "12.58333332",  # 度が 2 桁、秒は 4 桁に丸める → 12°35'0"
    "89.13333332",  # 度が 2 桁 → 89°8'0"
    "123.01666657",  # 度が 3 桁、秒は 3 桁に丸める → 123°1'0"
    # **分も 60 になり、度へ繰り上がる。** 繰り上がりが 2 段続く唯一の形で、
    # 359°59'59.9996…" が 360°0'0" になる。
    "359.99999991",
)


def _literal_keys(text: str) -> tuple[str, ...]:
    """十進の文字列を、**打った通りのキー列**にする。"""
    return tuple("dot" if ch == "." else ch for ch in text)


def _display_literal(rng: random.Random) -> Typed:
    """整形ケースの値。**打った数そのもの**で、計算を挟まない。

    十進→f64 は Python(`float`)も Rust(`str::parse`)も正しく丸めるので、
    両側の f64 は**ビットまで同じ**である。だから厳密一致で比べてよい。
    """
    which = rng.randrange(5) + 1
    if which == 1:
        text = str(rng.randint(1, 999999))
        return Typed(_literal_keys(text), text)
    if which == 2:
        text = f"{rng.randint(0, 999)}.{rng.randint(1, 999999)}"
        return Typed(_literal_keys(text), text)
    if which == 3:
        # `000` キー。**先頭には置かない**(先頭ゼロの規則で潰れる)。
        head = rng.randint(1, 999)
        return Typed((*str(head), "zeros3"), f"{head}000")
    mantissa = rng.randint(1, 99)
    frac = rng.randint(0, 9)
    exponent = rng.randint(1, 20)
    if which == 4:
        return Typed(
            (*str(mantissa), "dot", str(frac), "exp", *str(exponent)),
            f"{mantissa}.{frac}e{exponent}",
        )
    # **指数入力の途中の `+/-` は指数の符号を変える。** 段階 G で
    # 「まだ検証していない」と書いた打ち方を、ここで実際に踏む
    # ——`84.9e1` に `neg` を打つと `84.9e-1` である。
    return Typed(
        (*str(mantissa), "dot", str(frac), "exp", *str(exponent), "neg"),
        f"{mantissa}.{frac}e-{exponent}",
    )


def _display_node(rng: random.Random, depth: int) -> Node:
    """往復ケースの木。**値は何でもよい**——両側とも engine で比べるので、
    計算誤差はそもそも比較に入らない。"""
    if depth <= 0 or rng.random() < 0.45:
        return _typed_leaf(rng)
    if rng.random() < 0.3:
        fn = rng.choice(UNARY_FNS)
        arg = _display_node(rng, depth - 1)
        if fn == "neg" and _is_exponent_entry(arg):
            arg = _typed_decimal(rng)
        return Un(fn, arg)
    return Bin(
        rng.choice(BINARY_OPS),
        _display_node(rng, depth - 1),
        _display_node(rng, depth - 1),
    )


def build_display_shard(seed: int, count: int) -> dict:
    """**表示のトグルのシャード。値ではなく表示文字列を比べる。**

    `eng` と `dms` はどちらも値を変えない。値だけを見ている限り、押しても
    押さなくても同じ答えになる——**押した効果を主張できるのは表示だけ**である。

    参照は `sexagesimal_ref.format_sexagesimal`(f64 のビットから `Fraction`)と
    `eng_ref.format_real_eng`(`Decimal` の厳密な十進値から指数を直に求める)。
    どちらも Rust の「一度 `{:.9e}` で整形してから読み直す」手順を写していない。

    ケースの内訳は上のコメントの A / B / C を見よ。
    """
    rng = random.Random(seed)
    entries: list[dict] = []
    seen: set[str] = set()

    # **手で選んだ値は、乱数に引かせず必ず全部出す。**
    #
    # 以前はこれらも `_display_literal` の 1 分岐として抽選しており、
    # `seen` の重複除去と合わせて 1 つの値は多くても 1 回しか出ず、
    # そのうえ eng と dms のどちらに回るかも乱数任せだった。結果として
    # 60 進の繰り上がりを踏むケースがシャード全体で 1 件しかなく、
    # **検出が乱数 1 回に懸かっていた**(検出力の測定で判明)。
    #
    # 並びを先頭に固定し、**1 つの値につき eng と dms を両方**作る。
    # 種を変えても、木の作り方を変えても、この 2n 件は動かない。
    for text in DISPLAY_EDGE_LITERALS:
        _append_display_pair(entries, text)
        seen.add(text)

    attempts = 0
    while len(entries) < count:
        attempts += 1
        if attempts > count * 200:
            raise RuntimeError(
                f"gave up after {attempts} attempts with {len(entries)}/{count} cases"
            )
        index = len(entries)
        # A を半分、B を 4 割、C は A のうち 60 進にできなかったものが回る。
        if rng.random() < 0.6:
            leaf = _display_literal(rng)
            expr = leaf.text
            if expr in seen:
                continue
            landed = float(expr)
            keys = to_key_sequence(leaf)
            if rng.random() < 0.5:
                entry = {
                    "kind": "display",
                    "id": f"disp-{index:06d}",
                    "mode": "Deg",
                    "keys": [*keys, "eng"],
                    "expr": f"{expr} を工学表記で",
                    "expect": {"main": eng_ref.format_real_eng(landed)},
                }
            else:
                shown = sexagesimal_ref.format_sexagesimal(landed)
                if shown is None:
                    # C: 60 進にできない値。engine は通常表示に落ちるので、
                    # 「押しても表示が変わらない」を同値として主張する。
                    entry = {
                        "kind": "equivalence",
                        "id": f"disp-{index:06d}",
                        "mode": "Deg",
                        "left": keys,
                        "right": [*keys, "dms"],
                        "expr": f"{expr} は 60 進にできないので表示が変わらない",
                    }
                else:
                    entry = {
                        "kind": "display",
                        "id": f"disp-{index:06d}",
                        "mode": "Deg",
                        "keys": [*keys, "dms"],
                        "expr": f"{expr} を 60 進で",
                        "expect": {"main": shown},
                    }
            seen.add(expr)
            entries.append(entry)
            continue

        # B: 往復。**任意の式でよい。**
        node = _display_node(rng, MAX_DEPTH - 1)
        if isinstance(node, Typed):
            continue
        try:
            if not _within_range(node):
                continue
            evaluate(node)
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        toggle = "eng" if rng.random() < 0.5 else "dms"
        keys = to_key_sequence(node)
        seen.add(expr)
        entries.append(
            {
                "kind": "equivalence",
                "id": f"disp-{index:06d}",
                "mode": "Deg",
                "left": keys,
                "right": [*keys, toggle, toggle],
                "expr": f"{expr} で {toggle} を 2 回押すと元の表示に戻る",
                # **木が在るケースだけ記録する**（裁定 1 の (c)）。リテラルを
                # 直に打つケース（A 群）は木を経由しないので、`levels` を持たない
                # ——**「無い」は「空」ではない**。表示の種別(`eng`/`dms`)は
                # **木の外で押す**ので観測のみの軸である。
                "levels": corpus_science.levels_as_json(
                    corpus_science.recorded_levels(node, "Deg")
                ),
            }
        )
    _append_rounding_carry(entries)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
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
        case = {
            "kind": "value",
            "id": f"rad-{len(entries):06d}",
            "mode": "Rad",
            "keys": ["angle_toggle", *to_key_sequence(node)],
            "expr": expr,
            "expect": {"re": float(value), "im": 0.0},
        }
        # **木を歩いて記録し、キーから読んだものと突き合わせる**（裁定 1 の (c)）。
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Rad"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
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
        # **形の名前を持ち歩く。** 索引で選んだあと捨てていた——
        # **生成器は形を知っているのに、ケースに書いていなかった**
        # （2026-08-30 のレビュー指摘）。`associativity` は同じものを
        # `stratum` に書いており、**試験空間モデルはそれを読んでいる。**
        chosen = rng.randrange(len(CANCELLATION_SHAPES))
        shape = corpus_science.CANCELLATION_SHAPES[chosen]
        node = CANCELLATION_SHAPES[chosen](rng)
        try:
            value = evaluate(node)
        except OutOfShard:
            continue
        expr = to_expr_text(node)
        if expr in seen:
            continue
        seen.add(expr)
        case = {
            "kind": "value",
            "id": f"canc-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": expr,
            "stratum": shape,
            "expect": {"re": float(value), "im": 0.0},
        }
        # **木を歩いて記録し、キーから読んだものと突き合わせる**（裁定 1 の (c)）。
        case["levels"] = corpus_science.levels_as_json(
            corpus_science.recorded_levels(node, "Deg", shape)
        )
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
    _append_mild_cancellation(entries)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "tolerance": CANCELLATION_TOLERANCE,
        "cases": entries,
    }


#: **桁がほとんど落ちない引き算**（試験空間モデルの Task 18）。
#:
#: **このシャードは対照を 1 件も持っていなかった。** 4 つの形はどれも
#: 「近い 2 数」を作るので、**近さの比は 2,000 件すべてが `1e-6` 未満**
#: （実測 2026-08-30: 最大 9.97e-7）。**§14.2 は「各帯に最低件数」と
#: 要求している**が、`mild` の帯は空だった。
#:
#: `(1000.5 - 1000.0)` の比は **5.00e-4** で、シャードが宣言している
#: 相対許容 `1e-6` の**上**にある——**桁落ちが起きていないことの証拠**として
#: 置く。**乱択では出ない**（`_near_subtraction` は差を 1/1000 未満に作る）。
#:
#: **★ これは「最も清潔な対照」であって「代表」ではない。**
#: `1000.5` も `1000.0` も**二進で厳密に表せ、差 `0.5` も厳密**なので、
#: **丸めが一切関与しない。** **「桁が少しだけ落ちる引き算」の代表を置きたい
#: なら、丸めが効く値を選ぶことになる**——**この 1 件はそれではない。**
#: **帯が空だったことを埋める最小の 1 件**である。
#: **2 件置く。片方は丸めが関与せず、片方は関与する。**
#:
#: - `(1000.5 - 1000.0)`: **両辺も差も二進で厳密**。**最も清潔な対照**で、
#:   **桁落ちが起きていないことだけ**を言う
#: - `(1000.1 - 1000.0)`: **`1000.1` は二進で厳密でない**。参照実装は
#:   `0.1000000000000000000000000000000000000000000000000027` を返す
#:   ——**丸めが値に出ている。「桁が少しだけ落ちる引き算」の代表**である
#:
#: **片方だけにしない。** 清潔な対照は「丸めが無いときの姿」を、
#: もう 1 件は「丸めが在るときの姿」を言う——**どちらも確かめたい対象**である。
CANCELLATION_MILD_OPERANDS = (("1000.5", "1000.0"), ("1000.1", "1000.0"))


def _append_mild_cancellation(entries: list[dict]) -> None:
    """**乱択のループの後ろに足す。draw の列に触らない**（Task 8 と同じ形）。"""
    for left, right in CANCELLATION_MILD_OPERANDS:
        node = Bin("-", _typed(left), _typed(right))
        value = evaluate(node)
        case = {
            "kind": "value",
            "id": f"canc-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": to_expr_text(node),
            "stratum": "near_subtraction",
            "expect": {"re": float(value), "im": 0.0},
        }
        case["levels"] = corpus_science.levels_as_json(
            corpus_science.recorded_levels(node, "Deg", "near_subtraction")
        )
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)


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
        case = {
            "kind": "value",
            "id": f"comb-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": expr,
            "expect": {"re": landed, "im": 0.0},
        }
        # **木を歩いて記録し、キーから読んだものと突き合わせる**（裁定 1 の (c)）。
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)
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
    shard = build_family_shard(seed, count, "itrig", INVERSE_TRIG_FNS, BINARY_OPS)
    _append_rad_boundaries(shard["cases"])
    _append_domain_boundaries(shard["cases"])
    return shard


#: **Rad の逆三角の名指し境界**（試験空間モデル `scientific-v1` の Task 8）。
#:
#: **§14.2 は「関数種別 × 角度モード × 境界帯」を要求している**が、
#: **`Rad × 逆三角` はコーパス 18 枚のどこにも 1 件も無かった**（2026-08-30 実測）
#: ——`angle-mode` の生成器は `("sin","cos","tan")` しか通さず、この系統は
#: `build_family_shard` が `Deg` を焼き付けている。**構造的な穴だった。**
#:
#: **引数は 0 にする。** `asin` / `acos` は `[-1, 1]` の外で `DomainError` に
#: なる（`docs/numerical-policy.md` の「関数の定義域」）ので、**3 つとも
#: 定義域の中に在る値**を選ぶ。答は `asin(0)=0` / `acos(0)=π/2` / `atan(0)=0`。
RAD_INVERSE_TRIG_ARGUMENT = 0


def _append_rad_boundaries(entries: list[dict]) -> None:
    """**乱択のループが終わったあとに足す。draw の列に触らない。**

    **これが道の選択そのものである**（計画の Task 8 Step 1）。ループの中で
    分岐すると**乱数の並びが動き、2000 件の中身が全部変わる**——挙動は
    変わらないのに**差分が 2000 件になり、次に読む人が何が変わったか追えない。**
    このプロジェクトは**golden の差分を人が読んで判断している。**

    `DISPLAY_EDGE_LITERALS` が「並びを先頭に固定し、種を変えても動かない」と
    しているのと**同型**で、こちらは末尾に置く。
    """
    for fn in INVERSE_TRIG_FNS:
        node = Un(fn, Num(RAD_INVERSE_TRIG_ARGUMENT))
        value = evaluate(node, "Rad")
        case = {
            "kind": "value",
            "id": f"itrig-{len(entries):06d}",
            "mode": "Rad",
            # **先頭で押す。** 押さなければ engine は既定の Deg で評価する。
            "keys": ["angle_toggle", *to_key_sequence(node)],
            "expr": to_expr_text(node),
            "expect": {"re": float(value), "im": 0.0},
        }
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Rad"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)


#: **`asin` / `acos` の定義域の境目**（`docs/numerical-policy.md` の
#: 「関数の定義域」の表が `−1 ≤ x ≤ 1` と書いている）。
#:
#: **`atan(1)` は在ったが、`asin(1)` も `acos(1)` も 1 件も無かった**
#: （2026-08-30 実測）。**1-way では帯が `atan` 1 つで埋まるので、
#: 表が名指しする境目を誰も踏んでいないことが見えなかった**——
#: **だから `band × function` を選択ペアに入れた**（`SELECTED_PAIRS`）。
INVERSE_TRIG_BOUNDARY_FNS = ("asin", "acos")
INVERSE_TRIG_BOUNDARY_ARGUMENT = 1


def _append_domain_boundaries(entries: list[dict]) -> None:
    """**`asin(1)` と `acos(1)`。** `_append_rad_boundaries` と同じく末尾に足す。

    **`atan` は足さない。** `atan(1)` は既にコーパスに在り、**足せば
    「境界を踏んだ件数」が増えるだけで、空だったセルは 1 つも埋まらない。**
    """
    for fn in INVERSE_TRIG_BOUNDARY_FNS:
        node = Un(fn, Num(INVERSE_TRIG_BOUNDARY_ARGUMENT))
        value = evaluate(node)
        case = {
            "kind": "value",
            "id": f"itrig-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": to_expr_text(node),
            "expect": {"re": float(value), "im": 0.0},
        }
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)


#: **`ln` / `log10` / `1/x` の定義域の境目は `0` である**（同じ表）。
#:
#: **`eˣ` を使うのは、そこだけが `0` と負を通せるから**である——
#: `ln(0)` は `DomainError`、`1/0` は `DivisionByZero` で、**どちらも値を
#: 返さないので値シャードには入らない**（`errors-000.json` が持っている）。
#: **`eˣ` は全実数が定義域**なので、`e^0 = 1` と `e^-5 ≈ 0.0067` が値になる。
#:
#: **負のリテラルは `neg` を後ろに付けて打つ。** `Num` は非負整数なので
#: （`corpus_expr.Num`）、**それ以外に負の葉を書く方法が無い。**
ELEMENTARY_BOUNDARY_ARGUMENTS = (0, -5)


def _append_elementary_boundaries(entries: list[dict]) -> None:
    """**`e^0` と `e^-5`。** 定義域の帯の `zero` と `negative` を埋める。

    **乱択では出ない。** `ELEMENTARY_FNS` と `ELEMENTARY_BINS`（`^` だけ）には
    **負を作れる演算子が 1 つも無く**、`Num` は非負整数である。
    **`0` は作れるが、`ln(0)` も `1/0` もエラーで捨てられる**——実測の棄却は
    `domain 36` / `division_by_zero 4`（2026-08-30 の走行）。
    """
    for argument in ELEMENTARY_BOUNDARY_ARGUMENTS:
        leaf = Num(argument) if argument >= 0 else Un("neg", Num(-argument))
        node = Un("exp_e", leaf)
        value = evaluate(node)
        case = {
            "kind": "value",
            "id": f"elem-{len(entries):06d}",
            "mode": "Deg",
            "keys": to_key_sequence(node),
            "expr": to_expr_text(node),
            "expect": {"re": float(value), "im": 0.0},
        }
        case["levels"] = corpus_science.levels_as_json(corpus_science.recorded_levels(node, "Deg"))
        corpus_science.assert_record_matches_observation(case, node)
        entries.append(case)


#: **10 桁に丸めると指数が 1 つ上がる値**（試験空間モデルの Task 17）。
#:
#: `9999999999.5` は有効数字 11 桁。10 桁に丸めると `1e10` になり、
#: **指数が 9 から 10 へ上がる**——`docs/numerical-policy.md` が
#: 「`|x| >= 1e10` で指数表記」と書いている閾値をまたぐ。
#: 実測（`real_ref.format_real`）: `"1e10"`。
#:
#: **`DISPLAY_EDGE_LITERALS` の末尾ではなく、シャードの末尾に足す。**
#: あの一覧は**先頭に固定**されており、そこへ 1 つ足すと**後続 1,900 件余りの
#: `id` がずれる**——**このプロジェクトは golden の差分を人が読んで判断して
#: いる**（Task 8 で選んだ道と同じ理由）。
DISPLAY_ROUNDING_CARRY_LITERAL = "9999999999.5"


def _append_display_pair(entries: list[dict], text: str) -> None:
    """**1 つの十進リテラルを、`eng` と `dms` の 2 件にする。**

    **60 進にできない値がある**——度の桁数が多いと「10 桁 − 度 − 4」が
    負になり、`format_sexagesimal` は `None` を返す（S-4 設計書 §3、裁定 6）。
    そのときは**同値のケース**にする——「表示が変わらない」という主張である。

    **【2026-08-30】この関数はループの中身を括り出したものである。**
    Task 17 で末尾に 1 件足すとき、**私はこのループを写した。写しは
    `None` の分岐を落としていて、`expect.main` が `null` のケースを
    書き出した**——**分岐が 1 つ足りない写しは、動くように見えて嘘を書く。**
    **括り出せば、写しは 1 つも要らなかった。**
    """
    landed = float(text)
    keys = to_key_sequence(Typed(_literal_keys(text), text))
    entries.append(
        {
            "kind": "display",
            "id": f"disp-{len(entries):06d}",
            "mode": "Deg",
            "keys": [*keys, "eng"],
            "expr": f"{text} を工学表記で",
            "expect": {"main": eng_ref.format_real_eng(landed)},
        }
    )
    shown = sexagesimal_ref.format_sexagesimal(landed)
    entries.append(
        {
            "kind": "display",
            "id": f"disp-{len(entries):06d}",
            "mode": "Deg",
            "keys": [*keys, "dms"],
            "expr": f"{text} を 60 進で",
            "expect": {"main": shown},
        }
        if shown is not None
        else {
            "kind": "equivalence",
            "id": f"disp-{len(entries):06d}",
            "mode": "Deg",
            "left": keys,
            "right": [*keys, "dms"],
            "expr": f"{text} は 60 進にできないので表示が変わらない",
        }
    )


def _append_rounding_carry(entries: list[dict]) -> None:
    """**丸めで指数が上がる 1 件を、一覧の他の値と同じ手で足す。**"""
    _append_display_pair(entries, DISPLAY_ROUNDING_CARRY_LITERAL)


def write(name: str, payload: dict) -> None:
    """1 枚を書き出す。**書き出す先を差し替えられる純粋な出口にしておく。**

    `test_corpus_reproducibility.py` はこの関数を捕獲用の関数に差し替えて
    `main()` を呼び、ディスクに触れずに「生成器が今日書くはずのもの」を
    受け取る。だからここに件数の累計のような状態を持たせてはならない
    ——差し替えた瞬間にその状態が更新されなくなる。総件数は `main` が
    payload から数える。
    """
    path = CORPUS / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # generate.py と同じ整形。差分を安定させ、nan / inf を書き出さない。
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def _summary_line(total_cases: int, elapsed: float) -> str:
    """末尾の要約 1 行。**分母は CLI 引数の `count` ではなく、実際に書き出した総件数**。

    生成時間はコーパスの上限を決める(設計書 §11)ので必ず表に出す。ただし
    以前のこの行は 15 シャード合計の経過時間を `count`(既定 2000)で割って
    いた。finance だけ `FINANCE_COUNT`(3,500)を渡すようになった時点で、
    件数もケースあたりの時間も嘘になった——他の 14 枚に `count` を渡す限り
    総件数は `14 * count + FINANCE_COUNT` であって `count` ではない。
    実測では合計 5629.60ms のうち finance 単独が 3500 件で 1932.53ms
    (34%)を占めており、ずれは無視できる大きさではない。

    ここは道具が印字する一次資料で、他所の台帳に事実として写される。
    合わない分母を置かない。

    `%.1f` 秒だと数千件までは `0.0s` に丸まって無意味になる(レビュー修正
    ラウンド 1)ので、ミリ秒で出す。
    """
    return (
        f"generated {total_cases} cases in {elapsed * 1000:.2f}ms "
        f"({elapsed / total_cases * 1000:.4f}ms each)"
    )


# finance シャードだけの目標総件数(設計書 §4.7)。他の 14 シャードは CLI 引数
# `count`(既定 2000)を共有するが、finance は名指し層の下限合計(1,307 件)を
# 大きく超える件数が要る。ここを `count` に連動させると、他の 14 枚を増やす
# つもりの変更が finance の golden も一緒に動かしてしまう。
FINANCE_COUNT = 3500


def _shards(count: int) -> Iterator[tuple[str, dict]]:
    """書き出す 18 枚を、名前と中身の対で 1 枚ずつ生む。

    **書き出す枚数はここが唯一の一覧である。** 1 枚足せば、書き出しにも
    末尾の要約行の分母にも自動でついてくる——`main` の側に写しの件数を
    持たせない理由がこれで、以前は `count` という写しを分母にしていて
    finance だけ件数が変わった時点で嘘になった。

    遅延生成にしてあるので、`main` は 1 枚組み立てては 1 枚書く。18 枚
    ぶんの payload を同時に抱えない。
    """
    yield "scientific-000.json", build_shard(seed=20260815, count=count)
    yield "equivalence-000.json", build_equivalences(seed=20260816, count=count)
    yield "precedence-000.json", build_precedence_shard(seed=20260817, count=count)
    # 結合方向。**平坦なキー列とその全括弧の双子を対で持つ**ので、`count` を
    # 渡すと半分が対照群になる(計画 Task 4、設計書 §6)。
    yield "associativity-000.json", build_assoc_shard(seed=20260828, count=count)
    yield "elementary-000.json", build_elementary_shard(seed=20260818, count=count)
    yield "inverse-trig-000.json", build_inverse_trig_shard(seed=20260819, count=count)
    yield "typed-000.json", build_typed_shard(seed=20260824, count=count)
    yield "display-000.json", build_display_shard(seed=20260827, count=count)
    yield "complex-000.json", build_complex_shard(seed=20260901, count=count)
    yield "complex-display-000.json", build_complex_display_shard(seed=20260902, count=count)
    yield "angle-mode-000.json", build_angle_mode_shard(seed=20260826, count=count)
    yield "corrections-000.json", build_corrections_shard(seed=20260825, count=count)
    yield "cancellation-000.json", build_cancellation_shard(seed=20260823, count=count)
    yield "combinatorics-000.json", build_combinatorics_shard(seed=20260820, count=count)
    # 金融とデータスケール。**科学計算とは別の領域**で、期待値は整数なので
    # 厳密一致で比べる(設計書 2026-08-17 §3.2)。finance だけ `count` を使わず
    # `FINANCE_COUNT`(3,500)を渡す。理由は上の定義を見よ。
    yield "finance-000.json", build_finance_shard(seed=20260821, count=FINANCE_COUNT)
    yield "data-scale-000.json", build_data_scale_shard(seed=20260822, count=count)
    # 入力途中の表示。**乱択も `count` も持たない**——engine_table.rs /
    # state.rs から起こした固定の列挙であって、サンプリングする集合では
    # ないので、他の 15 枚と違って seed を渡さない(設計書 §4.1)。
    yield "entry-000.json", build_entry_shard()
    # エラー種別。**乱択も `count` も持たない**——設計書 §5.1 の 9 経路を
    # 数学の定義域・値域から 1 つずつ書き写した固定の列挙(計画 Task 2)。
    yield "errors-000.json", build_errors_shard()
    # **組合せの誤入力を体系的に確かめる 1 枚**（2026-08-30 のユーザー裁定）。
    # **表を埋めるためではない**——理由は `corpus_combinatorics` の docstring。
    yield "combinatorics-display-000.json", corpus_combinatorics.build_shard()


#: 科学計算の試験空間モデルが数える 9 領域（設計書 §14.2）。
#: **裁定 2 の B**——9 領域を横断して数え、**外の 8 枚は数えない**。
SCIENCE_SHARDS = (
    "elementary-000.json",
    "inverse-trig-000.json",
    "angle-mode-000.json",
    "precedence-000.json",
    "associativity-000.json",
    "cancellation-000.json",
    "combinatorics-000.json",
    "display-000.json",
    "complex-000.json",
    "complex-display-000.json",
    # **9 領域の 11 枚目。** `combinatorics` 領域は `complex` と同じく 2 枚組で、
    # **値のシャードと表示（誤入力）のシャード**を持つ。
    "combinatorics-display-000.json",
)


def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    started = time.monotonic()
    total_cases = 0
    # **横断して数えるので、全部作ってから書く。** 1 枚ずつ書き出すと、
    # 9 領域を跨ぐ被覆を数えられない（設計書 §14.2 の要求は
    # `angle-mode` の Rad と他 3 枚の Deg にまたがっている）。
    built = [(name, payload) for name, payload in _shards(count)]
    # **棄却の数も渡す。** シャードごとに `rejections` を持っているものを
    # 理由ごとに足し合わせる——**「候補を作って捨てた回数」であって、要求セルの
    # 除外ではない**（設計書 §10.3）。**`{}` を載せると「棄却が無い」と読まれる**
    # ——実物は 25,165 件ある（2026-08-30 のレビュー指摘）。
    science_rejections: dict[str, int] = {}
    for name, payload in built:
        if name not in SCIENCE_SHARDS:
            continue
        for reason, count in (payload.get("rejections") or {}).items():
            science_rejections[reason] = science_rejections.get(reason, 0) + count
    science = corpus_science.build_science_coverage(
        {name: payload["cases"] for name, payload in built if name in SCIENCE_SHARDS},
        science_rejections,
    )
    for name, payload in built:
        total_cases += len(payload["cases"])
        if name in SCIENCE_SHARDS:
            # **11 枚すべてに同じブロックを載せる**（裁定 5）。任意の 1 枚を
            # 選ぶ恣意性を避け、**どれを開いても同じ会計が読める**。
            # `cases` の前に置く（金融と同じ並び）。
            payload = {
                **{k: v for k, v in payload.items() if k != "cases"},
                "coverage": science,
                "cases": payload["cases"],
            }
        write(name, payload)
    elapsed = time.monotonic() - started
    print(_summary_line(total_cases, elapsed))


if __name__ == "__main__":
    main()
