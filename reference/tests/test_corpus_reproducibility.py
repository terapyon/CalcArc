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

**`corpus/contributed/` はこの規則の対象外である。** 人が手で書くファイルなので、
生成器の出力とバイト単位で一致するとは限らない——というより一致しないのが前提。
このテストは `corpus/generated/` だけを対象にする。いまは `contributed/` という
ディレクトリ自体が存在しないが、将来それが増えても、このテストの対象に含めては
ならない。

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

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_corpus.py"
_SPEC = importlib.util.spec_from_file_location("generate_corpus", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
generate_corpus = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_corpus"] = generate_corpus
_SPEC.loader.exec_module(generate_corpus)

CORPUS = generate_corpus.CORPUS

# generate_corpus.main() の既定値(count=2000)と種。main() を呼ばずに直接
# build_shard / build_equivalences を叩くため、ここで値を写して固定する。
SEED_SCIENTIFIC = 20260815
SEED_EQUIVALENCE = 20260816
COUNT = 2000


def _rendered(payload: dict) -> str:
    """`generate_corpus.write()` と同じ整形。差分をここだけ見れば揃えられる。"""
    return json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n"


def test_scientific_000_matches_a_fresh_generation() -> None:
    committed = (CORPUS / "scientific-000.json").read_text(encoding="utf-8")
    fresh = _rendered(generate_corpus.build_shard(seed=SEED_SCIENTIFIC, count=COUNT))
    assert fresh == committed


def test_equivalence_000_matches_a_fresh_generation() -> None:
    committed = (CORPUS / "equivalence-000.json").read_text(encoding="utf-8")
    fresh = _rendered(generate_corpus.build_equivalences(seed=SEED_EQUIVALENCE, count=COUNT))
    assert fresh == committed
