import { describe, expect, it } from "vitest";
import {
  exitCodeFrom,
  MUTATIONS,
  readMeasurement,
} from "../../scripts/detection-power.mjs";

describe("the mutation table", () => {
  it("is not empty and every entry names a real place to break", () => {
    // **空の表は「検出力を測った」という記録だけを残す。**
    expect(MUTATIONS.length).toBeGreaterThan(0);
    for (const mutation of MUTATIONS) {
      expect(mutation.id, "every mutation needs an id").toBeTruthy();
      expect(mutation.file, `${mutation.id}: needs a file`).toMatch(
        /^crates\//,
      );
      expect(mutation.from, `${mutation.id}: needs a from`).toBeTruthy();
      expect(mutation.to, `${mutation.id}: needs a to`).toBeTruthy();
      expect(mutation.from, `${mutation.id}: from and to must differ`).not.toBe(
        mutation.to,
      );
    }
  });
});

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
    const m = readMeasurement({
      buildOk: true,
      playwrightExitCode: 1,
      run: null,
    });
    expect(m.runJsonFound).toBe(false);
    expect(m.ranTests).toBe(false);
    expect(m.shardsSeen).toEqual([]);
    expect(m.expected).toEqual([]);
  });

  it("carries the build failure through untouched", () => {
    const m = readMeasurement({
      buildOk: false,
      playwrightExitCode: null,
      run: null,
    });
    expect(m.buildOk).toBe(false);
    expect(m.playwrightExitCode).toBeNull();
  });

  // **壊れた要約は、無い要約と同じだけ何も言っていない。** `heavy-run.json`
  // は存在して valid JSON だが、期待した形をしていない場合。ここで
  // `run.shards` をそのまま走査すると `TypeError` が `measure()` を
  // 突き抜けてしまう――測定の失敗を例外ではなく構造化された事実にする、
  // というこの spec の目的に反する。
  it("treats a run with no shards array as not found, not a crash", () => {
    const m = readMeasurement({
      buildOk: true,
      playwrightExitCode: 1,
      run: { schema: 1, ranTests: true, expected: [] },
    });
    expect(m.runJsonFound).toBe(false);
    expect(m.shardsSeen).toEqual([]);
  });

  it("treats a run with the wrong schema version as not found", () => {
    const m = readMeasurement({
      buildOk: true,
      playwrightExitCode: 1,
      run: { schema: 2, ranTests: true, expected: [], shards: [] },
    });
    expect(m.runJsonFound).toBe(false);
  });

  it("treats a bare JSON literal (JSON.parse('5')) as not found", () => {
    const m = readMeasurement({ buildOk: true, playwrightExitCode: 1, run: 5 });
    expect(m.runJsonFound).toBe(false);
    expect(m.shardsSeen).toEqual([]);
  });
});

describe("reading playwright's exit code out of a spawn error", () => {
  it("keeps a real exit code", () => {
    expect(exitCodeFrom({ status: 1 })).toBe(1);
    expect(exitCodeFrom({ status: 0 })).toBe(0);
  });

  // **spawn 失敗を「走って落ちた」にすり替えない。** `ENOENT` などで
  // playwright 自体が起動できなかったとき、`error.status` は数値でない
  // (`undefined` や `null`)。ここを `1` にすり替えると「終了コード 1 で
  // 落ちた」と読めてしまうが、実際には一度も走っていない。
  it("returns null when the process never ran (ENOENT etc.)", () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
      status: null,
    });
    expect(exitCodeFrom(enoent)).toBeNull();
    expect(exitCodeFrom({})).toBeNull();
  });
});
