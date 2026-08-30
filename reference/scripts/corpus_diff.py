"""**生成コーパスの差分を、フィールドごとに読む。**

`git diff` は行を見せるが、**8,000 行の差分から「何が動いたのか」は読めない**。
このスクリプトは**ケース単位・フィールド単位**で数える——
**id が動いたのか、期待値が動いたのか、注記だけが動いたのか。**

## なぜ要るか

2026-08-30、試験空間モデルに `band` を足したとき、**`elementary` の 2,000 件中
1,637 件が変わった。** 中身は `levels`(モデルの注記)が増えただけで、**id も
キーも式も期待値も 1 バイトも動いていない**——しかし**差分の行数からは
それが読めない。**

**そのとき私は手で 1 回確かめた。それでは確かめ自体が残らない。**
**次に読む人が同じ手で確かめられるように、ここに置く。**

## 使い方

```bash
cd reference && uv run --no-config python scripts/corpus_diff.py          # HEAD と比べる
cd reference && uv run --no-config python scripts/corpus_diff.py v0.6.0   # タグと比べる
```

**終了コードは常に 0 である。** 合否を決める道具ではない——**読むための道具**で、
何が「良い差分」かはそのときの変更が決める。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

CORPUS = Path(__file__).resolve().parents[2] / "corpus" / "generated"
REPO = Path(__file__).resolve().parents[2]


def compare(old: list[dict], new: list[dict]) -> dict[str, object]:
    """**2 つのケース列を突き合わせる。** id を鍵にする。

    **位置ではなく id で対応させる**——末尾に足す運用（`_append_rad_boundaries`
    ほか）では位置が保たれるが、**位置で合わせると、1 件挿入しただけで
    「全件が変わった」と出る。**
    """
    by_id_old = {case["id"]: case for case in old}
    by_id_new = {case["id"]: case for case in new}
    added = sorted(set(by_id_new) - set(by_id_old))
    removed = sorted(set(by_id_old) - set(by_id_new))
    changed_fields: dict[str, int] = {}
    changed_ids: list[str] = []
    for case_id in sorted(set(by_id_old) & set(by_id_new)):
        before, after = by_id_old[case_id], by_id_new[case_id]
        if before == after:
            continue
        changed_ids.append(case_id)
        for field in sorted(set(before) | set(after)):
            if before.get(field) != after.get(field):
                changed_fields[field] = changed_fields.get(field, 0) + 1
    return {
        "added": added,
        "removed": removed,
        "changed": changed_ids,
        "changed_fields": changed_fields,
        "unchanged": len(set(by_id_old) & set(by_id_new)) - len(changed_ids),
    }


def outer_fields(old_payload: dict, new_payload: dict) -> list[str]:
    """**ケースの外側で動いたフィールド。**

    `coverage` や `rejections` はシャード階層に在り、**ケース単位の比較には
    1 件も現れない**——見ない道具は「何も動いていない」と言ってしまう。
    **2026-08-30 に実際にそうなった**（理由の文言を 1 行直しただけの走行で、
    道具が「無し」と印字した）。
    """
    return sorted(
        field
        for field in set(old_payload) | set(new_payload)
        if field != "cases" and old_payload.get(field) != new_payload.get(field)
    )


def _at_revision(revision: str, relative: str) -> list[dict] | None:
    result = subprocess.run(
        ["git", "show", f"{revision}:{relative}"],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)["cases"]


def main() -> None:
    revision = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
    print(f"{revision} と作業ツリーを比べる\n")
    total_fields: dict[str, int] = {}
    for path in sorted(CORPUS.glob("*.json")):
        relative = path.relative_to(REPO).as_posix()
        old = _at_revision(revision, relative)
        if old is None:
            print(f"{path.name}: **{revision} に無い**（新しいシャード）")
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        # **ケースの外側も見る。** `coverage` や `rejections` はシャード階層に
        # 在り、**ケース単位の比較には 1 件も現れない**——見ない道具は
        # 「何も動いていない」と言ってしまう（2026-08-30、実際にそうなった）。
        old_payload = json.loads(
            subprocess.run(
                ["git", "show", f"{revision}:{relative}"],
                capture_output=True,
                text=True,
                cwd=REPO,
            ).stdout
        )
        outer = outer_fields(old_payload, payload)
        if outer:
            print(f"{path.name}: シャード階層が動いた: {' / '.join(outer)}")
        report = compare(old, payload["cases"])
        fields = report["changed_fields"]
        assert isinstance(fields, dict)
        if not (report["added"] or report["removed"] or fields):
            continue
        summary = " / ".join(f"{name} {count}" for name, count in sorted(fields.items()))
        print(
            f"{path.name}: 追加 {len(report['added'])} / 削除 {len(report['removed'])}"
            f" / 変更 {len(report['changed'])} / 不変 {report['unchanged']}"
            + (f"\n    動いたフィールド: {summary}" if summary else "")
        )
        for name, count in fields.items():
            total_fields[name] = total_fields.get(name, 0) + count
    print("\n動いたフィールドの合計:", total_fields or "（無し）")


if __name__ == "__main__":
    main()
