import { expect, test } from "@playwright/test";
import { openHarness, runAll } from "./harness";

// 表示書式を知るための探り。合否は判定せず、観測結果を出力する。
const PROBES: [string, string[]][] = [
  ["整数", ["3", "eq"]],
  ["2 の平方根", ["2", "sqrt"]],
  ["1 ÷ 3", ["1", "div", "3", "eq"]],
  ["円周率", ["pi"]],
  ["負の数", ["5", "neg"]],
  ["大きい数", ["9", "zeros3", "zeros3", "mul", "9", "zeros3", "zeros3", "eq"]],
  ["小さい数", ["1", "div", "9", "zeros3", "zeros3", "eq"]],
  ["sin 30 度", ["3", "0", "sin"]],
  ["負数の平方根", ["4", "neg", "sqrt"]],
];

test("record how the display formats numbers (observation only, no pass/fail on values)", async ({
  page,
}) => {
  await openHarness(page);
  const results = await runAll(
    page,
    PROBES.map(([, keys]) => keys),
  );
  // 観測そのものが嘘をつかないための最低限の保証: ハーネスが 9 件を返したこと。
  // これ以外は一切合否を判定しない。
  expect(results).toHaveLength(PROBES.length);
  for (const [index, probe] of PROBES.entries()) {
    console.log(`${probe[0]}: ${JSON.stringify(results[index])}`);
  }
});
