import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page, label: "Scientific" | "Finance") =>
  page.getByRole("link", { name: label, exact: true });

// **region 起点で引く**——「入力する項目」という区画名は Data Scale にも
// 同名のものがある(loan.spec.ts と同じ流儀)。
const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });

const main = (page: Page) => page.getByTestId("display-main");
const breakdown = (page: Page) => page.getByTestId("finance-breakdown");
const scientificMain = (page: Page) => page.getByTestId("display-main");

/** キーをアクセシブルネームで順に押す。**パネル起点**(region の外は探さない)。 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(scientificMain(page)).toHaveText("0");
});

test("solves the required deposit: 3%, monthly, 240 periods, 10M target", async ({
  page,
}) => {
  // 実 wasm(mock ではない)で、golden(finance.json 必須ケース #1)と同じ値
  // が画面に出る。元本は打たない(0 のまま。積立だけで積み上げるケース)。
  await nav(page, "Finance").click();
  await press(page, ["必要な積立額を求める"]);

  // **積立の代わりに目標が出る**(設計書 §11)——求める項目(積立)は消える。
  await expect(
    panel(page).getByRole("button", { name: "目標額を入力" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "毎期の積立額を入力" }),
  ).toHaveCount(0);

  await press(page, [
    "年利を入力",
    "3",
    "期間を入力",
    "2",
    "4",
    "0",
    "目標額を入力",
    "1",
    "0",
    "0",
    "0",
    "万",
  ]);

  await expect(main(page)).toHaveText("30,461 円");
  await expect(breakdown(page)).toContainText("10,000,251 円"); // 残高
});

test("solves the required periods and keeps the first period that reaches the target", async ({
  page,
}) => {
  // 実 wasm。golden の非単調ペア(a)(#4)——元本 999・年 1.5%・月次・積立 0・
  // 目標 1,016・税あり → 19 期。次の期(#5)はまた目標を下回るが、それでも
  // 「最初に届いた期」を答として保つ(設計書 §3 帰結 2)。
  await nav(page, "Finance").click();
  await press(page, ["必要な期間を求める"]);

  // **期間の代わりに目標が出る**(設計書 §11)——求める項目(期間)は消える。
  await expect(
    panel(page).getByRole("button", { name: "目標額を入力" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "期間を入力" }),
  ).toHaveCount(0);

  await press(page, [
    "元本を入力",
    "9",
    "9",
    "9",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "目標額を入力",
    "1",
    "0",
    "1",
    "6",
    "税の扱いを選ぶ",
    "源泉分離課税を引く",
  ]);

  await expect(main(page)).toHaveText("19 期");
  await expect(breakdown(page)).toContainText("1,016 円"); // 手取り
});
