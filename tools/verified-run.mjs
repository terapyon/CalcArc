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
// ## ★ この道具が「番人」でない範囲を、先に書いておく
//
// **規律を書いたら、同じコミットで番人を置く**（CLAUDE.md）。**この wrapper は、
// 番人の条件を半分しか満たしていない**——**呼べば照合が走行の一部になるが、
// 呼ばないことは赤くならない。** **CI は素の `pnpm heavy` を回しており、
// ここを通らない。**
//
// **通していないのは意図してである。** 化けが出ているのは**この作業台だけ**で
// （2026-08-30 の 3 バイト。[known-flaky-tests.md] を見よ）、**CI の runner は
// 走行ごとに作り直される。** **手元の症状のために、毎回の CI に段を増やさない。**
//
// **代わりに守るもの**: `heavy/package.json` の `heavy:verified` /
// `heavy:ui:verified` / `verify`。**手元で長い走行を回すときは、そちらを打つ。**
// **「照合を挟んだ」と報告に書くときは、この道具の印字を貼ること**
// ——「挟んだ」という文は、印字が無ければ確かめられない。
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
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * **リポジトリの根。** `git ls-files` が返す path は**根からの相対**なので、
 * **どこから呼ばれても根を基準に解決する。**
 *
 * **これが無いと、サブディレクトリから呼んだときに別のファイルを見る**
 * ——2026-08-30、`heavy/` から呼んで `.npmrc` が
 * `web/.npmrc` ではなく `heavy/.npmrc` に解決され、`git hash-object` が
 * 「そのようなファイルはありません」で落ちた。**落ちたのは運が良かった**
 * ——**同名のファイルが両方に在れば、黙って違うものを照合していた。**
 */
const ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).stdout.trim();

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
      mismatches.push({
        path: entries[i].path,
        index: entries[i].sha,
        disk: hashed[i],
      });
    }
  }
  return { checked: entries.length, mismatches };
}

function git(args, input) {
  const run = spawnSync("git", args, {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: ROOT,
  });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗した: ${run.stderr?.trim()}`);
  }
  return run.stdout;
}

/**
 * `git status --porcelain` が挙げた path の集合。
 *
 * **これは「git が変更に気づいているファイル」である。** 除くために使う
 * ——**この道具が見たいのは、git が気づいていない変化のほう**だからである。
 */
export function editedPaths(porcelain) {
  const found = new Set();
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const path = line.slice(3);
    // 改名は `旧 -> 新`。両方を除く。
    for (const one of path.split(" -> ")) {
      found.add(one.replace(/^"|"$/g, ""));
    }
  }
  return found;
}

/**
 * 追跡下のファイルを照合する。**ディスクから読み直して sha を取り直す。**
 *
 * **★ 編集中のファイルは除く。** そうしないと、**この道具は普通の作業を
 * 全部止めてしまい、使われずに迂回される**（2026-08-30、置いた直後に
 * 自分の編集で止まった）。
 *
 * **除いて何が残るか**——**「git が変更なしと言っているのに、中身が違う」**
 * である。**それがこの作業台で 3 回起きた形そのもの**であり、
 * **`git status` の死角そのもの**である（stat が一致すると中身を読まない）。
 *
 * **★ 埋まらない穴を書いておく。** **編集中のファイルが同時に化けたら、
 * ここは見つけない。** 走行の入力が生成物（`corpus/generated/` など）で、
 * それを直前に作り直していれば、**その走行はこの検査の外にある。**
 * **その場合は、作り直してからコミットし、きれいな木で走らせること。**
 */
export function verifyWorktree() {
  const edited = editedPaths(git(["status", "--porcelain"]));
  const entries = git(["ls-files", "-s"])
    .split("\n")
    .map(parseIndexLine)
    .filter((entry) => entry !== null)
    // **削除されたファイルは飛ばす。** `git status` の仕事であって、
    // ここが見たいのは「在るファイルの中身が化けていないか」である。
    .filter((entry) => existsOnDisk(entry.path))
    .filter((entry) => !edited.has(entry.path));
  if (entries.length === 0) {
    throw new Error("追跡下のファイルが 1 件も無い。照合が空振りしている");
  }
  const hashed = git(
    ["hash-object", "--stdin-paths"],
    `${entries.map((e) => e.path).join("\n")}\n`,
  )
    .split("\n")
    .filter((line) => line !== "");
  const found = compareShas(entries, hashed);
  return { ...found, skipped: edited.size };
}

function existsOnDisk(path) {
  return existsSync(resolve(ROOT, path));
}

function report(when) {
  const { checked, mismatches, skipped } = verifyWorktree();
  // **除いた数も印字する。** 黙って除くと、**「全部見た」と読まれる**
  // ——道具は自分が何を見ていないかを言わない、というのが今日の教訓である。
  const note = skipped === 0 ? "" : `（編集中の ${skipped} 件は対象外）`;
  if (mismatches.length === 0) {
    console.log(`[${when}] ${checked} / ${checked} 一致${note}`);
    return true;
  }
  console.error(
    `[${when}] ${checked - mismatches.length} / ${checked} 一致。**${mismatches.length} 件が index と違う**:`,
  );
  for (const one of mismatches) {
    console.error(`  ${one.path}  index ${one.index}  ディスク ${one.disk}`);
  }
  console.error("  復元は `rm <path> && git checkout HEAD -- <path>`。");
  console.error(
    "  **`git checkout --` だけでは戻らない**——git が「変更なし」と思っている。",
  );
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
    console.error(
      "**走行しない。** 壊れた入力の上で出た緑は、緑の意味を持たない。",
    );
    process.exit(1);
  }
  const run = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  const after = report("走行後");
  if (!after) {
    console.error(
      "**走行中に中身が変わった。この走行の結果は、緑でも赤でも信用できない。**",
    );
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}

if (process.argv[1]?.endsWith("verified-run.mjs")) {
  main();
}
