import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "単位変換" });
const echo = (page: Page) => page.getByTestId("display-entry-active");
const main = (page: Page) => page.getByTestId("display-main");

/** 測れなかったことの印。相対座標は負にもなるので `-1` では代用できない。 */
const UNMEASURED = "unmeasured";

/**
 * Convert の全カテゴリ。**U-1 の 3 つ + U-2 の 4 つ**(spec §2)。
 * `web/src/convert/types.ts` の `CONVERT_CATEGORY_TOKENS` と同じ並びだが、
 * **E2E は境界の定数を import しない**——実ブラウザに出ている面を、
 * 外から名前で数えるのがこのファイルの仕事である。
 */
const CATEGORIES = [
  "length",
  "mass",
  "temperature",
  "area",
  "volume",
  "speed",
  "data-size",
] as const;

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
 * 行数は `ceil(単位数 / 3)`、総数は 行数 × 5:
 *
 * | カテゴリ | 単位数 | 行 | キー総数 |
 * |---|---|---|---|
 * | length | 11 | 4 | 20 |
 * | mass | 7 | 3 | 15 |
 * | temperature | 3 | 1 | 5 |
 * | area | 11 | 4 | 20 |
 * | volume | **15** | **5** | **25** |
 * | speed | 4 | 2 | 10 |
 * | data-size | 12 | 4 | 20 |
 *
 * **Volume の 5 行が枠の容量そのものである**(U-2 spec §0.0-4 の【訂正
 * 2026-08-20】)。16 個目を足すと 6 行になり、`swapping faces moves neither
 * the frame nor DEL and AC` が赤くなる。
 *
 * **件数のハードコードはここと `every category has a deep link` の 2 箇所に
 * ある。** 片方だけ直すともう片方が緑のまま古い件数を主張し続ける。
 */
const FACES = [
  ["length", "数字と演算のキー", "値を入力", 25],
  ["length", "単位のキー", "変換元の単位を選ぶ", 20],
  ["mass", "単位のキー", "変換元の単位を選ぶ", 15],
  ["temperature", "単位のキー", "変換元の単位を選ぶ", 5],
  ["area", "単位のキー", "変換元の単位を選ぶ", 20],
  ["volume", "単位のキー", "変換元の単位を選ぶ", 25],
  ["speed", "単位のキー", "変換元の単位を選ぶ", 10],
  ["data-size", "単位のキー", "変換元の単位を選ぶ", 20],
] as const;

test("every face keeps 44px touch targets", async ({ page }) => {
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

test("the panel does not shrink to its own max-content width", async ({
  page,
}) => {
  // レビュー(round 1, Important 2b)の実測: `.panel { width: 100% }`
  // (`UnitPanel.module.css`)を外すと、390px の画面で盤面は 252px・面は
  // 252×252・キーは 44×44 ちょうどまで縮む——既存の 44px 検査
  // (`toBeGreaterThanOrEqual(44)`)はこれを素通りする。`width: 100%` が
  // 効いていれば ~366px になる(同じ CSS のコメントにある Transfer 360 /
  // Finance 366 と同じ桁)ので、実測の 252px と 366px のあいだの 300px を
  // 下限に選ぶ——max-content まで縮めば確実に赤くなり、正しい寸法では
  // 確実に緑になる。
  await page.goto("/#convert/length");
  await expect(panel(page)).toBeVisible();
  const box = await face_(page, "数字と演算のキー").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(300);
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
  // いちばん派手に潰れる面**である。逆に **volume は 15 単位 5 行で枠の容量
  // ちょうど**——**枠のあふれを見張っているのはこの検査 1 本だけ**なので
  // (U-2 spec §0.0-4 の【訂正 2026-08-20】)、**7 カテゴリぶん回る**。
  // 単位面の名前はカテゴリで変わらないため、新しい 4 つも同じ区画名で拾える。
  //
  // **volume だけを回しても潰れは見えない**(実測 2026-08-20、CSS の区画名を
  // 1 文字ずらして計測)。5 行ちょうどの volume は `grid-template-rows` を
  // 失っても 366x366.0625 のままで、**数字面と区別がつかない**——潰れを
  // 見せたのは temperature 366x66.8125 / speed 366x141.625 /
  // area・data-size 366x291.25 のほうである。**容量いっぱいの面は、
  // あふれの番人にはなれても潰れの番人にはならない。**
  //
  // **DEL と AC は枠からの相対座標で測る。** 主張は「**盤面の中で DEL が
  // 動かない**」であって、**盤面より上にある表示行の高さを巻き込むのは
  // 測り間違い**である——その行高はフォント環境で変わる。枠を原点に取れば、
  // 盤面の中で動いたかどうかだけが残る。
  const rel = (
    b: { x: number; y: number } | null,
    frame: { x: number; y: number } | null,
  ) => (b && frame ? `${b.x - frame.x},${b.y - frame.y}` : UNMEASURED);
  const seen: {
    where: string;
    box: { width: number; height: number };
    del: string;
    ac: string;
  }[] = [];
  for (const category of CATEGORIES) {
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
        del: rel(del, box),
        ac: rel(ac, box),
      });
    }
  }
  expect(seen).toHaveLength(CATEGORIES.length * 2);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => s.del));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  const acs = new Set(seen.map((s) => s.ac));
  expect(acs.size, `AC moved: ${JSON.stringify(seen)}`).toBe(1);
  // **番兵は 3 つとも置く**——計測できなかったときの `0` / `UNMEASURED` は
  // 1 通りに揃うので、**上の 3 つの `Set` は測れていなくても緑になる**。
  // S-0 では `ac` の 1 行が落ちていた。
  expect(seen[0]?.box.width, "the frame was never measured").toBeGreaterThan(0);
  expect(seen[0]?.del, "DEL was never measured").not.toBe(UNMEASURED);
  expect(seen[0]?.ac, "AC was never measured").not.toBe(UNMEASURED);
});

test("every category has a deep link that lands on it", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "計算の種類" });
  const seen: string[] = [];
  for (const category of CATEGORIES) {
    await page.goto(`/#convert/${category}`);
    await expect(select).toHaveValue(category);
    // **select の値だけでなく、そのカテゴリでしか出ない面まで見る。**
    // 名前だけの select が動いていても、パネルの分岐は 1 度も観測されない、
    // という穴を防ぐ。
    await expect(panel(page)).toBeVisible();
    await press(page, ["変換元の単位を選ぶ"]);
    const units = await face_(page, "単位のキー").getByRole("button").all();
    // **件数のハードコードの 2 箇所目。** 上の `FACES` と同じ表を持って
    // いるので、**カテゴリを足したら両方直す**——片方だけだと、直さなかった
    // ほうが古い件数のまま緑を返し続ける。
    expect(units, `${category} should render its own unit face`).toHaveLength(
      {
        length: 20,
        mass: 15,
        temperature: 5,
        area: 20,
        volume: 25,
        speed: 10,
        "data-size": 20,
      }[category],
    );
    seen.push(category);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(CATEGORIES.length);
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
