import { expect, type Page, test } from "@playwright/test";
import type { KeyToken } from "../../../web/src/calc";
import { type ComplexValue, parseComplexDisplay } from "../corpus/complex";
import { classifyComplex } from "../corpus/corpus";
import { parseDisplay } from "../corpus/display";
import { BUTTON_FOR, SHIFT_ARIA_LABEL } from "./keys";
import { type PressOrigin, recordPress, recordTypedCase } from "./presses";
import { displaySelections, valueSelections } from "./sampling";

/**
 * **コーパスの代表を、本物のボタンで押す。**
 *
 * 計算コアの経路は 1 万件超を回すが、`dispatch` を直接呼ぶので
 * 「そのキーが盤面のどこにあるか」を一度も通らない。ここはその逆で、
 * **件数は少ないが、利用者と同じ道を通る。**
 *
 * 期待値も許容もコアの経路と同じものを使う——ここで別の基準を作ると、
 * 「UI 経路だけ通る」という意味の無い緑が生まれる。
 */

/**
 * **どのケースを打つかは `sampling.ts` が決める。**
 *
 * 選び方をここに書かないのは、`globalTeardown` が「何を打つつもりだったか」を
 * 同じ関数から読むためである。網羅はコアの経路が担う——ここが確かめるのは
 * 「盤面から打てるか」と「打った結果が画面に正しく出るか」である。
 */

/** ボタンは page から直接引く(既存の科学計算 E2E と同じ作法)。 */
const panel = (page: Page) => page;
const main = (page: Page) => page.getByTestId("display-main");

/**
 * ケースを 1 つ、盤面から打つ。
 *
 * **Shift の面は押すたびに戻る前提で扱わない。** 面の状態は engine ではなく
 * UI が持つので、ここでは「裏のキーを押す直前に Shift を押す」だけを行い、
 * 面がどう戻るかは UI の仕様に任せる——**その仕様を写すと UI の移植になる。**
 * 押した結果が合っていれば、面の扱いも正しかったことになる。
 */
async function pressCase(page: Page, keys: string[]): Promise<void> {
  // **クリアのボタンも対応表から引く。** ここだけ名前を手書きしていて、
  // 実在しない「オールクリア」を押しに行き、存在しないボタンを待ち続けた
  // ——実際の名前は「全消去」だった。**手書きは 1 箇所でも腐る。**
  //
  // **この `ac` は harness の後始末であって、ケースが踏んだキーではない。**
  // 区別せずに数えると、`AC` を押したという主張は何をしても緑になる。
  await pressToken(page, "ac", "harness");
  await resetDisplayState(page);
  for (const key of keys) {
    await pressToken(page, key, "case");
  }
}

/**
 * **表示の状態を初期値に戻す。`AC` では戻らない。**
 *
 * `AC` が消すのは値と保留演算で、**角度モードと記法は残る**——電卓として
 * 正しい挙動である(利用者が Rad にしたのに、消すたび Deg に戻ったら困る)。
 *
 * ここはそれを踏んだ。角度モードのシャードは各ケースの先頭で
 * `angle_toggle` を 1 回押すので、1 件目で Rad、2 件目で Deg、3 件目で Rad…
 * と交互になり、**100 件中 50 件が Deg で評価されて落ちた**(2026-08-17)。
 * コアの経路は 1 ケースごとに engine を作り直すので同じ問題が起きず、
 * **盤面を通る走行にしか現れない欠陥**だった。
 *
 * 直し方として「押した回数を数えて辻褄を合わせる」は採らない——それは
 * ケース側の知識を harness に写すことで、写し損ねれば静かにずれる。
 * **画面に出ている状態を読んで、既定に戻す。**
 */
async function resetDisplayState(page: Page): Promise<void> {
  if ((await page.getByTestId("display-angle").innerText()).trim() !== "DEG") {
    await pressToken(page, "angle_toggle", "harness");
  }
  if ((await page.getByTestId("display-notation").innerText()).trim() !== "") {
    await pressToken(page, "eng", "harness");
  }
  // **表示形式も残る。** 段階 J で `▸∠` を押すようになって同じことが起きた
  // ——直交形式を期待するケースが `511,105 ∠ 0` を見せ、極形式を期待する
  // ケースが `410,758j` を見せた。前のケースが極形式のまま終わっていたのが
  // 原因で、engine の欠陥ではない(モードが残るのは電卓として正しい)。
  if ((await page.getByTestId("display-form").innerText()).trim() !== "") {
    await pressToken(page, "polar_toggle", "harness");
  }
  // **戻ったことを確かめる。** 戻らないまま進むと、以後の全ケースが
  // 静かに別のモードで評価される。
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
  await expect(page.getByTestId("display-notation")).toHaveText("");
  await expect(page.getByTestId("display-form")).toHaveText("");
}

/**
 * キートークンを 1 つ押す。**名前は必ず対応表から引く。**
 *
 * 押した事実をディスクへ記録する(`presses.ts`)。**押せることと押したことは
 * 別の主張である**——`reachability.spec.ts` は前者を、`globalTeardown` は
 * 後者を見る。
 */
async function pressToken(
  page: Page,
  key: string,
  origin: PressOrigin,
): Promise<void> {
  const button = BUTTON_FOR.get(key as KeyToken);
  if (button === undefined) {
    throw new Error(
      `corpus-ui: key token ${JSON.stringify(key)} has no button on the ` +
        "scientific keypad, so this case cannot be typed by a person",
    );
  }
  if (button.needsShift) {
    await panel(page)
      .getByRole("button", { name: SHIFT_ARIA_LABEL, exact: true })
      .click();
  }
  await panel(page)
    .getByRole("button", { name: button.ariaLabel, exact: true })
    .click();
  // **押してから記録する。** 先に記録すると、押せなかったキーが台帳に載る。
  recordPress(key, origin);
}

for (const { name, sample, tolerance } of valueSelections()) {
  test(`${name}: ${sample.length} cases typed on the real keypad`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(main(page)).toHaveText("0");

    const mismatches: string[] = [];
    for (const testCase of sample) {
      await pressCase(page, testCase.keys);
      recordTypedCase(name);
      const shown = await main(page).innerText();
      // **読み手は期待値が選ぶ。コアの経路とまったく同じ規則である**
      // (`corpus.spec.ts` の同じ箇所を見よ)。`parseDisplay` は実数の書式
      // だけを受け付ける番人なので、実数のシャードはこれまでどおりそこを通る。
      const complexExpected = testCase.expect.im !== 0;
      let actual: ComplexValue;
      try {
        actual = complexExpected
          ? parseComplexDisplay(shown)
          : { re: parseDisplay(shown), im: 0 };
      } catch (cause) {
        mismatches.push(
          `${testCase.id} (${testCase.expr}): display ${JSON.stringify(shown)} ` +
            `could not be read as a number — ${(cause as Error).message}`,
        );
        continue;
      }
      const verdict = classifyComplex(actual, testCase.expect, tolerance);
      if (!verdict.passed) {
        mismatches.push(
          `${testCase.id} (${testCase.expr}): typed on the keypad it shows ` +
            `${shown}, but the reference says ${testCase.expect.re}` +
            (complexExpected
              ? `${testCase.expect.im < 0 ? "-" : "+"}j${Math.abs(testCase.expect.im)}`
              : "") +
            ` (relative error ${verdict.relativeError.toExponential(3)})`,
        );
      }
    }

    expect(
      mismatches,
      `${name}: ${mismatches.length} of ${sample.length} cases disagreed when ` +
        "typed on the real keypad. The core path runs the same cases without " +
        "the UI — if that one is green and this one is not, the fault is " +
        "between the keypad and the display, not in the calculation.",
    ).toEqual([]);
  });
}

test("AC clears the value but not the angle mode — which is why each case resets", async ({
  page,
}) => {
  // **`resetDisplayState` が要る理由を、実物で固定する。**
  //
  // これが無いと、`resetDisplayState` は「念のため」の一手に見える。実際には
  // これを外した瞬間、角度モードのシャードは 1 件おきに Deg で評価され、
  // 100 件中 50 件が落ちた。**「AC で戻る」という思い込みが原因**だったので、
  // 戻らないことそのものをここで主張する。
  //
  // これは engine の欠陥ではない——利用者が Rad にしたのに消すたび Deg に
  // 戻る電卓のほうが困る。**harness の側が合わせるべき**という裁定である。
  await page.goto("/");
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");

  await pressToken(page, "angle_toggle", "harness");
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");

  await pressToken(page, "ac", "harness");
  await expect(main(page)).toHaveText("0");
  // **値は消えたが、モードは残っている。**
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");

  // `resetDisplayState` はこれを画面から読んで戻す。
  await resetDisplayState(page);
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
});

for (const { name, sample } of displaySelections()) {
  test(`${name}: ${sample.length} displays typed on the real keypad`, async ({
    page,
  }) => {
    // **表示のトグルは、盤面を通してこそ意味がある。**
    //
    // `ENG` と `°'"` は値を変えないので、コアの経路では「押した効果」を
    // 表示文字列でしか主張できない。その表示を**本物の画面から読む**のが
    // ここである——`parseDisplay` は通さない。通すと桁区切りや指数の
    // 書き方の違いが消えてしまい、確かめたいことがちょうど失われる。
    await page.goto("/");
    await expect(main(page)).toHaveText("0");

    const mismatches: string[] = [];
    for (const testCase of sample) {
      await pressCase(page, testCase.keys);
      recordTypedCase(name);
      const got = (await main(page).innerText()).trim();
      if (got !== testCase.expect.main) {
        mismatches.push(
          `${testCase.id} (${testCase.expr}): the screen shows ` +
            `${JSON.stringify(got)}, the reference expected ` +
            `${JSON.stringify(testCase.expect.main)}`,
        );
      }
    }

    expect(
      mismatches,
      `${name}: ${mismatches.length} of ${sample.length} displays disagreed ` +
        "when typed on the real keypad. These are exact string comparisons of " +
        "what a person would actually see on screen.",
    ).toEqual([]);
  });
}
