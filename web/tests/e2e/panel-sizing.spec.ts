import { expect, type Page, test } from "./fixtures";

/**
 * **盤面の横幅と、カテゴリの器の横幅。**
 *
 * どちらもユーザーが 0.3.0 を実機で見て出した指摘である（2026-08-20）。
 *
 * 1. **Scale の電卓が他より小さい。** `.panel` に `width: 100%` が無いと、
 *    `margin: 0 auto` が flex の交差軸で stretch を止め、盤面が**中身の
 *    max-content まで縮む**（`UnitPanel.module.css` に U-2 が書き残した
 *    のと同じ壊れ方）。390px の実測で Data Scale は 292px・キー 52px、
 *    データ転送は 360px・キー 66px と、Finance / Convert の 366px・67px より
 *    痩せていた。
 * 2. **カテゴリの `<select>` が PC・タブレットで横一杯に広がる。** 器
 *    （`.scale` / `.convert`）に `max-width` が無く、1280px の画面では
 *    select が 1280px の帯になっていた（実測）。
 *
 * **どちらもテストは全緑のまま起きた。** 幅は「他の面と並べて初めて分かる」
 * ——1 つの面だけを見ても、それが痩せているとは分からない。だから
 * **この検査は面をまたいで突き合わせる。**
 */

/** 盤面を持つ 6 route。**LLM は既定が候補面**なので、面の名前ではなく
 * 「最初の `<fieldset>`」で測る——どの面が出ていても、区画の幅は盤面の
 * 中身の幅と同じである。 */
const ROUTES = [
  ["#scientific", "Scientific"],
  ["#convert/length", "Convert 長さ"],
  ["#scale/data-scale", "Data Scale"],
  ["#scale/llm", "LLM のメモリ"],
  ["#scale/transfer", "データ転送"],
  ["#finance", "Finance"],
] as const;

/** カテゴリの `<select>` を持つ 2 route。 */
const WITH_SELECT = [
  ["#scale/data-scale", "Scale"],
  ["#convert/length", "Convert"],
] as const;

async function widthOfBoard(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId("display-main")).toBeVisible();
  const box = await page.locator("main fieldset").first().boundingBox();
  return Math.round(box?.width ?? -1);
}

test("every calculator is the same width", async ({ page }) => {
  const seen: { name: string; width: number }[] = [];
  for (const [hash, name] of ROUTES) {
    seen.push({ name, width: await widthOfBoard(page, hash) });
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(6);
  const widths = new Set(seen.map((s) => s.width));
  expect(widths.size, `boards differ in width: ${JSON.stringify(seen)}`).toBe(
    1,
  );
  // **痩せていないことまで言う。** 全部が同じ幅でも、全部が細ければ
  // この検査は緑になる。390px − padding 24px = 366px が満杯である。
  expect([...widths][0], `boards are ${[...widths][0]}px wide`).toBe(366);
});

test("the keys of every calculator hold the same size", async ({ page }) => {
  // **幅が同じでもキーが小さいことはある**（格子の列数が違えば）。
  // 5 列の数字面を持つ 4 route で、キーの最小辺を突き合わせる。
  const seen: { name: string; side: number }[] = [];
  for (const [hash, name] of [
    ["#convert/length", "Convert 長さ"],
    ["#scale/data-scale", "Data Scale"],
    ["#scale/transfer", "データ転送"],
    ["#finance", "Finance"],
  ] as const) {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId("display-main")).toBeVisible();
    const box = await page
      .getByRole("group", { name: "数字と演算のキー" })
      .getByRole("button", { name: "7", exact: true })
      .boundingBox();
    seen.push({
      name,
      side: Math.round(Math.min(box?.width ?? -1, box?.height ?? -1)),
    });
  }
  expect(seen).toHaveLength(4);
  expect(
    new Set(seen.map((s) => s.side)).size,
    `keys differ in size: ${JSON.stringify(seen)}`,
  ).toBe(1);
  // 実測 66.81px（390px 幅、5 列、gap 8px）。**44px を大きく上回る側**で
  // 揃っていること——Data Scale は 52px、データ転送は 66px だった。
  expect(seen[0]?.side).toBe(67);
});

for (const [hash, name] of WITH_SELECT) {
  test(`${name} の カテゴリは盤面と同じ幅で、画面幅では伸びない`, async ({
    page,
  }) => {
    // **広い画面で測る。** 390px では器の幅も画面の幅も同じなので、
    // 「画面いっぱいに広がる」バグはモバイルの viewport では見えない
    // ——ユーザーが見たのは PC とタブレットである。
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/${hash}`);
      await expect(page.getByTestId("display-main")).toBeVisible();

      const select = await page
        .getByRole("combobox", { name: "計算の種類" })
        .boundingBox();
      const board = await page.locator("main fieldset").first().boundingBox();

      expect(
        Math.round(select?.width ?? -1),
        `${name} at ${width}px: select ${select?.width}, board ${board?.width}`,
      ).toBe(Math.round(board?.width ?? -2));
      // 左端も揃う。幅だけ合わせて位置がずれると、揃って見えない。
      expect(Math.round(select?.x ?? -1)).toBe(Math.round(board?.x ?? -2));
      // 44px は譲らない（base-spec §43）。
      expect(select?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}

test("the category names carry both scripts", async ({ page }) => {
  // **日英を併記する**（U-0 §9 の【変更 2026-08-20】）。日本語だけに戻すと、
  // Convert の `データ量`（単位換算）と Scale の `データ量`（規模の計算）が
  // **画面上で同じ名前**になる——英語だけがこの 2 つを分けている。
  await page.goto("/#convert/data-size");
  const convert = page.getByRole("combobox", { name: "計算の種類" });
  await expect(convert).toHaveValue("data-size");
  await expect(convert.locator("option:checked")).toHaveText(
    "データ量 Data Size",
  );

  await page.goto("/#scale/data-scale");
  const scale = page.getByRole("combobox", { name: "計算の種類" });
  await expect(scale).toHaveValue("data-scale");
  await expect(scale.locator("option:checked")).toHaveText(
    "データ量 Data Scale",
  );
});
