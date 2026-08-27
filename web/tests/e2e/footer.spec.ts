import { expect, test } from "./fixtures";

test("the footer shows on every tab, once", async ({ page }) => {
  // **全タブに出す**のが要件である(0.2.0 設計書 §5)。以前は Scientific
  // だけに calcarc-core の版数が出ていた。
  for (const hash of [
    "#scientific",
    "#convert",
    "#scale/data-scale",
    "#finance",
  ]) {
    await page.goto(`/${hash}`);
    const link = page.getByRole("link", { name: /^CalcArc .+ @terapyon$/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/terapyon/CalcArc",
    );
    await expect(page.getByTestId("footer-disclaimer")).toHaveText(
      "計算結果は無保証です。",
    );
  }
});

test("the old core version line is gone", async ({ page }) => {
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(page.getByTestId("core-version")).toHaveCount(0);
});

test("the footer never spills sideways, on any width", async ({ page }) => {
  // **これがフッタに課している唯一の要件である。**
  //
  // ここには 2026-08-25 まで「1 行であること」も書いてあった。**外した。**
  // 1 行かどうかは**文字が何 px 幅か**で決まり、それはフォントで変わる
  // (実測した差は 4.6%: 手元 = 1 文字あたり 32.665 / 幅の広いフォント =
  // 34.18)。**手元で 1 行なら CI でも 1 行、とは言えない**——実際に CI で
  // 2 度落ちた。折り返しを許したので、フォントの差は「行数が 1 か 2 か」に
  // 吸収され、**横あふれは原理的に起きなくなる。**
  //
  // 同じ日に「余裕が 10% 以上あること」という検査も足して、**それも外した。**
  // 余裕は端末のフォントで変わる量で、固定の閾値で縛ると**溢れていない端末で
  // 赤くなる**(CI が 9.0% で落ちた)。閾値を下げれば緑になるが、それは
  // 緩めて通しただけである。**道具ごと捨てた。**
  //
  // **`footer.scrollWidth` を `window.innerWidth` と直接比べる。** ほかの
  // 測り方は効かない:
  //
  // - `footer.scrollWidth − footer.clientWidth` は**常に 0** になる。
  //   `<footer>` は `margin: 0 auto` の flex item で `align-items: stretch`
  //   による伸長を受けず、中身が自分の箱の幅を決める「shrink-to-fit」の箱
  //   だからである(実測: CSS を戻しても 0 のまま。空振り)。
  // - `getBoundingClientRect().right − innerWidth` も使えない。盤面(Keypad
  //   の関数列)が画面より広がっていると、`margin: auto` の中央寄せが祖先の
  //   広がった幅を基準に計算され、フッタの左端が動く(実測: 360px で `right`
  //   が innerWidth より小さくなり、溢れているのに検知できない)。
  // - `document.documentElement.scrollWidth − innerWidth` は**フッタ以外の
  //   溢れも拾う**。320px では Keypad が既に溢れているので、フッタが無実でも
  //   赤くなる。
  //
  // `footer.scrollWidth` はフッタが実際に必要とする幅そのもの(shrink-to-fit
  // の箱では `clientWidth` と一致する)なので、祖先の広がりにも中央寄せの
  // 副作用にも左右されない。
  for (const width of [430, 390, 375, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("display-main")).toBeVisible();

    const spill = await page.getByRole("contentinfo").evaluate((el) => {
      return el.scrollWidth - window.innerWidth;
    });
    expect(
      spill,
      `the footer spills ${spill}px at ${width}px`,
    ).toBeLessThanOrEqual(0);
  }
});
