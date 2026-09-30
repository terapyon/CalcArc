import { PROMISED_URLS } from "../promised-urls";
import { expect, type Page, test } from "./fixtures";
import {
  LANDSCAPE_TAB_VIEWPORTS,
  LANDSCAPE_VIEWPORTS,
  SAFARI_VIEWPORTS,
} from "./widths";

/**
 * **画面が低くても崩れない**(2026-09-12、利用者の裁定「崩れないことだけ約束する」。
 * 門 1 の設計書 §1.5、README の文案 §3)。
 *
 * iPhone の Safari のタブで開くと、どの機種でも 1 画面に収まらずスクロールする
 * (手元の Chromium で 127〜165px)。**約束するのは「スクロールすれば、すべての
 * 表示とキーが見えて押せる」こと**で、ここがその番人である。約束した 13 画面と
 * 金融の 6 モードについて、次の 3 つを見る:
 *
 * - **横にはみ出さない**(ページが横にスクロールしない)
 * - **押せるキーはすべて、スクロールすれば見える**(`disabled` のキーは除く)
 * - **その上に何も重なっていない**——キーの真ん中の点を `elementFromPoint` で
 *   引いて、そのキー(か、その中身)が返ること
 *
 * **Chromium と WebKit で同じ検査である**(エンジンで分岐しない)。
 */
const sweep = () => {
  // **`skipped` は主張ではなく、診断である**（2026-09-30）。**無効なキーは
  // `problems` にも `checked` にも入らない**ので、**床が足りないのに
  // `problems` が空**という結末がありうる——**そのとき「何が飛んだか」を
  // 印字できないと、走行を 1 回無駄にする。**
  const out = { checked: 0, problems: [] as string[], skipped: [] as string[] };
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    out.problems.push(
      `scrolls sideways by ${root.scrollWidth - root.clientWidth}px`,
    );
  }
  const main = document.querySelector("main");
  for (const el of Array.from(main?.querySelectorAll("button") ?? [])) {
    const key = el as HTMLButtonElement;
    if (key.disabled || key.getAttribute("aria-disabled") === "true") {
      out.skipped.push(
        key.getAttribute("aria-label") ?? key.textContent ?? "?",
      );
      continue;
    }
    // **利用者と同じく、見えるところまでだけ動かす**(`nearest`)。真ん中へ
    // 寄せると、端に固定された物の下に隠れたキーを見逃す。
    key.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = key.getBoundingClientRect();
    const name = key.getAttribute("aria-label") ?? key.textContent ?? "?";
    if (r.width === 0 || r.height === 0) {
      out.problems.push(`${name}: has no size`);
      continue;
    }
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
      out.problems.push(`${name}: cannot be scrolled into view`);
      continue;
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === key || key.contains(hit))) {
      out.problems.push(
        `${name}: covered by <${hit?.tagName.toLowerCase() ?? "nothing"}>`,
      );
    }
    out.checked += 1;
  }
  return out;
};

/**
 * 飛ばしたキーを**画面ごとの数に畳む**。**名前を全部出すと 187 行になり**、
 * **読む人は差分を目で数えることになる**（2026-09-30 に実測して畳んだ）。
 * **エンジンをまたいで比べたいのは「どの画面で何個飛んだか」**である。
 */
const tally = (skipped: string[]) => {
  const perScreen: Record<string, number> = {};
  for (const entry of skipped) {
    const screen = entry.split(" ")[0] ?? "?";
    perScreen[screen] = (perScreen[screen] ?? 0) + 1;
  }
  return JSON.stringify(perScreen);
};

/** 13 画面と金融の 6 モードを回す。`query` は URL の検索部(お知らせを出すとき)。 */
async function sweepEverything(page: Page, query: string) {
  let checked = 0;
  const problems: string[] = [];
  const skipped: string[] = [];
  const ready = async () => {
    await expect(page.locator("main button").first()).toBeVisible();
    if (query !== "") {
      await expect(
        page.getByRole("button", { name: "再読み込み" }),
      ).toBeVisible();
    }
  };
  for (const { hash } of PROMISED_URLS) {
    await page.goto(`/${query}${hash}`);
    await ready();
    const found = await page.evaluate(sweep);
    checked += found.checked;
    problems.push(...found.problems.map((p) => `${hash} ${p}`));
    skipped.push(...found.skipped.map((name) => `${hash} ${name}`));
  }
  // 金融は 6 モードで盤面が変わる。**`#finance` の既定(ローン)だけを見ると、
  // 複利の面を見張っていない**(finance-layout.spec.ts と同じ理由)。
  await page.goto(`/${query}#finance`);
  await ready();
  const modes = page
    .getByRole("group", { name: "計算の種類" })
    .getByRole("button");
  await expect(modes).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    await modes.nth(i).click();
    const found = await page.evaluate(sweep);
    checked += found.checked;
    problems.push(...found.problems.map((p) => `#finance mode ${i} ${p}`));
    skipped.push(...found.skipped.map((name) => `#finance mode ${i} ${name}`));
  }
  return { checked, problems, skipped };
}

// **★ 2026-09-30、タブで横にした寸法を足した**（横向きの配置の番人 #8）。
// **ホーム画面の高さ（844×390・667×375）とは別**で、**こちらは 1 画面に収まらない**
// ——`750×342` では床を守ったまま 35px スクロールする（設計書 §2.2.1）。
// **約束は「スクロールすれば全部に届く」**で、それがこの巡回の主張である。
// **`568×320` は横向きの段にすら入らない**（幅 660px 未満）——**積んだ配置のまま**で、
// **そこも「届く」ことを見る。**
for (const size of [
  ...SAFARI_VIEWPORTS,
  ...LANDSCAPE_VIEWPORTS,
  ...LANDSCAPE_TAB_VIEWPORTS,
]) {
  test(`every screen scrolls to all its keys at ${size.width}x${size.height} (${size.device} Safari)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const { checked, problems, skipped } = await sweepEverything(page, "");
    // **何本見たかを主張する**——0 本で緑を返さない。下限は 2026-09-12 に
    // 手元の Chromium で数えた実数(426〜427)。
    //
    // **0.9.3 の D-2 で 1 つ減った(実測 425)。** `sweep` は**押せないキーを
    // 数えない**ので、**開いていない `)` が拒まれるようになったぶん**である
    // ——**減ったのは 1 つだけ**で、それは **Scientific の盤面の `)`**。
    // ほかの盤面(Convert・Scale・Finance)の `(` `)` は**文字を入れるキー**で、
    // engine の `refused` を読むのは `ScientificPanel` だけである。
    //
    // **★ 0.9.6 で 428 になった(実測)。** **この巡回は `PROMISED_URLS` を回す**ので、
    // **`#manual` を約束の表に入れた時点で対象が 13 → 14 画面**になり、
    // **マニュアルの冊を選ぶボタン 3 つ**が増えた。
    // **この数は「押せるものを何個見たか」であって、盤面のキーの数ではない**
    // ——**床が「以上」なので、対象が増えても赤くならない**。**増えた日に
    // 数を据え直さないと、何を数えた数か分からなくなる**（2026-09-23 の教訓。
    // **`#manual` を巡回に入れていたから、貼り付く 1 行がボタンを隠す不具合が
    // 出た**——`covered by <a>` で 4 本赤。**外せばその番人を失う。**）
    //
    // **★ 2026-09-29、横持ち 2 つ（844×390・667×375）を回す寸法に足した**
    // （広い配置の計画 Task 2）。**足したのは寸法であって、画面でもキーでもない**
    // ——**1 寸法あたりの `checked` は変わらない**ので、**床の 428 は据え置く**
    // （「以上」なので、同じ巡回をもう 2 回まわしても赤くならない）。
    // **横持ちは 2026-09-29 まで E2E に 0 件だった**——高さが幅より小さい
    // 組み合わせを、この盤面は 1 度も測っていない。
    // **★ `problems` を先に落とす**（2026-09-30、WebKit の赤で分かった）。
    // **`sweep()` は、引っかかったキーを `problems` に積んで `checked` を
    // 増やさない**——**床を先に撃つと、3 つ足りない理由が `problems` に入って
    // いても印字されないまま段が死ぬ**（走行 36649080955 で実際にそうなった:
    // `checked` が 425 で落ち、`problems` の行は実行されていない）。
    // **説明を持つほうを先に。**
    expect(problems).toEqual([]);
    expect(
      checked,
      `keys checked（押せないので飛ばした ${skipped.length} 個: ${tally(skipped)}）`,
    ).toBeGreaterThanOrEqual(428);
  });
}

// **更新のお知らせが出ているあいだも**(2026-09-12、利用者の裁定 (a))。お知らせは
// 下に固定され、ページの下にその高さぶんの空きが足される(`UpdateToast.tsx`)。
// **直す前は、Safari の高さで 41〜66 個、390×844 でも 5 個のキーがお知らせの下に
// 残った**——だから**ホーム画面の高さ(390×844)も測る。**
for (const size of [
  ...SAFARI_VIEWPORTS,
  { device: "home screen", width: 390, height: 844 },
]) {
  test(`with the update notice up, every key stays reachable at ${size.width}x${size.height} (${size.device})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const { checked, problems, skipped } = await sweepEverything(
      page,
      "?sw-toast=preview",
    );
    // 上と同じ理由で 428(0.9.3 の D-2 と、0.9.6 の `#manual`)。
    // **★ `problems` を先に落とす**（2026-09-30、WebKit の赤で分かった）。
    // **`sweep()` は、引っかかったキーを `problems` に積んで `checked` を
    // 増やさない**——**床を先に撃つと、3 つ足りない理由が `problems` に入って
    // いても印字されないまま段が死ぬ**（走行 36649080955 で実際にそうなった:
    // `checked` が 425 で落ち、`problems` の行は実行されていない）。
    // **説明を持つほうを先に。**
    expect(problems).toEqual([]);
    expect(
      checked,
      `keys checked（押せないので飛ばした ${skipped.length} 個: ${tally(skipped)}）`,
    ).toBeGreaterThanOrEqual(428);
  });
}
