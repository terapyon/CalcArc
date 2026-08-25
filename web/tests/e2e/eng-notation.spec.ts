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
  // 見た目が変わらない値もあるので、インジケータが無いと ENG に入ったか
  // 分からない(設計書 §5)。境界(serde の "Eng" 文字列)が壊れても
  // 部品のテストだけでは緑のまま通るので、ここで実ブラウザから固定する。
  await expect(page.getByRole("status", { name: "数の表記" })).toHaveText(
    "ENG",
  );

  // もう一度押すと戻る(設計書 §1 の裁定 1)。
  await press(page, ["工学表記に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("1,000");
  await expect(page.getByRole("status", { name: "数の表記" })).toBeEmpty();
});

test("does not keep engineering notation for the next answer", async ({
  page,
}) => {
  // **【変更 2026-08-25、0.4.0】ENG はモードではなくなった**(ユーザー指示)。
  // 以前は「一度押したら以後の計算結果も ENG で出る」で、この列は
  // `12.345e3` を返していた。**いまは覗くためのキー**で、ENG 以外の
  // どのキーでも通常表記に戻る。
  await press(page, ["工学表記に切り替え"]);
  await press(page, ["1", "2", "3", "4", "5", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("12,345");
});

test("puts the notation back on the very next key", async ({ page }) => {
  // **インジケータでも見る。** 表示の文字列だけを見ると、`e` が出ない値
  // (12,345 のような)では「戻った」のか「もともと同じ」のか区別が付かない
  // ——ENG の札が消えることまで見て初めて、戻ったと言える。
  await press(page, ["1", "0", "0", "0", "計算する", "工学表記に切り替え"]);
  await expect(page.getByRole("status", { name: "数の表記" })).toHaveText(
    "ENG",
  );
  await press(page, ["足す"]);
  await expect(page.getByRole("status", { name: "数の表記" })).toBeEmpty();
  await expect(page.getByTestId("display-main")).toHaveText("1,000");
});

test("is not written to the saved settings at all", async ({ page }) => {
  // **保存しなくなった**(0.4.0)。ENG は打鍵をまたいで残る設定ではない。
  //
  // **保存そのものを読む。** 「再読み込みしたら消えている」だけでは弱い
  // ——保存されていても復元し忘れているだけ、という実装でも緑になる。
  // ここで見るのは **`localStorage` に `Eng` の綴りが 1 度も現れないこと**
  // である。
  await press(page, ["1", "0", "0", "0", "計算する", "工学表記に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("1e3");

  // **角度は保存される。** 同じ走行で「保存の配線は生きている」ことを
  // 示しておかないと、上の主張は「何も保存されない」でも緑になる。
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByText("RAD")).toBeVisible();

  const saved = await page.evaluate(() =>
    window.localStorage.getItem("calcarc.settings"),
  );
  expect(saved, "the settings were never written").not.toBeNull();
  expect(saved).toContain("Rad");
  expect(
    saved,
    `notation leaked into the saved settings: ${saved}`,
  ).not.toContain("Eng");

  await page.reload();
  await expect(page.getByRole("status", { name: "数の表記" })).toBeEmpty();
  // 角度のほうは戻ってくる(復元の配線が生きていることの確認)。
  await expect(page.getByText("RAD")).toBeVisible();
});

test("shows the thousands separators by default", async ({ page }) => {
  // カンマは既定。ENG を押していない状態で 1,234,567 と出る。
  await press(page, ["1", "2", "3", "4", "5", "6", "7", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("1,234,567");
});
