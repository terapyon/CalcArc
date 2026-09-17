// **追跡下の全ファイル**に衝突マーカーが残っていないかを見張る番人。
// (2026-09-17 に `docs/` だけから広げた。理由は下の「自己違反」を参照。)
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
// - **2 進のファイルは読まない。** NUL を含むもの(画像・フォント・PDF)は
//   飛ばし、**飛ばした数を印字する**。**「読めないので見なかった」を
//   「見て 0 だった」と同じ緑にしない**ため、飛ばした数にも上限を置く。
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
// 下線としても正当**である——追跡下に今日そういう行は無いが、単独の
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
//    **測って確かめた(2026-09-17、範囲を広げたときに測り直した)**——
//    **マーカーを引用している追跡下のファイルは在る**(このスクリプトの
//    テスト、0.9.3 の設計書)が、**どれも引用符や文の途中**で、
//    **行頭から始まる行は追跡下に 1 行も無い**。判定は行頭に錨を張るので、
//    引用しているだけの文書は落ちない。だから今この規則で不便になる人は 0 人である。
//
// # 見たことを証明する
//
// 何も見つからない検査は、何かを読んだことを示さない限り意味が無い
// (`check-citations.mjs` の `total === 0` チェックと同じ理由)。だから
// **読んだファイル数に下限を課し、飛ばした数に上限を課す**。
// 実数はコミットのたびに動くのでここには書かない——`git ls-files` は
// 2026-09-17 に 582 件を返し、うち 575 件を読み 7 件を 2 進として飛ばしたが、
// **この値を床に焼けば、明日ファイルが 1 本減っただけで赤くなる**。
// 下限は 100、飛ばした数の上限は 50 に置く。
//
// # 自己違反しないこと——**恐れていた罠は、測ったら存在しなかった**
//
// 2026-09-05 に置いたときは `docs/` だけを読み、「`tools/` へ広げた日に
// **自分のテストを撃つ**」と書いてあった。`tools/tests/check-conflict-markers.test.ts`
// が**テストの入力として本物のマーカーを含む文字列**を持つからである。
// **2026-09-17 に測って、それが偽だと分かった:**
//
// - **判定は行頭に錨を張る**(`CONFLICT_OPEN` = `/^<{7}/` ほか)。
// - **そのテストのマーカーは 37 回現れるが、行頭から始まる行は 0 行**
//   (インデントつきも 0)。**全部が引用符の中**にある——
//   `{ path: "docs/a.md", text: "本文\n<<<<<<< HEAD\n続き\n" }` の形。
// - **追跡下の全ファイルでも、行頭のマーカーは 0 行**だった。
//
// **つまり「リテラルを持つ」と「この検査に当たる」は別である**——
// 文字列を組み立てる側に直す必要は無かった。**避けようとした代償は存在せず、
// そのために 3 か月ぶん、塞げる穴を自分から狭めていた。**
//
// **将来ここを読む人へ**: 範囲を狭める案が出たら、**狭める理由の現物を見ること**。
// 「代償がある」と聞いて代償を確かめずに決めると、また同じことが起きる。

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
export function readTrackedFiles() {
  // **`URL.pathname` を使わない。** %-encode が戻らないので、パスに空白が
  // 入る環境でファイルを開けない(`check-citations.mjs` と同じ理由)。
  const root = fileURLToPath(new URL("..", import.meta.url));
  const listed = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = [];
  const skipped = [];
  for (const path of listed.split("\n").filter((p) => p !== "")) {
    let buffer;
    try {
      buffer = readFileSync(join(root, path));
    } catch {
      // 読めない(消えた・権限・symlink の先が無い)。**飛ばした数に数える。**
      skipped.push({ path, why: "読めない" });
      continue;
    }
    // **NUL を含むものは 2 進として飛ばす**(画像・フォント・PDF)。
    // テキストとして読むと化けるだけで、行頭のマーカーは出ようがない。
    if (buffer.includes(0)) {
      skipped.push({ path, why: "2 進" });
      continue;
    }
    files.push({ path, text: buffer.toString("utf8") });
  }
  return { files, skipped };
}

/**
 * **読んだ**ファイル数の下限。**実数はここに書かない**——`main` が進むたびに
 * 動くので、書けばその日のうちに腐る(`check-citations.mjs` の `total` と
 * 同じ理由)。2026-09-17 の実測は 575 件で、100 はその下に**大きく**余裕を持って置いた。
 * **今日の数を床にしない**——焼けば、明日ファイルが 1 本減っただけで赤くなる。
 */
const MIN_SCANNED_FILES = 100;

/**
 * **飛ばした**ファイル数の上限。**「読めないので見なかった」を「見て 0 だった」と
 * 同じ緑にしない**ための床である(2026-09-17、監視役の指摘)。
 * 実測は 7 件(画像など)。**読み方が壊れて全部飛ばし始めたら、ここで落ちる。**
 */
const MAX_SKIPPED_FILES = 50;

function main() {
  const { files, skipped } = readTrackedFiles();

  if (files.length < MIN_SCANNED_FILES) {
    console.error(
      `check:conflict-markers NG — 追跡ファイルを ${files.length} 件` +
        `しか読めなかった(下限 ${MIN_SCANNED_FILES})。\`git ls-files\` の` +
        "結果か、このスクリプトの根の解決が変わっている。",
    );
    process.exit(1);
  }

  if (skipped.length > MAX_SKIPPED_FILES) {
    console.error(
      `check:conflict-markers NG — ${skipped.length} 件を飛ばした` +
        `(上限 ${MAX_SKIPPED_FILES})。**見なかったものが多すぎる**——` +
        "読み方が壊れていないかを確かめること。",
    );
    for (const { path, why } of skipped.slice(0, 10)) {
      console.error(`  ${path}: ${why}`);
    }
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
    `check:conflict-markers OK — 追跡ファイル ${files.length} 件を読み、` +
      `${skipped.length} 件を飛ばした(2 進・読めない)、衝突マーカー 0 件`,
  );
}

// vitest から import されたときは走らせない(`check-citations.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-conflict-markers.mjs")) {
  main();
}
