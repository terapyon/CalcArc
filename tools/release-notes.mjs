// Release の本文に証拠を継ぎ足す(設計書
// `docs/superpowers/specs/2026-08-25-release-gate-design.md` §4)。
//
// **なぜここに在るか。** この処理は 2026-08-25 に `release.yml` のインライン
// シェル(`sed` と `awk`)として書かれ、**それを見張るテストは 0 本だった**。
// 検証は「実物の本文で 3 回試して長さが動かない」という 1 回きりの手作業で、
// これは**次に誰かが触ったときに赤くならない**形である。純関数にして
// `heavy/tests/unit/release-notes.test.ts` が固定する(2026-08-26 の裁定)。
//
// 貼り直しが要るのは、**「Release が既に在る」が通常経路だから**である
// ——GitHub の UI で Release を作る操作がタグを push し、リリースの走行を
// 起こす。v0.4.1 では Release の公開が走行開始の 2 秒前だった。

import { readFileSync } from "node:fs";

/**
 * 証拠の始まりを示す目印。**本文の中でここより後ろは、走行が書いたものと
 * みなして毎回捨てる**——人が目印より後ろに書いた文は残らない。
 */
export const MARKER = "<!-- release-evidence -->";

/**
 * 既存の本文に証拠を継ぎ足した本文を返す。
 *
 * 性質は 3 つで、どれも `heavy/tests/unit/release-notes.test.ts` が固定する。
 *
 * 1. **再走行で二重に積まない**(目印より後ろを捨ててから貼る)
 * 2. **同じ入力からは同じ文字列が出る**
 * 3. **何度掛けても 1 バイトも伸びない**(末尾の空白を落としてから貼る)
 *
 * 実物の本文は CRLF である。目印は**文字列として**探すので、行末が混ざって
 * いても見失わない——`sed` の `^…$` に頼っていた頃の弱点はここで消えている。
 *
 * @param {string} existingBody 既存の本文(GitHub 自動生成の "What's Changed" など)
 * @param {string} evidence 証拠の本文
 * @returns {string}
 */
export function spliceEvidence(existingBody, evidence) {
  const head = String(existingBody).split(MARKER)[0].replace(/\s+$/, "");
  const body = String(evidence).replace(/\s+$/, "");
  const prefix = head === "" ? "" : `${head}\n\n`;
  return `${prefix}${MARKER}\n\n${body}\n`;
}

function main() {
  const [existingPath, evidencePath] = process.argv.slice(2);
  if (!evidencePath) {
    throw new Error("使い方: node tools/release-notes.mjs <既存の本文> <証拠>");
  }
  // 既存の本文が無い(Release がまだ無い)場合は空として扱う。
  let existing = "";
  try {
    existing = readFileSync(existingPath, "utf8");
  } catch {
    existing = "";
  }
  process.stdout.write(spliceEvidence(existing, readFileSync(evidencePath, "utf8")));
}

// vitest から import されたときは走らせない(`check-version.mjs` と同じ作法)。
if (process.argv[1] && process.argv[1].endsWith("release-notes.mjs")) {
  main();
}
