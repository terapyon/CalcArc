// 版数が書かれている 5 箇所が食い違っていないことを検査する。
//
// **版数の出所は package.json**(0.2.0 設計書 §4)——フッタはシェルが持ち、
// シェルは WASM を読まないので、core_version() の非同期な経路は使えない。
// ただし手で書き換える運用なので、一部だけ上げる事故が起きる。それを機械で
// 捕まえるのがこのスクリプトである。
//
// **見るのは 5 箇所**: `Cargo.toml` / `web/package.json` /
// `README.md` の「現在の版」/ `README.en.md` の「Current version」/
// `CHANGELOG.md` の見出し。
//
// **タグを渡すと検査が 1 段厳しくなる**(`--tag v0.5.0`)。普段は CHANGELOG の
// 「未リリース」を通すが、タグを打つときは通さない——**日付を入れ忘れたまま
// 出荷した実例が 2 回ある**(v0.3.1 と v0.4.0 は `## 0.4.0 — 未リリース` の
// まま出ている)。日付の**値**は見ない。タグの打ち直しや再実行で日をまたぐと
// 偽の赤になるからである。
//
// check-sw.mjs と同じ流儀: web/scripts に置き、pnpm から呼び、CI が回す。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `0.4.0` の形。前後は問わない——自由文の中から拾うため。 */
const SEMVER = /\d+\.\d+\.\d+/;

/** `2026-08-25` の形。日付が入っているかだけを見て、値は問わない。 */
// **日付で始まっていれば通す。** 行全体の完全一致にしていたので、
// `— 2026-08-26 (hotfix)` のような注記つきが偽赤になっていた——この検査の
// コメントは「日付が入っている(「未リリース」でない)ことまで見る」と言って
// いるので、**判定を宣言に合わせる**(2026-08-26、B-6)。
const RELEASED = /^\d{4}-\d{2}-\d{2}\b/;

const forRegExp = (literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// workspace.package の version を読む。TOML パーサを足さずに済ませる——
// この 1 行のためだけに依存を増やす理由がない。**節を切り出してから読む**のは、
// 将来ほかの節が先に来たときに黙って別の値を比べないためである。
//
// **先読みではなく分割で切る。** `(?=^\[)` は次の節の存在を要求するので、
// `[workspace.package]` がファイル末尾の節だと読めない(実測)。分割なら
// 末尾でも読める。行の形が変わったらマッチせず、null を返す。
const versionInCargo = (text) => {
  const afterHeading = text.split(/^\[workspace\.package\]\s*$/m)[1] ?? "";
  const section = afterHeading.split(/^\[/m)[0];
  const matched = section.match(/^version\s*=\s*"([^"]+)"/m);
  return matched === null ? null : matched[1];
};

const versionInPackageJson = (text) => {
  try {
    const version = JSON.parse(text).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
};

// README の版数は自由文の中にある(`**0.4.0（ベータ）**`)。**見出しで節を
// 切ってから拾う**のは、文書のどこか別の場所にある版数めいた数(依存の版など)を
// 黙って読まないためである。
const versionUnderHeading = (text, heading) => {
  const after = text.split(new RegExp(`^${forRegExp(heading)}\\s*$`, "m"))[1];
  if (after === undefined) return null;
  const matched = after.split(/^## /m)[0].match(SEMVER);
  return matched === null ? null : matched[0];
};

// `## 0.4.0 — 2026-08-20` の右側を返す。見出しが無ければ null。
// 区切りは em ダッシュだが、ハイフンでも読む——**区切り記号の揺れで
// 「見出しが無い」と言うのは、この検査の役目ではない**。
const changelogEntry = (text, version) => {
  const matched = text.match(
    new RegExp(`^##\\s*${forRegExp(version)}\\s*[—-]\\s*(.*)$`, "m"),
  );
  return matched === null ? null : matched[1].trim();
};

/**
 * 5 箇所を突き合わせ、食い違いを配列で返す。空配列なら揃っている。
 *
 * `tag` を渡すと、**揃っていることに加えてタグ名と一致すること**を見る。
 * `v` から始まっていてもいなくても同じ判定になる。
 *
 * @param {{cargoToml: string, pkgJson: string, readme: string,
 *          readmeEn: string, changelog: string, tag?: string}} sources
 * @returns {{where: string, message: string}[]}
 */
export function checkVersions({
  cargoToml,
  pkgJson,
  readme,
  readmeEn,
  changelog,
  tag,
}) {
  const problems = [];
  const add = (where, message) => problems.push({ where, message });

  const pkg = versionInPackageJson(pkgJson);

  // **基準が読めないなら、ほかの 4 箇所の判定はできない。** 判定できないことを
  // 1 件として言う——0 件は「揃っている」の意味だからである。
  if (tag === undefined && pkg === null) {
    add(
      "web/package.json",
      "version を読めなかった。ここが版数の出所なので、ほかの 4 箇所も判定できない",
    );
    return problems;
  }

  const want = tag === undefined ? pkg : tag.replace(/^v/, "");
  const because = tag === undefined ? "package.json" : `タグ ${tag}`;

  const compare = (where, found) => {
    if (found === null) {
      add(where, "版数を読めなかった。書き方が変わっていないか確認すること");
      return;
    }
    if (found !== want) {
      add(where, `${found} だが、${because} は ${want} と言っている`);
    }
  };

  compare("Cargo.toml", versionInCargo(cargoToml));
  compare("web/package.json", pkg);
  compare("README.md", versionUnderHeading(readme, "## 現在の版"));
  compare("README.en.md", versionUnderHeading(readmeEn, "## Current version"));

  const entry = changelogEntry(changelog, want);
  if (entry === null) {
    add("CHANGELOG.md", `${want} の見出しが無い(\`## ${want} — …\` を足すこと)`);
  } else if (tag !== undefined && !RELEASED.test(entry)) {
    add(
      "CHANGELOG.md",
      `\`## ${want} — ${entry}\` のまま。タグを打つなら日付(YYYY-MM-DD)を入れること`,
    );
  }

  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = argv.findIndex((a) => a === "--tag" || a.startsWith("--tag="));
  const tag =
    flag === -1
      ? undefined
      : argv[flag].startsWith("--tag=")
        ? argv[flag].slice("--tag=".length)
        : argv[flag + 1];

  // **値の無い `--tag` を黙って「タグ無し」に落とさない。** 落とすと、CI が
  // 渡し忘れたときに緩い検査が緑で通り、それに気づけない。
  if (flag !== -1 && (tag === undefined || tag === "")) {
    console.error("check:version NG — --tag に値がない");
    process.exit(1);
  }

  // `tools/check-version.mjs` から見て、リポジトリの根は 1 つ上である
  // (2026-08-26 に `web/scripts/` から移した。**`web` は根から降りて指す**
  // ——`tools` が `web` の中に居た頃の導出のままだと、根が 1 段ずれる)。
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const web = join(root, "web");
  const read = (...parts) => readFileSync(join(...parts), "utf8");
  const pkgJson = read(web, "package.json");

  const problems = checkVersions({
    cargoToml: read(root, "Cargo.toml"),
    pkgJson,
    readme: read(root, "README.md"),
    readmeEn: read(root, "README.en.md"),
    changelog: read(root, "CHANGELOG.md"),
    tag,
  });

  if (problems.length > 0) {
    console.error("check:version NG — 版数が食い違っている");
    for (const { where, message } of problems) {
      console.error(`  ${where}: ${message}`);
    }
    process.exit(1);
  }

  const version = versionInPackageJson(pkgJson);
  console.log(
    tag === undefined
      ? `version ${version} (5 箇所が一致)`
      : `version ${version} (5 箇所が一致し、タグ ${tag} とも一致)`,
  );
}

// **import されたときは走らない。** テストがこのファイルを読むだけで
// リポジトリを読みに行っては困る。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
