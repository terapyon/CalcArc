import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) =>
  page.getByRole("region", { name: "データスケール計算" });
const echo = (page: Page) => page.getByTestId("display-entry-active");
const result = (page: Page) => page.getByTestId("datascale-result");

async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

/** いま出ている面(数字面・型面・次元数の候補面)の区画。 */
const face_ = (
  page: Page,
  name: "数字と演算のキー" | "データ型のキー" | "次元数の候補キー",
) => panel(page).getByRole("group", { name });

test.beforeEach(async ({ page }) => {
  await page.goto("/#scale/data-scale");
  await expect(panel(page)).toBeVisible();
});

test("all three faces keep 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**誤爆の実害に比例させる**
  // (設計書 §8): 数字・単位・型・次元数の候補の押し間違いは答えを壊すので、
  // メインの枠に載る三面はどれも守る。項目の列だけは押し直せば戻るので
  // 縦を詰める。**測ったキーの件数も主張する**——0 件でも緑になる書き方は
  // しない(予約スロットも disabled な <button> として描かれるので、
  // 面ごとの総数はキー配列の長さと一致する)。
  const checks: Array<
    [string, "数字と演算のキー" | "データ型のキー" | "次元数の候補キー", number]
  > = [
    ["件数を入力", "数字と演算のキー", 25],
    ["次元数を入力", "次元数の候補キー", 15],
    ["データ型を選ぶ", "データ型のキー", 15],
  ];
  for (const [field, name, expectedCount] of checks) {
    await press(page, [field]);
    const buttons = await face_(page, name).getByRole("button").all();
    expect(buttons, `${name} should render its full key set`).toHaveLength(
      expectedCount,
    );
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
});

test("the field row is half height but wide enough", async ({ page }) => {
  const row = panel(page).getByRole("group", { name: "入力する項目" });
  for (const button of await row.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("swapping faces moves neither the frame nor DEL", async ({ page }) => {
  // **同じ枠に載る**(設計書 §2 の【訂正】: 5 列 × 5 行)。候補面は 15 セルで
  // 3 行しか描かれないため、枠は CSS の aspect-ratio が押さえている。
  const seen: {
    face: string;
    box: { width: number; height: number };
    del: { x: number; y: number };
  }[] = [];
  for (const [field, face] of [
    ["件数を入力", "数字と演算のキー"],
    ["次元数を入力", "次元数の候補キー"],
    ["データ型を選ぶ", "データ型のキー"],
  ] as const) {
    await press(page, [field]);
    const box = await face_(page, face).boundingBox();
    const del = await panel(page)
      .getByRole("button", { name: "1文字消去", exact: true })
      .boundingBox();
    seen.push({
      face,
      box: { width: box?.width ?? 0, height: box?.height ?? 0 },
      // **DEL の位置も控える。** 名前が「と DEL」と言っている以上、
      // 在ることではなく**動かないこと**を測る(元の検査がそうだった)。
      del: { x: del?.x ?? -1, y: del?.y ?? -1 },
    });
  }
  expect(seen).toHaveLength(3);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => `${s.del.x},${s.del.y}`));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  expect(seen[0]?.del.x, "DEL was never measured").toBeGreaterThanOrEqual(0);
});

test("the unit keys open only when the entry can take them", async ({
  page,
}) => {
  const k = panel(page).getByRole("button", { name: "千", exact: true });
  const m = panel(page).getByRole("button", { name: "百万", exact: true });
  const g = panel(page).getByRole("button", { name: "十億", exact: true });

  // 数字が無いうちは押せない(設計書 §4)。
  await expect(m).toBeDisabled();
  await press(page, ["1", "0", "0"]);
  await expect(m).toBeEnabled();

  // 百万 のあとに 十億 は無い——単位は下る向きにしか置けない。
  await press(page, ["百万"]);
  await expect(g).toBeDisabled();
  await expect(m).toBeDisabled();
  // 下る向きの 千 は、数字を打てば開く。
  await expect(k).toBeDisabled();
  await press(page, ["5"]);
  await expect(k).toBeEnabled();
});

test("the type face has nothing for DEL to delete", async ({ page }) => {
  await press(page, ["データ型を選ぶ"]);
  await expect(
    panel(page).getByRole("button", { name: "1文字消去", exact: true }),
  ).toBeDisabled();
  // 単位キーは型面に無い。
  await expect(
    panel(page).getByRole("button", { name: "百万", exact: true }),
  ).toHaveCount(0);
});

test("AC returns the type to its default without touching the numbers", async ({
  page,
}) => {
  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await press(page, ["データ型を選ぶ", "int64", "この項目を消去"]);

  await expect(
    panel(page).getByRole("button", { name: "float32", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // 件数はそのまま——AC は打っている項目だけを戻す(設計書 §5)。
  await press(page, ["件数を入力"]);
  await expect(echo(page)).toHaveText("件数 100M");
});

test("the candidate face has nothing for DEL to delete", async ({ page }) => {
  await press(page, ["次元数を入力"]);
  await expect(
    panel(page).getByRole("button", { name: "1文字消去", exact: true }),
  ).toBeDisabled();
});

test("AC clears the dimensions without leaving the candidate face", async ({
  page,
}) => {
  await press(page, ["次元数を入力", "768"]);
  await expect(echo(page)).toHaveText("次元数 768");
  await press(page, ["この項目を消去"]);
  // 面は変えない——次元数だけが空に戻る(型の AC とは違う挙動)。
  await expect(echo(page)).toHaveText("次元数");
  await expect(face_(page, "次元数の候補キー")).toBeVisible();
});

test("the primary-system toggle changes the emphasis, not the bytes", async ({
  page,
}) => {
  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await press(page, ["次元数を入力", "768"]);
  await expect(page.getByTestId("display-main")).toHaveText("307.2 GB");
  await expect(result(page)).toContainText("307,200,000,000 bytes");

  await panel(page)
    .getByRole("button", { name: "2 進 (KiB) を主に", exact: true })
    .click();

  await expect(page.getByTestId("display-main")).toHaveText("286.1 GiB");
  // bytes は動かない。両方の単位系が出ることも変わらない(base-spec §17)。
  await expect(result(page)).toContainText("307,200,000,000 bytes");
  await expect(result(page)).toContainText("307.2 GB");
  await expect(page.getByTestId("datascale-primary")).toHaveText(
    "2 進を主表示",
  );
});
