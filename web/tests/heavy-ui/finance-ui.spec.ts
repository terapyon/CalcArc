import { expect, type Page, test } from "@playwright/test";
import { type CallCase, loadCallShards } from "../heavy/corpus";
import {
  type Answer,
  expectedAnswer,
  FACES,
  type FinanceFace,
  keySequence,
  missingOps,
  pickCases,
  readAnswer,
  readNumbers,
} from "./finance-cases";

/**
 * **Finance を実画面から通す**(設計書 2026-08-19 §7.2)。
 *
 * `calls.spec.ts` は finance の 3,500 件を全部照合するが、**`runCalls` を
 * 直接呼ぶ**ので、盤面も表示も一度も通らない。モードキー・項目キー・周期と税の
 * 面の入れ替え・万/億・桁区切り——**利用者が触るものは全部その外側**にある。
 * ここはその外側を、面ごとに 2 件だけ通す。
 *
 * **手で書いた入力をここで作らない。** 16 件はすべて `finance-000.json` の
 * 層から引く(`finance-cases.ts` の `pickCases`)。手書きの期待値は
 * 「コーパスを通した」顔をするので、素性が分からなくなる。
 *
 * **押下の台帳(`presses.ts`)には載らない。** 台帳は科学計算の `KeyToken` を
 * 数えていて、Finance のキーは別の集合(`FinanceKeyToken`)である。載せると
 * `MIN_TYPED_CASES` の下限が Finance の 16 件で嵩上げされ、**打鍵の走行が
 * 痩せたことを隠す**——ここは意図的に `recordPress` を呼ばない。
 */

const panel = (page: Page) => page.getByRole("region", { name: "金融計算" });
const main = (page: Page) => page.getByTestId("display-main");
const breakdown = (page: Page) => page.getByTestId("finance-breakdown");

/** finance のシャードだけを読む(`loadCallShards` は data-scale も返す)。 */
const financeCases: CallCase[] = loadCallShards()
  .filter(({ name }) => name.startsWith("finance-"))
  .flatMap(({ shard }) => shard.cases);

const picks = FACES.map((face) => pickCases(face, financeCases));

/**
 * ケースを 1 件、実画面に打ち込む。
 *
 * **1 件ごとにページから開き直す。** Finance は項目の値をモードをまたいで
 * 持ち回る(借入額・年利・期間は月額モードと借入可能額モードで同じ入れ物で
 * ある)ので、前のケースの残りが次のケースの計算に混ざる。`AC` は
 * **いま打っている項目しか消さない**——`corpus-ui.spec.ts` が角度モードで
 * 踏んだのと同じ形の罠で、直し方も同じである(**画面の状態を仮定せず、
 * 既定から始める**)。
 */
async function typeCase(page: Page, face: FinanceFace, testCase: CallCase) {
  await page.goto("/#finance");
  await expect(panel(page)).toBeVisible();
  for (const name of keySequence(face, testCase)) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

const where = (testCase: CallCase): string =>
  `${testCase.id} (${testCase.stratum ?? "no stratum"})`;

/**
 * **面の一覧がコーパスを覆っているか。**
 *
 * 8 面は手で書いた一覧である。コーパスが 9 つ目の `op` を持った日に、
 * その op は**画面から一度も通らないまま**、ここは緑で居続ける
 * ——それを防ぐのがこの 1 本である。ケースが 0 件のシャードも同時に拒む。
 */
test("the eight faces cover every op the finance corpus carries", () => {
  expect(
    financeCases.length,
    "finance-ui: the finance shards carried no cases at all. Every test " +
      "below would then run zero comparisons and still be green.",
  ).toBeGreaterThan(0);
  const ops = financeCases.map((testCase) => testCase.op);
  expect(
    missingOps(ops),
    "finance-ui: the corpus carries op(s) that no face types on the real " +
      "panel. They are verified by calls.spec.ts through runCalls, but " +
      "nothing checks that a person can reach them on screen.",
  ).toEqual([]);
  expect(picks).toHaveLength(8);
});

for (const { face, normal, error } of picks) {
  test(`${face.op}: ${where(normal)} typed on the real panel`, async ({
    page,
  }) => {
    await typeCase(page, face, normal);

    // **答が出るまで待ってから読む。** `innerText()` は待たないので、最後の
    // 打鍵の再描画が入る前に読むと、空の行を「食い違い」として報告しうる。
    // 待つのは「何か出ること」だけで、**何が出たかはこの下で比べる**。
    await expect(main(page)).not.toHaveText("");
    const shown = (await main(page).innerText()).trim();
    let got: Answer;
    try {
      got = readAnswer(shown);
    } catch (cause) {
      throw new Error(
        `${face.op} ${where(normal)}: ${(cause as Error).message}. The core ` +
          "path runs this same case through runCalls — if that one is green " +
          "and this one is not, the fault is between the keypad and the " +
          "display, not in the calculation.",
      );
    }
    expect(
      got,
      `${face.op} ${where(normal)}: typed on the real panel the answer line ` +
        `reads ${JSON.stringify(shown)}, but the reference says ` +
        `${JSON.stringify(expectedAnswer(face, normal))}`,
    ).toEqual(expectedAnswer(face, normal));

    // **内訳も見る。** 答だけを見ていると、内訳が丸ごと消えても気づかない
    // ——内訳は「なぜその答か」を利用者に見せている唯一の場所である。
    const wanted = face.breakdown(normal);
    expect(
      wanted.filter((value) => value === ""),
      `${face.op} ${where(normal)}: the expectations for the breakdown came ` +
        "out empty, which means this face names a field the corpus does not " +
        "carry. An empty expectation compares nothing.",
    ).toEqual([]);
    expect(wanted.length).toBeGreaterThan(0);
    const numbers = readNumbers(await breakdown(page).innerText());
    for (const value of wanted) {
      expect(
        numbers,
        `${face.op} ${where(normal)}: the breakdown on screen holds ` +
          `${JSON.stringify(numbers)}, and ${value} is not among them. The ` +
          "numbers are read with the digit grouping stripped, so a wrongly " +
          "placed separator also lands here.",
      ).toContain(value);
    }
  });

  test(`${face.op}: ${where(error)} shows the error on the real panel`, async ({
    page,
  }) => {
    // **エラーは `finance-load-error` には出ない。** あれは wasm が読めな
    // かったときの枠で、`failed` の枝でしか描かれない(`FinancePanel` の
    // 早期 return)。計算のエラーは**答の行そのもの**に出る——本文が
    // `Math ERROR` になり、`display-main` が `data-error` に種別を持つ。
    await typeCase(page, face, error);

    const code = String(error.expect.error);
    // **種別を先に見る。** 本文は全種別 `Math ERROR` なので、本文だけを
    // 見ると SyntaxError と Overflow が入れ替わっても緑になる
    // (`errors-000.json` の照合が同じ理由で種別を先に見ている)。
    await expect(
      main(page),
      `${face.op} ${where(error)}: the reference says this case fails with ` +
        `${code}, so the answer line should carry that code in data-error`,
    ).toHaveAttribute("data-error", code);
    await expect(main(page)).toHaveText("Math ERROR");
    // **前の答が残らない。** 内訳が残ったままエラーが出ると、画面は
    // 「エラーなのに根拠がある」という読めない状態になる。
    await expect(breakdown(page)).toHaveCount(0);
  });
}
