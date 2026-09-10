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
    "複利の周期と積立の位置を選ぶ",
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

/**
 * **積立の位置**(設計書 2026-09-03 §5.4)。**既定は期末**であり、
 * 期首は「増える選択肢」であって「正しい答」ではない(§5.4.1)。
 *
 * **3 本とも E2E に置く。** 位置は core → wasm → TS → 画面と 4 層を渡り、
 * **どの層で落としても計算は続く**——落ちた先は「もっともらしい期末の答」
 * である。**端から端まで通す走行だけが、それを見分けられる。**
 */
test("starts on the end of the period with nothing saved", async ({ page }) => {
  // **まっさらな状態の見張り**(設計書 §5.4.6)。`fixtures.ts` の走行は
  // 保存を持たないので、ここに出る位置は `defaultSettings()` の既定である。
  //
  // **見るのは chip である。** 新しい chip は作らず「周期」の値に畳んだ
  // (§5.4.2)ので、既定は `月ごと・期末` として画面に出る。
  const done = page.getByTestId("display-entries-done");
  await expect(done).toContainText("月ごと・期末");
  await expect(done).not.toContainText("期首");
});

test("both timings are on the period face and can be pressed", async ({
  page,
}) => {
  // **面から両方が押せる**。項目行に 7 つ目のキーは入らない(390px で
  // 余白 8.31px・360px ではみ出し 3px。§5.4.2)ので、周期の面の空き
  // スロットに置いてある。**盤面の形は 1px も動かない。**
  await press(page, ["複利の周期と積立の位置を選ぶ"]);
  const face = page.getByRole("group", {
    name: "複利の周期と積立の位置のキー",
  });
  await expect(
    face.getByRole("button", { name: "積立を期末に行う" }),
  ).toBeEnabled();
  await expect(
    face.getByRole("button", { name: "積立を期首に行う" }),
  ).toBeEnabled();
  // 押すと chip が付いてくる。**既定は期末なので、押して変わるのは期首側**。
  // **`display-echo` で受ける**——このとき「周期」は**打っている項目**なので、
  // chip は `display-entries-done` ではなく `display-entry-active` に居る。
  await press(page, ["積立を期首に行う"]);
  await expect(page.getByTestId("display-echo")).toContainText("月ごと・期首");
});

test("the start of the period changes the answer", async ({ page }) => {
  // **カシオ FC-100 の例題 ③**(マニュアル p.45): 毎月 2,500 円・年 6%・
  // 月複利・60 期。**期末 174,386 / 期首 175,257** ——`compound.rs` の
  // `the_casio_fc_100_monthly_example_pins_both_timings` が持つ 2 つの
  // リテラルと同じ値である(境界を渡っても同じ答が出ることを言う)。
  //
  // **2 つとも見る。** 片方だけだと、位置を落とした画面(常に期末)が
  // 期末の 1 本だけで緑になる。
  await press(page, [
    "毎期の積立額を入力",
    "2",
    "5",
    "0",
    "0",
    "年利を入力",
    "6",
    "期間を入力",
    "6",
    "0",
  ]);
  await expect(main(page)).toHaveText("174,386 円");

  await press(page, ["複利の周期と積立の位置を選ぶ", "積立を期首に行う"]);
  await expect(main(page)).toHaveText("175,257 円");

  await press(page, ["積立を期末に行う"]);
  await expect(main(page)).toHaveText("174,386 円");
});
