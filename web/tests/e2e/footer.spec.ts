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
      "計算結果は無保証です。重要な判断の根拠にしないでください。",
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

test("the footer survives a narrower phone", async ({ page }) => {
  // **8px は 390px に載る最大**として決めた値である。360px(多くの Android)や
  // 320px でも、折り返さず・横にも溢れないこと。
  //
  // **`getByRole("contentinfo")` ではなく `footer-disclaimer` を測る**——上の
  // 「stays on one line」と同じ理由。<footer> はリンクと区切りと免責の複数
  // 要素を子に持つので、1 行に並んでいても `Range.getClientRects()` は要素
  // 境界ごとに rect を割り、常に複数になる(実測: 8)。
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("display-main")).toBeVisible();

    const lines = await page.getByTestId("footer-disclaimer").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
    expect(lines, `the footer wrapped at ${width}px`).toBe(1);

    // **フッタ自身の右端で測る**(`document.documentElement.scrollWidth` では
    // ない)。盤面(Keypad の関数列)は 360px 未満で独自に横へ溢れることが
    // 実測でわかっており——このブランチの変更とは無関係の既存の挙動——
    // ページ全体の scrollWidth で測るとその不具合を巻き込み、フッタ自体は
    // 直っていても赤くなる。ここで確かめたいのは「フッタが溢れないか」
    // であって「ページのどこも溢れないか」ではない。
    const overflow = await page.evaluate(() => {
      const footer = document.querySelector("footer");
      if (!footer) return Number.NaN;
      return Math.ceil(
        footer.getBoundingClientRect().right - window.innerWidth,
      );
    });
    expect(
      overflow,
      `the footer itself scrolls sideways by ${overflow}px at ${width}px`,
    ).toBeLessThanOrEqual(0);
  }
});
