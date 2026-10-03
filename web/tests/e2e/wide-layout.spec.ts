import { PROMISED_URLS } from "../promised-urls";
import { expect, test } from "./fixtures";
import { onScreen } from "./screens";
import { TABLET_VIEWPORTS } from "./widths";

/**
 * **広い画面で、盤面が使える形のまま広がる**（1.1、設計 §2.2・§2.3）。
 *
 * 1.0 までの枠は 480px 止まりで、**768×1024 でも正方のキーは 85px だった**
 * （この検査の最初の赤。2026-09-29）。1.1 はタブレット（短辺 600px 以上）で枠を広げる。
 *
 * **キーに上限は掛かっていない**（検証役の指摘 2026-09-29）——**盤面の格子は
 * `repeat(var(--keypad-columns), 1fr)` のまま**である。**`--touch-target-max` は
 * 枠の幅を導く数**で、**キーが 88px になるのは枠がそう導かれているから**
 * （**仮に枠を 560px と書いたらキーは 100.8px になった**——**天井がキーに掛かって
 * いれば、そこで止まっていたはず**）。**だからこの検査は「88px を超えたキーが 0 件」
 * ではなく、「キーの幅が 88 に等しい／盤面が 472 に等しい」で撃つ。**
 *
 * **44px の検査は幅だけを見る。** **半高の関数列は高さ 34px** である
 * （`Keypad.module.css:49-50` の `.half > button` が `--function-row-height` を
 * 当て、その値は `tokens.css:68` の `34px`。**現物で確かめた**）。
 * **高さも見ると天井が在っても無くても常に赤**になって、
 * **「天井の赤」と「関数列の赤」が見分けられなくなる。**
 * `viewport-budget.spec.ts` の 44px の検査も幅だけを見ている。
 */
/**
 * **【2026-09-30】この 3 本は、縦のタブレットだけを回す。**
 * **`1024×768` と `1180×820` は横向きの段に入った**ので（幅 ≥ 660・高さ ≤ 840）、
 * **盤面は 2 列になり、`main fieldset` の 1 つ目は関数列（356px）になる**
 * ——ここの `toBe(472)` は**その寸法では意味を失った**（実測で赤くなった）。
 * **天井 88px は `landscape-layout.spec.ts` の #2b が、同じ「等しい」で撃つ。**
 */
const TABLET_PORTRAIT = TABLET_VIEWPORTS.filter(
  (size) => size.height > size.width,
);

for (const size of TABLET_PORTRAIT) {
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
    // ——**段を丸ごと消して 480px に戻しても、式の `5` が列数とずれてキーが縮んでも、
    // その形なら緑のまま**である（**レビュー役が変異で実測、2026-09-29**）。
    // **「広がっていない」を 1 本も見ていない。**
    // **閾値を 800px に上げる変異は、768 と 1024 の 2 寸法で赤くなる**
    // ——**`1180×820` は両辺が 800 以上なので段に残る**（この註の初稿は
    // 「800 でも緑」と書いていたが、不正確だった）。
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
 * **貼り付く表示欄は 155px より高くならない。**
 *
 * `Key.module.css` の `scroll-margin-top: 154px` は**この上限に依っている**
 * ——**表示欄がこれより高くなった日、キーはその下に隠れる**。
 * **上限が私の説明の中にしか無いなら、それは根拠が註にしかない数である**
 * （監視役の条件 2026-09-29）。**ここが、その数を主張にする。**
 *
 * **上限の理由**: 主表示の字は `clamp(1.75rem, 8vw, 2.5rem)` で、
 * **幅 500px 以上では 2.5rem に張り付く**——だから**幅を広げても高さは増えない**。
 * **実測（検証役の掃引 2026-09-29）**: `320→139.8` / `375→142.2` / `390→143.6` /
 * `480→152.3` / **`500 以上はすべて 154.2`**。
 *
 * **`154` ではなく `155` で撃つ。** **`scroll-margin-top` の 154 は 154.19 の切り捨て**で、
 * **`844×390` と `667×375` の実測は 154.19px**——**`154` で撃つと、いま正しい寸法が赤くなる。**
 * **番人の数は、測った数に合わせる**（**最初の私の `154` は、probe が `Math.round` した数を
 * そのまま上限に使ったもので、偽だった**）。
 * **0.19px の不足が害にならないのは、判定がキーの中心を見るから**である（余裕 17px）。
 */
for (const size of [
  { device: "iPhone 13 landscape", width: 844, height: 390 },
  ...TABLET_VIEWPORTS,
]) {
  test(`the readout never grows past 155px at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    let measured = 0;
    for (const url of PROMISED_URLS) {
      await page.goto(`/${url.hash}`);
      await onScreen(page, url.hash);
      await page.locator("main button").first().waitFor();
      const heights = await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((el) => getComputedStyle(el).position === "sticky")
          .map((el) => el.getBoundingClientRect().height),
      );
      for (const height of heights) {
        expect(height, `${url.hash} の貼り付く箱の高さ`).toBeLessThanOrEqual(
          155,
        );
        measured += 1;
      }
    }
    // **0 件で緑にしない。** 13 画面それぞれに 1 つ在る。
    expect(measured, "測った箱の数").toBeGreaterThanOrEqual(13);
  });
}

/**
 * **【1.1.0 で撤回 2026-09-30】「スマホを横にしても、盤面は広がらない」の 2 本は、
 * ここから移した。**
 *
 * **約束そのものが変わった**——**横向きは 2 列になり、ホーム画面の高さでは
 * 1 画面に収まる**（設計書 `2026-09-30-landscape-layout-design.md`）。
 * **床を下げたのではない。主張を入れ替えた**（レビュー役の条件 B3）。
 * **行き先は `landscape-layout.spec.ts`**——あちらが**はみ出さないこと・
 * 44px の床・左右の並び・ロールで引けること**を撃つ。
 */
