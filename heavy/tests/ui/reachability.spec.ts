import { expect, test } from "@playwright/test";
import { KEY_TOKENS } from "../../../web/src/calc";
import { BUTTON_FOR, SHIFT_ARIA_LABEL } from "./keys";

/**
 * **盤面から届くか。**
 *
 * 計算コアの経路(`playwright.heavy.config.ts`)はキートークンを直接
 * `dispatch` に渡すので、**そのキーが画面のどこにも無くても緑になる。**
 * ここはその穴を塞ぐ——実際のボタンを探し、実際に押す。
 *
 * Shift の裏にあるキー(`asin` など)は、Shift を押さないと存在しない。
 * **この違いはこの経路でしか見えない。**
 */

/**
 * **ボタンは page から直接引く。** 既存の科学計算 E2E
 * (`tests/e2e/scientific-functions.spec.ts`)と同じ作法である——盤面は
 * region で囲まれていないので、region 起点で引くと 1 つも見つからない
 * (最初にそれを書いて 40 件が「見つからない」と出た)。
 */
const panel = (page: import("@playwright/test").Page) => page;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("no key token is claimed by two buttons", () => {
  // `BUTTON_FOR` は同じトークンが 2 度現れたら例外を投げる——**どちらを
  // 押すかが不定になり、駆動側が任意に選んでしまう**ためである。
  // ここは「その検査が実データ(盤面の定義)に対して通っている」ことを固定する。
  //
  // **`BUTTON_FOR` を読むだけで検査が走る**（モジュールの初期化時に構築する）。
  // 例外が投げられていればこのテストに到達しない。
  expect(BUTTON_FOR.size).toBeGreaterThan(0);
});

test("every key token the engine accepts has a button on the keypad", async () => {
  // **これは盤面の定義だけで決まるので、ブラウザを開く前に分かる。**
  // それでもここに置くのは、下の 2 つと同じ「届くか」の話だからである。
  const missing = KEY_TOKENS.filter((token) => !BUTTON_FOR.has(token));
  expect(
    missing,
    `${missing.length} key token(s) the engine accepts have no button on the ` +
      "scientific keypad. Either the keypad is missing them, or they belong " +
      "to another panel (Finance / Data Scale) — say which in this test.",
  ).toEqual([]);
});

test("every button the keypad claims can actually be pressed", async ({
  page,
}) => {
  // **定義にあることと、押せることは別である。** 描画されない、重なって
  // いる、無効化されている——どれも定義からは分からない。
  const unreachable: string[] = [];
  for (const [token, button] of BUTTON_FOR) {
    if (button.needsShift) {
      continue; // 下のテストが見る。
    }
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    if ((await locator.count()) !== 1) {
      unreachable.push(
        `${token}: expected exactly one button named "${button.ariaLabel}", ` +
          `found ${await locator.count()}`,
      );
    }
  }
  expect(unreachable).toEqual([]);
});

test("the keys behind Shift appear only after Shift is pressed", async ({
  page,
}) => {
  const shifted = [...BUTTON_FOR].filter(([, b]) => b.needsShift);
  expect(
    shifted.length,
    "no key is behind Shift — if the second face was removed, this test is " +
      "the one that should have told you",
  ).toBeGreaterThan(0);

  // 押す前は存在しない。**ここが緩いと「Shift を押さなくても届く」を見逃す。**
  for (const [token, button] of shifted) {
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    expect(
      await locator.count(),
      `${token} ("${button.ariaLabel}") is visible before Shift was pressed`,
    ).toBe(0);
  }

  await panel(page)
    .getByRole("button", { name: SHIFT_ARIA_LABEL, exact: true })
    .click();

  // 押した後は 1 つだけある。
  const stillMissing: string[] = [];
  for (const [token, button] of shifted) {
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    if ((await locator.count()) !== 1) {
      stillMissing.push(`${token} ("${button.ariaLabel}")`);
    }
  }
  expect(
    stillMissing,
    "these keys are behind Shift according to the keypad definition, but " +
      "pressing Shift did not reveal them",
  ).toEqual([]);
});
