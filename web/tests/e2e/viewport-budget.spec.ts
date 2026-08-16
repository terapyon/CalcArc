import { expect, test } from "@playwright/test";

// **0.2.0 で縦に足したものが 1 画面に収まり、かつタブで揺れないこと。**
// 盤面の高さはタブごとに違う(Finance がいちばん高い)ので、何もしないと
// ページ全体の高さもフッタの位置もタブで変わる。

const TABS = [
  ["#scientific", "Scientific"],
  ["#data-scale", "Data Scale"],
  ["#finance", "Finance"],
] as const;

for (const [hash, name] of TABS) {
  test(`${name} fits in one screen at 390x844`, async ({ page }) => {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId("footer-disclaimer")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow, `${name} overflows by ${overflow}px`).toBeLessThanOrEqual(
      0,
    );
  });
}

test("the footer sits at the same place on every tab", async ({ page }) => {
  // **これが「揺らがない」の本体。** 盤面の高さがタブで違っても、
  // フッタの位置は動かない。
  const seen: { name: string; y: number }[] = [];
  for (const [hash, name] of TABS) {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId("footer-disclaimer")).toBeVisible();
    const box = await page.getByTestId("footer-disclaimer").boundingBox();
    seen.push({ name, y: box?.y ?? -1 });
  }
  const ys = seen.map((s) => s.y);
  expect(
    new Set(ys).size,
    `footer moved between tabs: ${JSON.stringify(seen)}`,
  ).toBe(1);
});

test("the tallest tab still has slack inside the screen", async ({ page }) => {
  // **「余裕を持って」の実体。** 測るのは `<main>` の高さとパネルの高さの差
  // ——これが**本当に何も置かれていない縦**である。
  //
  // 当初は「盤面の下端とフッタの上端の距離」を測っていたが、あれは違う
  // ものを測っていた。100dvh のシェルでは、盤面が伸びた分はその区間では
  // なく**画面の外**へ出る。実際、広げた行を 4 倍・8 倍にしても距離は
  // 67px から動かなかった(実測)。あの検査が捕まえていたのは、あいだに
  // 挟まる画面内免責やパネル余白が縮んだ場合だけだった。
  await page.goto("/#finance");
  await expect(page.getByTestId("footer-disclaimer")).toBeVisible();

  const slack = await page.evaluate(() => {
    const main = document.querySelector("main");
    const panel = main?.firstElementChild;
    if (!main || !panel) return -1;
    return (
      main.getBoundingClientRect().height - panel.getBoundingClientRect().height
    );
  });

  expect(
    slack,
    `only ${slack}px of slack left on Finance`,
  ).toBeGreaterThanOrEqual(8);
});
