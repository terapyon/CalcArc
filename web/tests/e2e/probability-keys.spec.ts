import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const shift = (page: Page) =>
  page.getByRole("button", { name: "第2面に切り替え" });

const key = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

test("the factorial key is reachable behind the digit 7", async ({ page }) => {
  // **数字キーの第 2 面はこのリポジトリで初めて**(設計書 §7 の裁定 2)。
  await key(page, "5").click();
  await shift(page).click();
  await key(page, "階乗").click();
  await expect(page.getByTestId("display-main")).toHaveText("120");
  // ワンショット: 面は戻り、7 は数字に戻っている。
  await expect(key(page, "7")).toBeEnabled();
});

test("nPr and nCr compute through the browser", async ({ page }) => {
  await key(page, "5").click();
  await shift(page).click();
  await key(page, "組合せ").click();
  await key(page, "2").click();
  await key(page, "計算する").click();
  await expect(page.getByTestId("display-main")).toHaveText("10");
});

test("combinations bind tighter than multiplication, in the browser", async ({
  page,
}) => {
  // 5 × (4 nCr 2) = 30（裁定 1）。左から順なら 190 になる。
  await key(page, "5").click();
  await key(page, "掛ける").click();
  await key(page, "4").click();
  await shift(page).click();
  await key(page, "組合せ").click();
  await key(page, "2").click();
  await key(page, "計算する").click();
  await expect(page.getByTestId("display-main")).toHaveText("30");
});

test("the shifted digits look different, not just read differently", async ({
  page,
}) => {
  // **裁定 2 の発見性そのもの。** 数字キーの上で面が変わったことが色で
  // 分かるか。jsdom はアクセシビリティツリーも計算スタイルも持たない
  // ので、ここは実ブラウザでしか確かめられない(CLAUDE.md)。
  const background = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const asDigit = await key(page, "7").evaluate(background);

  await shift(page).click();
  const factorial = key(page, "階乗");
  await expect(factorial).toBeEnabled();
  const asFunction = await factorial.evaluate(background);

  // 同じ位置のキーが、面によって違う色で描かれている。
  expect(asFunction).not.toBe(asDigit);

  // **裏を持たない数字は変わらない**——変わったのが 7/8/9 だけであることを
  // 押さえないと、「全部の色が変わった」でもこの検査は通ってしまう。
  const four = await key(page, "4").evaluate(background);
  expect(four).toBe(asDigit);
});

test("the counting keys keep their 44px touch targets", async ({ page }) => {
  // メイングリッドの寸法は 3 タブで揃えてある。第 2 面でも崩れない。
  await shift(page).click();
  for (const name of ["階乗", "順列", "組合せ"]) {
    const box = await key(page, name).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
