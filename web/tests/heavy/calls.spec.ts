import { expect, test } from "@playwright/test";
import { describe, differences } from "./calls";
import { type CallCase, loadCallShards } from "./corpus";
import { openHarness } from "./harness";
import { record, summaryName } from "./report";

/**
 * 金融とデータスケールの照合(設計書 2026-08-17)。
 *
 * **科学計算とは比較の仕方が違う。** あちらは表示 10 桁を相対許容で見るが、
 * こちらは**円とバイト数の整数**なので厳密一致で比べる。1 円違えば違うと言える。
 *
 * 期待値は `compound_ref` / `loan_ref` / `data_scale_ref` が Python の
 * 任意精度整数と `Decimal` で出したもの。Rust は f64 と u64 で計算しており、
 * **アルゴリズムを共有していない。**
 */

/** 1 束あたりのケース数。往復のコストが計算のコストを覆わない大きさにする。 */
const BATCH = 500;

for (const { name, shard } of loadCallShards()) {
  test(`every call in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    const cases = shard.cases;
    const mismatches: string[] = [];

    for (let start = 0; start < cases.length; start += BATCH) {
      const batch = cases.slice(start, start + BATCH);
      const results = await page.evaluate(
        (input: { op: string; input: Record<string, unknown> }[]) => {
          const harness = window.__calcarc;
          if (harness === undefined) {
            throw new Error("harness is not on the page");
          }
          return harness.runCalls(input as never);
        },
        batch.map((c: CallCase) => ({ op: c.op, input: c.input })),
      );
      batch.forEach((testCase: CallCase, index: number) => {
        const diff = differences(
          results[index],
          testCase.expect,
          testCase.input,
        );
        if (diff.length > 0) {
          mismatches.push(
            `${testCase.id} (${testCase.op} ${JSON.stringify(testCase.input)}): ` +
              describe(diff),
          );
        }
      });
    }

    // **expect より先に記録する。** 落ちたときこそ報告書が要る。
    record({
      name: summaryName(name, "calls"),
      total: cases.length,
      values: cases.length,
      equivalences: 0,
      generatedBy: shard.generated_by,
      mismatches,
      // 整数の厳密一致なので、誤差という概念が無い。**0 は「測っていない」では
      // なく「ずれが存在しない」**である。
      maxRelativeError: 0,
      maxAbsoluteError: 0,
      appliedOverrides: [],
      relUndefinedCases: [],
      relMeasured: 0,
      relUndefinedNonZeroAbs: 0,
      looserThanDisplay: 0,
      precedenceCases: 0,
      exponentDisplayCases: 0,
      // **エラーを期待値として持つケース。** 金融とデータスケールは入力の
      // 検証が仕事の一部なので、エラーになること自体が仕様である。
      errorCases: cases.filter((c: CallCase) => "error" in c.expect).length,
      worstEffectiveRelTolerance: 0,
      bands: {
        display: cases.length,
        "1e-9": 0,
        "1e-7": 0,
        "1e-5": 0,
        worse: 0,
        undefined: 0,
      },
      shape: { sequences: cases.length, tokens: {}, depths: {} },
      magnitudes: { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0 },
      tolerance: { abs: 0, rel: 0 },
    });

    expect(
      mismatches,
      `${name}: ${mismatches.length} of ${cases.length} calls disagreed with ` +
        "the reference implementation. These are exact integer comparisons — " +
        "a difference is a difference, not a rounding artefact.",
    ).toEqual([]);
  });
}
