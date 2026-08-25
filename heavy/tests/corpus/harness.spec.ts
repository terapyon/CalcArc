import { expect, test } from "@playwright/test";
import { coreVersion, openHarness, runAll } from "./harness";

test("the harness runs key sequences without touching the DOM", async ({
  page,
}) => {
  await openHarness(page);
  const results = await runAll(page, [
    ["1", "add", "2", "eq"],
    ["9", "div", "0", "eq"],
  ]);

  expect(results).toHaveLength(2);
  expect(results[0]?.error).toBeNull();
  expect(results[0]?.main).toBe("3");
  // エラーは戻り値の一部であって例外ではない(CLAUDE.md の WASM 境界の規約)。
  expect(results[1]?.error).toBe("DivisionByZero");
});

test("a misspelled key token is refused instead of silently skipped", async ({
  page,
}) => {
  await openHarness(page);
  // calcarc-wasm の reduce は未知のトークンを状態を変えずに返す。黙って
  // 読み飛ばすと `1 + 2 =` のつもりの列が `1 2 =` として計算され、不一致は
  // 電卓のせいに見える。設計書 §7.2 の投稿 JSON がまさにこの入口である。
  await expect(
    runAll(page, [
      ["1", "add", "2", "eq"],
      ["1", "plus", "2", "eq"],
    ]),
  ).rejects.toThrow(/plus/);
});

test("a valid sequence is not refused by the key check", async ({ page }) => {
  await openHarness(page);
  // 検査が厳しすぎて正しいトークンまで弾いていないこと。
  const results = await runAll(page, [
    ["3", "0", "sin", "sqr", "add", "1", "sub", "2", "mul", "3", "div", "4"],
  ]);
  expect(results).toHaveLength(1);
});

test("the core version is readable for the report", async ({ page }) => {
  await openHarness(page);
  // 外の人が判断するには、何をいつ何で回したかが要る。
  expect(await coreVersion(page)).not.toBe("");
});

test("each sequence starts from a clean state", async ({ page }) => {
  await openHarness(page);
  const results = await runAll(page, [
    ["5", "add", "5", "eq"],
    ["7", "eq"],
  ]);

  // 2 本目が 1 本目の残りを引きずっていないこと。
  expect(results[1]?.main).toBe("7");
});
