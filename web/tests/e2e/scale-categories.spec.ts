import { expect, type Page, test } from "@playwright/test";

const select = (page: Page) =>
  page.getByRole("combobox", { name: "計算の種類" });

test("every category has a deep link that lands on it", async ({ page }) => {
  const seen: string[] = [];
  for (const [category, region] of [
    ["data-scale", "データスケール計算"],
    ["llm", "LLM のメモリ計算"],
    ["transfer", "データ転送量計算"],
  ] as const) {
    await page.goto(`/#scale/${category}`);
    await expect(select(page)).toHaveValue(category);
    // **select の値だけでなく、出るべき面まで見る。** 名前だけの select が
    // 動いていても、パネルの分岐は 1 度も観測されない、という穴を防ぐ。
    await expect(page.getByRole("region", { name: region })).toBeVisible();
    seen.push(category);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(3);
});

test("choosing a category moves the hash and the panel", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  await expect(
    page.getByRole("region", { name: "データスケール計算" }),
  ).toBeVisible();
  await select(page).selectOption("transfer");
  await expect(page).toHaveURL(/#scale\/transfer$/);
  await expect(select(page)).toHaveValue("transfer");
  await expect(
    page.getByRole("region", { name: "データ転送量計算" }),
  ).toBeVisible();
  // **前の面は消えている。** 重なって出ていないことまで見ないと、
  // 「増えただけ」を「切り替わった」と読み違える。
  await expect(
    page.getByRole("region", { name: "データスケール計算" }),
  ).toHaveCount(0);
  // 戻れる。
  await page.goBack();
  await expect(page).toHaveURL(/#scale\/data-scale$/);
  await expect(
    page.getByRole("region", { name: "データスケール計算" }),
  ).toBeVisible();
});

test("the category select is large enough to touch", async ({ page }) => {
  await page.goto("/#scale/data-scale");
  const box = await select(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
