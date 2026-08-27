import { expect, type Page, test } from "./fixtures";

/**
 * 複利の**正算**を実 wasm で通す。
 *
 * 逆算は `finance-inverse.spec.ts` が覆っているが、正算は E2E が 1 件も無かった
 * ——盤面から複利を打って答が出ることを、誰も端から端まで確かめていなかった。
 *
 * 期待値はすべて `testdata/finance.json` の `compound_grow` ケースと同じ値である。
 * **golden にある値だけを使う**——ここで新しい数を作ると、E2E が独自の期待値を
 * 持つことになり、コアと golden の突き合わせから外れる。
 */

const nav = (page: Page, label: "Scientific" | "Finance") =>
  page.getByRole("link", { name: label, exact: true });

// **region 起点で引く**——「入力する項目」という区画名は Data Scale にも
// 同名のものがある(loan.spec.ts と同じ流儀)。
const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });

const main = (page: Page) => page.getByTestId("display-main");
const breakdown = (page: Page) => page.getByTestId("finance-breakdown");

/** キーをアクセシブルネームで順に押す。**パネル起点**(region の外は探さない)。 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(main(page)).toHaveText("0");
  await nav(page, "Finance").click();
  await press(page, ["複利で増やす"]);
});

test("compounds a lump sum every half year", async ({ page }) => {
  // golden: P=1,000,000 / 年 1% / 半年複利 / 10 期 → 1,051,136。
  // **周期の面を通る唯一の E2E である**——「計算に入るものは盤面の中」という
  // 規律で面が入れ替わるキーなので、押して効くことをここで確かめる。
  // 丸めない方式なら 1,051,140 になる: 各期切り捨てが効いていることの証拠でもある。
  await press(page, [
    "元本を入力",
    "1",
    "0",
    "0",
    "万",
    "年利を入力",
    "1",
    "複利の周期を選ぶ",
    "半年ごとに複利",
    "期間を入力",
    "1",
    "0",
  ]);

  await expect(main(page)).toHaveText("1,051,136 円");
  await expect(breakdown(page)).toContainText("51,136 円"); // 運用収益
});

test("shows the take-home first when the tax is on", async ({ page }) => {
  // golden: 積立 3 万 / 年 3% / 月次 / 240 期・税あり → 手取り 9,310,782。
  // **税ありは手取りを一番大きく出す**(A の裁定 Q5)。税引前 9,848,906 は
  // 内訳に回る——答と内訳が入れ替わることを画面で固定する。
  // 国税と地方税を**別々に**切り捨てた値であることも、内訳で見える。
  await press(page, [
    "毎期の積立額を入力",
    "3",
    "万",
    "年利を入力",
    "3",
    "期間を入力",
    "2",
    "4",
    "0",
    "税の扱いを選ぶ",
    "源泉分離課税を引く",
  ]);

  await expect(main(page)).toHaveText("9,310,782 円");
  await expect(breakdown(page)).toContainText("405,679 円"); // 国税
  await expect(breakdown(page)).toContainText("132,445 円"); // 地方税
  await expect(breakdown(page)).toContainText("9,848,906 円"); // 税引前
});

test("shows the dip that the required-periods answer steps over", async ({
  page,
}) => {
  // **`finance-inverse.spec.ts` の対**である。あちらは同じ入力で「必要年数 = 19 期、
  // 手取り 1,016 円」を出す。こちらは**その次の期**を打って、手取りが 1,015 円に
  // 下がることを見せる。
  //
  // 手取りは期数について単調でない(numerical-policy)——利息 20 円が
  // 0.15315×20 = 3.063 と 0.05×20 = 1.00 の両方の閾値を同時に跨ぐので、
  // 残高が 1 円増える間に税が 2 円増える。**これは仕様であって不具合ではない。**
  // 2 本の E2E が揃って初めて、その主張が画面の側から確かめられる。
  await press(page, [
    "元本を入力",
    "9",
    "9",
    "9",
    "年利を入力",
    "1",
    "小数点",
    "5",
    "期間を入力",
    "2",
    "0",
    "税の扱いを選ぶ",
    "源泉分離課税を引く",
  ]);

  await expect(main(page)).toHaveText("1,015 円"); // 手取り。19 期では 1,016 だった
  await expect(breakdown(page)).toContainText("1,019 円"); // 税引前
});
