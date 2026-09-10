import { describe, expect, it } from "vitest";
import type { KeyToken } from "../../../web/src/calc";
import { SCIENTIFIC_SECTIONS } from "../../../web/src/ui/Keypad/scientific";
import type { KeyDef, KeypadSection } from "../../../web/src/ui/Keypad/types";
import { ACTION_BUTTONS, classifyFaces, SHIFT_ARIA_LABEL } from "../ui/keys";

/**
 * **盤面の面は「トークン・操作・Shift」のどれか 1 つである。**
 *
 * 重量級の到達性検査は、以前は `token !== null` の面しか見なかった
 * ——`hist`(`token: null` / `action: "history"`)が落ちていた
 * (設計書 2026-09-10 §3)。**分類を網羅にして、どれにも当たらない面で
 * 落とす**——次に種類が増えた日に、ここが赤くなって決めさせる。
 */

const oneSection = (keys: KeyDef<KeyToken>[]): KeypadSection<KeyToken>[] => [
  { ariaLabel: "試験の区画", columns: 1, height: "square", keys },
];

describe("classifyFaces", () => {
  it("classifies every face of the real keypad, with none left over", () => {
    const faces = SCIENTIFIC_SECTIONS.flatMap((section) =>
      section.keys.flatMap((key) => (key.shift ? [key, key.shift] : [key])),
    ).length;
    const classified = classifyFaces(SCIENTIFIC_SECTIONS);
    expect(
      classified.tokens.size + classified.actions.size + classified.shifts,
    ).toBe(faces);
    // **空で緑を返さない。** どの種も 1 つ以上ある(数は盤面から導き、書き写さない)。
    expect(classified.tokens.size).toBeGreaterThan(0);
    expect(classified.actions.size).toBeGreaterThan(0);
    expect(classified.shifts).toBeGreaterThan(0);
  });

  it("puts the history key behind Shift as an action, not as a token", () => {
    const def = SCIENTIFIC_SECTIONS.flatMap((s) => s.keys).find(
      (key) => key.shift?.action === "history",
    )?.shift;
    expect(def, "the keypad no longer carries a history face").toBeDefined();
    const button = ACTION_BUTTONS.get("history");
    expect(button?.ariaLabel).toBe(def?.ariaLabel);
    expect(button?.needsShift).toBe(true);
  });

  it("refuses a face that is neither a token, an action, nor Shift", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          {
            token: null,
            label: "?",
            ariaLabel: "謎のキー",
            variant: "function",
          },
        ]),
      ),
    ).toThrow(/謎のキー/);
  });

  it("refuses the same action on two faces", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          {
            token: null,
            label: "h",
            ariaLabel: "履歴 1",
            variant: "function",
            action: "history",
          },
          {
            token: null,
            label: "h",
            ariaLabel: "履歴 2",
            variant: "function",
            action: "history",
          },
        ]),
      ),
    ).toThrow(/history/);
  });

  it("refuses a Shift key whose name drifted from SHIFT_ARIA_LABEL", () => {
    expect(() =>
      classifyFaces(
        oneSection([
          {
            token: null,
            label: "S",
            ariaLabel: "別の名前",
            variant: "function",
            kind: "shift",
          },
        ]),
      ),
    ).toThrow(new RegExp(SHIFT_ARIA_LABEL));
  });
});
