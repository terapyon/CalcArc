import { describe, expect, it } from "vitest";
import { MUTATIONS, readMeasurement } from "../../scripts/detection-power.mjs";

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
});
