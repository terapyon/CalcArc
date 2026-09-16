// マニュアルが実装に追いついているかを見張る番人。
//
// **なぜ要るか。** 利用者方針(2026-09-16):
// 「マニュアルが最新であることは、リリースの絶対的な条件です。信頼が損なわれる
// ので、修正したら必ずマニュアルのチェックをして、適切な修正を行う必要が
// あります。」——リリースは `docs/manual/*.md` を PDF にして添付するので、
// マニュアルの陳腐化はそのまま利用者への裏切りになる。
//
// この方針が生まれたのは、**直前のリリース 1 本ぶん、マニュアルが 1 度も
// 触られないまま製品が変わり**、読み返して初めて「もう嘘になっている 1 文」が
// 見つかったからである。**「触っていないから大丈夫」は理由にならない**——
// 触らなかったことと正しいことは別の主張であり、後者を確かめずに前者だけを
// 根拠にしていた。
//
// CLAUDE.md 自身の規律: 「規律を書いたら、同じコミットで番人を置く」
// ——番人とは**破ったときに赤くなるもの**である。この検査がその番人。
//
// # 見ているもの
//
// 範囲は **前回のリリースタグ → いま**。CHANGELOG に**新しいリリース見出し**
// (`## <version> — <date>`)が増えていて、その中身が**内部の変更だけではない**
// なら、同じ範囲で `docs/manual/` に変更が無ければ **NG**。
//
// **「利用者向けの節」を名前で当てにいかない。** CHANGELOG 全体を数えると、
// 節の名は自由文である(「複利の期間の単位」「盤面」「履歴」「Scientific」
// 「足したもの」……)。そして **0.4.1 と 0.1.0 の 2 本には `###` 節が 1 つも
// 無い**——版見出しの下にいきなり散文が続く。安定して在るのは
// **`### 内部の変更`** という 1 つの綴りだけで、これは「利用者向けではない」
// ことを示す側の目印である。だから判定は **「`### 内部の変更` の外に何か
// あるか」**にする。`###` 節が 1 つも無いエントリは、外の判定基準が無い
// ので機械的に「内部の変更だけではない」側へ倒す——**これは意図的に鈍い**。
// 0.4.1 のように実際には利用者向けの変更が無くても、`### 内部の変更` の
// 外に文章がある限り、この検査は「マニュアルを見たか」を求める。求められた
// 側が「見た、要らなかった」と書く場所が下の免除である。
//
// # 免除
//
// 点検した結果、直す必要が無かったなら、その理由をエントリの本文に書けば
// 通る。綴りは:
//
//   マニュアルは点検した。変更は要らない —— 〈理由〉
//
// 正規表現は `MANUAL_EXEMPTION`。**「——」(EM DASH 2 つ)** はこのリポジトリの
// 地の文の決まり文句(CLAUDE.md や CHANGELOG 自身が随所で使っている)に
// 合わせた——新しい記法を持ち込まない。**理由の有無だけを見る**——中身が
// 妥当かは機械には読めないので、**2 文字以上の何か**が続くことだけを要求
// する。「——」の直後が改行や空白だけの**裸の主張は通らない**。理由の
// 「質」を検査できない以上、要求できるのは「無いよりはある」という最低限
// までである。
//
// # 範囲が決められないとき
//
// `git describe --tags --abbrev=0` はタグが 1 本も無い(浅いクローン、
// タグを fetch していないローカル)と失敗する。**そのときに黙って緑を返さ
// ない。** 「前回との差分が無い」と「差分を計算できない」は別の状態で、
// 前者だけが安全に緑を意味する。範囲が決められないときは NG にして、
// 何が足りないか(タグが無い)と直し方(`git fetch --tags`、または
// `MANUAL_FRESHNESS_BASE` 環境変数で基点を明示する)を印字する。
// `MANUAL_FRESHNESS_BASE` は CI がタグの直後にこの検査を走らせる将来や、
// タグ運用そのものを検証したいテストのための逃げ道として用意した——
// 既定は `git describe` に任せ、明示した側が勝つ。
//
// # 読む対象
//
// CHANGELOG.md は**作業木の現在の内容**を読む(`readFileSync`)。コミット前に
// この検査を回し、免除の一文を足してから緑になることを確かめられるように
// するためである——HEAD だけを見ると、コミットするまで自分の追記が
// 検査に反映されない。`docs/manual/` の差分も同じ理由で `git diff <base>`
// (2 引数でなく 1 引数)を使う——これは「base から作業木まで」を見るので、
// コミット前のマニュアル修正も拾う。前回タグの CHANGELOG は
// `git show <base>:CHANGELOG.md` で読む(作業木ではなく、その時点の内容)。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 「内部の変更だけではない」ことを示す節の見出し。**この綴りだけを見る。**
 */
const INTERNAL_SECTION_TITLE = "内部の変更";

/**
 * `## <version> — <date-or-未リリース>` の形。バージョンは空白を含まない
 * 1 トークンとして拾う。区切りは em ダッシュ(`—`)でもハイフン(`-`)でも
 * 読む——`check-version.mjs` の `changelogEntry` と同じ理由で、区切り記号の
 * 揺れをこの検査の役目にしない。
 */
const VERSION_HEADING = /^##[ \t]+(\S+)[ \t]*[—-].*$/gm;

/** `### <title>` の節見出し。 */
const SECTION_HEADING = /^###[ \t]+(.*)$/gm;

/**
 * マニュアルの点検を済ませ、直す必要が無かったときに書く一文。
 *
 * 「——」は EM DASH 2 個(このリポジトリの地の文の決まり文句)。理由は
 * 「——」のあとに**2 文字以上**続くことだけを要求する
 * (`\S[^\n]` で 1 文字目が空白でないこと、2 文字目以降が改行以外である
 * ことを見る)。**理由の妥当性は判定しない**——「無いよりはある」までが
 * 機械で見られる限界である。
 */
export const MANUAL_EXEMPTION =
  /マニュアルは点検した。変更は要らない[ \t]*——[ \t]*\S[^\n]/u;

/**
 * @typedef {{version: string, body: string}} ChangelogEntry
 */

/**
 * CHANGELOG のテキストから、版見出しごとのエントリを切り出す。
 *
 * @param {string} changelogText
 * @returns {ChangelogEntry[]}
 */
export function extractVersionEntries(changelogText) {
  const headings = [...changelogText.matchAll(VERSION_HEADING)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end =
      index + 1 < headings.length
        ? headings[index + 1].index
        : changelogText.length;
    return { version: heading[1], body: changelogText.slice(start, end) };
  });
}

/**
 * このエントリの中身が「内部の変更だけ」ではないか。
 *
 * **`### 内部の変更` の外に何かあれば true。** `###` 節が 1 つも無い
 * エントリ(0.4.1・0.1.0 の形)は、外側の判定基準が無いので**本文が空でない
 * 限り true**(意図的に鈍い側へ倒す——上のファイル冒頭コメント参照)。
 *
 * @param {string} entryBody
 * @returns {boolean}
 */
export function hasNonInternalContent(entryBody) {
  const sections = [...entryBody.matchAll(SECTION_HEADING)];
  if (sections.length === 0) {
    return entryBody.trim().length > 0;
  }
  const preamble = entryBody.slice(0, sections[0].index).trim();
  if (preamble.length > 0) {
    return true;
  }
  return sections.some(
    (section) => section[1].trim() !== INTERNAL_SECTION_TITLE,
  );
}

/**
 * @typedef {{newEntries: string[], missing: string[]}} FreshnessResult
 */

/**
 * 新しく増えたリリース見出しのうち、マニュアルの変更(範囲全体で 1 件でも)
 * も免除の一文(そのエントリ自身)も無いものを集める。
 *
 * @param {{currentChangelog: string, previousChangelog: string,
 *          manualChangedFiles: string[]}} input
 * @returns {FreshnessResult}
 */
export function findMissingManualUpdates({
  currentChangelog,
  previousChangelog,
  manualChangedFiles,
}) {
  const previousVersions = new Set(
    extractVersionEntries(previousChangelog).map((entry) => entry.version),
  );
  const newEntries = extractVersionEntries(currentChangelog).filter(
    (entry) => !previousVersions.has(entry.version),
  );
  const manualChanged = manualChangedFiles.length > 0;

  const missing = [];
  for (const entry of newEntries) {
    if (!hasNonInternalContent(entry.body)) {
      continue;
    }
    if (manualChanged) {
      continue;
    }
    if (MANUAL_EXEMPTION.test(entry.body)) {
      continue;
    }
    missing.push(entry.version);
  }

  return { newEntries: newEntries.map((entry) => entry.version), missing };
}

/**
 * 前回のリリースタグを解決する。**環境変数が勝つ**——タグが無い環境や、
 * 意図的に別の基点で確かめたいテストのための逃げ道。
 *
 * @returns {{base: string, source: string} | null} 決められなければ null。
 */
export function resolveBase(root) {
  const envBase = process.env.MANUAL_FRESHNESS_BASE;
  if (envBase !== undefined && envBase !== "") {
    return { base: envBase, source: "環境変数 MANUAL_FRESHNESS_BASE" };
  }
  try {
    const tag = execFileSync(
      "git",
      ["-C", root, "describe", "--tags", "--abbrev=0"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    return { base: tag, source: "git describe --tags --abbrev=0" };
  } catch {
    return null;
  }
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const resolved = resolveBase(root);

  if (resolved === null) {
    console.error(
      "check:manual-freshness NG — 前回のリリースタグを解決できなかった" +
        "(`git describe --tags --abbrev=0` が失敗)。タグを fetch していない" +
        "浅いクローンでは、範囲が決められないので緑を返さない。" +
        "`git fetch --tags` でタグを取得するか、比較の基点を" +
        "`MANUAL_FRESHNESS_BASE=<ref>` で明示すること。",
    );
    process.exit(1);
    return;
  }

  const { base, source } = resolved;

  let previousChangelog;
  try {
    previousChangelog = execFileSync(
      "git",
      ["-C", root, "show", `${base}:CHANGELOG.md`],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    console.error(
      `check:manual-freshness NG — ${base}(${source})の CHANGELOG.md を` +
        "読めなかった。基点が正しいコミット・タグを指しているか確認すること。",
    );
    process.exit(1);
    return;
  }

  const currentChangelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

  let manualChangedFiles;
  try {
    const output = execFileSync(
      "git",
      ["-C", root, "diff", "--name-only", base, "--", "docs/manual/"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    manualChangedFiles = output.split("\n").filter((line) => line !== "");
  } catch {
    console.error(
      `check:manual-freshness NG — \`git diff ${base} -- docs/manual/\` に` +
        "失敗した。基点が正しいコミット・タグを指しているか確認すること。",
    );
    process.exit(1);
    return;
  }

  const { newEntries, missing } = findMissingManualUpdates({
    currentChangelog,
    previousChangelog,
    manualChangedFiles,
  });

  if (newEntries.length === 0) {
    console.log(
      `check:manual-freshness OK — ${base}(${source})以降、CHANGELOG に` +
        "新しいリリース見出しは無い",
    );
    return;
  }

  if (missing.length > 0) {
    console.error(
      `check:manual-freshness NG — ${base} 以降、CHANGELOG に利用者向けの` +
        `変更を含む新しいリリース見出しが増えたが、docs/manual/ に変更が無い` +
        `(${missing.length} 件): ${missing.join(", ")}`,
    );
    console.error(
      "  docs/manual/ の該当ファイルを見直して直すか、点検して直す必要が" +
        "無かったなら該当エントリの本文に" +
        "「マニュアルは点検した。変更は要らない —— 〈理由〉」を書くこと。",
    );
    process.exit(1);
    return;
  }

  console.log(
    `check:manual-freshness OK — ${base}(${source})以降の新しいリリース` +
      `見出し ${newEntries.length} 件(${newEntries.join(", ")})は、` +
      "docs/manual/ の変更か免除の一文で説明されている",
  );
}

// vitest から import されたときは走らせない(`check-citations.mjs` と同じ作法)。
if (process.argv[1]?.endsWith("check-manual-freshness.mjs")) {
  main();
}
