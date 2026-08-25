import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXACT_MUTATIONS,
  parseFailedTests,
  ROOT,
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

describe("the defects in the table", () => {
  it("declares a from-string that still exists in the file it names", () => {
    // **黙って当たらない変異を許さない。** `runOneMutation` は
    // `mutation-site-missing` を返すが、それは表の全件について
    // `cargo test` を回して初めて分かる。engine が動いたらここで気づく。
    //
    // **見出しに件数を書かない。** 表は増える(6 種 → 10 種、2026-08-25 に
    // currency の 4 種を足した)ので、数を書くと緑のまま嘘になる。
    expect(EXACT_MUTATIONS.length).toBeGreaterThan(0);
    for (const mutation of EXACT_MUTATIONS) {
      const source = readFileSync(join(ROOT, mutation.file), "utf-8");
      expect(source, `${mutation.id} の from`).toContain(mutation.from);
      expect(mutation.from, `${mutation.id}: from と to が同じ`).not.toBe(
        mutation.to,
      );
    }
  });

  it("expects at least one test per mutation", () => {
    // **期待が空の変異は、何を測っているのか誰にも分からない。**
    // `verdictForTests` は `expectTests` が空だと「1 本も赤くならなかった
    // 走行」を `ok` と判定する——空の期待は空の集合と一致するからである。
    // 表を空のままコミットしないことは、判定ではなくここで縛る。
    for (const mutation of EXACT_MUTATIONS) {
      expect(mutation.expectTests.length, mutation.id).toBeGreaterThan(0);
    }
  });
});
