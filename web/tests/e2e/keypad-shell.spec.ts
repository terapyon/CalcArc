import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the main grid keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。誤爆が計算そのものを壊す
  // メイングリッドでは守る。関数列は縦だけ割る——設計書 §4 の判断で、
  // 誤爆しても DEL で戻せる軽さに見合わせている。緩めた理由をここに
  // 書いておかないと、次に読む人が「うっかり緩めた」と読む。
  const main = page.getByRole("group", { name: "数字と演算のキー" });
  for (const button of await main.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the function row is half height but still 44px wide", async ({
  page,
}) => {
  const functions = page.getByRole("group", { name: "関数キー" });
  for (const button of await functions.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("pi is reachable through the Shift face and reaches the core", async ({
  page,
}) => {
  // メイングリッドのキーが第 2 面を持つことの検査(設計書 §3)。第 1 面の
  // Exp は S2 まで無効だが、π は Shift 経由で従来どおり入力できる(§5)。
  await expect(
    page.getByRole("button", { name: "指数入力（準備中）" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "円周率" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3.141592654");

  // ワンショット: 面は戻っている。
  await expect(
    page.getByRole("button", { name: "指数入力（準備中）" }),
  ).toBeDisabled();
});

test("the empty second-face slots are reserved, not missing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  const empty = page.getByRole("button", { name: "第2面（準備中）" });
  await expect(empty).toHaveCount(3);
  for (const slot of await empty.all()) {
    await expect(slot).toBeDisabled();
  }
});

test("the reserved slots do nothing when pressed", async ({ page }) => {
  const zeros = page.getByRole("button", { name: "3桁のゼロ（準備中）" });
  await expect(zeros).toBeDisabled();
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the echo line is present and empty", async ({ page }) => {
  // S2 が埋める場所。S1 では空であること自体を固定する(設計書 §5)。
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});

test("the board still computes after the rearrangement", async ({ page }) => {
  // 配置を変えただけで意味は変えていない。代表列で確かめる。
  for (const name of ["3", "足す", "虚数単位", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("3+j4");
});

test("DRG still switches the angle unit from the function row", async ({
  page,
}) => {
  // DRG はメイングリッドから関数列へ移った(設計書 §2)。移動しても効く。
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
  await page.getByRole("button", { name: "角度の単位を切り替え" }).click();
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");
});
