import { expect, type Page, test } from "@playwright/test";

// **設定は残り、打った式は残らない。**
//
// 「設定が残る」だけを測ると、うっかり全部保存してしまった実装も緑に
// なる(P-1 設計書 §8)。範囲の裁定は「設定だけ」なので、**残らない側にも
// 番人を置く**。

const main = (page: Page) => page.getByTestId("display-main");
const echo = (page: Page) => page.getByTestId("display-echo");
const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });

const nav = (page: Page, name: "Scientific" | "Data Scale" | "Finance") =>
  page.getByRole("link", { name, exact: true });

async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

test("the angle mode survives a reload", async ({ page }) => {
  await page.goto("/#scientific");
  await expect(page.getByText("DEG")).toBeVisible();

  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByText("RAD")).toBeVisible();

  await page.reload();
  await expect(page.getByText("RAD")).toBeVisible();
});

test("what you typed does not survive a reload", async ({ page }) => {
  // **これが範囲の境界である。** 式まで戻ってきたら、保存する物が
  // 増えている。
  await page.goto("/#scientific");
  await expect(main(page)).toHaveText("0");

  await press(page, ["1", "2", "3"]);
  await expect(main(page)).toHaveText("123");

  await page.reload();
  await expect(main(page)).toHaveText("0");
});

test("the angle mode survives moving between tabs", async ({ page }) => {
  // タブを移るとパネルは unmount する(App.tsx の条件描画)。リロードとは
  // 別の失われ方なので、別に測る。
  await page.goto("/#scientific");
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByText("RAD")).toBeVisible();

  await nav(page, "Finance").click();
  await expect(main(page)).toBeVisible();
  await nav(page, "Scientific").click();

  await expect(page.getByText("RAD")).toBeVisible();
});

test("the finance calculation mode survives a reload but the amounts do not", async ({
  page,
}) => {
  await page.goto("/#finance");
  await expect(main(page)).toBeVisible();

  // 「借入可能額を求める」に切り替えると、principal モードでは押せる
  // 「借入額を入力」が無効になる(loan.spec.ts の
  // "the mode selector opens and closes the fields it owns" と同じ観測点)。
  // これが実際に保存・復元される finance 設定(計算の種類)である。
  await press(page, ["借入可能額を求める"]);
  await expect(
    panel(page).getByRole("button", { name: "借入額を入力" }),
  ).toBeDisabled();

  await press(page, ["月々の返済額を入力", "3"]);
  await expect(echo(page)).toContainText("3");

  await page.reload();
  await expect(main(page)).toBeVisible();

  // モード(計算の種類)は残っている。
  await expect(
    panel(page).getByRole("button", { name: "借入額を入力" }),
  ).toBeDisabled();
  // **無効になっているだけでは足りない。** 借入額は復元前から押下状態の
  // 既定値なので、「無効」だけなら *active を直さなかった実装* でも緑に
  // なる——そのとき盤面は「無効なタブが押下状態で、借入額を入力中と
  // 名乗り、打鍵をそこへ捨てる」状態である。押下状態と状態行も見る。
  await expect(
    panel(page).getByRole("button", { name: "借入額を入力" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("finance-field")).toHaveText("年利を入力中");
  // 打った金額は残っていない。
  await expect(echo(page)).not.toContainText("3");
});

test("nothing that was typed is written to storage", async ({ page }) => {
  // **保存された物そのものを見る。** 画面に出ないことと、保存されて
  // いないことは別の主張である。
  await page.goto("/#scientific");
  await press(page, ["角度の単位を切り替え", "1", "2", "3"]);

  const raw = await page.evaluate(() =>
    window.localStorage.getItem("calcarc.settings"),
  );
  expect(raw).not.toBeNull();
  expect(raw).toContain("Rad");
  expect(raw).not.toContain("123");
  expect(raw).not.toContain("buffer");
  expect(raw).not.toContain("operands");
});
