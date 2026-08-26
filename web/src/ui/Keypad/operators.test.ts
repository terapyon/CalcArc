import { describe, expect, it } from "vitest";
import {
  DATA_SCALE_SECTIONS,
  DIMENSION_MANUAL_SECTIONS,
  DIMENSION_SECTIONS,
  TYPE_SECTIONS,
} from "./dataScale";
import {
  CANDIDATE_SECTIONS,
  LLM_FIELD_LABELS,
  LLM_FIELD_SECTION,
  llmPad,
} from "./llm";
import {
  BANDWIDTH_UNIT_SECTION,
  DURATION_UNIT_SECTION,
  TRANSFER_FIELD_SECTION,
  TRANSFER_PAD,
} from "./transfer";
import type { KeypadSection } from "./types";

/**
 * **計算しないパネルは演算子キーを持たない**(ユーザー裁定 2026-08-26)。
 *
 * LLM・Data Scale・Transfer の 3 面は、打った文字列をそのまま
 * `expr.integer(...)` に渡す。式を組み立てる入口が無いので、`( ) ÷ × − + =`
 * は**押せて何も起きないキー**だった——3 パネル × 7 個 = 21 個。
 * 「押せるか」と「計算できるか」は別の問いで、盤面に載っているだけでは
 * 押した人の役に立たない。**配線するのではなく盤面から外す**、が裁定である。
 *
 * **`KEY_TOKENS` は変えない。** Scientific・Finance・Convert は同じ綴りを
 * 使って実際に式を組んでいる。ここが縛るのはこの 3 パネルの盤面だけである。
 *
 * 主張を 3 か所に書き分けない——**面の一覧をここに 1 つ持ち**、増えた面が
 * 黙って外れないように**歩いた数も主張する**。
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

/** 3 パネルが出しうる面をすべて並べる。`llmPad` は項目ごとに別の面を作る。 */
function everyFace(): { panel: string; face: KeypadSection<unknown> }[] {
  const faces: { panel: string; face: KeypadSection<unknown> }[] = [];
  const push = (panel: string, face: KeypadSection<unknown>) =>
    faces.push({ panel, face });

  push("LLM", LLM_FIELD_SECTION as KeypadSection<unknown>);
  for (const section of Object.values(CANDIDATE_SECTIONS)) {
    push("LLM", section as KeypadSection<unknown>);
  }
  for (const field of Object.keys(LLM_FIELD_LABELS)) {
    push(
      "LLM",
      llmPad(field as keyof typeof LLM_FIELD_LABELS) as KeypadSection<unknown>,
    );
  }

  for (const section of [
    ...DATA_SCALE_SECTIONS,
    ...TYPE_SECTIONS,
    ...DIMENSION_SECTIONS,
    ...DIMENSION_MANUAL_SECTIONS,
  ]) {
    push("Data Scale", section as KeypadSection<unknown>);
  }

  for (const section of [
    TRANSFER_FIELD_SECTION,
    BANDWIDTH_UNIT_SECTION,
    DURATION_UNIT_SECTION,
    TRANSFER_PAD,
  ]) {
    push("Transfer", section as KeypadSection<unknown>);
  }

  return faces;
}

describe("計算しないパネルの盤面", () => {
  it("offers no operator key on any face of the three panels", () => {
    const found: string[] = [];
    let inspected = 0;
    const faces = everyFace();

    for (const { panel, face } of faces) {
      for (const key of face.keys) {
        // **Shift の第 2 面も見る。** いまこの 3 パネルに Shift は無いが、
        // 面が増えたときに素通りする書き方をしない。
        for (const token of [key.token, key.shift?.token]) {
          if (token === null || token === undefined) continue;
          inspected += 1;
          if ((OPERATOR_TOKENS as readonly string[]).includes(String(token))) {
            found.push(`${panel} / ${face.ariaLabel}: ${String(token)}`);
          }
        }
      }
    }

    // **歩いた数を先に主張する。** 面の綴りが変わって 0 周になった日から、
    // この検査が何も見ないまま緑を返し続けるのを止める。
    expect(faces.length).toBeGreaterThanOrEqual(20);
    expect(inspected, "no key was ever inspected").toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
