import { expect, test } from "./fixtures";
import { narrowWidth, WEBKIT_NARROW_WIDTH } from "./widths";

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
//
// **★ 面ごとに測る(2026-09-10、この計画の Task 4)。** 説明は方式で
// 中身が変わるようになった——**`#finance` を開いた既定は `payment`(ローン)
// なので、この検査は 1 面しか見ていなかった。** 伸びたのは複利の面のほう
// (1 行 → 2 行)であり、**見張っていない面が伸びる**のは「赤くならない
// 壊れ方」である。だから 2 面 × 2 幅の 4 本にする。
const FACES = [
  { name: "loan", mode: null, word: "返済額" },
  { name: "compound", mode: "複利で増やす", word: "切り捨て" },
] as const;

for (const face of FACES) {
  for (const size of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    // **WebKit の複利の面の 360px だけは 375px で測る**(`widths.ts` の理由、
    // 2026-09-11 の利用者の裁定)。ローンの面は WebKit でも 360px のまま。
    const narrow = face.name === "compound" && size.width === 360;
    const onWebKit = narrow ? ` (${WEBKIT_NARROW_WIDTH}px on WebKit)` : "";
    test(`the standing disclaimer stays within 2 lines on the ${face.name} face at ${size.width}px${onWebKit}`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize(
        narrow ? { ...size, width: narrowWidth(browserName) } : size,
      );
      await page.goto("/#finance");
      await expect(page.getByTestId("display-main")).toBeVisible();
      if (face.mode) {
        await page.getByRole("button", { name: face.mode }).click();
      }

      const disclaimer = page.locator('section[aria-label="金融計算"] > p');

      // **何件見たかを主張する。** パネルの組み立てが変わってこの取り方が
      // 0 件になった日から、下の行数は測られないまま緑を返し続ける
      // ——`toHaveCount` を挟まないと `evaluate` は最初の 1 件を見るだけで、
      // 「1 件も無い」は待ち時間の果てのタイムアウトにしかならない。
      await expect(disclaimer).toHaveCount(1);

      // **どの面を測ったかも主張する。** モードのボタンが押せなかった日、
      // この検査はローンの 1 行を測って**複利の面を見張っているつもりで
      // 緑を返し続ける。** 語の中身そのものは vitest 側
      // (`FinancePanel.test.tsx` の「常設の説明」)が持っていて、ここでは
      // **測った物が名乗った面であること**だけを言っている。
      await expect(disclaimer).toContainText(face.word);

      // **失敗文には 1 行ずつの中身も出す**(2026-09-11)。WebKit の最初の
      // 走行でこの検査が 3 行を返したとき、**どこで折れたかが分からず**、
      // 書体の違いか行分割の規則の違いかを切り分けられなかった(門 1 の
      // 設計書 §1.5)。1 文字ずつの矩形の上端で行を分ける。数える行数と
      // 閾値は変えない——**これは診断であって判定ではない。**
      const { lines, text, rows, font } = await disclaimer.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rows: string[] = [];
        let top: number | null = null;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const chars = node.textContent ?? "";
          for (let i = 0; i < chars.length; i++) {
            const one = document.createRange();
            one.setStart(node, i);
            one.setEnd(node, i + 1);
            const rect = one.getClientRects()[0];
            if (
              rect &&
              (top === null || Math.abs(rect.top - top) > rect.height / 2)
            ) {
              rows.push("");
              top = rect.top;
            }
            const last = rows.length - 1;
            if (last >= 0) rows[last] = (rows[last] ?? "") + chars.charAt(i);
          }
        }
        return {
          lines: range.getClientRects().length,
          text: el.textContent ?? "",
          rows,
          font: getComputedStyle(el).font,
        };
      });

      expect(
        lines,
        `the ${face.name} disclaimer wrapped onto ${lines} lines: ${JSON.stringify(text)}` +
          ` — rows: ${rows.map((row) => JSON.stringify(row)).join(" / ")}` +
          ` — font: ${font}`,
      ).toBeLessThanOrEqual(2);
    });
  }
}

// **複利の面にも縦の余裕があること。**
//
// **★ `viewport-budget.spec.ts` は複利の面を 1 度も測っていない。** あちらの
// 「いちばん高いタブに 8px 以上の余白」は **390×844 で、既定のモード
// (`payment` = ローン)** を測る 1 本である。**この枝で複利の面のほうが
// 高くなった**(常設の説明が 2 行になった)ので、**予算の検査は低いほうを
// 測り続けることになった。**
//
// **穴の大きさは実測してある**(2026-09-10、説明を 3 行に伸ばした状態):
//
//   複利の面 390×844   余白 16.31px  はみ出し 0
//   複利の面 360×800   余白  5.28px  はみ出し 0   ← **8px を割っている**
//
// **そのとき `viewport-budget.spec.ts` は 30 本すべて緑だった。** 行数の
// 番人(上)だけが名前を出した。**上の番人が 2 行を上限にしているので実害は
// 塞がっている**が、**塞いでいるのは行数のほうであって余白のほうではない**
// ——**説明以外の何かが複利の面を伸ばした日には、誰も言わない。** ここで
// 余白のほうも見る。
//
// **閾値は `viewport-budget.spec.ts` と同じ 8px にそろえる**——別の数字に
// すると、2 か所が別々に動く。**いまの実測は 33.31px / 22.28px**(2 行)。
for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  // **WebKit の 360px だけは 375px で測る**(`widths.ts` の理由)。
  const narrow = size.width === 360;
  const onWebKit = narrow ? ` (${WEBKIT_NARROW_WIDTH}px on WebKit)` : "";
  test(`the compound face keeps slack inside the screen at ${size.width}px${onWebKit}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize(
      narrow ? { ...size, width: narrowWidth(browserName) } : size,
    );
    await page.goto("/#finance");
    await expect(page.getByTestId("display-main")).toBeVisible();
    await page.getByRole("button", { name: "複利で増やす" }).click();
    // **測った物が複利の面であることを先に言う**(上の 4 本と同じ理由)。
    await expect(
      page.locator('section[aria-label="金融計算"] > p'),
    ).toContainText("切り捨て");

    const { mainHeight, panelHeight, panelTag } = await page.evaluate(() => {
      const main = document.querySelector("main");
      const panel = main?.querySelector(":scope > :not(h1)");
      if (!main || !panel) {
        return { mainHeight: -1, panelHeight: -1, panelTag: "(見つからない)" };
      }
      return {
        mainHeight: main.getBoundingClientRect().height,
        panelHeight: panel.getBoundingClientRect().height,
        panelTag: panel.tagName,
      };
    });

    // **測った物がパネルであることを先に主張する**(`viewport-budget.spec.ts`
    // と同じ形。1×1 の要素を測って緑になるのを止める下限である)。
    expect(
      panelHeight,
      `measured <${panelTag}> at ${panelHeight}px inside a ${mainHeight}px <main> — that is not the panel`,
    ).toBeGreaterThanOrEqual(mainHeight / 2);

    const slack = mainHeight - panelHeight;
    expect(
      slack,
      `only ${slack}px of slack left on the compound face`,
    ).toBeGreaterThanOrEqual(8);
  });
}
