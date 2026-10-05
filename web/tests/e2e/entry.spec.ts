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
  // **`=` まで出す**（利用者の裁定 2026-10-03。**答えは足さない**）。
  await expect(page.getByTestId("display-echo")).toHaveText("3 + 4 × =");
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
  // ——`30` → `sin(30)` → `sin(30) ×` → `sin(30) × 2` で 4 回、前の内容ごと読み直す。
  // **答えの欄（`display-main`）は `polite` のまま。**
  // **jsdom では見えない**ので、ここで実ブラウザに当てる。
  await press(page, ["3", "0", "サイン"]);
  // **印が頭に付く**（三角キーを使った行。この本の主題ではないが、
  // **綴りを厳密一致で撃っているので印も書く**）。
  await expect(page.getByTestId("display-echo")).toHaveText("DEG sin(30)");
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
  // **穴が 2 つ在った**——**打鍵中は印を付けておらず**（`sin(30)` のまま）、
  // **前の行の印が残っていた**（三角の行の次に `3 + 4` を打つと `DEG 3 + 4`）。
  // **閉じた行だけを見ていたので、どちらも緑を通り抜けていた。**
  const echo = page.getByTestId("display-echo");

  await press(page, ["3", "0", "サイン"]);
  await expect(echo).toHaveText("DEG sin(30)");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG sin(30) =");
  await expect(page.getByTestId("display-main")).toHaveText("0.5");

  // **四則だけの行には出ない——前の行の印も残らない。**
  await press(page, ["全消去", "3", "足す", "4"]);
  await expect(echo).toHaveText("3 + 4");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("3 + 4 =");

  // **極形式に切り替えた次の行には出る**（答えの見え方がモードに依るので）。
  await press(page, ["全消去", "極形式と直交形式を切り替え", "3", "足す", "4"]);
  await expect(echo).toHaveText("DEG 3 + 4");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG 3 + 4 =");
});

test("the typed trail folds nothing, unlike the engine's echo", async ({
  page,
}) => {
  // **利用者の例**（2026-10-03）: 「**`30 sin × 2 =` と打ったら
  // `30 sin × 2 = 1` と残る**」（当時の綴り。1.2.1 から `sin(30) × 2 =`）。**engine の `echo` は `0.5 × 2` と畳む。**
  await press(page, ["3", "0", "サイン", "掛ける", "2"]);
  await expect(page.getByTestId("display-echo")).toHaveText("DEG sin(30) × 2");
  await press(page, ["計算する"]);
  await expect(page.getByTestId("display-echo")).toHaveText(
    "DEG sin(30) × 2 =",
  );
  await expect(page.getByTestId("display-main")).toHaveText("1");
});

test("a function right after an operator writes the screen value in the trail", async ({
  page,
}) => {
  // **関数表記の設計書 §5.4**: 本番の経路が画面の列を core に添えていること。
  // **添え忘れると行に `…` が出る**（`spell(keys)` は列が無ければ `…` を書く）。
  // **`x²` は `2 × 3` ではなく、押した時点の画面の値 6 にかかる**（裁定 1）——
  // **web が画面を積んでいなければ、`6²` と書けない。** 実 wasm で撃つ。
  await press(page, ["2", "掛ける", "3", "足す", "2乗", "計算する"]);
  await expect(page.getByTestId("display-echo")).toHaveText("2 × 3 + 6² =");
});

test("既知の欠陥を固定したもの。直したら期待値を「0 × 3 =」に替える: ( ) DEL DEL × 3 = の行", async ({
  page,
}) => {
  // **既知の欠陥を固定したもの。直したら期待値を「0 × 3 =」に替える**
  // （1.2.0 から出荷済み。監視役の裁定 2026-10-05）。
  // **前置の判定が `)` で固まる**——`ScientificPanel` の `press` は `)` を押した時点で
  // 「前の答えを頭に置くか」を決め（そのときの `answerOnScreen` は偽）、`DEL` がその `)` を
  // 消しても未決に戻らない。engine は `( ) DEL DEL` で `answer_on_screen` が真に戻り、
  // `×` は画面の 0 を左辺に取る（答えは 0）。だから行は頭の `0` を落として `× 3 =` になる。
  // **core 側の数（`engine_values.rs` の `frozen_carry` = 54）は web の判定の写しを読む**
  // ので、web だけ直しても赤くならない——**実 wasm で web そのものを撃つのはここ**である。
  await press(page, [
    "開き括弧",
    "閉じ括弧",
    "1文字消去",
    "1文字消去",
    "掛ける",
    "3",
    "計算する",
  ]);
  await expect(page.getByTestId("display-main")).toHaveText("0");
  await expect(page.getByTestId("display-echo")).toHaveText("× 3 =");
});

test("the line stops at the equals sign and never carries the answer", async ({
  page,
}) => {
  // **利用者の裁定（2026-10-03）**: 「**`30 sin × 2 ＝ 1` ですが、答えは出さずに
  // `=` 記号までを表示しましょう**」。**答えの欄と役割が重なる**ためである。
  //
  // **肯定形と否定形の両方で撃つ**——**「答えを足す」実装は 1 行で戻せるので、
  // 黙って戻る**（[[fixes-inherit-the-defects-shape]]）。
  const echo = page.getByTestId("display-echo");

  // **① `=` で終わる**（等値で）。
  await press(page, ["3", "0", "サイン", "掛ける", "2", "計算する"]);
  await expect(echo).toHaveText("DEG sin(30) × 2 =");
  await expect(page.getByTestId("display-main")).toHaveText("1");

  // **② 行の中に答えが現れない。** **`1` のような 1 文字では弱い**ので、
  // **答えが長い列で撃つ**——`4 ÷ 3 =` は `1.333333333`。
  // **答えは画面から読む**（**期待値に書き写すと、桁数の約束が変わった日に
  // 「答えが出ていない」の主張ごと腐る**）。
  await press(page, ["全消去", "4", "割る", "3", "計算する"]);
  await expect(echo).toHaveText("4 ÷ 3 =");
  const answer = await page.getByTestId("display-main").textContent();
  // **0 件で緑にしない**——答えが読めていなければ、下の `not.toContain` は
  // 空文字を探して必ず緑になる。
  expect(answer?.length ?? 0).toBeGreaterThan(5);
  expect(await echo.textContent()).not.toContain(answer);
});

test("the mark names the mode that drew the line, not the mode at the equals", async ({
  page,
}) => {
  // **レビュー役が見つけた欠陥**（2026-10-03、条件 B1）。**`=` の瞬間のモードを
  // 読んでいたので、行のあいだに【DRG】を押すと印が嘘になった。**
  //
  // **`sin(30)` を DEG で計算してから RAD に切り替え、`× 2 =`**:
  // **答えは 1**（`sin 30° = 0.5` で計算済み——**切り替えは画面の数を変えない**）、
  // **状況の行は RAD**（いまのモードだから正しい）、
  // **しかし行の印は DEG でなければならない**——**その `sin` を描いたのは DEG である。**
  const echo = page.getByTestId("display-echo");

  await press(page, [
    "3",
    "0",
    "サイン",
    "角度の単位を切り替え",
    "掛ける",
    "2",
  ]);
  // **打鍵中から DEG である**（切り替えても、既に描かれた `sin` は DEG のまま）。
  await expect(echo).toHaveText("DEG sin(30) × 2");
  // **状況の行は、いまのモードを出す**——**2 つは別のことを言っている。**
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");

  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG sin(30) × 2 =");
  await expect(page.getByTestId("display-main")).toHaveText("1");
});

test("a line that used both modes names both, in the order they were used", async ({
  page,
}) => {
  // **裁定 2026-10-03**（監視役経由）。**「最初の 1 つ」は偽だった**
  // ——**`sin(30) 【DRG】 + sin(30) =` の行に `DEG` とだけ出すと、後半の `sin`
  // について嘘になる。** **「印を出さない」も採れない**: **「印の無い行は
  // モードに依らない」を約束している**（設計書 §4.1.2、(iv) が 3 案に
  // 勝った理由の 4 つ目）。**残るのは両方書くことだけ**で、
  // **それが唯一の正直な形**である。
  const echo = page.getByTestId("display-echo");

  await press(page, [
    "3",
    "0",
    "サイン",
    "角度の単位を切り替え",
    "足す",
    "3",
    "0",
    "サイン",
  ]);
  await expect(echo).toHaveText("DEG/RAD sin(30) + sin(30)");
  await press(page, ["計算する"]);
  await expect(echo).toHaveText("DEG/RAD sin(30) + sin(30) =");

  // **同じモードを 2 回使った行は、1 つに畳む。**
  await press(page, ["全消去", "3", "0", "サイン", "足す", "6", "0", "サイン"]);
  await expect(echo).toHaveText("RAD sin(30) + sin(60)");
});
