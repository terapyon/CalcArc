import { expect, test } from "@playwright/test";
import {
  type EquivalenceCase,
  loadShards,
  type ValueCase,
  withinTolerance,
} from "./corpus";
import { parseDisplay } from "./display";
import { openHarness, runAll } from "./harness";
import { record, writeReport } from "./report";

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
    let maxRelativeError = 0;
    let maxAbsoluteError = 0;
    const absOnlyCases: string[] = [];
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
      const expected = testCase.expect.re;
      const absoluteError = Math.abs(actual - expected);
      const scale = Math.abs(expected);
      // 期待値が 0 のとき、相対誤差は数学的に定義できない(withinTolerance の
      // rel 分岐も scale > 0 を前提にしている)。「最大」の集計に 0 を足しても
      // 上限を押し上げないので無害だが、分母に 1 の下限を置く近似は使わない
      // ——sci-001332(期待値 |0.17|)のように 1 未満のケースで真の相対誤差
      // より小さい数字が出て、見出しの「観測された最大相対誤差」が実態を
      // 過小に見せてしまう。
      const relativeError = scale > 0 ? absoluteError / scale : 0;
      maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
      maxRelativeError = Math.max(maxRelativeError, relativeError);

      const passed = withinTolerance(actual, expected, shard.tolerance);
      // withinTolerance は abs/rel を OR で判定する。abs の側だけで通った
      // ケースを黙って合格に混ぜると、「rel の許容に収まっている」という
      // 主張が実態より緩くなる(sci-001332 の裁定、設計書 §11)。
      const passedRel = scale > 0 && relativeError <= shard.tolerance.rel;
      if (passed && !passedRel) {
        absOnlyCases.push(
          `${testCase.id}: ${testCase.expr} → ${result.main}, expected ${expected} ` +
            `(rel ${scale > 0 ? relativeError.toExponential(2) : "n/a (expected=0)"}, ` +
            `abs ${absoluteError.toExponential(2)})`,
        );
      }
      if (!passed) {
        mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${result.main}, expected ${expected}`,
        );
      }
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    record({
      name: `${name} (values)`,
      total: values.length,
      values: values.length,
      equivalences: 0,
      mismatches,
      maxRelativeError,
      maxAbsoluteError,
      absOnlyCases,
      tolerance: shard.tolerance,
    });

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
    let maxRelativeError = 0;
    let maxAbsoluteError = 0;
    const absOnlyCases: string[] = [];
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
      const actual = parseDisplay(left.main);
      const expected = parseDisplay(right.main);
      const absoluteError = Math.abs(actual - expected);
      const scale = Math.abs(expected);
      // 右辺が 0 のとき相対誤差は定義できない(理由は値ケース側の注記と同じ)。
      const relativeError = scale > 0 ? absoluteError / scale : 0;
      maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
      maxRelativeError = Math.max(maxRelativeError, relativeError);

      const passed = withinTolerance(actual, expected, shard.tolerance);
      const passedRel = scale > 0 && relativeError <= shard.tolerance.rel;
      if (passed && !passedRel) {
        absOnlyCases.push(
          `${testCase.id}: ${left.main} vs ${right.main} ` +
            `(rel ${scale > 0 ? relativeError.toExponential(2) : "n/a (right=0)"}, ` +
            `abs ${absoluteError.toExponential(2)})`,
        );
      }
      if (!passed) {
        mismatches.push(`${testCase.id}: ${left.main} vs ${right.main}`);
      }
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    record({
      name: `${name} (equivalences)`,
      total: equivalences.length,
      values: 0,
      equivalences: equivalences.length,
      mismatches,
      maxRelativeError,
      maxAbsoluteError,
      absOnlyCases,
      tolerance: shard.tolerance,
    });

    expect(
      mismatches.slice(0, 20).join("\n"),
      `${mismatches.length} of ${equivalences.length} pairs disagree`,
    ).toBe("");
  });
}

test.afterAll(() => {
  writeReport();
});
