// `web` は重量級を知らない——**その向きを、宣言ではなく実行で見張る**
// (CLAUDE.md「重量級のテストを `web/` に置かない」)。
//
// **なぜ要るか。** 2026-08-25 に重量級を `heavy/` へ分離した後も、
// `web/scripts/release-evidence.mjs` と `web/tests/unit/release-evidence.test.ts` が
// `"Heavy corpus"` や `"heavy-report.md"` を名指ししたまま 6 行残っていた。
// **境界は「移した」と書いた時点では守られておらず、誰も見ていなかった。**
// 2026-08-26 に `tools/` へ移して 0 件になったので、**0 件のままであること**を
// この検査が毎回の CI で確かめる。
//
// 逆向き（`heavy` や `tools` が `web` を読む）は正常なので見ない。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `web/` の中でこの語を見つけたら違反とする。大文字小文字は問わない。 */
const FORBIDDEN = /heavy/i;

/**
 * @typedef {{path: string, text: string}} SourceFile
 * @typedef {{path: string, line: number, text: string}} Violation
 */

/**
 * `web/` に属するファイルの中から、重量級への言及を拾う。
 *
 * **判定はここだけが持つ。** CLI もテストも同じ関数を通すので、
 * 「手元では通ったが CI では違う」が起きない。
 *
 * @param {SourceFile[]} files
 * @returns {Violation[]}
 */
export function findBoundaryViolations(files) {
  /** @type {Violation[]} */
  const found = [];
  for (const file of files) {
    if (!file.path.startsWith("web/")) {
      continue;
    }
    file.text.split("\n").forEach((text, index) => {
      if (FORBIDDEN.test(text)) {
        found.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return found;
}

/**
 * 追跡されている `web/` のファイルを読む。**`git ls-files` を使う**
 * ——生成物(`web/src/wasm/`・`node_modules`・`dist`)を歩かないため。
 *
 * @returns {SourceFile[]}
 */
export function readWebFiles() {
  // **`URL.pathname` を使わない。** %-encode が戻らないので、パスに空白が
  // 入る環境（`/home/My Work/...`）でファイルを開けない(Fable の指摘)。
  const root = fileURLToPath(new URL("..", import.meta.url));
  const listed = execFileSync("git", ["-C", root, "ls-files", "web"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return listed
    .split("\n")
    .filter((path) => path !== "")
    .map((path) => {
      try {
        return { path, text: readFileSync(join(root, path), "utf8") };
      } catch {
        // 画像などは読めない。**読めないものは判定しない**(黙って通す
        // のではなく、テキストとして扱えないという意味で対象外である)。
        return { path, text: "" };
      }
    });
}

function main() {
  const found = findBoundaryViolations(readWebFiles());
  if (found.length > 0) {
    console.error(
      `check:boundary NG — web が重量級を知っている(${found.length} 行)`,
    );
    for (const { path, line, text } of found) {
      console.error(`  ${path}:${line}: ${text}`);
    }
    process.exit(1);
  }
  console.log("check:boundary OK — web から重量級への参照は 0 件");
}

// vitest から import されたときは走らせない(`check-version.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-boundary.mjs")) {
  main();
}
