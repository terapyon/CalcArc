import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "../e2e/fixtures";
import { imageFile, MANUAL_SHOTS_DIR, manualShotFile } from "./images";
import { applyPinnedFont, provePinnedFont } from "./pinned-font";
import { FOOTER, formatScreenText, openShot, screenLines } from "./screen-text";
import { SHOTS } from "./shots";

/**
 * **撮影。E2E ではない。** `pnpm shots`(`playwright.shots.config.ts`)だけが
 * 回す。`playwright.config.ts` の `testDir` は `tests/e2e` で、vitest は
 * `*.test.ts` しか拾わないので、どちらもこのファイルを見ない。
 *
 * 1 枚ごとに: 画面を開く → キーを押す → 書体を当てる → **当たったことを
 * 確かめる** → 写真(README の写真なら文字も)を書く。**確かめが落ちたら
 * 何も書かない**(いまの写真を豆腐の写真で上書きしない)。
 *
 * **置き場は `use` で分ける**(`images.ts`)。README の写真は `docs/images/`
 * (追跡する)、マニュアルの写真は `web/manual-shots/`(追跡しない。
 * 設計書 §3、裁定 #1)。**フッタで切るのはどちらも同じ**——マニュアルの
 * 写真にも版数を写さない(PDF の名前が版数を持つ)。
 *
 * **`fixtures` の `test` を使う**——レートの取得先を塞いだ既定に乗る。
 * マニュアルの写真で `#convert/currency` を撮る日に、本物へ出ない。
 */
//
// **`use` を札(`@readme` / `@manual`)にする。** CI とリリースの `pnpm manuals` は
// `--grep @manual` でマニュアルの写真だけを撮る——README の写真は追跡する
// ファイルに書くので、runner で撮り直しても捨てるだけである。
for (const shot of SHOTS) {
  test(shot.name, { tag: `@${shot.use}` }, async ({ page }) => {
    await openShot(page, shot);
    await applyPinnedFont(page);
    await provePinnedFont(page);
    // 画面の文字は README の写真のためだけに取る(`images.ts` の
    // `MANUAL_SHOTS_DIR` の註)。
    const lines = shot.use === "readme" ? await screenLines(page) : null;

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width, "the page spills sideways").toBeLessThanOrEqual(
      viewport.width,
    );
    // **縦に長い画面は、先に窓を画面の高さまで伸ばす。** `fullPage` の撮影は
    // 窓を画面の高さに伸ばして撮るので、画面が組み直される——伸ばす前に
    // 測ったフッタの位置は、撮った写真の中の位置ではない。2026-09-10 に
    // `#scale/data-scale` で答えを出した画面(高さ 918px)を測ると、撮る前は
    // フッタの上端が 884.69px、撮ったあとは 869.69px で、**写真の下端 15px に
    // フッタ(版数)が写っていた。** README の 3 枚は 844px に収まるので
    // 伸ばさず、写真は変わらない。
    const tall = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    if (tall > viewport.height) {
      await page.setViewportSize({ width: viewport.width, height: tall });
    }
    // **フッタの上端で切る**(設計書 §1)。窓を伸ばしたあとで測る。
    const footer = await page.locator(FOOTER).boundingBox();
    if (footer === null) throw new Error("no footer to clip at");
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: viewport.width, height: Math.floor(footer.y) },
      fullPage: true,
      animations: "disabled",
    });
    // **撮ったあとにもう一度測る。** 撮るあいだに画面が組み直されていれば、
    // 切った位置はフッタの上端ではない——版数が写った写真を書かずに落ちる。
    const after = await page.locator(FOOTER).boundingBox();
    if (after === null || Math.floor(after.y) !== Math.floor(footer.y)) {
      throw new Error(
        `${shot.name}: the footer moved while shooting (${footer.y} → ${after?.y})`,
      );
    }

    if (lines === null) {
      mkdirSync(MANUAL_SHOTS_DIR, { recursive: true });
      writeFileSync(manualShotFile(shot.name), png);
      return;
    }
    writeFileSync(imageFile(shot.name, "png"), png);
    writeFileSync(imageFile(shot.name, "txt"), formatScreenText(lines));
  });
}
