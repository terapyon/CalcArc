import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "単位変換" });
const echo = (page: Page) => page.getByTestId("display-entry-active");
const main = (page: Page) => page.getByTestId("display-main");

async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

/**
 * いま出ている面の区画。**単位面の名前はカテゴリで変わらない**
 * (`Keypad/convert.ts` の `unitFace`)——変換元と変換先で同じ面が出る。
 */
const face_ = (page: Page, name: "数字と演算のキー" | "単位のキー") =>
  panel(page).getByRole("group", { name });

/**
 * 面ごとのキー総数。**予約スロットも disabled な `<button>` として描かれる**
 * ので、面の総数はキー配列の長さと一致する。単位面は 5 列 × (3 単位/行) で、
 * length 11 単位 → 4 行 = 20、mass 8 単位 → 3 行 = 15、temperature 3 単位 →
 * 1 行 = 5。
 */
const FACES = [
  ["length", "数字と演算のキー", "値を入力", 25],
  ["length", "単位のキー", "変換元の単位を選ぶ", 20],
  ["temperature", "単位のキー", "変換元の単位を選ぶ", 5],
] as const;

test("all three faces keep 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**単位の押し間違いは答えを
  // 壊す**ので、メインの枠に載る面はどれも守る(項目行だけは押し直せば
  // 戻るので縦を詰める——下の別の検査が幅だけを見る)。
  //
  // **測ったキーの件数も主張する**——ループが 0 周でも緑になる書き方はしない。
  let measured = 0;
  for (const [category, faceName, field, expectedCount] of FACES) {
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, [field]);
    const buttons = await face_(page, faceName).getByRole("button").all();
    expect(
      buttons,
      `${category}/${faceName} should render its full key set`,
    ).toHaveLength(expectedCount);
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      measured += 1;
    }
  }
  // **件数の下限も主張する。** 面の綴りが変わって 0 件になった日から、
  // この検査が何も測らないまま緑を返し続けるのを止める。
  expect(measured).toBe(FACES.reduce((sum, [, , , n]) => sum + n, 0));
  expect(measured, "no key was ever measured").toBeGreaterThan(0);
});

test("the swap key is wide enough even though the field row is half height", async ({
  page,
}) => {
  // **⇅ は幅を測る。** 項目行は `height: "half"`(`Keypad/convert.ts` の
  // `FIELDS`)で、実測 86 × 34 である——高さ 44px を要求すると項目行の
  // 縦の予算を変える話になり、`data-scale-keypad.spec.ts:53-62` が
  // 「幅 ≥ 44、高さ < 44」を明示的に主張している既存の規律と衝突する。
  await page.goto("/#convert/length");
  await expect(panel(page)).toBeVisible();
  const row = panel(page).getByRole("group", { name: "入力する項目" });
  const buttons = await row.getByRole("button").all();
  // 値 / 変換元 / 変換先 / ⇅ の 4 つ。
  expect(buttons, "the field row should render its 4 cells").toHaveLength(4);
  const swap = await panel(page)
    .getByRole("button", { name: "変換元と変換先を入れ替える", exact: true })
    .boundingBox();
  expect(swap?.width ?? 0).toBeGreaterThanOrEqual(44);
  // **番兵**: 測れていなければ -1 になり、`< 44` を素通りしない。
  expect(swap?.height ?? -1).toBeGreaterThanOrEqual(0);
  expect(swap?.height ?? -1).toBeLessThan(44);
});

test("swapping faces moves neither the frame nor DEL and AC", async ({
  page,
}) => {
  // **数字面と単位面は同じ枠に載る**(`UnitPanel.module.css`)。実測: この
  // 区画名を 1 文字変えると **vitest は緑のまま**で(jsdom は CSS Modules も
  // レイアウトも見ない)、実ブラウザでは数字面が 366x366 のまま単位面が
  // length 366x291 / mass 366x216 / **temperature 366x67** に潰れ、面を
  // 入れ替えるたびに縦が最大 299px 動く。**この壊れ方を機械で見張るのは
  // この検査だけである。**
  //
  // 温度は単位面が 1 行(3 単位)しか無く、**枠が中身の行数で決まっていたら
  // いちばん派手に潰れる面**なので、3 カテゴリぶん回る。
  const seen: {
    where: string;
    box: { width: number; height: number };
    del: { x: number; y: number };
    ac: { x: number; y: number };
  }[] = [];
  for (const category of ["length", "mass", "temperature"] as const) {
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    for (const [field, faceName] of [
      ["値を入力", "数字と演算のキー"],
      ["変換元の単位を選ぶ", "単位のキー"],
    ] as const) {
      await press(page, [field]);
      const box = await face_(page, faceName).boundingBox();
      const del = await panel(page)
        .getByRole("button", { name: "1文字消去", exact: true })
        .boundingBox();
      const ac = await panel(page)
        .getByRole("button", { name: "この項目を消去", exact: true })
        .boundingBox();
      seen.push({
        where: `${category}/${faceName}`,
        box: { width: box?.width ?? 0, height: box?.height ?? 0 },
        // **DEL と AC の位置も控える。** 在ることではなく**動かないこと**
        // を測る。
        del: { x: del?.x ?? -1, y: del?.y ?? -1 },
        ac: { x: ac?.x ?? -1, y: ac?.y ?? -1 },
      });
    }
  }
  expect(seen).toHaveLength(6);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => `${s.del.x},${s.del.y}`));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  const acs = new Set(seen.map((s) => `${s.ac.x},${s.ac.y}`));
  expect(acs.size, `AC moved: ${JSON.stringify(seen)}`).toBe(1);
  // **番兵は 3 つとも置く**——計測できなかったときの `-1` は 1 通りに
  // 揃うので、**上の 3 つの `Set` は測れていなくても緑になる**。
  // S-0 では `ac` の 1 行が落ちていた。
  expect(seen[0]?.box.width, "the frame was never measured").toBeGreaterThan(0);
  expect(seen[0]?.del.x, "DEL was never measured").toBeGreaterThanOrEqual(0);
  expect(seen[0]?.ac.x, "AC was never measured").toBeGreaterThanOrEqual(0);
});

test("every category has a deep link that lands on it", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "計算の種類" });
  const seen: string[] = [];
  for (const category of ["length", "mass", "temperature"] as const) {
    await page.goto(`/#convert/${category}`);
    await expect(select).toHaveValue(category);
    // **select の値だけでなく、そのカテゴリでしか出ない面まで見る。**
    // 名前だけの select が動いていても、パネルの分岐は 1 度も観測されない、
    // という穴を防ぐ。
    await expect(panel(page)).toBeVisible();
    await press(page, ["変換元の単位を選ぶ"]);
    const units = await face_(page, "単位のキー").getByRole("button").all();
    expect(units, `${category} should render its own unit face`).toHaveLength(
      { length: 20, mass: 15, temperature: 5 }[category],
    );
    seen.push(category);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(3);
});

test("the Convert tab lands on #convert/length", async ({ page }) => {
  // **`convert-placeholder.spec.ts` から引き取った被覆。** タブの行き先を
  // 見ていたのはあのファイルだけで、`nav.spec.ts` は見ていない(実測)。
  // 既定カテゴリまで href に書く規律(設計書 §3)を、実ブラウザで守らせる。
  await page.goto("/#scientific");
  await page.getByRole("link", { name: "Convert", exact: true }).click();
  await expect(page).toHaveURL(/#convert\/length$/);
  await expect(panel(page)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Convert", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("types the fixed point of the two temperature scales", async ({
  page,
}) => {
  // **spec §6 が名指しした不動点を、実ブラウザで 1 件。** vitest の同名検査
  // はモックの算数を通るだけなので、**符号が実際に境界を越えて core へ届く**
  // ことはここでしか見えない(計画の裁定 3)。
  await page.goto("/#convert/temperature");
  await expect(panel(page)).toBeVisible();
  await press(page, ["符号を変える", "4", "0"]);
  await press(page, ["変換元の単位を選ぶ", "摂氏"]);
  await press(page, ["変換先の単位を選ぶ", "華氏"]);
  await expect(echo(page)).toHaveText("変換先 °F");
  await expect(main(page)).toHaveText("-40 °F");
  await expect(page.getByTestId("convert-result")).toHaveText(
    "-40 °C = -40 °F",
  );
});
