import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEAVY_BODY_JOB,
  HEAVY_REPORT,
} from "../../../tools/release-evidence.mjs";

// **`release.yml` を読むテストは 0 本だった**(2026-08-26 の指摘)。
// 証拠の読み手が持つ定数は、**書き手（ワークフローのジョブ名・添付名）**と
// 一致していなければ意味を持たない。名前は片方だけ動かせてしまうので、
// **欄の一致をここで固定する。**

const read = (name: string) =>
  readFileSync(
    new URL(`../../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );

/** `name: X` の X を集める（コメント行は拾わない）。 */
const jobNames = (yaml: string) =>
  yaml
    .split("\n")
    .map((line) => line.match(/^\s{4}name:\s*(.+?)\s*$/))
    .map((m) => m?.[1])
    .filter((name): name is string => name !== undefined);

describe("読み手の定数は、書き手のワークフローと一致する", () => {
  it("重量級の本体のジョブ名が、呼び出し元と呼ばれる側の組み合わせで実在する", () => {
    // `HEAVY_BODY_JOB` は "呼び出し元のジョブ名 / 呼ばれた側のジョブ名" である。
    const [caller, callee] = HEAVY_BODY_JOB.split(" / ");
    expect(jobNames(read("release.yml"))).toContain(caller);
    expect(jobNames(read("heavy-corpus.yml"))).toContain(callee);
  });

  it("重量級の版数ゲートは、本体と別の名前である", () => {
    // 同じ名前なら、11 秒のジョブで在席が満たされてしまう（B-4 の穴）。
    const names = jobNames(read("heavy-corpus.yml"));
    const [, callee] = HEAVY_BODY_JOB.split(" / ");
    expect(names.filter((n) => n === callee)).toHaveLength(1);
    expect(names).toContain("Version numbers agree");
    expect(callee).not.toBe("Version numbers agree");
  });

  it("報告書の添付名が、上げる側の宣言と一致する", () => {
    expect(read("heavy-corpus.yml")).toContain(`path: heavy/${HEAVY_REPORT}`);
  });

  it("証拠のジョブは自分の名前をスクリプトへ渡す", () => {
    // 渡していなければ「この証拠を書いているジョブ自身である」を名乗れない。
    const release = read("release.yml");
    const evidenceName = jobNames(release).find((name) =>
      name.includes("Evidence"),
    );
    expect(evidenceName).toBeDefined();
    expect(release).toContain(`SELF_JOB_NAME: ${evidenceName}`);
  });

  it("添付は本文より先に上げる", () => {
    // 逆だと、添付の途中で落ちたときに**存在しない添付を語る本文**が残る（B-1）。
    const release = read("release.yml");
    expect(release.indexOf("gh release upload")).toBeLessThan(
      release.indexOf("gh release edit"),
    );
  });

  it("報告書の欠落を警告で流さない", () => {
    // `if-no-files-found: warn` だと、報告書が無いまま緑で通る（B-2）。
    expect(read("heavy-corpus.yml")).toContain("if-no-files-found: error");
    expect(read("heavy-corpus.yml")).not.toContain("if-no-files-found: warn");
  });
});

describe("型検査より先に wasm を作る（2026-08-26、Wave C）", () => {
  // **v0.4.1 の 1 回目を落とした欠陥はこれである。** `heavy` の型検査は
  // `web/src/calc` を通って `web/src/wasm/` の型宣言に届くので、wasm を用意
  // する前に走らせると `TS2307` で落ちる。**手元のワークツリーには生成物が
  // 残っているため、手元では緑のまま気づけない。**
  //
  // 毎回の CI に heavy を載せても、この欠陥は捕まらない——**別のワークフローの
  // 順序**だからである。だからここで順序そのものを固定する。

  /** ジョブの steps を、`run` と `uses` を混ぜた行の並びとして取り出す。 */
  const stepsOf = (yaml: string, jobName: string) => {
    const body = yaml.split(`\n  ${jobName}:\n`)[1] ?? "";
    const untilNextJob = body.split(/\n {2}\w[\w-]*:\n/)[0] ?? "";
    return untilNextJob
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith("- ") ||
          line.startsWith("run:") ||
          line.startsWith("name:"),
      );
  };

  const indexOfLine = (steps: string[], needle: string) =>
    steps.findIndex((line) => line.includes(needle));

  it("heavy-corpus.yml は wasm を作ってから型検査する", () => {
    const steps = stepsOf(read("heavy-corpus.yml"), "corpus");
    const build = indexOfLine(steps, "pnpm --dir ../web wasm");
    const check = indexOfLine(steps, "pnpm typecheck");
    expect(build).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(check);
  });

  it("ci.yml の heavy ジョブは wasm を取ってから型検査する", () => {
    const steps = stepsOf(read("ci.yml"), "heavy");
    const fetchWasm = indexOfLine(steps, "download-artifact");
    const check = indexOfLine(steps, "pnpm typecheck");
    expect(fetchWasm).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThanOrEqual(0);
    expect(fetchWasm).toBeLessThan(check);
  });

  it("ci.yml の heavy ジョブは本体（35 分）を走らせない", () => {
    // 毎回の CI に載せるのは道具の健全性だけである。
    const steps = stepsOf(read("ci.yml"), "heavy").join("\n");
    expect(steps).not.toContain("pnpm heavy");
    expect(steps).toContain("pnpm test");
  });
});
