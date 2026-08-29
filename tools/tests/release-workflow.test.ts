import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEAVY_BODY_JOB, HEAVY_REPORT } from "../release-evidence.mjs";

// **`release.yml` を読むテストは 0 本だった**(2026-08-26 の指摘)。
// 証拠の読み手が持つ定数は、**書き手（ワークフローのジョブ名・添付名）**と
// 一致していなければ意味を持たない。名前は片方だけ動かせてしまうので、
// **欄の一致をここで固定する。**

const read = (name: string) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}`, import.meta.url),
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

  it("heavy-corpus.yml は再現性検査を報告書より前に走らせる", () => {
    // **報告書は再現性検査が残した信号を読む**(`heavy/reproducibility.json`)。
    // あとに置くと、報告書は毎回「土台を確かめていない」と書く——`heavy:ui` を
    // レポートより前に置いている理由とまったく同じ形である。**順番だけが
    // それを決めている。**
    const steps = stepsOf(read("heavy-corpus.yml"), "corpus");
    const reproducibility = indexOfLine(
      steps,
      "pytest tests/test_corpus_reproducibility.py",
    );
    const report = steps.findIndex((line) => /run:\s*pnpm heavy$/.test(line));
    expect(reproducibility).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThanOrEqual(0);
    expect(
      reproducibility,
      "再現性検査がレポートより後ろにある。**土台の節が毎回「確かめていない」になる。**",
    ).toBeLessThan(report);
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
  // `heavy/heavy-ui-run.json` を読む**。まっさらな runner にはその記録が無いので、
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
        "（報告書は書く時点でディスクに在る heavy/heavy-ui-run.json を読むため）。" +
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

// ---------------------------------------------------------------------------
// **`always()` の意味を分ける**(2026-08-29)。
//
// もともと `always()` は 2 つの意味を兼ねていた——**①落ちても結果を集める**
// (サマリー・添付・前提を整える段)と、**②赤を独立させる**(盤面の赤で計算の赤を
// 隠さない)。**兼ねていたせいで、v0.4.1 では前提が欠けたまま走った段が
// 「本当の原因ではない赤」を 36 本出し、真犯人(型検査の赤)を埋めた。**
//
// いまは段ごとに `# 種別:` を書き、**判定・測る段は自分の前提を名指しする。**
// ここはその規律の番人である——**次に段を足す人が、どちらの意味で
// `always()` を付けるのかを選ばずには書けない。**
// ---------------------------------------------------------------------------

interface CorpusStep {
  name: string | null;
  kind: string | null;
  id: string | null;
  /** `if:` を 1 行に畳んだもの。無ければ `null`。 */
  cond: string | null;
}

const corpusSteps = (): CorpusStep[] => {
  const yaml = read("heavy-corpus.yml");
  const body = yaml.split("\n  corpus:\n")[1] ?? "";
  const untilNextJob = body.split(/\n {2}\w[\w-]*:\n/)[0] ?? "";
  const chunks = untilNextJob.split(/\n(?= {6}- )/).slice(1);
  return chunks.map((chunk) => {
    const lines = chunk.split("\n");
    let cond: string | null = null;
    const at = lines.findIndex((line) => /^\s*if:\s/.test(line));
    if (at >= 0) {
      const head = ((lines[at] ?? "").match(/^\s*if:\s*(.*)$/) ?? [])[1] ?? "";
      if (head.startsWith(">")) {
        const folded: string[] = [];
        for (const line of lines.slice(at + 1)) {
          if (!/^ {10}\S/.test(line)) break;
          folded.push(line.trim());
        }
        cond = folded.join(" ");
      } else {
        cond = head.trim();
      }
      // **YAML の引用符を剥ぐ。** `!` で始まる値は裸で書けない
      // (`!` は YAML のタグ記法なので)ため、条件は必ず引用符に包まれている。
      cond = cond.replace(/^(['"])(.*)\1$/, "$2");
    }
    return {
      name: (chunk.match(/^\s*-?\s*name:\s*(.+?)\s*$/m) ?? [])[1] ?? null,
      kind: (chunk.match(/^\s*# 種別:\s*(\S+)/m) ?? [])[1] ?? null,
      id: (chunk.match(/^\s*id:\s*(\S+)/m) ?? [])[1] ?? null,
      cond,
    };
  });
};

const KINDS = ["前提を整える", "判定する", "測る", "集める"];

describe("always() の意味を分ける（2026-08-29）", () => {
  it("名前のある段は、すべて種別を宣言している", () => {
    const named = corpusSteps().filter((step) => step.name !== null);
    expect(named.length).toBeGreaterThan(5);
    for (const step of named) {
      expect(step.kind, `「${step.name}」に種別が無い`).not.toBe(null);
      expect(KINDS, `「${step.name}」の種別 ${step.kind} を知らない`).toContain(
        step.kind,
      );
    }
  });

  it("名前を持たない段は、頭の 3 つ（checkout と複合アクション）だけである", () => {
    // **除外が黙って増えないようにする。** ここが増えると、種別を書かずに
    // 段を足す抜け道になる。
    const nameless = corpusSteps().filter((step) => step.name === null);
    expect(nameless).toHaveLength(3);
    expect(nameless.every((step) => step.cond === null)).toBe(true);
  });

  it("条件の形は 2 つだけである（always() か !cancelled() + 前提の名指し）", () => {
    // **形を狭めておくと、下の場面表が条件式を正しく読める。**
    // 知らない形が入ったら、場面表が黙って間違うより先にここが赤くなる。
    for (const step of corpusSteps()) {
      if (step.cond === null) continue;
      expect(step.cond, `「${step.name}」の条件が想定の形ではない`).toMatch(
        /^(always\(\)|!cancelled\(\)( && steps\.[a-z]+\.outcome == 'success')*)$/,
      );
    }
  });

  it("always() を名乗れるのは「集める」だけである", () => {
    // **これが意味の分割そのものである。** `always()` は「**手で止めても
    // 走る**」であり、**証拠を残す段だけがそれを名乗ってよい。**
    // 前提と判定・測る段は `!cancelled()`——失敗のあとは走るが、
    // 止められた走行では走らない(止めた人は理由を知っている)。
    for (const step of corpusSteps()) {
      if (step.cond !== "always()") continue;
      expect(
        step.kind,
        `「${step.name}」が always() を名乗っている。集める段だけの綴りである`,
      ).toBe("集める");
    }
  });

  it("「前提を整える」と「判定・測る」は !cancelled() で始まる", () => {
    for (const step of corpusSteps()) {
      if (step.cond === null || step.kind === "集める") continue;
      expect(
        step.cond,
        `「${step.name}」が !cancelled() で始まっていない`,
      ).toMatch(/^!cancelled\(\)/);
    }
  });

  it("★ 名指しされた step id は、同じジョブに実在する", () => {
    // **存在しない id への参照は、GitHub では黙って偽になる。** 打ち間違えても
    // 改名しても**エラーにならず、その段が永遠に飛ぶ。** 名指しの規律が、
    // 名指しの外れで裏返る形である。
    //
    // 場面表も同じ理由でこれを捕まえる——未知の id は決して success に
    // ならないので「何も落ちない日は全部走る」が落ちる(実測で 4 本赤)。
    // **ただしその失敗文は原因を言わない。** ここは診断名のために在る。
    const steps = corpusSteps();
    const declared = new Set(
      steps.map((step) => step.id).filter((id): id is string => id !== null),
    );
    for (const step of steps) {
      for (const [, id] of (step.cond ?? "").matchAll(
        /steps\.([a-z]+)\.outcome/g,
      )) {
        expect(
          declared,
          `「${step.name}」が名指しした id「${id}」が同じジョブに無い`,
        ).toContain(id);
      }
    }
  });

  it("条件を持たない段は、頭の 6 つだけである", () => {
    // **そこまでは並びが依存そのものである**(checkout → 複合アクション →
    // 依存の導入 → wasm → 道具の健全性)。**それより後ろは並びが依存を
    // 意味しない**ので、条件を書かずに段を足せてはならない。
    const bare = corpusSteps().filter((step) => step.cond === null);
    expect(bare.map((step) => step.name)).toEqual([
      null,
      null,
      null,
      "Install the heavy package",
      "Build the wasm the type checker needs",
      "The measuring instrument must be sound",
    ]);
  });

  it("判定・測る段は、自分の前提を名指ししている", () => {
    const byName = new Map(
      corpusSteps().map((step) => [step.name ?? "", step.cond ?? ""]),
    );
    const needs = (name: string) =>
      [...(byName.get(name) ?? "").matchAll(/steps\.([a-z]+)\.outcome/g)]
        .map((m) => m[1])
        .sort();
    expect(needs("The committed corpus must equal a fresh generation")).toEqual(
      ["deps"],
    );
    // **土台は「測る」段の前提である。** 期待値が生成器の出力でないなら、
    // 網の検出力という数は誰も信じない——11 分を費やさない。
    expect(needs("Measure what this corpus can detect")).toEqual([
      "browser",
      "repro",
      "wasm",
    ]);
    // **盤面と照合は、土台を前提にしない。** 盤面から打てるかは期待値の
    // 素性と無関係で、照合はどのファイルが食い違ったかを教えてくれる。
    expect(needs("Type a sample on the real keypad")).toEqual([
      "browser",
      "wasm",
    ]);
    expect(needs("Run the heavy corpus")).toEqual(["browser", "wasm"]);
  });
});

// ---------------------------------------------------------------------------
// **「赤くなるべき日」を作って、条件式を実際に動かす。**
//
// `always()` の付け外しは、**壊れた日を作らないと入ったかどうか分からない。**
// 本当の確認は CI の走行だが、ここでは条件式の論理をそのまま評価して、
// **どの段が走り、どの段が飛ぶか**を場面ごとに固定する。**形の規則(上)が
// 条件を狭めているので、この評価器が本物と食い違ったまま緑になることはない。**
// ---------------------------------------------------------------------------

/** `steps.<id>.outcome` を見ながら、走る段と飛ぶ段を場面から求める。 */
const simulate = (
  failing: string[],
  cancelled = false,
): Map<string, string> => {
  const outcome = new Map<string, string>();
  let somethingFailed = false;
  for (const step of corpusSteps()) {
    const label = step.name ?? "(名前なし)";
    let runs: boolean;
    if (step.cond === null) {
      // 既定は `success()`——前の段が 1 つでも落ちていれば走らない。
      // 走行が止められたときも走らない。
      runs = !somethingFailed && !cancelled;
    } else if (cancelled && !step.cond.startsWith("always()")) {
      // `!cancelled()` は、止められた走行では偽になる。
      runs = false;
    } else {
      runs = [...step.cond.matchAll(/steps\.([a-z]+)\.outcome/g)].every(
        (m) => outcome.get(m[1] ?? "") === "success",
      );
    }
    const result = !runs
      ? "skipped"
      : failing.includes(label)
        ? "failure"
        : "success";
    outcome.set(label, result);
    if (step.id !== null) outcome.set(step.id, result);
    if (result === "failure") somethingFailed = true;
  }
  return outcome;
};

const POWER = "Measure what this corpus can detect";
const KEYPAD = "Type a sample on the real keypad";
const CORPUS = "Run the heavy corpus";
const REPRO = "The committed corpus must equal a fresh generation";
const TOOLS = "The measuring instrument must be sound";
const BROWSER = "Install Playwright's browser";
const WASM = "Build the wasm the type checker needs";

describe("赤くなるべき日（条件式を場面ごとに動かす）", () => {
  it("何も落ちない日は、全部走る", () => {
    const out = simulate([]);
    for (const name of [REPRO, POWER, KEYPAD, CORPUS]) {
      expect(out.get(name), name).toBe("success");
    }
  });

  it("道具の段が落ちた日でも、土台は確かめられる（v0.4.1 の直し）", () => {
    // **v0.4.1 ではここが飛ばされた。** 型検査の赤が「土台を一度も見ない
    // まま終わった走行」に化け、期待値が生成器の出力かどうかを誰も
    // 確かめないまま走行が終わっている(走行 32857987219、実測)。
    const out = simulate([TOOLS]);
    expect(out.get(REPRO)).toBe("success");
    expect(out.get(POWER)).toBe("success");
    expect(out.get(KEYPAD)).toBe("success");
    expect(out.get(CORPUS)).toBe("success");
  });

  it("ブラウザが入らない日は、ブラウザを使う段が「飛ぶ」——偽の赤を出さない", () => {
    // **これが v0.4.1 の 36 本の再発防止である。** `always()` だけだと
    // ブラウザ不在のまま走り、道具の不調が
    // 「`Executable doesn't exist`」に化けて全滅した。
    const out = simulate([BROWSER]);
    expect(out.get(KEYPAD)).toBe("skipped");
    expect(out.get(CORPUS)).toBe("skipped");
    expect(out.get(POWER)).toBe("skipped");
    // **土台はブラウザに依らない。**
    expect(out.get(REPRO)).toBe("success");
  });

  it("土台が赤い日は、検出力だけが飛び、盤面と照合は走る", () => {
    // **意味の分割がいちばん見える場面である。** 数(検出力)は信じられない
    // ので測らない。診断(どのファイルが食い違ったか・盤面から打てるか)は
    // 集める。**報告書は「回し忘れではない」と書く。**
    const out = simulate([REPRO]);
    expect(out.get(POWER)).toBe("skipped");
    expect(out.get(KEYPAD)).toBe("success");
    expect(out.get(CORPUS)).toBe("success");
  });

  it("wasm が作れない日は、測る 3 本がすべて飛ぶ", () => {
    const out = simulate([WASM]);
    expect(out.get(POWER)).toBe("skipped");
    expect(out.get(KEYPAD)).toBe("skipped");
    expect(out.get(CORPUS)).toBe("skipped");
  });

  it("手で止めた走行では、測る段が走らず、証拠だけが残る", () => {
    // **`always()` は cancel でも走る。** 全部 `always()` のままだと、
    // 止めたはずの走行が 23 分の測定を続ける。**止めた人は理由を知っている
    // ので、測り直す意味がない**——`!cancelled()` がそこを分ける。
    const out = simulate([], true);
    for (const name of [REPRO, POWER, KEYPAD, CORPUS, BROWSER]) {
      expect(out.get(name), name).toBe("skipped");
    }
    // **証拠は残す。** どこまで進んでいたかは読めるほうがよい。
    expect(out.get("Put the verdict in the job summary")).toBe("success");
    expect(out.get("Keep the report as an artifact")).toBe("success");
  });

  it("どの場面でも、集める段は走る", () => {
    for (const failing of [[TOOLS], [BROWSER], [REPRO], [WASM], [CORPUS]]) {
      const out = simulate(failing);
      expect(out.get("Put the verdict in the job summary"), failing[0]).toBe(
        "success",
      );
      expect(out.get("Keep the report as an artifact"), failing[0]).toBe(
        "success",
      );
    }
  });
});
