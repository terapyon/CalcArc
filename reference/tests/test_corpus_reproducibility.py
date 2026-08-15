"""`corpus/generated/*.json` が生成器の出力とバイト単位で一致することを確かめる。

`.github/workflows/ci.yml` の `reference` ジョブが `testdata/`(golden)に対して
持っている「`generate.py` を回してから `git diff --exit-code testdata/` する」
という再生成一致ゲートと同じ役割を、コミット済みの重量級コーパスに対しても
持たせる。敵対者レビューは、コミット済み JSON の `expect.re` と `tolerance` を
手で書き換えてもスイートが緑のままであることを実証した——このテストはその穴を塞ぐ。

`generate_corpus.py` の docstring は以前「呼ぶと毎 PR の再生成一致チェックが
数万件を背負う」ことを、ゲートを外した理由として挙げていた。実測
(`docs/corpus-measurements.md`)では 4000 件(値 2000 + 同値 2000)の生成が
0.3 秒未満であり、この理由は現在の規模には当てはまらない。

**ファイル名を直書きせず、ディレクトリを列挙する。** 以前この場所は
`scientific-000.json` と `equivalence-000.json` の 2 つを名指しで読んでいた。
そのため **`corpus/generated/` に置いた新しいファイルはゲートを素通りした**——
実測(2026-08-15 の検証ラウンド)では、手書きの `scientific-001.json`(500 件、
`expect` は手で書いた値)を置くと `pnpm heavy` は 44 passed、報告書の見出しは
「二経路で照合したケース(値): 2500」に増え、`reference` のフルスイートは 84 passed で
無反応だった。**Python が独立に出した期待値でないものが、その顔をして混ざれる。**
いまはディスク上のファイル名の集合が、生成器が書く名前の集合と**完全に一致する**
ことを先に確かめる——余分なファイルがあれば赤、足りなくても赤。

**`corpus/contributed/` はこの規則の対象外である。** 人が手で書くファイルなので、
生成器の出力とバイト単位で一致するとは限らない——というより一致しないのが前提。
このテストは `corpus/generated/` だけを対象にする。いまは `contributed/` という
ディレクトリ自体が存在しないが、将来それが増えても、このテストの対象に含めては
ならない(段階 5 の投稿受け口が別の検証を持つ。設計書 §7.3・§7.4)。

**期待される名前と中身は `main()` 自身から取る。** 名前をこのテストに写して
持つと、生成器が書く名前を増やしたときに写しの方を直し忘れる——そのとき増えた
ファイルは「生成器が書くもの」として通り、検証されないまま緑になる。`write()` を
差し替えて `main()` を呼び、ディスクに一切書かずに「生成器が今日書くはずのもの」を
そのまま受け取る。

`main()` は呼ばない(呼ぶとファイルへの書き込みが発生する)。`build_shard` /
`build_equivalences` をメモリ上で直接呼び、`write()` と同じ整形
(`json.dumps(..., indent=2, sort_keys=True, allow_nan=False) + "\n"`)を自分で
組み立ててから、コミット済みファイルの生バイト列と文字列比較する。オブジェクト
としての等価性(`==`)だけを見ると、キーの並び順やインデント幅の崩れ——整形が
`write()` と食い違っているのに値だけは一致している、という壊れ方——を見逃す。
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pytest

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_corpus.py"
_SPEC = importlib.util.spec_from_file_location("generate_corpus", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
generate_corpus = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_corpus"] = generate_corpus
_SPEC.loader.exec_module(generate_corpus)

CORPUS = generate_corpus.CORPUS


def _rendered(payload: dict) -> str:
    """`generate_corpus.write()` と同じ整形。差分をここだけ見れば揃えられる。"""
    return json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n"


@pytest.fixture(scope="module")
def fresh() -> dict[str, str]:
    """生成器が**今日書くはずのもの**を、ディスクに触れずに丸ごと取る。

    `write()` を差し替えて `main()` を呼ぶ。こうするとファイル名も種も件数も
    生成器の側にひとつだけ存在し、テストが写しを持たない。`main()` は
    `sys.argv[1]` を件数として読むので、pytest の引数を拾わないよう置き換える。
    """
    produced: dict[str, str] = {}
    original_write = generate_corpus.write
    original_argv = sys.argv

    def capture(name: str, payload: dict) -> None:
        produced[name] = _rendered(payload)

    generate_corpus.write = capture  # type: ignore[assignment]
    sys.argv = ["generate_corpus.py"]
    try:
        generate_corpus.main()
    finally:
        generate_corpus.write = original_write  # type: ignore[assignment]
        sys.argv = original_argv
    return produced


def _files_on_disk() -> set[str]:
    return {entry.name for entry in CORPUS.iterdir() if entry.is_file()}


def test_generated_holds_exactly_the_files_the_generator_writes(fresh: dict[str, str]) -> None:
    """余分なファイルは赤、足りなくても赤。

    名指しで 2 ファイルだけを読んでいたとき、`corpus/generated/` に手書きの
    `scientific-001.json` を置くだけで、検証されていない期待値が
    「二経路で照合した」件数に加算された。ディレクトリの中身そのものを見る。
    """
    on_disk = _files_on_disk()
    expected = set(fresh)
    assert on_disk == expected, (
        f"corpus/generated/ holds {sorted(on_disk)} but the generator writes "
        f"{sorted(expected)}. Extra files never pass through the regeneration "
        "gate, so their expectations are not the ones Python produced; missing "
        "files silently shrink what the heavy suite verifies. "
        "corpus/contributed/ is deliberately out of scope for this rule."
    )


def test_every_generated_file_matches_a_fresh_generation(fresh: dict[str, str]) -> None:
    """列挙したファイルの中身を 1 枚ずつ、生バイト列で突き合わせる。"""
    for name in sorted(_files_on_disk()):
        committed = (CORPUS / name).read_text(encoding="utf-8")
        assert name in fresh, f"{name} is not something the generator writes"
        assert fresh[name] == committed, f"{name} does not match a fresh generation"
