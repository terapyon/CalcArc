import { expect, type Page, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

test("Exp types an exponent and the sign key follows it", async ({ page }) => {
  await press(page, ["1", "小数点", "5", "指数入力", "3"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e3");
  await press(page, ["符号を反転"]);
  await expect(page.getByTestId("display-main")).toHaveText("1.5e-3");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-main")).toHaveText("0.0015");
});

test("the sign key still negates a committed value", async ({ page }) => {
  // 指数入力中でなければ従来どおり(設計書 §2 の 2 階層)。
  await press(page, ["4", "符号を反転"]);
  await expect(page.getByTestId("display-main")).toHaveText("-4");
});

test("the triple zero key is live now", async ({ page }) => {
  await press(page, ["1", "3桁のゼロ"]);
  await expect(page.getByTestId("display-main")).toHaveText("1000");
});

test("j after digits turns the entry imaginary", async ({ page }) => {
  await press(page, ["3", "虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("3j");
  await press(page, ["虚数単位"]);
  await expect(page.getByTestId("display-main")).toHaveText("3");
});

test("the echo line shows what was typed, and keeps it after =", async ({
  page,
}) => {
  // **1.2 で、この行は engine の `echo`（畳んだスタック）ではなく、
  // 打鍵の綴りを見せる**（入力経歴の設計書 §2）。**`=` のあとも消えない。**
  await press(page, ["3", "足す", "4", "掛ける"]);
  await expect(page.getByTestId("display-echo")).toHaveText("3 + 4 ×");
  await press(page, ["計算する"]);
  // **直す前はここが空になっていた**（engine の `echo` は `=` で空になる——
  // その挙動は変えていない。`engine_table.rs` の
  // `the_echo_shows_the_pending_expression` がいまも固定している）。
  await expect(page.getByTestId("display-echo")).toHaveText("3 + 4 ×");
  // **`3 + 4 × =` は 3 + 4×4 = 19**（`=` が右辺を補う。`engine_table.rs` の
  // `an_equals_with_a_dangling_operator_repeats_the_right_operand` の形）。
  await expect(page.getByTestId("display-main")).toHaveText("19");
  // **次のキーで、前の答えから始まる新しい行に替わる。**
  await press(page, ["掛ける"]);
  await expect(page.getByTestId("display-echo")).toHaveText("19 ×");
  // **AC で空になる。**
  await press(page, ["全消去"]);
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});

test("the typed trail is not announced on every key", async ({ page }) => {
  // **読み上げは `off` のまま**（1.2、入力経歴の設計書 §4.2 の裁定）。
  // **打鍵ごとに式全体を読み上げると、読み上げが追いつかない**
  // ——`30` → `30 sin` → `30 sin ×` → `30 sin × 2` で 4 回、前の内容ごと読み直す。
  // **答えの欄（`display-main`）は `polite` のまま。**
  // **jsdom では見えない**ので、ここで実ブラウザに当てる。
  await press(page, ["3", "0", "サイン"]);
  // **印が頭に付く**（三角キーを使った行。この本の主題ではないが、
  // **綴りを厳密一致で撃っているので印も書く**）。
  await expect(page.getByTestId("display-echo")).toHaveText("DEG 30 sin");
  // **属性そのものが付いていない**（付いていない ＝ `off`）。
  // **`polite` を足したら赤くなる形**で撃つ。
  expect(
    await page.getByTestId("display-echo").getAttribute("aria-live"),
  ).toBeNull();
  expect(
    await page.getByTestId("display-entry-active").getAttribute("aria-live"),
  ).toBeNull();
  await expect(page.getByTestId("display-main")).toHaveAttribute(
    "aria-live",
    "polite",
  );
});

test("the trail marks the lines that the angle mode drew", async ({ page }) => {
  // **印を出すのは「モードで描いた行」**（1.2、入力経歴の設計書 §4.1.2）。
  // **(a) その行が三角キーを使ったか、(b) その行の答えを極形式で見せているか。**
  // **「モードが答えを変えた場所」ではない**——極形式の `3 + 4 =` は `7 ∠ 0` で、
  // θ = 0 なのでどのモードでも同じ答えだが、印は付く（保守的に出る）。
  // **★ 打っている最中の行も、閉じた行と同じ規則で撃つ**（2026-10-03）。
  // **穴が 2 つ在った**——**打鍵中は印を付けておらず**（`30 sin` のまま）、
  // **前の行の印が残っていた**（三角の行の次に `3 + 4` を打つと `DEG 3 + 4`）。
  // **閉じた行だけを見ていたので、どちらも緑を通り抜けていた。**
  const echo = page.getByTestId("display-echo");

  await press(page, ["3", "0", "サイン"]);
  await expect(echo).toHaveText("DEG 30 sin");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG 30 sin");
  await expect(page.getByTestId("display-main")).toHaveText("0.5");

  // **四則だけの行には出ない——前の行の印も残らない。**
  await press(page, ["全消去", "3", "足す", "4"]);
  await expect(echo).toHaveText("3 + 4");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("3 + 4");

  // **極形式に切り替えた次の行には出る**（答えの見え方がモードに依るので）。
  await press(page, ["全消去", "極形式と直交形式を切り替え", "3", "足す", "4"]);
  await expect(echo).toHaveText("DEG 3 + 4");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG 3 + 4");
});

test("the typed trail folds nothing, unlike the engine's echo", async ({
  page,
}) => {
  // **利用者の例**（2026-10-03）: 「**`30 sin × 2 =` と打ったら
  // `30 sin × 2 = 1` と残る**」。**engine の `echo` は `0.5 × 2` と畳む。**
  await press(page, ["3", "0", "サイン", "掛ける", "2"]);
  await expect(page.getByTestId("display-echo")).toHaveText("DEG 30 sin × 2");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-echo")).toHaveText("DEG 30 sin × 2");
  await expect(page.getByTestId("display-main")).toHaveText("1");
});
