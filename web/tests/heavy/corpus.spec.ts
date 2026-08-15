import { expect, type Page, test } from "@playwright/test";
import {
  assertSupportedMode,
  type Classification,
  classify,
  type EquivalenceCase,
  loadShards,
  quantiles,
  summarizeShape,
  TOLERANCE_BANDS,
  type Tolerance,
  type ToleranceBand,
  type ValueCase,
  withinTolerance,
} from "./corpus";
import { parseDisplay } from "./display";
import { coreVersion, openHarness, runAll } from "./harness";
import { noteRuntime, record, writeReport } from "./report";

// **1 度だけ読む。** モジュールのトップレベルで 3 回呼ぶと 1.6MB の JSON を
// 3 回パースすることになる(レビュー修正ラウンド 2)。
const shards = loadShards();

test("withinTolerance compares against the numbers it is handed", () => {
  // ここのリテラルは **withinTolerance 自身の入力**であって、コーパスの
  // 許容誤差ではない。実際の比較(下の test)は shard.tolerance だけを使う。
  // CLAUDE.md が禁じているのは後者をコードに書くことである。
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  expect(withinTolerance(1, 1 + 1e-12, tolerance)).toBe(true);
  expect(withinTolerance(1, 1.5, tolerance)).toBe(false);
  // 相対誤差が効く大きさ。
  expect(withinTolerance(1e8, 1e8 + 1, tolerance)).toBe(false);
  // **rel は超えたが abs で通る経路。** 実運用で実際に起きている経路なのに
  // 未テストだった(レビュー修正ラウンド 2)。相対誤差は 4e-2 で rel の
  // 4000 万倍だが、絶対誤差は 4e-10 で abs に収まるので「通った」になる。
  expect(withinTolerance(1e-8, 1e-8 + 4e-10, tolerance)).toBe(true);
});

test("classify says how loosely the OR actually checked the case", () => {
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  // |期待値| ≥ 1: abs の側は rel より厳しいので、実効的な相対許容は rel。
  const big = classify(10, 10, tolerance);
  expect(big.effectiveRelTolerance).toBeCloseTo(1e-9, 20);
  expect(big.bucket).toBe("display");
  // |期待値| < 1: abs の側が緩い方になる。1e-9 / 1e-3 = 1e-6。
  const small = classify(1e-3, 1e-3, tolerance);
  expect(small.effectiveRelTolerance).toBeCloseTo(1e-6, 12);
  expect(small.bucket).toBe("1e-5");
  // 期待値が厳密に 0 のときは相対の保証が無い。
  const zero = classify(0, 0, tolerance);
  expect(zero.bucket).toBe("undefined");
  expect(zero.effectiveRelTolerance).toBe(Number.POSITIVE_INFINITY);
});

test("at least one shard is present", () => {
  expect(shards.length).toBeGreaterThan(0);
});

test("every case in every shard declares the one mode this stage runs", () => {
  // 段階 2 は Deg だけ。ハーネスは angle_toggle を押さない。
  for (const { name, shard } of shards) {
    assertSupportedMode(name, shard.cases);
  }
  // 宣言が守られていないコーパスを渡したら、黙って既定のモードで回さずに落ちる。
  expect(() =>
    assertSupportedMode("made-up.json", [
      {
        kind: "value",
        id: "x-000",
        mode: "Rad",
        keys: ["1"],
        expr: "1",
        expect: { re: 1, im: 0 },
      },
    ]),
  ).toThrow(/Rad/);
});

/**
 * 1 シャード分の集計。**値ケースと同値ケースが同じものを使う。**
 * 比較の記録を二箇所に書くと、片方だけ直す事故が起きる。
 * 段階 3 で両者は分岐するので、ここは分岐しない部分だけを持つ。
 */
interface Tally {
  mismatches: string[];
  absOnlyCases: string[];
  relUndefinedCases: string[];
  maxRelativeError: number;
  maxAbsoluteError: number;
  looserThanDisplay: number;
  worstEffectiveRelTolerance: number;
  bands: Record<ToleranceBand, number>;
  magnitudes: number[];
}

function newTally(): Tally {
  const bands = {} as Record<ToleranceBand, number>;
  for (const band of TOLERANCE_BANDS) {
    bands[band] = 0;
  }
  return {
    mismatches: [],
    absOnlyCases: [],
    relUndefinedCases: [],
    maxRelativeError: 0,
    maxAbsoluteError: 0,
    looserThanDisplay: 0,
    worstEffectiveRelTolerance: 0,
    bands,
    magnitudes: [],
  };
}

function tally(
  into: Tally,
  tolerance: Tolerance,
  id: string,
  description: string,
  result: Classification,
): void {
  into.maxAbsoluteError = Math.max(into.maxAbsoluteError, result.absoluteError);
  into.maxRelativeError = Math.max(into.maxRelativeError, result.relativeError);
  into.bands[result.bucket] += 1;
  if (result.bucket !== "display" && result.bucket !== "undefined") {
    // 表示分解能(rel)より緩く検査されたケース。abs の下駄が効いている。
    into.looserThanDisplay += 1;
  }
  if (Number.isFinite(result.effectiveRelTolerance)) {
    into.worstEffectiveRelTolerance = Math.max(
      into.worstEffectiveRelTolerance,
      result.effectiveRelTolerance,
    );
  }
  // withinTolerance は abs/rel を OR で判定する。abs の側だけで通った
  // ケースを黙って合格に混ぜると、「rel の許容に収まっている」という
  // 主張が実態より緩くなる(sci-001332 の裁定、設計書 §11)。
  //
  // 期待値が厳密に 0 のケースは rel が数学的に定義できないだけで、
  // 精度限界とは別物(修正ラウンド 1 のレビュー指摘)。別に集計する。
  if (result.passed && result.bucket === "undefined") {
    into.relUndefinedCases.push(
      `${id}: ${description} (abs ${result.absoluteError.toExponential(2)})`,
    );
  } else if (result.passed && result.relativeError > tolerance.rel) {
    into.absOnlyCases.push(
      `${id}: ${description} (rel ${result.relativeError.toExponential(2)}, ` +
        `abs ${result.absoluteError.toExponential(2)})`,
    );
  }
  if (!result.passed) {
    into.mismatches.push(`${id}: ${description}`);
  }
}

function browserLabel(page: Page): string {
  const browser = page.context().browser();
  return browser
    ? `${browser.browserType().name()} ${browser.version()}`
    : "unknown";
}

for (const { name, shard } of shards) {
  const values = shard.cases.filter((c): c is ValueCase => c.kind === "value");
  if (values.length === 0) {
    continue;
  }
  test(`every case in ${name} matches the reference`, async ({ page }) => {
    assertSupportedMode(name, values);
    await openHarness(page);
    noteRuntime(await coreVersion(page), browserLabel(page));
    // 1 シャード = 1 往復。ケースごとに evaluate すると往復が計算を覆い隠す。
    const results = await runAll(
      page,
      values.map((c) => c.keys),
    );

    const into = newTally();
    for (const [index, testCase] of values.entries()) {
      const result = results[index];
      if (result === undefined) {
        into.mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (result.error !== null) {
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} → error ${result.error}`,
        );
        continue;
      }
      if (testCase.expect.im !== 0) {
        // 型に im があるのに比較していない、では「虚部も確かめた」と読まれる。
        // このシャードは実数しか扱わない。虚部があるケースが混ざったら、
        // 黙って実部だけ見ずに落とす(レビュー修正ラウンド 2)。
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} expects a non-zero imaginary part ` +
            `(${testCase.expect.im}), which this stage does not compare`,
        );
        continue;
      }
      let actual: number;
      try {
        actual = parseDisplay(result.main);
      } catch (cause) {
        // parseDisplay が投げる条件は「電卓が実数以外を表示するようになった」
        // ——**まさにこの層が捕まえるべき回帰**である。生の例外でスイートが
        // 落ちると 20 件上限の読める報告もレポートも失われる(修正ラウンド 2)。
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${JSON.stringify(result.main)} ` +
            `cannot be read as a number (${String(cause)})`,
        );
        continue;
      }
      const expected = testCase.expect.re;
      into.magnitudes.push(Math.abs(expected));
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${testCase.expr} → ${result.main}, expected ${expected}`,
        classify(actual, expected, shard.tolerance),
      );
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    record({
      name: `${name} (values)`,
      total: values.length,
      values: values.length,
      equivalences: 0,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      absOnlyCases: into.absOnlyCases,
      relUndefinedCases: into.relUndefinedCases,
      looserThanDisplay: into.looserThanDisplay,
      worstEffectiveRelTolerance: into.worstEffectiveRelTolerance,
      bands: into.bands,
      shape: summarizeShape(values.map((c) => c.keys)),
      magnitudes: quantiles(into.magnitudes),
      tolerance: shard.tolerance,
    });

    // 先頭 20 件だけ読ませる。端末で読める量に上限を置き、全件は
    // Task 8 のレポートが持つ(設計書 §8)。
    expect(
      into.mismatches.slice(0, 20).join("\n"),
      `${into.mismatches.length} of ${values.length} cases disagree`,
    ).toBe("");
  });
}

for (const { name, shard } of shards) {
  const equivalences = shard.cases.filter(
    (c): c is EquivalenceCase => c.kind === "equivalence",
  );
  if (equivalences.length === 0) {
    continue;
  }
  test(`both routes agree in ${name}`, async ({ page }) => {
    assertSupportedMode(name, equivalences);
    await openHarness(page);
    noteRuntime(await coreVersion(page), browserLabel(page));
    // 左右をまとめて 1 往復で流す。前半が左、後半が右。
    const results = await runAll(page, [
      ...equivalences.map((c) => c.left),
      ...equivalences.map((c) => c.right),
    ]);

    const into = newTally();
    for (const [index, testCase] of equivalences.entries()) {
      const left = results[index];
      const right = results[index + equivalences.length];
      if (left === undefined || right === undefined) {
        into.mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (left.error !== null || right.error !== null) {
        into.mismatches.push(
          `${testCase.id}: error ${left.error ?? "none"} / ${right.error ?? "none"}`,
        );
        continue;
      }
      let actual: number;
      let expected: number;
      try {
        // 理由は値ケース側の注記と同じ。生の例外で全体を落とさない。
        actual = parseDisplay(left.main);
        expected = parseDisplay(right.main);
      } catch (cause) {
        into.mismatches.push(
          `${testCase.id}: ${JSON.stringify(left.main)} vs ` +
            `${JSON.stringify(right.main)} cannot be read as numbers ` +
            `(${String(cause)})`,
        );
        continue;
      }
      into.magnitudes.push(Math.abs(expected));
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${left.main} vs ${right.main}`,
        classify(actual, expected, shard.tolerance),
      );
    }

    // **expect より先に記録する。** 理由は値ケース側と同じ。
    record({
      name: `${name} (equivalences)`,
      total: equivalences.length,
      values: 0,
      equivalences: equivalences.length,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      absOnlyCases: into.absOnlyCases,
      relUndefinedCases: into.relUndefinedCases,
      looserThanDisplay: into.looserThanDisplay,
      worstEffectiveRelTolerance: into.worstEffectiveRelTolerance,
      bands: into.bands,
      shape: summarizeShape([
        ...equivalences.map((c) => c.left),
        ...equivalences.map((c) => c.right),
      ]),
      magnitudes: quantiles(into.magnitudes),
      tolerance: shard.tolerance,
    });

    expect(
      into.mismatches.slice(0, 20).join("\n"),
      `${into.mismatches.length} of ${equivalences.length} pairs disagree`,
    ).toBe("");
  });
}

test.afterAll(() => {
  writeReport();
});
