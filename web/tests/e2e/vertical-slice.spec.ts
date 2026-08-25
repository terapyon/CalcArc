import { expect, type Locator, type Page, test } from "@playwright/test";

/** 画面のボタンを順に押す。 */
async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

const main = (page: Page) => page.getByTestId("display-main");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
});

test("the headline case: 3 + 4j becomes 5 ∠ 53.13010235", async ({ page }) => {
  await press(page, ["3", "足す", "虚数単位", "4", "計算する"]);
  await expect(main(page)).toHaveText("3+4j");

  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");
});

test("the same calculation from the physical keyboard", async ({ page }) => {
  // デスクトップで使えること(base-spec §50)。
  await page.keyboard.type("3+4j");
  await page.keyboard.press("Enter");
  await expect(main(page)).toHaveText("3+4j");

  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");
});

test("the polar toggle is a display change, not a calculation", async ({
  page,
}) => {
  await press(page, ["3", "足す", "虚数単位", "4", "計算する"]);
  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("5 ∠ 53.13010235");

  // 表示は 8 桁に丸められているが、保持している値は 3+4j のまま。
  await press(page, [
    "掛ける",
    "開き括弧",
    "1",
    "足す",
    "虚数単位",
    "2",
    "閉じ括弧",
    "計算する",
  ]);
  await press(page, ["極形式と直交形式を切り替え"]);
  await expect(main(page)).toHaveText("-5+10j");
});

test("operator precedence follows the algebraic convention", async ({
  page,
}) => {
  await page.keyboard.type("2+3*4=");
  await expect(main(page)).toHaveText("14");
});

test("functions apply to the displayed value immediately", async ({ page }) => {
  await press(page, ["3", "0", "サイン"]);
  await expect(main(page)).toHaveText("0.5");
});

test("the square root of a negative number is a domain error", async ({
  page,
}) => {
  // **かつては 2j だった。** 関数を実数に閉じる裁定で落とした
  // (S-1 設計書 §1 の裁定 1)。複素数は入力と四則と表示の機能であって、
  // 関数の値域ではない——下の複素数の行はそのまま生きている。
  await press(page, ["4", "符号を反転", "平方根"]);
  await expect(main(page)).toHaveText("Math ERROR");
  await expect(main(page)).toHaveAttribute("data-error", "DomainError");
});

test("an error is shown and cleared with AC", async ({ page }) => {
  await page.keyboard.type("1/0=");
  await expect(main(page)).toHaveText("Math ERROR");
  await expect(main(page)).toHaveAttribute("data-error", "DivisionByZero");

  await press(page, ["全消去"]);
  await expect(main(page)).toHaveText("0");
  await expect(main(page)).not.toHaveAttribute("data-error");

  await page.keyboard.type("7=");
  await expect(main(page)).toHaveText("7");
});

test("the angle mode is shown and switchable", async ({ page }) => {
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
  await press(page, ["角度の単位を切り替え"]);
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");
});

test("every key is a button with an accessible name", async ({ page }) => {
  // base-spec §43。div にハンドラを付けた実装を弾く。
  // キーパッドは 3 区画に分かれている(関数列 7 + 第 2 関数列 7 + メイングリッド 25)。
  const buttons = page
    .getByRole("group", { name: /関数キー|第 2 関数列|数字と演算のキー/ })
    .getByRole("button");
  await expect(buttons).toHaveCount(39);
  for (const button of await buttons.all()) {
    const name = await button.getAttribute("aria-label");
    expect(name?.length ?? 0).toBeGreaterThan(0);
  }
});

test("the status indicators are exposed as named status regions", async ({
  page,
}) => {
  // jsdom はアクセシビリティツリーを組み立てないので、role が img のような
  // 「子要素を刈る」ロールに戻っても vitest では気づけない。実際に一度
  // それが起きている。実ブラウザでロールと名前から引き当てて防ぐ。
  await press(page, ["3", "足す", "開き括弧"]);
  await expect(
    page.getByRole("status", { name: "計算の途中経過" }),
  ).toContainText("+");
  await expect(page.getByRole("status", { name: "角度の単位" })).toHaveText(
    "DEG",
  );
  // ENG インジケータも同じ status 行にいる(eng-notation.spec.ts の専用
  // 検査とは別に、ここが status 行を列挙する場所であることを確かめる)。
  await expect(page.getByRole("status", { name: "数の表記" })).toBeEmpty();
});

test("high contrast keeps the destructive key distinguishable", async ({
  page,
}) => {
  // 高コントラストは色相を奪うので、明暗の反転と枠線で区別している。
  // ここが戻ると AC が演算子と同じ見た目になり、押し間違いが起きて
  // 困る箇所で手がかりが消える(base-spec §43)。
  await page.emulateMedia({ contrast: "more" });

  // 高コントラストが本当に効いていることを先に確かめる。これがないと
  // テストが通る理由を取り違える。通常テーマでも 3 種類のキーは
  // 背景色で区別できる(#ffffff / #d8e6ff / #ffd8d8)ので、
  // 「互いに異なる」という判定だけでは @media ブロックを丸ごと
  // 消しても通ってしまう。
  await expect
    .poll(() =>
      page.evaluate(() => matchMedia("(prefers-contrast: more)").matches),
    )
    .toBe(true);

  const appearance = (key: Locator) =>
    key.evaluate((el) => {
      const s = getComputedStyle(el);
      return [
        s.backgroundColor,
        s.color,
        s.borderTopWidth,
        s.borderTopStyle,
      ].join("|");
    });

  const ac = await appearance(page.getByRole("button", { name: "全消去" }));
  const add = await appearance(page.getByRole("button", { name: "足す" }));
  const digit = await appearance(
    page.getByRole("button", { name: "7", exact: true }),
  );

  // 高コントラストでのみ成り立つ値に固定する。--key-accent-bg は
  // #d8e6ff から #000000 に、--key-fg は #1c1c1e から #000000 に変わる。
  // 背景が両テーマとも白の --key-bg は判別に使えない。
  expect(add).toContain("rgb(0, 0, 0)");
  expect(digit).toContain("rgb(0, 0, 0)");

  // AC と数字キーは配色が同じで、太い二重枠だけが違う。
  // この 3 つが互いに異なることが、押し間違いの手がかりが
  // 残っているということ。
  expect(ac).not.toBe(add);
  expect(ac).not.toBe(digit);
  expect(add).not.toBe(digit);
});

test("touch targets are large enough", async ({ page }) => {
  // --touch-target-min は 44px。メイングリッドのキーで見る(関数列は
  // 縦だけ意図的に割る——設計書 §4。全キーの検査は keypad-shell.spec.ts)。
  const key = page.getByRole("button", { name: "7", exact: true });
  const box = await key.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
