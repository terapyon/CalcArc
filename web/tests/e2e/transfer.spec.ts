import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) =>
  page.getByRole("region", { name: "データ転送量計算" });

/**
 * ボタン名は `web/src/ui/Keypad/transfer.ts` の `ariaLabel` そのもの。
 * 単位キーはラベルと読み上げが同じ(`Mbps` は画面でも声でも `Mbps`)なので、
 * ここでは画面の文字がそのまま名前になる。**`exact: true` は外せない**
 * ——Playwright の既定は部分一致で、`bps` が `kbps` にも当たる。
 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test("the headline case: 100 Mbps for three hours", async ({ page }) => {
  await page.goto("/#scale/transfer");
  await expect(panel(page)).toBeVisible();
  await press(page, ["帯域幅を入力", "1", "0", "0"]);
  await press(page, ["帯域幅の単位を選ぶ", "Mbps"]);
  await press(page, ["時間を入力", "3"]);
  await press(page, ["時間の単位を選ぶ", "時"]);
  await expect(page.getByTestId("transfer-result")).toContainText(
    "135,000,000,000 bytes",
  );
  await expect(page.getByTestId("display-main")).toHaveText("135.0 GB");
});

/**
 * 3 つの面 = (項目のボタン名, 面の aria-label, その面のキー数)。
 *
 * 件数は `TRANSFER_PAD` / `buildUnitFace` の配り方から出た実測値
 * (予約スロットも disabled な `<button>` として描かれる)。
 */
const FACES = [
  ["帯域幅を入力", "数字と演算のキー", 25],
  ["帯域幅の単位を選ぶ", "帯域幅の単位のキー", 10],
  ["時間の単位を選ぶ", "時間の単位のキー", 10],
] as const;

test("the keys hold 44px on every face", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**3 つの面すべてを回る**
  // ——1 面でも漏らすと、その面のキーだけ小さくなっても誰も気づかない。
  // **測ったキーの件数も主張する**——0 件でも緑になる書き方はしない。
  //
  // 枠が動かないことは次の検査が見る。**1 本にまとめない**
  // (`llm.spec.ts` の 2 本と同じ形)——「キーが小さい」と「面名が 1 字
  // ずれた」は原因が別なので、テスト名から区別が付くようにしておく。
  await page.goto("/#scale/transfer");
  await expect(panel(page)).toBeVisible();
  let measured = 0;
  for (const [field, faceName, expectedCount] of FACES) {
    await press(page, [field]);
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
  // **件数の下限も主張する。** 合計が 0 なら、ループが何も測っていないのに
  // 緑になる。
  expect(measured).toBe(FACES.reduce((sum, [, , n]) => sum + n, 0));
  expect(measured, "no key was ever measured").toBeGreaterThan(0);
});

test("swapping faces moves neither the frame nor DEL and AC", async ({
  page,
}) => {
  // **3 面が同じ枠に載る**(設計書 §4.2)。`TransferPanel.module.css` は
  // 3 つの aria-label をセレクタに並べているが、1 字ずれるとその面だけ
  // 枠が中身の行数ぶんに伸び縮みする(DataScale で実測済みの事故、19px)。
  // キー 1 個ずつの 44px を見る上の検査は、それでも緑のまま——だから枠
  // そのものと、枠の中で位置が動いてはいけない DEL・AC を突き合わせる。
  await page.goto("/#scale/transfer");
  await expect(panel(page)).toBeVisible();
  const seen: { face: string; box: string; del: string; ac: string }[] = [];
  for (const [field, faceName] of FACES) {
    await press(page, [field]);
    const frame = await panel(page)
      .getByRole("group", { name: faceName })
      .boundingBox();
    const del = await panel(page)
      .getByRole("button", { name: "1文字消去", exact: true })
      .boundingBox();
    const ac = await panel(page)
      .getByRole("button", { name: "この項目を消去", exact: true })
      .boundingBox();
    seen.push({
      face: faceName,
      box: `${frame?.width ?? -1}x${frame?.height ?? -1}`,
      del: `${del?.x ?? -1},${del?.y ?? -1}`,
      ac: `${ac?.x ?? -1},${ac?.y ?? -1}`,
    });
  }
  expect(seen).toHaveLength(FACES.length);
  expect(
    new Set(seen.map((s) => s.box)).size,
    `the frame moved: ${JSON.stringify(seen)}`,
  ).toBe(1);
  expect(
    new Set(seen.map((s) => s.del)).size,
    `DEL moved: ${JSON.stringify(seen)}`,
  ).toBe(1);
  expect(
    new Set(seen.map((s) => s.ac)).size,
    `AC moved: ${JSON.stringify(seen)}`,
  ).toBe(1);
  // **番兵**: 1 度も測っていなければ -1 のまま 1 通りになってしまう。
  // **3 つとも要る**——AC を落とすと、AC が全面で測れなくなった日に
  // `"-1,-1"` が 1 通りに揃って緑のまま通る。
  expect(seen[0]?.box, "the frame was never measured").not.toContain("-1");
  expect(seen[0]?.del, "DEL was never measured").not.toContain("-1");
  expect(seen[0]?.ac, "AC was never measured").not.toContain("-1");
});

test("the deep link lands on transfer with the category selected", async ({
  page,
}) => {
  await page.goto("/#scale/transfer");
  await expect(page.getByRole("combobox", { name: "計算の種類" })).toHaveValue(
    "transfer",
  );
  await expect(panel(page)).toBeVisible();
  // 既定の単位は画面に出ている(`mbps` / `hour` = `Mbps` / `時`)。
  await expect(page.getByTestId("display-echo")).toContainText(
    "帯域幅の単位 Mbps",
  );
  await expect(page.getByTestId("display-echo")).toContainText("時間の単位 時");
});
