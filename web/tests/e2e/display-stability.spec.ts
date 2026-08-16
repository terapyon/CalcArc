import { expect, type Page, test } from "@playwright/test";

// **jsdom はレイアウトを計算しない。** 高さが動かないという主張は
// 実ブラウザでしか確かめられない(CLAUDE.md)。

const keypadTop = async (page: Page, name: string) => {
  const box = await page.getByRole("group", { name }).boundingBox();
  return box?.y ?? 0;
};

test("the row you type into holds its place before you type", async ({
  page,
}) => {
  // **盤面の Y 座標では、この性質は測れない**——`.echo` の min-height が
  // 子の有無を吸収してしまうため。だから要素そのものの箱を見る。
  // 条件付き描画に戻すと、何も打っていない時点で要素が存在せず
  // boundingBox() が null になって落ちる。
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");

  const box = await page.getByTestId("display-entry-active").boundingBox();
  expect(
    box,
    "the active row is missing before anything is typed",
  ).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThan(0);
});

test("the Scientific keypad does not move while you type", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");

  const before = await keypadTop(page, "数字と演算のキー");

  // 打つ → 演算子 → 打つ → 確定。**主犯は「打ち始めた瞬間」**なので、
  // 最初の 1 打のあとを必ず測る。
  for (const name of ["3", "足す", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
    expect(await keypadTop(page, "数字と演算のキー")).toBe(before);
  }
});

test("the Finance keypad does not move as fields fill up", async ({ page }) => {
  // **項目が多いのは Finance である。** 入力済みの行が折り返して伸びる
  // 経路は、ここでしか踏めない。
  await page.goto("/#finance");
  const before = await keypadTop(page, "数字と演算のキー");

  await page.getByRole("button", { name: "借入額を入力" }).click();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "万", exact: true }).click();
  expect(await keypadTop(page, "数字と演算のキー")).toBe(before);

  await page.getByRole("button", { name: "年利を入力" }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  expect(await keypadTop(page, "数字と演算のキー")).toBe(before);

  await page.getByRole("button", { name: "返済期間を入力" }).click();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  expect(await keypadTop(page, "数字と演算のキー")).toBe(before);
});
