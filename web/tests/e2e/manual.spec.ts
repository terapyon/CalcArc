import { expect, test } from "./fixtures";

/**
 * マニュアルの画面（0.9.3 設計書 §2.2、`#manual`）。
 *
 * **ここに置くのは、実ブラウザでしか言えないことだけ**である
 * ——**jsdom はアクセシビリティツリーを組み立てない**（CLAUDE.md）ので、
 * 「タブに現在地が付かない」「見出しが読み上げに出る」は役割で引いて確かめる。
 * **PDF が本当に取れるか**は、ここでは見ない（**手元のビルドに PDF は無い**
 * ——作るのは `pnpm manuals` で、配るのは `deploy.yml` である。本番での
 * 確認は `deploy.yml` のスモーク 2 本が持つ）。
 */

test("the links popup opens the manual screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^CalcArc .+ について$/ }).click();
  await page.getByRole("link", { name: "マニュアル" }).click();

  await expect(page).toHaveURL(/#manual$/);
  // **リンク集は残らない**(新しい画面の上に居座らせない)。
  await expect(page.getByRole("dialog", { name: "リンク集" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "マニュアル" }),
  ).toBeAttached();
  await expect(page).toHaveTitle("マニュアル | CalcArc");
});

test("the manual screen is not a fifth tab", async ({ page }) => {
  // **タブは 4 つのまま**で、**どれにも現在地が付かない**(設計書 §2.2)。
  await page.goto("/#manual");
  const tabs = page.getByRole("navigation", { name: "計算機の切り替え" });
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.locator("[aria-current]")).toHaveCount(0);
});

test("the manual screen offers the three PDFs and a way back", async ({
  page,
}) => {
  await page.goto("/#manual");
  const manual = page.getByRole("region", { name: "マニュアル" });
  await expect(manual.getByRole("link")).toHaveText([
    "CalcArc 簡易マニュアル",
    "CalcArc 詳細マニュアル",
    "CalcArc Quick Guide",
    "この版の Release",
    "計算機に戻る",
  ]);
  await manual.getByRole("link", { name: "計算機に戻る" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the switch is announced with the screen's name", async ({ page }) => {
  // **「〜に切り替えました」は `App` が鳴らす**(設計書 §5)。画面名は
  // 利用者の裁定の綴りである(2026-09-17)。
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toBeVisible();
  await page.goto("/#manual");
  await expect(page.getByRole("status", { name: "画面の切り替え" })).toHaveText(
    "マニュアルに切り替えました",
  );
});
