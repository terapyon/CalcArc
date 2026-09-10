import type { KeyToken } from "../../../web/src/calc";
import { SCIENTIFIC_SECTIONS } from "../../../web/src/ui/Keypad/scientific";
import type {
  KeyAction,
  KeypadSection,
} from "../../../web/src/ui/Keypad/types";

/**
 * キートークン → 盤面のボタン。
 *
 * **手書きの表を持たない。** UI が描くのと同じ定義(`SCIENTIFIC_SECTIONS`)から
 * 導く。手で書くと、キーが Shift の裏に移動しても表は古いまま緑になり——
 * 「そのキーは押せる」という嘘が残る。
 *
 * 導いた結果、**どのトークンにもボタンが無い**なら、それは
 * 「盤面から到達できないキー」であり、**それ自体が発見である。**
 */
export interface ButtonFor {
  /** 押すボタンのアクセシブルネーム。 */
  ariaLabel: string;
  /** 押す前に Shift を押す必要があるか。 */
  needsShift: boolean;
  /** どの区画にあるか。region 起点で引くために要る。 */
  section: string;
}

export const SHIFT_ARIA_LABEL = "第2面に切り替え";

/** 盤面の面を 3 種に分けた結果。 */
export interface Faces {
  tokens: Map<KeyToken, ButtonFor>;
  actions: Map<KeyAction, ButtonFor>;
  /** `kind: "shift"` の面の数。名前は `SHIFT_ARIA_LABEL` と一致していることを確かめ済み。 */
  shifts: number;
}

/**
 * **盤面のすべての面(第 1 面・第 2 面)を「トークン・操作・Shift」のどれか
 * 1 つに分ける。どれにも当たらない面で落ちる**(設計書 2026-09-10 §3.2)。
 *
 * 以前はトークンを持つ面だけを表に入れ、残りを黙って捨てていた——`hist`
 * (`token: null` / `action: "history"`)がそこで落ち、テスト名
 * `every button the keypad claims can actually be pressed` が主張を超えていた。
 * **捨てる代わりに分類し、分類できないものを見つけたら止まる。**
 */
export function classifyFaces(
  sections: readonly KeypadSection<KeyToken>[],
): Faces {
  const tokens = new Map<KeyToken, ButtonFor>();
  const actions = new Map<KeyAction, ButtonFor>();
  let shifts = 0;

  const place = (
    face: {
      token: KeyToken | null;
      ariaLabel: string;
      action?: KeyAction;
      kind?: "shift";
    },
    needsShift: boolean,
    section: string,
  ): void => {
    const button = { ariaLabel: face.ariaLabel, needsShift, section };
    if (face.token !== null) {
      const existing = tokens.get(face.token);
      if (existing !== undefined) {
        throw new Error(
          `keys: ${face.token} appears twice on the keypad ` +
            `(${existing.ariaLabel} and ${face.ariaLabel}). The driver would ` +
            "press one of them arbitrarily.",
        );
      }
      tokens.set(face.token, button);
      return;
    }
    if (face.action !== undefined) {
      if (actions.has(face.action)) {
        throw new Error(
          `keys: the action ${face.action} appears twice on the keypad. ` +
            "The driver would press one of them arbitrarily.",
        );
      }
      actions.set(face.action, button);
      return;
    }
    if (face.kind === "shift" && !needsShift) {
      if (face.ariaLabel !== SHIFT_ARIA_LABEL) {
        throw new Error(
          `keys: the Shift key is named "${face.ariaLabel}", but the driver ` +
            `presses "${SHIFT_ARIA_LABEL}". Rename one of them.`,
        );
      }
      shifts += 1;
      return;
    }
    throw new Error(
      `keys: "${face.ariaLabel}" (${section}) is neither a token, an action, ` +
        "nor the Shift key — the heavy model cannot drive it. Decide what it " +
        "is and teach classifyFaces about it.",
    );
  };

  for (const section of sections) {
    for (const key of section.keys) {
      place(key, false, section.ariaLabel);
      if (key.shift !== undefined) {
        place(key.shift, true, section.ariaLabel);
      }
    }
  }
  return { tokens, actions, shifts };
}

const FACES = classifyFaces(SCIENTIFIC_SECTIONS);

export const BUTTON_FOR: ReadonlyMap<KeyToken, ButtonFor> = FACES.tokens;

/** 操作の面(`action`)→ 盤面のボタン。**トークンを送らない面**。 */
export const ACTION_BUTTONS: ReadonlyMap<KeyAction, ButtonFor> = FACES.actions;
