import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page, label: "Scientific" | "Scale") =>
  page.getByRole("link", { name: label, exact: true });

const panel = (page: Page) =>
  page.getByRole("region", { name: "データスケール計算" });

/** 主表示。主 → 副 → bytes の順に繰り上がった「答え」が出る。 */
const main = (page: Page) => page.getByTestId("display-main");

/** 結果欄。bytes と両方の単位系が並ぶ(base-spec §17)。 */
const result = (page: Page) => page.getByTestId("datascale-result");

/**
 * 盤面のキーを順に押す。**パネル起点で引く**——区画名(「入力する項目」
 * など)は Finance と同名のものがあり、名前だけでは足りない(設計書 §3)。
 */
async function press(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await panel(page).getByRole("button", { name: label, exact: true }).click();
  }
}

/** 数字列をそのまま打つ。単位キーで縮められない桁の並びに使う。 */
const typeDigits = (page: Page, digits: string) => press(page, [...digits]);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
});

test("the nav switches modules both ways and aria-current follows", async ({
  page,
}) => {
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scale")).not.toHaveAttribute("aria-current");

  await nav(page, "Scale").click();
  await expect(page).toHaveURL(/#scale\/data-scale$/);
  await expect(nav(page, "Scale")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scientific")).not.toHaveAttribute("aria-current");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  await nav(page, "Scientific").click();
  await expect(page).toHaveURL(/#scientific$/);
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scale")).not.toHaveAttribute("aria-current");
  await expect(main(page)).toBeVisible();
});

test("a direct link to #scale/data-scale shows the panel immediately", async ({
  page,
}) => {
  // ハッシュルーティング採用理由の検査(a): ディープリンク。
  await page.goto("/#scale/data-scale");
  await expect(panel(page)).toBeVisible();
});

test("reloading a #scale/data-scale deep link keeps the panel visible", async ({
  page,
}) => {
  // ハッシュルーティング採用理由の検査(b): リロード後も同じ画面。
  await page.goto("/#scale/data-scale");
  await expect(panel(page)).toBeVisible();

  await page.reload();
  await expect(panel(page)).toBeVisible();
});

test("browser back returns to Scientific and aria-current follows", async ({
  page,
}) => {
  // ハッシュルーティング採用理由の検査(c): 履歴操作(戻る)にブラウザの
  // 標準動作がそのまま乗る。前の履歴エントリを明示するため、まず
  // #scientific へ明示的に遷移してから Scale へ移る。
  await page.goto("/#scientific");
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");

  await nav(page, "Scale").click();
  await expect(page).toHaveURL(/#scale\/data-scale$/);
  await expect(nav(page, "Scale")).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/#scientific$/);
  await expect(nav(page, "Scientific")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scale")).not.toHaveAttribute("aria-current");
  await expect(main(page)).toBeVisible();
});

test("a link to #scale without a category still shows the panel", async ({
  page,
}) => {
  // このテストが守っているのは「`#scale`(カテゴリを省略したハッシュ)が
  // Scale 系統に解決すること」である。**`DEFAULT_CATEGORY` の値そのもの
  // (`"data-scale"` であること)を守っているのはこのテストではなく
  // `web/src/route.test.ts` の単体テストだけ**——App.tsx は
  // `route.module` しか読んでおらず、`route.category` を読む実装はまだ
  // 無いので、ここでパネルが見えることは既定カテゴリの中身を検査しない。
  await page.goto("/#scale");
  await expect(panel(page)).toBeVisible();
  await expect(nav(page, "Scale")).toHaveAttribute("aria-current", "page");
});

test("the headline case: 100M x 768 x float32 is 307.2 GB / 286.1 GiB", async ({
  page,
}) => {
  // 実 wasm(mock ではない)で通す(完了条件 1)。値は電卓化の前後で
  // 変わらない——変えたのは打ち方だけである。
  await nav(page, "Scale").click();

  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await press(page, ["次元数を入力", "7", "6", "8"]);
  // dtype は既定の float32 のまま。

  await expect(main(page)).toHaveText("307.2 GB");
  await expect(result(page)).toContainText("307,200,000,000 bytes");
  await expect(result(page)).toContainText("286.1 GiB");
});

test("the unit keys expand into plain digits, not a rounded display value", async ({
  page,
}) => {
  // 100M は 100000000 として渡る(base-spec §26)。エコーは打った形
  // 「100M」を見せ、コアへ行くのは展開後の数字列である——両者が
  // 食い違わないことは、答えが 1e8 件ぶんであることで確かめる。
  await nav(page, "Scale").click();

  await press(page, ["件数を入力", "1", "0", "0", "百万"]);
  await expect(page.getByTestId("display-entry-active")).toHaveText(
    "件数 100M",
  );

  await press(page, ["次元数を入力", "1"]);
  await press(page, ["データ型を選ぶ", "int8"]);
  await expect(result(page)).toContainText("100,000,000 bytes");
});

test("a 39-digit count survives the boundary intact", async ({ page }) => {
  // 2^127-1。JS number を経由していれば 2^53 で精度を失う。
  await nav(page, "Scale").click();

  await press(page, ["件数を入力"]);
  await typeDigits(page, "170141183460469231731687303715884105727");
  await press(page, ["次元数を入力", "2"]);
  await press(page, ["データ型を選ぶ", "uint8"]);

  await expect(result(page)).toContainText(
    "340,282,366,920,938,463,463,374,607,431,768,211,454 bytes",
  );
});

test("crossing 2^128 shows an overflow error", async ({ page }) => {
  // 2^127 x 2 x 1 byte = 2^128、u128 の上限を超える(base-spec §25)。
  await nav(page, "Scale").click();

  await press(page, ["件数を入力"]);
  await typeDigits(page, "170141183460469231731687303715884105728");
  await press(page, ["次元数を入力", "2"]);
  await press(page, ["データ型を選ぶ", "uint8"]);

  await expect(main(page)).toHaveText("Math ERROR");
  await expect(main(page)).toHaveAttribute("data-error", "Overflow");
});

test("every field is reachable as a named key", async ({ page }) => {
  // フォームの <label> が担っていた到達性を、キーの読み上げ名が引き継ぐ
  // (設計書 §3)。
  await nav(page, "Scale").click();

  for (const name of ["件数を入力", "次元数を入力", "データ型を選ぶ"]) {
    await expect(
      panel(page).getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
});

test("a partly-filled panel stays neutral, no error shown", async ({
  page,
}) => {
  await nav(page, "Scale").click();

  // 次元数は空のまま。
  await press(page, ["件数を入力", "1", "0", "0", "百万"]);

  await expect(main(page)).toHaveText("");
  await expect(panel(page).locator("[data-error]")).toHaveCount(0);
});

test("a sub-unit success shows bytes without KB/KiB lines", async ({
  page,
}) => {
  // count=1, dimensions=1, int8 -> 1 byte。単位未満なので decimal/binary は
  // 出ず、main は bytes まで繰り上がる(設計書 §6)。
  await nav(page, "Scale").click();

  await press(page, ["件数を入力", "1"]);
  await press(page, ["次元数を入力", "1"]);
  await press(page, ["データ型を選ぶ", "int8"]);

  await expect(main(page)).toHaveText("1 bytes");
  await expect(main(page)).not.toHaveAttribute("data-error");
  // 1 byte で実際に混入しうるのは KB/KiB(次に小さい単位)。GB の否定は
  // KB を含意しない——境界を検査するなら最寄りの単位を否定する。
  await expect(result(page)).not.toContainText("KB");
  await expect(result(page)).not.toContainText("KiB");
});

test("the scientific keyboard listener does not survive into data-scale", async ({
  page,
}) => {
  // useKeyboard は ScientificPanel が unmount されると外れる(App.tsx の
  // 条件レンダリング)。**電卓化で入力欄が無くなったので、旧来の
  // 「入力欄に文字が入るか」という代理検査は使えない。** 代わりに
  // リスナ自体を直接見る: 生きていれば "3" の keydown は
  // preventDefault される(useKeyboard.ts)。dispatchEvent は
  // preventDefault されたとき false を返す。
  const keydownPrevented = () =>
    page.evaluate(
      () =>
        !window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "3",
            cancelable: true,
            bubbles: true,
          }),
        ),
    );

  // **まず陽性を確かめる。** Scientific に居るあいだは捕まるはずで、
  // これが true にならないなら以下の false は「リスナが外れた」ではなく
  // 「そもそも検出できていない」を意味する。
  await expect(main(page)).toHaveText("0");
  expect(await keydownPrevented()).toBe(true);

  await nav(page, "Scale").click();
  await expect(panel(page)).toBeVisible();
  expect(await keydownPrevented()).toBe(false);

  // 再マウント後も Scientific は健全である。
  await nav(page, "Scientific").click();
  await expect(main(page)).toHaveText("0");
});

test("the nav tabs are large enough to touch", async ({ page }) => {
  // --touch-target-min は 44px(既存 e2e と同じ流儀)。
  for (const label of ["Scientific", "Scale"] as const) {
    const box = await nav(page, label).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
