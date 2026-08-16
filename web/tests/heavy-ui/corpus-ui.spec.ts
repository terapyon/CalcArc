import { expect, type Page, test } from "@playwright/test";
import type { KeyToken } from "../../src/calc";
import {
  classify,
  loadShards,
  partitionCases,
  type ValueCase,
} from "../heavy/corpus";
import { parseDisplay } from "../heavy/display";
import { BUTTON_FOR, SHIFT_ARIA_LABEL } from "./keys";

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

/** 何件通すか。クリックが 1 件ごとに要るので、コアの経路とは桁が違う。 */
const SAMPLE = Number(process.env.HEAVY_UI_SAMPLE ?? "60");

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
  await panel(page)
    .getByRole("button", { name: "オールクリア", exact: true })
    .click();
  for (const key of keys) {
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
  }
}

/** 等間隔に選ぶ。先頭だけ通すと、生成の後半の形をまったく踏まない。 */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) {
    return items;
  }
  const step = items.length / count;
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor(i * step)] as T,
  );
}

const typeable = (testCase: ValueCase) =>
  testCase.keys.every((key) => BUTTON_FOR.has(key as KeyToken));

for (const { name, shard } of loadShards()) {
  const { values } = partitionCases(name, shard.cases);
  const sample = spread(values.filter(typeable), SAMPLE);
  if (sample.length === 0) {
    continue;
  }

  test(`${name}: ${sample.length} cases typed on the real keypad`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(main(page)).toHaveText("0");

    const mismatches: string[] = [];
    for (const testCase of sample) {
      await pressCase(page, testCase.keys);
      const shown = await main(page).innerText();
      let actual: number;
      try {
        actual = parseDisplay(shown);
      } catch (cause) {
        mismatches.push(
          `${testCase.id} (${testCase.expr}): display ${JSON.stringify(shown)} ` +
            `could not be read as a number — ${(cause as Error).message}`,
        );
        continue;
      }
      const verdict = classify(actual, testCase.expect.re, shard.tolerance);
      if (!verdict.passed) {
        mismatches.push(
          `${testCase.id} (${testCase.expr}): typed on the keypad it shows ` +
            `${shown}, but the reference says ${testCase.expect.re} ` +
            `(relative error ${verdict.relativeError.toExponential(3)})`,
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
