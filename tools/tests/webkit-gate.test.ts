import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../web/playwright.config.ts";

// **1.0 の門 1 —— WebKit を CI に足す**の番人(2026-09-10)。
// 設計は `docs/superpowers/specs/2026-09-10-one-point-oh-gate-design.md`
// の §1.3、番人の表は §1.4。
//
// **Playwright の設定は字面ではなく、本物の設定オブジェクトを読む。**
// `web/playwright.config.ts` を import すると `@playwright/test` は
// `web/node_modules` から解決される。CI の `Heavy tooling` は
// `.github/actions/setup-web` で `web` の依存を入れてから走るので、
// そこでも同じように読める。字面を読むと、書式が変わった日に
// 「project が無い」と偽の赤を出すか、コメントの綴りを拾って偽の緑を出す。

const projects = config.projects ?? [];
const project = (name: string) => projects.find((p) => p.name === name);

describe("WebKit の project が在る（門 1）", () => {
  it("WebKit で回る project は `webkit` の 1 つだけである", () => {
    const webkit = projects.filter((p) => p.use?.browserName === "webkit");
    expect(webkit.map((p) => p.name)).toEqual(["webkit"]);
  });

  it("`webkit` はエンジンのほかは `mobile` と同じ条件で回る", () => {
    // **変える変数をエンジンの 1 つにする**(裁定 §4 #4)。端末定義や
    // viewport の違いが混ざると、落ちたときにどちらのせいか分からない。
    const mobile = project("mobile")?.use;
    const { browserName, ...rest } = project("webkit")?.use ?? {};
    expect(mobile).toBeDefined();
    expect(browserName).toBe("webkit");
    expect(rest).toEqual(mobile);
    expect(rest.viewport).toEqual({ width: 390, height: 844 });
    expect(rest.isMobile).toBe(false);
  });

  it("`mobile` は Chromium のままである", () => {
    // `End-to-end` のジョブは chromium しか入れない。`mobile` が WebKit に
    // なった日に、Chromium の走行が 1 本も無くなる。
    expect(project("mobile")?.use?.browserName ?? "chromium").toBe("chromium");
  });
});

// ---------------------------------------------------------------------------

const ci = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

/**
 * `jobs:` 以下をジョブごとの行に分ける。**コメント行と空行は落とす。**
 *
 * コメントには `--project` や `playwright test` の綴りが入りうるので、
 * 残すと偽の緑も偽の赤も出る。
 */
const jobs = (yaml: string) => {
  const body = yaml.split(/^jobs:$/m)[1] ?? "";
  const found: { id: string; lines: string[] }[] = [];
  for (const line of body.split("\n")) {
    const head = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (head?.[1] !== undefined) {
      found.push({ id: head[1], lines: [] });
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    found[found.length - 1]?.lines.push(line);
  }
  return found;
};

const jobsNamed = (name: string) =>
  jobs(ci).filter((job) => job.lines.includes(`    name: ${name}`));

const jobNamed = (name: string) => {
  const found = jobsNamed(name);
  expect(found, `ci.yml に「${name}」のジョブが 1 つだけ在ること`).toHaveLength(
    1,
  );
  return found[0]?.lines ?? [];
};

/** `- run: X` の X を並べる。 */
const runsOf = (lines: string[]) =>
  lines
    .map((line) => line.match(/^\s*- run:\s*(.+?)\s*$/)?.[1])
    .filter((run): run is string => run !== undefined);

/** 失敗時に上げる報告書の添付名。 */
const reportNameOf = (lines: string[]) => {
  const steps = lines.join("\n").split(/\n(?= {6}- )/);
  const upload = steps.find((step) => step.includes("actions/upload-artifact"));
  return upload?.match(/^ {10}name:\s*(.+?)\s*$/m)?.[1];
};

/** コメントを除いた ci.yml の行。 */
const ciLines = ci.split("\n").filter((line) => !/^\s*#/.test(line));

describe("CI が WebKit を入れて回す（門 1）", () => {
  it("`End-to-end (WebKit)` は WebKit を入れて `webkit` の project を回す", () => {
    const runs = runsOf(jobNamed("End-to-end (WebKit)"));
    expect(runs).toContain("pnpm exec playwright install --with-deps webkit");
    expect(runs).toContain("pnpm exec playwright test --project webkit");
  });

  it("`End-to-end` は `mobile` の project だけを回す", () => {
    const runs = runsOf(jobNamed("End-to-end"));
    expect(runs).toContain("pnpm exec playwright install --with-deps chromium");
    expect(runs).toContain("pnpm exec playwright test --project mobile");
  });

  it("中身は `End-to-end` と同じで、違うのはブラウザと project と添付名だけである", () => {
    // **CI の側でも変える変数を 1 つにする。** 固定した action の SHA や
    // 前提のジョブが片方だけ動くと、落ちた理由をエンジンに帰せなくなる。
    // **時間制限は外して比べる**——WebKit の値は借りたもので、実績が
    // 溜まったら別に決め直す(ci.yml の表)。
    const normalize = (lines: string[]) =>
      lines
        .filter((line) => !/^ {4}timeout-minutes:/.test(line))
        .map((line) =>
          line
            .replace("End-to-end (WebKit)", "End-to-end")
            .replace("--with-deps webkit", "--with-deps chromium")
            .replace("--project webkit", "--project mobile")
            .replace("playwright-report-webkit", "playwright-report"),
        );
    expect(normalize(jobNamed("End-to-end (WebKit)"))).toEqual(
      normalize(jobNamed("End-to-end")),
    );
  });

  it("ci.yml の `playwright test` はすべて `--project` を名指す", () => {
    // 名指さないと、設定にある project が全部そのジョブで回る。
    const calls = ciLines.filter((line) => line.includes("playwright test"));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const line of calls) {
      expect(line, "`--project` の無い `playwright test`").toMatch(
        /--project\s+\S/,
      );
    }
  });

  it("ci.yml が名指す `--project` は、すべて設定に在る", () => {
    // **存在しない project 名は、打ち間違えても設定と CI の両方で緑に見える**
    // ——ここで照合する(Playwright がその名前でどう振る舞うかには頼らない)。
    const named = ciLines.flatMap((line) =>
      [...line.matchAll(/--project\s+([^\s"']+)/g)].map((m) => m[1] ?? ""),
    );
    expect(named.length).toBeGreaterThanOrEqual(2);
    const declared = projects.map((p) => p.name);
    for (const name of named) {
      expect(declared, `ci.yml が名指した project「${name}」`).toContain(name);
    }
  });

  it("2 つのジョブの報告書は別の名前で上がる", () => {
    const chromium = reportNameOf(jobNamed("End-to-end"));
    const webkit = reportNameOf(jobNamed("End-to-end (WebKit)"));
    expect(chromium).toBeDefined();
    expect(webkit).toBeDefined();
    expect(webkit).not.toBe(chromium);
  });
});

// ---------------------------------------------------------------------------
// **理由の無い skip / fixme を置かない**(設計書 §1.3「しないこと」)。
//
// 許す形は 2 つだけ——`test.skip(<条件>, "<理由>")` と
// `test.fixme(<条件>, "<理由>")`。**宣言形**(`test.skip("題", fn)`・
// `test.fixme("題", fn)`・`test.describe.skip` / `.fixme`)と、**引数の無い
// `test.skip()`** は禁じる。宣言形は理由を書く欄を持たないからである。
//
// **足した時点で該当は 0 件**である(2026-09-10)。0 件のまま緑を返すと何も
// 主張していないので、**読んだファイル数に下限を置き、判定器そのものを
// 見本で確かめる。**
// ---------------------------------------------------------------------------

/** 呼び出しの `(` から対応する `)` までを、最上位の `,` で引数に割る。 */
const argsFrom = (src: string, open: number): string[] | null => {
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  const args: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i));
        const trimmed = args.map((arg) => arg.trim());
        // 末尾の `,` と、引数の無い `()` が残す空の 1 つを落とす。
        if (trimmed[trimmed.length - 1] === "") trimmed.pop();
        return trimmed;
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
};

const LITERAL = /^(["'`])([\s\S]*)\1$/;

/** `skip` / `fixme` のうち、許す 2 つの形に当たらないものを拾う。 */
const findReasonlessSkips = (path: string, text: string) => {
  const found: { path: string; line: number; call: string }[] = [];
  for (const m of text.matchAll(/([\w$.]+)\.(skip|fixme)\s*\(/g)) {
    const call = `${m[1]}.${m[2]}`;
    const line = text.slice(0, m.index).split("\n").length;
    if (/(^|\.)describe$/.test(m[1] ?? "")) {
      found.push({ path, line, call });
      continue;
    }
    const args = argsFrom(text, m.index + m[0].length - 1);
    const [condition, reason] = args ?? [];
    const allowed =
      args?.length === 2 &&
      condition !== undefined &&
      !LITERAL.test(condition) &&
      (LITERAL.exec(reason ?? "")?.[2] ?? "").trim() !== "";
    if (!allowed) found.push({ path, line, call });
  }
  return found;
};

describe("判定器そのもの（見本）", () => {
  it.each([
    ['test.fixme("x", async () => {});', "理由の無い宣言形の fixme"],
    ['test.skip("題", async ({ page }) => {});', "宣言形の skip"],
    ["test.skip();", "引数の無い skip"],
    ["test.fixme();", "引数の無い fixme"],
    ['test.skip(browserName === "webkit");', "条件だけで理由が無い"],
    ['test.skip(browserName === "webkit", "");', "理由が空"],
    ['test.skip(browserName === "webkit", "  ");', "理由が空白だけ"],
    ["test.skip(isWebKit, REASON);", "理由が文字列ではない"],
    ['test.describe.skip("群", () => {});', "describe.skip"],
    ['test.describe.fixme("群", () => {});', "describe.fixme"],
  ])("拾う: %s（%s）", (src) => {
    expect(findReasonlessSkips("見本", src)).toHaveLength(1);
  });

  it.each([
    [
      'test.skip(browserName === "webkit", "WebKit では X が無いため（#123）");',
      "条件と理由のある skip",
    ],
    [
      "test.fixme(isWebKit, 'WebKit で Y が 1 px ずれる。調査中');",
      "条件と理由のある fixme",
    ],
    [
      'test.skip(({ browserName }) => browserName === "webkit", "理由, 読点入り");',
      "関数の条件と、`,` を含む理由",
    ],
    ['test.skip(a, "理由",\n);', "末尾の `,`"],
    ['test("題", async ({ page }) => {});', "ふつうの test"],
    ["stub.fail();", "skip / fixme ではない呼び出し"],
  ])("拾わない: %s（%s）", (src) => {
    expect(findReasonlessSkips("見本", src)).toEqual([]);
  });
});

const E2E = new URL("../../web/tests/e2e/", import.meta.url);
const e2eFiles = readdirSync(E2E, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts"))
  .sort();

describe("web/tests/e2e に理由の無い skip / fixme が無い", () => {
  it("E2E のファイルを実際に読んでいる（0 件で緑を返さない）", () => {
    // **下限は足した日の実数**(2026-09-10、`*.spec.ts` 29 本と
    // `fixtures.ts`)。ファイルを減らしたら、ここも一緒に下げる。
    expect(e2eFiles.length).toBeGreaterThanOrEqual(30);
  });

  it("許す 2 つの形に当たらない skip / fixme は 0 件である", () => {
    const found = e2eFiles.flatMap((file) =>
      findReasonlessSkips(file, readFileSync(new URL(file, E2E), "utf8")),
    );
    expect(found).toEqual([]);
  });
});
