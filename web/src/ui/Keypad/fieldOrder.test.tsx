import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx と同じ流儀)。**答えは一切見ない**ので、
// 盤面と読み出しが立つだけの最小限でよい。
// **`transfer` は空の結果を返す。** 両方の値が埋まった時点でパネルが
// 呼ぶので、無いと落ちる——ここが見たいのは並びだけなので、答えは空でよい。
vi.mock("../../datascale", () => ({
  initDataScale: () => Promise.resolve({ transfer: () => ({ error: null }) }),
}));
vi.mock("../../expr", () => ({
  initExpr: () =>
    Promise.resolve({
      integer: (text: string) => ({
        value: text === "" ? null : text,
        error: null,
      }),
      percent: () => ({ value: null, error: null }),
    }),
}));

import { LlmPanel } from "../Llm/LlmPanel";
import { TransferPanel } from "../Transfer/TransferPanel";
import { LLM_FIELD_LABELS, LLM_FIELD_SECTION } from "./llm";
import { TRANSFER_FIELD_LABELS, TRANSFER_FIELD_SECTION } from "./transfer";
import type { KeypadSection } from "./types";

/**
 * **項目の並びは、盤面と読み出しで同じである。**
 *
 * LLM と Transfer は、項目の並びを**2 か所に書いていた**——盤面の
 * 項目行(`Keypad/llm.ts` `Keypad/transfer.ts`)と、読み出しの一覧
 * (`LlmPanel.tsx` `TransferPanel.tsx`)。逐語で同じものが 2 つあり、
 * **片方だけ動いても誰も落ちなかった**。
 *
 * 利用者から見ると、これは 1 つの並びである——**項目行を左から押す順**と
 * **読み出しを上から読む順**が食い違うと、押した項目が読み出しのどこに
 * 現れるか分からなくなる。だからここで**その 1 つ**を主張する。
 *
 * **定義ではなく描画で見る。** 定数どうしを突き合わせると、パネルが
 * その定数を実際に読み出しへ使っているかは分からない。ここでは
 * **パネルを描画して、読み出しに出た順**を盤面の項目行と比べる。
 */

/** 項目行が持つ `field:` トークンを、並んでいる順に取り出す。 */
function fieldsOf(section: KeypadSection<string>): string[] {
  return section.keys
    .map((key) => key.token)
    .filter((token): token is string => token !== null)
    .filter((token) => token.startsWith("field:"))
    .map((token) => token.slice("field:".length));
}

/** 読み出しの「入力済み」に出ている項目名を、出ている順に取り出す。 */
function doneLabels(): string[] {
  const done = screen.getByTestId("display-entries-done");
  return [...done.children].map((span) => span.textContent ?? "");
}

describe("項目の並び", () => {
  it("shows the LLM fields in the order the keypad puts them in", async () => {
    const user = userEvent.setup();
    const { container } = render(<LlmPanel />);

    // **層数を打っている状態にする。** 既定では層数だけが空で読み出しに
    // 出ない——ここに出したいのは 7 項目すべてである。
    const layers = container.querySelector<HTMLButtonElement>(
      '[data-token="field:layers"]',
    );
    if (layers === null) throw new Error("層数の項目キーが見つからない");
    await user.click(layers);

    const order = fieldsOf(LLM_FIELD_SECTION);
    expect(order, "the field row should carry all seven").toHaveLength(7);

    // 打っている項目は大きいほうの行に出るので、入力済みの行には残り 6 つ。
    const expected = order
      .filter((field) => field !== "layers")
      .map((field) => LLM_FIELD_LABELS[field as keyof typeof LLM_FIELD_LABELS]);
    const shown = doneLabels();
    expect(shown).toHaveLength(expected.length);
    expect(shown.map((text) => text.split(" ")[0])).toEqual(expected);
  });

  it("shows the transfer fields in the order the keypad puts them in", async () => {
    const user = userEvent.setup();
    const { container } = render(<TransferPanel />);

    // **両方の値を打つ。** 単位は常に値を持つが、帯域幅と時間は空だと
    // 読み出しに出ない。
    const press = async (token: string) => {
      const key = container.querySelector<HTMLButtonElement>(
        `[data-token="${token}"]`,
      );
      if (key === null) throw new Error(`${token} が見つからない`);
      await user.click(key);
    };
    await press("field:bandwidth");
    await press("digit:7");
    await press("field:duration");
    await press("digit:7");

    const order = fieldsOf(TRANSFER_FIELD_SECTION);
    expect(order, "the field row should carry all four").toHaveLength(4);

    const expected = order
      .filter((field) => field !== "duration")
      .map(
        (field) =>
          TRANSFER_FIELD_LABELS[field as keyof typeof TRANSFER_FIELD_LABELS],
      );
    const shown = doneLabels();
    expect(shown).toHaveLength(expected.length);
    expect(shown.map((text) => text.split(" ")[0])).toEqual(expected);
  });
});
