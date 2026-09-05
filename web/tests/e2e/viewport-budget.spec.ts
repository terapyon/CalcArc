import { expect, type Page, test } from "./fixtures";

// **0.2.0 で縦に足したものが 1 画面に収まり、かつタブで揺れないこと。**
// 盤面の高さはタブごとに違う(Finance がいちばん高い)ので、何もしないと
// ページ全体の高さもフッタの位置もタブで変わる。

// **全 route は 13(scientific 1 + convert 8 + scale 3 + finance 1)、
// この巡回が持つのは 11 である。** 外にいるのは `#scale/llm` と
// `#convert/currency` の 2 つだけで、**どちらも理由が下に書いてある**。
// **カテゴリを足すたびにこの数は動く。** 在庫は 3 か所にある——この注記と、
// `docs/definition-of-done.md` の表と、同ファイルの訂正印。U-2 のときに
// 表だけ直して 2 か所を腐らせた。次に足す人は 3 か所を grep で起こすこと。
// `#convert`(素のハッシュ)は `#convert/length` へ倒れる同じ画面なので、
// タブの href と同じ `#convert/length` のほうを巡回する
// (同じ画面に URL を 2 つ作らない)。
//
// **巡回に入っていない route は、緑を「収まっている」と読ませる**——
// S-0 が記録したこの穴は 7 route ぶんあった。**5 つを 0.5.0 で閉じ、
// 2 つを理由つきで残す。**
//
// ## 閉じた 5 つ(2026-08-27 実測、390×844 の縦あふれ)
//
// `#convert/area` `#convert/volume` `#convert/speed` `#convert/data-size`
// **と `#scale/transfer`。5 つとも 0** だった。360×640 では 66 だが、
// **それは既存の 3 route と同値の既知債務**で、U-2 が増やしたものではない
// (`docs/definition-of-done.md` の表)。**この巡回は 390×844 しか測らない**
// ので、足せば緑になる。**「収まっているのを機械が確認していない」穴であって、
// 「溢れているのを許容した」穴ではなかった。**
//
// **`#scale/transfer` について、この注記自身が間違っていた。** 以前ここには
// 「**Scale の 2 つ**(`#scale/llm` `#scale/transfer`)は 390×844 で溢れる」と
// 書いてあったが、**データ転送は溢れていない(実測 0)**。`definition-of-done.md`
// の表も 2026-08-20 の時点で 390×844 は 0 と記録している——**2 つを
// 「Scale の 2 つ」と束ねた注記のほうが、表と食い違っていた。** ユーザーが
// 許容を裁定したのは **LLM だけ**である(同ファイル【ユーザー裁定 2026-08-20】)。
//
// ## 残した 2 つ
//
// - **LLM `#scale/llm` は溢れる。ユーザー裁定で許容**(実験的機能。同ファイル
//   【ユーザー裁定 2026-08-20】)。足すと赤になる——**「承知のうえで許容した」
//   溢れ**であって、直し忘れではない。**量は 2026-08-27 の実測で 39px**
//   (裁定した日の記録は 33px)。**増えた 6px はフッタである**——
//   `--footer-font-size` を 0.4.0 以前の 8px に戻して測ると 33 に戻り、
//   12px では 39 になる(実測)。**この 6px は LLM に固有ではなく全 route が
//   等しく払っている**ので、上の 5 つは 0 のままである。
// - **通貨 `#convert/currency` は、寸法の話ではない。** レートが届いていれば
//   390×844 で 0 だが、**キャッシュ無しの案内が出ている状態では 10px 溢れる**
//   (360×640 では 181)。**`./fixtures` が全 E2E でプロバイダを塞いだので、
//   ここが本物のネットワークへ出ることはもう無い**(0.5.0)——だが塞いだ
//   結果は「取得に失敗」であり、**この route は常に案内の出た状態、つまり
//   10px 溢れた状態で測られる**。足すには「どのレート状態で測るのか」を
//   先に決める必要がある(キャッシュを仕込むのか、案内の出た状態を正と
//   するのか)。**それは寸法の予算表ではなく為替の検査の話**なので、
//   ここには足さない。
const TABS = [
  ["#scientific", "Scientific"],
  ["#convert/length", "Convert 長さ"],
  ["#convert/mass", "Convert 質量"],
  ["#convert/temperature", "Convert 温度"],
  // **U-2 の 4 カテゴリ**(0.5.0 で足した)。
  ["#convert/area", "Convert 面積"],
  ["#convert/volume", "Convert 体積"],
  ["#convert/speed", "Convert 速さ"],
  ["#convert/data-size", "Convert データ量"],
  ["#scale/data-scale", "Data Scale"],
  // **データ転送**(0.5.0 で足した)。溢れていない。
  ["#scale/transfer", "データ転送"],
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

test("no key row is wider than the board that holds it, at 360px", async ({
  page,
}) => {
  // **44px を測るだけでは、関数列を 8 列に戻す変更が止まらない。**
  // `column-gap` が余りを列間から吸うので、8 列にしてもキーは 44px を
  // 割らず、上の 2 本は緑のまま通る。実測(2026-09-04、第 2 関数列を
  // 8 列 × 8 キーに変えて測った):
  //
  //   390px: キー 44.00px / 列間 2px  — 区画 366px、親 366px（収まる）
  //   360px: キー 44.00px / 列間 0px  — **区画 352px、親 336px**
  //
  // **溢れの検査も止められない。** 盤面は左右に 12px の余白を持つので、
  // 区画が 16px はみ出しても**文書の幅は 4px しか増えず**、8px の許容
  // (2026-08-20 のユーザー裁定)に収まってしまう。
  //
  // だから**区画そのものを親と突き合わせる**。ここが「8 列は取れない」を
  // 実際に守っている 1 本である(S-2 設計書 §7.1 の追記)。
  await page.setViewportSize(NARROW);
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toBeVisible();

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("fieldset")].map((el) => ({
      name: el.getAttribute("aria-label") ?? "(名前なし)",
      width: el.getBoundingClientRect().width,
      parent: el.parentElement?.getBoundingClientRect().width ?? 0,
    })),
  );

  // **何件見たかを主張する。** <fieldset> の綴りが変わって 0 件になった日
  // から、この検査は何も測らないまま緑を返し続ける。Scientific は
  // 関数列 2 つ + メイングリッドの 3 区画である。
  expect(rows.length, "measured no key rows at all").toBeGreaterThanOrEqual(3);

  // 小数の丸めで 0.5px ほど揺れるので、はみ出しは 1px から数える。
  const over = rows.filter((r) => r.width > r.parent + 1);
  expect(
    over,
    `key rows wider than their board: ${JSON.stringify(over)}`,
  ).toEqual([]);
});
