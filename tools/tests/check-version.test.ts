import { describe, expect, it } from "vitest";
import { checkVersions } from "../check-version.mjs";

// 版数が書かれている 6 箇所を、実物と同じ形の最小限で組み立てる。
// **実物と形が違えば検査は何も守らない**ので、綴りは現物から写している。
const cargoToml = (version: string) =>
  [
    "[workspace]",
    'members = ["crates/*"]',
    "",
    "[workspace.package]",
    `version = "${version}"`,
    'edition = "2024"',
    "",
  ].join("\n");

// **`Cargo.lock` は 2 つの crate が版数を持つ。** 前後に他の package が
// 並ぶ形まで写している——**節の切り出しを間違えると、隣の package の
// 版数を読んで黙って緑になる**からである。
const cargoLock = (core: string, wasm = core) =>
  [
    "version = 4",
    "",
    "[[package]]",
    'name = "autocfg"',
    'version = "1.5.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    "",
    "[[package]]",
    'name = "calcarc-core"',
    `version = "${core}"`,
    "dependencies = [",
    ' "proptest",',
    "]",
    "",
    "[[package]]",
    'name = "calcarc-wasm"',
    `version = "${wasm}"`,
    "dependencies = [",
    ' "calcarc-core",',
    "]",
    "",
    "[metadata]",
    'something = "else"',
    "",
  ].join("\n");

const pkgJson = (version: string) =>
  JSON.stringify({ name: "calcarc-web", version }, null, 2);

const readme = (version: string) =>
  [
    "# CalcArc",
    "",
    "## 現在の版",
    "",
    `**${version}（ベータ）** — 変更点は [CHANGELOG.md](CHANGELOG.md) に。`,
    "",
    "## 構成",
    "",
  ].join("\n");

const readmeEn = (version: string) =>
  [
    "# CalcArc",
    "",
    "## Current version",
    "",
    `**${version} (beta)** — Changes are listed in [CHANGELOG.md](CHANGELOG.md).`,
    "",
    "## Layout",
    "",
  ].join("\n");

const changelog = (...entries: [string, string][]) =>
  [
    "# 変更履歴",
    "",
    ...entries.flatMap(([version, when]) => [
      `## ${version} — ${when}`,
      "",
      "本文",
      "",
    ]),
  ].join("\n");

/** 6 箇所すべてが version で揃っている入力。1 つだけ崩して使う。 */
const consistent = (version: string, when = "未リリース") => ({
  cargoToml: cargoToml(version),
  cargoLock: cargoLock(version),
  pkgJson: pkgJson(version),
  readme: readme(version),
  readmeEn: readmeEn(version),
  changelog: changelog([version, when], ["0.3.0", "2026-08-20"]),
});

const where = (problems: { where: string }[]) => problems.map((p) => p.where);

describe("普段の検査（タグを渡さないとき）", () => {
  it("6 箇所が揃っていれば何も言わない", () => {
    expect(checkVersions(consistent("0.4.0"))).toEqual([]);
  });

  it("Cargo.toml だけ古いと Cargo.toml を指す", () => {
    const input = { ...consistent("0.4.0"), cargoToml: cargoToml("0.3.1") };
    expect(where(checkVersions(input))).toEqual(["Cargo.toml"]);
  });

  it("README.md だけ古いと README.md を指す", () => {
    const input = { ...consistent("0.4.0"), readme: readme("0.3.1") };
    expect(where(checkVersions(input))).toEqual(["README.md"]);
  });

  it("README.en.md だけ古いと README.en.md を指す", () => {
    const input = { ...consistent("0.4.0"), readmeEn: readmeEn("0.3.1") };
    expect(where(checkVersions(input))).toEqual(["README.en.md"]);
  });

  it("CHANGELOG にその版の見出しが無ければ指す", () => {
    const input = {
      ...consistent("0.4.0"),
      changelog: changelog(["0.3.0", "2026-08-20"]),
    };
    expect(where(checkVersions(input))).toEqual(["CHANGELOG.md"]);
  });

  it("CHANGELOG が「未リリース」でも、タグを渡さない限り通す", () => {
    expect(checkVersions(consistent("0.4.0", "未リリース"))).toEqual([]);
  });

  it("Cargo.toml から version を読めなければ、黙って通さない", () => {
    const input = { ...consistent("0.4.0"), cargoToml: "[workspace]\n" };
    expect(where(checkVersions(input))).toEqual(["Cargo.toml"]);
  });

  it("Cargo.lock の calcarc-core だけ古いと、その crate を指す", () => {
    const input = { ...consistent("0.4.0"), cargoLock: cargoLock("0.3.1") };
    // **両方古い**ので 2 件出る。`cargoLock(core)` は wasm も同じ版にする。
    expect(where(checkVersions(input))).toEqual([
      "Cargo.lock (calcarc-core)",
      "Cargo.lock (calcarc-wasm)",
    ]);
  });

  it("Cargo.lock の片方だけ古いと、その片方だけを指す", () => {
    // **2 つとも見ていることの検査。** 片方しか見ていなければ、
    // ここが 0 件（＝緑）になるか、間違った crate を指す。
    const input = {
      ...consistent("0.4.0"),
      cargoLock: cargoLock("0.4.0", "0.3.1"),
    };
    expect(where(checkVersions(input))).toEqual(["Cargo.lock (calcarc-wasm)"]);
  });

  it("Cargo.lock に crate が見つからなければ、黙って通さない", () => {
    // **改名や crate の追加で形が変わったとき、緑のまま素通りさせない。**
    const input = { ...consistent("0.4.0"), cargoLock: "version = 4\n" };
    expect(where(checkVersions(input))).toEqual([
      "Cargo.lock (calcarc-core)",
      "Cargo.lock (calcarc-wasm)",
    ]);
  });

  it("Cargo.lock の隣の package の版数を読まない", () => {
    // **節の切り出しが甘いと、`autocfg` の 1.5.0 を拾って落ちる**——
    // 揃っているのに赤くなる形。ここが緑であることが、その否定である。
    expect(checkVersions(consistent("0.4.0"))).toEqual([]);
  });

  it("package.json から version を読めなければ、黙って通さない", () => {
    const input = { ...consistent("0.4.0"), pkgJson: "{}" };
    // 出所が読めないので、それを基準にしていた 3 箇所は判定できない。
    // **判定できないことを 1 件として言う**——0 件は「揃っている」の意味だから。
    expect(where(checkVersions(input))).toEqual(["web/package.json"]);
  });
});

describe("タグを打ったときの検査", () => {
  it("タグと 6 箇所が一致し、CHANGELOG に日付が入っていれば通す", () => {
    const input = { ...consistent("0.4.0", "2026-08-25"), tag: "v0.4.0" };
    expect(checkVersions(input)).toEqual([]);
  });

  it("v0.4.0 が実際に出荷された形——「未リリース」のままなら止める", () => {
    const input = { ...consistent("0.4.0", "未リリース"), tag: "v0.4.0" };
    expect(where(checkVersions(input))).toEqual(["CHANGELOG.md"]);
  });

  it("日付の形をしていない書きかけも止める", () => {
    const input = { ...consistent("0.4.0", "2026-08"), tag: "v0.4.0" };
    expect(where(checkVersions(input))).toEqual(["CHANGELOG.md"]);
  });

  it("タグだけ先に進んでいると、揃っている 6 箇所すべてを指す", () => {
    const input = { ...consistent("0.4.0", "2026-08-25"), tag: "v0.5.0" };
    expect(where(checkVersions(input))).toEqual([
      "Cargo.toml",
      "Cargo.lock (calcarc-core)",
      "Cargo.lock (calcarc-wasm)",
      "web/package.json",
      "README.md",
      "README.en.md",
      "CHANGELOG.md",
    ]);
  });

  it("先頭の v を剥がして比べる——v の無いタグでも同じ判定になる", () => {
    const input = { ...consistent("0.4.0", "2026-08-25"), tag: "0.4.0" };
    expect(checkVersions(input)).toEqual([]);
  });
});

describe("CHANGELOG の日付（2026-08-26、B-6）", () => {
  // 自分のコメントは「**日付が入っている（「未リリース」でない）**ことまで見る」
  // と言っているのに、判定は行全体の完全一致だった。**注記つきの日付が偽赤に
  // なる**——検査が自分の宣言より厳しいのは、宣言のほうが読まれるので危ない。
  const withEntry = (entry: string) =>
    checkVersions({
      cargoToml: cargoToml("0.5.0"),
      cargoLock: cargoLock("0.5.0"),
      pkgJson: pkgJson("0.5.0"),
      readme: readme("0.5.0"),
      readmeEn: readmeEn("0.5.0"),
      changelog: ["# 変更履歴", "", `## 0.5.0 — ${entry}`, "", "本文", ""].join(
        "\n",
      ),
      tag: "v0.5.0",
    });

  it("日付だけなら通る", () => {
    expect(withEntry("2026-08-26")).toEqual([]);
  });

  it("日付のあとに注記があっても通る", () => {
    expect(withEntry("2026-08-26 (hotfix)")).toEqual([]);
  });

  it("「未リリース」は通さない", () => {
    expect(withEntry("未リリース")).not.toEqual([]);
  });

  it("日付で始まっていないものは通さない", () => {
    expect(withEntry("(hotfix) 2026-08-26")).not.toEqual([]);
  });
});
