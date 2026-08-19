import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) =>
  page.getByRole("region", { name: "LLM のメモリ計算" });

/**
 * **ボタン名は実物の aria-label(Task 8 の `llm.ts`)に合わせてある。**
 * plan の brief に書かれていた文字列("パラメータ数を選ぶ"、候補キーの
 * "27B"/"8K" など)は、実際の `FIELD_ARIA_LABELS` / `valueKey` の出力
 * (「〜を入力」、候補の読み上げ名は展開済みの数そのもの)と食い違って
 * いた——LlmPanel.test.tsx の同じ注記を参照。ここでも同じ修正を反映する。
 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#scale/llm");
  await expect(panel(page)).toBeVisible();
});

test("the headline case: 27B INT4 with an 8K context", async ({ page }) => {
  for (const [field, value] of [
    ["パラメータ数を入力", "27000000000"],
    ["重みの精度を選ぶ", "INT4"],
    ["KVヘッド数を入力", "16"],
    ["ヘッド次元を入力", "128"],
    ["文脈長を入力", "8192"],
    ["KVの精度を選ぶ", "FP16"],
  ] as const) {
    await panel(page).getByRole("button", { name: field, exact: true }).click();
    await panel(page).getByRole("button", { name: value, exact: true }).click();
  }
  await press(page, ["層数を入力", "6", "2"]);
  await expect(page.getByTestId("llm-result")).toContainText(
    "17,660,749,568 bytes",
  );
  await expect(page.getByTestId("display-main")).toHaveText("17.7 GB");
});

test("the keys hold 44px on every face", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**7 つの面すべてを回る**
  // (Global Constraints)——LLM は面が最も多いパネルで、1 つでも漏らすと
  // その面だけ枠が伸び縮みしても誰も気づかない。**測ったキーの件数も
  // 主張する**——0 件でも緑になる書き方はしない(件数は `llm.ts` の
  // `buildCandidateFace` / `llmPad` から実測した値)。
  const checks: Array<[string, string, number]> = [
    ["層数を入力", "数字と演算のキー", 25],
    ["パラメータ数を入力", "パラメータ数の候補キー", 15],
    ["重みの精度を選ぶ", "重みの精度のキー", 10],
    ["KVヘッド数を入力", "KVヘッド数の候補キー", 15],
    ["ヘッド次元を入力", "ヘッド次元の候補キー", 10],
    ["文脈長を入力", "文脈長の候補キー", 15],
    ["KVの精度を選ぶ", "KVの精度のキー", 10],
  ];
  let measured = 0;
  for (const [field, faceName, expectedCount] of checks) {
    await panel(page).getByRole("button", { name: field, exact: true }).click();
    const face = panel(page).getByRole("group", { name: faceName });
    const buttons = await face.getByRole("button").all();
    expect(buttons, `${faceName} should render its full key set`).toHaveLength(
      expectedCount,
    );
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      measured += 1;
    }
  }
  // **件数の下限も主張する。** 7 面 × 実測件数の合計が 0 なら、ループが
  // 何も測っていないのに緑になる。
  expect(measured).toBe(25 + 15 + 10 + 15 + 10 + 15 + 10);
});

test("a candidate key says its number out loud", async ({ page }) => {
  // jsdom はアクセシビリティツリーを組み立てない(CLAUDE.md)。
  // 「8K と書いてあるキーの読み上げ名が 8192 である」は実ブラウザで見る。
  await panel(page)
    .getByRole("button", { name: "文脈長を入力", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "8192", exact: true }),
  ).toHaveText("8K");
});
