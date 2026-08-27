import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// jsdom では WASM を読み込めないので、ラッパー層ごと差し替える
// (DataScalePanel.test.tsx / LlmPanel.test.tsx と同じ流儀)。**ここは
// 計算の答えを一切見ない**ので、盤面が立つだけの最小限でよい。
vi.mock("../../datascale", () => ({
  initDataScale: () => Promise.resolve({}),
}));
vi.mock("../../expr", () => ({
  initExpr: () =>
    Promise.resolve({
      integer: () => ({ value: null, error: null }),
      percent: () => ({ value: null, error: null }),
    }),
}));

import { DataScalePanel } from "../DataScale/DataScalePanel";
import { LlmPanel } from "../Llm/LlmPanel";
import { TransferPanel } from "../Transfer/TransferPanel";

/**
 * **計算しないパネルでは、演算子キーが押せない**(ユーザー裁定 2026-08-26)。
 *
 * LLM・Data Scale・Transfer の 3 面は、打った文字列をそのまま
 * `expr.integer(...)` に渡す。式を組み立てる入口が無いので、
 * `( ) ÷ × − + =` は**押せて何も起きないキー**だった——3 パネル × 7 個 = 21 個。
 * 裁定は「**盤面はそのまま、無効化する**」である(枠も位置もラベルも動かさない)。
 *
 * **見るのは定義ではなく振る舞いである。** 「盤面定義に演算子トークンが
 * 載っているか」を見ると、裁定のあとも載ったままなので何も言えない。
 * 欠陥は「**押せて**何も起きない」だったのだから、**押せないこと**を見る。
 *
 * **門番の連鎖を端から端まで通す。** パネルの `keyDisabled` を呼ぶだけでは、
 * `Keypad.tsx` がその戻り値を `disabled` として実際に渡しているかを見て
 * いない。ここでは**パネルを描画して、出てきた `<button>` が `disabled` を
 * 持つ**ところまで見る——`keyDisabled` → `Keypad.tsx` → `Key.tsx` の 3 段が
 * 1 つでも切れたら赤くなる。
 *
 * **件数も主張する。** 1 パネルだけ直しても緑にならないように、
 * **21 個ちょうど**を数える。
 */
const OPERATOR_TOKENS = [
  "lparen",
  "rparen",
  "div",
  "mul",
  "sub",
  "add",
  "eq",
] as const;

/**
 * 数字面を出した 3 パネル。**演算子キーが載るのは数字面だけ**なので、
 * そこへ着いてから数える。LLM の既定は候補面なので、数字しか打てない
 * 「層数」へ移る。
 */
const PANELS = [
  {
    name: "Data Scale",
    element: <DataScalePanel />,
    reach: async () => {},
  },
  {
    name: "LLM",
    element: <LlmPanel />,
    reach: async (
      user: ReturnType<typeof userEvent.setup>,
      root: HTMLElement,
    ) => {
      const field = root.querySelector<HTMLButtonElement>(
        '[data-token="field:layers"]',
      );
      if (field === null) throw new Error("層数の項目キーが見つからない");
      await user.click(field);
    },
  },
  {
    name: "Transfer",
    element: <TransferPanel />,
    reach: async () => {},
  },
] as const;

describe("計算しないパネルの演算子キー", () => {
  it("renders all seven of them disabled, on all three panels", async () => {
    const user = userEvent.setup();
    const live: string[] = [];
    let counted = 0;

    for (const panel of PANELS) {
      const { container, unmount } = render(panel.element);
      await panel.reach(user, container);

      for (const token of OPERATOR_TOKENS) {
        const key = container.querySelector<HTMLButtonElement>(
          `[data-token="${token}"]`,
        );
        // **無くなっていても赤にする。** 裁定は「盤面はそのまま」なので、
        // キーが消えていたらそれは別の実装であり、この検査の主張ではない。
        if (key === null) {
          live.push(`${panel.name}: ${token} が盤面に無い`);
          continue;
        }
        counted += 1;
        if (!key.disabled) live.push(`${panel.name}: ${token} が押せる`);
      }
      unmount();
    }

    // **数えた数を先に主張する。** 面に着けずに 0 周でも緑、を起こさない。
    expect(counted, "no operator key was ever found").toBe(
      OPERATOR_TOKENS.length * PANELS.length,
    );
    expect(live).toEqual([]);
  });
});
