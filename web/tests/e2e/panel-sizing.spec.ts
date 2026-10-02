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

/**
 * **10 キーの区画は、どの電卓でも同じ決まり方をする**（2026-10-03）。
 *
 * **利用者が実機で問うた**——「**10 キーの実装が二重化されているのでしょうか?
 * 表示する中身は別ですが、配置は同じだと思います**」。**そのとおりだった**:
 * **行の綴りは 4 か所、区画の正方は 3 か所に写されており**、
 * **正方のほうは Convert・Data Scale・Transfer にだけ在って、
 * 【Scientific】と【Finance】には無かった**——**箱の高さが確定していたのは
 * 3 面だけ**で、**残り 2 面の行は結局ボタンの `aspect-ratio` から決まっていた。**
 * **利用者が実機で「2 面だけ直っていない」と言った組と一致する**
 * （2026-10-03 に本人が確認——「**2 面は【Scientific】と【Finance】のはずです**」）。
 *
 * **上の 2 本は「寸法」を突き合わせる**が、**寸法が同じでも決まり方は違いうる**
 * ——**それがこの件だった。** **だからここは計算値（`aspect-ratio` と行の綴り）を
 * 突き合わせる。** **綴りが 1 か所であることは `tests/unit/keypad-layout-single-source.test.ts`
 * が別に数える**（**あちらは CSS を読む静的な番人、ここは効いた結果を見る**）。
 */
test("the ten-key block is decided the same way on every calculator", async ({
  page,
}) => {
  const seen: { name: string; decided: string; key: string }[] = [];
  // **【LLM のメモリ】は外す**——**あの面は既定が候補面で、10 キーの区画が
  // 出ていない**（2026-10-03 実測: `fieldset[aria-label="数字と演算のキー"]` が
  // `null`）。**あちらの CSS も写しを持っていた**ので同じ日に外したが、
  // **見張るのは静的な番人**（`tests/unit/keypad-layout-single-source.test.ts`）である。
  for (const [hash, name] of ROUTES.filter(
    ([route]) => route !== "#scale/llm",
  )) {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId("display-main")).toBeVisible();
    const got = await page.evaluate(() => {
      const square = document.querySelector(
        'fieldset[aria-label="数字と演算のキー"]',
      ) as HTMLElement | null;
      if (square === null) return null;
      const style = getComputedStyle(square);
      const round = (x: number) => Math.round(x * 10) / 10;
      // **★ 行は座標から起こす**（`rotation.spec.ts` と同じ形）。
      // **`gridTemplateRows` の綴りは engine で違う**——**Chromium は
      // 書いたまま（`repeat(5, 1fr)`）、WebKit は使用値の px（`66.796875px` ×5）**
      // を返す（2026-10-03、CI の WebKit だけが赤くなって分かった）。
      // **主張は「5 行が等間隔」であって、綴りではない。**
      const keys = [...square.querySelectorAll("button")].map((el) =>
        el.getBoundingClientRect(),
      );
      const tops = [
        ...new Set(keys.map((r) => Math.round(r.top * 10) / 10)),
      ].sort((a, b) => a - b);
      // **★ 見るのは「行の間隔」である**（**キーの高さではない**）。
      // **キーには `aspect-ratio: 1 / 1` が効いている**ので、**行の高さを変えても
      // キーの箱は正方のまま**——**`grid-template-rows: 80px repeat(4, 1fr)` の
      // 変異で緑のままだった**（2026-10-03。**最初はキーの高さを数えていた**）。
      const pitches = tops
        .slice(1)
        .map((top, index) => round(top - (tops[index] ?? 0)));
      const spread =
        pitches.length === 0
          ? 0
          : round(Math.max(...pitches) - Math.min(...pitches));
      const key = keys[0];
      return {
        // **`aspect-ratio` の綴りは両方の engine で `1 / 1`**（2026-10-03 実測）。
        decided: `aspect=${style.aspectRatio} rows=${tops.length}行 ${
          spread <= 0.5 ? "等間隔" : `不揃い(${spread}px)`
        }`,
        key: `${round(key?.width ?? -1)}x${round(key?.height ?? -1)}`,
      };
    });
    // **0 件で緑にしない。** 残り 5 route はどれも 10 キーの区画を持つ。
    expect(got, `${name} に 10 キーの区画が無い`).not.toBeNull();
    if (got !== null) seen.push({ name, ...got });
  }
  expect(seen, "見た面の数").toHaveLength(5);
  // **決まり方が 1 つの集合**——**直す前は `["aspect=auto …", "aspect=1 / 1 …"]`
  // の 2 つに割れていた**（2026-10-03 の赤）。
  //
  // **★ 計算値を期待値にするときは、engine と書体でどう変わりうるかを先に言う**
  // （2026-10-03 の教訓。**同じ形で 2 度落ちた**——**1 度目は書体**（通貨の案内が
  // 手元 72px / CI 66px）、**2 度目は engine**（`gridTemplateRows` の綴り）。
  // **変わりうるなら、意味に正規化してから撃つ。**
  expect(
    [...new Set(seen.map((s) => s.decided))],
    `決まり方が面でそろっていない: ${JSON.stringify(seen)}`,
  ).toHaveLength(1);
  // **正方であること**（**`auto` に揃っても「1 つの集合」は真**になるので、
  // **何に揃っているかまで言う**）。
  expect(seen[0]?.decided).toBe("aspect=1 / 1 rows=5行 等間隔");
  // **キーの寸法も 1 つの集合**（**上の 2 本は 4 route だけを見ている**）。
  expect(
    [...new Set(seen.map((s) => s.key))],
    `キーの寸法が面でそろっていない: ${JSON.stringify(seen)}`,
  ).toHaveLength(1);
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
