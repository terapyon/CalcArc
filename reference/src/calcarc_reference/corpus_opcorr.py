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

    `override`(訂正前の読み)は外側の鎖の位置にしか掛からない——
    括弧の中はすでに確定した読みなので、中には伝えない。
    """

    terms: Chain
    ops: tuple[str, ...]


Term = int | Group
Chain = tuple[Term, ...]


def build_tree(
    terms: Chain,
    ops: tuple[str, ...],
    override: dict[int, str] | None = None,
) -> Node:
    """平坦な鎖(`terms`・`ops`)を、公開の優先順位で `Num`/`Bin` の木に組む。

    独立: 別手順(公開の表からの優先順位の登り。エンジンの演算子スタックの
    畳み込みとは別)。

    `override` は「位置 i (`ops[i]`)の演算子を、この演算子の段と結合の
    向きで読む」という指定(R2 の「訂正前の読み」)。組む `Bin` の演算子は
    常に `ops[i]`(実際に確定した演算子)のままで、`override` は優先順位の
    判断にのみ使う——押した演算子は変わらず、読み方だけが変わる。
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
    override: dict[int, str],
) -> tuple[Node, int]:
    """再帰の precedence climbing。`pos` から読み始め、`min_level` 未満の
    演算子に出会ったら止まる。返り値は組んだ部分木と、次に読む位置。
    """
    left = _term_to_node(terms[pos])
    pos += 1
    while pos - 1 < len(ops):
        i = pos - 1
        read_as = override.get(i, ops[i])
        if read_as not in LEVEL:
            raise ValueError(f"unknown binary op: {read_as!r}")
        level = LEVEL[read_as]
        if level < min_level:
            break
        next_min = level if read_as in RIGHT_ASSOCIATIVE else level + 1
        right, pos = _climb(terms, ops, pos, next_min, override)
        left = Bin(ops[i], left, right)
    return left, pos


def _term_to_node(term: Term) -> Node:
    if isinstance(term, Group):
        return build_tree(term.terms, term.ops)
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
