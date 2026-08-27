import { expect, type Page, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

// **exact: true が要る。** 「サイン」は「アークサイン」の部分文字列で、
// 「自然対数」は「自然対数の底」の部分文字列である。既定の部分一致だと
// strict-mode で 2 件に当たって落ちる。
const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("the functions on the second row reach the core", async ({ page }) => {
  // 第 1 面に出ていることの検査でもある(設計書 §7)。Shift を 1 度も押さない。
  await press(page, ["2", "自然対数"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.6931471806");

  await press(page, ["全消去", "1", "0", "0", "常用対数"]);
  await expect(page.getByTestId("display-main")).toHaveText("2");

  await press(page, ["全消去", "4", "逆数"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.25");

  await press(page, ["全消去", "1", "指数関数"]);
  await expect(page.getByTestId("display-main")).toHaveText("2.718281828");
});

test("xʸ folds from the right, all the way through the browser", async ({
  page,
}) => {
  // 裁定 3。左結合なら 64 になる(設計書 §3.1)。
  await press(page, ["2", "べき乗", "3", "べき乗", "2", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("512");
});

test("the pending power operator shows in the echo", async ({ page }) => {
  await press(page, ["2", "べき乗"]);
  await expect(page.getByTestId("display-echo")).toHaveText("2 ^");
});

test("the inverse trig functions are reachable through Shift", async ({
  page,
}) => {
  // ロールの意味論に関わるので実ブラウザで確かめる(CLAUDE.md: jsdom は
  // アクセシビリティツリーを組み立てない)。
  await press(page, ["0", "小数点", "5"]);
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "アークサイン" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("30");
  // ワンショット: 面は戻っている。
  await expect(
    page.getByRole("button", { name: "サイン", exact: true }),
  ).toBeEnabled();
});

test("Shift on e to the x gives the base itself", async ({ page }) => {
  // ユーザーの質問への答えが盤面に出ていることの検査(設計書 §7)。
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "自然対数の底" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("2.718281828");
});

test("the square root of a negative number is now an error", async ({
  page,
}) => {
  // **この電卓が誇っていた挙動の反転**(設計書 §5)。関数は実数に閉じる。
  await press(page, ["4", "符号を反転", "平方根"]);
  await expect(page.getByTestId("display-main")).toHaveText("Math ERROR");
  // 四則の複素数は今までどおり動く——落としたのは関数だけである。
  await press(page, ["全消去", "3", "足す", "虚数単位", "4", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("3+4j");
});
