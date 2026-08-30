// **走行の前後で、追跡下の全ファイルが index と一致することを確かめる。**
//
// ## なぜ要るか
//
// 2026-08-30、この作業台で**作業ツリーのファイルが 3 バイト壊れた**
// （`corrections-000.json` に 1、`complex-000.json` に 2）。**3 つとも
// 単一ビットの反転**で、**長さは変わらなかった**。
//
// **それまで健全性の根拠にしていた 2 つが、どちらも見落とした:**
//
// - **`git status`** — 長さが同じなので stat キャッシュが「変更なし」と言う
// - **`json.load()` が通ること** — `'4'` が `'5'` になった破損は **JSON として
//   完全に妥当**で、**パースでは原理的に見つからない**
//
// **壊れた入力の上で出た緑は、緑の意味を持たない。** そして**あとから
// 見分けることはできない**——走行が終わってから照合しても、
// 「走行中は健全だった」とは言えない。
//
// **だから走行を挟む。** 言えるようになるのは
// **「この走行のあいだ、入力は index と一致していた」**である。
//
// ## なぜ「手順を書く」ではなく道具にしたか
//
// **規律を書いたら、同じコミットで番人を置く**（CLAUDE.md）。
// **「走行の前後で照合すること」という文は、破っても赤くならない。**
// この wrapper は**照合そのものを走行の一部にする**ので、
// **忘れるという壊れ方が無い。**
//
// ## 使い方
//
// ```bash
// node tools/verified-run.mjs -- cargo test --workspace
// node tools/verified-run.mjs -- pnpm --dir heavy heavy
// ```
//
// **走行後の照合が落ちたら、走行が緑でも終了コードは非 0 である**
// ——**その緑は信用できないからである。**

import { spawnSync } from "node:child_process";

/** `git ls-files -s` の 1 行から `(sha, path)` を取る。 */
export function parseIndexLine(line) {
  // 形式: `<mode> <sha> <stage>\t<path>`
  const tab = line.indexOf("\t");
  if (tab < 0) {
    return null;
  }
  const fields = line.slice(0, tab).split(" ");
  if (fields.length < 3) {
    return null;
  }
  return { sha: fields[1], path: line.slice(tab + 1) };
}

/**
 * index の sha と、いま計算した sha を突き合わせる。
 *
 * **数え上げをここに閉じ込める。** `cmp` の既定が最初の相違点で止まるように、
 * **道具は自分が何を見ていないかを言わない**——だから**全件を返す関数**にして、
 * 呼び出し側が「1 件目で止める」を選べないようにする（2026-08-30 の教訓）。
 */
export function compareShas(entries, hashed) {
  if (entries.length !== hashed.length) {
    throw new Error(
      `照合できない: index に ${entries.length} 件、計算した sha が ${hashed.length} 件。` +
        "数が合わないまま比べると、ずれた対で「一致」と言ってしまう",
    );
  }
  const mismatches = [];
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].sha !== hashed[i]) {
      mismatches.push({ path: entries[i].path, index: entries[i].sha, disk: hashed[i] });
    }
  }
  return { checked: entries.length, mismatches };
}

function git(args, input) {
  const run = spawnSync("git", args, {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗した: ${run.stderr?.trim()}`);
  }
  return run.stdout;
}

/** 追跡下の全ファイルを照合する。**ディスクから読み直して sha を取り直す。** */
export function verifyWorktree() {
  const entries = git(["ls-files", "-s"])
    .split("\n")
    .map(parseIndexLine)
    .filter((entry) => entry !== null)
    // **削除されたファイルは飛ばす。** `git status` の仕事であって、
    // ここが見たいのは「在るファイルの中身が化けていないか」である。
    .filter((entry) => existsOnDisk(entry.path));
  if (entries.length === 0) {
    throw new Error("追跡下のファイルが 1 件も無い。照合が空振りしている");
  }
  const hashed = git(["hash-object", "--stdin-paths"], `${entries.map((e) => e.path).join("\n")}\n`)
    .split("\n")
    .filter((line) => line !== "");
  return compareShas(entries, hashed);
}

function existsOnDisk(path) {
  return spawnSync("test", ["-f", path]).status === 0;
}

function report(when) {
  const { checked, mismatches } = verifyWorktree();
  if (mismatches.length === 0) {
    console.log(`[${when}] ${checked} / ${checked} 一致`);
    return true;
  }
  console.error(`[${when}] ${checked - mismatches.length} / ${checked} 一致。**${mismatches.length} 件が index と違う**:`);
  for (const one of mismatches) {
    console.error(`  ${one.path}  index ${one.index}  ディスク ${one.disk}`);
  }
  console.error("  復元は `rm <path> && git checkout HEAD -- <path>`。");
  console.error("  **`git checkout --` だけでは戻らない**——git が「変更なし」と思っている。");
  return false;
}

function main() {
  const separator = process.argv.indexOf("--");
  const command = separator < 0 ? [] : process.argv.slice(separator + 1);
  if (command.length === 0) {
    // **引数が無ければ照合だけして終わる。** 走行の外でも使えるようにする。
    process.exit(report("照合") ? 0 : 1);
  }
  if (!report("走行前")) {
    console.error("**走行しない。** 壊れた入力の上で出た緑は、緑の意味を持たない。");
    process.exit(1);
  }
  const run = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  const after = report("走行後");
  if (!after) {
    console.error("**走行中に中身が変わった。この走行の結果は、緑でも赤でも信用できない。**");
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}

if (process.argv[1]?.endsWith("verified-run.mjs")) {
  main();
}
