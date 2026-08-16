import { expect, test } from "@playwright/test";

test("the footer shows on every tab, once", async ({ page }) => {
  // **全タブに出す**のが要件である(0.2.0 設計書 §5)。以前は Scientific
  // だけに calcarc-core の版数が出ていた。
  for (const hash of ["#scientific", "#data-scale", "#finance"]) {
    await page.goto(`/${hash}`);
    const link = page.getByRole("link", { name: /^CalcArc .+ @terapyon$/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/terapyon/CalcArc",
    );
    await expect(page.getByTestId("footer-disclaimer")).toHaveText(
      "・計算結果は無保証です。重要な判断の根拠にしないでください。",
    );
  }
});

test("the old core version line is gone", async ({ page }) => {
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(page.getByTestId("core-version")).toHaveCount(0);
});

test("the footer stays on one line and never overflows sideways", async ({
  page,
}) => {
  // **文言を縮めずフォントを落として 1 行に収めている**(ユーザー裁定)。
  // nowrap なので、入らなくなったら折り返さずに横へはみ出す——縦の予算も
  // 横のスクロールも同時に壊れる。両方をここで止める。
  //
  // **`getByRole("contentinfo")` ではなく `footer-disclaimer` を測る。**
  // <footer> はリンクと免責の 2 要素を子に持つので、同じ行に並んでいても
  // `Range.getClientRects()` は要素境界ごとに rect を割るため、1 行でも
  // 常に複数になる(実測: 常に 6)。折り返しを見たいのは免責の文言そのもの
  // なので、そちらを測る。
  await page.goto("/");
  const lines = await page.getByTestId("footer-disclaimer").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
  expect(lines, `the footer wrapped onto ${lines} lines`).toBe(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(
    overflow,
    `the page scrolls sideways by ${overflow}px`,
  ).toBeLessThanOrEqual(0);
});
