import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page, label: "Scientific" | "Data Scale" | "Finance") =>
  page.getByRole("link", { name: label, exact: true });

const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });

const echo = (page: Page) => page.getByTestId("display-entry-active");
const main = (page: Page) => page.getByTestId("display-main");
const breakdown = (page: Page) => page.getByTestId("finance-breakdown");

const scientificMain = (page: Page) => page.getByTestId("display-main");

/** キーをアクセシブルネームで順に押す。 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(scientificMain(page)).toHaveText("0");
});

test("the nav now carries three tabs and aria-current follows", async ({
  page,
}) => {
  await expect(page.getByRole("link")).toHaveCount(3);
  await nav(page, "Finance").click();
  await expect(page).toHaveURL(/#finance$/);
  await expect(nav(page, "Finance")).toHaveAttribute("aria-current", "page");
  await expect(nav(page, "Scientific")).not.toHaveAttribute("aria-current");
  await expect(nav(page, "Data Scale")).not.toHaveAttribute("aria-current");
  await expect(panel(page)).toBeVisible();
  // <main> はシェルの所有物であり、モジュールを跨いでも存在し続ける。
  await expect(page.getByRole("main")).toBeVisible();
});

test("every nav tab is large enough to touch", async ({ page }) => {
  // --touch-target-min は 44px。3 タブになっても縮まないこと。
  for (const label of ["Scientific", "Data Scale", "Finance"] as const) {
    const box = await nav(page, label).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("a direct link to #finance shows the panel, and survives a reload", async ({
  page,
}) => {
  await page.goto("/#finance");
  await expect(panel(page)).toBeVisible();
  await page.reload();
  await expect(panel(page)).toBeVisible();
});

test("the housing case: 30M yen over 420 months at 1.5% is 91,855 a month", async ({
  page,
}) => {
  // 実 wasm(mock ではない)で、golden(finance.json)と同じ値が画面に出る。
  // 電卓化で打ち方は変わったが、**期待値は 1 つも変えていない**。
  await nav(page, "Finance").click();
  await press(page, [
    "借入額を入力",
    "3",
    "0",
    "0",
    "0",
    "万",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "返済期間を入力",
    "4",
    "2",
    "0",
  ]);

  await expect(main(page)).toHaveText("91,855 円");
  await expect(breakdown(page)).toContainText("38,579,007 円"); // 総支払額
  await expect(breakdown(page)).toContainText("8,579,007 円"); // 総利息
});

test("万 and 億 build the amount the way they are typed", async ({ page }) => {
  await nav(page, "Finance").click();
  await press(page, ["借入額を入力", "1", "億", "2", "0", "0", "0", "万"]);
  // エコーは打った通り。桁区切りを入れ直さない(設計書 §7)。
  await expect(echo(page)).toHaveText("借入額 1億2000万円");

  // 同じ値を 12000万 と打っても同じ答になる(加算合成。設計書 §5)。
  await press(page, ["この項目を消去", "1", "2", "0", "0", "0", "万"]);
  await expect(echo(page)).toHaveText("借入額 12000万円");
});

test("the car case: a residual closes the loan at the residual itself", async ({
  page,
}) => {
  // 300 万・5 年・年 3.9%・残価 120 万(golden の車例)。
  await nav(page, "Finance").click();
  await press(page, [
    "借入額を入力",
    "3",
    "0",
    "0",
    "万",
    "年利を入力",
    "3",
    "小数点",
    "9",
    "返済期間を入力",
    "6",
    "0",
    "残価を入力",
    "1",
    "2",
    "0",
    "万",
  ]);

  await expect(main(page)).toHaveText("37,536 円");
  await expect(breakdown(page)).toContainText("1,200,000 円"); // 最終回 = 残価
});

test("the borrowable amount comes back through the term inversion", async ({
  page,
}) => {
  // 85,000 円 × 420 回・1.5% の借入可能額(golden と同じ 27,761,211 円)。
  await nav(page, "Finance").click();
  await press(page, [
    "借入可能額を求める",
    "月々の返済額を入力",
    "8",
    "5",
    "0",
    "0",
    "0",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "返済期間を入力",
    "4",
    "2",
    "0",
  ]);
  await expect(main(page)).toHaveText("27,761,211 円");

  // 同じ額を期間モードに入れると 420 回に戻る。
  await press(page, [
    "返済期間を求める",
    "借入額を入力",
    "2",
    "7",
    "7",
    "6",
    "1",
    "2",
    "1",
    "1",
  ]);
  await expect(main(page)).toHaveText("420 か月");
});

test("the mode selector opens and closes the fields it owns", async ({
  page,
}) => {
  await nav(page, "Finance").click();

  // 月額モード: 求める値の項目は押せない。残価は開く。
  await expect(
    panel(page).getByRole("button", { name: "月々の返済額を入力" }),
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "残価を入力" }),
  ).toBeEnabled();

  await press(page, ["借入可能額を求める"]);
  await expect(
    panel(page).getByRole("button", { name: "借入額を入力" }),
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "残価を入力" }),
  ).toBeDisabled();

  // 期間モード: ボーナスも閉じる(2 列結合の期間は M6 では解かない)。
  await press(page, ["返済期間を求める"]);
  await expect(
    panel(page).getByRole("button", { name: "返済期間を入力" }),
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: /ボーナス.*を入力/ }),
  ).toBeDisabled();
});

test("the disclaimer is always on screen and is not an alert", async ({
  page,
}) => {
  await nav(page, "Finance").click();
  const disclaimer =
    panel(page).getByText(/金融機関の計算方法により異なります/);
  await expect(disclaimer).toBeVisible();
  // 入力しても消えない(結果の有無に関係なく常設)。
  await press(page, [
    "借入額を入力",
    "3",
    "0",
    "0",
    "0",
    "万",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "返済期間を入力",
    "4",
    "2",
    "0",
  ]);
  await expect(disclaimer).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("a payment that cannot cover the interest is reported as an error", async ({
  page,
}) => {
  // 100 万を年 12%(月利息 1 万円)、月々 1 万円 —— 永久に減らない。
  await nav(page, "Finance").click();
  await press(page, [
    "返済期間を求める",
    "借入額を入力",
    "1",
    "0",
    "0",
    "万",
    "年利を入力",
    "1",
    "2",
    "月々の返済額を入力",
    "1",
    "万",
  ]);

  await expect(main(page)).toHaveText("Math ERROR");
  await expect(main(page)).toHaveAttribute("data-error", "SyntaxError");
});

test("a partly-filled loan calculator stays neutral, no error shown", async ({
  page,
}) => {
  await nav(page, "Finance").click();
  await press(page, ["借入額を入力", "3", "0", "0", "0", "万"]);

  await expect(main(page)).toBeEmpty();
  await expect(main(page)).not.toHaveAttribute("data-error");
});

test("typing into the loan keypad does not touch the scientific state", async ({
  page,
}) => {
  // useKeyboard は ScientificPanel が unmount されると外れる。3 モジュールに
  // なっても漏れないことを確かめる(data-scale 版と同型)。電卓化で入力欄は
  // 消えたので、キーを押して echo に入ることで打鍵を確かめる。
  await nav(page, "Finance").click();
  await press(page, ["借入額を入力", "3"]);
  await expect(echo(page)).toHaveText("借入額 3円");

  await nav(page, "Scientific").click();
  await expect(scientificMain(page)).toHaveText("0");
});

test("the old #loan hash is no longer a route", async ({ page }) => {
  // 旧 URL の互換は作らない(設計書 §3、利用者が本人のみのため)。
  // 「効かなくなった」ではなく「そう決めた」と読めるよう仕様として固定する。
  // 第三者が使い始めたら互換分岐を足す——そのときは判断の誤りではなく
  // 状況の変化への対応である(設計書 §3)。
  await page.goto("/#loan");
  // **先に「金融計算が出ていない」を見る。** 互換分岐が生きていると
  // ここで落ちる——後段の「Scientific が見える」だけだと、読み込み中の
  // 表示ゆれで落ちたのか経路が違うのか区別できない(赤確認で実際に
  // そうなった)。
  await expect(panel(page)).toHaveCount(0);
  await expect(scientificMain(page)).toBeVisible();
});
