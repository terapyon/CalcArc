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

  it("calls it measurement-failed, not a false claim, when the run broke but nothing reacted", () => {
    // **走行が壊れただけでは、レポートの「踏んでいない」は破られていない。**
    // 終了コードが非ゼロでも、どのシャードも反応していないなら、シャード
    // 比較とは別の理由(タイムアウト等)で走行そのものが壊れただけ――
    // spec A §4.5 の「1〜4 は測れていない」に属するので、
    // `claim-was-false`(検出の結果)ではなく `measurement-failed` になる。
    const v = verdictFor(
      nothingExpected,
      measurement({ playwrightExitCode: 1 }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
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
    // **`minRate` を省略しても、無条件で通るわけではない。** ここに来る
    // 時点で直前の `sameSet` が保証しているのは「反応したシャードの集合が
    // `expectShards` と一致する」ことだけで、それは 1 件だけ検出したことの
    // 言い換えでしかない――率を書かなければ下限は実質 1 件になる。ここでは
    // ちょうど 1 件検出しているので緑になる。
    const v = verdictFor(
      { id: "m", expectShards: ["a (values)"], minRate: {} },
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 1, "b (values)": 0 },
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("does not let f64 rounding turn 3500 rows at rate 0.274 into a floor of 960", () => {
    // **本命の浮動小数の罠。** `3500 * 0.274` は数学的には 959 だが、f64 では
    // `959.0000000000001` になる。素の `Math.ceil` はこれを 960 に切り上げて
    // しまい、実測ちょうど 959 件の走行を「1 件足りない」と誤判定する――
    // 率で下限を持たせた目的(コーパスが増えても表を書き換えずに済む)を、
    // まさにこの場面で裏切る。3,500 件は B+C がコーパスを増やす予定の件数、
    // 0.274 は `precedence-collapse` の率(spec §4.6)。
    expect(3500 * 0.274).not.toBe(959);
    expect(Math.ceil(3500 * 0.274)).toBe(960);

    const rateMutation = {
      id: "m",
      expectShards: ["a (values)"],
      minRate: { "a (values)": 0.274 },
    };
    const totals = { "a (values)": 3500, "b (values)": 2000 };

    const exact = verdictFor(
      rateMutation,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 959, "b (values)": 0 },
        totalsByShard: totals,
      }),
    );
    expect(exact.ok).toBe(true);

    const oneShort = verdictFor(
      rateMutation,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 958, "b (values)": 0 },
        totalsByShard: totals,
      }),
    );
    expect(oneShort.ok).toBe(false);
    expect(oneShort.kind).toBe("below-min-rate");
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
