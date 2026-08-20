# Heavy corpus 改善 A — 欠陥注入の測定基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 欠陥注入の測定が失敗したことを「検出が無かった」と区別できるようにし、期待するシャード集合を完全一致で、検出の量を率の下限で検査する。

**Architecture:** `pnpm heavy` の stdout を正規表現で舐めるのをやめる。走行を「wasm ビルド」「playwright 実行」「結果の読み取り」の 3 段に分け、`globalTeardown` が書く機械可読な `web/heavy-run.json` を唯一の入力にする。判定は**測定の健全性を先に見て、そのあとで検出を見る**。

**Tech Stack:** Node 22 / TypeScript 5.7 / Playwright 1.5x / vitest 3 / biome 2

**Spec:** `docs/superpowers/specs/2026-08-19-heavy-detection-power-design.md`

## Global Constraints

- **`crates/` を変更しない。** A は Rust に一切触れない（変異は一時的で、コミットしない）。
- **計算ロジックを `web` に書かない**（CLAUDE.md）。ここで書くのは測定の道具だけである。
- **許容誤差をテストコードに書かない**（CLAUDE.md）。この計画は許容誤差を扱わない。
- **コミット前に `cargo fmt` を実行する** —— A は Rust を変えないので該当しないが、ブランチ末尾のフルスイープでは走らせる。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- **`git push` と PR 作成は行わない。**
- 作業ブランチは `feature/heavy-power-measure`。**作業前に `git branch --show-current` で確認する**（共有ワークツリー）。
- シャードの同一性は `summaryName(shardName, kind)` の出力（例 `"elementary-000.json (values)"`）。**素の `.json` 名に落とし直さない。**

---

### Task 1: 走行の要約 `heavy-run.json` を書く

**Files:**
- Modify: `web/tests/heavy/report.ts`（`resetRun` の拡張、`HeavyRun` 型、`buildRun`、`writeRunJson` を追加）
- Modify: `web/tests/heavy/global-teardown.ts`
- Test: `web/tests/heavy/report.spec.ts`（`buildRun` の純関数テスト）

**Interfaces:**
- Consumes: 既存の `readRecorded()`（`report.ts` 内、非公開）、`expectedSummaryNames()`（公開済み）、`RecordedShard`
- Produces:
  - `export interface HeavyRunShard { name: string; total: number; mismatches: number }`
  - `export interface HeavyRun { schema: 1; ranTests: boolean; expected: string[]; shards: HeavyRunShard[] }`
  - `export function buildRun(recorded: RecordedShard[], expected: string[]): HeavyRun`
  - `export function writeRunJson(): void`
  - `RecordedShard` を `export` する（テストが組み立てるため）

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/heavy/report.spec.ts` の末尾に足す。先頭の import に `buildRun` と型を加える。

```ts
import { buildRun, type RecordedShard } from "./report";

function recorded(name: string, total: number, mismatches: number): RecordedShard {
  return {
    summary: summary({ name, total, mismatches: Array.from({ length: mismatches }, (_, i) => `${name}#${i}`) }),
    runtime: { coreVersion: "0.2.1", browser: "chromium" },
  };
}

test("the run summary carries every shard that ran, including the quiet ones", () => {
  // **不一致 0 のシャードも載る。** ここが載らないと「0 件」と「走らなかった」が
  // 区別できず、欠陥注入の判定が「ビルド失敗」を「検出なし」と呼ぶ。
  const run = buildRun(
    [recorded("a-000.json (values)", 2000, 0), recorded("b-000.json (values)", 2000, 7)],
    ["a-000.json (values)", "b-000.json (values)"],
  );
  expect(run.ranTests).toBe(true);
  expect(run.shards).toEqual([
    { name: "a-000.json (values)", total: 2000, mismatches: 0 },
    { name: "b-000.json (values)", total: 2000, mismatches: 7 },
  ]);
  expect(run.expected).toEqual(["a-000.json (values)", "b-000.json (values)"]);
});

test("a run where nothing was recorded says so instead of looking empty and calm", () => {
  const run = buildRun([], ["a-000.json (values)"]);
  expect(run.ranTests).toBe(false);
  expect(run.shards).toEqual([]);
  // **期待は残る。** 何が居るはずだったかを、走らなかった走行こそが持っている。
  expect(run.expected).toEqual(["a-000.json (values)"]);
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm exec playwright test --config playwright.heavy.config.ts report.spec.ts`
Expected: FAIL — `buildRun` は存在しない（`report.ts` から export されていない）

- [ ] **Step 3: 実装する**

`web/tests/heavy/report.ts`。`REPORT_PATH` の定義の直後に足す。

```ts
const RUN_PATH = fileURLToPath(new URL("../../heavy-run.json", import.meta.url));

/** 走行 1 回ぶんの機械可読な要約。**欠陥注入の測定はこれだけを読む。** */
export interface HeavyRunShard {
  name: string;
  total: number;
  /** 不一致の**件数**。全文は `.heavy-summaries/` にある。 */
  mismatches: number;
}

export interface HeavyRun {
  schema: 1;
  /** 集計が 1 枚でも書かれたか。false は「テストが 1 本も走っていない」。 */
  ranTests: boolean;
  /** この走行に居るはずだったシャード（`expectedSummaryNames()`）。 */
  expected: string[];
  /** 実際に走ったシャード。**不一致 0 のものも載る。** */
  shards: HeavyRunShard[];
}

/**
 * **純関数。** ディスクを触らないので、走行の外からテストできる。
 *
 * `writeReport()` と違って**何があっても投げない**——投げてしまうと
 * 「走行が失敗した」という事実そのものが残らず、測定側は理由を知る手段を失う。
 */
export function buildRun(recorded: RecordedShard[], expected: string[]): HeavyRun {
  return {
    schema: 1,
    ranTests: recorded.length > 0,
    expected,
    shards: recorded.map((entry) => ({
      name: entry.summary.name,
      total: entry.summary.total,
      mismatches: entry.summary.mismatches.length,
    })),
  };
}

export function writeRunJson(): void {
  const run = buildRun(readRecorded(), expectedSummaryNames());
  writeFileSync(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf-8");
}
```

`RecordedShard` の宣言に `export` を付ける。

`resetRun()` に 1 行足す（**前回の要約が残っていると、測定は前回の走行を今回として読む**）。

```ts
export function resetRun(): void {
  rmSync(SUMMARY_DIR, { recursive: true, force: true });
  mkdirSync(SUMMARY_DIR, { recursive: true });
  rmSync(REPORT_PATH, { force: true });
  // **前回の走行の要約も消す。** 残っていると、今回ビルドで落ちた走行が
  // 前回の数字を見せる——`heavy-report.md` を消すのとまったく同じ理由である。
  rmSync(RUN_PATH, { force: true });
}
```

`web/tests/heavy/global-teardown.ts`:

```ts
import { writeReport, writeRunJson } from "./report";

export default function globalTeardown(): void {
  // **要約を先に書く。** `writeReport()` は集計が 1 枚も無いと投げるので、
  // 後回しにすると**走行が失敗した走行ほど要約が残らない**——測定側が
  // 一番知りたい場合に、一番何も分からなくなる。
  writeRunJson();
  writeReport();
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm exec playwright test --config playwright.heavy.config.ts report.spec.ts`
Expected: PASS

- [ ] **Step 5: 実物で 1 度書かせる**

Run: `cd web && pnpm heavy && cat heavy-run.json | head -20`
Expected: 15 シャードが並び、`ranTests: true`、`expected` が 15 個

- [ ] **Step 6: `.gitignore` に足す**

リポジトリ直下の `.gitignore` の `web/detection-power.json` の隣に `web/heavy-run.json` を足す。

- [ ] **Step 7: commit**

```bash
git add web/tests/heavy/report.ts web/tests/heavy/global-teardown.ts web/tests/heavy/report.spec.ts .gitignore
git commit -m "Write down what the run actually did, not just what failed"
```

---

### Task 2: `detection-power.mjs` を外から読めるようにする

**Files:**
- Modify: `web/scripts/detection-power.mjs`（export とエントリガード。**挙動は変えない**）
- Modify: `web/tsconfig.json`（`allowJs`）
- Modify: `web/vite.config.ts`（vitest の `include`）
- Test: `web/tests/unit/detection-power.test.ts`（新規）

**Interfaces:**
- Produces: `export const MUTATIONS`、`export function verdictFor(expectation, caught)`（この時点では**現在の署名のまま**）

`tests/unit/` に置くのは、Playwright の `testDir`（`./tests/heavy`）の外に出すためである。`testMatch` の既定は `**/*.@(spec|test).*` なので、`tests/heavy/` に `.test.ts` を置くと **Playwright と vitest の両方が拾う**。

- [ ] **Step 1: 失敗するテストを書く**

`web/tests/unit/detection-power.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MUTATIONS } from "../../scripts/detection-power.mjs";

describe("the mutation table", () => {
  it("is not empty and every entry names a real place to break", () => {
    // **空の表は「検出力を測った」という記録だけを残す。**
    expect(MUTATIONS.length).toBeGreaterThan(0);
    for (const mutation of MUTATIONS) {
      expect(mutation.id, "every mutation needs an id").toBeTruthy();
      expect(mutation.file, `${mutation.id}: needs a file`).toMatch(/^crates\//);
      expect(mutation.from, `${mutation.id}: needs a from`).toBeTruthy();
      expect(mutation.to, `${mutation.id}: needs a to`).toBeTruthy();
      expect(mutation.from, `${mutation.id}: from and to must differ`).not.toBe(mutation.to);
    }
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm test`
Expected: FAIL — vitest がこのファイルを拾わない（`include` の外）か、`MUTATIONS` が export されていない

- [ ] **Step 3: 3 つの配線を直す**

`web/vite.config.ts` の `test.include`:

```ts
    // E2E は Playwright が回すので vitest からは外す。
    // `tests/unit` は Playwright の testDir(`tests/heavy`) の外にある——
    // **中に置くと `**\/*.test.*` の既定に当たって両方が拾う。**
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
```

`web/tsconfig.json` の `"resolveJsonModule": true,` の次に足す:

```json
    "allowJs": true,
```

（これが無いと `.mjs` の import が TS7016 になる。`checkJs` は付けない——
`scripts/` の他の `.mjs` を型検査の対象にすると、この計画と無関係な赤が出る。）

`web/scripts/detection-power.mjs`:
- `const MUTATIONS = [` を `export const MUTATIONS = [` にする
- `function verdictFor(` を `export function verdictFor(` にする
- **走らせる部分をガードの下に移す**。`const results = [];` から最終行までを次で包む:

```js
// **import されたときは走らない。** テストがこのファイルを読むだけで
// 変異が始まっては困る。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
```

`main()` という関数に既存のトップレベル処理を移し、`import { pathToFileURL } from "node:url";` を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm test && pnpm typecheck && pnpm lint`
Expected: すべて PASS

- [ ] **Step 5: スクリプトが今も動くことを確かめる**

Run: `cd web && node scripts/detection-power.mjs --help 2>&1 | head -2 || true`
Expected: 変異が始まる（`--help` は解釈しない）。**数秒で止めてよい**——確かめたいのは「ガードを付けても実行経路が生きている」ことだけである。

- [ ] **Step 6: commit**

```bash
git add web/scripts/detection-power.mjs web/tsconfig.json web/vite.config.ts web/tests/unit/detection-power.test.ts
git commit -m "Let the measuring tool be measured"
```

---

### Task 3: いまの判定が誤って緑になることを、テストで実証する

**Files:**
- Test: `web/tests/unit/detection-power.test.ts`（追記）

**Interfaces:**
- Consumes: `verdictFor`（Task 2 の export、まだ旧署名）
- Produces: なし（この Task は**赤を出すことが成果**である）

`red-check-procedure` に従う。**先に一時コミットを作ってから**変異を試す。

- [ ] **Step 1: 誤成功を実証するテストを書く**

```ts
import { verdictFor } from "../../scripts/detection-power.mjs";

describe("the verdict, before it learned about measurement failures", () => {
  it("calls a build failure 'nothing was detected' — this is the defect", () => {
    // **これは仕様ではない。いまの実装がそうなっている、という記録である。**
    // 次の Task でこのテストは書き換わる。ここで一度赤を見るために置く。
    //
    // `measure()` はビルドが落ちても stdout に不一致が出ないので `{}` を返す。
    // `verdictFor("nothing", {})` はそれを「赤くならなかった」と読む。
    const verdict = verdictFor("nothing", {});
    expect(verdict.ok).toBe(true); // ← 本来は false であるべき
  });
});
```

- [ ] **Step 2: 走らせて、緑になることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts`
Expected: **PASS**。これは合格ではなく、**指示書 §4.2 が禁じている誤成功が実在する証拠**である。出力を記録する。

- [ ] **Step 3: 記録して、テストを消す**

`docs/corpus-measurements.md` に節を足す:

```markdown
## 欠陥注入の誤成功（2026-08-19 実測、spec A Task 3）

`verdictFor("nothing", {})` が `ok: true` を返すことを実測で確認した。
`measure()` はビルド失敗・ブラウザ起動失敗・不一致 0 件のすべてで `{}` を
返すので、**この 3 つが同じ判定に潰れている**。改善指示書 §4.2 が名指しで
禁じている誤成功である。次の Task がこれを赤にする。
```

Step 1 で足したテストブロックを削除する（次の Task が正しい主張で置き換える）。

- [ ] **Step 4: commit**

```bash
git add docs/corpus-measurements.md web/tests/unit/detection-power.test.ts
git commit -m "Record that a failed build currently passes as a clean run"
```

---

### Task 4: 測定の結果を、3 つの別々の事実にする

**Files:**
- Modify: `web/scripts/detection-power.mjs`（`measure()` を書き換え）
- Test: `web/tests/unit/detection-power.test.ts`

**Interfaces:**
- Produces:
  ```js
  /**
   * @typedef {object} Measurement
   * @property {boolean} buildOk
   * @property {number|null} playwrightExitCode  走らなかったときは null
   * @property {boolean} runJsonFound
   * @property {boolean} ranTests
   * @property {string[]} expected
   * @property {string[]} shardsSeen
   * @property {Record<string, number>} mismatchesByShard  0 件のシャードも載る
   * @property {Record<string, number>} totalsByShard
   */
  export function measure(): Measurement
  ```

- [ ] **Step 1: 失敗するテストを書く**

`readMeasurement(runJson)` という純関数に分け、そこをテストする（`measure()` 自身は
プロセスを起動するので単体テストにしない）。

```ts
import { readMeasurement } from "../../scripts/detection-power.mjs";

describe("reading a run summary", () => {
  const run = {
    schema: 1,
    ranTests: true,
    expected: ["a (values)", "b (values)"],
    shards: [
      { name: "a (values)", total: 2000, mismatches: 0 },
      { name: "b (values)", total: 2000, mismatches: 7 },
    ],
  };

  it("keeps the quiet shard visible", () => {
    const m = readMeasurement({ buildOk: true, playwrightExitCode: 1, run });
    expect(m.shardsSeen).toEqual(["a (values)", "b (values)"]);
    // **0 件のシャードが載っている。** これが「走らなかった」との違いである。
    expect(m.mismatchesByShard).toEqual({ "a (values)": 0, "b (values)": 7 });
    expect(m.totalsByShard).toEqual({ "a (values)": 2000, "b (values)": 2000 });
    expect(m.ranTests).toBe(true);
    expect(m.runJsonFound).toBe(true);
  });

  it("says the run summary is missing when there is none", () => {
    const m = readMeasurement({ buildOk: true, playwrightExitCode: 1, run: null });
    expect(m.runJsonFound).toBe(false);
    expect(m.ranTests).toBe(false);
    expect(m.shardsSeen).toEqual([]);
    expect(m.expected).toEqual([]);
  });

  it("carries the build failure through untouched", () => {
    const m = readMeasurement({ buildOk: false, playwrightExitCode: null, run: null });
    expect(m.buildOk).toBe(false);
    expect(m.playwrightExitCode).toBeNull();
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts`
Expected: FAIL — `readMeasurement` が無い

- [ ] **Step 3: 実装する**

`web/scripts/detection-power.mjs` の `measure()` を丸ごと差し替える。

```js
const RUN_JSON = join(WEB, "heavy-run.json");

/** 読み取り段だけを切り出した純関数。**プロセスを起動しないのでテストできる。** */
export function readMeasurement({ buildOk, playwrightExitCode, run }) {
  if (run === null) {
    return {
      buildOk,
      playwrightExitCode,
      runJsonFound: false,
      ranTests: false,
      expected: [],
      shardsSeen: [],
      mismatchesByShard: {},
      totalsByShard: {},
    };
  }
  const mismatchesByShard = {};
  const totalsByShard = {};
  for (const shard of run.shards) {
    mismatchesByShard[shard.name] = shard.mismatches;
    totalsByShard[shard.name] = shard.total;
  }
  return {
    buildOk,
    playwrightExitCode,
    runJsonFound: true,
    ranTests: run.ranTests,
    expected: run.expected,
    shardsSeen: run.shards.map((shard) => shard.name),
    mismatchesByShard,
    totalsByShard,
  };
}

/**
 * **走行を 3 段に分ける。**
 *
 * `pnpm heavy` は `pnpm wasm && playwright test` の合成なので、合成のまま
 * 呼ぶと**ビルド失敗とテスト失敗が同じ非ゼロ終了**になる。分けて呼べば、
 * どちらで倒れたかが別々の事実として残る。
 */
export function measure() {
  let buildOk = true;
  try {
    run("pnpm", ["wasm"]);
  } catch {
    buildOk = false;
  }
  let playwrightExitCode = null;
  if (buildOk) {
    try {
      run("pnpm", ["exec", "playwright", "test", "--config", "playwright.heavy.config.ts"]);
      playwrightExitCode = 0;
    } catch (error) {
      // **赤くなるのが目的なので、失敗は想定内。** 終了コードだけ取る。
      playwrightExitCode = typeof error.status === "number" ? error.status : 1;
    }
  }
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(RUN_JSON, "utf-8"));
  } catch {
    parsed = null;
  }
  return readMeasurement({ buildOk, playwrightExitCode, run: parsed });
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add web/scripts/detection-power.mjs web/tests/unit/detection-power.test.ts
git commit -m "Split the run into build, run, and read"
```

---

### Task 5: 判定を、測定の健全性から順に見るものに変える

**Files:**
- Modify: `web/scripts/detection-power.mjs`（`verdictFor` と `MUTATIONS` の宣言）
- Test: `web/tests/unit/detection-power.test.ts`

**Interfaces:**
- Consumes: `readMeasurement`（Task 4）
- Produces: `export function verdictFor(mutation, measurement): { ok: boolean; kind: string; why: string }`
  - `kind` は `"ok"` / `"measurement-failed"` / `"claim-was-false"` / `"shard-set-mismatch"` / `"below-min-rate"` / `"caught-nothing"`
  - `MUTATIONS` の各項目は `expect: string` をやめ、`expectShards: string[]` と `minRate: Record<string, number>` を持つ

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { verdictFor } from "../../scripts/detection-power.mjs";

const ALL = ["a (values)", "b (values)"];

function measurement(overrides = {}) {
  return {
    buildOk: true,
    playwrightExitCode: 0,
    runJsonFound: true,
    ranTests: true,
    expected: ALL,
    shardsSeen: ALL,
    mismatchesByShard: { "a (values)": 0, "b (values)": 0 },
    totalsByShard: { "a (values)": 2000, "b (values)": 2000 },
    ...overrides,
  };
}

const nothingExpected = { id: "m", expectShards: [], minRate: {} };
const aExpected = { id: "m", expectShards: ["a (values)"], minRate: { "a (values)": 0.1 } };

describe("the verdict looks at the health of the measurement first", () => {
  it("refuses to call a failed build 'nothing was detected'", () => {
    // **指示書 §4.2 の核心。** これが緑になるなら、この層は何も保証していない。
    const v = verdictFor(nothingExpected, measurement({ buildOk: false, playwrightExitCode: null }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run with no run summary", () => {
    const v = verdictFor(nothingExpected, measurement({ runJsonFound: false, ranTests: false, shardsSeen: [], expected: [] }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run where no test ran", () => {
    const v = verdictFor(nothingExpected, measurement({ ranTests: false }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run that is missing a shard, even when the reacting set matches", () => {
    // **完全一致は、黙っているべきシャードが実際に読まれて初めて意味を持つ。**
    const v = verdictFor(aExpected, measurement({
      shardsSeen: ["a (values)"],
      mismatchesByShard: { "a (values)": 500 },
      totalsByShard: { "a (values)": 2000 },
    }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("accepts a healthy run where nothing reacted", () => {
    const v = verdictFor(nothingExpected, measurement());
    expect(v.ok).toBe(true);
  });

  it("calls it a false claim when something reacted that should not have", () => {
    const v = verdictFor(nothingExpected, measurement({
      playwrightExitCode: 1,
      mismatchesByShard: { "a (values)": 3, "b (values)": 0 },
    }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("claim-was-false");
  });
});

describe("the expected shard set is matched exactly", () => {
  it("rejects an extra shard", () => {
    const v = verdictFor(aExpected, measurement({
      playwrightExitCode: 1,
      mismatchesByShard: { "a (values)": 500, "b (values)": 1 },
    }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("shard-set-mismatch");
  });

  it("rejects a missing shard", () => {
    const v = verdictFor(
      { id: "m", expectShards: ["a (values)", "b (values)"], minRate: {} },
      measurement({ playwrightExitCode: 1, mismatchesByShard: { "a (values)": 500, "b (values)": 0 } }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("shard-set-mismatch");
  });

  it("says it caught nothing when the set is empty but something was expected", () => {
    const v = verdictFor(aExpected, measurement());
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("caught-nothing");
  });
});

describe("the detection floor is a rate, so the corpus can grow", () => {
  it("passes at the same rate on a bigger shard", () => {
    // **2000 件で 200、4000 件で 400。率が同じなら緑。**
    // B+C がコーパスを 3,500 件に増やしても、この表を書き換えずに済む。
    const small = verdictFor(aExpected, measurement({
      playwrightExitCode: 1,
      mismatchesByShard: { "a (values)": 200, "b (values)": 0 },
    }));
    const big = verdictFor(aExpected, measurement({
      playwrightExitCode: 1,
      mismatchesByShard: { "a (values)": 400, "b (values)": 0 },
      totalsByShard: { "a (values)": 4000, "b (values)": 2000 },
    }));
    expect(small.ok).toBe(true);
    expect(big.ok).toBe(true);
  });

  it("fails when the rate halves", () => {
    const v = verdictFor(aExpected, measurement({
      playwrightExitCode: 1,
      mismatchesByShard: { "a (values)": 99, "b (values)": 0 },
    }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("below-min-rate");
  });

  it("still demands one case when no rate is named", () => {
    // 薄い帯(ncr は 10/2000 = 0.5%)を率だけで縛ると、丸めで 0 件が通る。
    const v = verdictFor(
      { id: "m", expectShards: ["a (values)"], minRate: {} },
      measurement({ playwrightExitCode: 1, mismatchesByShard: { "a (values)": 1, "b (values)": 0 } }),
    );
    expect(v.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts`
Expected: FAIL — 旧 `verdictFor(expectation, caught)` は署名が違う

- [ ] **Step 3: 実装する**

`verdictFor` を丸ごと差し替える。

```js
function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((name, i) => name === sorted[i]);
}

/**
 * **測定の健全性を先に見て、そのあとで検出を見る。**
 *
 * 1〜4 の赤は「測れていない」、5 以降の赤は「測った結果が期待と違う」である。
 * この 2 つを同じ言葉で報告すると、レポートが**測定の失敗を検証の成果として
 * 数える**——それがこの段階を足した理由そのものである。
 */
export function verdictFor(mutation, m) {
  const fail = (kind, why) => ({ ok: false, kind, why });
  if (!m.buildOk) {
    return fail("measurement-failed", "wasm のビルドが失敗した——検出の有無は測れていない");
  }
  if (!m.runJsonFound) {
    return fail("measurement-failed", "heavy-run.json が無い——走行がレポート生成に到達していない");
  }
  if (!m.ranTests) {
    return fail("measurement-failed", "テストが 1 本も走っていない");
  }
  const missing = m.expected.filter((name) => !m.shardsSeen.includes(name));
  if (missing.length > 0) {
    return fail(
      "measurement-failed",
      `読み込まれていないシャードがある(${missing.join(", ")})——` +
        "黙っているべきシャードが走っていない走行は、完全一致を語る資格がない",
    );
  }
  const reacted = Object.entries(m.mismatchesByShard)
    .filter(([, count]) => count > 0)
    .map(([name]) => name);
  if (mutation.expectShards.length === 0) {
    if (m.playwrightExitCode === 0 && reacted.length === 0) {
      return { ok: true, kind: "ok", why: "赤くならなかった——レポートの「踏んでいない」が正しい" };
    }
    return fail(
      "claim-was-false",
      `赤くなった(${reacted.join(", ") || "テストが非ゼロで終了"})。レポートの「踏んでいない」が嘘である`,
    );
  }
  if (reacted.length === 0) {
    return fail("caught-nothing", "1 件も捕まえられなかった");
  }
  if (!sameSet(reacted, mutation.expectShards)) {
    return fail(
      "shard-set-mismatch",
      `反応したのは ${reacted.sort().join(", ")}、期待は ${[...mutation.expectShards].sort().join(", ")}`,
    );
  }
  for (const name of mutation.expectShards) {
    const total = m.totalsByShard[name] ?? 0;
    const rate = mutation.minRate?.[name] ?? 0;
    const floor = Math.max(1, Math.ceil(total * rate));
    const caught = m.mismatchesByShard[name] ?? 0;
    if (caught < floor) {
      return fail("below-min-rate", `${name} は ${caught} 件で、下限 ${floor} 件(${total} 件の ${rate})に届かない`);
    }
  }
  return { ok: true, kind: "ok", why: `期待したシャードだけが反応した(${reacted.sort().join(", ")})` };
}
```

`MUTATIONS` の 8 項目から `expect: "..."` を消し、`expectShards` と `minRate` を書く。**値は spec §4.6 の表**（実測は Task 7 で取り直す）。

```js
  {
    id: "display-digits",
    what: "表示の有効桁数を 10 から 9 に減らす",
    file: "crates/calcarc-core/src/numeric/format.rs",
    from: "pub const DISPLAY_DIGITS: usize = 10;",
    to: "pub const DISPLAY_DIGITS: usize = 9;",
    // **値シャードすべて、ではない。** `cancellation-000.json` は値シャード
    // だが反応しない。名前ではなく実測で書く。
    expectShards: [
      "angle-mode-000.json (values)",
      "combinatorics-000.json (values)",
      "complex-000.json (values)",
      "elementary-000.json (values)",
      "inverse-trig-000.json (values)",
      "precedence-000.json (values)",
      "scientific-000.json (values)",
      "typed-000.json (values)",
      "complex-display-000.json (displays)",
      "display-000.json (displays)",
    ],
    minRate: {
      "angle-mode-000.json (values)": 0.254,
      "combinatorics-000.json (values)": 0.296,
      "complex-000.json (values)": 0.095,
      "elementary-000.json (values)": 0.302,
      "inverse-trig-000.json (values)": 0.183,
      "precedence-000.json (values)": 0.244,
      "scientific-000.json (values)": 0.199,
      "typed-000.json (values)": 0.222,
      "complex-display-000.json (displays)": 0.083,
      "display-000.json (displays)": 0.103,
    },
  },
```

残り 7 件も同じ形で書く（`precedence-collapse` → `["precedence-000.json (values)"]` / 0.274、
`associativity-flip` → `[]` / `{}`、`ncr-multiply-first` → `["combinatorics-000.json (values)"]` / 0.0025、
`eng-exponent-toward-zero` → `["display-000.json (displays)"]` / 0.024、
`sexagesimal-no-carry` → `["display-000.json (displays)"]` / 0.0025、
`complex-multiply-sign` → `["complex-000.json (values)"]` / 0.036、
`polar-angle-flipped` → `["complex-display-000.json (displays)"]` / 0.165）。

`main()` の中の `verdictFor(mutation.expect, caught)` を `verdictFor(mutation, measurement)` に直し、
`results.push` に `kind` を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add web/scripts/detection-power.mjs web/tests/unit/detection-power.test.ts
git commit -m "Ask whether the measurement stood up before asking what it saw"
```

---

### Task 6: 原状回復を、判定の例外まで含めて保証する

**Files:**
- Modify: `web/scripts/detection-power.mjs`（`runOneMutation` を切り出す）
- Test: `web/tests/unit/detection-power.test.ts`

**Interfaces:**
- Produces: `export function runOneMutation(mutation, { root, measure }): { id: string; ok: boolean; kind: string; why: string; caught: Record<string, number> }`
  - `root` は変異先のルート（既定はリポジトリ直下）。テストは一時ディレクトリを渡す。
  - `measure` は差し替え可能。テストは throw する関数を渡す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runOneMutation } from "../../scripts/detection-power.mjs";

function sandbox(contents: string) {
  const root = mkdtempSync(join(tmpdir(), "detection-power-"));
  const relative = "crates/x/src/lib.rs";
  mkdirSync(dirname(join(root, relative)), { recursive: true });
  writeFileSync(join(root, relative), contents, "utf-8");
  return { root, relative, read: () => readFileSync(join(root, relative), "utf-8") };
}

const ORIGINAL = "let x = 1;\nlet y = 2;\n";
const mutation = { id: "m", what: "", file: "crates/x/src/lib.rs", from: "let x = 1;", to: "let x = 9;", expectShards: [], minRate: {} };

describe("the file always goes back", () => {
  it("restores it when the heavy run throws", () => {
    const box = sandbox(ORIGINAL);
    expect(() =>
      runOneMutation(mutation, { root: box.root, measure: () => { throw new Error("heavy died"); } }),
    ).toThrow(/heavy died/);
    expect(box.read()).toBe(ORIGINAL);
  });

  it("restores it when the verdict throws", () => {
    // **`finally` が判定まで届いていないと、ここで変異が残る。**
    const box = sandbox(ORIGINAL);
    expect(() =>
      runOneMutation(mutation, {
        root: box.root,
        measure: () => ({ get buildOk(): never { throw new Error("parse blew up"); } }) as never,
      }),
    ).toThrow(/parse blew up/);
    expect(box.read()).toBe(ORIGINAL);
  });

  it("fails loudly when the mutation site is gone", () => {
    // **黙って飛ばさない。** 飛ばすと「検出力を測った」という記録だけが残る。
    const box = sandbox("let z = 3;\n");
    const result = runOneMutation(mutation, { root: box.root, measure: () => { throw new Error("should not run"); } });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("mutation-site-missing");
    expect(box.read()).toBe("let z = 3;\n");
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts`
Expected: FAIL — `runOneMutation` が無い

- [ ] **Step 3: 実装する**

```js
/**
 * 1 変異ぶんを、変異・測定・判定・**復元**まで 1 まとまりで行う。
 *
 * **`finally` は判定まで包む。** 以前は `measure()` だけを包んでいたので、
 * 出力の解析で例外が出た走行では**変異が残った**。
 */
export function runOneMutation(mutation, { root = ROOT, measure: measureFn = measure } = {}) {
  const path = join(root, mutation.file);
  const original = readFileSync(path, "utf-8");
  if (!original.includes(mutation.from)) {
    return {
      id: mutation.id,
      ok: false,
      kind: "mutation-site-missing",
      why: `変異元が ${mutation.file} に無い。engine が変わったので変異を書き直すこと`,
      caught: {},
    };
  }
  writeFileSync(path, original.replace(mutation.from, mutation.to));
  try {
    const measurement = measureFn();
    const verdict = verdictFor(mutation, measurement);
    return { id: mutation.id, ...verdict, caught: measurement.mismatchesByShard };
  } finally {
    writeFileSync(path, original);
    if (readFileSync(path, "utf-8") !== original) {
      throw new Error(`detection-power: ${mutation.file} を戻せなかった`);
    }
  }
}
```

`main()` を `runOneMutation` を呼ぶ形に書き換える。`mutation-site-missing` は
`failed` に数える（現在と同じ）。

- [ ] **Step 4: 通ることを確かめる**

Run: `cd web && pnpm test tests/unit/detection-power.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add web/scripts/detection-power.mjs web/tests/unit/detection-power.test.ts
git commit -m "Put the verdict inside the finally that puts the file back"
```

---

### Task 7: 実走して `minRate` を確定し、記録する

**Files:**
- Modify: `web/scripts/detection-power.mjs`（実測に合わせて `minRate` を書き直す）
- Modify: `docs/corpus-measurements.md`
- Modify: `docs/superpowers/specs/2026-08-19-heavy-detection-power-design.md`（§4.6 に追記）

**Interfaces:** なし（実測と記録）

- [ ] **Step 1: 実走する**

Run: `cd web && pnpm heavy:power 2>&1 | tee /tmp/power.log`
Expected: 8 変異すべてが期待どおり。所要は約 5 分（1 変異あたり実測 34 秒）。

**`cancellation-000.json (values)` が `display-digits` に反応したら**、期待集合が
変わったということなので `expectShards` に足し、**なぜ反応するようになったかを
突き止めてから**書く。

- [ ] **Step 2: 実測率を読む**

Run: `cd web && python3 -c "
import json
d = json.load(open('detection-power.json'))
for r in d['results']:
    for shard, n in sorted(r.get('caught', {}).items()):
        if n: print(f\"{r['id']:28} {shard:36} {n}\")
"`

`heavy-run.json` の `total` で割って率を出し、**その半分**を `minRate` に書く。

- [ ] **Step 3: `minRate` を実測から書き直す**

spec §4.6 の表の値と食い違ったら、**実測を採る**。設計書の表は
2026-08-17 の走行で、コーパス最終形の直前に取られた可能性がある。

- [ ] **Step 4: もう一度走らせて、緑を確かめる**

Run: `cd web && pnpm heavy:power`
Expected: 8 変異すべて ok、終了コード 0

- [ ] **Step 5: 記録する**

`docs/corpus-measurements.md` に、変異ごとの「反応したシャード / 検出数 / 件数 /
率 / `minRate`」の表を書く。**測った日付と HEAD を書く。**

設計書 §4.6 に、`cancellation-000.json` が反応しない理由を追記する
（Step 1 で分かったこと。**分からなければ「まだ分かっていない」と書く**）。

- [ ] **Step 6: commit**

```bash
git add web/scripts/detection-power.mjs docs/corpus-measurements.md docs/superpowers/specs/2026-08-19-heavy-detection-power-design.md
git commit -m "Set the floors from what the corpus actually detects"
```

---

### Task 8: A のフルスイープ

**Files:** なし（検証のみ）

- [ ] **Step 1: web の全検査**

Run: `cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm heavy`
Expected: すべて PASS

- [ ] **Step 2: Rust に触れていないことを確かめる**

Run: `git diff --stat b223bde..HEAD -- crates/`
Expected: **出力が空**（A は Rust を変更しない）

- [ ] **Step 3: 変異が残っていないことを確かめる**

Run: `git status --short && git diff --stat`
Expected: 出力が空（`runOneMutation` の復元が効いている）

- [ ] **Step 4: `pnpm heavy:ui` は回さない**

A は UI を触っていない。`test-tiering-policy` に従い、フルスイープは
**縦積みの末尾（D+E の完了時）に 1 回**回す。

---

## 完了の定義

- [ ] `verdictFor` がビルド失敗・レポート未生成・テスト未実行・シャード欠けを、
      すべて `measurement-failed` として赤にする
- [ ] 期待シャード集合が完全一致で照合される（過剰も不足も赤）
- [ ] 検出の下限が率で書かれ、コーパスの件数が変わっても書き換えが要らない
- [ ] 原状回復が「測定の例外」「判定の例外」「変異元不在」の 3 つでテストされている
- [ ] `pnpm heavy:power` が 8 変異すべてで期待どおり
- [ ] `crates/` の差分が空
