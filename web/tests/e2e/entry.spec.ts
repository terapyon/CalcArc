import { expect, type Page, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("Exp types an exponent and the sign key follows it", async ({ page }) => {
  await press(page, ["1", "小数点", "5", "指数入力", "3"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e3");
  await press(page, ["符号を反転"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e-3");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.0015");
});

test("the sign key still negates a committed value", async ({ page }) => {
  // 指数入力中でなければ従来どおり(設計書 §2 の 2 階層)。
  await press(page, ["4", "符号を反転"]);
  await expect(page.getByTestId("display-main")).toHaveText("-4");
});

test("the triple zero key is live now", async ({ page }) => {
  await press(page, ["1", "3桁のゼロ"]);
  await expect(page.getByTestId("display-main")).toHaveText("1000");
});

test("j after digits turns the entry imaginary", async ({ page }) => {
  await press(page, ["3", "虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("3j");
  await press(page, ["虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("3");
});

test("the echo line shows the pending expression", async ({ page }) => {
  await press(page, ["3", "足す", "4", "掛ける"]);
  await expect(page.getByTestId("display-echo")).toHaveText("3 + 4 ×");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});
