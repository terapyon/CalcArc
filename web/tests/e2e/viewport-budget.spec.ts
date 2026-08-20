import { expect, type Page, test } from "@playwright/test";

// **0.2.0 で縦に足したものが 1 画面に収まり、かつタブで揺れないこと。**
// 盤面の高さはタブごとに違う(Finance がいちばん高い)ので、何もしないと
// ページ全体の高さもフッタの位置もタブで変わる。

// **Convert は 3 カテゴリとも巡回する**(U-1)。S-0 で記録した穴——
// **巡回に入っていない route は、緑を「収まっている」と読ませる**——を、
// 少なくとも Convert では作らない。`#convert`(素のハッシュ)は
// `#convert/length` へ倒れる同じ画面なので、タブの href と同じ
// `#convert/length` のほうを巡回する(同じ画面に URL を 2 つ作らない)。
//
// **Scale は依然として `#scale/data-scale` の 1 件だけ**である。
// `#scale/llm` と `#scale/transfer` は 390×844 で溢れることが分かっており
// (docs/definition-of-done.md、ユーザー裁定で許容)、ここに足すと赤になる。
// **その 2 route がこの巡回に居ないことは、docs/definition-of-done.md に
// 書いてある既知の穴である。**
const TABS = [
  ["#scientific", "Scientific"],
  ["#convert/length", "Convert 長さ"],
  ["#convert/mass", "Convert 質量"],
  ["#convert/temperature", "Convert 温度"],
  ["#scale/data-scale", "Data Scale"],
  ["#finance", "Finance"],
] as const;

/**
 * パネルが描かれるのを待つ。
 *
 * **フッタは WASM と無関係に即描画される**ので、これが無いと Scientific は
 * `Loading…` のままの空のページを測って緑になる。
 *
 * **U-1 で Convert の分岐が消えた。** 準備中の面には表示器が無かったので、
 * そのパネル自身の出現を待っていた——盤面が入って `display-main` を持つ
 * ようになったので、4 タブとも同じ待ち方でよい。
 */
async function waitForPanel(page: Page) {
  await expect(page.getByTestId("display-main")).toBeVisible();
}

for (const [hash, name] of TABS) {
  test(`${name} fits in one screen at 390x844`, async ({ page }) => {
    await page.goto(`/${hash}`);
    // **パネルが出てから測る。** フッタは WASM と無関係に即描画されるので、
    // これが無いと Scientific は `Loading…` のままの空のページを測って緑になる。
    await waitForPanel(page);
    await expect(page.getByTestId("footer-disclaimer")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow, `${name} overflows by ${overflow}px`).toBeLessThanOrEqual(
      0,
    );
  });
}

test("the footer sits at the same place on every tab", async ({ page }) => {
  // **これが「揺らがない」の本体。** 盤面の高さがタブで違っても、
  // フッタの位置は動かない。
  const seen: { name: string; y: number }[] = [];
  for (const [hash, name] of TABS) {
    await page.goto(`/${hash}`);
    // **パネルが出てから測る。** フッタは WASM と無関係に即描画されるので、
    // これが無いと Scientific は `Loading…` のままの空のページを測って緑になる。
    await waitForPanel(page);
    await expect(page.getByTestId("footer-disclaimer")).toBeVisible();
    const box = await page.getByTestId("footer-disclaimer").boundingBox();
    seen.push({ name, y: box?.y ?? -1 });
  }
  const ys = seen.map((s) => s.y);
  expect(
    new Set(ys).size,
    `footer moved between tabs: ${JSON.stringify(seen)}`,
  ).toBe(1);
});

test("the tallest tab still has slack inside the screen", async ({ page }) => {
  // **「余裕を持って」の実体。** 測るのは `<main>` の高さとパネルの高さの差
  // ——これが**本当に何も置かれていない縦**である。
  //
  // 当初は「盤面の下端とフッタの上端の距離」を測っていたが、あれは違う
  // ものを測っていた。100dvh のシェルでは、盤面が伸びた分はその区間では
  // なく**画面の外**へ出る。実際、広げた行を 4 倍・8 倍にしても距離は
  // 67px から動かなかった(実測)。あの検査が捕まえていたのは、あいだに
  // 挟まる画面内免責やパネル余白が縮んだ場合だけだった。
  await page.goto("/#finance");
  // **パネルが出てから測る。** フッタは WASM と無関係に即描画されるので、
  // これが無いと Scientific は `Loading…` のままの空のページを測って緑になる。
  await expect(page.getByTestId("display-main")).toBeVisible();
  await expect(page.getByTestId("footer-disclaimer")).toBeVisible();

  const slack = await page.evaluate(() => {
    const main = document.querySelector("main");
    const panel = main?.firstElementChild;
    if (!main || !panel) return -1;
    return (
      main.getBoundingClientRect().height - panel.getBoundingClientRect().height
    );
  });

  expect(
    slack,
    `only ${slack}px of slack left on Finance`,
  ).toBeGreaterThanOrEqual(8);
});

// **横の予算は 360px で測る。** 既定の 390px は盤面の寸法を決めたときの幅で、
// そこで合っていることは何の保証にもならない——関数列の 7 列は 390px の
// 実測(1 キー 45.4px)だけを見て決まっており、**それより狭い幅を誰も測って
// いなかった**。360px は現在いちばん多い Android の幅である。
//
// 320px はここに含めない。7 列 × 44px = 308px は gap と padding を 0 に
// しても 320px にほぼ隙間が無く、**44px と 7 列は 320px で両立しない**
// (算数である)。320px の扱いは docs/definition-of-done.md に実測値付きで
// 繰り越してある。
const NARROW = { width: 360, height: 800 };

for (const [hash, name] of TABS) {
  test(`${name} does not spill sideways at 360px`, async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto(`/${hash}`);
    // **パネルが出てから測る。** これが無いと `Loading…` の空のページを
    // 測って緑になる。
    await waitForPanel(page);

    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    // **ユーザー裁定 2026-08-20: 8px まで許容する。** フォント環境差を吸収する
    // ため。実測: CI で 3px、手元で CJK を落とすと 6px。どちらも字幅が変わった
    // だけで、盤面は崩れていない。**本物の崩れは 2 桁 px で出るので、この幅でも
    // 捕まる。**
    expect(
      spill,
      `${name} spills ${spill}px sideways at 360px`,
    ).toBeLessThanOrEqual(8);
  });
}

test("the keys still hold 44px across at 360px", async ({ page }) => {
  // **溢れを消すだけなら、キーを縮めても緑になる。** それでは直したことに
  // ならない——譲るのは gap のほうで、44px は守る側である。この検査が
  // 溢れの検査と対になっていないと、次に狭い幅で困った人が 44px を削る。
  await page.setViewportSize(NARROW);
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toBeVisible();

  const keys = page
    .getByRole("group", { name: /関数キー|第 2 関数列|数字と演算のキー/ })
    .getByRole("button");
  const boxes = await Promise.all(
    (await keys.all()).map(async (b) => ({
      name: (await b.textContent())?.trim(),
      width: (await b.boundingBox())?.width ?? 0,
    })),
  );

  // **何件見たかを主張する。** ループだけだと、ロールの綴りが変わって
  // 0 件になった日から、この検査は何も測らないまま緑を返し続ける。
  expect(boxes.length, "measured no keys at all").toBeGreaterThanOrEqual(
    7 + 7 + 25,
  );

  const narrow = boxes.filter((b) => b.width < 44);
  expect(narrow, `keys narrower than 44px: ${JSON.stringify(narrow)}`).toEqual(
    [],
  );
});
