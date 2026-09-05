import { expect, test } from "./fixtures";

// 実 SW の世代交代は自動テストで再現しない(設計書 §4: 本番ビルドでしか
// 本物にならない)。ここが見るのは「出たときの形」——役割・フォーカス・
// タッチターゲット・他の操作を妨げないこと。世代交代そのものはデプロイ後の
// 手動確認が持つ(docs/deploy.md)。
test.beforeEach(async ({ page }) => {
  await page.goto("/?sw-toast=preview");
});

// **この巡回が指すのは「出てきた箱」であって、live 領域そのものではない。**
// 領域(`role="status"` の `<div>`)は 2026-09-05 に**常設**になった
// (設計書 §6)——領域と中身を同時に挿入すると読み上げが鳴らないからで、
// 空のときも DOM に在り、通常フローで高さ 0 である。**assertion は 1 つも
// 変えていない**。変えたのはこの 1 行、「何を指すか」だけである:
//
//   - `toBeVisible()` は箱に対して意味を持つ(空の領域は高さ 0 で hidden)。
//   - `toHaveCount(0)` は「トーストが出ていない」を意味しつづける
//     (領域はいつでも 1 件なので、領域を指したままだとこの 3 本は
//     「いまと逆のこと」を言うようになる)。
//
// **役割と名前はここでも見ている**——箱は `role="status"` かつ
// `name="更新のお知らせ"` の子としてしか取れない。**領域が常設であること**
// 自体は vitest(`src/ui/UpdateToast/UpdateToast.test.tsx`)が持つ。
const toast = (page: import("./fixtures").Page) =>
  page.getByRole("status", { name: "更新のお知らせ" }).locator(":scope > div");

test("the toast announces itself as a status, not an alert", async ({
  page,
}) => {
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText("新しいバージョンがあります");
  await expect(toast(page)).toContainText("入力中の内容は消えます");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("its buttons are large enough to touch", async ({ page }) => {
  for (const name of ["再読み込み", "閉じる"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("its buttons are visible as buttons, not just text", async ({ page }) => {
  // 白いトーストの上に白いボタンを置くと、サイズは足りていても押せる場所に
  // 見えない。E2E がサイズしか見ていないと、この抜けは通ってしまう。
  const background = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const border = (el: HTMLElement) => getComputedStyle(el).borderTopWidth;
  const reload = page.getByRole("button", { name: "再読み込み" });
  const dismiss = page.getByRole("button", { name: "閉じる" });

  // 主たる操作は色で分かれ、もう一方は枠で分かれる。
  expect(await reload.evaluate(background)).not.toBe(
    await dismiss.evaluate(background),
  );
  expect(await dismiss.evaluate(border)).not.toBe("0px");
});

test("it does not take focus", async ({ page }) => {
  await page.getByRole("button", { name: "7", exact: true }).focus();
  await expect(toast(page)).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
  ).toBe("7");
});

test("closing with Escape does not clear the calculation", async ({ page }) => {
  // KEYBOARD_MAP は Escape を AC に割り当てている(useKeyboard.ts)。トーストが
  // bubble で受けると、閉じた瞬間に計算が全部消える。表示が残ることを見る
  // ——「トーストが消えた」だけでは、この衝突を捕まえられない。
  for (const name of ["3", "足す", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("7");

  await page.keyboard.press("Escape");
  await expect(toast(page)).toHaveCount(0);
  await expect(page.getByTestId("display-main")).toHaveText("7");
});

test("the calculator underneath still works while the toast is up", async ({
  page,
}) => {
  // トーストは操作を妨げない(fixed で重ねるだけ)。
  for (const name of ["3", "足す", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("7");
  await expect(toast(page)).toBeVisible();
});

test("dismissing it leaves everything else alone", async ({ page }) => {
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(toast(page)).toHaveCount(0);
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("without the preview parameter there is no toast", async ({ page }) => {
  // テスト用の入口が本番の挙動を変えていないこと。
  await page.goto("/");
  await expect(toast(page)).toHaveCount(0);
});
