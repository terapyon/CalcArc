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

/**
 * `gh release <動詞>` の呼び出しを、現れる順に取り出す。
 *
 * **生の `indexOf` で本文を探さない**（Fable の指摘）——コメントに
 * `"gh release upload"` の綴りが入った日に、無主張化と偽赤の両方が起きる。
 * 行頭がコメントの行は落とし、動詞だけを並べる。
 */
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

const ghReleaseCalls = (yaml: string): string[] =>
  yaml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.match(/gh release (\w+)/)?.[1])
    .filter((verb): verb is string => verb !== undefined);

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
    const calls = ghReleaseCalls(read("release.yml"));
    expect(calls.indexOf("upload")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("upload")).toBeLessThan(calls.indexOf("edit"));
  });

  it("F-3: Release を作る経路も、本文より先に添付する", () => {
    // `create` に本文と資産を一緒に渡していた頃、**B-1 が塞いだ壊れ方が
    // `create` 側にだけ残っていた**（見張るテストも `upload`/`edit` の 2 つ
    // しか見ておらず、`create` に盲目だった）。
    //
    // **`gh` が `create` の中で本文と資産をどの順に扱うかは測っていない。**
    // だから測らなくても済む形にする——`create` は**空の本文で作るだけ**にし、
    // 添付と本文は 1 本の経路へ合流させる。
    const release = read("release.yml");
    const create = release
      .split("\n")
      .find((line) => line.includes("gh release create"));
    expect(create).toBeDefined();
    expect(create).not.toContain("--notes-file");
    expect(create).not.toContain("evidence/*");
    expect(create).toContain('--notes ""');
  });

  it("gh の呼び出しは 1 本の順序で読める（分岐で二重化していない）", () => {
    // 経路が 2 本あると、片方だけ直した日に**もう片方が古いまま緑**になる。
    const calls = ghReleaseCalls(read("release.yml"));
    expect(calls.filter((c) => c === "upload")).toHaveLength(1);
    expect(calls.filter((c) => c === "edit")).toHaveLength(1);
    expect(calls.filter((c) => c === "create")).toHaveLength(1);
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

describe("レポートを書く段は最後（2026-08-27）", () => {
  // **コメントだけが守っていた順序である**（`heavy-corpus.yml:142-146`
  // 「順番だけがそれを決めている」）。破れても**赤にならない**——症状は
  // 状態の劣化で、盤面の行が毎回「記録が無い」になる。
  //
  // 報告書は `pnpm heavy` の走行末尾で書かれ、**その時点でディスクにある
  // `web/heavy-ui-run.json` を読む**。まっさらな runner にはその記録が無いので、
  // `heavy:ui` をあとに置くと `uiHealth` の 4 状態のうち 1 つしか CI に出ない。

  it("heavy:ui は、レポートを書く pnpm heavy より前に走る", () => {
    const steps = stepsOf(read("heavy-corpus.yml"), "corpus");
    const ui = indexOfLine(steps, "pnpm heavy:ui");
    const report = steps.findIndex((line) => /run:\s*pnpm heavy$/.test(line));
    expect(ui).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThanOrEqual(0);
    expect(
      ui,
      "heavy:ui がレポートを書く `pnpm heavy` より後ろにある。" +
        "**赤にはならないが、盤面の行が毎回「記録が無い」になる**" +
        "（報告書は書く時点でディスクに在る web/heavy-ui-run.json を読むため）。" +
        "順序を戻すか、報告書が記録を読む方法を変えるか、どちらかを選ぶこと。",
    ).toBeLessThan(report);
  });

  it("ブラウザの導入は、ブラウザを使う段より前に置く", () => {
    // **v0.4.1 で実際に踏んだ。** 前の段が落ちてこの段が飛ばされ、
    // `if: always()` を持つ `heavy:ui` と `heavy` がブラウザ無しで走り、
    // **型検査の赤が `browserType.launch: Executable doesn't exist` に化けて
    // 36 本を全滅させた。** `if: always()` は付けたが、**位置は誰も見て
    // いなかった。**
    const steps = stepsOf(read("heavy-corpus.yml"), "corpus");
    const install = indexOfLine(steps, "playwright install");
    const ui = indexOfLine(steps, "pnpm heavy:ui");
    const report = steps.findIndex((line) => /run:\s*pnpm heavy$/.test(line));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(
      install,
      "Playwright のブラウザ導入が、ブラウザを使う段より後ろにある。" +
        "**その段が飛ばされると、赤が別の赤に化ける**——v0.4.1 では型検査の赤が " +
        "`browserType.launch: Executable doesn't exist` として 36 本の失敗に見えた。",
    ).toBeLessThan(Math.min(ui, report));
  });

  it("heavy:power は、レポートを書く pnpm heavy より前に走る", () => {
    // 同じ形。`detection-power.json` が無いと、報告書は検出力を
    // 「測っていない」と書く——**嘘ではないが、毎回そう書くようになる。**
    const steps = stepsOf(read("heavy-corpus.yml"), "corpus");
    const power = indexOfLine(steps, "pnpm heavy:power");
    const report = steps.findIndex((line) => /run:\s*pnpm heavy$/.test(line));
    expect(
      power,
      "heavy:power がレポートより後ろにある。**検出力の節が毎回「測っていない」になる。**",
    ).toBeLessThan(report);
  });
});
