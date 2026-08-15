import { expect, test } from "@playwright/test";
import {
  type EquivalenceCase,
  loadShards,
  type ValueCase,
  withinTolerance,
} from "./corpus";
import { parseDisplay } from "./display";
import { openHarness, runAll } from "./harness";

test("withinTolerance compares against the numbers it is handed", () => {
  // ここのリテラルは **withinTolerance 自身の入力**であって、コーパスの
  // 許容誤差ではない。実際の比較(下の test)は shard.tolerance だけを使う。
  // CLAUDE.md が禁じているのは後者をコードに書くことである。
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  expect(withinTolerance(1, 1 + 1e-12, tolerance)).toBe(true);
  expect(withinTolerance(1, 1.5, tolerance)).toBe(false);
  // 相対誤差が効く大きさ。
  expect(withinTolerance(1e8, 1e8 + 1, tolerance)).toBe(false);
});

test("at least one shard is present", () => {
  expect(loadShards().length).toBeGreaterThan(0);
});

for (const { name, shard } of loadShards()) {
  const values = shard.cases.filter((c): c is ValueCase => c.kind === "value");
  if (values.length === 0) {
    continue;
  }
  test(`every case in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    // 1 シャード = 1 往復。ケースごとに evaluate すると往復が計算を覆い隠す。
    const results = await runAll(
      page,
      values.map((c) => c.keys),
    );

    const mismatches: string[] = [];
    for (const [index, testCase] of values.entries()) {
      const result = results[index];
      if (result === undefined) {
        mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (result.error !== null) {
        mismatches.push(
          `${testCase.id}: ${testCase.expr} → error ${result.error}`,
        );
        continue;
      }
      const actual = parseDisplay(result.main);
      if (!withinTolerance(actual, testCase.expect.re, shard.tolerance)) {
        mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${result.main}, expected ${testCase.expect.re}`,
        );
      }
    }

    // 先頭 20 件だけ読ませる。端末で読める量に上限を置き、全件は
    // Task 8 のレポートが持つ(設計書 §8)。
    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${values.length} cases disagree`,
    ).toBe("");
  });
}

for (const { name, shard } of loadShards()) {
  const equivalences = shard.cases.filter(
    (c): c is EquivalenceCase => c.kind === "equivalence",
  );
  if (equivalences.length === 0) {
    continue;
  }
  test(`both routes agree in ${name}`, async ({ page }) => {
    await openHarness(page);
    // 左右をまとめて 1 往復で流す。前半が左、後半が右。
    const results = await runAll(page, [
      ...equivalences.map((c) => c.left),
      ...equivalences.map((c) => c.right),
    ]);

    const mismatches: string[] = [];
    for (const [index, testCase] of equivalences.entries()) {
      const left = results[index];
      const right = results[index + equivalences.length];
      if (left === undefined || right === undefined) {
        mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (left.error !== null || right.error !== null) {
        mismatches.push(
          `${testCase.id}: error ${left.error ?? "none"} / ${right.error ?? "none"}`,
        );
        continue;
      }
      if (
        !withinTolerance(
          parseDisplay(left.main),
          parseDisplay(right.main),
          shard.tolerance,
        )
      ) {
        mismatches.push(`${testCase.id}: ${left.main} vs ${right.main}`);
      }
    }

    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${equivalences.length} pairs disagree`,
    ).toBe("");
  });
}
