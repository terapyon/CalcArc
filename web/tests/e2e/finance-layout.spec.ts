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
