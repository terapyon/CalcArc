import { expect, type Page, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

// exact: true が要る(scientific-functions.spec.ts に倣う)。
const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

/**
 * 0.9.2 設計書 §3(外部監査 F5、利用者の裁定「ボタンが押せない」)。
 * engine が拒むキーは盤面でも押せず、キーボードからも入らない。
 */
test("a key that would drop the number on screen cannot be pressed", async ({
  page,
}) => {
  await press(page, ["2"]);
  await expect(
    page.getByRole("button", { name: "開き括弧", exact: true }),
  ).toBeDisabled();
  // キーボードからも入らない(engine が拒む)。
  await page.keyboard.press("(");
  await expect(page.getByTestId("display-main")).toHaveText("2");
  await expect(page.getByTestId("display-echo")).toHaveText("");
});

/**
 * 0.9.2 設計書 §2(外部監査 F1): `2 + 3 + × 4 =` は 14。演算子の訂正
 * (2 個目の演算子が 1 個目を置き換える)が実物のブラウザ・実 WASM でも
 * 効くこと、そして記録される式が訂正後の演算子だけを持つこと(§9-9)を
 * 1 本で見る。
 */
test("a corrected operator means the right one, through the browser", async ({
  page,
}) => {
  await press(page, ["2", "足す", "3", "足す", "掛ける", "4", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("14");

  // 履歴の式も最後の演算子だけ(§9-9)。history.spec.ts に倣って
  // Shift → 履歴 で開き、記録された式を `getByText` で見る。
  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByText("2 + 3 × 4")).toBeVisible();
});
