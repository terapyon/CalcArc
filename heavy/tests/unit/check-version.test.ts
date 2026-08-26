import { describe, expect, it } from "vitest";
import { checkVersions } from "../../../tools/check-version.mjs";

// 版数が書かれている 5 箇所を、実物と同じ形の最小限で組み立てる。
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

/** 5 箇所すべてが version で揃っている入力。1 つだけ崩して使う。 */
const consistent = (version: string, when = "未リリース") => ({
  cargoToml: cargoToml(version),
  pkgJson: pkgJson(version),
  readme: readme(version),
  readmeEn: readmeEn(version),
  changelog: changelog([version, when], ["0.3.0", "2026-08-20"]),
});

const where = (problems: { where: string }[]) => problems.map((p) => p.where);

describe("普段の検査（タグを渡さないとき）", () => {
  it("5 箇所が揃っていれば何も言わない", () => {
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

  it("package.json から version を読めなければ、黙って通さない", () => {
    const input = { ...consistent("0.4.0"), pkgJson: "{}" };
    // 出所が読めないので、それを基準にしていた 3 箇所は判定できない。
    // **判定できないことを 1 件として言う**——0 件は「揃っている」の意味だから。
    expect(where(checkVersions(input))).toEqual(["web/package.json"]);
  });
});

describe("タグを打ったときの検査", () => {
  it("タグと 4 箇所が一致し、CHANGELOG に日付が入っていれば通す", () => {
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

  it("タグだけ先に進んでいると、揃っている 4 箇所すべてを指す", () => {
    const input = { ...consistent("0.4.0", "2026-08-25"), tag: "v0.5.0" };
    expect(where(checkVersions(input))).toEqual([
      "Cargo.toml",
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
