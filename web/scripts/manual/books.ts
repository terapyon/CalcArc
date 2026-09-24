/**
 * 画面が読む 3 冊（0.9.6 設計書 §4.3）。**ビルド時に作る。**
 *
 * **実行時には 1 行も変換しない**——これを呼ぶのは `vite.config.ts` の
 * プラグイン（`virtual:manuals`）と、`tests/unit/manual-books.test.ts` だけである。
 * **`marked` は devDependency のまま**で、アプリのバンドルには入らない。
 *
 * **素材は PDF と同じ `docs/manual/*.md`**（設計書 §3「素材は 1 つのまま」）。
 * **並びはファイル名の順**——`tests/unit/manuals.ts` の `EXPECTED_MANUALS` と
 * 同じ形で、**一覧そのものを検査が固定する**（4 冊目が紛れ込めば赤）。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { manualTitle } from "./markdown.ts";
import { renderForScreen } from "./screen.ts";

/** `web/` から見た置き場。**`build.mjs` の `--src` の既定と同じ。** */
export const MANUAL_DIR = "../docs/manual";

export interface ManualBook {
  /** `quick.ja.md` のファイル名そのまま。**検査が一覧を突き合わせる鍵である。** */
  source: string;
  /** `quick-ja`。**PDF の名前（`pdfName`）とリンク集の `MANUALS` が使う綴り。** */
  stem: string;
  /** 本文の最初の見出し。**画面の見出しと目次の代わりになる。** */
  title: string;
  /** 本文の HTML（`<body>` の中身だけ）。 */
  html: string;
}

/** `dir` の `*.md` を名前の順に読み、画面用の HTML にする。 */
export function manualBooks(dir: string): ManualBook[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return names.map((source) => {
    const text = readFileSync(join(dir, source), "utf8");
    return {
      source,
      // **`pdfName` と同じ綴り方**（`quick.ja.md` → `quick-ja`）。**写しではある**
      // が、あちらは `.pdf` を付けて返すので関数は分けてある。
      stem: source.replace(/\.md$/, "").replaceAll(".", "-"),
      title: manualTitle(text, source),
      html: renderForScreen(text),
    };
  });
}

/** 読み込んだ `dir` の中のファイルの道（プラグインが監視に使う）。 */
export function manualSources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}
