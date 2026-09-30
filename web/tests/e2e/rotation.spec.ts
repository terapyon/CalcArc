import { expect, test } from "./fixtures";

/**
 * **横にして戻したとき、縦持ちの見え方が元どおりであること。**
 *
 * **利用者の実機の指摘（2026-09-30）**: 「**横位置から縦位置に戻ると、10 キーの
 * 高さが詰まってしまいます**」。**Scientific で起き、Convert では起きない**
 * ——**利用者の観察**で、**これがいちばん強い手がかり**である（あの 2 つの違いは
 * 器の入れ子で、それは「10 キーの大きさが面で違う」原因と同じ所にある）。
 *
 * **★ この検査は Chromium では赤くならない**（2026-09-30 実測）。
 * **`390×844` / `375×667` / `390×664` / `430×932` の 4 つで、行きと帰りが
 * 1px も違わなかった**（キーも器も）。**だから、いまの証拠は実機の証言だけ**である。
 * **それでも置くのは、直しのあとに「同じままだ」と言える場所が要るから**であり、
 * **iOS でだけ起きるなら、ここは緑のまま**——**そのときは実機で確かめ直す。**
 */
for (const hash of ["#scientific", "#convert/length"]) {
  test(`${hash} looks the same after a round trip through landscape`, async ({
    page,
  }) => {
    const read = async () =>
      await page.evaluate(() => {
        const round = (x: number) => Math.round(x * 10) / 10;
        const key = document
          .querySelector("[data-square] button")
          ?.getBoundingClientRect();
        const square = document
          .querySelector("[data-square]")
          ?.getBoundingClientRect();
        const board = document
          .querySelector("[data-board]")
          ?.getBoundingClientRect();
        const main = document.querySelector("main")?.getBoundingClientRect();
        const size = (r: DOMRect | undefined) =>
          r === undefined ? "-" : `${round(r.width)}x${round(r.height)}`;
        return {
          key: size(key),
          square: size(square),
          board: size(board),
          main: size(main),
        };
      });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${hash}`);
    await expect(page.locator("main button").first()).toBeVisible();
    const before = await read();
    // **0 件で緑にしない。** 盤面が読めていなければ、下の比較は何も言わない。
    expect(before.key, "縦持ちで 10 キーが読めない").not.toBe("-");

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("main button").first()).toBeVisible();
    const landscape = await read();
    // **横では別の姿になる**——ここが同じなら、段が当たっていない。
    expect(landscape.key, "横向きで姿が変わっていない").not.toBe(before.key);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("main button").first()).toBeVisible();
    const after = await read();

    expect(after, `${hash} の縦持ちが、横を経て変わった`).toEqual(before);
  });
}
