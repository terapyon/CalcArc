"""公開の優先順位で、平坦な鎖(項と演算子)を式木に組む(設計書 §3.2、R1)。

**ここは `Num`/`Bin` の木を作るだけで、計算はしない。** 値を出すのは
`corpus_eval.evaluate()` である。

読むのは `docs/base-spec.md`:333-343 の公開の約束だけ——
`+ −` < `× ÷` < `nPr nCr` < `xʸ`、`xʸ` だけが右結合——であって、
`crates/calcarc-core/src/engine/` は読まない。組み方は公開の表からの
優先順位の登り(再帰の precedence climbing)であり、エンジンの演算子
スタックの畳み込みとは手順そのものが別である。
"""

from __future__ import annotations

from dataclasses import dataclass

from .corpus_expr import BINARY_KEYS, DIGIT_KEYS, Bin, Node, Num

# **公開の表そのもの**(docs/base-spec.md:333-343)。段が低いほど先に読む。
LEVEL: dict[str, int] = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "nPr": 3,
    "nCr": 3,
    "^": 4,
}

# **右結合は `xʸ` だけ**(docs/base-spec.md:333)。ほかは左結合。
RIGHT_ASSOCIATIVE: frozenset[str] = frozenset({"^"})


@dataclass(frozen=True)
class Group:
    """括弧の中の鎖。項として現れると、その中身だけで独立に木を組む。

    `override` は、この `Group` が外側の鎖のどの項の位置に立っていたかで
    絞り込んだ**部分パス**が渡ってくる——中の演算子への訂正前の読みも
    表せる(`build_tree` の docstring の「パス」を参照)。
    """

    terms: Chain
    ops: tuple[str, ...]


Term = int | Group
Chain = tuple[Term, ...]

# `override` のキー。**パス**——外側から内側へ、降りていく `Group` の
# 「項の位置」を並べ、最後に「その鎖の中の演算子の位置」を置く。
# トップレベルの演算子 i は `(i,)`(降りる項が 0 個、演算子の位置だけ)。
OverridePath = tuple[int, ...]


def build_tree(
    terms: Chain,
    ops: tuple[str, ...],
    override: dict[OverridePath, str] | None = None,
) -> Node:
    """平坦な鎖(`terms`・`ops`)を、公開の優先順位で `Num`/`Bin` の木に組む。

    独立: 別手順(公開の表からの優先順位の登り。エンジンの演算子スタックの
    畳み込みとは別)。

    `override` はキーが**パス**(`OverridePath` = `tuple[int, ...]`)の辞書。
    パスは「どの `Group` の項へ降りるか」を項の位置(`terms` の添字)で
    先頭から並べ、最後の要素だけ「その鎖(降りた先、またはトップレベル)の
    中で `ops` の何番目の演算子か」を指す。トップレベルの演算子 i は
    `(i,)`(降りる項が 0 個)。値は「その位置の演算子を、この演算子の段と
    結合の向きで読む」という指定(R2 の「訂正前の読み」)。組む `Bin` の
    演算子は常に実際の演算子(その鎖の `ops[i]`)のままで、`override` は
    優先順位の判断にのみ使う——押した演算子は変わらず、読み方だけが変わる。

    例: `override={(1, 0): "*"}` は「トップレベルの項 1 の `Group` へ降り、
    その中の演算子 0 を、`*` の段・結合で読む」。
    """
    if len(terms) != len(ops) + 1:
        raise ValueError("terms must have exactly one more element than ops")
    resolved_override = override or {}
    node, pos = _climb(terms, ops, 0, 1, resolved_override)
    if pos != len(terms):
        raise ValueError("did not consume the whole chain")
    return node


def _climb(
    terms: Chain,
    ops: tuple[str, ...],
    pos: int,
    min_level: int,
    override: dict[OverridePath, str],
) -> tuple[Node, int]:
    """再帰の precedence climbing。`pos` から読み始め、`min_level` 未満の
    演算子に出会ったら止まる。返り値は組んだ部分木と、次に読む位置。
    """
    left = _term_to_node(terms[pos], pos, override)
    pos += 1
    while pos - 1 < len(ops):
        i = pos - 1
        read_as = override.get((i,), ops[i])
        if read_as not in LEVEL:
            raise ValueError(f"unknown binary op: {read_as!r}")
        level = LEVEL[read_as]
        if level < min_level:
            break
        next_min = level if read_as in RIGHT_ASSOCIATIVE else level + 1
        right, pos = _climb(terms, ops, pos, next_min, override)
        left = Bin(ops[i], left, right)
    return left, pos


def _term_to_node(
    term: Term,
    term_index: int,
    override: dict[OverridePath, str],
) -> Node:
    if isinstance(term, Group):
        # **降りる**: この `Group` が立っている項の位置(`term_index`)で
        # 始まる、長さ 2 以上のパスだけを、先頭を落として引き継ぐ。
        # 先頭要素が `term_index` と違うものや、長さ 1(このトップレベルの
        # 演算子そのもの)は、この `Group` の中には関係が無いので落とす。
        sub_override = {
            path[1:]: read_as
            for path, read_as in override.items()
            if len(path) > 1 and path[0] == term_index
        }
        return build_tree(term.terms, term.ops, sub_override)
    return Num(term)


def chain_keys(terms: Chain, ops: tuple[str, ...]) -> list[str]:
    """平坦な鎖をキー列にする。括弧は `Group` の場所だけに付く。

    独立: 別手順(公開のキー表(`BINARY_KEYS`)からの直列化。エンジンの
    押下ログの再生とは別)。
    """
    if len(terms) != len(ops) + 1:
        raise ValueError("terms must have exactly one more element than ops")
    keys = _term_keys(terms[0])
    for op, term in zip(ops, terms[1:], strict=True):
        if op not in BINARY_KEYS:
            raise ValueError(f"unknown binary op: {op!r}")
        keys.append(BINARY_KEYS[op])
        keys.extend(_term_keys(term))
    return keys


def _term_keys(term: Term) -> list[str]:
    if isinstance(term, Group):
        return ["lparen", *chain_keys(term.terms, term.ops), "rparen"]
    return [DIGIT_KEYS[int(digit)] for digit in str(term)]
