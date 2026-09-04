// 註が名指しした `docs/base-spec.md` の節が、**実在すること**を見張る。
//
// **なぜ要るか。** 2026-09-04 に「`web/src/ui/Keypad/types.ts:28` の
// `base-spec §43` は存在しない」という指摘が出た。**実際には存在した**
// ——`docs/base-spec.md:1138` の `# 43. Accessibility` である。見つから
// なかったのは `## 43` と `§43` を探したためで、この文書は見出しに `§` を
// 使わず、`#` 1 つで節を書く。**人が grep で確かめる限り、この取り違えは
// 繰り返す。**
//
// 指摘は空振りだったが、**危険のほうは実在する**。足した日に数えて、
// 追跡下の **124 本**のファイルが **320 件**の引用で **42 節**を名指しして
// いた（宙に浮いていたものは 0 件）。`base-spec.md` は訂正のたびに節を
// 足しており（§40 の「実装した範囲」、§41 の追記）、**番号がずれた日に、
// 320 件は緑のまま全部が嘘になる。**
//
// **見るのは番号の実在だけである。** その節が註の言うことを言っているか
// までは見ない——それは機械には読めない。**節が消えたことは読める**ので、
// 読めるほうだけを見張る。
//
// **`設計書 §N` は見ない。** 「設計書」がどの spec を指すかは行ごとに違い、
// 文脈でしか決まらない（同じ `§7.1` が S-2 の spec と S-1 の spec の両方に
// 在る）。**機械が決められない対象を、決められるふりをして見張らない。**

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{path: string, text: string}} SourceFile
 * @typedef {{path: string, line: number, section: string, text: string}} Dangling
 */

/** テキストとして読むもの。画像などは対象外。 */
const TEXTUAL = /\.(md|ts|tsx|css|rs|py|mjs|json|yml)$/;

/**
 * 節の番号。`# 43. Accessibility` と `## 9.2 MVP機能` の両方を拾う
 * ——**この文書は 2 つの綴りを混ぜている**ので、片方だけ見ると半分を
 * 「存在しない」と言ってしまう。
 */
const HEADING = /^#+[ \t]*(\d+(?:\.\d+)*)\.?[ \t]/;

/** `§43` / `§ 43` / `§9.2`。小節まで見る。 */
const SECTION = /§[ \t]*(\d+(?:\.\d+)*)/g;

/**
 * `§N` を base-spec への引用と見なす窓の幅（文字）。
 *
 * **同じ行に `base-spec` が在るだけでは足りない。** 実物には
 * `//! ...(設計書 §3、base-spec §26 の整数版)` のような行があり、
 * **1 行に 2 つの文書への引用が並ぶ**。直前 24 文字に限ると、
 * `§26` だけが base-spec のものとして拾われる（実測 2026-09-04）。
 */
const WINDOW = 24;

/**
 * `docs/base-spec.md` の本文から、実在する節の番号を集める。
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function readSpecSections(text) {
  /** @type {Set<string>} */
  const sections = new Set();
  for (const line of text.split("\n")) {
    const found = HEADING.exec(line);
    if (found) {
      sections.add(found[1]);
    }
  }
  return sections;
}

/**
 * base-spec の節を名指ししている箇所を全部返す。
 *
 * **宙に浮いたものだけでなく、拾えた総数も返す。** 0 件になっても緑を
 * 返す検査は、壊れた日から何も主張しない。
 *
 * @param {SourceFile[]} files
 * @param {Set<string>} sections
 * @returns {{total: number, dangling: Dangling[]}}
 */
export function findCitations(files, sections) {
  /** @type {Dangling[]} */
  const dangling = [];
  let total = 0;
  for (const file of files) {
    if (!TEXTUAL.test(file.path)) {
      continue;
    }
    file.text.split("\n").forEach((text, index) => {
      for (const found of text.matchAll(SECTION)) {
        const before = text.slice(
          Math.max(0, found.index - WINDOW),
          found.index,
        );
        if (!before.includes("base-spec")) {
          continue;
        }
        total += 1;
        if (!sections.has(found[1])) {
          dangling.push({
            path: file.path,
            line: index + 1,
            section: found[1],
            text: text.trim(),
          });
        }
      }
    });
  }
  return { total, dangling };
}

/**
 * 追跡されているファイルを読む。**`git ls-files` を使う**——生成物
 * (`web/src/wasm/`・`node_modules`・`dist`)を歩かないため。
 *
 * @returns {SourceFile[]}
 */
export function readTrackedFiles() {
  // **`URL.pathname` を使わない。** %-encode が戻らないので、パスに空白が
  // 入る環境でファイルを開けない(check-boundary.mjs と同じ理由)。
  const root = fileURLToPath(new URL("..", import.meta.url));
  const listed = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\n")
    .filter((path) => path !== "")
    .map((path) => {
      try {
        return { path, text: readFileSync(join(root, path), "utf8") };
      } catch {
        return { path, text: "" };
      }
    });
}

/** @returns {string} */
export function readSpecText() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return readFileSync(join(root, "docs/base-spec.md"), "utf8");
}

function main() {
  const sections = readSpecSections(readSpecText());
  const { total, dangling } = findCitations(readTrackedFiles(), sections);

  // **1 件も拾えなかったら赤くする。** 綴りが変わって正規表現が当たらなく
  // なった日から、この検査は何も見ないまま緑を返し続ける。
  if (total === 0) {
    console.error(
      "check:citations NG — base-spec への引用を 1 件も拾えなかった。" +
        "引用の綴りか、この検査の正規表現のどちらかが変わっている。",
    );
    process.exit(1);
  }

  if (dangling.length > 0) {
    console.error(
      `check:citations NG — base-spec に無い節を指している(${dangling.length} 行)`,
    );
    for (const { path, line, section, text } of dangling) {
      console.error(`  ${path}:${line}: §${section} が無い — ${text}`);
    }
    process.exit(1);
  }

  console.log(
    `check:citations OK — base-spec への引用 ${total} 件 / ` +
      `base-spec の節 ${sections.size} 個、宙に浮いた引用 0 件`,
  );
}

// vitest から import されたときは走らせない(`check-boundary.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-citations.mjs")) {
  main();
}
