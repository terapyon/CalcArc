"""1.2.5・1.2.6 の設計書 §0 の数を出す。2 本の pitry（今と後）に同じキー列を流して比べる。

pitry は `crates/calcarc-core/examples/pitry.rs` を `--release` で build したもの。手順は
`docs/superpowers/sdd/2026-10-14-pi-power-marks/README.md` と
`docs/superpowers/sdd/2026-10-20-pi-marks-more/README.md`。

  python3 scripts/ppm_cmp.py random OUT/ppm-rand.json BASE_PITRY NEW_PITRY
  python3 scripts/ppm_cmp.py corpus ../corpus/generated BASE_PITRY NEW_PITRY

random: 表示（10 桁の文字列。エラーは 'Math ERROR'）を SymPy の真値と比べる。
corpus: 値の期待を持つケースのキー列を歩き、生の値（re, im の f64）と表示（文字列とエラー）が
        今と後で動いた件数を数える。左右を比べるケース（同値など）は、左右が等しいかどうかが
        入れ替わった組を数える。
"""

import json
import pathlib
import subprocess
import sys
from collections import Counter


def run(binary: str, lines: list[str]) -> list[tuple[str, str, str]]:
    out = subprocess.run(
        [binary], input="\n".join(lines) + "\n", capture_output=True, text=True, check=True
    ).stdout.splitlines()
    assert len(out) == len(lines), (len(out), len(lines))
    rows = []
    for line in out:
        keys, main, re, im, error = line.split("\t")
        shown = "Math ERROR" if error != "None" else main
        rows.append((shown, f"{re} {im}", error))
    return rows


def random_mode(path: str, base_bin: str, new_bin: str) -> None:
    with open(path) as f:
        rows = json.load(f)
    lines = [keys for _, keys, _ in rows]
    base, new = run(base_bin, lines), run(new_bin, lines)
    c: Counter[str] = Counter()
    listed = []
    for (_, keys, want), (a, ra, _), (b, rb, _) in zip(rows, base, new, strict=True):
        c["lines"] += 1
        c["base_wrong"] += a != want
        c["new_wrong"] += b != want
        c["raw_changed"] += ra != rb
        if a != b:
            c["display_changed"] += 1
            kind = (
                "wrong->right"
                if b == want
                else "RIGHT->WRONG"
                if a == want
                else "wrong->other_wrong"
            )
            c[kind] += 1
            if kind != "wrong->right":
                listed.append((kind, keys, want, a, b))
        if b == "Math ERROR" and a != "Math ERROR":
            c["finite->error"] += 1
        if a == "Math ERROR" and b != "Math ERROR":
            c["error->finite"] += 1
    for key in sorted(c):
        print(f"{key:20} {c[key]}")
    for row in listed:
        print(*row, sep="\t")


def corpus_mode(directory: str, base_bin: str, new_bin: str) -> None:
    lines = []
    pairs = []
    for shard in sorted(pathlib.Path(directory).glob("*.json")):
        with open(shard) as f:
            cases = json.load(f)["cases"]
        for case in cases:
            if "keys" in case and "expect" in case:
                lines.append(" ".join(case["keys"]))
            elif "left" in case and "right" in case:
                pairs.append((case["id"], " ".join(case["left"]), " ".join(case["right"])))
    base, new = run(base_bin, lines), run(new_bin, lines)
    print("cases", len(lines))
    print("raw_changed", sum(a[1] != b[1] for a, b in zip(base, new, strict=True)))
    print(
        "display_changed", sum((a[0], a[2]) != (b[0], b[2]) for a, b in zip(base, new, strict=True))
    )
    pair_mode(pairs, base_bin, new_bin)


def pair_mode(pairs: list[tuple[str, str, str]], base_bin: str, new_bin: str) -> None:
    """左右の 2 本を比べるケース（同値・訂正・表示の一部）。左右が等しいかどうかが今と後で
    入れ替わった組を、生の値（re・im・エラー）と表示（文字列とエラー）で数える。
    等しかった組が違うようになったものは id を印字する。"""
    sides = [left for _, left, _ in pairs] + [right for _, _, right in pairs]
    n = len(pairs)
    base, new = run(base_bin, sides), run(new_bin, sides)
    c: Counter[str] = Counter()
    listed = []
    for i, (case_id, _, _) in enumerate(pairs):
        for name, key in (("raw", lambda r: (r[1], r[2])), ("display", lambda r: (r[0], r[2]))):
            was = key(base[i]) == key(base[n + i])
            now = key(new[i]) == key(new[n + i])
            if was and not now:
                c[f"pairs_{name}_became_unequal"] += 1
                listed.append((name, case_id))
            elif now and not was:
                c[f"pairs_{name}_became_equal"] += 1
    print("pairs", n)
    for key in sorted(c):
        print(key, c[key])
    for row in listed:
        print("BECAME_UNEQUAL", *row, sep="\t")


if __name__ == "__main__":
    mode, path, base_bin, new_bin = sys.argv[1:5]
    {"random": random_mode, "corpus": corpus_mode}[mode](path, base_bin, new_bin)
