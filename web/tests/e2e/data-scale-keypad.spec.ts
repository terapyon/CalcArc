import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) =>
  page.getByRole("region", { name: "データスケール計算" });
const echo = (page: Page) => page.getByTestId("display-entry-active");
const result = (page: Page) => page.getByTestId("datascale-result");

async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

/** いま出ている面(数字面 or 型面)の区画。 */
const face = (page: Page, name: "数字と演算のキー" | "データ型のキー") =>
  panel(page).getByRole("group", { name });

test.beforeEach(async ({ page }) => {
  await page.goto("/#data-scale");
  await expect(panel(page)).toBeVisible();
});

test("both faces keep 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**誤爆の実害に比例させる**
  // (設計書 §8): 数字・単位・型の押し間違いは答えを壊すので、メインの
  // 枠に載る二面はどちらも守る。項目の列だけは押し直せば戻るので縦を詰める。
  for (const button of await face(page, "数字と演算のキー")
    .getByRole("button")
    .all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await press(page, ["データ型を選ぶ"]);
  for (const button of await face(page, "データ型のキー")
    .getByRole("button")
    .all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the field row is half height but wide enough", async ({ page }) => {
  const row = panel(page).getByRole("group", { name: "入力する項目" });
  for (const button of await row.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("swapping faces moves neither the frame nor DEL", async ({ page }) => {
  // **同じ枠に載る**(設計書 §2)。型面は 11 キーで 3 行しか描かれないため、
  // 行数を CSS で押さえていないとここで枠が 1 行ぶん縮み、DEL の位置が
  // 上にずれる。jsdom では寸法が出ないので、この検査は実ブラウザにしかない。
  const numberBox = await face(page, "数字と演算のキー").boundingBox();
  const delBefore = await panel(page)
    .getByRole("button", { name: "1文字消去", exact: true })
    .boundingBox();

  await press(page, ["データ型を選ぶ"]);

  const typeBox = await face(page, "データ型のキー").boundingBox();
  const delAfter = await panel(page)
    .getByRole("button", { name: "1文字消去", exact: true })
    .boundingBox();

  expect(
    Math.abs((typeBox?.height ?? 0) - (numberBox?.height ?? 0)),
  ).toBeLessThan(1);
  expect(Math.abs((delAfter?.x ?? 0) - (delBefore?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((delAfter?.y ?? 0) - (delBefore?.y ?? 0))).toBeLessThan(1);
});

test("the unit keys open only when the entry can take them", async ({
  page,
}) => {
  const k = panel(page).getByRole("button", { name: "千", exact: true });
  const m = panel(page).getByRole("button", { name: "百万", exact: true });
  const g = panel(page).getByRole("button", { name: "十億", exact: true });

  // 数字が無いうちは押せない(設計書 §4)。
  await expect(m).toBeDisabled();
  await press(page, ["1", "0", "0"]);
  await expect(m).toBeEnabled();

  // 百万 のあとに 十億 は無い——単位は下る向きにしか置けない。
  await press(page, ["百万"]);
  await expect(g).toBeDisabled();
  await expect(m).toBeDisabled();
  // 下る向きの 千 は、数字を打てば開く。
  await expect(k).toBeDisabled();
  await press(page, ["5"]);
  await expect(k).toBeEnabled();
});

test("the type face has nothing for DEL to delete", async ({ page }) => {
  await press(page, ["データ型を選ぶ"]);
  await expect(
    panel(page).getByRole("button", { name: "1文字消去", exact: true }),
  ).toBeDisabled();
  // 単位キーは型面に無い。
  await expect(
    panel(page).getByRole("button", { name: "百万", exact: true }),
  ).toHaveCount(0);
});

test("AC returns the type to its default without touching the numbers", async ({
  page,
}) => {
  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await press(page, ["データ型を選ぶ", "int64", "この項目を消去"]);

  await expect(
    panel(page).getByRole("button", { name: "float32", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // 件数はそのまま——AC は打っている項目だけを戻す(設計書 §5)。
  await press(page, ["件数を入力"]);
  await expect(echo(page)).toHaveText("件数 100M");
});

test("the primary-system toggle changes the emphasis, not the bytes", async ({
  page,
}) => {
  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await press(page, ["次元数を入力", "7", "6", "8"]);
  await expect(page.getByTestId("display-main")).toHaveText("307.2 GB");
  await expect(result(page)).toContainText("307,200,000,000 bytes");

  await panel(page)
    .getByRole("button", { name: "2 進 (KiB) を主に", exact: true })
    .click();

  await expect(page.getByTestId("display-main")).toHaveText("286.1 GiB");
  // bytes は動かない。両方の単位系が出ることも変わらない(base-spec §17)。
  await expect(result(page)).toContainText("307,200,000,000 bytes");
  await expect(result(page)).toContainText("307.2 GB");
  await expect(page.getByTestId("datascale-primary")).toHaveText(
    "2 進を主表示",
  );
});
