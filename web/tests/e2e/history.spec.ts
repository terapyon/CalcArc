import { expect, type Page, test } from "./fixtures";

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

/**
 * `hist` の到達性と、履歴の面の一続きの経路(開く→出る→戻る)を 1 本で見る
 * (spec §11.2「なぜ 1 本か」)。**なぜ E2E でしか見られないか**は
 * `.superpowers/sdd/2026-09-03-history/task-11-brief.md` の通り: `hist` は
 * `token: null` なので重量級側の到達性検査の 4 本のどれもこのキーを見ない。
 * `Shift` 自体には間接の番人がある——重量級側の到達性検査にある
 * `the keys behind Shift appear only after Shift is pressed` という名前の
 * テストが、実際に `Shift` を押して裏のキーが出ることを見る。`hist` には
 * それが無い。**この 1 本が唯一の番人。**
 */
test("the history key is reachable behind Shift and leads to the history screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");

  // 1. Shift の前に居ない。
  await expect(
    page.getByRole("button", { name: "履歴", exact: true }),
  ).toHaveCount(0);

  // 2. Shift を押すと出る。**空きマスではなく、ラベルを持って出る。**
  await page
    .getByRole("button", { name: "第2面に切り替え", exact: true })
    .click();
  const hist = page.getByRole("button", { name: "履歴", exact: true });
  await expect(hist).toHaveCount(1);
  await expect(hist).toBeEnabled();
  await expect(hist).toHaveText("hist");

  // 3. 押すと履歴の面へ行き、**盤面が消える。**
  await hist.click();
  await expect(page.getByRole("heading", { name: "履歴" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "計算する", exact: true }),
  ).toHaveCount(0);

  // 4. 戻れる。
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(
    page.getByRole("button", { name: "計算する", exact: true }),
  ).toHaveCount(1);
});

test("what is recorded survives AC, and can be removed one at a time or all at once", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["2", "掛ける", "3", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  for (const name of ["5", "足す", "6", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  // **AC では消えない**(設計書 §6)。
  await page.getByRole("button", { name: "全消去", exact: true }).click();
  await page
    .getByRole("button", { name: "第2面に切り替え", exact: true })
    .click();
  await page.getByRole("button", { name: "履歴", exact: true }).click();
  await expect(page.getByText("2 × 3")).toBeVisible();
  await expect(page.getByText("5 + 6")).toBeVisible();

  // 1 件ずつ——2 件のうち片方だけが消える。
  await page.getByRole("button", { name: "2 × 3 を削除" }).click();
  await expect(page.getByText("2 × 3")).not.toBeVisible();
  await expect(page.getByText("5 + 6")).toBeVisible();

  // 全消し——残りも消える。
  await page.getByRole("button", { name: "すべて消す" }).click();
  await expect(page.getByText("まだ履歴はありません")).toBeVisible();
});

/**
 * Task 14 の記録トグル。**`Settings.history.enabled` を書く経路が実際に
 * 効くこと**を実 WASM で確かめる——vitest 側(`ScientificPanel.test.tsx`)は
 * 偽 `Calc` に対して同じ形の主張を持つが、重量級側の到達性検査の 4 本と
 * 同じ理由で、盤面からこのチェックボックスまで実際に到達できるかは
 * E2E でしか見られない(`hist` の裏なので)。
 */
test("turning the recording toggle off stops new entries but keeps what was already recorded", async ({
  page,
}) => {
  await page.goto("/");
  // 切る前に 1 件記録しておく。
  await press(page, ["2", "掛ける", "3", "計算する"]);

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByText("2 × 3")).toBeVisible();

  const toggle = page.getByRole("checkbox", {
    name: "今後の計算を記録する",
  });
  // 既定は入(設計書 §7)。
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  // 盤面へ戻り、切った後にもう 1 回計算する。
  await page.getByRole("button", { name: "戻る" }).click();
  await press(page, ["7", "計算する"]);

  // もう一度履歴を開く。**Shift は面が作り直されるたびに解ける**
  // ——「the history key is reachable behind Shift」と同じ形。
  await press(page, ["第2面に切り替え", "履歴"]);

  // 切る前の 1 件だけが残る。切った後の 1 件は積まれていない。
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("2 × 3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "7 = 7 を入力に入れる" }),
  ).toHaveCount(0);
});

/**
 * §13-8(呼び戻しは手打ちと同じ状態になるか)を実 WASM で閉じる。
 *
 * `web/src/ui/ScientificPanel.test.tsx` の同名の検査(vitest)は、digit・
 * dot・neg・exp・ac だけを実装した**手書きの偽 `Calc`** に対して行われた
 * ——`docs/superpowers/sdd/history-HANDOFF.md` §8 はそれを「狭めたが閉じて
 * いない」としており、実 WASM の計算コア(`crates/calcarc-core`)に対する
 * 確認をこの Task 11(E2E)へ持ち越していた。
 *
 * 値は `-0.5`(負・小数の両方を含む、非自明な呼び戻し)を選ぶ:
 * `3 − 3.5 = -0.5`。`mapAnswerToKeys` は仮数の符号を `neg` に写すので、
 * 呼び戻しは `ac, 0, dot, 5, neg` という打鍵列を送る——これは手で
 * 「0」「.」「5」「+/−」と打つのと同じ列である。
 */
test("a recalled negative decimal behaves like the same digits typed by hand, on the real WASM core", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");

  await page.goto("/");
  await expect(display).toHaveText("0");

  // -0.5 を作って記録する。
  await press(page, ["3", "引く", "3", "小数点", "5", "計算する"]);
  await expect(display).toHaveText("-0.5");

  // 履歴から呼び戻す。
  await press(page, ["全消去"]);
  await press(page, ["第2面に切り替え", "履歴"]);
  await page
    .getByRole("button", { name: "3 − 3.5 = -0.5 を入力に入れる" })
    .click();
  await expect(display).toHaveText("-0.5");
  // 呼び戻した直後にもう 1 打鍵する。
  await press(page, ["3"]);
  const recalledThenTyped = await display.textContent();

  // 別に、同じ桁を手で打つ。
  await press(page, ["全消去"]);
  await press(page, ["0", "小数点", "5", "符号を反転", "3"]);
  await expect(display).toHaveText(recalledThenTyped ?? "");
});

/**
 * **H-3 を実 WASM で閉じる。** `crates/calcarc-core/src/engine/mod.rs:29`
 * 「エラー中は AC 以外を受け付けない。」——engine が状態に反映しなかった
 * 打鍵を式として記録すると、**その行は自分の答を作れない**(設計書 §0)。
 *
 * vitest 側(`web/src/ui/ScientificPanel.test.tsx`)は偽 `Calc` にこの規則を
 * 写して同じ形の主張を持つが、**その規則を写したのは私自身**である。実物の
 * `1 ÷ 0` が本当にエラーになり、実物の `spell` が本当に「1 ÷ 0」と綴ることは
 * ここでしか確かめられない。
 */
test("keys the engine threw away after an error do not become a recorded expression", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");
  await page.goto("/");
  await expect(display).toHaveText("0");

  // エラーは `=` の瞬間に起きる。この計算自体は 1 件として記録されてよい
  // ——式「1 ÷ 0」は答「Math ERROR」を説明している。
  await press(page, ["1", "割る", "0", "計算する"]);
  await expect(display).toHaveText("Math ERROR");

  // ここから先は engine が 1 打鍵も受け取らない。
  await press(page, ["7", "足す", "8", "計算する"]);
  await expect(display).toHaveText("Math ERROR");

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1 ÷ 0")).toBeVisible();
  // 直す前はここに「7 + 8 = Math ERROR」の行が在った。
  await expect(page.getByText("7 + 8")).toHaveCount(0);
});

/**
 * **H-3 の「関連」を実 WASM で閉じる。** `Buffer::push_dot`
 * (`crates/calcarc-core/src/engine/state.rs`)は入力に既に `.` があると
 * `SyntaxError` を返すので、`1 . 5 .` は **`=` を待たずに**エラー状態へ入る。
 * エラーが `=` 以外のキーで起きたこの経路では `=` 自身が捨てられるため、
 * **1 件も積まれない**のが正しい。
 */
test("an error raised in the middle of an entry records nothing", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");
  await page.goto("/");
  await expect(display).toHaveText("0");

  await press(page, ["1", "小数点", "5"]);
  await expect(display).toHaveText("1.5");
  await press(page, ["小数点"]);
  await expect(display).toHaveText("Math ERROR");

  await press(page, ["7", "足す", "8", "計算する"]);
  await expect(display).toHaveText("Math ERROR");

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByText("まだ履歴はありません")).toBeVisible();
});

/**
 * **H-4 を実 WASM で閉じる。** 前回の答を引き継ぐキーは二項演算子だけでは
 * ない——`√` も `+/−` も `apply_unary`
 * (`crates/calcarc-core/src/engine/mod.rs:269`)で `state.current` を読む。
 * 引き継ぐ側を式の左辺に補わないと、式「√」・答「2」という**自分の答を
 * 作れない行**が残る(設計書 §0)。
 *
 * **これが `ScientificPanel.tsx` の `CARRIED_VALUE_TOKENS` の唯一の番人**
 * である。TypeScript から engine は呼べない(jsdom に WASM は無い)ので、
 * あの集合が engine の腕の列挙と一致していることを機械で見張るものは無い。
 * ここでは 14 の後置関数のうち 2 つ(`√`・`+/−`)を実物に通す——**14 は
 * `apply_unary` の同じ 1 行を共有する**ので、その行の性質が変わればこの
 * 2 つが赤くなる。
 */
test("a chain continued by a postfix function or the sign key records the carried answer", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");
  await page.goto("/");
  await expect(display).toHaveText("0");

  // 3 + 1 = 4、そのあと √ が 4 を引き継いで 2 になる。
  await press(page, ["3", "足す", "1", "計算する"]);
  await expect(display).toHaveText("4");
  await press(page, ["平方根"]);
  await expect(display).toHaveText("2");
  await press(page, ["計算する"]);

  // AC で連鎖を切ってから、符号キーの側を作る。
  await press(page, ["全消去", "3", "足す", "4", "計算する"]);
  await expect(display).toHaveText("7");
  await press(page, ["符号を反転"]);
  await expect(display).toHaveText("-7");
  await press(page, ["計算する"]);

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByText("4 √")).toBeVisible();
  await expect(page.getByText("7 +/−")).toBeVisible();
  // 直す前はこの 2 行の式が「√」と「+/−」だけだった。
  await expect(page.getByText("√", { exact: true })).toHaveCount(0);
  await expect(page.getByText("+/−", { exact: true })).toHaveCount(0);
});

/**
 * **H-5 を実 WASM で閉じる。** 呼び戻し(`recall`)は、盤面の他の操作と違って
 * **1 つのハンドラの中で `ac` と答のキーを同期に連打する**——「1 打鍵 = 1 つの
 * 離散イベント」という前提の唯一の例外である。門番が engine の状態を effect で
 * 写した ref から読んでいた版では、その写しはハンドラの途中で更新されないので、
 * **`ac` は通るのに続く呼び戻しのキーが式に積まれなかった**(engine には
 * `dispatch` で全部届くため、表示だけが進む)。
 *
 * ここで見るのは**エラー表示のまま呼び戻して続きを打つ**という 1 経路。直す前は
 * 式「+ 3」・答「5」という、**自分の答を作れない行**が残っていた(設計書 §0)。
 * jsdom 側の同じ検査は `web/src/ui/ScientificPanel.test.tsx` の
 * 「records the keys a recall sent while the display was in an error state」。
 * **こちらは実 WASM を通す**ので、`1 . 5 .` が本当にエラーで終わること・
 * 呼び戻した `2` が本当に engine の入力に入ることまで込みで見る。
 */
test("a recall made while the display was in an error state still becomes part of the expression", async ({
  page,
}) => {
  const display = page.getByTestId("display-main");
  await page.goto("/");
  await expect(display).toHaveText("0");

  // 1 件記録してから、入力の途中でエラーへ入る。
  await press(page, ["2", "計算する"]);
  await expect(display).toHaveText("2");
  await press(page, ["1", "小数点", "5", "小数点"]);
  await expect(display).toHaveText("Math ERROR");

  // **エラー表示のまま**履歴を開いて呼び戻す。
  await press(page, ["第2面に切り替え", "履歴"]);
  await page.getByRole("button", { name: "2 = 2 を入力に入れる" }).click();
  // 呼び戻し自体は直す前も効いていた——engine には届くからである。
  await expect(display).toHaveText("2");

  await press(page, ["足す", "3", "計算する"]);
  await expect(display).toHaveText("5");

  await press(page, ["第2面に切り替え", "履歴"]);
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("2 + 3")).toBeVisible();
  // 直す前はここに「+ 3 = 5」の行が在った。
  await expect(page.getByText("+ 3", { exact: true })).toHaveCount(0);
});
