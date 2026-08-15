import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });
const echo = (page: Page) => page.getByTestId("display-echo");

async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#finance");
  await expect(panel(page)).toBeVisible();
});

test("the number pad keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**誤爆の実害に比例させる**
  // (設計書 §8): 数字と単位の押し間違いは金額を壊すのでここは守る。モードと
  // 項目は押し直せば戻るので縦だけ詰める。緩めた理由をここに書いておかないと、
  // 次に読む人が「うっかり緩めた」と読む。
  const pad = panel(page).getByRole("group", { name: "数字と単位のキー" });
  for (const button of await pad.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the mode and field rows are half height but wide enough", async ({
  page,
}) => {
  for (const name of ["求めるもの", "入力する項目"]) {
    const row = panel(page).getByRole("group", { name });
    for (const button of await row.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeLessThan(44);
    }
  }
});

test("the unit keys open only when the entry can take them", async ({
  page,
}) => {
  const man = panel(page).getByRole("button", { name: "万", exact: true });
  const oku = panel(page).getByRole("button", { name: "億", exact: true });

  // 数字が無いうちは押せない(設計書 §5)。
  await expect(man).toBeDisabled();
  await press(page, ["3", "0", "0", "0"]);
  await expect(man).toBeEnabled();

  // 万 のあとに 億 は無い——単位は下る向きにしか置けない。
  await press(page, ["万"]);
  await expect(oku).toBeDisabled();
  await expect(man).toBeDisabled();
});

test("each field opens only the keys its value can hold", async ({ page }) => {
  const dot = panel(page).getByRole("button", { name: "小数点" });
  const zeros = panel(page).getByRole("button", { name: "3桁のゼロ" });
  const man = panel(page).getByRole("button", { name: "万", exact: true });

  // 金額: 小数点は無い(parse_yen が拒否する)。
  await expect(dot).toBeDisabled();
  await expect(zeros).toBeEnabled();

  // 年利: 小数点だけ。000 も単位も無い。
  await press(page, ["年利を入力"]);
  await expect(dot).toBeEnabled();
  await expect(zeros).toBeDisabled();
  await expect(man).toBeDisabled();

  // 期間: 整数の月数。小数点も単位も無い。
  await press(page, ["返済期間を入力"]);
  await expect(dot).toBeDisabled();
  await expect(man).toBeDisabled();
  await expect(zeros).toBeEnabled();
});

test("a field tab shows what that field already holds", async ({ page }) => {
  // フォームを廃した以上、入力を確かめる経路はここしかない(設計書 §7)。
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
  ]);
  await expect(echo(page)).toHaveText("年利 1.5%");
  await press(page, ["借入額を入力"]);
  await expect(echo(page)).toHaveText("借入額 3000万円");
});

test("DEL walks back one stage, AC clears only the active field", async ({
  page,
}) => {
  await press(page, ["借入額を入力", "1", "億", "2", "0", "0", "0"]);
  await expect(echo(page)).toHaveText("借入額 1億2000円");

  // 入力中の数字があれば 1 文字、無ければ直前のセグメントを解く。
  await press(page, ["1文字消去"]);
  await expect(echo(page)).toHaveText("借入額 1億200円");

  // AC はいま打っている項目だけを消す(設計書 §5)。
  await press(page, ["年利を入力", "1", "小数点", "5", "この項目を消去"]);
  await expect(echo(page)).toHaveText("年利");
  await press(page, ["借入額を入力"]);
  await expect(echo(page)).toHaveText("借入額 1億200円");
});

test("the mode and the active field are the only pressed keys", async ({
  page,
}) => {
  // 数字に aria-pressed が付くと、読み上げが全キーをトグルとして扱う。
  await expect(
    panel(page).getByRole("button", { name: "月々の返済額を求める" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).getByRole("button", { name: "借入額を入力" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).getByRole("button", { name: "7", exact: true }),
  ).not.toHaveAttribute("aria-pressed");
});

test("a residual left in another mode does not block the bonus", async ({
  page,
}) => {
  // 排他は月額モードだけ(設計書 §6)。モードを行き来した人だけがボーナスを
  // 打てなくなる、という退行を防ぐ。
  await press(page, ["残価を入力", "1", "2", "0", "0", "万"]);
  await expect(
    panel(page).getByRole("button", { name: "ボーナス返済分（元本）を入力" }),
  ).toBeDisabled();

  await press(page, ["借入可能額を求める"]);
  await expect(
    panel(page).getByRole("button", { name: "ボーナス回の返済額を入力" }),
  ).toBeEnabled();
});

test("every key is a button with an accessible name", async ({ page }) => {
  // base-spec §43。div にハンドラを付けた実装を弾く。
  const buttons = panel(page)
    .getByRole("group", { name: /求めるもの|入力する項目|数字と単位のキー/ })
    .getByRole("button");
  await expect(buttons).toHaveCount(25); // 3 + 6 + 16
  for (const button of await buttons.all()) {
    const name = await button.getAttribute("aria-label");
    expect(name?.length ?? 0).toBeGreaterThan(0);
  }
});
