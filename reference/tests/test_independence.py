"""`独立:` の規律の番人（設計書 `2026-09-24-independence-scope-design.md` §3.3）。

**この番人が見るのは 2 つだけである**:

1. **範囲の表（`independence.py` の `SCOPE`）が、`reference/` の `.py` を 1 つ残らず
   分類しているか**（両向き——**表に無いファイルも、ディスクに無い表の行も赤**）。
2. **`expects` のファイルに、`独立:` の行が在り、綴りが 4 語のどれかであるか。**

**見ないもの——ここが肝心である。**

**中身が正しいかは見ない。** 本当に別手順か、本当に不可能かは、**読む人にしか分からない**
（`CLAUDE.md`「これは機械では検出できない」）。**「4 語のどれかであること」と
「その語が中身と合っていること」は別である**——**この番人が緑でも、宣言が嘘である
可能性は 1 ミリも減らない。** 減るのは「**宣言が無いまま気づかれない**」ことだけである。
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from calcarc_reference.independence import ROLES, SCOPE, WORDS

REFERENCE = pathlib.Path(__file__).resolve().parents[1]


#: 範囲から外すもの。**外した理由をここに書く**（外したこと自体が判断である）。
#:
#: - `tests/` —— **番人であって期待値ではない。**
#: - `.venv/` —— 他人のコード。
#: - `__init__.py` —— 再輸出だけで、式を持たない。
def _in_scope_files() -> list[str]:
    out = []
    for path in sorted(REFERENCE.rglob("*.py")):
        rel = path.relative_to(REFERENCE).as_posix()
        if rel.startswith(("tests/", ".venv/")) or path.name == "__init__.py":
            continue
        out.append(rel)
    return out


def _declarations(path: pathlib.Path) -> tuple[str | None, dict[str, str]]:
    """(モジュールの宣言, 公開関数名 → その関数の宣言)。無ければ None / 欠落。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))

    def line_of(doc: str | None) -> str | None:
        if doc is None:
            return None
        for raw in doc.splitlines():
            if "独立:" in raw:
                return raw.split("独立:", 1)[1].strip()
        return None

    functions = {
        node.name: line_of(ast.get_docstring(node))
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
    }
    return line_of(ast.get_docstring(tree)), {
        name: text for name, text in functions.items() if text is not None
    }


def _word_of(text: str) -> str | None:
    for word in WORDS:
        if text.startswith(word):
            return word
    return None


def test_the_table_and_the_disk_agree_both_ways():
    """**範囲そのものの番人。** 新しいファイルを足した日に、分類を強制する。"""
    on_disk = set(_in_scope_files())
    in_table = set(SCOPE)
    assert on_disk - in_table == set(), (
        "範囲の表に無いファイルが在る(`independence.py` の SCOPE に足して、"
        "expects / builds / tools のどれかと理由を書く)"
    )
    assert in_table - on_disk == set(), (
        "範囲の表に在るファイルがディスクに無い(消したなら表からも消す。"
        "残すと範囲が静かに広いままになる)"
    )


@pytest.mark.parametrize("rel", sorted(SCOPE))
def test_every_row_has_a_known_role_and_a_reason(rel):
    role, why = SCOPE[rel]
    assert role in ROLES, f"{rel}: 知らない役割 {role!r}"
    assert why.strip(), f"{rel}: 理由が空（「要らない」と決めたことの記録が要る）"


@pytest.mark.parametrize("rel", sorted(r for r, (role, _) in SCOPE.items() if role == "expects"))
def test_every_expecting_file_declares_its_independence(rel):
    """**`expects` は宣言を持つ。** モジュール 1 行か、公開関数すべてか。"""
    path = REFERENCE / rel
    module, functions = _declarations(path)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    public = [
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
    ]

    for name, text in functions.items():
        assert _word_of(text) is not None, (
            f"{rel}:{name} の `独立:` が 4 語で始まっていない: {text[:40]!r}"
        )
    if module is not None:
        assert _word_of(module) is not None, (
            f"{rel} のモジュールの `独立:` が 4 語で始まっていない: {module[:40]!r}"
        )
        return

    missing = [name for name in public if name not in functions]
    assert missing == [], (
        f"{rel}: モジュールに `独立:` が無いので、公開関数すべてに要る。無いのは {missing}"
    )


def test_prints_what_it_counted():
    """**数と、その数が何を数えたものかを印字する。**

    **「モジュール 1 行で済ませたファイル」は名前と公開関数の数を出す**
    ——**1 行で何関数を塗ったのかが、読む人の目に入るように。**
    """
    expects = [rel for rel, (role, _) in SCOPE.items() if role == "expects"]
    by_module, by_function, painted = 0, 0, []
    for rel in expects:
        path = REFERENCE / rel
        module, functions = _declarations(path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        public = sum(
            1
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
        )
        if module is not None:
            by_module += 1
            painted.append((rel, public, len(functions)))
        by_function += len(functions)

    print(
        f"独立の宣言: 範囲 {len(SCOPE)} ファイル"
        f"（expects {len(expects)} / builds "
        f"{sum(1 for _, (r, _) in SCOPE.items() if r == 'builds')} / tools "
        f"{sum(1 for _, (r, _) in SCOPE.items() if r == 'tools')}）。"
        f"モジュール宣言 {by_module} 本・関数宣言 {by_function} 本。"
        "**数えたのは宣言の在り処であって、宣言が正しいかではない。**"
    )
    for rel, public, exceptions in painted:
        print(f"  モジュール 1 行: {rel}（公開関数 {public}、うち関数側で上書き {exceptions}）")
    # **印字は `-s` で読む。** ここで assert するのは**数の形**である
    # ——「`expects` が 1 つも無い」「宣言が 1 本も無い」走行は、
    # **何も数えていないのに緑**になる（[[tests-can-assert-nothing]] の形）。
    assert len(expects) >= 15, "expects が痩せている（範囲の表を確かめる）"
    assert by_module + by_function >= len(expects), (
        "宣言の総数が expects の数より少ない（どれかが宣言を持っていない）"
    )
