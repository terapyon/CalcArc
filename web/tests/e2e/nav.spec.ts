import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("every module tab fits on one line", async ({ page }) => {
  // **iPhone で "Data Scale" が 2 段になっていた。** 行数は Range の
  // クライアント矩形で数える——1 行なら矩形は 1 つである。高さの比較だと
  // 3 つとも折り返した場合に「揃っている」で通ってしまう。
  for (const name of ["Scientific", "Data Scale", "Finance"]) {
    const lines = await page
      .getByRole("link", { name, exact: true })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      });
    expect(lines, `${name} wrapped onto ${lines} lines`).toBe(1);
  }
});

test("the tabs keep a 44px touch target", async ({ page }) => {
  // 文字を縮めた代わりに標的まで縮まっていないこと(base-spec §43)。
  for (const name of ["Scientific", "Data Scale", "Finance"]) {
    const box = await page
      .getByRole("link", { name, exact: true })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
