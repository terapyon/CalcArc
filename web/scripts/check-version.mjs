// Cargo と package.json の版数が一致することを検査する。
//
// **版数の出所は package.json**(0.2.0 設計書 §4)——フッタはシェルが持ち、
// シェルは WASM を読まないので、core_version() の非同期な経路は使えない。
// ただし 2 箇所を手で書き換える運用なので、片方だけ上げる事故が起きる。
// それを機械で捕まえるのがこのスクリプトである。
//
// check-sw.mjs と同じ流儀: web/scripts に置き、pnpm から呼び、CI が回す。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..");

const pkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;

// workspace.package の version を読む。TOML パーサを足さずに済ませる——
// この 1 行のためだけに依存を増やす理由がない。**節を切り出してから読む**のは、
// 将来ほかの節が先に来たときに黙って別の値を比べないためである。
//
// **先読みではなく分割で切る。** `(?=^\[)` は次の節の存在を要求するので、
// `[workspace.package]` がファイル末尾の節だと読めない(実測)。分割なら
// 末尾でも読める。行の形が変わったらマッチせず、下の null 検査で落ちる。
const cargoToml = readFileSync(join(root, "Cargo.toml"), "utf8");
const afterHeading = cargoToml.split(/^\[workspace\.package\]\s*$/m)[1] ?? "";
const section = afterHeading.split(/^\[/m)[0];
const matched = section.match(/^version\s*=\s*"([^"]+)"/m);

if (matched === null) {
  console.error(
    "Cargo.toml から version を読めなかった。行の形が変わっていないか確認すること。",
  );
  process.exit(1);
}

const cargo = matched[1];

if (cargo !== pkg) {
  console.error(
    `版数が食い違っている: Cargo.toml=${cargo} web/package.json=${pkg}\n` +
      "0.2.0 設計書 §4 のとおり、2 箇所を同じ値に揃えること。",
  );
  process.exit(1);
}

console.log(`version ${pkg} (Cargo.toml と web/package.json が一致)`);
