import { expect, test } from "@playwright/test";
import {
  assertSupportedMode,
  type DisplayCase,
  type DisplayEquivalenceCase,
  loadDisplayShards,
  summarizeShape,
} from "./corpus";
import { type HarnessResult, openHarness, runAll } from "./harness";
import { record, summaryName } from "./report";

/**
 * 表示のトグル（`eng` と `dms`）の照合（設計書 2026-08-17-display）。
 *
 * **ここだけは値ではなく表示文字列そのものを比べる。** 工学表記も 60 進も
 * 値を変えないので、値を見る限りトグルを押しても押さなくても同じ答えになる
 * ——押した効果を主張できるのは表示だけである。
 *
 * 期待値は Python 側の 2 つの参照実装から来る。`sexagesimal_ref` は
 * f64 のビットから `Fraction` を組んで 60 進に直し、`eng_ref` は
 * `Decimal(x)` の厳密な十進値から指数を直接求める。どちらも
 * **Rust の「一度 `{:.9e}` で整形してから読み直す」手順を写していない。**
 *
 * 比較は**厳密一致**である。1 文字違えば違う。`parseDisplay` は使わない
 * ——あれは表示を数値に戻す関数で、通せば桁区切りや指数の書き方の違いが
 * 消えてしまい、この段階が確かめたいことがちょうど失われる。
 */

/** 1 束あたりのケース数。往復のコストが計算のコストを覆わない大きさにする。 */
const BATCH = 500;

function isDisplayCase(
  c: DisplayCase | DisplayEquivalenceCase,
): c is DisplayCase {
  return c.kind === "display";
}

/**
 * 期待値として持っているエラー種別ごとの件数。**同値ケースは持たない。**
 *
 * 種別を落とすと、報告書のエラー経路の枠が「エラーが N 件」としか言えなく
 * なる——`main` は全種別で同じ `"Math ERROR"` なので、そこから種別を
 * 取り戻す方法は無い。
 */
function countErrorKinds(
  cases: (DisplayCase | DisplayEquivalenceCase)[],
): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const testCase of cases) {
    if (!isDisplayCase(testCase)) {
      continue;
    }
    const error = testCase.expect.error;
    if (error !== undefined) {
      kinds[error] = (kinds[error] ?? 0) + 1;
    }
  }
  return kinds;
}

/**
 * 結果を 1 件取り出す。**添字が範囲外なら落とす。**
 *
 * `results[cursor++]` をそのまま読むと、束の組み立てと読み戻しがずれたとき
 * `undefined` が「エラーでもなく、期待と違う文字列でもないもの」として
 * 静かに比較を通り抜ける。ずれは不合格ではなく**組み立ての欠陥**なので、
 * その場で落ちる方がよい。
 */
function at(results: HarnessResult[], index: number): HarnessResult {
  const got = results[index];
  if (got === undefined) {
    throw new Error(
      `display: harness result ${index} is missing — the sequences built and ` +
        "the results read back have drifted out of step",
    );
  }
  return got;
}

for (const { name, shard } of loadDisplayShards()) {
  test(`every display in ${name} matches the reference`, async ({ page }) => {
    await openHarness(page);
    const cases = shard.cases;
    const mismatches: string[] = [];

    // **キー列は 1 度に組む。** 表示ケースは 1 本、同値ケースは 2 本を
    // 流し、結果を同じ順で読み戻す。ケースごとに往復すると 2000 往復になる。
    // 宣言した角度モードとキー列が一致しているか。表示のシャードは `Deg`
    // だけだが、番人を外すと「そのうち `Rad` を混ぜたときに黙って `Deg` で
    // 比べる」経路が開く。
    assertSupportedMode(name, cases);

    const sequences: string[][] = [];
    for (const testCase of cases) {
      if (isDisplayCase(testCase)) {
        sequences.push(testCase.keys);
      } else {
        sequences.push(testCase.left, testCase.right);
      }
    }

    const results: HarnessResult[] = [];
    for (let start = 0; start < sequences.length; start += BATCH) {
      results.push(
        ...(await runAll(page, sequences.slice(start, start + BATCH))),
      );
    }
    expect(
      results.length,
      "the harness returned a different number of results than sequences sent",
    ).toBe(sequences.length);

    let cursor = 0;
    let displayCases = 0;
    let equivalenceCases = 0;
    for (const testCase of cases) {
      if (isDisplayCase(testCase)) {
        const got = at(results, cursor++);
        displayCases += 1;
        const expectedError = testCase.expect.error;
        if (expectedError !== undefined) {
          // **主張の中身は種別のほうである(設計書 §5)。** `ERROR_TEXT` は
          // 全種別で "Math ERROR" と同じ文字列なので、種別まで見ないと
          // 5 種類すべてが入れ替わっても `main` の比較だけでは緑になる。
          if (got.error !== expectedError) {
            mismatches.push(
              `${testCase.id} (${testCase.expr}): engine reported the ` +
                `error ${JSON.stringify(got.error)}, but the reference ` +
                `expected ${JSON.stringify(expectedError)}`,
            );
          } else if (got.main !== testCase.expect.main) {
            mismatches.push(
              `${testCase.id} (${testCase.expr}): engine showed ` +
                `${JSON.stringify(got.main)}, reference expected ` +
                `${JSON.stringify(testCase.expect.main)} (error kind matched)`,
            );
          }
        } else if (got.error !== null) {
          // **省略は「エラーにならない」という主張。** アンダーフローの
          // ようなケースが、エラーになった時点で不一致になる。
          mismatches.push(
            `${testCase.id} (${testCase.expr}): engine reported the error ` +
              `${JSON.stringify(got.error)}, but the reference produced the ` +
              `display ${JSON.stringify(testCase.expect.main)}`,
          );
        } else if (got.main !== testCase.expect.main) {
          mismatches.push(
            `${testCase.id} (${testCase.expr}): engine showed ` +
              `${JSON.stringify(got.main)}, reference expected ` +
              `${JSON.stringify(testCase.expect.main)}`,
          );
        }
      } else {
        const left = at(results, cursor++);
        const right = at(results, cursor++);
        equivalenceCases += 1;
        if (left.error !== null || right.error !== null) {
          mismatches.push(
            `${testCase.id} (${testCase.expr}): one side errored — ` +
              `left ${JSON.stringify(left.error)}, right ${JSON.stringify(right.error)}`,
          );
        } else if (left.main !== right.main) {
          mismatches.push(
            `${testCase.id} (${testCase.expr}): pressing the toggle changed ` +
              `the display from ${JSON.stringify(left.main)} to ` +
              `${JSON.stringify(right.main)}, but the reference says this value ` +
              "cannot be shown in that notation, so the display should not move",
          );
        }
      }
    }
    expect(
      cursor,
      "not every harness result was read back — some case's results were skipped",
    ).toBe(results.length);

    // **expect より先に記録する。** 落ちたときこそ報告書が要る。
    record({
      name: summaryName(name, "displays"),
      total: cases.length,
      values: displayCases,
      equivalences: equivalenceCases,
      generatedBy: shard.generated_by,
      mismatches,
      // **文字列の厳密一致なので誤差という概念が無い。** 0 は「測っていない」
      // ではなく「ずれが存在しない」である(関数呼び出しのシャードと同じ)。
      maxRelativeError: 0,
      maxAbsoluteError: 0,
      appliedOverrides: [],
      relUndefinedCases: [],
      relMeasured: 0,
      relUndefinedNonZeroAbs: 0,
      looserThanDisplay: 0,
      precedenceCases: 0,
      // **指数表記を実際に読んだ件数。** 工学表記は必ず `e` を伴うので、
      // ここは「表示の指数側を踏んだ」ことの直接の証拠になる。
      exponentDisplayCases: cases.filter(
        (c) => isDisplayCase(c) && c.expect.main.includes("e"),
      ).length,
      // **主張したエラー種別ごとの件数。** 実際に観測した件数ではなく、
      // このシャードが期待値として持っている件数である。**種別を落とさない**
      // ——`main` は全種別で同じ `"Math ERROR"` なので、種別を畳んだ集計は
      // 種別の取り違えについて何も言えない。
      errorKinds: countErrorKinds(cases),
      worstEffectiveRelTolerance: 0,
      bands: {
        display: cases.length,
        "1e-9": 0,
        "1e-7": 0,
        "1e-5": 0,
        worse: 0,
        undefined: 0,
      },
      // **キーの集計は本物を入れる。** ここを空の `{}` で埋めると、
      // レポートの「使っていないキートークン」が `eng` と `dms` を
      // **押していないものとして数え続ける**——2000 件押した走行で、である。
      // 空の集計は「押していない」と区別が付かない。
      shape: summarizeShape(sequences),
      magnitudes: { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0 },
      tolerance: { abs: 0, rel: 0 },
    });

    expect(
      mismatches,
      `${name}: ${mismatches.length} of ${cases.length} displays disagreed ` +
        "with the reference implementation. These are exact string " +
        "comparisons — a difference is a difference, not a rounding artefact.",
    ).toEqual([]);
  });
}
