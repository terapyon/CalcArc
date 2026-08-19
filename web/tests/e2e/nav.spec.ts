import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("every module tab fits on one line", async ({ page }) => {
  // **iPhone で "Data Scale" が 2 段になっていた。** 行数は Range の
  // クライアント矩形で数える——1 行なら矩形は 1 つである。高さの比較だと
  // 3 つとも折り返した場合に「揃っている」で通ってしまう。
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
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
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
    const box = await page
      .getByRole("link", { name, exact: true })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("every module tab still fits on one line at 360px", async ({ page }) => {
  // **4 タブにして 1 枚が 107px から 78px になった**(設計書 §4)。
  // 既定の viewport は 390px なので、いちばん狭い対応幅を名指しで測る。
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
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

test("the tabs keep a 44px touch target at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  for (const name of ["Scientific", "Convert", "Scale", "Finance"]) {
    const box = await page
      .getByRole("link", { name, exact: true })
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the nav does not push the page sideways at 360px", async ({ page }) => {
  // **折り返さない以上、入らなければ横にはみ出す**(Nav.module.css の
  // white-space: nowrap)。0.2.1 の 360px と同じ壊れ方をここで止める。
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `the page overflows sideways by ${overflow}px`).toBe(0);
});
