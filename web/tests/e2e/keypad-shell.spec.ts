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
  // 44px は 8 列案を却下した唯一の測定(390px で 38.75px)。2 段化は
  // それを守るためだけに存在するので、2 段目も同じ検査に含める
  // ——含めないと将来 8 列に戻す変更が入っても緑のまま通ってしまう。
  const functions = page.getByRole("group", { name: /関数キー|第 2 関数列/ });
  for (const button of await functions.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("pi is reachable through the Shift face and reaches the core", async ({
  page,
}) => {
  // メイングリッドのキーが第 2 面を持つことの検査(設計書 §3)。第 1 面は
  // Exp(S2 で有効化済み)、第 2 面が π。
  await expect(page.getByRole("button", { name: "指数入力" })).toBeEnabled();

  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "円周率" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3.141592654");

  // ワンショット: 面は戻っている。
  await expect(page.getByRole("button", { name: "指数入力" })).toBeEnabled();
});

test("the second face is full now, not a row of placeholders", async ({
  page,
}) => {
  // S-1 で sin/cos/tan の裏が asin/acos/atan になり、「準備中」の面は
  // 1 つも残っていない。
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await expect(
    page.getByRole("button", { name: "第2面（準備中）" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "アークサイン" })).toBeEnabled();
});

test("the one remaining reserved slot does nothing, and looks like it", async ({
  page,
}) => {
  // 第 1 面の予約は S2 で解け、第 2 面の予約は S-1 で解けた。残るのは
  // 第 2 関数列の 1 枠(S-4 の `°'"`)だけ。
  const empty = page.getByRole("button", { name: "空き", exact: true });
  await expect(empty).toHaveCount(1);
  await expect(empty).toBeDisabled();
  // 無効なことは見た目にも出す(S-2 設計書 §5 の「無効表示」)。属性だけだと
  // 押せる見た目のキーが押せない、という一番いらだつ形になる。
  const opacity = await empty.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(1);
});

test("Shift shows its face is on, not just to the accessibility tree", async ({
  page,
}) => {
  const shift = page.getByRole("button", { name: "第2面に切り替え" });
  const background = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const before = await shift.evaluate(background);
  await shift.click();
  await expect(shift).toHaveAttribute("aria-pressed", "true");
  expect(await shift.evaluate(background)).not.toBe(before);
});

test("the echo line is empty until something is pending", async ({ page }) => {
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
