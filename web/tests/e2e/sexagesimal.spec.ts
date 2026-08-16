import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const key = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

const press = async (page: Page, names: string[]) => {
  for (const name of names) await key(page, name).click();
};

test("adds two durations without any new arithmetic", async ({ page }) => {
  // **この spec の要点**(設計書 §1): 1:30 + 2:45 = 4:15 は
  // 1.5 + 2.75 = 4.25 であって、四則は 1 行も足していない。
  await press(page, [
    "1",
    "60進に切り替え",
    "3",
    "0",
    "60進に切り替え",
    "足す",
    "2",
    "60進に切り替え",
    "4",
    "5",
    "60進に切り替え",
    "計算する",
  ]);
  // 値は十進のまま。
  await expect(page.getByTestId("display-main")).toHaveText("4.25");
  // 押すと 60 進で見える。
  await press(page, ["60進に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("4°15'0\"");
});

test("the sexagesimal view is temporary, not a mode", async ({ page }) => {
  // 裁定 4。ENG はモードとして残るが、60 進は覗くだけである。
  await press(page, ["3", "小数点", "7", "5", "計算する", "60進に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("3°45'0\"");

  // **次に何か押すと十進に戻る**——値を変えないキーでも解除される。
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("3.75");
});

test("typing shows the stages as they are typed", async ({ page }) => {
  // 入力中は打った通りに見せる。**十進でも 60 進の完成形でもない、
  // 打鍵の途中の姿**である。
  await press(page, ["1", "60進に切り替え", "3", "0"]);
  await expect(page.getByTestId("display-main")).toHaveText("1°30");
  // DEL は 1 段ずつ戻る。
  await press(page, ["1文字消去", "1文字消去"]);
  await expect(page.getByTestId("display-main")).toHaveText("1°");
});

test("a value it cannot show is left alone, not turned into an error", async ({
  page,
}) => {
  // 裁定 6: 表示の操作でエラー状態に落とさない。
  await press(page, ["1", "指数入力", "2", "0", "計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("1e20");
  await press(page, ["60進に切り替え"]);
  await expect(page.getByTestId("display-main")).toHaveText("1e20");
  await expect(page.getByTestId("display-main")).not.toHaveAttribute(
    "data-error",
    /.+/,
  );
});

test("the °'\" key keeps its touch target", async ({ page }) => {
  // 関数列は半高だが幅は 44px を保つ(S-2 が 2 段化した理由そのもの)。
  const box = await key(page, "60進に切り替え").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
});
