import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page, label: "Scientific" | "Data Scale" | "Loan") =>
  page.getByRole("link", { name: label, exact: true });

const panel = (page: Page) => page.getByRole("region", { name: "ローン計算" });

// <output> の暗黙ロールは status。jsdom はアクセシビリティツリーを組み立て
// ないので、role から引けることは実ブラウザでしか確かめられない。
const status = (page: Page) => panel(page).getByRole("status");

const main = (page: Page) => page.getByTestId("display-main");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
});

test("the nav now carries three tabs and aria-current follows", async ({
  page,
}) => {
  await expect(page.getByRole("link")).toHaveCount(3);
  await nav(page, "Loan").click();
  await expect(page).toHaveURL(/#loan$/);
  await expect(nav(page, "Loan")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scientific")).not.toHaveAttribute("aria-current");
  await expect(nav(page, "Data Scale")).not.toHaveAttribute("aria-current");
  await expect(panel(page)).toBeVisible();
  // <main> はシェルの所有物であり、モジュールを跨いでも存在し続ける。
  await expect(page.getByRole("main")).toBeVisible();
});

test("every nav tab is large enough to touch", async ({ page }) => {
  // --touch-target-min は 44px。3 タブになっても縮まないこと。
  for (const label of ["Scientific", "Data Scale", "Loan"] as const) {
    const box = await nav(page, label).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("a direct link to #loan shows the panel, and survives a reload", async ({
  page,
}) => {
  await page.goto("/#loan");
  await expect(panel(page)).toBeVisible();
  await page.reload();
  await expect(panel(page)).toBeVisible();
});

test("the housing case: 30M yen over 420 months at 1.5% is 91,855 a month", async ({
  page,
}) => {
  // 実 wasm(mock ではない)で、golden(finance.json)と同じ値が画面に出る。
  await nav(page, "Loan").click();

  await page.getByLabel("借入額").fill("30000000");
  await page.getByLabel("年利(%)").fill("1.5");
  await page.getByLabel("返済回数(月)").fill("420");

  await expect(status(page)).toContainText("91,855 円");
  await expect(status(page)).toContainText("38,579,007 円"); // 総支払額
  await expect(status(page)).toContainText("8,579,007 円"); // 総利息
});

test("the car case: a residual closes the loan at the residual itself", async ({
  page,
}) => {
  // 300 万・5 年・年 3.9%・残価 120 万(golden の車例)。
  await nav(page, "Loan").click();

  await page.getByLabel("借入額").fill("3000000");
  await page.getByLabel("年利(%)").fill("3.9");
  await page.getByLabel("返済回数(月)").fill("60");
  await page.getByLabel("残価").fill("1200000");

  await expect(status(page)).toContainText("37,536 円"); // 月々の返済額
  await expect(status(page)).toContainText("1,200,000 円"); // 最終回 = 残価
});

test("the borrowable amount comes back through the term inversion", async ({
  page,
}) => {
  // 85,000 円 × 420 回・1.5% の借入可能額(golden と同じ 27,761,211 円)。
  await nav(page, "Loan").click();

  await page.getByLabel("何を求めるか").selectOption("principal");
  await page.getByLabel("月々の返済額").fill("85000");
  await page.getByLabel("年利(%)").fill("1.5");
  await page.getByLabel("返済回数(月)").fill("420");
  await expect(status(page)).toContainText("27,761,211 円");

  // 同じ額を期間モードに入れると 420 回に戻る。
  await page.getByLabel("何を求めるか").selectOption("term");
  await page.getByLabel("借入額").fill("27761211");
  await expect(status(page)).toContainText("420 か月");
});

test("the mode selector opens and closes the fields it owns", async ({
  page,
}) => {
  await nav(page, "Loan").click();

  // 月額モード: 求める値の欄は閉じ、残価は開く。
  await expect(page.getByLabel("月々の返済額")).toBeDisabled();
  await expect(page.getByLabel("残価")).toBeEnabled();
  await expect(page.getByLabel("ボーナス返済分(元本)")).toBeEnabled();

  await page.getByLabel("何を求めるか").selectOption("principal");
  await expect(page.getByLabel("借入額")).toBeDisabled();
  await expect(page.getByLabel("月々の返済額")).toBeEnabled();
  await expect(page.getByLabel("残価")).toBeDisabled();
  await expect(page.getByLabel("残価")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // 期間モード: ボーナスも閉じる(2 列結合の期間は M6 では解かない)。
  await page.getByLabel("何を求めるか").selectOption("term");
  await expect(page.getByLabel("返済回数(月)")).toBeDisabled();
  await expect(page.getByLabel("ボーナス返済分(元本)")).toBeDisabled();
  await expect(page.getByLabel("ボーナス返済分(元本)")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("the disclaimer is always on screen and is not an alert", async ({
  page,
}) => {
  await nav(page, "Loan").click();
  const disclaimer =
    panel(page).getByText(/金融機関の計算方法により異なります/);
  await expect(disclaimer).toBeVisible();
  // 入力しても消えない(結果の有無に関係なく常設)。
  await page.getByLabel("借入額").fill("30000000");
  await page.getByLabel("年利(%)").fill("1.5");
  await page.getByLabel("返済回数(月)").fill("420");
  await expect(disclaimer).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("a payment that cannot cover the interest is reported as an error", async ({
  page,
}) => {
  // 100 万を年 12%(月利息 1 万円)、月々 1 万円 —— 永久に減らない。
  await nav(page, "Loan").click();

  await page.getByLabel("何を求めるか").selectOption("term");
  await page.getByLabel("借入額").fill("1000000");
  await page.getByLabel("年利(%)").fill("12");
  await page.getByLabel("月々の返済額").fill("10000");

  await expect(status(page)).toContainText("Math ERROR");
  await expect(
    status(page).locator("[data-error='SyntaxError']"),
  ).toBeVisible();
});

test("a partly-filled loan form stays neutral, no error shown", async ({
  page,
}) => {
  await nav(page, "Loan").click();
  await page.getByLabel("借入額").fill("30000000");

  await expect(status(page)).not.toContainText("Math ERROR");
  await expect(status(page).locator("[data-error]")).toHaveCount(0);
});

test("typing into the loan form does not touch the scientific state", async ({
  page,
}) => {
  // useKeyboard は ScientificPanel が unmount されると外れる。3 モジュールに
  // なっても漏れないことを、実際のキー入力で確かめる(data-scale 版と同型)。
  await nav(page, "Loan").click();
  await page.getByLabel("借入額").pressSequentially("3");
  await expect(page.getByLabel("借入額")).toHaveValue("3");

  await nav(page, "Scientific").click();
  await expect(main(page)).toHaveText("0");
});
