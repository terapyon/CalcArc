import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const shift = (page: Page) =>
  page.getByRole("button", { name: "第2面に切り替え" });

const key = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

test("the factorial key is reachable behind the opening paren", async ({
  page,
}) => {
  // **数字の裏ではなく括弧の裏**(0.2.0 設計書 §9)。Shift 中も数字は打てる。
  await key(page, "5").click();
  await shift(page).click();
  await key(page, "階乗").click();
  await expect(page.getByTestId("display-main")).toHaveText("120");
  // ワンショット: 面は戻り、( は括弧に戻っている。
  await expect(key(page, "開き括弧")).toBeEnabled();
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

test("the digits stay reachable while the second face is up", async ({
  page,
}) => {
  // **移した理由そのもの。** 以前は Shift 中に 7/8/9 が数え上げの関数に
  // 化けて、数字が打てなかった。jsdom はアクセシビリティツリーを組まない
  // ので、ここは実ブラウザでしか確かめられない(CLAUDE.md)。
  await shift(page).click();
  for (const digit of ["7", "8", "9"]) {
    await expect(key(page, digit)).toBeEnabled();
  }
  // 面はまだ立っている——数字を確かめただけでは降りない。
  await expect(key(page, "階乗")).toBeEnabled();
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
