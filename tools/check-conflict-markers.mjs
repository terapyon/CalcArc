// `docs/` に衝突マーカーが残っていないかを見張る番人。
//
// **なぜ要るか(実測、仮定ではない)。** 2 本の重量級検証の枝を合流させたら、
// 追跡下の台帳が**衝突マーカーの入ったまま**残った。そして
// `tools/check-citations.mjs` は**その壊れた文書をそのまま引用元として読み**、
// 327 件の引用を数えて緑を返した——`check-citations.mjs` にマーカーという
// 概念が無いからである。見つけたのは人で、道具ではなかった。
// **「壊れているのに気づかず読む」こそが穴である。**
//
// CLAUDE.md の規律: 「規律を書いたら、同じコミットで番人を置く」——番人とは
// **破ったときに赤くなるもの**である。この検査がその番人。
//
// # この検査が主張しないこと
//
// - **衝突の中身を読まない。** どちらの版を採るべきかは判定しない
//   ——見るのはマーカーの**存在**だけである。
// - **`docs/` の外は見ない。** 下の「自己違反」を参照。
// - **拾えたマーカーの綴りが正しいとは限らない。** 3 本のマーカーの綴りを
//   固定しているだけで、それ以外の壊れ方(たとえば手で書き換えた不完全な
//   衝突)は見ない。
//
// # 3 本のマーカーは対等ではない——これが設計の要である
//
// `<<<<<<<`(7 個)と `>>>>>>>`(7 個)は、正当な文書に**絶対に**現れない
// (ローカルの 36 枝すべてで実測 0 件)。行頭にあれば無条件で落とす。
//
// `=======`(7 個の `=` だけの行)は違う。**Markdown の setext 見出しの
// 下線としても正当**である——`docs/` には今日そういう行は無いが、単独の
// `=` の行を含む文書は 4 本ある。だから `=======` は**それだけでは
// 数えない**。`<<<<<<<` が開いている(まだ `>>>>>>>` で閉じていない)
// 区間の中でだけマーカーとして数える。`<<<<<<<` 自体はどのみち
// 無条件で落ちるので、この使い分けは「衝突の 3 行をまとめて正しく報告する」
// ためのものであり、`=======` 単独の判定を緩めるためのものではない
// ——**単独の `=======` は今日 `docs/` に無い**ので、実害は今のところ無い。
//
// # フェンスの中も見る——例外を作らない
//
// ``` の中のマーカーも落とす。理由は 2 つ:
//
// 1. **フェンスを除外すると、フェンスの中に隠れた本物のマーカーが素通り
//    する。** 「読んだのに気づかない」という、この検査が閉じようとして
//    いる穴そのものが、フェンスという形で戻ってくる。
// 2. **不便になるのは、マーカーを地の文で引用したい稀な著者だけ**であり、
//    その人は文字を割ればよい(`<<` と `<<<<<` に分ける)。
//    **測って確かめた**——マーカーを引用している追跡下の文書は
//    (どの枝にも)1 本も無く、「衝突マーカー」という語自体も `docs/` の
//    どのファイルにも現れない。だから今この規則で不便になる人は 0 人である。
//
// # 見たことを証明する
//
// 何も見つからない検査は、何かを読んだことを示さない限り意味が無い
// (`check-citations.mjs` の `total === 0` チェックと同じ理由)。だから
// **走査したファイル数に下限を課す**。実数はコミットのたびに動くので
// ここには書かない——`git ls-files docs/` は今日 139 件を返すが、この値を
// テストに書けば次のコミットで腐る。下限は 100 に置く。
//
// # 自己違反しないこと(意図的)
//
// この検査は `docs/` だけを読む。マーカーの正規表現(リテラル)が住む
// `tools/` は対象外である——**わざと**。もし将来スキャン範囲を `docs/` の
// 外へ広げるなら、少なくとも次を直す必要がある:
//
// - この行のコメントや `CONFLICT_OPEN` / `CONFLICT_CLOSE` の定義など、
//   マーカーを**説明する**行(実際の 7 文字連続は含まない——正規表現の
//   ソースは `<{7}` であって `<<<<<<<` ではない)は無害だが、
// - `tools/tests/check-conflict-markers.test.ts` は**テストの入力として
//   本物のマーカーを含む文字列**を持つ。`tools/check-citations.mjs` の
//   テストが `§` を直書きできず `const S = "§"` に割った(自分自身が
//   自分の検査に違反しないように)のと同じ罠に、この検査を `tools/` へ
//   広げた日に落ちる。**その前例に倣い、文字列を組み立てる側に直す
//   必要がある。**

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `<<<<<<<`。行頭に 7 個以上並んでいれば違反。正当な文書には現れない。 */
const CONFLICT_OPEN = /^<{7}/;

/** `>>>>>>>`。`CONFLICT_OPEN` と対で、こちらも無条件で違反。 */
const CONFLICT_CLOSE = /^>{7}/;

/**
 * `=======` だけの行(setext 見出しの下線と同じ形)。**単独では判定しない**
 * ——`findConflictMarkers` が `CONFLICT_OPEN` の後にだけ数える。
 */
const CONFLICT_MID = /^={7}$/;

/**
 * @typedef {{path: string, text: string}} SourceFile
 * @typedef {{path: string, line: number, marker: string, text: string}} Violation
 */

/**
 * 衝突マーカーを探す。
 *
 * **`=======` は `<<<<<<<` が開いている間だけ数える。** `>>>>>>>` で
 * 閉じるか、次の `<<<<<<<` に出会うまでを「開いている」とする。
 * `<<<<<<<` と `>>>>>>>` はこの状態に関わらず無条件で違反にする——3 本の
 * マーカーの非対称がここに現れる。
 *
 * @param {SourceFile[]} files
 * @returns {Violation[]}
 */
export function findConflictMarkers(files) {
  /** @type {Violation[]} */
  const found = [];
  for (const file of files) {
    let open = false;
    file.text.split("\n").forEach((rawText, index) => {
      // CRLF でも `^={7}$` が行末の `\r` で外れないようにする。
      const text = rawText.endsWith("\r") ? rawText.slice(0, -1) : rawText;
      if (CONFLICT_OPEN.test(text)) {
        found.push({
          path: file.path,
          line: index + 1,
          marker: "<<<<<<<",
          text: text.trim(),
        });
        open = true;
        return;
      }
      if (CONFLICT_CLOSE.test(text)) {
        found.push({
          path: file.path,
          line: index + 1,
          marker: ">>>>>>>",
          text: text.trim(),
        });
        open = false;
        return;
      }
      if (open && CONFLICT_MID.test(text)) {
        found.push({
          path: file.path,
          line: index + 1,
          marker: "=======",
          text: text.trim(),
        });
      }
    });
  }
  return found;
}

/**
 * `docs/` の下で追跡されているファイルを読む。**`git ls-files` を使う**
 * ——生成物や未追跡のファイルを歩かないため(`check-citations.mjs` と同じ
 * 理由)。
 *
 * @returns {SourceFile[]}
 */
export function readTrackedDocs() {
  // **`URL.pathname` を使わない。** %-encode が戻らないので、パスに空白が
  // 入る環境でファイルを開けない(`check-citations.mjs` と同じ理由)。
  const root = fileURLToPath(new URL("..", import.meta.url));
  const listed = execFileSync("git", ["-C", root, "ls-files", "docs/"], {
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

/**
 * 走査したファイル数の下限。**実数はここに書かない**——`main` が進むたびに
 * 動くので、書けばその日のうちに腐る(`check-citations.mjs` の `total` と
 * 同じ理由)。今日の実測は 139 件で、100 はその下に余裕を持って置いた。
 */
const MIN_SCANNED_FILES = 100;

function main() {
  const files = readTrackedDocs();

  if (files.length < MIN_SCANNED_FILES) {
    console.error(
      `check:conflict-markers NG — docs/ の追跡ファイルを ${files.length} 件` +
        `しか読めなかった(下限 ${MIN_SCANNED_FILES})。\`git ls-files docs/\` の` +
        "結果か、このスクリプトの根の解決が変わっている。",
    );
    process.exit(1);
  }

  const found = findConflictMarkers(files);

  if (found.length > 0) {
    console.error(
      `check:conflict-markers NG — 衝突マーカーが残っている(${found.length} 行)`,
    );
    for (const { path, line, marker, text } of found) {
      console.error(`  ${path}:${line}: ${marker} — ${text}`);
    }
    process.exit(1);
  }

  console.log(
    `check:conflict-markers OK — docs/ の追跡ファイル ${files.length} 件、` +
      "衝突マーカー 0 件",
  );
}

// vitest から import されたときは走らせない(`check-citations.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-conflict-markers.mjs")) {
  main();
}
