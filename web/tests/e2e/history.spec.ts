import { expect, type Page, test } from "./fixtures";

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

/**
 * `hist` の到達性と、履歴の面の一続きの経路(開く→出る→戻る)を 1 本で見る
 * (spec §11.2「なぜ 1 本か」)。**なぜ E2E でしか見られないか**は
 * `.superpowers/sdd/2026-09-03-history/task-11-brief.md` の通り: `hist` は
 * `token: null` なので `heavy/tests/ui/reachability.spec.ts` の 4 本のどれも
 * このキーを見ない。`Shift` 自体には `web/src/ui/Keypad/scientific.test.ts:88`
 * という間接の番人があるが、`hist` にはそれが無い。**この 1 本が唯一の番人。**
 */
test("the history key is reachable behind Shift and leads to the history screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");

  // 1. Shift の前に居ない。
  await expect(
    page.getByRole("button", { name: "履歴", exact: true }),
  ).toHaveCount(0);

  // 2. Shift を押すと出る。**空きマスではなく、ラベルを持って出る。**
  await page
    .getByRole("button", { name: "第2面に切り替え", exact: true })
    .click();
  const hist = page.getByRole("button", { name: "履歴", exact: true });
  await expect(hist).toHaveCount(1);
  await expect(hist).toBeEnabled();
  await expect(hist).toHaveText("hist");

  // 3. 押すと履歴の面へ行き、**盤面が消える。**
  await hist.click();
  await expect(page.getByRole("heading", { name: "履歴" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "計算する", exact: true }),
  ).toHaveCount(0);

  // 4. 戻れる。
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(
    page.getByRole("button", { name: "計算する", exact: true }),
  ).toHaveCount(1);
});

test("what is recorded survives AC, and can be removed one at a time or all at once", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["2", "掛ける", "3", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  // **AC では消えない**(設計書 §6)。
  await page.getByRole("button", { name: "全消去", exact: true }).click();
  await page
    .getByRole("button", { name: "第2面に切り替え", exact: true })
    .click();
  await page.getByRole("button", { name: "履歴", exact: true }).click();
  await expect(page.getByText("2 × 3")).toBeVisible();

  await page.getByRole("button", { name: "2 × 3 を削除" }).click();
  await expect(page.getByText("まだ履歴はありません")).toBeVisible();
});

/**
 * Task 14 の記録トグル。**`Settings.history.enabled` を書く経路が実際に
 * 効くこと**を実 WASM で確かめる——vitest 側(`ScientificPanel.test.tsx`)は
 * 偽 `Calc` に対して同じ形の主張を持つが、`heavy/tests/ui/
 * reachability.spec.ts` の 4 本と同じ理由で、盤面からこのチェックボックス
 * まで実際に到達できるかは E2E でしか見られない(`hist` の裏なので)。
 */
test("turning the recording toggle off stops new entries but keeps what was already recorded", async ({
  page,
}) => {
  await page.goto("/");
  // 切る前に 1 件記録しておく。
  await press(page, ["2", "掛ける", "3", "計算する"]);

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByText("2 × 3")).toBeVisible();

  const toggle = page.getByRole("checkbox", {
    name: "今後の計算を記録する",
  });
  // 既定は入(設計書 §7)。
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  // 盤面へ戻り、切った後にもう 1 回計算する。
  await page.getByRole("button", { name: "戻る" }).click();
  await press(page, ["7", "計算する"]);

  // もう一度履歴を開く。**Shift は面が作り直されるたびに解ける**
  // ——「the history key is reachable behind Shift」と同じ形。
  await press(page, ["第2面に切り替え", "履歴"]);

  // 切る前の 1 件だけが残る。切った後の 1 件は積まれていない。
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("2 × 3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "7 = 7 を入力に入れる" }),
  ).toHaveCount(0);
});

/**
 * §13-8(呼び戻しは手打ちと同じ状態になるか)を実 WASM で閉じる。
 *
 * `web/src/ui/ScientificPanel.test.tsx` の同名の検査(vitest)は、digit・
 * dot・neg・exp・ac だけを実装した**手書きの偽 `Calc`** に対して行われた
 * ——`docs/superpowers/sdd/history-HANDOFF.md` §8 はそれを「狭めたが閉じて
 * いない」としており、実 WASM の計算コア(`crates/calcarc-core`)に対する
 * 確認をこの Task 11(E2E)へ持ち越していた。
 *
 * 値は `-0.5`(負・小数の両方を含む、非自明な呼び戻し)を選ぶ:
 * `3 − 3.5 = -0.5`。`mapAnswerToKeys` は仮数の符号を `neg` に写すので、
 * 呼び戻しは `ac, 0, dot, 5, neg` という打鍵列を送る——これは手で
 * 「0」「.」「5」「+/−」と打つのと同じ列である。
 */
test("a recalled negative decimal behaves like the same digits typed by hand, on the real WASM core", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");

  await page.goto("/");
  await expect(display).toHaveText("0");

  // -0.5 を作って記録する。
  await press(page, ["3", "引く", "3", "小数点", "5", "計算する"]);
  await expect(display).toHaveText("-0.5");

  // 履歴から呼び戻す。
  await press(page, ["全消去"]);
  await press(page, ["第2面に切り替え", "履歴"]);
  await page
    .getByRole("button", { name: "3 − 3.5 = -0.5 を入力に入れる" })
    .click();
  await expect(display).toHaveText("-0.5");
  // 呼び戻した直後にもう 1 打鍵する。
  await press(page, ["3"]);
  const recalledThenTyped = await display.textContent();

  // 別に、同じ桁を手で打つ。
  await press(page, ["全消去"]);
  await press(page, ["0", "小数点", "5", "符号を反転", "3"]);
  await expect(display).toHaveText(recalledThenTyped ?? "");
});
