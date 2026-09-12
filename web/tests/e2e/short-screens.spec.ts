import { PROMISED_URLS } from "../promised-urls";
import { expect, test } from "./fixtures";
import { SAFARI_VIEWPORTS } from "./widths";

/**
 * **画面が低くても崩れない**(2026-09-12、利用者の裁定「崩れないことだけ約束する」。
 * 門 1 の設計書 §1.5、README の文案 §3)。
 *
 * iPhone の Safari のタブで開くと、どの機種でも 1 画面に収まらずスクロールする
 * (手元の Chromium で 127〜165px)。**約束するのは「スクロールすれば、すべての
 * 表示とキーが見えて押せる」こと**で、ここがその番人である。Safari の見える
 * 大きさ 4 つ(`widths.ts` の `SAFARI_VIEWPORTS`)で、約束した 13 画面と金融の
 * 6 モードについて、次の 3 つを見る:
 *
 * - **横にはみ出さない**(ページが横にスクロールしない)
 * - **押せるキーはすべて、スクロールすれば見える**(`disabled` のキーは除く)
 * - **その上に何も重なっていない**——キーの真ん中の点を `elementFromPoint` で
 *   引いて、そのキー(か、その中身)が返ること
 *
 * **Chromium と WebKit で同じ検査である**(エンジンで分岐しない)。
 *
 * **更新のお知らせ(`UpdateToast`)は、ここでは出さない。** 出すと、いまは
 * 下のキーに重なる(2026-09-12 に測った。Safari の高さで 41〜66 個、ホーム画面の
 * 高さ 390×844 でも 5 個)。直すかは利用者の裁定であり、裁定の前に赤い検査を
 * 置かない——設計書 §1.5 に記録してある。
 */
const sweep = () => {
  const out = { checked: 0, problems: [] as string[] };
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth) {
    out.problems.push(
      `scrolls sideways by ${page.scrollWidth - page.clientWidth}px`,
    );
  }
  const main = document.querySelector("main");
  for (const el of Array.from(main?.querySelectorAll("button") ?? [])) {
    const key = el as HTMLButtonElement;
    if (key.disabled || key.getAttribute("aria-disabled") === "true") continue;
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

for (const size of SAFARI_VIEWPORTS) {
  test(`every screen scrolls to all its keys at ${size.width}x${size.height} (${size.device} Safari)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    let checked = 0;
    const problems: string[] = [];
    for (const { hash } of PROMISED_URLS) {
      await page.goto(`/${hash}`);
      await expect(page.locator("main button").first()).toBeVisible();
      const found = await page.evaluate(sweep);
      checked += found.checked;
      problems.push(...found.problems.map((p) => `${hash} ${p}`));
    }
    // 金融は 6 モードで盤面が変わる。**`#finance` の既定(ローン)だけを見ると、
    // 複利の面を見張っていない**(finance-layout.spec.ts と同じ理由)。
    await page.goto("/#finance");
    const modes = page
      .getByRole("group", { name: "計算の種類" })
      .getByRole("button");
    await expect(modes).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await modes.nth(i).click();
      const found = await page.evaluate(sweep);
      checked += found.checked;
      problems.push(...found.problems.map((p) => `#finance mode ${i} ${p}`));
    }
    // **何本見たかを主張する**——0 本で緑を返さない。下限は 2026-09-12 に
    // 手元の Chromium で数えた実数(426〜427)。
    expect(checked, "keys checked").toBeGreaterThanOrEqual(426);
    expect(problems).toEqual([]);
  });
}
