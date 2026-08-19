import { expect, type Page, test } from "@playwright/test";

const select = (page: Page) =>
  page.getByRole("combobox", { name: "計算の種類" });

test("every category has a deep link that lands on it", async ({ page }) => {
  const seen: string[] = [];
  for (const [category, name] of [
    ["data-scale", "データ量"],
    ["llm", "LLM のメモリ"],
    ["transfer", "データ転送"],
  ] as const) {
    await page.goto(`/#scale/${category}`);
    await expect(select(page)).toHaveValue(category);
    seen.push(name);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(3);
});

test("choosing a category moves the hash and the panel", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  await select(page).selectOption("transfer");
  await expect(page).toHaveURL(/#scale\/transfer$/);
  await expect(select(page)).toHaveValue("transfer");
  // 戻れる。
  await page.goBack();
  await expect(page).toHaveURL(/#scale\/data-scale$/);
});

test("the category select is large enough to touch", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  const box = await select(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
