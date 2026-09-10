import { writeFileSync } from "node:fs";
import { expect, test } from "../e2e/fixtures";
import { imageFile } from "./images";
import { applyPinnedFont, provePinnedFont } from "./pinned-font";
import { FOOTER, formatScreenText, openShot, screenLines } from "./screen-text";
import { SHOTS } from "./shots";

/**
 * **撮影。E2E ではない。** `pnpm shots`(`playwright.shots.config.ts`)だけが
 * 回す。`playwright.config.ts` の `testDir` は `tests/e2e` で、vitest は
 * `*.test.ts` しか拾わないので、どちらもこのファイルを見ない。
 *
 * 1 枚ごとに: 画面を開く → キーを押す → 書体を当てる → **当たったことを
 * 確かめる** → 写真と文字を書く。**確かめが落ちたら何も書かない**
 * (いまの写真を豆腐の写真で上書きしない)。
 *
 * **`fixtures` の `test` を使う**——レートの取得先を塞いだ既定に乗る。
 * マニュアルの写真で `#convert/currency` を撮る日に、本物へ出ない。
 */
for (const shot of SHOTS) {
  test(shot.name, async ({ page }) => {
    // マニュアルの写真はリポジトリに置かない(設計書 §3)。置き場
    // (PDF を作る走行の中)は計画の T4 で決める——**それまでは黙って
    // どこかに書かず、落ちる。**
    if (shot.use !== "readme") {
      throw new Error(`${shot.name}: no place for manual shots yet (plan T4)`);
    }

    await openShot(page, shot);
    await applyPinnedFont(page);
    await provePinnedFont(page);
    const lines = await screenLines(page);

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width, "the page spills sideways").toBeLessThanOrEqual(
      viewport.width,
    );
    // **フッタの上端で切る**(設計書 §1)。
    const footer = await page.locator(FOOTER).boundingBox();
    if (footer === null) throw new Error("no footer to clip at");
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: viewport.width, height: Math.floor(footer.y) },
      fullPage: true,
      animations: "disabled",
    });

    writeFileSync(imageFile(shot.name, "png"), png);
    writeFileSync(imageFile(shot.name, "txt"), formatScreenText(lines));
  });
}
