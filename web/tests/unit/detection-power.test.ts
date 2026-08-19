import { describe, expect, it } from "vitest";
import {
  exitCodeFrom,
  MUTATIONS,
  readMeasurement,
  resultRecord,
  verdictFor,
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
const aExpected = {
  id: "m",
  expectShards: ["a (values)"],
  minRate: { "a (values)": 0.1 },
};

describe("the verdict looks at the health of the measurement first", () => {
  it("refuses to call a failed build 'nothing was detected'", () => {
    // **指示書 §4.2 の核心。** これが緑になるなら、この層は何も保証していない。
    const v = verdictFor(
      nothingExpected,
      measurement({ buildOk: false, playwrightExitCode: null }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run with no run summary", () => {
    const v = verdictFor(
      nothingExpected,
      measurement({
        runJsonFound: false,
        ranTests: false,
        shardsSeen: [],
        expected: [],
      }),
    );
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
    const v = verdictFor(
      aExpected,
      measurement({
        shardsSeen: ["a (values)"],
        mismatchesByShard: { "a (values)": 500 },
        totalsByShard: { "a (values)": 2000 },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("accepts a healthy run where nothing reacted", () => {
    const v = verdictFor(nothingExpected, measurement());
    expect(v.ok).toBe(true);
  });

  it("calls it a false claim when something reacted that should not have", () => {
    const v = verdictFor(
      nothingExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 3, "b (values)": 0 },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("claim-was-false");
  });
});

describe("the expected shard set is matched exactly", () => {
  it("rejects an extra shard", () => {
    const v = verdictFor(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 500, "b (values)": 1 },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("shard-set-mismatch");
  });

  it("rejects a missing shard", () => {
    const v = verdictFor(
      { id: "m", expectShards: ["a (values)", "b (values)"], minRate: {} },
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 500, "b (values)": 0 },
      }),
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
    const small = verdictFor(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 200, "b (values)": 0 },
      }),
    );
    const big = verdictFor(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 400, "b (values)": 0 },
        totalsByShard: { "a (values)": 4000, "b (values)": 2000 },
      }),
    );
    expect(small.ok).toBe(true);
    expect(big.ok).toBe(true);
  });

  it("fails when the rate halves", () => {
    const v = verdictFor(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 99, "b (values)": 0 },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("below-min-rate");
  });

  it("still demands one case when no rate is named", () => {
    // 薄い帯(ncr は 10/2000 = 0.5%)を率だけで縛ると、丸めで 0 件が通る。
    const v = verdictFor(
      { id: "m", expectShards: ["a (values)"], minRate: {} },
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 1, "b (values)": 0 },
      }),
    );
    expect(v.ok).toBe(true);
  });
});

describe("resultRecord builds the JSON that report.ts reads", () => {
  // **`report.ts` の `DetectionPower` 契約を実データで確かめる。** 型検査は
  // ここを見ない――`report.ts` 側は `JSON.parse(...) as DetectionPower` で
  // キャストしているだけなので、項目が欠けても `tsc` は黙って通す。この
  // テストが赤くならない限り、次に誰かが項目名を変えても気づけない。
  const ok = { ok: true, kind: "ok", why: "healthy" };

  it("keeps zero-count shards out of caught", () => {
    const r = resultRecord(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 5, "b (values)": 0 },
      }),
      ok,
    );
    expect(r.caught).toEqual({ "a (values)": 5 });
  });

  it("sums caught into total", () => {
    const r = resultRecord(
      { id: "m", expectShards: ["a (values)", "b (values)"], minRate: {} },
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 5, "b (values)": 3 },
      }),
      ok,
    );
    expect(r.total).toBe(8);
  });

  it('writes expect as the string "nothing" when expectShards is empty', () => {
    const r = resultRecord(nothingExpected, measurement(), ok);
    expect(r.expect).toBe("nothing");
  });

  it("writes expect as a joined string when expectShards is not empty", () => {
    const r = resultRecord(
      { id: "m", expectShards: ["a (values)", "b (values)"], minRate: {} },
      measurement(),
      ok,
    );
    expect(r.expect).toBe("a (values), b (values)");
  });

  it("has every field report.ts's DetectionPower type reads", () => {
    // **本命。** id / what / expect / caught / total / ok / why が全部揃って
    // いることを、型ではなく実データで主張する。
    const r = resultRecord(aExpected, measurement(), ok);
    for (const field of [
      "id",
      "what",
      "expect",
      "caught",
      "total",
      "ok",
      "why",
    ]) {
      expect(r, `missing field: ${field}`).toHaveProperty(field);
    }
    expect(typeof r.expect).toBe("string");
    expect(typeof r.caught).toBe("object");
    expect(typeof r.total).toBe("number");
  });
});
