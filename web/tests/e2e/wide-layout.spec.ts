import { PROMISED_URLS } from "../promised-urls";
import { expect, test } from "./fixtures";
import { TABLET_VIEWPORTS } from "./widths";

/**
 * **広い画面で、盤面が使える形のまま広がる**（1.1、設計 §2.2・§2.3）。
 *
 * 1.0 までの枠は 480px 止まりで、**844px の幅でも盤面は中央の 470px しか
 * 使っていなかった**。1.1 はタブレット（短辺 600px 以上）で枠を広げる。
 *
 * **広げると、今度は際限なく伸びる。** だから**キーには天井が在る**
 * ——`--touch-target-max`（`tokens.css`）。**この検査の「88px を超えたキー」が、
 * 天井が効いていることの証拠である**（天井が無いと、枠 560px で 100.8px になる）。
 *
 * **44px の検査は幅だけを見る。** **半高の関数列は高さ 34px** である
 * （`Keypad.module.css:49-50` の `.half > button` が `--function-row-height` を
 * 当て、その値は `tokens.css:68` の `34px`。**現物で確かめた**）。
 * **高さも見ると天井が在っても無くても常に赤**になって、
 * **「天井の赤」と「関数列の赤」が見分けられなくなる。**
 * `viewport-budget.spec.ts` の 44px の検査も幅だけを見ている。
 */
for (const size of TABLET_VIEWPORTS) {
  test(`the board stays usable at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();

    const spill = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(spill, "横にはみ出す量").toBeLessThanOrEqual(0);

    const boxes = await page
      .locator("main button")
      .evaluateAll((els) =>
        els
          .map((el) => el.getBoundingClientRect())
          .map((r) => ({ w: r.width, h: r.height })),
      );
    // **0 件で緑にしない。** Scientific は 7 + 7 + 25 = 39
    // （`viewport-budget.spec.ts:242` と同じ数え方）。
    expect(boxes.length, "見たキーの数").toBeGreaterThanOrEqual(39);

    const narrow = boxes.filter((b) => b.w < 44);
    expect(narrow, `44px より細いキー: ${JSON.stringify(narrow)}`).toEqual([]);

    // **「等しい」で主張する**（レビュー役の条件 D1、`panel-sizing.spec.ts:61` の
    // `toBe(366)` と同じ形）。**「88px を超えたキーが 0 件」では足りない**
    // ——**段を丸ごと消して 480px に戻しても、閾値を 800px に上げても、
    // 式の `5` が列数とずれてキーが縮んでも、その形なら緑のまま**である
    // （レビュー役が変異で実測）。**「広がっていない」を 1 本も見ていない。**
    const square = boxes.filter((b) => Math.round(b.h) === Math.round(b.w));
    expect(square.length, "正方のキーの数").toBeGreaterThanOrEqual(25);
    const sides = [...new Set(square.map((b) => Math.round(b.w)))];
    expect(sides, `正方のキーの幅: ${JSON.stringify(sides)}`).toEqual([88]);

    // **盤面の幅も等しいで押さえる。** 5 × 88 ＋ 4 × 8 = 472px。
    const board = await page.locator("main fieldset").first().boundingBox();
    expect(Math.round(board?.width ?? 0), "盤面の幅").toBe(472);
  });
}

/**
 * **読み物の幅は、盤面の幅とは別に止まる**（設計 §2.5）。
 *
 * **盤面は指が決め、読み物は 1 行の文字数が決める**ので、上限は
 * `--reading-max-width`（`tokens.css`。**和文の字は 1em 幅なので 36em は
 * 「1 行 36 字」そのもの**）である。
 *
 * **期待値はこの検査が自分で持つ**（`36`）——**トークンを読んで突き合わせると、
 * 両方が同時に間違っても緑になる**（`check-boundary.mjs` の 4 本目と同じ理由）。
 * **px ではなく `36 × 字の大きさ` で照合する**のは、**上限が `em` で書かれている**
 * ためで、**字の大きさを変えても文字数は動かない**という主張そのものである。
 */
for (const size of TABLET_VIEWPORTS) {
  test(`the manual stops at a readable width at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#manual");
    const body = page.locator("main article").first();
    await body.waitFor();
    const measured = await body.evaluate((el) => {
      const page = el.closest("section");
      return {
        width: (page ?? el).getBoundingClientRect().width,
        fontSize: Number.parseFloat(getComputedStyle(page ?? el).fontSize),
      };
    });
    // **1 行が 36 字を超えない。** 画面の幅（768〜1180px）より十分に狭い。
    expect(
      measured.width,
      `本文の幅 ${measured.width}px（字の大きさ ${measured.fontSize}px）`,
    ).toBeLessThanOrEqual(36 * measured.fontSize);
    // **0 件で緑にしない**——本文が読み込めていなければ幅は 0 になる。
    expect(measured.width, "本文の幅").toBeGreaterThan(300);
  });
}

/**
 * **貼り付く表示欄は 154px より高くならない。**
 *
 * `Key.module.css` の `scroll-margin-top: 154px` は**この上限に依っている**
 * ——**表示欄がこれより高くなった日、キーはその下に隠れる**。
 * **上限が私の説明の中にしか無いなら、それは根拠が註にしかない数である**
 * （監視役の条件 2026-09-29）。**ここが、その数を主張にする。**
 *
 * **上限の理由**: 主表示の字は `clamp(1.75rem, 8vw, 2.5rem)` で、
 * **幅 500px 以上では 2.5rem に張り付く**——だから**幅を広げても高さは増えない**。
 * 実測（2026-09-29）は **390 幅で 144px、667/844 幅で 154px**。
 */
for (const size of [
  { device: "iPhone 13 landscape", width: 844, height: 390 },
  ...TABLET_VIEWPORTS,
]) {
  test(`the readout never grows past 154px at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    let measured = 0;
    for (const url of PROMISED_URLS) {
      await page.goto(`/${url.hash}`);
      await page.locator("main button").first().waitFor();
      const heights = await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((el) => getComputedStyle(el).position === "sticky")
          .map((el) => el.getBoundingClientRect().height),
      );
      for (const height of heights) {
        expect(height, `${url.hash} の貼り付く箱の高さ`).toBeLessThanOrEqual(
          154,
        );
        measured += 1;
      }
    }
    // **0 件で緑にしない。** 13 画面それぞれに 1 つ在る。
    expect(measured, "測った箱の数").toBeGreaterThanOrEqual(13);
  });
}
