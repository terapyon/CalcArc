import { expect, test } from "./fixtures";
import { LANDSCAPE_VIEWPORTS, SAFARI_VIEWPORTS } from "./widths";

/**
 * **押している最中、答えが画面の中に在る。**
 *
 * 低い画面ではスクロールして押すことになり、そのとき表示欄が上へ流れていく
 * ——**電卓としては、押せても答えが見えなければ意味がない。**
 *
 * **`short-screens.spec.ts` とは別の観点である。** あちらが見るのは「キーに
 * 届くか」「その上に何も重なっていないか」の 3 つで、**表示欄がどこに在るかは
 * 1 度も見ていない**——だから**あちらが緑のまま、ここだけが赤くなりうる**。
 * **掴み手は `data-testid`**（`Readout.tsx:84` の `display-main`）。
 */
for (const size of [...SAFARI_VIEWPORTS, ...LANDSCAPE_VIEWPORTS]) {
  test(`the answer stays on screen while reaching the last key at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    const last = page.locator("main button").last();
    await last.scrollIntoViewIfNeeded();
    const box = await page.getByTestId("display-main").boundingBox();
    expect(box, "表示欄が見つからない").not.toBeNull();
    // **上端が画面の中に在り、下端も画面の中に在る**（部分的に見えるだけでは足りない）。
    expect(box?.y, "表示欄の上端").toBeGreaterThanOrEqual(0);
    expect(
      (box?.y ?? 0) + (box?.height ?? 0),
      "表示欄の下端",
    ).toBeLessThanOrEqual(size.height);
  });
}
