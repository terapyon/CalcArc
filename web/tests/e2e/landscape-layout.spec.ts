import { PROMISED_URLS } from "../promised-urls";
import { expect, type Page, test } from "./fixtures";
import { LANDSCAPE_VIEWPORTS } from "./widths";

/**
 * **横向きでは、表示欄と関数が左・5×5 が右に並ぶ**（1.1.0、設計書
 * `docs/superpowers/specs/2026-09-30-landscape-layout-design.md`）。
 *
 * **それまでは、積んだままの配置が縦に 831px あった**——**844×390 の画面に対して
 * 441px 溢れる**（2026-09-30 の実測。`68 + 12 + 154.2 + 12 + 34 + 8 + 34 + 8 +
 * 456.1 + 12 + 33 = 831.3`）。**横にすると、下のキーはスクロールしないと出なかった。**
 *
 * **★「1 画面に収まる」はホーム画面から開いたときに限る**（設計書 §2.2.1）。
 * **Safari のタブでは iPhone 13 横が `750×342`** で、**床の 44px を守ったまま
 * `377 > 342`** ——**35px スクロールする。** **タブの寸法は
 * `short-screens.spec.ts` が「スクロールすれば全部に届く」側で見る。**
 */
/** タブレットを横にした寸法。**ここも横向きの段に入る**（幅 ≥ 660・高さ ≤ 840）。 */
const TABLET_LANDSCAPE = [
  { device: "iPad landscape", width: 1024, height: 768 },
  { device: "iPad Air landscape", width: 1180, height: 820 },
] as const;

/** `main` の中のキーの箱を、区画のラベルつきで取る。 */
const keyBoxes = (page: Page) =>
  page.locator("main button").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const section = el.closest("fieldset")?.getAttribute("aria-label") ?? "";
      return { section, w: r.width, h: r.height, x: r.x, y: r.y };
    }),
  );

for (const size of LANDSCAPE_VIEWPORTS) {
  test(`the whole board fits on one screen at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    // **番人 #1。** **横にも縦にもはみ出さない。**
    const spill = await page.evaluate(() => ({
      sideways:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      down:
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    }));
    expect(spill.sideways, "横にはみ出す量").toBeLessThanOrEqual(0);
    expect(spill.down, "縦にはみ出す量").toBeLessThanOrEqual(0);
  });

  test(`the keys keep the 44px floor at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    // **番人 #2。** **幅は全部のキーが 44px を割らない。**
    //
    // **★ 高さは正方の区画だけを見る**（2026-09-30、現物に当てて直した）。
    // **半高の関数列は 34px である**——`Keypad.module.css` の `.half > button` が
    // `--function-row-height`（`tokens.css` の `34px`）を当てており、
    // **縦持ちでも同じ**である（「縦だけ詰め、横は 44px 以上を保つ」、S1 設計書 §4）。
    // **設計書 §4 の表は「幅・高さとも」と書いているが、それは既存の仕様と
    // 食い違う**——**横向きで関数列を 44px に育てるのは別の裁定**である
    // （左の段には余りが在るので、やろうと思えばできる）。**監視役に上げた。**
    // **`viewport-budget.spec.ts` と `wide-layout.spec.ts` も幅だけを見ている。**
    const boxes = await keyBoxes(page);
    // **0 件で緑にしない。** Scientific は 7 + 7 + 25 = 39。
    expect(boxes.length, "見たキーの数").toBeGreaterThanOrEqual(39);
    const narrow = boxes.filter((b) => b.w < 44);
    expect(narrow, `44px より細いキー: ${JSON.stringify(narrow)}`).toEqual([]);
    const squares = boxes.filter((b) => b.section === "数字と演算のキー");
    expect(squares.length, "5×5 のキーの数").toBe(25);
    const short = squares.filter((b) => b.h < 44);
    expect(short, `44px より低い 5×5 のキー: ${JSON.stringify(short)}`).toEqual(
      [],
    );
  });

  test(`the display and the functions sit left of the 5x5 at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    // **番人 #3。** **箱の座標で見る**——「左に在る」を CSS の綴りで確かめると、
    // **段が当たっていない日も緑になる。**
    const box = async (label: string) => {
      const found = await page
        .getByRole("group", { name: label })
        .boundingBox();
      expect(found, `${label} が見つからない`).not.toBeNull();
      return found ?? { x: 0, y: 0, width: 0, height: 0 };
    };
    const readout = await page.getByTestId("display-main").boundingBox();
    expect(readout, "表示欄が見つからない").not.toBeNull();
    const functions = await box("関数キー");
    const second = await box("第 2 関数列");
    const digits = await box("数字と演算のキー");

    const rightEdge = (b: { x: number; width: number }) => b.x + b.width;
    expect(rightEdge(functions), "関数キーの右端").toBeLessThanOrEqual(
      digits.x,
    );
    expect(rightEdge(second), "第 2 関数列の右端").toBeLessThanOrEqual(
      digits.x,
    );
    expect(
      rightEdge(readout ?? { x: 0, width: 0 }),
      "表示欄の右端",
    ).toBeLessThanOrEqual(digits.x);
  });

  test(`the landmarks and the sections stay reachable by role at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    // **番人 #5。** **`display: contents` が読み上げの木に何をするかは、
    // 私たちが確かめていない**（設計書 §6）。**確かめてから書く。**
    // **当てる相手は `div.keypad` だけ**——**区画の `fieldset` に当てると、
    // ブラウザによって group が消える**（設計書 §2.3 の註）。
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();
    for (const label of ["関数キー", "第 2 関数列", "数字と演算のキー"]) {
      await expect(
        page.getByRole("group", { name: label }),
        `${label} が group として引けない`,
      ).toBeVisible();
    }
  });
}

for (const size of TABLET_LANDSCAPE) {
  test(`the keys keep the 88px ceiling at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    // **番人 #2b。** **素の `1fr` で行を伸ばすと、iPad の横向きでキーは 122px**
    // になる（`(768 − 68 − 33 − 24 − 32) ÷ 5`）——**1.1 で置いた天井 88px が
    // 横向きで消える。** **1.1 と同じ「等しい」で撃つ。**
    const boxes = await keyBoxes(page);
    expect(boxes.length, "見たキーの数").toBeGreaterThanOrEqual(39);
    const square = boxes.filter((b) => Math.round(b.h) === Math.round(b.w));
    expect(square.length, "正方のキーの数").toBeGreaterThanOrEqual(25);
    const sides = [...new Set(square.map((b) => Math.round(b.w)))];
    expect(sides, `正方のキーの幅: ${JSON.stringify(sides)}`).toEqual([88]);
  });
}

/**
 * **10 キー部を持つ面は、どれも横向きで 2 列になる**（**利用者の裁定 2026-09-30**
 * ——「**横にしたときには基本的に、10 キー部の 5×5 だけが右側に来るのが良い**」）。
 *
 * **`844×390` では、どの面も 1 画面に収まる**（2026-09-30 実測）。
 * **`667×375`（SE の横）は別**——**単位換算とスケールが 6px、金融が 15px
 * スクロールする**ので、**そちらは `short-screens.spec.ts` が
 * 「スクロールすれば全部に届く」側で見る。** **この番人は `844×390` を撃つ。**
 *
 * **5×5 を持たない面は積んだまま**である（`#scale/llm`。候補キーが 5 列 25 キー
 * ではない）——**右が空の 2 列にしない**、という裁定の裏返しである。
 */
test("every board with a 5x5 splits, and fits at 844x390", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  let split = 0;
  let stacked = 0;
  for (const { hash } of PROMISED_URLS) {
    if (hash === "#manual") continue;
    await page.goto(`/${hash}`);
    await expect(page.locator("main button").first()).toBeVisible();
    const seen = await page.evaluate(() => {
      const square = document.querySelector("[data-square]");
      if (square === null) return { square: false, over: 0, leftOf: true };
      const right = square.getBoundingClientRect();
      const others = [...document.querySelectorAll("[data-board] *")].filter(
        (el) =>
          el !== square &&
          !square.contains(el) &&
          el.getBoundingClientRect().width > 0 &&
          getComputedStyle(el).position !== "fixed",
      );
      return {
        square: true,
        over:
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight,
        // **箱の座標で見る**——CSS の綴りで確かめると、段が当たっていない日も緑になる。
        leftOf: others.every(
          (el) => el.getBoundingClientRect().left < right.right,
        ),
      };
    });
    if (seen.square) {
      split += 1;
      expect(seen.over, `${hash} が縦にはみ出す量`).toBeLessThanOrEqual(0);
      expect(seen.leftOf, `${hash} で 5×5 より右に何かが在る`).toBe(true);
    } else {
      stacked += 1;
    }
  }
  // **0 件で緑にしない。** 13 画面のうち 12 が 5×5 を持ち、`#scale/llm` だけ持たない。
  expect(split, "2 列になった面の数").toBe(12);
  expect(stacked, "積んだままの面の数").toBe(1);
});
