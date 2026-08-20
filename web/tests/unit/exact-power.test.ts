import { describe, expect, it } from "vitest";
import {
  parseFailedTests,
  readCargoMeasurement,
  verdictForTests,
} from "../../scripts/exact-power.mjs";

const SAMPLE = [
  "running 27 tests",
  "test convert::tests::mm_to_in_is_exact ... ok",
  "test convert::tests::degf_offset_is_not_dropped ... FAILED",
  "test data_scale::transfer::tests::a_partial_byte_rounds_up ... FAILED",
  "test result: FAILED. 25 passed; 2 failed; 0 ignored",
].join("\n");

describe("what cargo printed", () => {
  it("takes the failing test names, not the passing ones", () => {
    expect(parseFailedTests(SAMPLE)).toEqual([
      "convert::tests::degf_offset_is_not_dropped",
      "data_scale::transfer::tests::a_partial_byte_rounds_up",
    ]);
  });

  it("returns an empty list when everything passed, and that is not an error", () => {
    expect(
      parseFailedTests("test a ... ok\ntest result: ok. 1 passed"),
    ).toEqual([]);
  });

  it("does not mistake the summary line for a test", () => {
    // `test result: FAILED.` は 1 行だけ形が似ている。**数え間違えると、
    // 変異が捕まった件数が毎回 1 多くなる。**
    expect(parseFailedTests("test result: FAILED. 0 passed; 1 failed")).toEqual(
      [],
    );
  });
});

describe("the verdict names both sides", () => {
  const mutation = {
    id: "m",
    what: "w",
    file: "crates/x.rs",
    from: "a",
    to: "b",
    expectTests: ["convert::tests::degf_offset_is_not_dropped"],
  };

  it("refuses to call a failed build 'nothing was detected'", () => {
    const v = verdictForTests(
      mutation,
      readCargoMeasurement({ buildOk: false, exitCode: null, stdout: "" }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("measurement-failed");
  });

  it("is ok when exactly the expected tests went red", () => {
    const stdout = "test convert::tests::degf_offset_is_not_dropped ... FAILED";
    const v = verdictForTests(
      mutation,
      readCargoMeasurement({ buildOk: true, exitCode: 101, stdout }),
    );
    expect(v.ok).toBe(true);
  });

  it("is not ok when the expected test stayed green", () => {
    const v = verdictForTests(
      mutation,
      readCargoMeasurement({
        buildOk: true,
        exitCode: 0,
        stdout: "test x ... ok",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("caught-nothing");
  });

  it("is not ok when a test nobody expected went red", () => {
    // **片側だけの主張にしない。** 期待していない赤は、変異が広すぎるか、
    // 期待の書き方が足りないかのどちらかで、**どちらも測定の欠陥である。**
    const stdout = [
      "test convert::tests::degf_offset_is_not_dropped ... FAILED",
      "test data_scale::transfer::tests::a_partial_byte_rounds_up ... FAILED",
    ].join("\n");
    const v = verdictForTests(
      mutation,
      readCargoMeasurement({ buildOk: true, exitCode: 101, stdout }),
    );
    expect(v.ok).toBe(false);
    expect(v.kind).toBe("unexpected-red");
    expect(v.why).toContain(
      "data_scale::transfer::tests::a_partial_byte_rounds_up",
    );
  });
});
