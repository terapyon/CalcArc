import { expect, test } from "@playwright/test";

test("pressing Convert changes the screen", async ({ page }) => {
  // **押して何も起きない面を作らない**(設計書 §5)。0.2.0 の予約スロットは
  // 押せるように見えて無反応だった。ここは押せば画面が変わる。
  await page.goto("/");
  await page.getByRole("link", { name: "Convert", exact: true }).click();
  // **href は既定カテゴリまで書く**(設計書 §3)。U-1 で convert に
  // カテゴリが付いたので、タブの行き先は `#convert/length` である。
  await expect(page).toHaveURL(/#convert\/length$/);
  await expect(
    page.getByRole("region", { name: "単位変換（準備中）" }),
  ).toBeVisible();
});

test("the placeholder text is actually readable", async ({ page }) => {
  // **見え方は意味の検査では捕まらない**——0.2.0 の更新トーストは role も
  // 寸法もフォーカスも緑のまま、白地に白のボタンだった。だから計算済み
  // スタイルで「背景と文字の色が違う」ことを固定する。
  await page.goto("/#convert");
  const heading = page.getByText("単位変換は準備中です。");
  await expect(heading).toBeVisible();

  const seen = await heading.evaluate((el) => {
    const own = getComputedStyle(el);
    const panel = getComputedStyle(el.parentElement as HTMLElement);
    return {
      color: own.color,
      opacity: own.opacity,
      panelBg: panel.backgroundColor,
      pageBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  expect(seen.color).not.toBe(seen.panelBg);
  expect(seen.panelBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(seen.panelBg).not.toBe(seen.pageBg);
  expect(Number(seen.opacity)).toBe(1);
});

test("the old #data-scale link lands on Scientific", async ({ page }) => {
  // **互換は作らない**(設計書 §1-4、クローズドβ)。知らないハッシュとして
  // 既定に倒れる——これは仕様であって、壊れているのではない。
  await page.goto("/#data-scale");
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(
    page.getByRole("link", { name: "Scientific", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
