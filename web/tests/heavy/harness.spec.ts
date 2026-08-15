import { expect, test } from "@playwright/test";
import { openHarness, runAll } from "./harness";

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

test("each sequence starts from a clean state", async ({ page }) => {
  await openHarness(page);
  const results = await runAll(page, [
    ["5", "add", "5", "eq"],
    ["7", "eq"],
  ]);

  // 2 本目が 1 本目の残りを引きずっていないこと。
  expect(results[1]?.main).toBe("7");
});
