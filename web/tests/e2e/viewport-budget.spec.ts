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

test("the tallest tab keeps room between the keypad and the footer", async ({
  page,
}) => {
  // **「余裕を持って」の実体。** いちばん背の高い Finance で、盤面の下端と
  // フッタの上端が詰まっていないこと。
  //
  // **この区間は空ではない。** 間に Finance の画面内免責(「実際の返済額は
  // 金融機関の計算方法により異なります。」)とパネルの余白が入っており、
  // 実測 67px のうち何もないのは 20〜27px ほどである。それでも測る意味は
  // ある——盤面が伸びればこの区間から削られるので、詰まったことに気づける。
  // **「まだ 67px 足せる」とは読まないこと。**
  await page.goto("/#finance");
  const pad = await page
    .getByRole("group", { name: "数字と演算のキー" })
    .boundingBox();
  const footer = await page.getByTestId("footer-disclaimer").boundingBox();
  const room = (footer?.y ?? 0) - ((pad?.y ?? 0) + (pad?.height ?? 0));
  expect(
    room,
    `only ${room}px between the keypad and the footer`,
  ).toBeGreaterThanOrEqual(8);
});
