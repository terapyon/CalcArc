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
//
// **4 本目(2026-09-04)**: **タッチ標的の 44px は 1 か所にだけ在る**。
// base-spec §43 が求めているのは "Touch target size" までで、**44 という
// 数字を定めているのはこのプロジェクトのほう**である(同節の 2026-09-04 の
// 追記)。値は `web/src/ui/tokens.css` の `--touch-target-min` が持ち、
// **他所が CSS の値として `44px` を書き直したら、そこだけ独立に動く**。
// **足した時点で違反は 0 件**である(実測 2026-09-04)。
//
// **2 本目(2026-08-28)**: `web/src/calc/` は UI Framework を知らない
// (CLAUDE.md「`web/src/calc/` に React を import しない」)。こちらも
// **宣言ではなく実行で見張る**——それまでは `src/calc/index.ts` の
// コメントに「ここに react を書かない」と在るだけで、検査は 0 件だった
// (2026-08-28 の点検)。**足した時点で違反は 0 件**である。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `web/` の中でこの語を見つけたら違反とする。大文字小文字は問わない。 */
const FORBIDDEN = /heavy/i;

/**
 * `web/src/calc/` で見つけたら違反とする import。
 *
 * `from "react"` / `from "react-dom/client"` / `import("react")` と、
 * `from "../ui/…"`（何段の `../` でも）を拾う。**語ではなく import を見る**
 * ので、react に触れた註釈は違反にならない。
 */
const UI_IMPORT =
  /(?:from|import)\s*\(?\s*["'](?:react(?:-dom)?(?:\/[^"']*)?|(?:\.\.\/)+ui\/[^"']*)["']/;

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
 * `web/src/calc/` が UI Framework を読んでいたら違反とする。
 *
 * **React だけでなく `ui/` も見る。** CLAUDE.md が書いているのは
 * 「react を import しない」だが、**理由は「UI Framework から独立させる」**
 * ほうである——`web/src/ui/Keypad/Keypad.tsx:1` が `react` を import して
 * いるので、`calc` から `ui` を読めば **React は推移的に入る**。
 * react だけを見張ると、`from "../ui/Key/Key"` が素通りして**同じ独立性が
 * 壊れる**。だから規則の文言ではなく、規則の理由のほうを見張る。
 *
 * **行の中の語ではなく import を見る。** `src/calc/index.ts:4` には
 * 「ここに react を」というコメントが在り、語で拾うとそれが違反になる
 * ——**規律を書いた行が規律違反になる**のは検査の側の誤りである。
 *
 * **`calc/` だけを見る。** `expr/` `finance/` `convert/` なども実測では
 * 0 件だが(2026-08-28)、**CLAUDE.md が名指ししているのは `calc/` である**。
 * 広げるかどうかは規律を決める側の判断で、検査が勝手に決めない。
 *
 * @param {SourceFile[]} files
 * @returns {Violation[]}
 */
export function findUiLeakIntoCalc(files) {
  /** @type {Violation[]} */
  const found = [];
  for (const file of files) {
    if (!file.path.startsWith("web/src/calc/")) {
      continue;
    }
    file.text.split("\n").forEach((text, index) => {
      if (UI_IMPORT.test(text)) {
        found.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return found;
}

/**
 * **`disabled` という prop 名が `Key` / `Keypad` に無いこと。**
 *
 * 0.5.0 で「この盤面では永久に押せない」を `disabled?: boolean`
 * （＝**条件が変われば押せる**、の口）へ入れたために、
 * **散文でしか守っていなかった契約が黙って破れた**（設計書
 * `2026-08-31-two-shades-of-off.md` §0）。**口そのものを塞いである**ので、
 * **戻ってきたら赤くする。**
 *
 * **見るのは prop の宣言と受け渡しだけ**である——`<button disabled={off}>` は
 * DOM の属性なので残る。**`disabled?: boolean | undefined` のような綴り替えで
 * 素通りしないよう、型ではなく名前を見る。**
 *
 * @param {SourceFile[]} files
 * @returns {Violation[]}
 */
export function findDisabledPropComingBack(files) {
  /** @type {Violation[]} */
  const found = [];
  for (const file of files) {
    if (
      file.path !== "web/src/ui/Key/Key.tsx" &&
      file.path !== "web/src/ui/Keypad/Keypad.tsx"
    ) {
      continue;
    }
    file.text.split("\n").forEach((text, index) => {
      // **見るのは prop の宣言だけ**——`disabled?:` / `disabled:`。
      // **`<button disabled={...}>` は DOM の属性なので対象外**である
      // （`aria-disabled` も同じ）。**JSX は複数行に割れるので、
      // 「`<button` を含む行を除く」では足りない**（実測 2026-08-31）。
      if (/^\s*disabled\s*\??\s*:/.test(text)) {
        found.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return found;
}

/** 値としての `44px` を書いてよい唯一の場所。 */
const TOUCH_TARGET_HOME = "web/src/ui/tokens.css";

/**
 * `44px` を CSS の**値**として書いている行を、`tokens.css` の外から拾う。
 *
 * **宣言だけを見る。** `min-width: 44px` は違反だが、コメントの中の `44px`
 * は違反にしない——**理由を書いた行が規則違反になる**のは検査の側の誤りで
 * ある(2 本目と同じ罠)。実物には「44px を守る」「7 列 × 44px」のような註が
 * 11 行あり(実測 2026-09-04)、そのどれも宣言の形をしていない。
 *
 * **`.css` だけを見る。** E2E は `toBeGreaterThanOrEqual(44)` と数字を
 * 直に書いているが、**テストが期待値を自分で持つのは正しい**——トークンを
 * 読んで突き合わせたら、両方が同時に間違っても緑になる。
 *
 * @param {SourceFile[]} files
 * @returns {Violation[]}
 */
export function findTouchTargetOutsideTokens(files) {
  /** @type {Violation[]} */
  const found = [];
  for (const file of files) {
    if (!file.path.endsWith(".css") || file.path === TOUCH_TARGET_HOME) {
      continue;
    }
    file.text.split("\n").forEach((text, index) => {
      if (/^\s*[-a-zA-Z]+\s*:\s*[^;{]*\b44px\b/.test(text)) {
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

/**
 * 違反を印字する。**どこを直せばよいかが分かる形で**——ファイルと行番号と
 * その行の中身を出す。
 *
 * @param {string} headline
 * @param {Violation[]} found
 */
function report(headline, found) {
  console.error(`check:boundary NG — ${headline}(${found.length} 行)`);
  for (const { path, line, text } of found) {
    console.error(`  ${path}:${line}: ${text}`);
  }
}

function main() {
  const files = readWebFiles();
  const heavy = findBoundaryViolations(files);
  const ui = findUiLeakIntoCalc(files);
  const back = findDisabledPropComingBack(files);
  const touch = findTouchTargetOutsideTokens(files);
  // **全部を印字してから落ちる。** 1 つ目で `exit` すると、2 つ壊れている日に
  // 1 つしか見えず、直して回し直して初めてもう 1 つが出る。
  if (heavy.length > 0) report("web が重量級を知っている", heavy);
  if (ui.length > 0) report("web/src/calc が UI Framework を知っている", ui);
  if (back.length > 0)
    report("Key / Keypad に disabled の口が戻っている", back);
  if (touch.length > 0)
    report(`44px が ${TOUCH_TARGET_HOME} の外に書かれている`, touch);
  if (
    heavy.length > 0 ||
    ui.length > 0 ||
    back.length > 0 ||
    touch.length > 0
  ) {
    process.exit(1);
  }
  console.log(
    "check:boundary OK — web から重量級への参照 0 件 / calc から UI への参照 0 件 / Key・Keypad に disabled の口 0 件 / tokens.css の外の 44px 0 件",
  );
}

// vitest から import されたときは走らせない(`check-version.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-boundary.mjs")) {
  main();
}
