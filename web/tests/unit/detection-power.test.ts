import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ALL_SHARDS,
  exitCodeFrom,
  MUTATIONS,
  measure,
  readMeasurement,
  resultRecord,
  runOneMutation,
  verdictFor,
} from "../../scripts/detection-power.mjs";

// **`measure()` を単体テストするための唯一の口。** `detection-power.mjs`
// は `execFileSync`(`node:child_process`)と `rmSync`/`readFileSync`/
// `writeFileSync`(`node:fs`)を通常の名前付き import で取っているので、
// vitest のモジュールモックで差し替えられる――`measure()` 自体を
// テスト可能にするための再設計は要らない。この 2 つのモックは
// ファイル全体に効くが、`measure()`/`main()` 以外のテスト対象
// (`readMeasurement`/`verdictFor`/`resultRecord`/`exitCodeFrom`)は
// どれも fs にも child_process にも触れない純関数なので干渉しない。
vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal<
    typeof import("node:child_process")
  >()) as Record<string, unknown>;
  const execFileSyncMock = vi.fn();
  return {
    ...actual,
    execFileSync: execFileSyncMock,
    default: { ...(actual.default as object), execFileSync: execFileSyncMock },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal<typeof import("node:fs")>()) as Record<
    string,
    unknown
  >;
  const readFileSyncMock = vi.fn();
  const rmSyncMock = vi.fn();
  const writeFileSyncMock = vi.fn();
  return {
    ...actual,
    readFileSync: readFileSyncMock,
    rmSync: rmSyncMock,
    writeFileSync: writeFileSyncMock,
    default: {
      ...(actual.default as object),
      readFileSync: readFileSyncMock,
      rmSync: rmSyncMock,
      writeFileSync: writeFileSyncMock,
    },
  };
});

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

/**
 * **判定に「居るべきシャード」を注入して呼ぶ。**
 *
 * 既定は実物の 18 枚（`ALL_SHARDS`）なので、渡さずに呼ぶとこのファイルの
 * テストは全部「17 枚足りない」で赤くなる。検査が引数に無いものに依存しない
 * ようにした結果で、ここで偽の 2 枚を渡すのが正しい使い方である。
 */
const verdict = (
  mutation: Parameters<typeof verdictFor>[0],
  m: Parameters<typeof verdictFor>[1],
) => verdictFor(mutation, m, ALL);

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
    const v = verdict(
      nothingExpected,
      measurement({ buildOk: false, playwrightExitCode: null }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run with no run summary", () => {
    const v = verdict(
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
    const v = verdict(nothingExpected, measurement({ ranTests: false }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("refuses a run that is missing a shard, even when the reacting set matches", () => {
    // **完全一致は、黙っているべきシャードが実際に読まれて初めて意味を持つ。**
    const v = verdict(
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

  it("refuses a run that carries a shard the list does not know", () => {
    // **過剰の側も見る。** 欠けだけを見ていると、1 枚消えて 1 枚増えた走行が
    // 緑で通る。名前で持っているので、何が増えたかも言える。
    const v = verdict(
      nothingExpected,
      measurement({
        shardsSeen: [...ALL, "c (values)"],
        expected: [...ALL, "c (values)"],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
    expect(v.why).toContain("c (values)");
  });

  it("does not take the run's own word for which shards should be there", () => {
    // **これが定数を置いた理由である。** シャードのファイルが 1 枚消えると、
    // 走行が導く `expected` も一緒に縮む。走行の自己申告と突き合わせている
    // 限り、14 枚しか読んでいない走行が「完全一致」を語れてしまう
    // (設計書 §4.4)。`expected` が縮んでいても赤くなること。
    const v = verdict(
      aExpected,
      measurement({
        shardsSeen: ["a (values)"],
        expected: ["a (values)"],
        mismatchesByShard: { "a (values)": 500 },
        totalsByShard: { "a (values)": 2000 },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
    expect(v.why).toContain("b (values)");
  });

  it("names eighteen shards, and names them once", () => {
    // 既定の一覧そのものを見る。**枚数だけでは 1 枚消えて 1 枚増えた走行を
    // 通してしまう**ので、重複が無いことも一緒に見る。
    expect(ALL_SHARDS).toHaveLength(18);
    expect(new Set(ALL_SHARDS).size).toBe(18);
  });

  it("expects only shards that this run is supposed to load", () => {
    // **これが無いと、赤確認が静かに緑になりうる。** `verdictFor` の健全性の
    // 判定 4 が見るのは「読み込まれたシャードの集合 = `ALL_SHARDS`」だけで、
    // **`expectShards` が `ALL_SHARDS` に無い名前を挙げていても何も言わない**
    // ——挙げたシャードが走行に居ないのだから 1 件も反応しようがなく、判定は
    // `caught-nothing`(「コーパスが捕まえられなかった」)になる。それは
    // 測定の失敗であって検出力の欠如ではない。実測: 計画 Task 4 Step 1 で、
    // `associativity-000.json` をまだ置かずに期待だけを反転したときの判定が
    // まさにこれだった。名前の綴り違いも同じ形で紛れ込むので、静的に縛る。
    for (const mutation of MUTATIONS) {
      for (const name of mutation.expectShards) {
        expect(ALL_SHARDS, `${mutation.id} が挙げた ${name}`).toContain(name);
      }
      for (const name of Object.keys(mutation.minRate ?? {})) {
        expect(
          mutation.expectShards,
          `${mutation.id} の minRate にある ${name}`,
        ).toContain(name);
      }
    }
  });

  it("accepts a healthy run where nothing reacted", () => {
    const v = verdict(nothingExpected, measurement());
    expect(v.ok).toBe(true);
  });

  it("calls it a false claim when something reacted that should not have", () => {
    const v = verdict(
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
    const v = verdict(nothingExpected, measurement({ playwrightExitCode: 1 }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });
});

describe("the expected shard set is matched exactly", () => {
  it("rejects an extra shard", () => {
    const v = verdict(
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
    const v = verdict(
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
    const v = verdict(aExpected, measurement());
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("caught-nothing");
  });

  it("calls it measurement-failed, not caught-nothing, when the run broke and nothing reacted", () => {
    // **Minor 4 と同じ誤ラベルが、こちらの枝にも残っていた。** 健全性
    // チェック 1〜4 を通っている以上シャードの比較自体は完了している――
    // 非ゼロ終了はシャード比較とは別のテストが落ちたということで、走行
    // そのものが壊れているのであって、コーパスが検出できなかったのでは
    // ない。`caught-nothing`(コーパスの検出力の話)のままだと、隣の
    // `expectShards === []` の枝と同じ状況に違う意味論を割り当てることに
    // なる。
    const v = verdict(aExpected, measurement({ playwrightExitCode: 1 }));
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });
});

describe("the detection floor is a rate, so the corpus can grow", () => {
  it("passes at the same rate on a bigger shard", () => {
    // **2000 件で 200、4000 件で 400。率が同じなら緑。**
    // B+C がコーパスを 3,500 件に増やしても、この表を書き換えずに済む。
    const small = verdict(
      aExpected,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 200, "b (values)": 0 },
      }),
    );
    const big = verdict(
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
    const v = verdict(
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
    const v = verdict(
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

    const exact = verdict(
      rateMutation,
      measurement({
        playwrightExitCode: 1,
        mismatchesByShard: { "a (values)": 959, "b (values)": 0 },
        totalsByShard: totals,
      }),
    );
    expect(exact.ok).toBe(true);

    const oneShort = verdict(
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

describe("measure() removes the stale heavy-run.json before it can be misread as this mutation's result", () => {
  // **この欠陥はテストではなくレビューが見つけた。** playwright の起動
  // そのものが失敗すると(ビルド失敗、あるいは spawn 自体の失敗)、
  // playwright の globalSetup(`resetRun()`)まで到達しない――
  // `heavy-run.json` を消すのはそこだけなので、`measure()` が先に消して
  // おかないと**前の変異が書いたファイルが残ったまま**次の測定に読まれ、
  // 健全性チェック 4 つを全部素通りして、走っていない変異が前の変異の
  // 不一致件数で「期待どおり」と判定される。直したのに見張るものが
  // 無いと、次に誰かが `measure()` を書き換えたときこの形へ静かに戻る
  // ――それがこの spec が消そうとしている偽陽性そのものである。
  it("calls rmSync on heavy-run.json before the first execFileSync (pnpm wasm)", () => {
    const calls: Array<[string, string]> = [];
    vi.mocked(rmSync).mockImplementation((path) => {
      calls.push(["rmSync", String(path)]);
    });
    vi.mocked(execFileSync).mockImplementation((command) => {
      calls.push(["execFileSync", String(command)]);
      return "";
    });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    vi.mocked(writeFileSync).mockImplementation(() => undefined);

    measure();

    expect(calls.length).toBeGreaterThan(0);
    // **順序が本題。** 最初の呼び出しが rmSync で、対象が heavy-run.json
    // であること。
    const first = calls[0];
    expect(first).toBeDefined();
    const [firstName, firstArg] = first as [string, string];
    expect(firstName).toBe("rmSync");
    expect(firstArg).toMatch(/heavy-run\.json$/);

    const firstExecIndex = calls.findIndex(([name]) => name === "execFileSync");
    expect(firstExecIndex).toBeGreaterThan(0);
  });
});

describe("the caller can bring its own verdict", () => {
  // **判定の差し替えは、戻しの手続きを写さないための口である。**
  // `runOneMutation` は「変異を当てる → 測る → **必ず戻す** → 戻ったことを
  // バイトで確かめる」を持っている。別の測り先(0.3.0 の 3 計算は生成
  // コーパスを持たないので `cargo test` を見る)のために手続きを写すと、
  // **戻し忘れの経路が 2 つになる。** 差し替えるのは測り方と判定だけ。
  //
  // このファイルは `node:fs` をモジュールごとモックしているので、実ファイル
  // ではなく**メモリ上の 1 ファイル**で往復を見る。前のテストが
  // `readFileSync` に ENOENT を投げる実装を残すため、ここで置き直す。
  it("lets the caller decide the verdict, without touching the shard rules", () => {
    const path = join(tmpdir(), "exact-power.txt");
    const files = new Map<string, string>([[path, "alpha beta"]]);
    vi.mocked(readFileSync).mockImplementation((target) => {
      const found = files.get(String(target));
      if (found === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return found;
    });
    vi.mocked(writeFileSync).mockImplementation((target, data) => {
      files.set(String(target), String(data));
    });

    const mutation = {
      id: "m",
      what: "w",
      file: basename(path),
      from: "beta",
      to: "gamma",
    };
    const seen: string[] = [];
    const record = runOneMutation(mutation, {
      root: tmpdir(),
      measure: () => {
        seen.push(String(readFileSync(path, "utf-8")));
        return { failed: ["x"] };
      },
      verdict: () => ({ ok: true, kind: "ok", why: "注入された判定" }),
    });

    // 測っているあいだは変異が当たっている
    expect(seen).toEqual(["alpha gamma"]);
    // 判定は注入されたものが使われる
    expect(record.ok).toBe(true);
    expect(record.why).toBe("注入された判定");
    // **戻っている**——ここが写したくない手続きである
    expect(files.get(path)).toBe("alpha beta");
  });
});
