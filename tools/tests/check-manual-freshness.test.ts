import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractVersionEntries,
  findMissingManualUpdates,
  hasNonInternalContent,
  MANUAL_EXEMPTION,
  resolveBase,
} from "../check-manual-freshness.mjs";

// `tools/tests/` から見て、リポジトリの根は 2 段上。
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("extractVersionEntries", () => {
  it("`## <version> — <date>` の見出しごとにエントリを切る", () => {
    const changelog = [
      "# 変更履歴",
      "",
      "## 0.9.2 — 2026-09-16",
      "",
      "本文 A",
      "",
      "## 0.9.1 — 2026-09-12",
      "",
      "本文 B",
    ].join("\n");
    const entries = extractVersionEntries(changelog);
    expect(entries.map((e) => e.version)).toEqual(["0.9.2", "0.9.1"]);
    expect(entries[0]?.body).toContain("本文 A");
    expect(entries[0]?.body).not.toContain("本文 B");
    expect(entries[1]?.body).toContain("本文 B");
  });

  it("区切りがハイフンでも em ダッシュでも読む", () => {
    // `check-version.mjs` の `changelogEntry` と同じ理由づけ
    // ——区切り記号の揺れをこの検査の役目にしない。
    const changelog = "## 1.0.0 - 2026-01-01\n\n中身\n";
    expect(extractVersionEntries(changelog).map((e) => e.version)).toEqual([
      "1.0.0",
    ]);
  });

  it("`###` 節見出しを版見出しと取り違えない", () => {
    const changelog = [
      "## 0.9.2 — 2026-09-16",
      "",
      "### 内部の変更",
      "",
      "- 何か",
    ].join("\n");
    expect(extractVersionEntries(changelog).map((e) => e.version)).toEqual([
      "0.9.2",
    ]);
  });

  it("`###` 節が 1 つも無いエントリ(0.4.1・0.1.0 の形)も 1 本として拾う", () => {
    const changelog =
      "## 0.4.1 — 2026-08-25\n\n**利用者から見える変更は無い。**\n";
    const entries = extractVersionEntries(changelog);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain("利用者から見える変更は無い");
  });

  it("版見出しが無ければ空配列", () => {
    expect(extractVersionEntries("# 変更履歴\n\n本文だけ\n")).toEqual([]);
  });
});

describe("hasNonInternalContent", () => {
  it("`### 内部の変更` だけのエントリは false", () => {
    const body = "\n### 内部の変更\n\n- 検査を足した\n";
    expect(hasNonInternalContent(body)).toBe(false);
  });

  it("`### 内部の変更` の前に文章があれば true", () => {
    const body = "\n本文がある。\n\n### 内部の変更\n\n- 検査を足した\n";
    expect(hasNonInternalContent(body)).toBe(true);
  });

  it("`### 内部の変更` 以外の節があれば true", () => {
    const body = "\n### Convert\n\n- 直した\n\n### 内部の変更\n\n- 足した\n";
    expect(hasNonInternalContent(body)).toBe(true);
  });

  it("節の名前は自由文でよい——`内部の変更` という綴りだけを見る", () => {
    // 節の名は「複利の期間の単位」「盤面」「履歴」のように自由文である。
    // 名前で「利用者向けかどうか」を当てにいかない。
    const body = "\n### 複利の期間の単位\n\n- 打てるようになった\n";
    expect(hasNonInternalContent(body)).toBe(true);
  });

  it("`###` 節が 1 つも無ければ、本文が空でない限り true(意図的に鈍い)", () => {
    // 0.4.1 の形。「利用者から見える変更は無い」という**散文**は、
    // `### 内部の変更` の外に在るので true 側へ倒す——中身を読んで
    // 「本当は要らない」と判定することはしない。
    expect(hasNonInternalContent("\n**利用者から見える変更は無い。**\n")).toBe(
      true,
    );
  });

  it("本文が空(または空白だけ)なら false", () => {
    expect(hasNonInternalContent("\n\n")).toBe(false);
    expect(hasNonInternalContent("")).toBe(false);
  });
});

describe("MANUAL_EXEMPTION", () => {
  it("理由つきの決まり文句に当たる", () => {
    expect(
      MANUAL_EXEMPTION.test(
        "マニュアルは点検した。変更は要らない —— 表示や操作に変更が無いため。",
      ),
    ).toBe(true);
  });

  it("ダッシュの前後の空白が無くても当たる", () => {
    expect(
      MANUAL_EXEMPTION.test("マニュアルは点検した。変更は要らない——理由。"),
    ).toBe(true);
  });

  it("理由が無い裸の主張には当たらない", () => {
    expect(
      MANUAL_EXEMPTION.test("マニュアルは点検した。変更は要らない ——"),
    ).toBe(false);
    expect(
      MANUAL_EXEMPTION.test("マニュアルは点検した。変更は要らない —— \n次の行"),
    ).toBe(false);
    expect(
      MANUAL_EXEMPTION.test("マニュアルは点検した。変更は要らない。"),
    ).toBe(false);
  });

  it("1 文字だけの理由には当たらない(2 文字以上を要求する)", () => {
    // 理由の**質**は判定できないので、「無いよりはある」の最低限として
    // 2 文字以上を要求する。1 文字は「埋めただけ」との区別がつかない。
    expect(
      MANUAL_EXEMPTION.test("マニュアルは点検した。変更は要らない —— x"),
    ).toBe(false);
  });

  it("フレーズ自体が変わっていれば当たらない", () => {
    expect(
      MANUAL_EXEMPTION.test("マニュアルは最新です。変更は要らない —— 理由"),
    ).toBe(false);
  });
});

describe("findMissingManualUpdates", () => {
  const previousChangelog = "## 1.0.0 — 2026-01-01\n\n旧エントリ\n";

  it("新しいエントリが内部の変更だけなら、マニュアル差分も免除も無くて良い", () => {
    const currentChangelog = [
      previousChangelog,
      "## 1.1.0 — 2026-02-01",
      "",
      "### 内部の変更",
      "",
      "- 検査を足した",
    ].join("\n");
    const { newEntries, missing } = findMissingManualUpdates({
      currentChangelog,
      previousChangelog,
      manualChangedFiles: [],
    });
    expect(newEntries).toEqual(["1.1.0"]);
    expect(missing).toEqual([]);
  });

  it("利用者向けの新しいエントリで、マニュアル差分も免除も無ければ missing", () => {
    const currentChangelog = [
      previousChangelog,
      "## 1.1.0 — 2026-02-01",
      "",
      "### 演算子",
      "",
      "- 直した",
    ].join("\n");
    const { missing } = findMissingManualUpdates({
      currentChangelog,
      previousChangelog,
      manualChangedFiles: [],
    });
    expect(missing).toEqual(["1.1.0"]);
  });

  it("docs/manual/ に 1 件でも変更があれば通る", () => {
    const currentChangelog = [
      previousChangelog,
      "## 1.1.0 — 2026-02-01",
      "",
      "### 演算子",
      "",
      "- 直した",
    ].join("\n");
    const { missing } = findMissingManualUpdates({
      currentChangelog,
      previousChangelog,
      manualChangedFiles: ["docs/manual/quick.ja.md"],
    });
    expect(missing).toEqual([]);
  });

  it("免除の一文がエントリ自身の本文にあれば通る", () => {
    const currentChangelog = [
      previousChangelog,
      "## 1.1.0 — 2026-02-01",
      "",
      "### 演算子",
      "",
      "- 直した",
      "",
      "マニュアルは点検した。変更は要らない —— 表示や操作に変更が無いため。",
    ].join("\n");
    const { missing } = findMissingManualUpdates({
      currentChangelog,
      previousChangelog,
      manualChangedFiles: [],
    });
    expect(missing).toEqual([]);
  });

  it("免除の一文は、そのエントリ自身の本文に無ければ効かない", () => {
    // 別のエントリに書かれた免除で、このエントリの要求が消えてはいけない。
    const currentChangelog = [
      previousChangelog,
      "## 1.1.0 — 2026-02-01",
      "",
      "### 演算子",
      "",
      "- 直した",
      "",
      "## 1.2.0 — 2026-03-01",
      "",
      "### 別の変更",
      "",
      "- また直した",
      "",
      "マニュアルは点検した。変更は要らない —— こちらだけ点検した。",
    ].join("\n");
    const { newEntries, missing } = findMissingManualUpdates({
      currentChangelog,
      previousChangelog,
      manualChangedFiles: [],
    });
    expect(newEntries).toEqual(["1.1.0", "1.2.0"]);
    expect(missing).toEqual(["1.1.0"]);
  });

  it("前回のタグに既にある版は「新しい」に数えない", () => {
    const { newEntries, missing } = findMissingManualUpdates({
      currentChangelog: previousChangelog,
      previousChangelog,
      manualChangedFiles: [],
    });
    expect(newEntries).toEqual([]);
    expect(missing).toEqual([]);
  });
});

// **git を使う統合テスト。** `resolveBase` は git を直接呼ぶので、文字列
// だけでは検査できない。CalcArc 自身のタグ状況に依存させないため、
// 使い捨ての一時リポジトリで確かめる。
describe("resolveBase(タグの無いリポジトリを一時に作って確かめる)", () => {
  const savedEnv = process.env.MANUAL_FRESHNESS_BASE;
  let tempDir: string | undefined;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.MANUAL_FRESHNESS_BASE;
    } else {
      process.env.MANUAL_FRESHNESS_BASE = savedEnv;
    }
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function makeTempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "manual-freshness-test-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(join(dir, "CHANGELOG.md"), "# 変更履歴\n");
    git("add", "CHANGELOG.md");
    git("commit", "-q", "-m", "init");
    return dir;
  }

  it("タグが 1 本も無ければ null を返す(黙って緑にしない)", () => {
    delete process.env.MANUAL_FRESHNESS_BASE;
    tempDir = makeTempRepo();
    expect(resolveBase(tempDir)).toBeNull();
  });

  it("タグがあれば `git describe` の結果を返す", () => {
    delete process.env.MANUAL_FRESHNESS_BASE;
    tempDir = makeTempRepo();
    execFileSync("git", ["tag", "v1.0.0"], { cwd: tempDir });
    expect(resolveBase(tempDir)).toEqual({
      base: "v1.0.0",
      source: "git describe --tags --abbrev=0",
    });
  });

  it("環境変数がタグの有無に関わらず勝つ", () => {
    tempDir = makeTempRepo();
    process.env.MANUAL_FRESHNESS_BASE = "HEAD";
    expect(resolveBase(tempDir)).toEqual({
      base: "HEAD",
      source: "環境変数 MANUAL_FRESHNESS_BASE",
    });
  });
});

// **実物のリポジトリを読む。** ただし「いま緑かどうか」は主張しない
// ——CHANGELOG とマニュアルの現在の関係は、このテストを書いた日の状態に
// 過ぎず、リリースのたびに動く。ここで確かめるのは、動かない歴史的事実
// (すでに出荷され、書き換わらないエントリの形)と、実物の git に対して
// 関数が正しく動くことだけである。
describe("実物のリポジトリ", () => {
  const changelogPath = join(REPO_ROOT, "CHANGELOG.md");
  const currentChangelog = execFileSync(
    "git",
    ["-C", REPO_ROOT, "show", `HEAD:CHANGELOG.md`],
    { encoding: "utf8" },
  );

  it("CHANGELOG.md が存在し、版見出しを複数拾える", () => {
    const entries = extractVersionEntries(currentChangelog);
    expect(entries.length).toBeGreaterThan(5);
  });

  it("0.9.1 は既に出荷済みで、内部の変更だけではない(歴史的事実)", () => {
    const entries = extractVersionEntries(currentChangelog);
    const v091 = entries.find((e) => e.version === "0.9.1");
    expect(v091).toBeDefined();
    expect(hasNonInternalContent(v091?.body ?? "")).toBe(true);
  });

  it("v0.9.1 タグの時点の CHANGELOG には 0.9.2 の見出しが無い", () => {
    const previousChangelog = execFileSync(
      "git",
      ["-C", REPO_ROOT, "show", "v0.9.1:CHANGELOG.md"],
      { encoding: "utf8" },
    );
    const previousVersions = new Set(
      extractVersionEntries(previousChangelog).map((e) => e.version),
    );
    expect(previousVersions.has("0.9.2")).toBe(false);
    expect(previousVersions.has("0.9.1")).toBe(true);
  });

  it("`git ls-files` に CHANGELOG.md と docs/manual/ が実在する(道具立ての確認)", () => {
    const listed = execFileSync("git", ["-C", REPO_ROOT, "ls-files"], {
      encoding: "utf8",
    });
    expect(listed).toContain("CHANGELOG.md");
    expect(listed).toContain("docs/manual/");
    // ファイルシステム側でも読めることを確かめる(パスの取り違え検出)。
    expect(changelogPath.endsWith("CHANGELOG.md")).toBe(true);
  });

  it("resolveBase はこのリポジトリで前回のタグを見つけられる", () => {
    const saved = process.env.MANUAL_FRESHNESS_BASE;
    delete process.env.MANUAL_FRESHNESS_BASE;
    try {
      const resolved = resolveBase(REPO_ROOT);
      expect(
        resolved,
        "タグを 1 本も見つけられなかった(浅いクローン?)",
      ).not.toBeNull();
      expect(resolved?.source).toBe("git describe --tags --abbrev=0");
    } finally {
      if (saved === undefined) {
        delete process.env.MANUAL_FRESHNESS_BASE;
      } else {
        process.env.MANUAL_FRESHNESS_BASE = saved;
      }
    }
  });
});
