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

import hashlib
import importlib.util
import json
import pathlib
import sys
from typing import Any

import pytest

_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_corpus.py"
_SPEC = importlib.util.spec_from_file_location("generate_corpus", _PATH)
assert _SPEC is not None and _SPEC.loader is not None
generate_corpus = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_corpus"] = generate_corpus
_SPEC.loader.exec_module(generate_corpus)

CORPUS = generate_corpus.CORPUS

#: **この検査の結果を、報告書が読める形で残す場所。**
#:
#: 重量級の報告書(`heavy/heavy-report.md`)は、自分の土台がここで確かめられて
#: いることを前提に「不一致 0 件」と書く。**その土台が赤かった走行と、土台を
#: 一度も確かめていない走行が、報告書の上で同じ顔をしてはならない。**
#:
#: **なぜ `heavy/` に書くのか。** 報告書が読む信号は 3 つとも `heavy/` に在る
#: (`detection-power.json` / `heavy-run.json` / `heavy-ui-run.json`)。読む側から
#: 見て 1 か所に揃っている方が、次に足す人が探す場所を間違えない。
#: `reference` が自分の外へ書くこと自体は前からある——`corpus/generated/` も
#: `testdata/` もここが書いている。
SIGNAL = pathlib.Path(__file__).resolve().parents[2] / "heavy" / "reproducibility.json"


def corpus_digest(directory: pathlib.Path) -> str:
    """コミット済みコーパスの**生バイト列**を 1 本の指紋にする。

    **信号が古びたことを、読む側が気づけるようにするためである。** この検査を
    通したあとで `corpus/generated/` を手で書き換えると、ディスクには「緑」と
    書かれた信号だけが残る——報告書はそれを読んで「土台は確かめてある」と言う。
    **それは、このテストが塞いだはずの穴が信号の側から開き直った状態である。**

    指紋が合わなければ、信号は**目の前のバイト列について何も言っていない**。
    報告書はそれを「確かめていない」ではなく「**古い**」として出す。

    整形ではなく生バイトを読む(`read_bytes`)。`json.load` して比べると、
    キーの並びやインデントの崩れ——値は同じで整形だけ違う状態——が指紋に
    出ない。それは `_rendered()` が生文字列で比べているのと同じ理由である。

    TypeScript 側(`heavy/tests/corpus/report.ts` の `corpusDigest`)が
    **同じ手順**でこれを組み直す。区切りに長さを挟むのは、名前と中身の境目が
    ずれても同じ指紋にならないようにするためである。
    """
    digest = hashlib.sha256()
    for name in sorted(entry.name for entry in directory.iterdir() if entry.is_file()):
        raw = (directory / name).read_bytes()
        digest.update(name.encode("utf-8"))
        digest.update(b"\n")
        digest.update(str(len(raw)).encode("ascii"))
        digest.update(b"\n")
        digest.update(raw)
    return digest.hexdigest()


def signal_payload(record: dict[str, Any]) -> dict[str, Any]:
    """集めた結果を、報告書が読む 1 枚に畳む。**純関数。**

    **`ok` は「赤が無い」ではなく「2 つとも確かめて、赤が無い」である。**
    片方が走らないまま(生成器自身が落ちるとそうなる)`ok: true` を書くと、
    **一度も比べていない走行が緑の顔をする**——このファイルが最初に塞いだ
    穴とまったく同じ形である。
    """
    complete = record["fileSetChecked"] and record["bytesChecked"] is not None
    return {
        "schema": 1,
        "corpusDigest": record["corpusDigest"],
        "fileSetChecked": record["fileSetChecked"],
        "extra": sorted(record["extra"]),
        "missing": sorted(record["missing"]),
        "bytesChecked": record["bytesChecked"],
        "mismatched": sorted(record["mismatched"]),
        "ok": bool(
            complete and not record["extra"] and not record["missing"] and not record["mismatched"]
        ),
    }


@pytest.fixture(scope="module")
def signal() -> Any:
    """**結果を集めて、成否によらず書き出す。**

    テストが赤くなった走行でこそ信号が要るので、`assert` より前に記録し、
    書き出しは teardown で行う。**`fresh` がこれを引数に取る**ので、
    生成器の呼び出しが落ちても——つまり 2 つの検査が 1 つも走らなくても——
    ここは必ず動き、`ok: false` の信号が残る。
    """
    record: dict[str, Any] = {
        "corpusDigest": corpus_digest(CORPUS),
        "fileSetChecked": False,
        "extra": [],
        "missing": [],
        "bytesChecked": None,
        "mismatched": [],
    }
    yield record
    SIGNAL.parent.mkdir(parents=True, exist_ok=True)
    SIGNAL.write_text(
        json.dumps(signal_payload(record), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _rendered(payload: dict) -> str:
    """`generate_corpus.write()` と同じ整形。差分をここだけ見れば揃えられる。"""
    return json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n"


@pytest.fixture(scope="module")
def fresh(signal: Any) -> dict[str, str]:
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


def test_generated_holds_exactly_the_files_the_generator_writes(
    fresh: dict[str, str], signal: Any
) -> None:
    """余分なファイルは赤、足りなくても赤。

    名指しで 2 ファイルだけを読んでいたとき、`corpus/generated/` に手書きの
    `scientific-001.json` を置くだけで、検証されていない期待値が
    「二経路で照合した」件数に加算された。ディレクトリの中身そのものを見る。
    """
    on_disk = _files_on_disk()
    expected = set(fresh)
    # **assert より前に記録する。** 赤くなった走行でこそ信号が要る。
    signal["extra"] = sorted(on_disk - expected)
    signal["missing"] = sorted(expected - on_disk)
    signal["fileSetChecked"] = True
    assert on_disk == expected, (
        f"corpus/generated/ holds {sorted(on_disk)} but the generator writes "
        f"{sorted(expected)}. Extra files never pass through the regeneration "
        "gate, so their expectations are not the ones Python produced; missing "
        "files silently shrink what the heavy suite verifies. "
        "corpus/contributed/ is deliberately out of scope for this rule."
    )


def test_every_generated_file_matches_a_fresh_generation(
    fresh: dict[str, str], signal: Any
) -> None:
    """列挙したファイルの中身を 1 枚ずつ、生バイト列で突き合わせる。

    **最初の 1 枚で止めず、全部数えてから落ちる。** 途中で `assert` すると、
    信号に載る不一致が「最初に見つかった 1 件」になり、**報告書が
    「1 枚だけずれている」と読める**——実際には何枚ずれているか分からない。
    生成器が書かないファイル(余分なファイル)は上のテストが持つので、
    ここでは数えない。
    """
    mismatched: list[str] = []
    checked = 0
    for name in sorted(_files_on_disk()):
        if name not in fresh:
            continue
        committed = (CORPUS / name).read_text(encoding="utf-8")
        checked += 1
        if fresh[name] != committed:
            mismatched.append(name)
    # **assert より前に記録する。**
    signal["bytesChecked"] = checked
    signal["mismatched"] = mismatched
    assert not mismatched, (
        f"{len(mismatched)} of {checked} committed corpus files do not match a "
        f"fresh generation: {mismatched}"
    )


#: **2 つの言語が同じ指紋を出すことを、両側から同じ数字に釘で留める。**
#:
#: `corpus_digest` の相方は TypeScript 側の `corpusDigest`
#: (`heavy/tests/corpus/report.ts`)である。**片方だけ手順を変えると、報告書は
#: 毎回「この記録は古い」と言い続ける**——静かに壊れはしないが、正しい走行でも
#: 土台が読めなくなる。互いを呼び合わずに済むよう、**同じ作り物のディレクトリ
#: から出る指紋**をこの 1 つの定数に留める。TS 側の `report.spec.ts` が同じ値を
#: 持っている。どちらかを直すと、そちらが赤くなる。
DIGEST_OF_THE_SHARED_FIXTURE = "a8082f740d94e376dbf63f3ebc3379bce480ba11583d8a90185df8413dcefb55"


def test_corpus_digest_matches_the_value_the_typescript_side_pins(
    tmp_path: pathlib.Path,
) -> None:
    (tmp_path / "a.json").write_bytes(b'{"x": 1}\n')
    (tmp_path / "b.json").write_bytes(b"[]\n")
    assert corpus_digest(tmp_path) == DIGEST_OF_THE_SHARED_FIXTURE


def test_corpus_digest_notices_a_byte(tmp_path: pathlib.Path) -> None:
    """**1 バイト変えたら別の指紋になる。** これが「古い記録」を見つける仕掛け。"""
    (tmp_path / "a.json").write_bytes(b'{"x": 1}\n')
    before = corpus_digest(tmp_path)
    (tmp_path / "a.json").write_bytes(b'{"x": 2}\n')
    assert corpus_digest(tmp_path) != before


def test_corpus_digest_separates_the_name_from_the_body(tmp_path: pathlib.Path) -> None:
    """名前と中身の境目がずれても同じ指紋にならない(長さを挟んでいる理由)。"""
    (tmp_path / "ab.json").write_bytes(b"1\n")
    one = corpus_digest(tmp_path)
    (tmp_path / "ab.json").unlink()
    (tmp_path / "a.json").write_bytes(b"b.json1\n")
    assert corpus_digest(tmp_path) != one


def test_signal_is_not_green_when_only_half_the_checks_ran() -> None:
    """**片方しか走っていない走行は `ok: false`。**

    生成器そのものが落ちると 2 つの検査は 1 つも走らず、`fileSetChecked` は
    `False` のまま残る。ここで `ok: true` を書くと、**一度も比べていない走行が
    緑の顔をする**——このファイルが最初に塞いだ穴と同じ形である。
    """
    half: dict[str, Any] = {
        "corpusDigest": "x",
        "fileSetChecked": True,
        "extra": [],
        "missing": [],
        "bytesChecked": None,
        "mismatched": [],
    }
    assert signal_payload(half)["ok"] is False
    assert signal_payload({**half, "fileSetChecked": False})["ok"] is False
    assert signal_payload({**half, "bytesChecked": 18})["ok"] is True


def test_signal_is_not_green_when_anything_drifted() -> None:
    base: dict[str, Any] = {
        "corpusDigest": "x",
        "fileSetChecked": True,
        "extra": [],
        "missing": [],
        "bytesChecked": 18,
        "mismatched": [],
    }
    assert signal_payload(base)["ok"] is True
    assert signal_payload({**base, "extra": ["z.json"]})["ok"] is False
    assert signal_payload({**base, "missing": ["z.json"]})["ok"] is False
    assert signal_payload({**base, "mismatched": ["z.json"]})["ok"] is False
