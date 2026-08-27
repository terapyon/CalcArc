import { expect, test } from "./fixtures";

test("the calculator loads and shows zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(page.getByRole("main")).toBeVisible();
});

test("the app version is reported in the footer", async ({ page }) => {
  // **版数の置き場も出所も 0.2.0 で変わった**(設計書 §4/§5)。以前は
  // Scientific のパネルが WASM の core_version() を非同期に読んで
  // 「calcarc-core 0.1.0」と出していた。いまはシェルのフッタが、ビルド時に
  // 埋まったアプリの版を出す。**版数を直書きしない**——上げるたびにここを
  // 直すことになり、上げ忘れではなくテストの直し忘れで赤くなる。
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /^CalcArc \d+\.\d+\.\d+ @terapyon$/ }),
  ).toBeVisible();
});
