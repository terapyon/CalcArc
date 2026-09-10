import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/#finance");
});

test("no Finance key spills out of its button", async ({ page }) => {
  // **「借入可能」が 2 段になってボタンからはみ出していた。** はみ出しは
  // scrollHeight が clientHeight を超えることとして測る——見た目の
  // 「読めなさ」を、レイアウトが答えられる問いに直したもの。
  for (const label of ["計算の種類", "入力する項目"]) {
    const group = page.getByRole("group", { name: label });
    for (const button of await group.getByRole("button").all()) {
      const spill = await button.evaluate(
        (el) => el.scrollHeight - el.clientHeight,
      );
      const name = await button.getAttribute("aria-label");
      expect(spill, `${name} spills ${spill}px`).toBeLessThanOrEqual(0);
    }
  }
});

test("the widened rows still read at the function size", async ({ page }) => {
  // 器を広げた見返りに、収めるために削っていた 0.75rem を戻している
  // (0.2.0 設計書 §8)。縮んだままなら広げた意味が半分になる。
  const size = await page
    .getByRole("button", { name: "ボーナス返済分（元本）を入力" })
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("15px");
});

// **常設の説明は 2 行以内である。** 対象は `FinancePanel.tsx` の
// `styles.disclaimer`——パネル(`<section aria-label="金融計算">`)の直下に
// ある唯一の `<p>` である(内訳の `<p>` は `.breakdown` の `<div>` の中に
// いるので、この取り方には掛からない)。
//
// **なぜ置くのか。** 文言はあとから伸びる(この計画の Task 4 が実際に
// 2 行へ伸ばす)。伸びすぎたとき、**縦の予算の検査は「8px を割った」としか
// 言わない——どこが伸びたのかは言わない。** 行数の検査は**伸びた場所を
// 名指しする。** 2 本を並べて赤くして確かめた(2026-09-10、設計書 §4.3 の
// 全文を `<p>` に一時的に入れて実測。390/360 とも 5 行):
//
//   この検査    the disclaimer wrapped onto 5 lines: "名目年率を年間回数で
//               割り、各期の利息を 1 円未満切り捨てます。…"
//   余白の検査  only 0px of slack left on Finance
//   溢れの検査  Finance overflows by 52px
//
// **後の 2 本は「どこが」を言っていない。** しかも余白のほうは **0px で
// 止まる**——パネルが伸びると `<main>` も一緒に伸びるので、差は 0 より下へ
// 行かない。**伸びた 68px のうち余白の数字に出るのは 16px だけで、残り
// 52px は「溢れ」のほうへ抜ける。** 名前を出すのはこの検査である。
//
// **数え方はこのリポジトリの流儀に倣う**——`nav.spec.ts` と同じく Range の
// クライアント矩形を数える。**改行を含むテキストでは矩形の数が視覚的な
// 行数と一致しないことがある**ので、閾値は現物を印字してから決めた:
// **いまの 1 文は 390×844 でも 360×800 でも 1 行・17px**(2026-09-10 実測)。
//
// **上限を 2 にしたのは設計書 §11.5 の予算による。** 下段を `half` にして
// 空くのは 34px(実測。余白 16.31→50.31 / 5.28→39.28)で、1 行は 17px
// ——**2 行までは入る。3 行目は縦の予算の話になる。**
for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`the standing disclaimer stays within 2 lines at ${size.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/#finance");
    await expect(page.getByTestId("display-main")).toBeVisible();

    const disclaimer = page.locator('section[aria-label="金融計算"] > p');

    // **何件見たかを主張する。** パネルの組み立てが変わってこの取り方が
    // 0 件になった日から、下の行数は測られないまま緑を返し続ける
    // ——`toHaveCount` を挟まないと `evaluate` は最初の 1 件を見るだけで、
    // 「1 件も無い」は待ち時間の果てのタイムアウトにしかならない。
    await expect(disclaimer).toHaveCount(1);

    const { lines, text } = await disclaimer.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        lines: range.getClientRects().length,
        text: el.textContent ?? "",
      };
    });

    expect(
      lines,
      `the disclaimer wrapped onto ${lines} lines: ${JSON.stringify(text)}`,
    ).toBeLessThanOrEqual(2);
  });
}
