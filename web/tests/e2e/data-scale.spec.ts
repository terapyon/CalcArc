import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page, label: "Scientific" | "Data Scale") =>
  page.getByRole("link", { name: label, exact: true });

const panel = (page: Page) =>
  page.getByRole("region", { name: "データスケール計算" });

// <output> の暗黙ロールは status。jsdom はアクセシビリティツリーを組み立て
// ないので、role から引けることは実ブラウザでしか確かめられない
// (Task 4/5 レビューの申し送り)。
const status = (page: Page) => panel(page).getByRole("status");

const main = (page: Page) => page.getByTestId("display-main");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
});

test("the nav switches modules both ways and aria-current follows", async ({
  page,
}) => {
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Data Scale")).not.toHaveAttribute("aria-current");

  await nav(page, "Data Scale").click();
  await expect(page).toHaveURL(/#data-scale$/);
  await expect(nav(page, "Data Scale")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scientific")).not.toHaveAttribute("aria-current");
  await expect(panel(page)).toBeVisible();

  await nav(page, "Scientific").click();
  await expect(page).toHaveURL(/#scientific$/);
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Data Scale")).not.toHaveAttribute("aria-current");
  await expect(main(page)).toBeVisible();
});

test("the headline case: 100M x 768 x float32 is 307.2 GB / 286.1 GiB", async ({
  page,
}) => {
  // 実 wasm(mock ではない)で通す(完了条件 1)。
  await nav(page, "Data Scale").click();

  await page.getByLabel("件数").fill("100000000");
  await page.getByLabel("次元数").fill("768");
  // dtype は既定の float32 のまま。

  await expect(status(page)).toContainText("307,200,000,000 bytes");
  await expect(status(page)).toContainText("307.2 GB");
  await expect(status(page)).toContainText("286.1 GiB");
});

test("a 39-digit count survives the boundary intact", async ({ page }) => {
  // 2^127-1。JS number を経由していれば 2^53 で精度を失う。
  await nav(page, "Data Scale").click();

  await page.getByLabel("件数").fill("170141183460469231731687303715884105727");
  await page.getByLabel("次元数").fill("2");
  await page.getByLabel("データ型").selectOption("uint8");

  await expect(status(page)).toContainText(
    "340,282,366,920,938,463,463,374,607,431,768,211,454 bytes",
  );
});

test("crossing 2^128 shows an overflow error", async ({ page }) => {
  // 2^127 x 2 x 1 byte = 2^128、u128 の上限を超える(base-spec §25)。
  await nav(page, "Data Scale").click();

  await page.getByLabel("件数").fill("170141183460469231731687303715884105728");
  await page.getByLabel("次元数").fill("2");
  await page.getByLabel("データ型").selectOption("uint8");

  await expect(status(page)).toContainText("Math ERROR");
  await expect(status(page).locator("[data-error='Overflow']")).toBeVisible();
});

test("the form fields are reachable by their accessible labels", async ({
  page,
}) => {
  await nav(page, "Data Scale").click();

  await expect(page.getByLabel("件数")).toBeVisible();
  await expect(page.getByLabel("次元数")).toBeVisible();
  await expect(page.getByLabel("データ型")).toBeVisible();
});

test("a partly-filled form stays neutral, no error shown", async ({ page }) => {
  await nav(page, "Data Scale").click();

  // 次元数は空のまま。
  await page.getByLabel("件数").fill("100000000");

  await expect(status(page)).not.toContainText("Math ERROR");
  await expect(status(page).locator("[data-error]")).toHaveCount(0);
});

test("a sub-unit success shows bytes without GB/GiB lines", async ({
  page,
}) => {
  // count=1, dimensions=1, int8 -> 1 byte。単位未満なので decimal/binary は
  // 出ない(Task 3 の追補テストが保証する境界)。
  await nav(page, "Data Scale").click();

  await page.getByLabel("件数").fill("1");
  await page.getByLabel("次元数").fill("1");
  await page.getByLabel("データ型").selectOption("int8");

  await expect(status(page)).toContainText("1 bytes");
  await expect(status(page)).not.toContainText("Math ERROR");
  await expect(status(page)).not.toContainText("GB");
  await expect(status(page)).not.toContainText("GiB");
});

test("typing into the data-scale form does not touch the scientific state", async ({
  page,
}) => {
  // useKeyboard は ScientificPanel が unmount されると外れる(App.tsx の
  // 条件レンダリング)。data-scale で打った "3" が Scientific の window
  // リスナに漏れないことを、実際のキー入力で確かめる(Task 4/5 の申し送り)。
  //
  // 検出器は toHaveValue("3")(下の行): リスナが漏れていれば useKeyboard
  // 側の preventDefault() が入力欄への文字挿入自体を止める。最後の "0"
  // 確認は ScientificPanel が毎回新規マウントされるため常に真になり、
  // 単体では非リークの証拠にならない(再マウント後の健全性確認)。
  await nav(page, "Data Scale").click();
  await page.getByLabel("件数").pressSequentially("3");
  await expect(page.getByLabel("件数")).toHaveValue("3");

  await nav(page, "Scientific").click();
  await expect(main(page)).toHaveText("0");
});

test("the nav tabs are large enough to touch", async ({ page }) => {
  // --touch-target-min は 44px(既存 e2e と同じ流儀)。
  for (const label of ["Scientific", "Data Scale"] as const) {
    const box = await nav(page, label).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
