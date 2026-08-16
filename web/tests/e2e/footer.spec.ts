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

    // **フッタ自身の必要幅とビューポート幅を比べる。** `<footer>` は
    // `margin: 0 auto` を持つ flex item で、`align-items: stretch` による
    // 伸長を受けない——中身(nowrap のテキスト)がそのまま自分の箱の幅を
    // 決める「shrink-to-fit」の箱である。だから中身がどれだけ長くても
    // **箱の中で内部的にはみ出すことがなく**、`scrollWidth − clientWidth`
    // は常に 0 になる(実測: CSS を戻しても 0 のまま。空振り)。
    // `getBoundingClientRect().right − innerWidth` も使えない——盤面
    // (Keypad の関数列)が独自に画面より広がっていると、`margin: auto`
    // の中央寄せが祖先の広がった幅を基準に計算され、フッタの左端が
    // 動いてしまう(実測: 360px で `right` が innerWidth より小さくなり、
    // 溢れているのに検知できない)。
    //
    // 効くのは **`scrollWidth` を `window.innerWidth` と直接比べる**こと。
    // `scrollWidth` はフッタが実際に必要とする幅そのもの(内部の折り返し
    // 有無に関係なく、shrink-to-fit の箱では `clientWidth` と一致する)
    // なので、それがビューポート幅を超えていれば、フッタの中身がその
    // ビューポートに収まりきらないと直接言える。祖先の広がり(Keypad の
    // 既存バグ)にも、中央寄せの副作用にも左右されない。
    // vw の頭打ちを外して赤確認済み(320px で +33px、360px は収まる幅
    // だったため赤くならない——閾値の狙いどおり)。
    const spill = await page.getByRole("contentinfo").evaluate((el) => {
      return el.scrollWidth - window.innerWidth;
    });
    expect(
      spill,
      `the footer spills ${spill}px at ${width}px`,
    ).toBeLessThanOrEqual(0);
  }
});
