import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("toggles 1000 to 1e3 and back", async ({ page }) => {
  // ユーザーの言葉そのもの: 「1000 → 1e3、1e3 → 1000 に戻すというトグル」。
  //
  // **入力中の表示は format_real を通らない**(設計書 §3.2)。1000 と打った
  // だけでは ENG もカンマも効かないので、まず = を押して確定させる。
  await press(page, ["1", "0", "0", "0", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("1,000");

  await press(page, ["工学表記に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("1e3");

  // もう一度押すと戻る(設計書 §1 の裁定 1)。
  await press(page, ["工学表記に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("1,000");
});

test("keeps engineering notation for the next answer", async ({ page }) => {
  // モードとして残る(裁定 1)——一度押したら、以後の計算結果も ENG で出る。
  await press(page, ["工学表記に切り替え"]);
  await press(page, ["1", "2", "3", "4", "5", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("12.345e3");
});

test("shows the thousands separators by default", async ({ page }) => {
  // カンマは既定。ENG を押していない状態で 1,234,567 と出る。
  await press(page, ["1", "2", "3", "4", "5", "6", "7", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("1,234,567");
});
