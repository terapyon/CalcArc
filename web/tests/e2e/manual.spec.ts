import { expect, test } from "./fixtures";

/**
 * マニュアルを読む画面（0.9.6 設計書 §4、`#manual`）。
 *
 * **ここに置くのは、実ブラウザでしか言えないことだけ**である
 * ——**jsdom はアクセシビリティツリーを組み立てない**（CLAUDE.md）ので、
 * 「タブに現在地が付かない」「見出しが読み上げに出る」は役割で引いて確かめる。
 * **本文が別の塊として実際に読み込まれるか**も、ここでしか見られない
 * （単体試験の `import("virtual:manuals")` は vitest が解決してしまう）。
 *
 * **PDF が本当に取れるか**は、ここでは見ない（**手元のビルドに PDF は無い**
 * ——作るのは `pnpm manuals`、配るのは `deploy.yml`）。**行き先の綴りだけ**を見る。
 */

test("the links popup opens the manual screen, and the text is there", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^CalcArc .+ について$/ }).click();
  await page.getByRole("link", { name: "マニュアル" }).click();

  await expect(page).toHaveURL(/#manual$/);
  // **リンク集は残らない**（新しい画面の上に居座らせない）。
  await expect(page.getByRole("dialog", { name: "リンク集" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "マニュアル" }),
  ).toBeAttached();
  await expect(page).toHaveTitle("マニュアル | CalcArc");
  // **本文が画面の中に出る**——**これが 0.9.6 の目的そのもの**である
  // （iPhone のホーム画面アプリで、PDF を開く道は行き止まりだった）。
  await expect(page.getByRole("heading", { name: /4 つのタブ/ })).toBeVisible();
});

test("the manual screen is not a fifth tab", async ({ page }) => {
  // **タブは 4 つのまま**で、**どれにも現在地が付かない**（設計書 Q1）。
  await page.goto("/#manual");
  const tabs = page.getByRole("navigation");
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.locator("[aria-current]")).toHaveCount(0);
});

test("the reader can switch books and go back to the calculator", async ({
  page,
}) => {
  await page.goto("/#manual");
  const detail = page.getByRole("button", { name: "CalcArc 詳細マニュアル" });
  await expect(detail).toHaveAttribute("aria-pressed", "false");
  await detail.click();
  await expect(detail).toHaveAttribute("aria-pressed", "true");
  // 詳細マニュアルにしか無い章で、冊が入れ替わったことを見る。
  await expect(page.getByRole("heading", { name: /読み上げ/ })).toBeVisible();

  // **戻る道は画面の中に在る**（利用者が探したのはボタンだった）。
  await page.getByRole("link", { name: "計算機に戻る" }).click();
  await expect(page).toHaveURL(/#scientific$/);
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the manual screen offers the PDFs, pointing inside the site", async ({
  page,
}) => {
  // **PDF は保存・印刷用の副経路**（利用者の裁定 2026-09-23）。
  // **行き先はサイトの中**——0.9.5 の GitHub Release 行きは取り消した。
  await page.goto("/#manual");
  const pdfs = page.getByRole("link", { name: /PDF$/ });
  await expect(pdfs).toHaveCount(3);
  for (const pdf of await pdfs.all()) {
    await expect(pdf).toHaveAttribute(
      "href",
      /^\/manual\/calcarc-\d+\.\d+\.\d+-(quick-ja|detail-ja|quick-en)\.pdf$/,
    );
  }
});

test("the manual does not spill sideways on a narrow screen", async ({
  page,
}) => {
  // **読み物の面は高さの予算を持たない**（縦に伸びてよい）。**横は別**
  // ——**本文には長い表と長い綴りが在る**ので、**溢れると読めなくなる**。
  // `viewport-budget.spec.ts` の巡回は 11 route の字面表で、**この画面は
  // そこに入っていない**（設計書 §5 の「動かない番人」）。**だからここで見る。**
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/#manual");
  await expect(page.getByRole("heading", { name: /4 つのタブ/ })).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("switching to the manual is announced with its name", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^CalcArc .+ について$/ }).click();
  await page.getByRole("link", { name: "マニュアル" }).click();
  await expect(page.getByRole("status", { name: "画面の切り替え" })).toHaveText(
    "マニュアルに切り替えました",
  );
});
